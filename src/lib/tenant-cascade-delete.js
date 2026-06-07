/**
 * Panoptica365 — Tenant Cascade Delete
 *
 * Single source of truth for "remove this tenant and ALL its data" — used by
 * both:
 *   1. Audit-only auto-expiry (nightly job, after grace period)
 *   2. Managed-tenant manual deletion (when an MSP loses a customer)
 *
 * Why an explicit table list instead of FK ON DELETE CASCADE:
 *   - Many of these tables were created over time by ALTER TABLE without FKs.
 *   - Explicit list is auditable in code review and survives schema drift.
 *   - Returns per-table row counts so the operator can see what was removed.
 *
 * Inventory generated 2026-04-28 by scanning every SQL string in src/ that
 * filters on tenant_id. Re-validate when adding a new tenant-scoped table:
 *
 *   grep -rE "tenant_id" src --include="*.js" | grep -E "(FROM|INTO|UPDATE)"
 *
 * Tables that touch tenants but are NOT cascade-deleted (intentional):
 *   - ca_templates       : MSP-wide template definitions
 *   - intune_templates   : MSP-wide template definitions
 *   - users              : MSP operators
 *   - operator_mute_periods : MSP operator preferences
 *   - morning_briefings  : MSP-wide AI digests (no tenant_id)
 *   - drift_scheduler_runs : scheduler health (no tenant_id)
 *   - sessions           : express-mysql-session operator sessions
 *   - alert_policies     : GLOBAL rule catalog — no tenant_id column. Was
 *                          incorrectly listed here in the Apr 28 inventory
 *                          (an assumed per-tenant-override feature that
 *                          never existed); removed 2026-05-21 after the
 *                          first real cascade hit ER_BAD_FIELD_ERROR and
 *                          dumped it into the customer-facing summary email.
 */

const db = require('../db/database');
const tenantMode = require('./tenant-mode');

/**
 * Tables holding tenant-scoped rows. ORDER MATTERS — children before parents
 * to satisfy any FK constraints. The `tenants` row itself is deleted last.
 *
 * Each entry: { table, column, note }
 *   - table  : table name
 *   - column : column that holds the tenant_id (almost always 'tenant_id')
 *   - note   : human-readable description (shown in delete result for audit log)
 */
const TENANT_SCOPED_TABLES = [
  // Per-event / detail tables that may FK into tenant_change_events. Delete first.
  { table: 'tenant_change_event_edits', column: 'event_id',
    via: 'tenant_change_events',
    note: 'Edit history of tenant change events (FK via event_id)' },

  // Snapshot / activity tables
  { table: 'daily_event_details',     column: 'tenant_id', note: 'Per-day per-event detail rows' },
  { table: 'daily_event_summaries',   column: 'tenant_id', note: 'Per-day rolled-up event summaries' },
  { table: 'daily_event_counts',      column: 'tenant_id', note: 'Per-day event counts (deduped)' },

  // Alerts and policy assignments. NOTE: alert_policies is intentionally NOT
  // listed — it's the global rule catalog (no tenant_id column), see the
  // header comment.
  { table: 'alerts_suppressed',       column: 'tenant_id', note: 'Suppressed alert ids' },
  { table: 'alerts',                  column: 'tenant_id', note: 'Drift / posture alerts' },
  // PSA ticket links (Feature 8.3). Direct tenant_id column; msp-scope rows
  // (tenant_id NULL) belong to no tenant and are intentionally not matched by
  // a tenant delete. Deleted alongside alerts — the linked tickets in Autotask
  // are the tech's work record and are NOT touched on tenant removal.
  { table: 'psa_tickets',             column: 'tenant_id', note: 'Autotask ticket links for this tenant' },

  // CA exemptions + drift log link to tenants via ca_assignments.id, NOT
  // directly via tenant_id. Delete via the parent table — order matters
  // (children first, parent last).
  { table: 'ca_drift_log',            column: 'assignment_id',
    via: 'ca_assignments',
    note: 'Conditional Access drift history (FK via assignment_id)' },
  { table: 'ca_exemptions',           column: 'assignment_id',
    via: 'ca_assignments',
    note: 'Conditional Access exemption rules (FK via assignment_id)' },
  { table: 'ca_assignments',          column: 'tenant_id', note: 'Conditional Access policy → tenant assignments' },

  // Intune
  { table: 'intune_deployments',      column: 'tenant_id', note: 'Intune template → tenant deployments' },

  // Security settings — per-tenant state lives in tenant_security_config,
  // NOT in security_settings (which is the global catalog with no tenant_id).
  { table: 'security_setting_events', column: 'tenant_id', note: 'Per-setting event log' },
  { table: 'tenant_security_config',  column: 'tenant_id', note: 'Per-tenant security setting state (status, applied/current values)' },

  // SharePoint audit
  { table: 'sp_audits',               column: 'tenant_id', note: 'SharePoint permission audits' },

  // Misc snapshots
  { table: 'metric_snapshots',        column: 'tenant_id', note: 'Secure score history + other metric snapshots' },
  { table: 'api_health',              column: 'tenant_id', note: 'Per-tenant API health pings' },
  { table: 'chat_sessions',           column: 'tenant_id', note: 'Ask-Claude chat history' },

  // Audit / change journals (deleted late so they retain context for as long
  // as possible). msp_audit_events has NO tenant_id column — tenant linkage
  // is via (target_type='tenant', target_id=<tenant_id>). Handled as a
  // special case below.
  { table: 'msp_audit_events',        column: '__msp_audit_special__',
    note: 'MSP operator action audit log (linked via target_type/target_id)' },
  { table: 'tenant_change_events',    column: 'tenant_id', note: 'Per-tenant operator change log' },

  // Finally, the tenants row itself
  { table: 'tenants',                 column: 'id',        note: 'The tenant row itself' },
];

