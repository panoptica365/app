/**
 * Panoptica365 — Access Review store (A1)
 *
 * Persistence for the tenant-dashboard "Access review" tab. Owns two tables:
 *
 *   access_review_snapshot — one row per tenant: the assembled payload for both
 *     tables (admin roster + all-user roster) plus the summary, cached so UI
 *     reads are cache-first (house rule: cache over live for UI endpoints). The
 *     refresh route rebuilds it from a live pull; GET reads it.
 *
 *   break_glass_accounts — operator-designated emergency-access accounts for a
 *     tenant. Drives the blue "Break-glass account" tag and the extra delete/
 *     disable guard. CRUD lives here; only the ALERTING on break-glass activity
 *     is deferred (spec §7).
 *
 * Schema migration follows the eager / single-flight pattern (ensureSchema
 * awaited once, cached) used by src/lib/known-good-store.js. Timestamps use the
 * house UTC-wall-clock convention via toMysqlDatetime (mysql2 rejects Date
 * objects + ISO 'Z' on parameterized writes).
 */

'use strict';

const db = require('../db/database');

let schemaReady = false;
let schemaPromise = null;

/** Strip ISO 'Z'/fractional + T→space for MySQL DATETIME params. */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // One snapshot row per tenant. payload holds { privileged_roles, users,
    // summary } verbatim from the assembly. reports_anonymized is hoisted to a
    // column so the read route can answer the "show the concealment note"
    // question without parsing the JSON.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS access_review_snapshot (
        tenant_id          INT UNSIGNED NOT NULL,
        captured_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reports_anonymized TINYINT(1)   NOT NULL DEFAULT 0,
        payload            JSON         NOT NULL,
        PRIMARY KEY (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Operator-designated break-glass accounts, keyed by (tenant, user_id). UPN
    // is stored for display + matching when a snapshot row carries no object id.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS break_glass_accounts (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id           INT UNSIGNED NOT NULL,
        user_id             VARCHAR(64)  NULL,
        user_principal_name VARCHAR(255) NOT NULL,
        display_name        VARCHAR(512) NULL,
        note                VARCHAR(1024) NULL,
        created_by          VARCHAR(255) NULL,
        created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_upn (tenant_id, user_principal_name),
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Per-tenant break-glass GROUP (Break-Glass Governance, 2026-06-13). The
    // operator points us at ONE dedicated security group; emergency accounts are
    // members of it, and the GROUP is excluded from every CA policy. We key on the
    // immutable objectId (group_id) — NEVER the display name, which can be renamed.
    // group_name is cached for display only.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS break_glass_config (
        tenant_id     INT UNSIGNED NOT NULL,
        group_id      VARCHAR(64)  NOT NULL,
        group_name    VARCHAR(512) NULL,
        configured_by VARCHAR(255) NULL,
        configured_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } catch (err) {
    schemaPromise = null; // allow retry on next call
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Snapshot read / write (best-effort)
// ──────────────────────────────────────────────────────────────────────

/** Read the cached snapshot for a tenant, or null. JSON column auto-parses. */
async function readSnapshot(tenantId) {
  await ensureSchema();
  const row = await db.queryOne(
    'SELECT tenant_id, captured_at, reports_anonymized, payload FROM access_review_snapshot WHERE tenant_id = ?',
    [tenantId]
  );
  if (!row) return null;
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  if (!payload) return null;
  return {
    captured_at: row.captured_at,
    reports_anonymized: !!row.reports_anonymized,
    ...payload,
  };
}

/** Upsert the cached snapshot for a tenant. */
async function writeSnapshot(tenantId, payload, { reportsAnonymized = false } = {}) {
  await ensureSchema();
  await db.execute(
    `INSERT INTO access_review_snapshot (tenant_id, captured_at, reports_anonymized, payload)
     VALUES (?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE captured_at = NOW(), reports_anonymized = VALUES(reports_anonymized), payload = VALUES(payload)`,
    [tenantId, reportsAnonymized ? 1 : 0, JSON.stringify(payload)]
  );
}

// ──────────────────────────────────────────────────────────────────────
// Break-glass CRUD
// ──────────────────────────────────────────────────────────────────────

/** All break-glass rows for a tenant. */
async function listBreakGlass(tenantId) {
  await ensureSchema();
  return db.queryRows(
    `SELECT id, tenant_id, user_id, user_principal_name, display_name, note, created_by, created_at
       FROM break_glass_accounts WHERE tenant_id = ? ORDER BY user_principal_name`,
    [tenantId]
  );
}

/**
 * A Set of lowercased UPNs + a Set of user ids for fast break-glass tagging of a
 * roster. Returned together so the assembly can match on either signal.
 */
async function breakGlassIndex(tenantId) {
  const rows = await listBreakGlass(tenantId);
  const upns = new Set();
  const ids = new Set();
  for (const r of rows) {
    if (r.user_principal_name) upns.add(String(r.user_principal_name).toLowerCase());
    if (r.user_id) ids.add(String(r.user_id));
  }
  return { upns, ids };
}

/** Add (or upsert) a break-glass designation. Returns the row id. */
async function addBreakGlass(tenantId, { userId = null, upn, displayName = null, note = null, createdBy = null }) {
  await ensureSchema();
  if (!upn) throw new Error('addBreakGlass: upn required');
  await db.execute(
    `INSERT INTO break_glass_accounts (tenant_id, user_id, user_principal_name, display_name, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), display_name = VALUES(display_name),
       note = VALUES(note), created_by = VALUES(created_by)`,
    [tenantId, userId, upn, displayName, note ? String(note).slice(0, 1024) : null, createdBy]
  );
  const row = await db.queryOne(
    'SELECT id FROM break_glass_accounts WHERE tenant_id = ? AND user_principal_name = ?',
    [tenantId, upn]
  );
  return row ? row.id : null;
}

/** Remove a break-glass designation by row id (scoped to tenant). Returns affectedRows. */
async function removeBreakGlass(tenantId, id) {
  await ensureSchema();
  return db.execute(
    'DELETE FROM break_glass_accounts WHERE tenant_id = ? AND id = ?',
    [tenantId, id]
  );
}

// ──────────────────────────────────────────────────────────────────────
// Break-glass GROUP config (one group per tenant)
// ──────────────────────────────────────────────────────────────────────

/** The configured break-glass group for a tenant, or null if not set up yet. */
async function getGroupConfig(tenantId) {
  await ensureSchema();
  return db.queryOne(
    'SELECT tenant_id, group_id, group_name, configured_by, configured_at FROM break_glass_config WHERE tenant_id = ?',
    [tenantId]
  );
}

/** Set (or replace) the break-glass group for a tenant. Keyed on the GUID. */
async function setGroupConfig(tenantId, { groupId, groupName = null, configuredBy = null }) {
  await ensureSchema();
  if (!groupId) throw new Error('setGroupConfig: groupId required');
  await db.execute(
    `INSERT INTO break_glass_config (tenant_id, group_id, group_name, configured_by, configured_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE group_id = VALUES(group_id), group_name = VALUES(group_name),
       configured_by = VALUES(configured_by), configured_at = NOW()`,
    [tenantId, groupId, groupName, configuredBy]
  );
  return getGroupConfig(tenantId);
}

/** Remove the break-glass group config for a tenant. */
async function clearGroupConfig(tenantId) {
  await ensureSchema();
  return db.execute('DELETE FROM break_glass_config WHERE tenant_id = ?', [tenantId]);
}

/** True if (tenant, upn|userId) is designated break-glass. */
async function isBreakGlass(tenantId, { upn = null, userId = null }) {
  await ensureSchema();
  if (!upn && !userId) return false;
  const row = await db.queryOne(
    `SELECT id FROM break_glass_accounts
       WHERE tenant_id = ? AND (
         (? IS NOT NULL AND LOWER(user_principal_name) = LOWER(?)) OR
         (? IS NOT NULL AND user_id = ?)
       ) LIMIT 1`,
    [tenantId, upn, upn, userId, userId]
  );
  return !!row;
}

module.exports = {
  ensureSchema,
  // snapshot
  readSnapshot,
  writeSnapshot,
  // break-glass accounts
  listBreakGlass,
  breakGlassIndex,
  addBreakGlass,
  removeBreakGlass,
  isBreakGlass,
  // break-glass group config
  getGroupConfig,
  setGroupConfig,
  clearGroupConfig,
  // helper
  toMysqlDatetime,
};
