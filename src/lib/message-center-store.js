/**
 * Panoptica365 — Microsoft Message Center store (Feature 8.8)
 *
 * Persistence layer for the Message Center feed. Owns two tables:
 *
 *   message_center_items  — every MC message ever seen (dedup) + its
 *                           processing outcome (Haiku correlation, alert).
 *   message_center_state  — single-row last-run watermark so a restart
 *                           doesn't skip a day and a re-run doesn't re-pull
 *                           more than once per 24h.
 *
 * Also owns the idempotent registration of the data-driven alert policy
 * ("Microsoft planned change") — created on first boot if absent so the
 * MSP-level alert has a policy row to reference. The policy is
 * threshold_type:'imperative' (skipped cleanly by the scheduled evaluator;
 * fired only by message-center-worker.js), mirroring SECURITY_DRIFT.
 *
 * Schema migration follows the eager / single-flight pattern used by
 * src/lib/defender-incidents.js (ensureSchema awaited once, cached).
 *
 * Timestamp convention (per house rule): store UTC wall-clock strings via
 * toMysqlDatetime (mysql2 rejects Date objects and ISO 'Z' suffixes on
 * parameterized writes); use UTC_TIMESTAMP() for "now" comparisons.
 */

'use strict';

const db = require('../db/database');

// Operator-facing policy name. Localized for display via
// alert_policy_names.<policySlug(name)>; the raw English name is the stable
// DB key and the slug source. Do NOT rename without a migration.
const POLICY_NAME = 'Microsoft planned change';
const POLICY_DESCRIPTION =
  'Microsoft announced a change in the Message Center that may affect a security setting Panoptica365 monitors.';

let schemaReady = false;
let schemaPromise = null;

/**
 * Strip ISO 'Z' suffix and convert T → space for MySQL DATETIME columns.
 * Matches the toMysqlDatetime helpers in ual-events.js / defender-incidents.js
 * — kept local to avoid cross-module coupling for a one-line utility.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  // Graph datetimes already look like "2026-05-30T12:00:00Z"; bare strings
  // pass through the same normalization harmlessly.
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

/**
 * Build the Microsoft 365 admin-center deep link for a Message Center post.
 * The Graph serviceUpdateMessage resource carries no web URL of its own, so
 * we construct the canonical admin-center link from the message id (MC######).
 */
