/**
 * Panoptica365 — PSA Integration: data store + eager migrations
 *
 * Feature 8.3 (2026-06-06). One row per alert↔ticket LINK in `psa_tickets`
 * (several alerts may point at the same ticket_id in the dedup/append case).
 * Provider-agnostic by column shape; today the only provider is 'autotask'.
 *
 * Migrations mirror alert-engine.ensureAlertColumns(): idempotent, try/catch
 * per DDL, informational logging — safe to run at every boot. Eagerly run from
 * server.js so the schema exists regardless of whether PSA is configured.
 *
 * House rules honored here: toMysqlDatetime for every DATETIME write (never a
 * Date object or ISO 'Z' to pool.execute); UTC_TIMESTAMP() for "now" inside
 * SQL; db.execute returns affectedRows, db.insert returns insertId.
 */

const db = require('../db/database');
const { toMysqlDatetime } = require('./util');

let schemaReady = false;

/**
 * Eager migration. Creates psa_tickets and adds tenants.psa_company_id.
 * Idempotent. Resolves true on success; logs and resolves false on failure
 * (boot must not crash if the DB is briefly unavailable — the worker and the
 * outbound path both guard on isConfigured() and will retry the schema).
 */
async function ensureSchema() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS psa_tickets (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        alert_id        BIGINT UNSIGNED NOT NULL,
        tenant_id       INT UNSIGNED NULL,
        policy_id       INT UNSIGNED NULL,
        provider        ENUM('autotask') NOT NULL DEFAULT 'autotask',
        ticket_id       BIGINT UNSIGNED NOT NULL,
        ticket_number   VARCHAR(50) NULL,
        link_role       ENUM('primary','appended') NOT NULL DEFAULT 'primary',
        state           ENUM('open','closed','error') NOT NULL DEFAULT 'open',
        pending_op      ENUM('create','append') NULL,
        last_error      VARCHAR(512) NULL,
        retry_count     INT UNSIGNED NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL,
        closed_at       DATETIME NULL,
        last_synced_at  DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_alert (alert_id),
        KEY idx_dedup (tenant_id, policy_id, state),
        KEY idx_ticket (ticket_id, state)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // pending_op is not in the original spec table but is required so the
    // worker's retry pass knows which outbound op to re-attempt for an error
    // row that never got a ticket_id (create) vs one that did (append).
    // Add it defensively for tables created before this column existed.
    const hasPendingOp = await db.queryRows(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'psa_tickets'
          AND COLUMN_NAME = 'pending_op'`
    );
    if (hasPendingOp.length === 0) {
      await db.execute(
        "ALTER TABLE psa_tickets ADD COLUMN pending_op ENUM('create','append') NULL AFTER state"
      );
    }

    // tenants.psa_company_id — Autotask Companies.id mapping (NULL = unmapped,
    // email fallback). Mutated only via the PSA settings mapping table.
    const hasCompanyId = await db.queryRows(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
          AND COLUMN_NAME = 'psa_company_id'`
    );
    if (hasCompanyId.length === 0) {
      await db.executeWithDeadlockRetry(
        'ALTER TABLE tenants ADD COLUMN psa_company_id BIGINT UNSIGNED NULL COMMENT \'Autotask Companies.id (PSA mapping); NULL = email fallback\''
      );
      console.log('[PSA] Added column tenants.psa_company_id');
    }

    schemaReady = true;
    return true;
  } catch (err) {
    console.error('[PSA] ensureSchema failed:', err.message);
    return false;
  }
}

function isSchemaReady() {
  return schemaReady;
}

/**
 * Dedup lookup. The newest still-open link row for this (tenant, policy) on
 * this provider — or null. For msp-scope alerts the caller passes tenantId=null
 * and we match on `tenant_id IS NULL`.
 */
async function findOpenLinkForDedup(tenantId, policyId, provider = 'autotask') {
  const tenantClause = tenantId === null || tenantId === undefined
    ? 'tenant_id IS NULL'
    : 'tenant_id = ?';
  const params = [];
  if (tenantId !== null && tenantId !== undefined) params.push(tenantId);
  params.push(policyId, provider);
  return db.queryOne(
    `SELECT * FROM psa_tickets
       WHERE ${tenantClause} AND policy_id <=> ? AND provider = ? AND state = 'open'
       ORDER BY created_at DESC LIMIT 1`,
    // policy_id may itself be NULL for some msp-scope policies; <=> is the
    // NULL-safe equality so a NULL policy dedups against a NULL policy.
    [...params]
  );
}