/**
 * Cascade-delete all data for a tenant.
 *
 * @param {number} tenantId  Internal numeric id (tenants.id), NOT the M365 GUID
 * @param {object} opts
 *   - dryRun {bool}  : if true, only counts rows that WOULD be deleted, no DELETEs
 *   - reason {string}: human reason ("audit_expired" | "operator_requested" | etc.)
 * @returns {object} { tenantId, dryRun, reason, totalRowsDeleted, perTable: [...], errors: [] }
 */
async function cascadeDeleteTenant(tenantId, opts = {}) {
  const { dryRun = false, reason = 'unspecified' } = opts;
  const id = parseInt(tenantId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`cascadeDeleteTenant: invalid tenantId "${tenantId}"`);
  }

  // Snapshot identity for return value (we lose this once tenants row is gone)
  const tenantRow = await db.queryOne(
    'SELECT id, tenant_id, display_name, mode FROM tenants WHERE id = ? LIMIT 1',
    [id]
  );
  if (!tenantRow) {
    return {
      tenantId: id, dryRun, reason,
      tenantNotFound: true,
      totalRowsDeleted: 0, perTable: [], errors: [],
    };
  }

  const result = {
    tenantId: id,
    tenantGuid: tenantRow.tenant_id,
    tenantName: tenantRow.display_name,
    tenantMode: tenantRow.mode,
    dryRun,
    reason,
    startedAt: new Date().toISOString(),
    totalRowsDeleted: 0,
    perTable: [],
    errors: [],
  };

  for (const entry of TENANT_SCOPED_TABLES) {
    try {
      let count = 0;
      if (entry.column === '__msp_audit_special__') {
        // msp_audit_events: tenant linkage via (target_type='tenant', target_id=<id>)
        // — there is no tenant_id column on this table.
        const sql = dryRun
          ? `SELECT COUNT(*) AS n FROM msp_audit_events
             WHERE target_type = 'tenant' AND target_id = ?`
          : `DELETE FROM msp_audit_events
             WHERE target_type = 'tenant' AND target_id = ?`;
        if (dryRun) {
          const row = await db.queryOne(sql, [String(id)]);
          count = row ? row.n : 0;
        } else {
          const [r] = await db.query(sql, [String(id)]);
          count = r.affectedRows || 0;
        }
      } else if (entry.via) {
        // Child rows linked through a parent table (e.g. ca_drift_log via
        // ca_assignments.id, ca_exemptions via ca_assignments.id,
        // tenant_change_event_edits via tenant_change_events.id).
        const sql = dryRun
          ? `SELECT COUNT(*) AS n FROM ${entry.table} c
             WHERE c.${entry.column} IN (SELECT id FROM ${entry.via} WHERE tenant_id = ?)`
          : `DELETE c FROM ${entry.table} c
             WHERE c.${entry.column} IN (SELECT id FROM ${entry.via} WHERE tenant_id = ?)`;
        if (dryRun) {
          const row = await db.queryOne(sql, [id]);
          count = row ? row.n : 0;
        } else {
          const [r] = await db.query(sql, [id]);
          count = r.affectedRows || 0;
        }
      } else {
        const sql = dryRun
          ? `SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${entry.column} = ?`
          : `DELETE FROM ${entry.table} WHERE ${entry.column} = ?`;
        if (dryRun) {
          const row = await db.queryOne(sql, [id]);
          count = row ? row.n : 0;
        } else {
          const [r] = await db.query(sql, [id]);
          count = r.affectedRows || 0;
        }
      }
      result.perTable.push({ table: entry.table, rowsAffected: count, note: entry.note });
      result.totalRowsDeleted += count;
    } catch (e) {
      // Don't abort — keep going so the operator sees the FULL picture of what
      // succeeded and what didn't. Cascade-delete failures are usually
      // missing-table errors (e.g., feature not deployed yet) which are safe
      // to ignore for the audit-only flow.
      result.errors.push({
        table: entry.table,
        message: e.message,
        code: e.code || null,
      });
      result.perTable.push({ table: entry.table, rowsAffected: 0, note: entry.note, error: e.message });
    }
  }

  // Bust the mode cache for this tenant (no-op if already gone but cheap)
  tenantMode.invalidateCache(id);

  result.completedAt = new Date().toISOString();
  return result;
}

module.exports = {
  TENANT_SCOPED_TABLES,
  cascadeDeleteTenant,
};