function messageWebUrl(mcId) {
  if (!mcId) return null;
  return `https://admin.microsoft.com/Adminportal/Home#/MessageCenter/:/messages/${mcId}`;
}

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS message_center_items (
          mc_id                 VARCHAR(64)  NOT NULL,
          source_azure_tenant   VARCHAR(64)  NOT NULL,
          title                 VARCHAR(512) NOT NULL,
          category              VARCHAR(32)  NOT NULL,
          services              JSON,
          is_major_change       TINYINT(1)   NOT NULL DEFAULT 0,
          action_required_by    DATETIME     NULL,
          ms_last_modified      DATETIME     NULL,
          ms_web_url            VARCHAR(1024) NULL,
          first_seen_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          processed             TINYINT(1)   NOT NULL DEFAULT 0,
          relevant              TINYINT(1)   NOT NULL DEFAULT 0,
          alerted               TINYINT(1)   NOT NULL DEFAULT 0,
          alert_id              BIGINT UNSIGNED NULL,
          affected_areas        JSON,
          affected_tenant_ids   JSON,
          ai_analysis_en        MEDIUMTEXT   NULL,
          ai_analysis_fr        MEDIUMTEXT   NULL,
          ai_analysis_es        MEDIUMTEXT   NULL,
          PRIMARY KEY (mc_id, source_azure_tenant),
          INDEX idx_mc_processed (processed),
          INDEX idx_mc_first_seen (first_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[MessageCenter] Ensured message_center_items table exists');
    } catch (e) {
      if (!/already exists/i.test(e.message)) {
        console.error('[MessageCenter] message_center_items migration error:', e.message);
      }
    }

    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS message_center_state (
          id            TINYINT UNSIGNED NOT NULL DEFAULT 1,
          last_run_at   DATETIME NULL,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      // Seed the singleton row if missing (NULL last_run_at = never run).
      await db.execute(
        `INSERT IGNORE INTO message_center_state (id, last_run_at) VALUES (1, NULL)`
      );
      console.log('[MessageCenter] Ensured message_center_state table exists');
    } catch (e) {
      if (!/already exists/i.test(e.message)) {
        console.error('[MessageCenter] message_center_state migration error:', e.message);
      }
    }

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

/**
 * Attempt to record a freshly-seen Message Center message. Uses INSERT
 * IGNORE keyed on (mc_id, source_azure_tenant); returns true only when the
 * row was newly inserted (affectedRows === 1), false when it already existed.
 * This is the dedup gate — only newly-inserted rows get processed downstream.
 */
async function insertIfNew(sourceAzureTenant, msg) {
  await ensureSchema();
  const affected = await db.execute(
    `INSERT IGNORE INTO message_center_items
       (mc_id, source_azure_tenant, title, category, services,
        is_major_change, action_required_by, ms_last_modified, ms_web_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(msg.id).slice(0, 64),
      String(sourceAzureTenant).slice(0, 64),
      String(msg.title || '(untitled)').slice(0, 512),
      String(msg.category || 'unknown').slice(0, 32),
      JSON.stringify(Array.isArray(msg.services) ? msg.services : []),
      msg.isMajorChange ? 1 : 0,
      toMysqlDatetime(msg.actionRequiredByDateTime),
      toMysqlDatetime(msg.lastModifiedDateTime),
      String(messageWebUrl(msg.id)).slice(0, 1024),
    ]
  );
  return affected === 1;
}

/**
 * Mark an item processed without raising an alert (prefilter drop or Haiku
 * said not-relevant). Optionally stores the 3-locale analysis for audit.
 */
async function markProcessedNotRelevant(mcId, sourceAzureTenant, analysis = null) {
  await ensureSchema();
  await db.execute(
    `UPDATE message_center_items
        SET processed = 1, relevant = 0,
            ai_analysis_en = COALESCE(?, ai_analysis_en),
            ai_analysis_fr = COALESCE(?, ai_analysis_fr),
            ai_analysis_es = COALESCE(?, ai_analysis_es)
      WHERE mc_id = ? AND source_azure_tenant = ?`,
    [
      analysis?.en || null,
      analysis?.fr || null,
      analysis?.es || null,
      String(mcId).slice(0, 64),
      String(sourceAzureTenant).slice(0, 64),
    ]
  );
}

/**
 * Mark an item processed + relevant + alerted, storing the correlation
 * outcome (human-readable affected areas — NOT internal IDs), the
 * deterministic affected-tenant id list, the alert id, and the 3-locale
 * analysis into the operator-facing fields.
 */
async function markAlerted(mcId, sourceAzureTenant, {
  alertId,
  affectedAreas = [],
  affectedTenantIds = [],
  analysis = {},
} = {}) {
  await ensureSchema();
  await db.execute(
    `UPDATE message_center_items
        SET processed = 1, relevant = 1, alerted = 1,
            alert_id = ?,
            affected_areas = ?,
            affected_tenant_ids = ?,
            ai_analysis_en = ?, ai_analysis_fr = ?, ai_analysis_es = ?
      WHERE mc_id = ? AND source_azure_tenant = ?`,
    [
      alertId || null,
      JSON.stringify(affectedAreas || []),
      JSON.stringify(affectedTenantIds || []),
      analysis.en || null,
      analysis.fr || null,
      analysis.es || null,
      String(mcId).slice(0, 64),
      String(sourceAzureTenant).slice(0, 64),
    ]
  );
}

/**
 * Has Panoptica365 ever recorded a Message Center item for this source
 * tenant? Used to detect the FIRST run for a given source tenant so the
 * historical backlog can be created in the dashboard without emailing it.
 * Per-tenant (not global) because Message Center ids are Microsoft-wide and
 * the dedup key is (mc_id, source_azure_tenant) — switching the source tenant
 * makes every message "new" again and must NOT re-flood email.
 */
async function hasItemsForTenant(sourceAzureTenant) {
  await ensureSchema();
  const row = await db.queryOne(
    `SELECT 1 FROM message_center_items WHERE source_azure_tenant = ? LIMIT 1`,
    [String(sourceAzureTenant)]
  );
  return !!row;
}

/** Read the last-run watermark (Date | null). */
async function getLastRunAt() {
  await ensureSchema();
  const row = await db.queryOne(
    `SELECT last_run_at FROM message_center_state WHERE id = 1`
  );
  if (!row || !row.last_run_at) return null;
  // mysql2 returns DATETIME as a bare UTC wall-clock string; parse as UTC.
  return new Date(String(row.last_run_at).replace(' ', 'T') + 'Z');
}

/** Stamp the last-run watermark to now (UTC). */
async function setLastRunNow() {
  await ensureSchema();
  await db.execute(
    `UPDATE message_center_state SET last_run_at = UTC_TIMESTAMP() WHERE id = 1`
  );
}

/**
 * Idempotently ensure the "Microsoft planned change" alert policy exists.
 * Returns the policy row ({ id, name, severity, category,
 * notification_target, notification_limit }). Created on first boot if absent
 * — production DBs are already seeded and won't re-run init-schema.js.
 *
 * Default notification_target is 'none' (dashboard-only). Microsoft-caused
 * drift is awareness-grade, not an incident, and surfacing it silently in the
 * Alert Dashboard avoids emailing the operator on enable. The MSP opts into
 * email by switching this policy to support/personal/both whenever they want.
 * Only the INITIAL creation uses this default — an operator's later choice is
 * never overwritten (we return early when the row already exists).
 */
async function ensurePolicy() {
  await ensureSchema();
  const cols = 'id, name, severity, category, notification_target, notification_limit';
  const existing = await db.queryOne(
    `SELECT ${cols} FROM alert_policies WHERE name = ? LIMIT 1`,
    [POLICY_NAME]
  );
  if (existing) return existing;

  await db.execute(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier,
        notification_target, notification_limit, detection_logic, enabled)
     VALUES (?, ?, 'config_changes', 'low', 'low', 'none', 24, ?, TRUE)`,
    [
      POLICY_NAME,
      POLICY_DESCRIPTION,
      JSON.stringify({ threshold_type: 'imperative', source: 'message_center' }),
    ]
  );
  console.log(`[MessageCenter] Registered alert policy "${POLICY_NAME}"`);
  return db.queryOne(`SELECT ${cols} FROM alert_policies WHERE name = ? LIMIT 1`, [POLICY_NAME]);
}

module.exports = {
  POLICY_NAME,
  toMysqlDatetime,
  messageWebUrl,
  ensureSchema,
  insertIfNew,
  hasItemsForTenant,
  markProcessedNotRelevant,
  markAlerted,
  getLastRunAt,
  setLastRunNow,
  ensurePolicy,
};