/** All link rows for a given alert (usually 0 or 1). */
async function getLinksForAlert(alertId) {
  return db.queryRows(
    `SELECT * FROM psa_tickets WHERE alert_id = ? ORDER BY id DESC`,
    [alertId]
  );
}

/** The single most-recent link row for an alert, or null. */
async function getLinkForAlert(alertId) {
  return db.queryOne(
    `SELECT * FROM psa_tickets WHERE alert_id = ? ORDER BY id DESC LIMIT 1`,
    [alertId]
  );
}

/**
 * Most-recent OPEN link row per alert id, keyed by alert_id. Used by the UI to
 * decide whether to show the close-ticket modal and to render the ticket chip.
 * Returns a Map<alertId, linkRow>.
 */
async function getOpenLinksForAlertIds(alertIds) {
  const ids = (alertIds || []).map(Number).filter(Number.isFinite);
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.queryRows(
    `SELECT * FROM psa_tickets
       WHERE alert_id IN (${placeholders}) AND state = 'open'
       ORDER BY id DESC`,
    ids
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.alert_id)) map.set(r.alert_id, r); // first = newest (DESC)
  }
  return map;
}

/**
 * Insert a link row. `fields` is a plain object of column→value. created_at is
 * stamped here (UTC) if not supplied. Returns the new row id.
 */
async function insertLink(fields) {
  const row = {
    provider: 'autotask',
    link_role: 'primary',
    state: 'open',
    retry_count: 0,
    created_at: toMysqlDatetime(new Date()),
    ...fields,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const params = cols.map((c) => row[c]);
  return db.insert(
    `INSERT INTO psa_tickets (${cols.join(', ')}) VALUES (${placeholders})`,
    params
  );
}

/** Patch a link row by id. `fields` is column→value; updates last_synced_at. */
async function updateLink(id, fields) {
  const cols = Object.keys(fields);
  if (cols.length === 0) return 0;
  const setClause = cols.map((c) => `${c} = ?`).join(', ');
  const params = cols.map((c) => fields[c]);
  params.push(id);
  return db.execute(`UPDATE psa_tickets SET ${setClause} WHERE id = ?`, params);
}

/** Distinct ticket_ids with at least one open link row, for the poll batch. */
async function getOpenTicketIds() {
  const rows = await db.queryRows(
    `SELECT DISTINCT ticket_id FROM psa_tickets WHERE state = 'open' AND ticket_id > 0`
  );
  return rows.map((r) => Number(r.ticket_id));
}

/** All link rows pointing at a ticket_id (any state). */
async function getLinksForTicket(ticketId) {
  return db.queryRows(
    `SELECT * FROM psa_tickets WHERE ticket_id = ?`,
    [ticketId]
  );
}

/** Error-state rows eligible for a retry attempt (retry_count < max). */
async function getRetryableLinks(maxRetries = 10) {
  return db.queryRows(
    `SELECT * FROM psa_tickets WHERE state = 'error' AND retry_count < ? ORDER BY id ASC`,
    [maxRetries]
  );
}

/** Count of error-state link rows (for the settings health strip). */
async function countErrorLinks() {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS n FROM psa_tickets WHERE state = 'error'`
  );
  return row ? Number(row.n) : 0;
}

/** Count of distinct open tickets (for the settings health strip). */
async function countOpenTickets() {
  const row = await db.queryOne(
    `SELECT COUNT(DISTINCT ticket_id) AS n FROM psa_tickets WHERE state = 'open'`
  );
  return row ? Number(row.n) : 0;
}

module.exports = {
  ensureSchema,
  isSchemaReady,
  findOpenLinkForDedup,
  getLinksForAlert,
  getLinkForAlert,
  getOpenLinksForAlertIds,
  insertLink,
  updateLink,
  getOpenTicketIds,
  getLinksForTicket,
  getRetryableLinks,
  countErrorLinks,
  countOpenTickets,
};
