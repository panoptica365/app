/**
 * Panoptica365 — Security Settings Seeder
 *
 * Mirrors the static registry into the `security_settings` table on boot.
 * Idempotent — safe to run on every startup. Update/insert strategy means
 * that if a setting's text copy changes in the registry, the change
 * propagates to the DB without a manual migration.
 *
 * Called from src/server.js at startup, alongside ensureMspAuditTable().
 *
 * Design choice — why seed into a DB table at all (rather than always read
 * from the JS registry):
 *   1. History rows (security_setting_events, tenant_security_config) FK to
 *      setting_id. The FK target must exist in a table.
 *   2. The list-view SQL joins tenant_security_config to security_settings
 *      in a single query; pushing metadata into the DB keeps list-view
 *      rendering to one round-trip.
 *   3. It lets future admin tooling (edit text copy, tweak a priority)
 *      work without a code deploy — the seeder uses INSERT ... ON DUPLICATE
 *      KEY UPDATE so the JS registry is always the authoritative fallback,
 *      but DB edits persist between reseeds if we later add a `locked_by_db`
 *      flag. (Not in Phase A. Hook point noted.)
 */

'use strict';

const db = require('../../db/database');
const { SETTINGS } = require('./registry');

async function ensureSchema() {
  // Create-if-missing. The master DDL lives in /schema-security.sql and is the
  // source of truth; this block exists so a fresh clone of the repo that hasn't
  // run the schema file still boots. It intentionally does not attempt to
  // ALTER existing columns — if the schema diverges, that's a migration.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS security_settings (
        setting_id       VARCHAR(16)  NOT NULL PRIMARY KEY,
        name             VARCHAR(255) NOT NULL,
        category         ENUM('exchange','identity','sharepoint','teams','defender','compliance') NOT NULL,
        priority         ENUM('critical','high','medium','low') NOT NULL,
        poll_strategy    ENUM('graph','powershell_exo','powershell_spo','powershell_teams') NOT NULL,
        poll_key         VARCHAR(255) NOT NULL,
        description      TEXT NOT NULL,
        security_impact  TEXT NOT NULL,
        user_impact      TEXT NOT NULL,
        admin_notes      TEXT NOT NULL,
        licence_required VARCHAR(128) DEFAULT NULL,
        version          INT UNSIGNED NOT NULL DEFAULT 1,
        updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_security_settings_category (category),
        INDEX idx_security_settings_priority (priority)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_security_config (
        id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id        INT UNSIGNED NOT NULL,
        setting_id       VARCHAR(16) NOT NULL,
        status           ENUM('not_applied','monitored','drift','pending','poll_error','unavailable') NOT NULL DEFAULT 'not_applied',
        applied_value    JSON DEFAULT NULL,
        current_value    JSON DEFAULT NULL,
        applied_at       DATETIME DEFAULT NULL,
        applied_by       VARCHAR(255) DEFAULT NULL,
        last_checked_at  DATETIME DEFAULT NULL,
        last_check_error TEXT DEFAULT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id)  REFERENCES tenants(id)          ON DELETE CASCADE,
        FOREIGN KEY (setting_id) REFERENCES security_settings(setting_id) ON DELETE CASCADE,
        UNIQUE KEY uq_tenant_setting (tenant_id, setting_id),
        INDEX idx_tsc_status (status),
        INDEX idx_tsc_last_checked (last_checked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS security_setting_events (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id       INT UNSIGNED NOT NULL,
        setting_id      VARCHAR(16)  NOT NULL,
        event_type      ENUM('applied','matched','drift_detected','remediated','accepted','poll_ok','poll_error') NOT NULL,
        previous_value  JSON DEFAULT NULL,
        new_value       JSON DEFAULT NULL,
        operator_email  VARCHAR(255) DEFAULT NULL,
        source          ENUM('panoptica','operator','system') NOT NULL DEFAULT 'system',
        correlation_tag VARCHAR(64) DEFAULT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id)  REFERENCES tenants(id)          ON DELETE CASCADE,
        FOREIGN KEY (setting_id) REFERENCES security_settings(setting_id) ON DELETE CASCADE,
        INDEX idx_sse_tenant_setting_created (tenant_id, setting_id, created_at DESC),
        INDEX idx_sse_created (created_at),
        INDEX idx_sse_event_type (event_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    console.error('[SecuritySettings] Schema ensure failed:', e.message);
    throw e;
  }
}

/**
 * Drop rows from security_settings whose setting_id is no longer in the
 * registry. Apr 26, 2026 architectural decision: the registry is the single
 * source of truth — when a setting is removed (e.g. because another Panoptica
 * module has taken ownership), its DB row should disappear too.
 *
 * FK CASCADE on tenant_security_config + security_setting_events handles
 * dependent-row cleanup automatically.
 *
 * Safety guard: refuse to prune if SETTINGS is empty. That would wipe every
 * row, which is almost certainly a bug (e.g. registry import failed silently).
 */
async function pruneOrphans() {
  if (!Array.isArray(SETTINGS) || SETTINGS.length === 0) {
    console.warn('[SecuritySettings] Registry is empty — skipping orphan prune to avoid wiping all rows');
    return 0;
  }
  const validIds = SETTINGS.map(s => s.setting_id);
  const placeholders = validIds.map(() => '?').join(',');
  try {
    const result = await db.execute(
      `DELETE FROM security_settings WHERE setting_id NOT IN (${placeholders})`,
      validIds
    );
    const affected = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(
        `[SecuritySettings] Pruned ${affected} orphan setting(s) — FK CASCADE cleaned tenant_security_config + security_setting_events`
      );
    }
    return affected;
  } catch (e) {
    console.error('[SecuritySettings] Orphan prune failed:', e.message);
    return 0;
  }
}

