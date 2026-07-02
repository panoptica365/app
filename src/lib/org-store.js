/**
 * Panoptica365 — Organization store (Tenant Groups & tenant attributes)
 *
 * Phase 1 of the Tenant Groups & Configuration Bundles feature
 * (build instructions 2026-07-01, §1). Owns:
 *
 *   - Schema for the two managed lookup lists (service_tiers, sales_reps),
 *     the tenant_groups / tenant_group_members tables, and the two nullable
 *     FK columns added to `tenants` (service_tier_id, sales_rep_id).
 *   - resolveGroupMembers() — THE single source of truth for group
 *     membership everywhere (badge counts, Heatmap/Trends filters, and the
 *     Phase 3 deploy target expansion). Do not duplicate this logic.
 *
 * Lives in lib/ (not the route module) because three consumers need it:
 * api-org.js (CRUD), api-heatmap.js / api-global-trends.js (group filter),
 * and later the Phase 3 deploy engine.
 *
 * Migration style: eager, idempotent, fired at module load — same pattern as
 * api-ca.js / api-intune.js. All FK columns referencing tenants.id are
 * INT UNSIGNED (signedness mismatch silently breaks FKs on MySQL 8).
 */

'use strict';

const db = require('../db/database');

// ─────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────

async function columnExists(table, column) {
  const rows = await db.queryRows(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function ensureOrgSchema() {
  // ── Managed lookup lists ──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS service_tiers (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_service_tier_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sales_reps (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(150) NOT NULL,
      active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sales_rep_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Tenant groups ──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tenant_groups (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(150) NOT NULL,
      description TEXT NULL,
      group_type  ENUM('manual','dynamic') NOT NULL DEFAULT 'manual',
      rule_service_tier_id INT UNSIGNED NULL,
      rule_sales_rep_id    INT UNSIGNED NULL,
      rule_match           ENUM('all','any') NOT NULL DEFAULT 'all',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tenant_group_name (name),
      FOREIGN KEY (rule_service_tier_id) REFERENCES service_tiers(id) ON DELETE SET NULL,
      FOREIGN KEY (rule_sales_rep_id)    REFERENCES sales_reps(id)    ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tenant_group_members (
      group_id  INT UNSIGNED NOT NULL,
      tenant_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, tenant_id),
      FOREIGN KEY (group_id)  REFERENCES tenant_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)       ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── Nullable attribute FKs on tenants ──
  // Column and constraint added separately (constraint failure must not
  // strand the column add), each behind its own INFORMATION_SCHEMA probe so
  // a boot that failed halfway self-heals on the next boot. The ALTERs on
  // `tenants` use the deadlock-retry helper: several route modules run
  // guarded ALTERs on `tenants` at module load, and concurrent DDL on the
  // same table has deadlocked at first boot before (see api-tenants.js).
  const attrCols = [
    { col: 'service_tier_id', fk: 'fk_tenants_service_tier', ref: 'service_tiers' },
    { col: 'sales_rep_id',    fk: 'fk_tenants_sales_rep',    ref: 'sales_reps' },
  ];
  for (const { col, fk, ref } of attrCols) {
    if (!(await columnExists('tenants', col))) {
      await db.executeWithDeadlockRetry(`ALTER TABLE tenants ADD COLUMN ${col} INT UNSIGNED NULL DEFAULT NULL`);
      console.log(`[Org] Added tenants.${col} column`);
    }
    const fkRow = await db.queryOne(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
          AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?`,
      [fk]
    );
    if (!fkRow) {
      try {
        await db.executeWithDeadlockRetry(
          `ALTER TABLE tenants ADD CONSTRAINT ${fk} FOREIGN KEY (${col}) REFERENCES ${ref}(id) ON DELETE SET NULL`
        );
        console.log(`[Org] Added tenants.${col} FK (${fk})`);
      } catch (fkErr) {
        // Fail loud — a missing FK means orphaned ids could accumulate.
        // Non-fatal so the feature still works; retried on next boot.
        console.error(`[Org] tenants.${col} FK constraint failed (will retry next boot):`, fkErr.message);
      }
    }
  }
}

// Fired eagerly at module load. The promise itself NEVER rejects (a rejected
// module-level promise with no awaiter yet would trip the process-level
// unhandledRejection handler at boot); failure is captured and re-thrown by
// whenReady() so every consumer still fails loud per-request.
let schemaError = null;
const schemaReady = ensureOrgSchema()
  .then(() => { console.log('[Org] Schema ready (tenant groups + lookup lists)'); })
  .catch(err => {
    schemaError = err;
    console.error('[Org] Schema migration failed:', err.message);
  });

/** Await the migration; throws (per-request, catchable) if it failed. */
async function whenReady() {
  await schemaReady;
  if (schemaError) {
    throw new Error(`Organization schema migration failed: ${schemaError.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Membership resolution — single source of truth
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the tenant ids matched by a dynamic rule. Shared by
 * resolveGroupMembers and the "live preview count" endpoint so the preview
 * can never disagree with the real membership.
 *
 * A rule with neither dimension set matches NOTHING (fail safe) — the API
 * refuses to persist such a rule, but a hard-deleted tier/rep can null a
 * rule column via ON DELETE SET NULL, and "matches nothing" is the safe
 * degradation for a rule that lost its last dimension.
 *
 * @returns {Promise<number[]>} tenant ids (tenants.id)
 */
async function resolveDynamicRule(ruleServiceTierId, ruleSalesRepId, ruleMatch) {
  const conds = [];
  const params = [];
  const tierId = ruleServiceTierId == null ? null : Number(ruleServiceTierId);
  const repId = ruleSalesRepId == null ? null : Number(ruleSalesRepId);
  if (tierId != null) {
    if (!Number.isInteger(tierId) || tierId <= 0) throw new Error(`resolveDynamicRule: invalid service tier id "${ruleServiceTierId}"`);
    conds.push('service_tier_id = ?');
    params.push(tierId);
  }
  if (repId != null) {
    if (!Number.isInteger(repId) || repId <= 0) throw new Error(`resolveDynamicRule: invalid sales rep id "${ruleSalesRepId}"`);
    conds.push('sales_rep_id = ?');
    params.push(repId);
  }
  if (conds.length === 0) return [];
  const joiner = ruleMatch === 'any' ? ' OR ' : ' AND ';
  const rows = await db.queryRows(`SELECT id FROM tenants WHERE ${conds.join(joiner)}`, params);
  return rows.map(r => r.id);
}

/**
 * Resolve a group's member tenant ids.
 *   Manual  → rows from tenant_group_members.
 *   Dynamic → computed live from the rule over service_tier_id / sales_rep_id.
 *
 * Membership is intentionally NOT filtered by enabled/mode here — each
 * surface applies its own constraints (Heatmap/Trends intersect with their
 * managed census; Phase 3 preflight blocks unusable tenants explicitly).
 *
 * @param {number} groupId
 * @returns {Promise<number[]|null>} tenant ids, or null when the group does not exist
 */
async function resolveGroupMembers(groupId) {
  await whenReady();
  const gid = Number(groupId);
  if (!Number.isInteger(gid) || gid <= 0) {
    throw new Error(`resolveGroupMembers: invalid group id "${groupId}"`);
  }
  const group = await db.queryOne(
    'SELECT id, group_type, rule_service_tier_id, rule_sales_rep_id, rule_match FROM tenant_groups WHERE id = ?',
    [gid]
  );
  if (!group) return null;
  if (group.group_type === 'dynamic') {
    return resolveDynamicRule(group.rule_service_tier_id, group.rule_sales_rep_id, group.rule_match);
  }
  const rows = await db.queryRows(
    'SELECT tenant_id FROM tenant_group_members WHERE group_id = ?',
    [gid]
  );
  return rows.map(r => r.tenant_id);
}

module.exports = {
  schemaReady,
  whenReady,
  ensureOrgSchema,
  resolveGroupMembers,
  resolveDynamicRule,
};