async function seed() {
  try {
    await ensureSchema();
    for (const s of SETTINGS) {
      await db.execute(
        `INSERT INTO security_settings
           (setting_id, name, category, priority, poll_strategy, poll_key,
            description, security_impact, user_impact, admin_notes, licence_required, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name             = VALUES(name),
           category         = VALUES(category),
           priority         = VALUES(priority),
           poll_strategy    = VALUES(poll_strategy),
           poll_key         = VALUES(poll_key),
           description      = VALUES(description),
           security_impact  = VALUES(security_impact),
           user_impact      = VALUES(user_impact),
           admin_notes      = VALUES(admin_notes),
           licence_required = VALUES(licence_required),
           version          = VALUES(version)`,
        [
          s.setting_id, s.name, s.category, s.priority, s.poll_strategy, s.poll_key,
          s.description, s.security_impact, s.user_impact, s.admin_notes,
          s.licence_required, 1,
        ]
      );
    }
    await pruneOrphans();
    console.log(`[SecuritySettings] Seeded ${SETTINGS.length} settings into security_settings table`);
  } catch (e) {
    console.error('[SecuritySettings] Seeding failed:', e.message);
    // Do NOT throw — a failed seed should not prevent server boot. Log loudly
    // and let the operator fix the DB state. Same policy as msp-audit/ensure.
  }

  // Apr 27, 2026 — SECURITY_DRIFT alert policy. Idempotent — only inserts if
  // a row with the same name doesn't already exist. Existing tenants don't
  // get the row from seed-policies.sql (init-schema's seed only runs when
  // alert_policies is empty), so this bootstrap is the way to add new
  // policies without forcing a manual SQL migration on every deployment.
  // Severity is 'high' as the default; the actual alert severity is computed
  // per-event from setting.priority and stored on the alerts row directly.
  try {
    await ensureSecurityDriftPolicy();
  } catch (e) {
    console.error('[SecuritySettings] SECURITY_DRIFT policy bootstrap failed:', e.message);
  }
}

/**
 * Idempotent bootstrap for the SECURITY_DRIFT alert policy. Safe to call
 * multiple times. Returns the policy_id of the policy (existing or new).
 */
async function ensureSecurityDriftPolicy() {
  const POLICY_NAME = 'Security Setting Drift Detected';
  const existing = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_NAME]
  );
  if (existing) return existing.id;

  // detection_logic.threshold_type = 'imperative' tells the alert engine's
  // evaluatePolicy() switch to no-op for this policy (alerts are fired by
  // direct calls from poll.js / api-security.js, not by the scheduled
  // evaluator). Stored as JSON string per the column type.
  const id = await db.insert(
    `INSERT INTO alert_policies
      (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      POLICY_NAME,
      'A security setting under Panoptica baseline has drifted from its applied/matched value. Fired when the slow-tier poll detects current state no longer matches the captured baseline. Severity is computed per-alert from the setting\'s priority (critical→severe, high→high, etc.) and overrides the default below.',
      'config_changes',
      'high',
      'medium',
      'both',
      JSON.stringify({
        type: 'imperative',
        subtype: 'security_setting_drift',
        threshold_type: 'imperative',
        // Operator-visible explanation in the policy detail panel
        notes: 'Fired imperatively by src/lib/security-settings/poll.js when drift is detected. Auto-resolves when the operator clicks Accept Drift, Remediate, or when the value transitions back to monitored without operator action.',
      }),
    ]
  );
  console.log(`[SecuritySettings] Created SECURITY_DRIFT alert policy id=${id}`);
  return id;
}

module.exports = { seed, ensureSchema, pruneOrphans, ensureSecurityDriftPolicy };
