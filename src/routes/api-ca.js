/**
 * Panoptica — Conditional Access Policy Management API
 * Template CRUD, tenant assignments, drift detection, remediation.
 */

const express = require('express');
const crypto = require('crypto');
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const notifier = require('../notifier');
const groupResolver = require('../lib/group-resolver');
const changeLog = require('../change-log');
const mspAudit = require('../msp-audit');
const caClassifier = require('../lib/ca-policy-classifier');

const router = express.Router();
router.use(auth.requireAuth);

// ═══════════════════════════════════════════
// AUTO-MIGRATION (CA alert integration)
// ═══════════════════════════════════════════

let caDriftPolicyId = null;      // "CA Policy Drift Detected" alert_policies.id
let caRemediatedPolicyId = null;  // "CA Policy Drift Remediated" alert_policies.id
let caExemptionChangePolicyId = null; // "CA Exemption List Changed" alert_policies.id (INFO)

async function ensureCaAlertSchema() {
  // May 20, 2026 — ensure CA tables exist before attempting ALTERs.
  // Historical context: the CA table definitions live in schema-ca.sql at
  // the project root, NOT in src/db/schema.sql (which is what init-schema.js
  // loads at container boot). On the production VM, the tables exist
  // because schema-ca.sql was applied manually during Phase 5. On fresh DBs
  // (container deployments, test VMs), the tables don't exist and every
  // ALTER below errors with "Table 'panoptica.ca_X' doesn't exist" — non-fatal
  // but noisy in logs, and CA features silently don't work. Fix: inline
  // CREATE TABLE IF NOT EXISTS for the 5 CA-related tables here. Schema is
  // duplicated with schema-ca.sql + migrate-ca-exemptions.sql for now —
  // proper cleanup is to consolidate all schema into src/db/schema.sql, but
  // that's a bigger refactor.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ca_templates (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        description     TEXT,
        policy_json     JSON NOT NULL,
        state           VARCHAR(32) DEFAULT 'enabled',
        grant_controls  VARCHAR(512),
        target_users    VARCHAR(512),
        target_apps     VARCHAR(512),
        conditions_summary VARCHAR(512),
        monitored_fields JSON,
        -- Added by the Apr 20 classifier refactor. There was no in-code
        -- migration adding this column (it was applied manually on the
        -- original production VM), so a fresh-DB CREATE without it would
        -- break the later source_tenant_id migration's AFTER clause.
        control_dimensions JSON DEFAULT NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Idempotent backfill for ca_templates rows that were created by the
    // previous v0.1.1 fix (which didn't include control_dimensions in the
    // CREATE TABLE). If the column is missing, add it. No-op on production
    // VMs + on freshly-created v0.1.2+ tables.
    try {
      const cdCol = await db.queryRows(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_templates' AND COLUMN_NAME = 'control_dimensions'"
      );
      if (cdCol.length === 0) {
        await db.execute("ALTER TABLE ca_templates ADD COLUMN control_dimensions JSON DEFAULT NULL AFTER monitored_fields");
        console.log('[CA] Added control_dimensions column to ca_templates (Apr 20 classifier refactor backfill)');
      }
    } catch (e) { /* fresh table will already have it via the CREATE above */ }

    // May 20, 2026 — ca_drift_log.drift_type ENUM expansion.
    // Phase 11 (Apr 18, 2026) added 4 new drift_type values for the
    // exemption + accept-drift system: drift_accepted, exemption_granted,
    // exemption_revoked, exemption_expired. The ALTER lives in
    // src/db/migrate-ca-exemptions.sql, which was applied manually on
    // production VM but never carried into code. api-ca.js code inserts
    // these new values with a `catch (_e) { /* ENUM may not yet include */ }`
    // suppression — which means on fresh-DB deployments the drift logging
    // silently fails. Fix: expand the ENUM at boot. Idempotent — check
    // COLUMN_TYPE first, MODIFY only if missing any of the new values.
    try {
      const dtCol = await db.queryOne(
        "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_drift_log' AND COLUMN_NAME = 'drift_type'"
      );
      if (dtCol && !dtCol.COLUMN_TYPE.includes("'exemption_granted'")) {
        await db.execute(`
          ALTER TABLE ca_drift_log MODIFY COLUMN drift_type ENUM(
            'field_changed',
            'policy_disabled',
            'policy_missing',
            'policy_deleted',
            'remediated',
            'drift_accepted',
            'exemption_granted',
            'exemption_revoked',
            'exemption_expired'
          ) NOT NULL
        `);
        console.log('[CA] Expanded ca_drift_log.drift_type ENUM with Phase 11 values (drift_accepted, exemption_*)');
      }
    } catch (e) { console.warn('[CA] ca_drift_log.drift_type ENUM expansion (non-fatal):', e.message); }
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ca_assignments (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        template_id     INT UNSIGNED NOT NULL,
        tenant_id       INT UNSIGNED NOT NULL,
        enforcement     ENUM('monitor', 'remediate') DEFAULT 'monitor',
        live_policy_id  VARCHAR(128),
        drift_status    ENUM('ok', 'drifted', 'missing', 'unchecked') DEFAULT 'unchecked',
        drift_details   JSON,
        last_checked_at DATETIME,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES ca_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE KEY uq_template_tenant (template_id, tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ca_drift_log (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        assignment_id   INT UNSIGNED NOT NULL,
        drift_type      ENUM('field_changed', 'policy_disabled', 'policy_missing', 'policy_deleted', 'remediated') NOT NULL,
        field_path      VARCHAR(255),
        expected_value  TEXT,
        actual_value    TEXT,
        remediated      BOOLEAN DEFAULT FALSE,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assignment_id) REFERENCES ca_assignments(id) ON DELETE CASCADE,
        INDEX idx_assignment_created (assignment_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ca_exemptions (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        assignment_id     INT UNSIGNED NOT NULL,
        principal_type    ENUM('user', 'group') NOT NULL,
        principal_id      VARCHAR(128) NOT NULL,
        principal_label   VARCHAR(512),
        reason            TEXT,
        expires_at        DATETIME NOT NULL,
        accepted_by       VARCHAR(255) NOT NULL,
        accepted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at        DATETIME,
        revoked_by        VARCHAR(255),
        revoke_reason     VARCHAR(64),
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (assignment_id) REFERENCES ca_assignments(id) ON DELETE CASCADE,
        INDEX idx_assignment_active (assignment_id, revoked_at, expires_at),
        INDEX idx_expiry (expires_at, revoked_at),
        UNIQUE KEY uq_active_principal (assignment_id, principal_type, principal_id, revoked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS alerts_suppressed (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id         INT UNSIGNED NOT NULL,
        policy_id         INT UNSIGNED NOT NULL,
        evaluator         VARCHAR(64) NOT NULL,
        upn               VARCHAR(255),
        exemption_id      INT UNSIGNED NOT NULL,
        assignment_id     INT UNSIGNED NOT NULL,
        control_dimension VARCHAR(64) NOT NULL,
        event_snippet     VARCHAR(512),
        suppressed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (exemption_id) REFERENCES ca_exemptions(id) ON DELETE CASCADE,
        INDEX idx_tenant_time (tenant_id, suppressed_at),
        INDEX idx_policy_time (policy_id, suppressed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // Non-fatal — log and continue. CREATE TABLE IF NOT EXISTS is a no-op
    // on production VMs where tables already exist; any error here is a real
    // DB connectivity issue (which the boot will surface elsewhere anyway).
    console.error('[CA] CREATE TABLE IF NOT EXISTS for CA tables failed (non-fatal):', e.message);
  }

  // Add alert_routing to ca_templates
  try {
    const cols = await db.queryRows(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_templates' AND COLUMN_NAME = 'alert_routing'"
    );
    if (cols.length === 0) {
      await db.execute("ALTER TABLE ca_templates ADD COLUMN alert_routing ENUM('support', 'personal', 'both', 'none') NOT NULL DEFAULT 'both' AFTER monitored_fields");
      console.log('[CA] Added alert_routing column to ca_templates');
    }
  } catch (e) { /* column may already exist */ }

  // Phase-A named-location generalization: capture the tenant a template was
  // imported from so substituteLocationGUIDs() can translate raw named-location
  // GUIDs into __PANOPTICA_LOCATION_<ISO>__ placeholders at import time. NULL
  // means "unknown source" (legacy templates, or imports where the operator
  // didn't pick a source tenant because the policy had no location GUIDs).
  // FK is ON DELETE SET NULL so deleting a source tenant does not cascade
  // into the template library.
  try {
    const cols = await db.queryRows(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_templates' AND COLUMN_NAME = 'source_tenant_id'"
    );
    if (cols.length === 0) {
      await db.execute("ALTER TABLE ca_templates ADD COLUMN source_tenant_id INT UNSIGNED NULL DEFAULT NULL AFTER control_dimensions");
      // Add FK separately — MySQL allows ADD CONSTRAINT on an existing column
      // and it's safer if the column-add succeeds but the constraint step
      // fails (e.g. due to orphaned data from a prior partial migration).
      try {
        await db.execute("ALTER TABLE ca_templates ADD CONSTRAINT fk_ca_templates_source_tenant FOREIGN KEY (source_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL");
      } catch (fkErr) {
        console.warn('[CA] source_tenant_id FK constraint (non-fatal):', fkErr.message);
      }
      console.log('[CA] Added source_tenant_id column to ca_templates');
    }
  } catch (e) { console.warn('[CA] source_tenant_id migration (non-fatal):', e.message); }

  // Add alert_routing to ca_assignments
  try {
    const cols = await db.queryRows(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_assignments' AND COLUMN_NAME = 'alert_routing'"
    );
    if (cols.length === 0) {
      await db.execute("ALTER TABLE ca_assignments ADD COLUMN alert_routing ENUM('support', 'personal', 'both', 'none') DEFAULT NULL AFTER enforcement");
      console.log('[CA] Added alert_routing column to ca_assignments');
    }
  } catch (e) { /* column may already exist */ }

  // Phase 10: Add acknowledged-drift columns to ca_assignments (mirrors Intune Phase 9)
  const ackCols = [
    { name: 'acknowledged_drift_hash',    def: "VARCHAR(64)  DEFAULT NULL AFTER alert_routing" },
    { name: 'acknowledged_drift_payload', def: "JSON         DEFAULT NULL AFTER acknowledged_drift_hash" },
    { name: 'acknowledged_at',            def: "DATETIME     DEFAULT NULL AFTER acknowledged_drift_payload" },
    { name: 'acknowledged_by',            def: "VARCHAR(255) DEFAULT NULL AFTER acknowledged_at" },
  ];
  for (const col of ackCols) {
    try {
      const exists = await db.queryOne(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_assignments' AND COLUMN_NAME = ?",
        [col.name]
      );
      if (!exists) {
        await db.execute(`ALTER TABLE ca_assignments ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[CA] Added column ${col.name} to ca_assignments`);
      }
    } catch (e) { console.warn(`[CA] Migration ${col.name} (non-fatal):`, e.message); }
  }

  // Phase 10: Add 'accepted' to drift_status ENUM on ca_assignments
  try {
    const col = await db.queryOne(
      "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_assignments' AND COLUMN_NAME = 'drift_status'"
    );
    if (col && col.COLUMN_TYPE && !col.COLUMN_TYPE.includes("'accepted'")) {
      await db.execute(
        "ALTER TABLE ca_assignments MODIFY COLUMN drift_status ENUM('ok','drifted','accepted','missing','unchecked') NOT NULL DEFAULT 'unchecked'"
      );
      console.log('[CA] Phase 10 migration: added accepted to drift_status enum');
    }
  } catch (e) { console.warn('[CA] Phase 10 drift_status enum upgrade (non-fatal):', e.message); }

  // Backfill conditions.users.excludeUsers / excludeGroups into monitored_fields.
  // The in-code defaults at template-import time (defaultMonitored in POST
  // /api/ca/templates) have included these since 2026-04-18, but pre-existing
  // templates — and any import that explicitly overrode monitored_fields —
  // can still be missing them. Without these paths in monitored_fields the
  // drift comparator silently never compares the exclusion lists, so an
  // operator adding/removing an excluded user produces no drift alert at all.
  // This backfill was previously only in src/db/migrate-ca-exemptions.sql,
  // which was applied manually on the original prod VM and never carried into
  // code — meaning fresh installs and post-Apr-18 imports could land in the
  // broken state. Mirrors the SQL exactly. Idempotent via JSON_CONTAINS guard.
  try {
    // (a) Seed defaults for any template missing monitored_fields entirely.
    await db.execute(
      "UPDATE ca_templates SET monitored_fields = JSON_ARRAY('state', 'grantControls.builtInControls') WHERE monitored_fields IS NULL"
    );
    // (b) Append excludeUsers if missing.
    const beforeExclUsers = await db.queryOne(
      "SELECT COUNT(*) AS n FROM ca_templates WHERE JSON_CONTAINS(monitored_fields, '\"conditions.users.excludeUsers\"') = 0"
    );
    if (beforeExclUsers && beforeExclUsers.n > 0) {
      await db.execute(
        "UPDATE ca_templates SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeUsers') WHERE JSON_CONTAINS(monitored_fields, '\"conditions.users.excludeUsers\"') = 0"
      );
      console.log(`[CA] Backfilled conditions.users.excludeUsers into monitored_fields on ${beforeExclUsers.n} template(s)`);
    }
    // (c) Append excludeGroups if missing.
    const beforeExclGroups = await db.queryOne(
      "SELECT COUNT(*) AS n FROM ca_templates WHERE JSON_CONTAINS(monitored_fields, '\"conditions.users.excludeGroups\"') = 0"
    );
    if (beforeExclGroups && beforeExclGroups.n > 0) {
      await db.execute(
        "UPDATE ca_templates SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeGroups') WHERE JSON_CONTAINS(monitored_fields, '\"conditions.users.excludeGroups\"') = 0"
      );
      console.log(`[CA] Backfilled conditions.users.excludeGroups into monitored_fields on ${beforeExclGroups.n} template(s)`);
    }
  } catch (e) { console.warn('[CA] monitored_fields backfill for exclusion fields (non-fatal):', e.message); }

  // Ensure system alert policies exist for CA drift
  const driftPolicy = await db.queryOne(
    "SELECT id FROM alert_policies WHERE name = 'CA Policy Drift Detected' LIMIT 1"
  );
  if (!driftPolicy) {
    caDriftPolicyId = await db.insert(
      `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
       VALUES ('CA Policy Drift Detected', 'A conditional access policy has drifted from its expected template configuration.', 'config_changes', 'high', '{"type":"ca_drift","subtype":"detected"}', 'medium', TRUE, 'both')`
    );
    console.log('[CA] Created alert policy: CA Policy Drift Detected');
  } else {
    caDriftPolicyId = driftPolicy.id;
  }

  const remPolicy = await db.queryOne(
    "SELECT id FROM alert_policies WHERE name = 'CA Policy Drift Remediated' LIMIT 1"
  );
  if (!remPolicy) {
    caRemediatedPolicyId = await db.insert(
      `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
       VALUES ('CA Policy Drift Remediated', 'A drifted conditional access policy was automatically remediated back to template.', 'config_changes', 'medium', '{"type":"ca_drift","subtype":"remediated"}', 'medium', TRUE, 'both')`
    );
    console.log('[CA] Created alert policy: CA Policy Drift Remediated');
  } else {
    caRemediatedPolicyId = remPolicy.id;
  }

  // INFO-severity policy for the subset of drifts that only change the
  // exemption lists (excludeUsers/excludeGroups). These are operator-driven
  // exemption events, not security-relevant policy changes, so they should
  // not fire at the same urgency as a real drift.
  const exempChangePolicy = await db.queryOne(
    "SELECT id FROM alert_policies WHERE name = 'CA Exemption List Changed' LIMIT 1"
  );
  if (!exempChangePolicy) {
    caExemptionChangePolicyId = await db.insert(
      `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
       VALUES ('CA Exemption List Changed', 'A CA policy exemption list (excludeUsers/excludeGroups) was modified outside Panoptica. Informational — no security impact unless paired with other policy drift.', 'config_changes', 'info', '{"type":"ca_drift","subtype":"exemption_change"}', 'medium', TRUE, 'support')`
    );
    console.log('[CA] Created alert policy: CA Exemption List Changed');
  } else {
    caExemptionChangePolicyId = exempChangePolicy.id;
  }

  // ─── Removed 2026-04-20: legacy Phase-10 GUID-to-placeholder auto-migration ───
  // The original block replaced any raw named-location GUID in ca_templates with
  // __PANOPTICA_CANADA_LOCATION__ — i.e. it assumed every foreign GUID was
  // Canada. Architecturally broken once the placeholder system went generic
  // (__PANOPTICA_LOCATION_<ISO>[_<ISO>...]__) and once the MSP can be anywhere.
  //
  // Correct substitute: at template-import time, use the source tenant's
  // named-location map (src/lib/named-location-resolver.js) to derive the
  // country codes that a GUID represents, then write the matching placeholder.
  // Existing ca_templates with raw GUIDs remain functional for their original
  // tenant; they become invalid only when assigned to a new tenant, at which
  // point resolveHardcodedLocationGUIDs attempts a best-effort displayName
  // match (Strategy 2 below). Templates authored post-refactor skip this
  // entirely because they ship with placeholders.
}

// Run migration on module load. Keep the promise so the boot-time starter-
// template seeder (src/db/seed-templates.js) can await it via router.schemaReady
// — guaranteeing ca_templates and its late-added columns (control_dimensions,
// source_tenant_id) exist before it INSERTs. Mirrors api-intune.js.
const caSchemaReady = ensureCaAlertSchema().catch(err =>
  console.error('[CA] Alert schema migration failed:', err.message)
);

// Field paths considered "exemption list" fields. When *all* drifts on an
// assignment are in this set, the drift is re-categorized as an exemption-list
// change (INFO severity, "CA exemption list changed" title) rather than a
// generic policy drift (HIGH severity). Mixed drifts — where exclusion
// fields drift *alongside* other policy fields — stay at HIGH, because a real
// policy change is present and the security signal must not be downgraded.
const EXEMPTION_FIELD_PATHS = new Set([
  'conditions.users.excludeUsers',
  'conditions.users.excludeGroups',
]);

/**
 * Classify a drift payload. Returns 'exemption-only' when every drift entry's
 * field path is in EXEMPTION_FIELD_PATHS; otherwise 'other'.
 */
function categorizeDrift(drifts) {
  if (!Array.isArray(drifts) || drifts.length === 0) return 'other';
  return drifts.every(d => EXEMPTION_FIELD_PATHS.has(d.field)) ? 'exemption-only' : 'other';
}

/**
 * Diff an expected vs actual array of GUIDs/UPNs. Returns added + removed
 * counts. Safely handles missing/null/non-array values.
 */
function diffPrincipalList(expected, actual) {
  const exp = new Set(Array.isArray(expected) ? expected.filter(Boolean) : []);
  const act = new Set(Array.isArray(actual) ? actual.filter(Boolean) : []);
  let added = 0, removed = 0;
  for (const v of act) if (!exp.has(v)) added++;
  for (const v of exp) if (!act.has(v)) removed++;
  return { added, removed };
}

/**
 * Summarize exemption-list drift changes across all drift entries. Returns
 * totals per principal type plus a human-readable label.
 */
function summarizeExemptionDiff(drifts) {
  let userAdded = 0, userRemoved = 0, groupAdded = 0, groupRemoved = 0;
  for (const d of drifts) {
    const diff = diffPrincipalList(d.expected, d.actual);
    if (d.field === 'conditions.users.excludeUsers') {
      userAdded += diff.added;
      userRemoved += diff.removed;
    } else if (d.field === 'conditions.users.excludeGroups') {
      groupAdded += diff.added;
      groupRemoved += diff.removed;
    }
  }
  const parts = [];
  if (userAdded)    parts.push(`+${userAdded} user${userAdded === 1 ? '' : 's'}`);
  if (userRemoved)  parts.push(`-${userRemoved} user${userRemoved === 1 ? '' : 's'}`);
  if (groupAdded)   parts.push(`+${groupAdded} group${groupAdded === 1 ? '' : 's'}`);
  if (groupRemoved) parts.push(`-${groupRemoved} group${groupRemoved === 1 ? '' : 's'}`);
  return {
    userAdded, userRemoved, groupAdded, groupRemoved,
    totalAdded: userAdded + groupAdded,
    totalRemoved: userRemoved + groupRemoved,
    label: parts.length ? parts.join(', ') : 'no net change',
  };
}

/**
 * Create a drift alert in the alerts table and send notification.
 * Uses the assignment's alert_routing (or falls back to template default).
 *
 * Categorization:
 *   - exemption-only drift (all fields in EXEMPTION_FIELD_PATHS) → INFO
 *     severity, "CA exemption list changed" title, routes via the
 *     exemption-change policy so it can be silenced independently.
 *   - any other drift (including mixed exemption + other fields) → HIGH
 *     severity, "CA policy drift detected" title, routes via the main
 *     drift policy (unchanged behavior).
 */
async function createDriftAlert(assignment, drifts, remediated) {
  // Remediated path never intersects exemption fields — excludeUsers/
  // excludeGroups are on NON_REMEDIABLE_FIELDS, so there's no remediation
  // code path that touches them. Remediated alerts always stay on the
  // standard remediated policy.
  const category = remediated ? 'other' : categorizeDrift(drifts);
  const isExemptionChange = category === 'exemption-only';

  const policyId = remediated
    ? caRemediatedPolicyId
    : (isExemptionChange ? caExemptionChangePolicyId : caDriftPolicyId);
  if (!policyId) {
    console.warn('[CA] Cannot create drift alert — alert policy IDs not initialized');
    return;
  }

  // Resolve alert routing: assignment override > template default
  const alertRouting = assignment.alert_routing || assignment.template_alert_routing || 'both';
  if (alertRouting === 'none') return;

  const templateName = assignment.template_name;
  const fieldList = drifts.map(d => d.field).join(', ');

  let severity, message, dedupKey, messageTemplateKey, messageTemplateParams;
  if (isExemptionChange) {
    const diff = summarizeExemptionDiff(drifts);
    severity = 'info';
    message = `CA exemption list changed: "${templateName}" — ${diff.label}`;
    // Distinct dedup so exemption changes don't collide with real drift
    // alerts on the same assignment.
    dedupKey = `ca_exemption_chg_${assignment.id}`;
    // Phase 9b — structured payload for i18n display-time rendering.
    // The prefix slug matches alert_message_prefix.ca_exemption_list_changed.
    // The diff label is constructed from per-principal-type counts (users +
    // groups added/removed); we emit a structured sub-template so the
    // operator sees "+2 utilisateurs, -1 groupe" in fr-CA instead of an
    // English "+2 users, -1 group".
    messageTemplateKey = 'alerts.message_format.ca_exemption_list_changed';
    const noNet = diff.userAdded === 0 && diff.userRemoved === 0
               && diff.groupAdded === 0 && diff.groupRemoved === 0;
    messageTemplateParams = {
      prefixKey: 'alert_message_prefix.ca_exemption_list_changed',
      prefixFallback: 'CA exemption list changed',
      templateName,
      diffLabelKey: noNet
        ? 'alerts.message_format.ca_exemption_diff_label_no_change'
        : 'alerts.message_format.ca_exemption_diff_label_changed',
      diffLabelFallback: diff.label,
      userAdded: diff.userAdded,
      userRemoved: diff.userRemoved,
      groupAdded: diff.groupAdded,
      groupRemoved: diff.groupRemoved,
    };
  } else {
    severity = remediated ? 'medium' : 'high';
    message = remediated
      ? `CA drift auto-remediated: "${templateName}" — ${drifts.length} field(s) restored (${fieldList})`
      : `CA policy drift detected: "${templateName}" — ${drifts.length} field(s) changed (${fieldList})`;
    dedupKey = `ca_drift_${assignment.id}_${remediated ? 'rem' : 'det'}`;
    messageTemplateKey = remediated
      ? 'alerts.message_format.ca_drift_auto_remediated'
      : 'alerts.message_format.ca_policy_drift_detected';
    messageTemplateParams = {
      prefixKey: remediated
        ? 'alert_message_prefix.ca_drift_auto_remediated'
        : 'alert_message_prefix.ca_policy_drift_detected',
      prefixFallback: remediated ? 'CA drift auto-remediated' : 'CA policy drift detected',
      templateName,
      fieldCount: drifts.length,
      fieldList,
    };
  }

  // Check for existing open alert with same dedup key. Alert Merge
  // (2026-06-05) dedup hold: also match a child rolled up into a still-open
  // roll-up parent, so a re-detected CA drift ticks recurrence on the child
  // instead of re-firing while the operator investigates the roll-up. Mirrors
  // alert-engine.js::createOrUpdateAlert so the hold is uniform across every
  // alert producer, not just the polling engine.
  const existing = await db.queryOne(
    `SELECT a.id, a.recurrence_count FROM alerts a
     LEFT JOIN alerts p ON p.id = a.rollup_parent_id
     WHERE a.tenant_id = ? AND a.dedup_key = ?
       AND ( a.status IN ('new', 'investigating')
             OR ( a.resolution_reason = 'rolled_up'
                  AND p.status IN ('new', 'investigating') ) )
     LIMIT 1`,
    [assignment.tenant_id, dedupKey]
  );

  let alertId;
  if (existing) {
    const newCount = (existing.recurrence_count || 1) + 1;
    await db.execute(
      'UPDATE alerts SET recurrence_count = ?, last_seen_at = NOW(), raw_data = ? WHERE id = ?',
      [newCount, JSON.stringify({
        drifts, remediated, template_name: templateName,
        message_template_key: messageTemplateKey,
        message_template_params: messageTemplateParams,
      }), existing.id]
    );
    console.log(`[CA] Drift alert ${existing.id} recurrence: ${newCount}x`);
    return; // Not a new alert — don't re-notify
  }

  const policyName = isExemptionChange
    ? 'CA Exemption List Changed'
    : (remediated ? 'CA Policy Drift Remediated' : 'CA Policy Drift Detected');

  alertId = await db.insert(
    `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key, recurrence_count, last_seen_at, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [
      assignment.tenant_id,
      policyId,
      severity,
      message,
      JSON.stringify({
        drifts,
        remediated,
        template_name: templateName,
        assignment_id: assignment.id,
        category: isExemptionChange ? 'exemption_change' : 'drift',
        exemption_diff: isExemptionChange ? summarizeExemptionDiff(drifts) : null,
        // Phase 9b — structured payload for display-time i18n rendering.
        message_template_key: messageTemplateKey,
        message_template_params: messageTemplateParams,
      }),
      dedupKey,
    ]
  );

  // Auto-attribution: link this drift alert to any recent Panoptica change on
  // the CA surface. Attribution is not suppression — the alert still fires and
  // the operator is still notified; the UI filters attributed alerts from the
  // primary count so they don't clutter the "needs attention" view but remain
  // auditable. Match rule: same tenant + surface overlap + started_at within
  // ATTRIBUTION_WINDOW_MINUTES (60) of now. Best-effort — any failure here is
  // non-fatal because the alert row is already persisted.
  try {
    const attrib = await changeLog.findAttributingChange(assignment.tenant_id, [changeLog.SURFACE.CA]);
    if (attrib) {
      await db.execute(
        'UPDATE alerts SET auto_attributed_change_id = ? WHERE id = ?',
        [attrib.id, alertId]
      );
      console.log(`[CA] Alert ${alertId} auto-attributed to change event ${attrib.id} (${attrib.category})`);
    }
  } catch (attribErr) {
    console.warn(`[CA] Attribution lookup failed (non-fatal): ${attribErr.message}`);
  }

  console.log(`[CA] Created ${isExemptionChange ? 'exemption-change' : 'drift'} alert ${alertId} for tenant ${assignment.tenant_id}: ${message}`);

  // Send notification
  try {
    const tenant = await db.queryOne('SELECT * FROM tenants WHERE id = ?', [assignment.tenant_id]);
    await notifier.sendAlertNotification({
      id: alertId,
      // tenant_id + policy_id are REQUIRED — the PSA integration builds its
      // alert↔ticket link row from them (mysql2 rejects undefined bind params).
      // Omitting these orphaned every CA-drift PSA ticket (fixed 2026-06-10).
      tenant_id: assignment.tenant_id,
      policy_id: policyId,
      alert_scope: 'tenant',
      severity,
      message,
      notification_target: alertRouting,
      policy_name: policyName,
      category: 'config_changes',
      raw_data: JSON.stringify({
        message_template_key: messageTemplateKey,
        message_template_params: messageTemplateParams,
      }),
    }, tenant);
  } catch (e) {
    console.error(`[CA] Notification failed for drift alert ${alertId}:`, e.message);
  }
}

// ═══════════════════════════════════════════
// TEMPLATES (global library)
// ═══════════════════════════════════════════

/**
 * GET /api/ca/templates — List all templates.
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await db.queryRows(
      `SELECT id, name, description, state, grant_controls, target_users,
              target_apps, conditions_summary, monitored_fields, created_at, updated_at
       FROM ca_templates ORDER BY name`
    );
    res.json(templates);
  } catch (err) {
    console.error('[CA] List templates failed:', err.message);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

/**
 * GET /api/ca/templates/:id — Get a single template with full JSON.
 */
router.get('/templates/:id', async (req, res) => {
  try {
    const t = await db.queryOne('SELECT * FROM ca_templates WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json(t);
  } catch (err) {
    console.error('[CA] Get template failed:', err.message);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

/**
 * POST /api/ca/templates — Import a new template from CA policy JSON.
 * Body: {
 *   name,
 *   description?,
 *   policy_json (the raw Entra export),
 *   monitored_fields?,
 *   source_tenant_id? (internal tenants.id — required by UI when policy
 *                       contains location GUIDs, optional at the API layer to
 *                       preserve compatibility with scripted imports)
 * }
 *
 * When source_tenant_id is provided AND the policy contains raw
 * named-location GUIDs, Panoptica queries that tenant's /namedLocations and
 * substitutes each country-type GUID with a __PANOPTICA_LOCATION_<ISO>__
 * placeholder before storing. IP-type and unresolved GUIDs are left raw and
 * returned in response.substitution.skipped[] so the UI can warn the operator.
 */
// A3 (May 9, 2026): admin — template CREATE (system-wide standards-setting).
router.post('/templates', auth.requireAdmin, async (req, res) => {
  try {
    const { name, description, policy_json, monitored_fields, source_tenant_id } = req.body;

    if (!name || !policy_json) {
      return res.status(400).json({ error: 'name and policy_json are required' });
    }

    // Parse and extract key display fields from the CA policy JSON
    const policy = typeof policy_json === 'string' ? JSON.parse(policy_json) : policy_json;

    // If operator specified a source tenant, resolve its Azure ID and
    // substitute location GUIDs → placeholders before we extract display
    // fields or classify. Keeps the stored policy tenant-agnostic from
    // day one.
    let substitution = { substitutedCount: 0, skipped: [] };
    let resolvedSourceTenantId = null;
    if (source_tenant_id !== undefined && source_tenant_id !== null && source_tenant_id !== '') {
      const sourceTenant = await db.queryOne(
        'SELECT id, tenant_id, display_name FROM tenants WHERE id = ?',
        [source_tenant_id]
      );
      if (!sourceTenant) {
        return res.status(400).json({ error: `source_tenant_id ${source_tenant_id} does not match any tenant` });
      }
      resolvedSourceTenantId = sourceTenant.id;
      try {
        substitution = await substituteLocationGUIDs(policy, sourceTenant.tenant_id);
      } catch (subErr) {
        console.error(`[CA] substituteLocationGUIDs failed for "${name}" (source ${sourceTenant.display_name}):`, subErr.message);
        return res.status(502).json({ error: 'Failed to substitute named-location GUIDs using source tenant: ' + subErr.message });
      }
    }

    const extracted = extractPolicyFields(policy);

    // Classify this policy into the canonical control-dimension tags used by
    // the exemption resolver and alert engine. Structure-only — never reads
    // displayName. See src/lib/ca-policy-classifier.js.
    let controlDimensions = null;
    try {
      const classified = caClassifier.classifyCaPolicy(policy);
      const dims = caClassifier.toControlDimensionsList(classified);
      controlDimensions = dims.length > 0 ? JSON.stringify(dims) : JSON.stringify([]);
      if (classified.unclassified && classified.unclassified.length > 0) {
        console.log(`[CA] Template "${name}" classified: dims=[${dims.join(',')}], unclassified=[${classified.unclassified.join(',')}]`);
      } else {
        console.log(`[CA] Template "${name}" classified: dims=[${dims.join(',')}]`);
      }
    } catch (e) {
      // Non-fatal: a classifier crash should not block template import. An
      // empty control_dimensions just means the template is exempt-unaware
      // until scripts/classify-ca-templates.js backfills it.
      console.warn(`[CA] Classifier failed for "${name}": ${e.message}`);
    }

    // Default monitored fields if not provided
    const defaultMonitored = [
      'state',
      'grantControls.builtInControls',
      'conditions.users.includeUsers',
      'conditions.users.includeGroups',
      'conditions.applications.includeApplications',
      'conditions.users.excludeUsers',
      'conditions.users.excludeGroups',
    ];

    const id = await db.insert(
      `INSERT INTO ca_templates (name, description, policy_json, state, grant_controls,
        target_users, target_apps, conditions_summary, monitored_fields, control_dimensions,
        source_tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        JSON.stringify(policy),
        extracted.state,
        extracted.grantControls,
        extracted.targetUsers,
        extracted.targetApps,
        extracted.conditionsSummary,
        JSON.stringify(monitored_fields || defaultMonitored),
        controlDimensions,
        resolvedSourceTenantId,
      ]
    );

    console.log(`[CA] Template "${name}" created (id=${id}) by ${req.session.user.email} — substituted ${substitution.substitutedCount} location GUID(s), skipped ${substitution.skipped.length}`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'ca_template.create',
      description: `Created CA template "${name}" (id=${id})`,
      templateKey: 'ca_template.create',
      templateParams: { name },
      targetType: 'ca_template',
      targetId: String(id),
      targetName: name,
      metadata: {
        state: extracted.state,
        has_description: !!description,
        monitored_field_count: (monitored_fields || defaultMonitored).length,
        source_tenant_id: resolvedSourceTenantId,
        location_substitutions: substitution.substitutedCount,
        location_skipped_count: substitution.skipped.length,
        // Include skipped types (not GUIDs themselves) so the audit row is
        // compact and doesn't leak tenant-identifying hex strings.
        location_skipped_types: substitution.skipped.map(s => s.type),
      },
      req,
    }).catch(() => {});
    const created = await db.queryOne('SELECT * FROM ca_templates WHERE id = ?', [id]);
    res.status(201).json({ template: created, substitution });
  } catch (err) {
    console.error('[CA] Create template failed:', err.message);
    res.status(500).json({ error: 'Failed to create template: ' + err.message });
  }
});

/**
 * PUT /api/ca/templates/:id — Update template name, description, monitored fields.
 */
// A3 (May 9, 2026): admin — template EDIT.
router.put('/templates/:id', auth.requireAdmin, async (req, res) => {
  try {
    const { name, description, monitored_fields, alert_routing } = req.body;
    // Read before-state so the audit row can express intent (field diff).
    const before = await db.queryOne('SELECT id, name, description, alert_routing, monitored_fields FROM ca_templates WHERE id = ?', [req.params.id]);
    if (!before) return res.status(404).json({ error: 'Template not found' });

    const affected = await db.execute(
      `UPDATE ca_templates SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        monitored_fields = COALESCE(?, monitored_fields),
        alert_routing = COALESCE(?, alert_routing)
       WHERE id = ?`,
      [name || null, description || null, monitored_fields ? JSON.stringify(monitored_fields) : null, alert_routing || null, req.params.id]
    );
    if (affected === 0) return res.status(404).json({ error: 'Template not found' });

    const updated = await db.queryOne('SELECT * FROM ca_templates WHERE id = ?', [req.params.id]);

    // Build a minimal, audit-safe field diff. Skip policy_json / raw blobs —
    // they're too large and may contain tenant identifiers irrelevant to an MSP-level audit.
    const diff = {};
    if (name !== undefined && name !== before.name) diff.name = { from: before.name, to: name };
    if (description !== undefined && description !== before.description) diff.description = { changed: true };
    if (alert_routing !== undefined && alert_routing !== before.alert_routing) diff.alert_routing = { from: before.alert_routing, to: alert_routing };
    if (monitored_fields !== undefined) {
      const beforeCount = (() => { try { return JSON.parse(before.monitored_fields || '[]').length; } catch { return 0; } })();
      diff.monitored_fields = { from_count: beforeCount, to_count: monitored_fields.length };
    }
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'ca_template.update',
      description: `Updated CA template "${updated.name}" (id=${updated.id})`,
      templateKey: 'ca_template.update',
      templateParams: { name: updated.name },
      targetType: 'ca_template',
      targetId: String(updated.id),
      targetName: updated.name,
      metadata: { diff },
      req,
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error('[CA] Update template failed:', err.message);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /api/ca/templates/:id — Delete a template (cascades to assignments).
 */
// A3 (May 9, 2026): admin — template DELETE.
router.delete('/templates/:id', auth.requireAdmin, async (req, res) => {
  try {
    // Snapshot name for the audit row BEFORE delete, since we can't read after.
    const before = await db.queryOne('SELECT name FROM ca_templates WHERE id = ?', [req.params.id]);
    const affected = await db.execute('DELETE FROM ca_templates WHERE id = ?', [req.params.id]);
    if (affected === 0) return res.status(404).json({ error: 'Template not found' });
    console.log(`[CA] Template ${req.params.id} deleted by ${req.session.user.email}`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'ca_template.delete',
      description: `Deleted CA template "${before?.name || '(unknown)'}" (id=${req.params.id})`,
      templateKey: 'ca_template.delete',
      templateParams: { name: before?.name || '(unknown)' },
      targetType: 'ca_template',
      targetId: String(req.params.id),
      targetName: before?.name || null,
      req,
    }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[CA] Delete template failed:', err.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ═══════════════════════════════════════════
// EXPORT — Pull all CA policies from a tenant
// ═══════════════════════════════════════════

/**
 * GET /api/ca/export/:tenantId — Fetch every CA policy from the given tenant
 * and return them as raw Graph JSON. Mirrors /api/intune/export/:tenantId.
 *
 * Output is intentionally the raw Entra export shape — named-location GUIDs
 * stay raw. Placeholder substitution happens at IMPORT time (POST /templates
 * with source_tenant_id), not at export time. Keeps separation of concerns:
 * export is a tenant snapshot, import is where portability gets introduced.
 */
router.get('/export/:tenantId', async (req, res) => {
  try {
    const tenantDbId = parseInt(req.params.tenantId, 10);
    const tenant = await db.queryOne(
      'SELECT id, tenant_id, display_name FROM tenants WHERE id = ?',
      [tenantDbId]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const azureTenantId = tenant.tenant_id;
    const errors = [];
    let policies = [];

    try {
      console.log(`[CA:Export] Fetching CA policies from ${tenant.display_name}...`);
      // Use callGraphPaged so we don't silently truncate on tenants with many
      // policies. Default $top is ~100 per page; maxPages:10 covers up to ~1000
      // policies which is well above any real MSP tenant.
      policies = await graph.callGraphPaged(
        azureTenantId,
        '/identity/conditionalAccess/policies',
        { version: 'v1.0', maxPages: 10 }
      );
      console.log(`[CA:Export] ${tenant.display_name}: ${policies.length} CA policies fetched`);
    } catch (err) {
      const msg = `Failed to fetch CA policies: ${err.message}`;
      console.warn(`[CA:Export] ${msg}`);
      errors.push(msg);
    }

    // Audit the export so we have a trail of who pulled what from which tenant.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.EXPORT,
      action: 'ca_policies.export',
      description: `Exported ${policies.length} CA policies from "${tenant.display_name}"`,
      templateKey: 'ca_policies.export',
      templateParams: { count: policies.length, tenantName: tenant.display_name },
      targetType: 'tenant',
      targetId: String(tenant.id),
      targetName: tenant.display_name,
      metadata: {
        policy_count: policies.length,
        errors: errors.length,
      },
      req,
    }).catch(() => {});

    res.json({
      tenant: tenant.display_name,
      tenantId: tenant.id,
      azureTenantId,
      exportedAt: new Date().toISOString(),
      totalPolicies: policies.length,
      policies,
      errors,
    });
  } catch (err) {
    console.error('[CA:Export] Export failed:', err.message);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// ASSIGNMENTS (per-tenant)
// ═══════════════════════════════════════════

/**
 * GET /api/ca/assignments?tenant_id=X — List assignments for a tenant.
 */
router.get('/assignments', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    let sql = `SELECT a.*, t.name AS template_name, t.state AS template_state,
                      t.grant_controls, t.target_users, t.target_apps,
                      t.alert_routing AS template_alert_routing
               FROM ca_assignments a
               JOIN ca_templates t ON t.id = a.template_id`;
    const params = [];

    if (tenant_id) {
      sql += ' WHERE a.tenant_id = ?';
      params.push(parseInt(tenant_id, 10));
    }
    sql += ' ORDER BY t.name';

    const assignments = await db.queryRows(sql, params);
    res.json(assignments);
  } catch (err) {
    console.error('[CA] List assignments failed:', err.message);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
});

/**
 * POST /api/ca/assignments — Assign a template to a tenant.
 * Body: { template_id, tenant_id }
 *
 * A3 (May 9, 2026): operator — per-tenant deployment is an operator action.
 * v0.1.16 (2026-05-25): enforcement removed from request body; always 'monitor'.
 */
router.post('/assignments', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { template_id, tenant_id } = req.body;
    if (!template_id || !tenant_id) {
      return res.status(400).json({ error: 'template_id and tenant_id are required' });
    }

    // Check for existing assignment
    const existing = await db.queryOne(
      'SELECT id FROM ca_assignments WHERE template_id = ? AND tenant_id = ?',
      [template_id, tenant_id]
    );
    if (existing) {
      return res.status(409).json({ error: 'This template is already assigned to this tenant' });
    }

    // enforcement is always 'monitor' as of v0.1.16. The column is preserved
    // for backward compat (no destructive migration) but no code path ever
    // writes 'remediate' anymore — the scheduler doesn't read it either.
    const id = await db.insert(
      `INSERT INTO ca_assignments (template_id, tenant_id, enforcement)
       VALUES (?, ?, 'monitor')`,
      [template_id, tenant_id]
    );

    console.log(`[CA] Template ${template_id} assigned to tenant ${tenant_id} by ${req.session.user.email}`);

    const created = await db.queryOne(
      `SELECT a.*, t.name AS template_name, tn.display_name AS tenant_name
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.id = ?`, [id]
    );

    // Audit: operator action — creates a new Panoptica-side link between a
    // template and a tenant. No tenant state change (Graph is not called),
    // so MSP Audit Log only, not Tenant Change Log.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TEMPLATE_CRUD,
      action: 'ca_assignment.create',
      description: `Assigned template "${created?.template_name || '?'}" to tenant "${created?.tenant_name || '?'}"`,
      templateKey: 'ca_assignment.create',
      templateParams: { templateName: created?.template_name || '?', tenantName: created?.tenant_name || '?' },
      targetType: 'ca_assignment',
      targetId: String(id),
      targetName: created?.template_name || null,
      metadata: {
        template_id,
        tenant_id,
        tenant_name: created?.tenant_name || null,
      },
      req,
    }).catch(() => {});

    res.status(201).json(created);
  } catch (err) {
    console.error('[CA] Create assignment failed:', err.message);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

/**
 * PUT /api/ca/assignments/:id — Update enforcement mode or live_policy_id.
 *
 * A3 (May 9, 2026): operator — per-tenant deployment edit.
 */
router.put('/assignments/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    // enforcement is silently ignored as of v0.1.16 — the column is dead.
    const { live_policy_id } = req.body;
    const affected = await db.execute(
      `UPDATE ca_assignments SET
        live_policy_id = COALESCE(?, live_policy_id)
       WHERE id = ?`,
      [live_policy_id || null, req.params.id]
    );
    if (affected === 0) return res.status(404).json({ error: 'Assignment not found' });

    const updated = await db.queryOne(
      `SELECT a.*, t.name AS template_name
       FROM ca_assignments a JOIN ca_templates t ON t.id = a.template_id
       WHERE a.id = ?`, [req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error('[CA] Update assignment failed:', err.message);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// PATCH /api/ca/assignments/:id/enforcement — REMOVED in v0.1.16.
// The monitor/remediate toggle was retired with the scheduler's auto-remediation
// path (see comment block in checkDrift). The enforcement DB column is left in
// place for backward compat but is never read or written by application code.
// Any caller still hitting this endpoint will get 404 from the Express router,
// which is the right signal: the operation no longer exists.

/**
 * PATCH /api/ca/assignments/:id/alert-routing — Update alert routing override.
 *
 * A3 (May 9, 2026): operator.
 */
router.patch('/assignments/:id/alert-routing', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { alert_routing } = req.body;
    // null means inherit from template
    if (alert_routing !== null && !['support', 'personal', 'both', 'none'].includes(alert_routing)) {
      return res.status(400).json({ error: 'alert_routing must be "support", "personal", "both", "none", or null' });
    }
    await db.execute(
      `UPDATE ca_assignments SET alert_routing = ? WHERE id = ?`,
      [alert_routing, req.params.id]
    );
    console.log(`[CA] Alert routing changed to "${alert_routing}" for assignment ${req.params.id} by ${req.session.user.email}`);
    res.json({ success: true, alert_routing });
  } catch (err) {
    console.error('[CA] Update alert routing failed:', err.message);
    res.status(500).json({ error: 'Failed to update alert routing' });
  }
});

/**
 * DELETE /api/ca/assignments/:id — Remove an assignment.
 * Query param: ?delete_from_tenant=true to also delete the live policy from the tenant.
 *
 * A3 (May 9, 2026): operator — unassign/retire deployment.
 */
router.delete('/assignments/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const deleteLive = req.query.delete_from_tenant === 'true';

    // Fetch assignment with tenant info before deleting
    const assignment = await db.queryOne(
      `SELECT a.*, tn.tenant_id AS azure_tenant_id, t.name AS template_name
       FROM ca_assignments a
       JOIN tenants tn ON tn.id = a.tenant_id
       LEFT JOIN ca_templates t ON t.id = a.template_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    // Delete live policy from tenant if requested and linked
    let policyDeleted = false;
    let tenantDeleteError = null; // string | null — captured for audit when delete was requested but failed
    if (deleteLive && assignment.live_policy_id) {
      try {
        await graph.callGraph(
          assignment.azure_tenant_id,
          `/identity/conditionalAccess/policies/${assignment.live_policy_id}`,
          { version: 'v1.0', method: 'DELETE' }
        );
        policyDeleted = true;
        console.log(`[CA] Deleted live policy ${assignment.live_policy_id} from tenant ${assignment.azure_tenant_id}`);
      } catch (graphErr) {
        // 404 = already gone → treat as success for audit narrative
        if (graphErr?.statusCode === 404) {
          policyDeleted = true;
          console.log(`[CA] Live policy ${assignment.live_policy_id} was already absent from tenant (404)`);
        } else {
          tenantDeleteError = `${graphErr?.statusCode || 'ERR'}: ${graphErr.message}`;
          console.error(`[CA] Failed to delete live policy ${assignment.live_policy_id}:`, graphErr.message);
          // Continue with assignment removal even if Graph delete fails
        }
      }
    }

    await db.execute('DELETE FROM ca_assignments WHERE id = ?', [req.params.id]);
    console.log(`[CA] Assignment ${req.params.id} deleted by ${req.session.user.email} (live policy deleted: ${policyDeleted})`);

    // ─── AUDIT ───
    // Always log — operator REMOVE is an audit event regardless of whether the
    // tenant-side delete happened. Description differentiates three outcomes
    // so auditors can reconstruct operator intent and system behavior:
    //   1. Tenant-side retire succeeded (or was already gone)
    //   2. Tenant-side retire was requested but Graph DELETE failed
    //   3. Panoptica tracking removed only (operator kept tenant policy live)
    const templateLabel = assignment.template_name
      ? `"${assignment.template_name}"`
      : (assignment.live_policy_id || `assignment ${req.params.id}`);
    let description;
    if (deleteLive && policyDeleted) {
      description = `Retired CA policy ${templateLabel} — deleted from tenant`;
    } else if (deleteLive && !policyDeleted) {
      description = `Removed CA policy ${templateLabel} from Panoptica tracking — tenant-side DELETE FAILED: ${tenantDeleteError || 'unknown error'} (policy still present in tenant)`;
    } else {
      description = `Removed CA policy ${templateLabel} from Panoptica tracking — tenant policy retained`;
    }
    try {
      await changeLog.logPanopticaChange({
        tenantId: assignment.tenant_id,
        category: changeLog.CATEGORY.CA_POLICY_RETIRE,
        surfaces: [changeLog.SURFACE.CA],
        description,
        templateKey: 'ca_retire',
        templateParams: { policyName: assignment.template_name || `policy ${assignment.live_policy_id}` },
        createdBy: req.session.user.email,
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[CA] Change-log failed (non-fatal): ${logErr.message}`);
    }

    res.json({
      success: true,
      policy_deleted: policyDeleted,
      tenant_delete_requested: deleteLive,
      tenant_delete_error: tenantDeleteError,
    });
  } catch (err) {
    console.error('[CA] Delete assignment failed:', err.message);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// ═══════════════════════════════════════════
// DRIFT DETECTION
// ═══════════════════════════════════════════

/**
 * POST /api/ca/assignments/:id/check — Run drift check for a single assignment.
 */
router.post('/assignments/:id/check', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const assignment = await db.queryOne(
      `SELECT a.*, t.policy_json, t.monitored_fields, t.name AS template_name, t.alert_routing AS template_alert_routing, tn.tenant_id AS azure_tenant_id
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const result = await checkDrift(assignment);
    res.json(result);
  } catch (err) {
    console.error('[CA] Drift check failed:', err.message);
    res.status(500).json({ error: 'Drift check failed: ' + err.message });
  }
});

/**
 * POST /api/ca/check-all?tenant_id=X — Run drift checks for all assignments of a tenant.
 */
router.post('/check-all', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });

    const assignments = await db.queryRows(
      `SELECT a.*, t.policy_json, t.monitored_fields, t.name AS template_name, t.alert_routing AS template_alert_routing, tn.tenant_id AS azure_tenant_id
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.tenant_id = ?`,
      [parseInt(tenant_id, 10)]
    );

    const results = [];
    for (const assignment of assignments) {
      try {
        const result = await checkDrift(assignment);
        results.push(result);
      } catch (err) {
        results.push({
          assignment_id: assignment.id,
          drift_status: 'error',
          error: err.message,
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[CA] Check-all failed:', err.message);
    res.status(500).json({ error: 'Drift check failed: ' + err.message });
  }
});

/**
 * GET /api/ca/drift-log?assignment_id=X — Get drift history for an assignment.
 */
router.get('/drift-log', async (req, res) => {
  try {
    const { assignment_id, tenant_id, limit: lim } = req.query;
    let sql = `SELECT dl.*, a.template_id, t.name AS template_name
               FROM ca_drift_log dl
               JOIN ca_assignments a ON a.id = dl.assignment_id
               JOIN ca_templates t ON t.id = a.template_id`;
    const params = [];

    if (assignment_id) {
      sql += ' WHERE dl.assignment_id = ?';
      params.push(parseInt(assignment_id, 10));
    } else if (tenant_id) {
      sql += ' WHERE a.tenant_id = ?';
      params.push(parseInt(tenant_id, 10));
    }

    sql += ' ORDER BY dl.created_at DESC';
    sql += ` LIMIT ${parseInt(lim, 10) || 50}`;

    const logs = await db.queryRows(sql, params);
    res.json(logs);
  } catch (err) {
    console.error('[CA] Drift log failed:', err.message);
    res.status(500).json({ error: 'Failed to load drift log' });
  }
});

/**
 * GET /api/ca/tenant/:tenantId/live-policies — Fetch live CA policies from Graph API.
 */
router.get('/tenant/:tenantId/live-policies', async (req, res) => {
  try {
    const tenant = await db.queryOne(
      'SELECT tenant_id FROM tenants WHERE id = ?', [req.params.tenantId]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const policies = await fetchLivePolicies(tenant.tenant_id);
    res.json(policies);
  } catch (err) {
    console.error('[CA] Fetch live policies failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch CA policies: ' + err.message });
  }
});

/**
 * POST /api/ca/assignments/:id/remediate — Push template state back to tenant.
 */
router.post('/assignments/:id/remediate', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const assignment = await db.queryOne(
      `SELECT a.*, t.policy_json, t.monitored_fields, t.name AS template_name, t.alert_routing AS template_alert_routing, tn.tenant_id AS azure_tenant_id
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (!assignment.live_policy_id) {
      return res.status(400).json({ error: 'No live policy linked. Run a drift check first or link a policy manually.' });
    }

    // Fetch live policy to provide location GUID hints for placeholder resolution
    let livePol = null;
    try {
      livePol = await graph.callGraph(
        assignment.azure_tenant_id,
        `/identity/conditionalAccess/policies/${assignment.live_policy_id}`,
        { version: 'v1.0' }
      );
    } catch { /* non-fatal — remediation proceeds without hints */ }

    const result = await remediatePolicy(assignment, livePol, req.session.user.email, changeLog.captureActorContext(req));
    res.json(result);
  } catch (err) {
    console.error('[CA] Remediation failed:', err.message);
    res.status(500).json({ error: 'Remediation failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// AUTO-MATCH: find the live policy that matches a template
// ═══════════════════════════════════════════

/**
 * POST /api/ca/assignments/:id/auto-match — Try to auto-match a template to a live policy.
 * Matches by displayName.
 */
router.post('/assignments/:id/auto-match', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const assignment = await db.queryOne(
      `SELECT a.*, t.policy_json, t.name AS template_name, tn.tenant_id AS azure_tenant_id, tn.display_name AS tenant_name
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const templatePolicy = typeof assignment.policy_json === 'string'
      ? JSON.parse(assignment.policy_json)
      : assignment.policy_json;
    const templateName = templatePolicy.displayName;

    const livePolicies = await fetchLivePolicies(assignment.azure_tenant_id);
    const match = livePolicies.find(p =>
      p.displayName && p.displayName.toLowerCase() === templateName?.toLowerCase()
    );

    if (match) {
      await db.execute(
        'UPDATE ca_assignments SET live_policy_id = ? WHERE id = ?',
        [match.id, assignment.id]
      );
      console.log(`[CA] Auto-matched assignment ${assignment.id} to live policy "${match.displayName}" (${match.id})`);

      // Audit: operator action — links a Panoptica template to an existing
      // live policy. This is MSP-level accountability (not a tenant state
      // change), so it belongs in msp_audit_events, NOT tenant_change_events.
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TEMPLATE_CRUD,
        action: 'ca_assignment.match',
        description: `Matched template "${assignment.template_name}" to live policy "${match.displayName}" in tenant "${assignment.tenant_name}"`,
        templateKey: 'ca_assignment.match',
        templateParams: { templateName: assignment.template_name, policyName: match.displayName, tenantName: assignment.tenant_name },
        targetType: 'ca_assignment',
        targetId: String(assignment.id),
        targetName: assignment.template_name,
        metadata: {
          tenant_id: assignment.tenant_id,
          tenant_name: assignment.tenant_name,
          template_id: assignment.template_id,
          live_policy_id: match.id,
          live_policy_name: match.displayName,
        },
        req,
      }).catch(() => {});

      res.json({ matched: true, live_policy_id: match.id, displayName: match.displayName });
    } else {
      // Audit the no-match case too — the fact that an operator attempted a
      // match and it failed is meaningful for the trail (indicates a
      // displayName mismatch the operator then had to resolve somehow).
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TEMPLATE_CRUD,
        action: 'ca_assignment.match_failed',
        description: `Match failed for template "${assignment.template_name}" in tenant "${assignment.tenant_name}" — no live policy named "${templateName}"`,
        templateKey: 'ca_assignment.match_failed',
        templateParams: { templateName: assignment.template_name, tenantName: assignment.tenant_name, policyName: templateName },
        targetType: 'ca_assignment',
        targetId: String(assignment.id),
        targetName: assignment.template_name,
        metadata: {
          tenant_id: assignment.tenant_id,
          tenant_name: assignment.tenant_name,
          template_id: assignment.template_id,
          searched_name: templateName,
          available_count: livePolicies.length,
        },
        success: false,
        req,
      }).catch(() => {});

      res.json({ matched: false, message: `No live policy found with name "${templateName}"`, available: livePolicies.map(p => ({ id: p.id, displayName: p.displayName })) });
    }
  } catch (err) {
    console.error('[CA] Auto-match failed:', err.message);
    res.status(500).json({ error: 'Auto-match failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// DEPLOY — Create policy in tenant
// ═══════════════════════════════════════════

/**
 * POST /api/ca/assignments/:id/deploy — Deploy (create) the template policy in the tenant.
 * Creates a new CA policy in the tenant via Graph API, then links it to the assignment.
 */
router.post('/assignments/:id/deploy', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const assignment = await db.queryOne(
      `SELECT a.*, t.policy_json, t.name AS template_name, tn.tenant_id AS azure_tenant_id
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (assignment.live_policy_id) {
      return res.status(409).json({ error: 'Policy already linked to this assignment. Use remediate to push changes.' });
    }

    const templatePolicy = typeof assignment.policy_json === 'string'
      ? JSON.parse(assignment.policy_json)
      : assignment.policy_json;

    // Build the policy body for creation — strip read-only fields that Graph won't accept
    const createBody = buildDeployBody(templatePolicy);

    // Use the Panoptica template name, not the original JSON displayName
    createBody.displayName = assignment.template_name;

    // Resolve named-location placeholders (e.g. __PANOPTICA_CANADA_LOCATION__)
    // and translate any hardcoded GUIDs from the source tenant
    await resolveNamedLocationPlaceholders(createBody, assignment.azure_tenant_id, undefined, {
      internalTenantId: assignment.tenant_id,
      createdBy: req.session.user.email,
      actorContext: changeLog.captureActorContext(req),
    });
    await resolveHardcodedLocationGUIDs(createBody, assignment.azure_tenant_id);

    console.log(`[CA] Deploying policy "${createBody.displayName}" to tenant ${assignment.azure_tenant_id}`);
    console.log(`[CA] Deploy payload:`, JSON.stringify(createBody, null, 2));

    const created = await graph.callGraph(
      assignment.azure_tenant_id,
      '/identity/conditionalAccess/policies',
      { version: 'v1.0', method: 'POST', body: createBody }
    );

    console.log(`[CA] Graph response:`, JSON.stringify(created, null, 2));

    if (!created || !created.id) {
      throw new Error('Graph API did not return a policy ID — response: ' + JSON.stringify(created));
    }

    // Link the new policy to the assignment
    await db.execute(
      `UPDATE ca_assignments SET live_policy_id = ?, drift_status = 'ok',
       last_checked_at = NOW(), drift_details = NULL WHERE id = ?`,
      [created.id, assignment.id]
    );

    console.log(`[CA] Policy "${createBody.displayName}" deployed as ${created.id} in tenant ${assignment.azure_tenant_id} by ${req.session.user.email}`);

    // Audit + drift-attribution: log the Panoptica-initiated change
    await changeLog.logPanopticaChange({
      tenantId: assignment.tenant_id,
      category: changeLog.CATEGORY.CA_POLICY_PUSH,
      surfaces: [changeLog.SURFACE.CA],
      description: `Deployed CA policy "${createBody.displayName}" (template: ${assignment.template_name})`,
      templateKey: 'ca_deploy',
      templateParams: { policyName: createBody.displayName, templateName: assignment.template_name },
      createdBy: req.session.user.email,
      ...changeLog.captureActorContext(req),
    });

    res.json({
      success: true,
      live_policy_id: created.id,
      displayName: created.displayName,
      state: created.state,
      message: `Policy "${created.displayName}" created in tenant`,
    });
  } catch (err) {
    console.error('[CA] Deploy failed:', err.message);
    res.status(500).json({ error: 'Deploy failed: ' + err.message });
  }
});

/**
 * Build a clean policy body for Graph API POST (create).
 * Strips read-only properties, OData annotations, and null values that Graph rejects.
 */
function buildDeployBody(templatePolicy) {
  // Deep clone to avoid mutating the template
  const body = JSON.parse(JSON.stringify(templatePolicy));

  // Remove read-only / server-generated fields
  delete body.id;
  delete body.createdDateTime;
  delete body.modifiedDateTime;
  delete body.templateId;

  // Strip all OData annotations (keys containing '@odata')
  stripOdataAnnotations(body);

  // Ensure state defaults to report-only for safety (can be changed after verification)
  if (!body.state) body.state = 'enabledForReportingButNotEnforced';

  // Clean up null fields throughout — Graph may reject them on creation
  stripNulls(body);

  return body;
}

/**
 * Recursively remove all keys containing '@odata' from an object.
 */
function stripOdataAnnotations(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.includes('@odata')) {
      delete obj[key];
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      stripOdataAnnotations(obj[key]);
    }
  }
}

/**
 * Recursively remove null-valued keys from an object.
 * Graph API often rejects null values on creation that it includes on reads.
 */
function stripNulls(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    if (obj[key] === null) {
      delete obj[key];
    } else if (typeof obj[key] === 'object') {
      stripNulls(obj[key]);
    }
  }
}

/**
 * Named-location placeholder system — tenant-agnostic geography references.
 *
 * A template's conditions.locations arrays cannot carry raw GUIDs (GUIDs are
 * tenant-local — "Canada" has a different GUID in every tenant). Panoptica
 * encodes geography intent using a generic placeholder of the form:
 *
 *     __PANOPTICA_LOCATION_<ISO1>[_<ISO2>[_<ISO3>...]]__
 *
 * Examples:
 *   __PANOPTICA_LOCATION_CA__         → Canada
 *   __PANOPTICA_LOCATION_MX_US__      → Mexico + United States
 *   __PANOPTICA_LOCATION_US_CA_MX__   → USA + Canada + Mexico (North America)
 *
 * At deploy or drift-check time, the resolver finds or creates a matching
 * countryNamedLocation in the target tenant and substitutes the real GUID.
 *
 * Backward compatibility: the original hardcoded literal
 *   __PANOPTICA_CANADA_LOCATION__
 * is recognized and treated as __PANOPTICA_LOCATION_CA__.
 *
 * Design rule: behavior derives from the country codes encoded in the
 * placeholder, NEVER from a hardcoded country list. Any ISO 3166-1 alpha-2
 * code the MSP wants is valid.
 */
const LEGACY_CANADA_PLACEHOLDER = '__PANOPTICA_CANADA_LOCATION__';
const PLACEHOLDER_RE = /__PANOPTICA_LOCATION_([A-Z]{2}(?:_[A-Z]{2})*)__/g;
const PLACEHOLDER_RE_STRICT = /^__PANOPTICA_LOCATION_([A-Z]{2}(?:_[A-Z]{2})*)__$/;

/**
 * Parse a placeholder string into its component ISO country codes.
 * Returns null if the string is not a valid placeholder.
 */
function parseLocationPlaceholder(str) {
  if (str === LEGACY_CANADA_PLACEHOLDER) {
    return { countries: ['CA'], displayName: 'Canada', canonical: LEGACY_CANADA_PLACEHOLDER };
  }
  const m = PLACEHOLDER_RE_STRICT.exec(str);
  if (!m) return null;
  const countries = m[1].split('_');
  const displayName = countries.length === 1
    ? countryCodeDisplayName(countries[0])
    : countries.map(countryCodeDisplayName).join(' + ');
  return { countries, displayName, canonical: str };
}

/**
 * Display-name hint for a country code. Only a best-effort lookup for the
 * displayName of the named location we create; the ISO codes are what
 * actually matter. Expand as needed — unknown codes fall back to the ISO
 * code itself, which still produces a valid named location.
 */
function countryCodeDisplayName(iso) {
  const map = {
    CA: 'Canada', US: 'United States', MX: 'Mexico',
    GB: 'United Kingdom', FR: 'France', DE: 'Germany', ES: 'Spain', IT: 'Italy',
    AU: 'Australia', NZ: 'New Zealand',
    BR: 'Brazil', AR: 'Argentina',
    JP: 'Japan', KR: 'South Korea', IN: 'India',
  };
  return map[iso] || iso;
}

/**
 * Scan a body (deploy/PATCH payload) for placeholder occurrences.
 * Returns an array of { placeholder, countries, displayName } — each
 * unique placeholder found once. Handles both legacy and generic forms.
 */
function findPlaceholdersInBody(body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const seen = new Set();
  const found = [];
  if (bodyStr.includes(LEGACY_CANADA_PLACEHOLDER)) {
    seen.add(LEGACY_CANADA_PLACEHOLDER);
    found.push(parseLocationPlaceholder(LEGACY_CANADA_PLACEHOLDER));
  }
  // Reset state before exec loop — global regexes share state across calls.
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(bodyStr)) !== null) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const parsed = parseLocationPlaceholder(m[0]);
    if (parsed) found.push(parsed);
  }
  return found;
}

/**
 * Scan a deploy body for named-location placeholders and resolve them.
 * For each placeholder found:
 *  1. Query the tenant's named locations via Graph
 *  2. Find an existing country-based location matching the country codes, or create one
 *  3. Replace the placeholder string with the real GUID
 */
// In-memory cache: tenantId → { placeholder → resolvedGUID }
// Avoids hitting Graph /namedLocations on every drift check cycle.
// Cache entries expire after 60 minutes (named locations rarely change).
const _namedLocationCache = new Map();
const NAMED_LOCATION_CACHE_TTL = 60 * 60 * 1000; // 60 minutes

function getCachedLocation(tenantId, placeholder) {
  const entry = _namedLocationCache.get(`${tenantId}:${placeholder}`);
  if (entry && (Date.now() - entry.ts) < NAMED_LOCATION_CACHE_TTL) return entry.id;
  return null;
}

function setCachedLocation(tenantId, placeholder, locationId) {
  _namedLocationCache.set(`${tenantId}:${placeholder}`, { id: locationId, ts: Date.now() });
}

/**
 * Collect all GUIDs from a policy's location arrays (include + exclude).
 * Used as hints for placeholder resolution to prefer GUIDs already in the live policy.
 */
function collectLocationGUIDs(policy) {
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const guids = new Set();
  const locations = policy?.conditions?.locations;
  if (!locations) return guids;
  for (const arr of [locations.includeLocations, locations.excludeLocations]) {
    if (Array.isArray(arr)) {
      for (const val of arr) {
        if (guidPattern.test(val)) guids.add(val);
      }
    }
  }
  return guids;
}

/**
 * Substitute raw named-location GUIDs in a policy with __PANOPTICA_LOCATION_<ISO>__
 * placeholders, using the source tenant's own named locations as the lookup table.
 *
 * This is the INVERSE of resolveNamedLocationPlaceholders — it runs at template
 * IMPORT time (once), whereas the resolver runs at deploy/drift/remediate time
 * (every cycle). Making templates tenant-agnostic at import removes the
 * sole-country-heuristic fallback as a load-bearing piece of the system.
 *
 * Country-type named locations are substituted with placeholders.
 * IP-type named locations are left raw (MSPs shouldn't template IP-based
 *   policies — those are tenant-specific by nature). They're captured in the
 *   skipped[] array so the UI can warn the operator.
 * Sentinels ('All', 'AllTrusted', 'None') are untouched.
 * GUIDs that don't match any named location in the source tenant are also
 *   left raw and captured in skipped[] with type='unresolved' — could be a
 *   stale reference or a copy-paste error; the operator sees it and decides.
 *
 * @param {object} policy           The parsed CA policy JSON. Mutated in place.
 * @param {string} sourceAzureId    Source tenant's Azure GUID (from tenants.tenant_id).
 * @returns {Promise<{substitutedCount, skipped}>}
 *          substitutedCount: number of GUID→placeholder substitutions made
 *          skipped: [{ guid, type, displayName }] — entries that stayed raw
 */
async function substituteLocationGUIDs(policy, sourceAzureId) {
  const result = { substitutedCount: 0, skipped: [] };
  const locations = policy?.conditions?.locations;
  if (!locations) return result;

  // Collect GUIDs from include/exclude arrays (sentinels and non-GUID strings ignored).
  const GUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const presentGUIDs = new Set();
  for (const arr of [locations.includeLocations, locations.excludeLocations]) {
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (typeof v === 'string' && GUID_RE_LOCAL.test(v)) presentGUIDs.add(v);
    }
  }
  if (presentGUIDs.size === 0) return result;

  // Fetch source tenant's named locations once.
  let sourceLocations = [];
  try {
    const resp = await graph.callGraph(
      sourceAzureId,
      '/identity/conditionalAccess/namedLocations',
      { version: 'v1.0', method: 'GET' }
    );
    sourceLocations = resp.value || [];
  } catch (err) {
    console.error('[CA] substituteLocationGUIDs — failed to fetch source named locations:', err.message);
    throw new Error('Cannot substitute named-location GUIDs — failed to query source tenant: ' + err.message);
  }

  // Index by GUID for O(1) lookup.
  const byGuid = new Map();
  for (const loc of sourceLocations) byGuid.set(loc.id, loc);

  // Build the GUID → placeholder map for country-type locations.
  // Multi-country locations get alphabetized ISO codes in the placeholder to
  // make the canonical form deterministic across imports.
  const guidToPlaceholder = new Map();
  for (const guid of presentGUIDs) {
    const loc = byGuid.get(guid);
    if (!loc) {
      result.skipped.push({ guid, type: 'unresolved', displayName: null });
      continue;
    }
    const odataType = loc['@odata.type'] || '';
    if (odataType === '#microsoft.graph.countryNamedLocation') {
      const codes = (loc.countriesAndRegions || []).map(c => String(c).toUpperCase()).filter(Boolean);
      if (codes.length === 0) {
        // Country-type with no codes is malformed — don't substitute.
        result.skipped.push({ guid, type: 'country-empty', displayName: loc.displayName || null });
        continue;
      }
      codes.sort();
      const placeholder = `__PANOPTICA_LOCATION_${codes.join('_')}__`;
      guidToPlaceholder.set(guid, placeholder);
    } else if (odataType === '#microsoft.graph.ipNamedLocation') {
      result.skipped.push({ guid, type: 'ip', displayName: loc.displayName || null });
    } else {
      // Future-proofing: any new @odata.type Microsoft adds falls here.
      result.skipped.push({ guid, type: odataType.replace(/^#microsoft\.graph\./, '') || 'unknown', displayName: loc.displayName || null });
    }
  }

  // Walk the arrays and substitute.
  for (const arr of [locations.includeLocations, locations.excludeLocations]) {
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== 'string') continue;
      const ph = guidToPlaceholder.get(v);
      if (ph) {
        arr[i] = ph;
        result.substitutedCount++;
      }
    }
  }

  console.log(`[CA] substituteLocationGUIDs — source tenant ${sourceAzureId.slice(0, 8)}…: substituted ${result.substitutedCount}, skipped ${result.skipped.length} (${result.skipped.map(s => s.type).join(', ') || 'none'})`);
  return result;
}

/**
 * Resolve named-location placeholders (e.g. __PANOPTICA_CANADA_LOCATION__) to
 * real GUIDs in the given tenant. If a matching location doesn't already exist,
 * one is created via Graph — this is a tenant mutation and is audited.
 *
 * @param {object}  body              Deploy/PATCH body to mutate in place
 * @param {string}  azureTenantId     Target tenant's Azure GUID
 * @param {Set<string>} [preferredGUIDs]  When duplicates match, prefer these
 * @param {object}  [auditContext]    Set this when the caller has request/operator
 *                                    context. Shape: { internalTenantId, createdBy,
 *                                    actorContext? }. If internalTenantId is absent,
 *                                    new-location creations are NOT logged — this
 *                                    is only correct for callers that have no audit
 *                                    surface (none currently; always pass one).
 */
async function resolveNamedLocationPlaceholders(body, azureTenantId, preferredGUIDs, auditContext) {
  // Find which placeholders are present (generic __PANOPTICA_LOCATION_<ISO[_ISO...]>__
  // and legacy __PANOPTICA_CANADA_LOCATION__).
  const found = findPlaceholdersInBody(body);
  if (found.length === 0) return;

  // Cache lookup per placeholder canonical string.
  const uncached = [];
  for (const ph of found) {
    const cached = getCachedLocation(azureTenantId, ph.canonical);
    if (cached) {
      replacePlaceholderInObject(body, ph.canonical, cached);
    } else {
      uncached.push(ph);
    }
  }
  if (uncached.length === 0) return;

  // Fetch named locations from tenant (only when cache misses).
  let existingLocations = [];
  try {
    const resp = await graph.callGraph(
      azureTenantId,
      '/identity/conditionalAccess/namedLocations',
      { version: 'v1.0', method: 'GET' }
    );
    existingLocations = resp.value || [];
  } catch (err) {
    console.error('[CA] Failed to fetch named locations:', err.message);
    throw new Error('Cannot resolve named-location placeholders — failed to fetch existing locations: ' + err.message);
  }

  for (const ph of uncached) {
    let locationId = null;

    // Find existing countryNamedLocation whose countriesAndRegions exactly
    // matches the placeholder's country code set (order-insensitive).
    const wantCountries = ph.countries.map(c => c.toUpperCase()).sort();
    const wantStr = JSON.stringify(wantCountries);
    const allMatches = existingLocations.filter(loc => {
      if (loc['@odata.type'] !== '#microsoft.graph.countryNamedLocation') return false;
      const locCountries = (loc.countriesAndRegions || []).map(c => c.toUpperCase()).sort();
      return JSON.stringify(locCountries) === wantStr;
    });

    // If multiple matches exist (e.g., Panoptica created a duplicate), prefer the one
    // already referenced by the live policy. Avoids phantom drift.
    let match = null;
    if (allMatches.length > 1 && preferredGUIDs && preferredGUIDs.size > 0) {
      match = allMatches.find(loc => preferredGUIDs.has(loc.id));
      if (match) {
        console.log(`[CA] Resolved ${ph.canonical} → ${match.displayName} (${match.id}) — preferred live-policy GUID [tenant ${azureTenantId.slice(0, 8)}]`);
      }
    }
    if (!match && allMatches.length > 0) {
      match = allMatches[0];
      if (allMatches.length > 1) {
        console.warn(`[CA] Multiple named locations match ${ph.canonical} in tenant ${azureTenantId.slice(0, 8)}… — using first: "${match.displayName}" (${match.id}). Consider deleting the duplicate.`);
      }
    }

    if (match) {
      locationId = match.id;
      console.log(`[CA] Resolved ${ph.canonical} → ${match.displayName} (${locationId}) [tenant ${azureTenantId.slice(0, 8)}]`);
    } else {
      // Create the named location with a Panoptica-branded displayName —
      // this makes it easy for MSPs to identify Panoptica-created locations
      // in Entra. The country codes are what drive behavior; the display
      // name is cosmetic.
      const createDisplayName = `Panoptica — ${ph.displayName}`;
      console.log(`[CA] Creating named location "${createDisplayName}" (${ph.countries.join(', ')}) in tenant ${azureTenantId}`);
      try {
        const created = await graph.callGraph(
          azureTenantId,
          '/identity/conditionalAccess/namedLocations',
          {
            version: 'v1.0',
            method: 'POST',
            body: {
              '@odata.type': '#microsoft.graph.countryNamedLocation',
              displayName: createDisplayName,
              countriesAndRegions: ph.countries,
              includeUnknownCountriesAndRegions: false,
            },
          }
        );
        locationId = created.id;
        console.log(`[CA] Created named location "${createDisplayName}" (${locationId}) in tenant ${azureTenantId}`);

        if (auditContext && auditContext.internalTenantId) {
          try {
            await changeLog.logPanopticaChange({
              tenantId: auditContext.internalTenantId,
              category: changeLog.CATEGORY.NAMED_LOCATION_CREATE,
              surfaces: [changeLog.SURFACE.NAMED_LOCATIONS, changeLog.SURFACE.CA],
              description: `Created named location "${createDisplayName}" (${ph.countries.join(', ')}) as side-effect of CA policy push/remediate`,
              templateKey: 'named_location.create',
              templateParams: { locationName: createDisplayName, countries: ph.countries.join(', ') },
              createdBy: auditContext.createdBy || 'panoptica-system',
              ...(auditContext.actorContext || {}),
            });
          } catch (logErr) {
            console.warn(`[CA] Named-location creation audit log failed (non-fatal): ${logErr.message}`);
          }
        }
      } catch (err) {
        console.error(`[CA] Failed to create named location "${createDisplayName}":`, err.message);
        throw new Error(`Cannot create named location "${createDisplayName}" in tenant: ${err.message}`);
      }
    }

    // Cache and replace.
    setCachedLocation(azureTenantId, ph.canonical, locationId);
    replacePlaceholderInObject(body, ph.canonical, locationId);
  }
}

/**
 * Cross-tenant named-location GUID translation.
 *
 * Problem: A template created from Tenant A stores real GUIDs for named locations
 * (e.g., "Canada" = 12c07ee4-... in Tenant A). When comparing against Tenant B,
 * where "Canada" = 1022d5e9-..., the GUIDs don't match → phantom drift.
 *
 * Solution: After resolving __PLACEHOLDER__ strings, scan includeLocations and
 * excludeLocations arrays for GUIDs that don't exist in the target tenant's
 * named locations. For each foreign GUID, try to match by country codes against
 * the target tenant and swap it.
 *
 * This runs during drift check and remediation to ensure the template's location
 * GUIDs are always expressed in the target tenant's terms.
 */
async function resolveHardcodedLocationGUIDs(body, azureTenantId) {
  const locations = body?.conditions?.locations;
  if (!locations) return;

  const locationArrays = [];
  if (Array.isArray(locations.includeLocations)) locationArrays.push(locations.includeLocations);
  if (Array.isArray(locations.excludeLocations)) locationArrays.push(locations.excludeLocations);

  // Collect all GUIDs that look like named-location IDs (not 'All', 'AllTrusted', 'None', placeholders)
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const foreignGUIDs = new Set();
  for (const arr of locationArrays) {
    for (const val of arr) {
      if (guidPattern.test(val)) foreignGUIDs.add(val);
    }
  }
  if (foreignGUIDs.size === 0) return;

  // Fetch target tenant's named locations (use cache if available)
  let targetLocations;
  const cacheKey = `_locations_${azureTenantId}`;
  const cached = _namedLocationCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < NAMED_LOCATION_CACHE_TTL) {
    targetLocations = cached.locations;
  } else {
    try {
      const resp = await graph.callGraph(
        azureTenantId,
        '/identity/conditionalAccess/namedLocations',
        { version: 'v1.0', method: 'GET' }
      );
      targetLocations = resp.value || [];
      _namedLocationCache.set(cacheKey, { locations: targetLocations, ts: Date.now() });
    } catch (err) {
      console.warn(`[CA] Cannot fetch named locations for GUID translation: ${err.message}`);
      return; // Non-fatal — drift check proceeds with untranslated GUIDs
    }
  }

  // Build lookup: target tenant's GUIDs
  const targetGUIDSet = new Set(targetLocations.map(l => l.id));

  // For each foreign GUID, try to find equivalent in target tenant by country codes
  for (const guid of foreignGUIDs) {
    if (targetGUIDSet.has(guid)) continue; // This GUID belongs to target tenant — no translation needed

    let replacement = null;

    // Strategy 1 (removed 2026-04-20): the prior implementation matched against
    // a hardcoded NAMED_LOCATION_PLACEHOLDERS map. With the placeholder system
    // now generic (__PANOPTICA_LOCATION_<ISO>__), there is no static list to
    // iterate — the country codes live inside the placeholder string itself,
    // which is handled upstream in resolveNamedLocationPlaceholders(). This
    // function only runs for templates that still contain raw foreign GUIDs
    // (i.e. pre-refactor artifacts), so we fall straight through to the
    // sole-country-location heuristic below.

    // Strategy 2: best-effort displayName / single-country match — find a
    // country-type named location in the target tenant. When there's exactly
    // one country-based named location and one foreign GUID, the mapping is
    // unambiguous.
    if (!replacement) {
      const countryLocations = targetLocations.filter(l =>
        l['@odata.type'] === '#microsoft.graph.countryNamedLocation'
      );
      if (countryLocations.length === 1 && foreignGUIDs.size === 1) {
        replacement = countryLocations[0].id;
        console.log(`[CA] GUID ${guid.slice(0, 8)}… matched sole country location "${countryLocations[0].displayName}" → ${replacement.slice(0, 8)}… [tenant ${azureTenantId.slice(0, 8)}]`);
      }
    }

    if (replacement) {
      // Replace in all location arrays
      for (const arr of locationArrays) {
        const idx = arr.indexOf(guid);
        if (idx !== -1) {
          arr[idx] = replacement;
        }
      }
    } else {
      console.warn(`[CA] Could not translate foreign GUID ${guid} for tenant ${azureTenantId.slice(0, 8)}… — ${targetLocations.length} named location(s) available, types: ${targetLocations.map(l => l['@odata.type']?.split('.').pop()).join(', ')}`);
    }
  }
}

/**
 * Recursively replace a placeholder string value with a real value in an object.
 */
function replacePlaceholderInObject(obj, placeholder, replacement) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'string' && obj[key] === placeholder) {
      obj[key] = replacement;
    } else if (Array.isArray(obj[key])) {
      for (let i = 0; i < obj[key].length; i++) {
        if (typeof obj[key][i] === 'string' && obj[key][i] === placeholder) {
          obj[key][i] = replacement;
        } else if (typeof obj[key][i] === 'object') {
          replacePlaceholderInObject(obj[key][i], placeholder, replacement);
        }
      }
    } else if (typeof obj[key] === 'object') {
      replacePlaceholderInObject(obj[key], placeholder, replacement);
    }
  }
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/**
 * Extract human-readable fields from a CA policy JSON for display.
 */
function extractPolicyFields(policy) {
  const state = policy.state || 'unknown';

  // Grant controls
  let grantControls = 'None';
  const gc = policy.grantControls;
  if (gc) {
    const controls = [];
    if (gc.builtInControls?.includes('mfa')) controls.push('Require MFA');
    if (gc.builtInControls?.includes('compliantDevice')) controls.push('Require compliant device');
    if (gc.builtInControls?.includes('domainJoinedDevice')) controls.push('Require Hybrid Azure AD joined');
    if (gc.builtInControls?.includes('approvedApplication')) controls.push('Require approved app');
    if (gc.builtInControls?.includes('passwordChange')) controls.push('Require password change');
    if (gc.authenticationStrength) controls.push(`Auth strength: ${gc.authenticationStrength.displayName || 'custom'}`);
    if (controls.length > 0) {
      grantControls = controls.join(', ');
      if (gc.operator) grantControls += ` (${gc.operator})`;
    }
  }

  // Target users
  let targetUsers = 'Specific users/groups';
  const users = policy.conditions?.users;
  if (users) {
    if (users.includeUsers?.includes('All')) targetUsers = 'All users';
    else if (users.includeUsers?.includes('GuestsOrExternalUsers')) targetUsers = 'Guests/External users';
    else if (users.includeGroups?.length) targetUsers = `${users.includeGroups.length} group(s)`;
  }

  // Target apps
  let targetApps = 'Specific apps';
  const apps = policy.conditions?.applications;
  if (apps) {
    if (apps.includeApplications?.includes('All')) targetApps = 'All cloud apps';
    else if (apps.includeApplications?.includes('Office365')) targetApps = 'Office 365';
    else if (apps.includeApplications?.length) targetApps = `${apps.includeApplications.length} app(s)`;
  }

  // Conditions summary
  const condParts = [];
  if (policy.conditions?.platforms?.includePlatforms?.length) {
    condParts.push(`Platforms: ${policy.conditions.platforms.includePlatforms.join(', ')}`);
  }
  if (policy.conditions?.locations?.includeLocations?.length) {
    condParts.push(`Locations: ${policy.conditions.locations.includeLocations.length} location(s)`);
  }
  if (policy.conditions?.signInRiskLevels?.length) {
    condParts.push(`Sign-in risk: ${policy.conditions.signInRiskLevels.join(', ')}`);
  }
  if (policy.conditions?.userRiskLevels?.length) {
    condParts.push(`User risk: ${policy.conditions.userRiskLevels.join(', ')}`);
  }
  const conditionsSummary = condParts.length > 0 ? condParts.join(' | ') : 'No extra conditions';

  return { state, grantControls, targetUsers, targetApps, conditionsSummary };
}

/**
 * Fetch live Conditional Access policies from Graph API for a tenant.
 */
async function fetchLivePolicies(azureTenantId) {
  try {
    const data = await graph.callGraph(
      azureTenantId,
      '/identity/conditionalAccess/policies',
      { version: 'v1.0' }
    );
    return data?.value || [];
  } catch (err) {
    console.error(`[CA] Failed to fetch live policies for ${azureTenantId}:`, err.message);
    throw err;
  }
}

// ─── Phase 10: Accept Drift helpers (mirrors Intune Phase 9) ───

function canonicalJsonStringify(obj) {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

function computeCaDriftHash(drifts) {
  if (!Array.isArray(drifts) || drifts.length === 0) return null;
  const sorted = [...drifts].sort((a, b) => String(a.field || '').localeCompare(String(b.field || '')));
  return crypto.createHash('sha256').update(canonicalJsonStringify(sorted)).digest('hex');
}

/**
 * Get a value from a nested object using a dot-path string.
 * e.g. getNestedValue(obj, 'grantControls.builtInControls') → ['mfa']
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Deep compare two values (handles arrays, objects, primitives).
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // Sort arrays for comparison (CA policy arrays are unordered sets)
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, i) => deepEqual(val, sortedB[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Run drift detection for a single assignment.
 */
async function checkDrift(assignment) {
  const templatePolicy = typeof assignment.policy_json === 'string'
    ? JSON.parse(assignment.policy_json)
    : assignment.policy_json;

  const monitoredFields = typeof assignment.monitored_fields === 'string'
    ? JSON.parse(assignment.monitored_fields)
    : assignment.monitored_fields || [];

  // If no live policy linked, try auto-match first
  if (!assignment.live_policy_id) {
    const livePolicies = await fetchLivePolicies(assignment.azure_tenant_id);
    const match = livePolicies.find(p =>
      p.displayName?.toLowerCase() === templatePolicy.displayName?.toLowerCase()
    );

    if (match) {
      assignment.live_policy_id = match.id;
      await db.execute(
        'UPDATE ca_assignments SET live_policy_id = ? WHERE id = ?',
        [match.id, assignment.id]
      );
      console.log(`[CA] Auto-linked assignment ${assignment.id} to policy "${match.displayName}" during drift check`);
    } else {
      // Policy doesn't exist in tenant
      await db.execute(
        `UPDATE ca_assignments SET drift_status = 'missing', last_checked_at = NOW(),
         drift_details = ? WHERE id = ?`,
        [JSON.stringify({ reason: 'No matching policy found in tenant' }), assignment.id]
      );
      await db.insert(
        `INSERT INTO ca_drift_log (assignment_id, drift_type) VALUES (?, 'policy_missing')`,
        [assignment.id]
      );
      return {
        assignment_id: assignment.id,
        drift_status: 'missing',
        message: `No live policy matching "${templatePolicy.displayName}" found in tenant`,
      };
    }
  }

  // Fetch the specific live policy BEFORE resolving placeholders — we need the live
  // policy's location GUIDs to break ties when a tenant has multiple named locations
  // with the same country codes (e.g., two "Canada" locations).
  let livePolicy;
  try {
    livePolicy = await graph.callGraph(
      assignment.azure_tenant_id,
      `/identity/conditionalAccess/policies/${assignment.live_policy_id}`,
      { version: 'v1.0' }
    );
  } catch (err) {
    if (err.statusCode === 404) {
      await db.execute(
        `UPDATE ca_assignments SET drift_status = 'missing', live_policy_id = NULL,
         last_checked_at = NOW(), drift_details = ? WHERE id = ?`,
        [JSON.stringify({ reason: 'Policy was deleted from tenant' }), assignment.id]
      );
      await db.insert(
        `INSERT INTO ca_drift_log (assignment_id, drift_type) VALUES (?, 'policy_deleted')`,
        [assignment.id]
      );
      return {
        assignment_id: assignment.id,
        drift_status: 'missing',
        message: 'Policy has been deleted from the tenant',
      };
    }
    throw err;
  }

  // Resolve named-location placeholders AFTER fetching the live policy.
  // Pass the live policy's location GUIDs as hints so the resolver picks the
  // correct named location when the tenant has duplicates (e.g., Panoptica
  // created a second "Canada" location alongside the tenant's original one).
  const resolvedTemplate = JSON.parse(JSON.stringify(templatePolicy));
  const liveLocationHints = collectLocationGUIDs(livePolicy);
  try {
    // Drift scanner runs without request context. Named-location creation
    // from this path is rare but possible (placeholder in template not yet
    // realized in tenant). Log such creations as system-initiated.
    await resolveNamedLocationPlaceholders(resolvedTemplate, assignment.azure_tenant_id, liveLocationHints, {
      internalTenantId: assignment.tenant_id,
      createdBy: 'panoptica-scheduler',
    });
    await resolveHardcodedLocationGUIDs(resolvedTemplate, assignment.azure_tenant_id);
  } catch (err) {
    console.warn(`[CA] Could not resolve placeholders for drift check: ${err.message}`);
  }

  // Compare monitored fields (using resolved template with real GUIDs)
  const drifts = [];
  for (const fieldPath of monitoredFields) {
    const expected = getNestedValue(resolvedTemplate, fieldPath);
    const actual = getNestedValue(livePolicy, fieldPath);

    if (expected !== undefined && !deepEqual(expected, actual)) {
      console.log(`[CA:Drift] Field "${fieldPath}" drifted for assignment ${assignment.id} (${assignment.template_name}):`);
      console.log(`  expected: ${JSON.stringify(expected)}`);
      console.log(`  actual:   ${JSON.stringify(actual)}`);
      drifts.push({
        field: fieldPath,
        expected: expected,
        actual: actual,
      });
    }
  }

  // Phase 10: three-state transition with acknowledged-drift hash
  //   no drifts                                → 'ok'       (clear acknowledged state)
  //   drifts AND hash matches acknowledged     → 'accepted' (no alert, no remediation)
  //   drifts AND hash does NOT match (or null) → 'drifted'  (fire alert, remediate if enabled)
  let driftStatus;
  let remediated = false;
  const currentHash = computeCaDriftHash(drifts);

  if (drifts.length === 0) {
    driftStatus = 'ok';
    // Capture whether this assignment was previously in the 'accepted' state so
    // the silent transition to 'ok' leaves an audit trail. Without this log, a
    // tenant config restore that extinguishes an active exemption disappears
    // from the Change Log view entirely.
    const wasAcceptedDrift = !!assignment.acknowledged_drift_hash;
    const priorAcceptedBy = assignment.acknowledged_by || null;
    await db.execute(
      `UPDATE ca_assignments
          SET drift_status = 'ok',
              drift_details = NULL,
              last_checked_at = NOW(),
              acknowledged_drift_hash = NULL,
              acknowledged_drift_payload = NULL,
              acknowledged_at = NULL,
              acknowledged_by = NULL
        WHERE id = ?`,
      [assignment.id]
    );
    if (wasAcceptedDrift) {
      console.log(`[CA:Drift] Assignment ${assignment.id} ("${assignment.template_name}") transitioned accepted→ok; auto-revoking drift acceptance (original acceptor: ${priorAcceptedBy || 'unknown'}).`);
      try {
        await changeLog.logPanopticaChange({
          tenantId: assignment.tenant_id,
          category: changeLog.CATEGORY.EXEMPTION_REVOKE,
          surfaces: [changeLog.SURFACE.CA],
          description: `Auto-revoked accepted CA drift on "${assignment.template_name}" — tenant configuration now matches template${priorAcceptedBy ? ` (originally accepted by ${priorAcceptedBy})` : ''}`,
          templateKey: 'exemption.revoke',
          templateParams: { settingName: assignment.template_name },
          createdBy: 'panoptica-system',
        });
      } catch (logErr) {
        console.warn(`[CA:Drift] Audit log for auto-revoke failed (non-fatal): ${logErr.message}`);
      }
    }
  } else if (assignment.acknowledged_drift_hash && currentHash === assignment.acknowledged_drift_hash) {
    driftStatus = 'accepted';
    await db.execute(
      `UPDATE ca_assignments
          SET drift_status = 'accepted',
              drift_details = ?,
              last_checked_at = NOW()
        WHERE id = ?`,
      [JSON.stringify(drifts), assignment.id]
    );
    // No alert, no remediation — drift was intentionally accepted
  } else {
    driftStatus = 'drifted';
    await db.execute(
      `UPDATE ca_assignments
          SET drift_status = 'drifted',
              drift_details = ?,
              last_checked_at = NOW()
        WHERE id = ?`,
      [JSON.stringify(drifts), assignment.id]
    );

    // Log each drift
    for (const drift of drifts) {
      const expectedStr = drift.expected !== undefined ? JSON.stringify(drift.expected) : null;
      const actualStr = drift.actual !== undefined ? JSON.stringify(drift.actual) : null;
      await db.insert(
        `INSERT INTO ca_drift_log (assignment_id, drift_type, field_path, expected_value, actual_value)
         VALUES (?, 'field_changed', ?, ?, ?)`,
        [assignment.id, drift.field, expectedStr, actualStr]
      );
    }

    // v0.1.16 (2026-05-25): auto-remediation REMOVED from the scheduler.
    //
    // The previous block called remediatePolicy() when assignment.enforcement
    // === 'remediate'. The NON_REMEDIABLE_FIELDS denylist was supposed to keep
    // excludeUsers/excludeGroups safe by omitting them from the PATCH body, but
    // Microsoft Graph PATCH semantics on a nested object (conditions.users)
    // REPLACE the whole sub-object with whatever is sent. Omitting excludeUsers
    // therefore caused Graph to clear it to []. Confirmed in production
    // 2026-05-25: 9 user-exclusions wiped across 5 tenants in a single drift
    // cycle right after v0.1.15 deployed (which had enabled drift detection on
    // the Canada template's excludeUsers field).
    //
    // The operator-facing model now matches Intune: drift is DETECTED and
    // alerted, then the operator either (a) accepts it via the Accept Drift
    // button (orange ACCEPTED state, suppressed via SHA-256 hash) or (b)
    // explicitly clicks "Push Template" on the CA tile — manual remediate via
    // POST /api/ca/assignments/:id/remediate, with a strong confirm dialog
    // that calls out the wipe-on-PATCH semantics. The enforcement column is
    // left in place for backward compat but is never read by the scheduler.

    // Create alert
    try {
      await createDriftAlert(assignment, drifts, remediated);
    } catch (err) {
      console.error(`[CA] Failed to create drift alert for assignment ${assignment.id}:`, err.message);
    }
  }

  return {
    assignment_id: assignment.id,
    drift_status: driftStatus,
    drifts: drifts,
    remediated: remediated,
    live_policy: {
      id: livePolicy.id,
      displayName: livePolicy.displayName,
      state: livePolicy.state,
    },
  };
}

/**
 * Fields that may appear in a template's monitored_fields for drift DETECTION,
 * but must NEVER be pushed to the live policy by auto-remediation because they
 * are intrinsically per-tenant customizations.
 *
 * Incident of record: 2026-04-18. Appending conditions.users.excludeUsers and
 * excludeGroups to every template's monitored_fields (to power the new
 * exemption-aware suppression feature) caused the next drift cycle on every
 * remediate-mode assignment to PATCH `excludeUsers: []` (the empty template
 * value) onto live policies — wiping ~22 intentionally-excluded UPNs at
 * Cuisi-N-Art's "Require MFA for all users" and 2 UPNs at Tatum's "Canada only".
 *
 * Policy: detection stays on (we WANT drift alerts when exemption lists change
 * at a tenant — that's the signal feeding accept-drift-as-exemption). But the
 * remediation action for these paths is always a no-op. If a whole drift is
 * composed solely of non-remediable field changes, we skip the PATCH entirely
 * and the alert stays as "drift detected" (not "auto-remediated").
 *
 * Keep this set tight. Only add a path here if the field is per-tenant by
 * DESIGN — not merely "customers sometimes tweak it".
 */
const NON_REMEDIABLE_FIELDS = new Set([
  'conditions.users.excludeUsers',
  'conditions.users.excludeGroups',
]);

/**
 * Remediate a drifted policy — PATCH the live policy back to template values.
 * Only patches the monitored fields that have drifted AND that aren't on the
 * NON_REMEDIABLE_FIELDS denylist. Returns { success, skipped?, message } —
 * `skipped: true` means no PATCH was issued because every monitored field was
 * per-tenant (caller should NOT mark the alert as "auto-remediated").
 */
async function remediatePolicy(assignment, livePolicy, createdBy = 'panoptica-scheduler', actorContext = {}) {
  const templatePolicy = typeof assignment.policy_json === 'string'
    ? JSON.parse(assignment.policy_json)
    : assignment.policy_json;

  const monitoredFields = typeof assignment.monitored_fields === 'string'
    ? JSON.parse(assignment.monitored_fields)
    : assignment.monitored_fields || [];

  // Resolve placeholders so we patch with real GUIDs, not placeholders.
  // Pass live policy hints to prefer the GUID already in the live policy when
  // the tenant has duplicate named locations with the same country codes.
  const resolvedTemplate = JSON.parse(JSON.stringify(templatePolicy));
  const liveHints = livePolicy ? collectLocationGUIDs(livePolicy) : undefined;
  await resolveNamedLocationPlaceholders(resolvedTemplate, assignment.azure_tenant_id, liveHints, {
    internalTenantId: assignment.tenant_id,
    createdBy,
    actorContext,
  });
  await resolveHardcodedLocationGUIDs(resolvedTemplate, assignment.azure_tenant_id);

  // Build the PATCH body — only include monitored fields that are NOT
  // per-tenant. Skipped paths are logged so the operator can see why remediation
  // chose not to touch a drift it otherwise detected.
  const patchBody = {};
  const skippedPerTenantFields = [];
  for (const fieldPath of monitoredFields) {
    if (NON_REMEDIABLE_FIELDS.has(fieldPath)) {
      skippedPerTenantFields.push(fieldPath);
      continue;
    }
    const value = getNestedValue(resolvedTemplate, fieldPath);
    if (value !== undefined) {
      setNestedValue(patchBody, fieldPath, value);
    }
  }

  if (skippedPerTenantFields.length > 0) {
    console.log(`[CA] Remediation skipped per-tenant fields on assignment ${assignment.id}: ${skippedPerTenantFields.join(', ')}`);
  }

  // If every monitored field was per-tenant (nothing to PATCH), short-circuit.
  // Drift stays "drifted" — we don't claim remediation success and we don't
  // reset drift_status. The detected-drift alert is the correct signal; the
  // operator will resolve it by accepting it as an exemption or by editing the
  // template, not by auto-patching.
  if (Object.keys(patchBody).length === 0) {
    console.log(`[CA] Remediation no-op on assignment ${assignment.id} — all drifted monitored fields are on NON_REMEDIABLE_FIELDS. Drift stays flagged.`);
    await db.execute(
      `UPDATE ca_assignments SET last_checked_at = NOW() WHERE id = ?`,
      [assignment.id]
    );
    return { success: true, skipped: true, message: 'No remediable fields — drift left flagged for operator review' };
  }

  console.log(`[CA] Remediating policy ${assignment.live_policy_id} with:`, JSON.stringify(patchBody, null, 2));

  await graph.callGraph(
    assignment.azure_tenant_id,
    `/identity/conditionalAccess/policies/${assignment.live_policy_id}`,
    { version: 'v1.0', method: 'PATCH', body: patchBody }
  );

  // Log remediation
  await db.insert(
    `INSERT INTO ca_drift_log (assignment_id, drift_type, remediated)
     VALUES (?, 'remediated', TRUE)`,
    [assignment.id]
  );

  // Re-check drift after remediation. Note: if we patched SOME fields but
  // skipped per-tenant ones, resetting drift_status='ok' is slightly
  // optimistic — the per-tenant drift technically persists. The next drift
  // cycle (60 min) will re-flag it. Acceptable for now; revisit if noise.
  await db.execute(
    `UPDATE ca_assignments SET drift_status = 'ok', drift_details = NULL,
     last_checked_at = NOW() WHERE id = ?`,
    [assignment.id]
  );

  console.log(`[CA] Remediated assignment ${assignment.id} — policy ${assignment.live_policy_id} patched`);

  // Audit + drift-attribution: log the Panoptica-initiated remediation
  await changeLog.logPanopticaChange({
    tenantId: assignment.tenant_id,
    category: changeLog.CATEGORY.REMEDIATION_RUN,
    surfaces: [changeLog.SURFACE.CA],
    description: `Remediated CA drift on "${assignment.template_name || 'policy ' + assignment.live_policy_id}" (fields: ${Object.keys(patchBody).join(', ')})`,
    templateKey: 'remediation',
    templateParams: { settingName: assignment.template_name || `policy ${assignment.live_policy_id}` },
    createdBy,
    ...actorContext,
  });

  return { success: true, message: 'Policy remediated successfully' };
}

/**
 * Set a value in a nested object using a dot-path string.
 * e.g. setNestedValue(obj, 'grantControls.builtInControls', ['mfa'])
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

// ─── Phase 10: Accept Drift endpoint (mirrors Intune Phase 9) ───

router.post('/accept-drift/:assignmentId', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const assignmentId = parseInt(req.params.assignmentId, 10);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const assignment = await db.queryOne(
      'SELECT * FROM ca_assignments WHERE id = ?',
      [assignmentId]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.drift_status !== 'drifted') {
      return res.status(400).json({
        error: `Cannot accept drift on assignment in '${assignment.drift_status}' state — only 'drifted' is acceptable`,
      });
    }
    if (!assignment.drift_details) {
      return res.status(400).json({ error: 'Assignment has no drift_details to accept' });
    }

    let drifts;
    try {
      drifts = typeof assignment.drift_details === 'string'
        ? JSON.parse(assignment.drift_details)
        : assignment.drift_details;
    } catch (parseErr) {
      return res.status(500).json({ error: `Failed to parse drift_details: ${parseErr.message}` });
    }
    if (!Array.isArray(drifts) || drifts.length === 0) {
      return res.status(400).json({ error: 'drift_details is not a non-empty array' });
    }

    const hash = computeCaDriftHash(drifts);
    const actor = req.session?.user?.email || 'unknown';
    const acceptedAt = new Date();

    await db.execute(
      `UPDATE ca_assignments
          SET drift_status = 'accepted',
              acknowledged_drift_hash = ?,
              acknowledged_drift_payload = ?,
              acknowledged_at = ?,
              acknowledged_by = ?
        WHERE id = ?`,
      [hash, JSON.stringify(drifts), acceptedAt, actor, assignmentId]
    );

    // Auto-resolve any matching open drift alert (best-effort)
    let resolvedAlertId = null;
    try {
      const dedupKey = `ca_drift_${assignmentId}_det`;
      const openAlert = await db.queryOne(
        `SELECT id FROM alerts
          WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating')
          LIMIT 1`,
        [assignment.tenant_id, dedupKey]
      );
      if (openAlert) {
        const note = `<p><em>Drift accepted as intended state by ${actor} at ${acceptedAt.toISOString()}.</em></p>`;
        await db.execute(
          `UPDATE alerts
              SET status = 'resolved',
                  closed_at = NOW(),
                  notes = CONCAT(COALESCE(notes, ''), ?)
            WHERE id = ?`,
          [note, openAlert.id]
        );
        resolvedAlertId = openAlert.id;
        console.log(`[CA] Auto-resolved alert ${openAlert.id} via accept-drift on assignment ${assignmentId}`);
      }
    } catch (alertErr) {
      console.warn(`[CA] Failed to auto-resolve alert for accept-drift: ${alertErr.message}`);
    }

    // Log acceptance
    await db.insert(
      `INSERT INTO ca_drift_log (assignment_id, drift_type) VALUES (?, 'drift_accepted')`,
      [assignmentId]
    ).catch(() => {});

    console.log(`[CA] Drift accepted for assignment ${assignmentId} by ${actor} (hash: ${hash?.slice(0, 12)}...)`);

    // Audit: operator explicitly accepted drift — not a Graph mutation, but a
    // Panoptica-side state change worth recording on the tenant timeline.
    await changeLog.logPanopticaChange({
      tenantId: assignment.tenant_id,
      category: changeLog.CATEGORY.EXEMPTION_APPLY,
      surfaces: [changeLog.SURFACE.CA],
      description: `Accepted CA drift as intended state (assignment ${assignmentId}, ${drifts.length} field${drifts.length !== 1 ? 's' : ''})`,
      templateKey: 'exemption.apply',
      templateParams: { settingName: `CA assignment ${assignmentId}`, expiresAt: 'never (intended state)' },
      createdBy: actor,
      ...changeLog.captureActorContext(req),
    });

    res.json({
      ok: true,
      assignment_id: assignmentId,
      drift_status: 'accepted',
      acknowledged_drift_hash: hash,
      acknowledged_at: acceptedAt.toISOString(),
      acknowledged_by: actor,
      resolved_alert_id: resolvedAlertId,
    });
  } catch (err) {
    console.error('[CA] Accept drift failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Phase 11: Accept Drift AS EXEMPTION — persistent user/group exemption
// ═══════════════════════════════════════════════════════════════
//
// Differs from /accept-drift/:assignmentId in that it creates rows in
// ca_exemptions for every principal currently in conditions.users.excludeUsers
// / excludeGroups. The alert engine then suppresses evaluators whose
// depends_on_controls list intersects the template's control_dimensions
// for any UPN in that (transitively resolved) set.
//
// Requires: (eventual) requireMemberOrAdmin role gate — see canAcceptExemption
// stub below. Until RBAC ships, any authenticated user can accept.

/**
 * Role check — Admin + Member can accept exemptions; Viewers cannot.
 * Decision locked 2026-04-18; wired to real RBAC 2026-04-28 via
 * `auth.canMemberOrAdmin` (single source of truth shared with api-intune.js).
 *
 * Fails closed: viewer or unresolved role returns false.
 */
function canAcceptExemption(req) {
  return auth.canMemberOrAdmin(req);
}

/**
 * POST /api/ca/assignments/:assignmentId/accept-drift-as-exemption
 * Body: { expiry_days?: 180, reason: string, principals?: [ {type, id, label} ] }
 *
 * If `principals` is omitted, the endpoint introspects the assignment's
 * live policy and grants exemption to every principal currently in
 * conditions.users.excludeUsers + conditions.users.excludeGroups.
 */
router.post('/assignments/:assignmentId/accept-drift-as-exemption', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    if (!canAcceptExemption(req)) {
      return res.status(403).json({ error: 'Insufficient role — Admin or Member required' });
    }

    const assignmentId = parseInt(req.params.assignmentId, 10);
    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const { expiry_days, reason, principals } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({ error: 'reason is required (≥3 chars)' });
    }
    const days = Number.isFinite(expiry_days) && expiry_days > 0 && expiry_days <= 365
      ? expiry_days
      : 180; // Design default — see project_exemption_system_design.md

    const assignment = await db.queryOne(
      `SELECT a.*, tn.tenant_id AS azure_tenant_id, t.name AS template_name,
              t.control_dimensions
         FROM ca_assignments a
         JOIN tenants tn ON tn.id = a.tenant_id
         JOIN ca_templates t ON t.id = a.template_id
        WHERE a.id = ?`,
      [assignmentId]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    // Gather principals to exempt
    let toExempt = Array.isArray(principals) ? principals : [];
    if (toExempt.length === 0) {
      // Introspect live policy to find the current exemption list
      if (!assignment.live_policy_id) {
        return res.status(400).json({ error: 'Assignment has no live policy; cannot introspect exemptions' });
      }
      const livePolicy = await graph.callGraph(
        assignment.azure_tenant_id,
        `/identity/conditionalAccess/policies/${encodeURIComponent(assignment.live_policy_id)}`,
        { version: 'v1.0' }
      );
      const excludeUsers = livePolicy?.conditions?.users?.excludeUsers || [];
      const excludeGroups = livePolicy?.conditions?.users?.excludeGroups || [];

      // Resolve user labels in parallel (best-effort — fall back to id)
      const userLabels = await Promise.all(excludeUsers.map(async (uid) => {
        try {
          const u = await graph.callGraph(
            assignment.azure_tenant_id,
            `/users/${encodeURIComponent(uid)}?$select=displayName,userPrincipalName`,
            { version: 'v1.0' }
          );
          return u?.userPrincipalName
            ? `${u.displayName || u.userPrincipalName} <${u.userPrincipalName}>`
            : uid;
        } catch { return uid; }
      }));
      const groupLabels = await Promise.all(excludeGroups.map(async (gid) => {
        try {
          const g = await graph.callGraph(
            assignment.azure_tenant_id,
            `/groups/${encodeURIComponent(gid)}?$select=displayName`,
            { version: 'v1.0' }
          );
          return g?.displayName || gid;
        } catch { return gid; }
      }));

      toExempt = [
        ...excludeUsers.map((id, i) => ({ type: 'user', id, label: userLabels[i] })),
        ...excludeGroups.map((id, i) => ({ type: 'group', id, label: groupLabels[i] })),
      ];
    }

    if (toExempt.length === 0) {
      return res.status(400).json({ error: 'No principals to exempt (empty excludeUsers/excludeGroups)' });
    }

    const actor = req.session?.user?.email || 'unknown';
    const acceptedAt = new Date();
    const expiresAt = new Date(acceptedAt.getTime() + days * 24 * 60 * 60 * 1000);

    // Upsert exemptions. Unique key (assignment_id, principal_type, principal_id,
    // revoked_at) means ON DUPLICATE hits only when there's an active row for
    // the same principal — refreshing the expiry is the desired behaviour.
    const inserted = [];
    for (const p of toExempt) {
      if (!p || !p.id || (p.type !== 'user' && p.type !== 'group')) continue;
      await db.execute(
        `INSERT INTO ca_exemptions
           (assignment_id, principal_type, principal_id, principal_label,
            reason, expires_at, accepted_by, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           principal_label = VALUES(principal_label),
           reason          = VALUES(reason),
           expires_at      = VALUES(expires_at),
           accepted_by     = VALUES(accepted_by),
           accepted_at     = VALUES(accepted_at)`,
        [assignmentId, p.type, p.id, p.label || null, reason, expiresAt, actor, acceptedAt]
      );
      inserted.push({ type: p.type, id: p.id, label: p.label });

      // Invalidate cached group membership so next alert eval sees the full set
      if (p.type === 'group') {
        groupResolver.invalidate(assignment.azure_tenant_id, p.id);
      }

      // Audit-log each grant
      try {
        await db.execute(
          `INSERT INTO ca_drift_log (assignment_id, drift_type, field_path, actual_value)
           VALUES (?, 'exemption_granted', ?, ?)`,
          [assignmentId,
            p.type === 'user' ? 'conditions.users.excludeUsers' : 'conditions.users.excludeGroups',
            JSON.stringify({ principal_id: p.id, label: p.label, expires_at: expiresAt, by: actor })]
        );
      } catch (_e) { /* ENUM may not yet include 'exemption_granted' if migration hasn't run */ }
    }

    // Mark drift as accepted on the assignment — same semantics as accept-drift
    if (assignment.drift_status === 'drifted' && assignment.drift_details) {
      let drifts;
      try {
        drifts = typeof assignment.drift_details === 'string'
          ? JSON.parse(assignment.drift_details)
          : assignment.drift_details;
      } catch { drifts = null; }
      if (Array.isArray(drifts) && drifts.length > 0) {
        const hash = computeCaDriftHash(drifts);
        await db.execute(
          `UPDATE ca_assignments
              SET drift_status = 'accepted',
                  acknowledged_drift_hash = ?,
                  acknowledged_drift_payload = ?,
                  acknowledged_at = ?,
                  acknowledged_by = ?
            WHERE id = ?`,
          [hash, JSON.stringify(drifts), acceptedAt, actor, assignmentId]
        );
        // Auto-resolve any matching open drift alert (best-effort)
        const dedupKey = `ca_drift_${assignmentId}_det`;
        const openAlert = await db.queryOne(
          `SELECT id FROM alerts
            WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating')
            LIMIT 1`,
          [assignment.tenant_id, dedupKey]
        );
        if (openAlert) {
          const note = `<p><em>Drift accepted as exemption by ${actor} at ${acceptedAt.toISOString()} — ${inserted.length} principal(s), expires ${expiresAt.toISOString().slice(0, 10)}.</em></p>`;
          await db.execute(
            `UPDATE alerts SET status = 'resolved', closed_at = NOW(),
                    notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?`,
            [note, openAlert.id]
          );
        }
      }
    }

    console.log(`[CA] Exemption grant on assignment ${assignmentId} by ${actor} — ${inserted.length} principal(s), expires ${expiresAt.toISOString().slice(0, 10)}`);

    // Audit: exemption grant on tenant
    await changeLog.logPanopticaChange({
      tenantId: assignment.tenant_id,
      category: changeLog.CATEGORY.EXEMPTION_APPLY,
      surfaces: [changeLog.SURFACE.CA],
      description: `Granted CA exemption on "${assignment.template_name}" — ${inserted.length} principal(s), expires ${expiresAt.toISOString().slice(0, 10)}`,
      templateKey: 'exemption.apply',
      templateParams: { settingName: assignment.template_name, expiresAt: expiresAt.toISOString().slice(0, 10) },
      createdBy: actor,
      ...changeLog.captureActorContext(req),
    });

    res.json({
      ok: true,
      assignment_id: assignmentId,
      exempted: inserted,
      expires_at: expiresAt.toISOString(),
      accepted_by: actor,
      accepted_at: acceptedAt.toISOString(),
    });
  } catch (err) {
    console.error('[CA] Accept-drift-as-exemption failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── List exemptions (global or per-tenant/assignment) ───
router.get('/exemptions', async (req, res) => {
  try {
    const { tenant_id, assignment_id, include_revoked } = req.query;
    const clauses = [];
    const params = [];
    if (tenant_id) { clauses.push('a.tenant_id = ?'); params.push(parseInt(tenant_id, 10)); }
    if (assignment_id) { clauses.push('e.assignment_id = ?'); params.push(parseInt(assignment_id, 10)); }
    if (!include_revoked) { clauses.push('e.revoked_at IS NULL'); clauses.push('e.expires_at > NOW()'); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    const rows = await db.queryRows(
      `SELECT e.id, e.assignment_id, e.principal_type, e.principal_id,
              e.principal_label, e.reason, e.expires_at, e.accepted_by,
              e.accepted_at, e.revoked_at, e.revoked_by, e.revoke_reason,
              TIMESTAMPDIFF(DAY, NOW(), e.expires_at) AS days_remaining,
              a.tenant_id, t.name AS template_name, tn.display_name AS tenant_name
         FROM ca_exemptions e
         JOIN ca_assignments a ON a.id = e.assignment_id
         JOIN ca_templates   t ON t.id = a.template_id
         JOIN tenants       tn ON tn.id = a.tenant_id
         ${where}
         ORDER BY e.expires_at ASC`,
      params
    );
    res.json({ exemptions: rows });
  } catch (err) {
    console.error('[CA] List exemptions failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Revoke a single exemption ───
router.post('/exemptions/:id/revoke', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    if (!canAcceptExemption(req)) {
      return res.status(403).json({ error: 'Insufficient role — Admin or Member required' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const actor = req.session?.user?.email || 'unknown';
    const result = await db.execute(
      `UPDATE ca_exemptions
          SET revoked_at = NOW(), revoked_by = ?, revoke_reason = 'manual'
        WHERE id = ? AND revoked_at IS NULL`,
      [actor, id]
    );
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Exemption not found or already revoked' });
    }

    const exemption = await db.queryOne(
      `SELECT e.*, a.tenant_id AS internal_tenant_id, t.name AS template_name,
              tn.tenant_id AS azure_tenant_id
         FROM ca_exemptions e
         JOIN ca_assignments a ON a.id = e.assignment_id
         JOIN ca_templates   t ON t.id = a.template_id
         JOIN tenants       tn ON tn.id = a.tenant_id
        WHERE e.id = ?`,
      [id]
    );
    if (exemption && exemption.principal_type === 'group') {
      groupResolver.invalidate(exemption.azure_tenant_id, exemption.principal_id);
    }

    try {
      await db.execute(
        `INSERT INTO ca_drift_log (assignment_id, drift_type, field_path, actual_value)
         VALUES (?, 'exemption_revoked', ?, ?)`,
        [exemption.assignment_id,
          exemption.principal_type === 'user' ? 'conditions.users.excludeUsers' : 'conditions.users.excludeGroups',
          JSON.stringify({ principal_id: exemption.principal_id, revoked_by: actor })]
      );
    } catch (_e) { /* ENUM guard — see migrate-ca-exemptions.sql */ }

    // Clear the drift acknowledgment on the assignment so the next drift cycle
    // re-raises the drift. Rationale: the live policy still contains this
    // principal in excludeUsers/excludeGroups, but there's no longer an active
    // exemption justifying that exclusion — the operator needs to be prompted
    // to either re-accept or remove the principal from the live policy in
    // Azure Portal. (NON_REMEDIABLE_FIELDS means we won't auto-PATCH.)
    // Unconditional clear is safe: if other active exemptions still exist for
    // the assignment, the re-raised drift will still be accurate (the field
    // still differs from the empty template) and the operator's next accept
    // will cover the full remaining set.
    await db.execute(
      `UPDATE ca_assignments
          SET drift_status = 'drifted',
              acknowledged_drift_hash = NULL,
              acknowledged_drift_payload = NULL,
              acknowledged_at = NULL,
              acknowledged_by = NULL
        WHERE id = ?
          AND drift_status = 'accepted'`,
      [exemption.assignment_id]
    );

    // Audit: exemption revocation
    if (exemption?.internal_tenant_id) {
      await changeLog.logPanopticaChange({
        tenantId: exemption.internal_tenant_id,
        category: changeLog.CATEGORY.EXEMPTION_REVOKE,
        surfaces: [changeLog.SURFACE.CA],
        description: `Revoked CA exemption on "${exemption.template_name}" — ${exemption.principal_type} ${exemption.principal_label || exemption.principal_id}`,
        templateKey: 'exemption.revoke',
        templateParams: { settingName: exemption.template_name },
        createdBy: actor,
        ...changeLog.captureActorContext(req),
      });
    }

    res.json({ ok: true, id, revoked_by: actor });
  } catch (err) {
    console.error('[CA] Revoke exemption failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Expire all overdue exemptions. Called by the drift scheduler on each
 * cycle. Writes an 'exemption_expired' row to ca_drift_log per expiry.
 * Idempotent — already-revoked rows are not touched.
 */
async function expireExemptions() {
  try {
    const overdue = await db.queryRows(
      `SELECT id, assignment_id, principal_type, principal_id
         FROM ca_exemptions
        WHERE revoked_at IS NULL AND expires_at <= NOW()`
    );
    if (overdue.length === 0) return 0;

    const affectedAssignments = new Set();
    for (const e of overdue) {
      await db.execute(
        `UPDATE ca_exemptions
            SET revoked_at = NOW(), revoked_by = 'system', revoke_reason = 'expired'
          WHERE id = ? AND revoked_at IS NULL`,
        [e.id]
      );
      affectedAssignments.add(e.assignment_id);
      try {
        await db.execute(
          `INSERT INTO ca_drift_log (assignment_id, drift_type, field_path, actual_value)
           VALUES (?, 'exemption_expired', ?, ?)`,
          [e.assignment_id,
            e.principal_type === 'user' ? 'conditions.users.excludeUsers' : 'conditions.users.excludeGroups',
            JSON.stringify({ principal_id: e.principal_id, auto_expired: true })]
        );
      } catch (_e) { /* ENUM guard */ }
    }

    // Clear drift acknowledgment on every assignment that just lost an
    // exemption to expiry. Rationale is identical to the manual revoke path:
    // without this, drift stays silently 'accepted' while the live policy
    // keeps the now-un-justified excludeUser/excludeGroup entry. Re-raising
    // drift forces the operator to re-accept (renew) or actually remove the
    // principal from the live policy.
    for (const assignmentId of affectedAssignments) {
      await db.execute(
        `UPDATE ca_assignments
            SET drift_status = 'drifted',
                acknowledged_drift_hash = NULL,
                acknowledged_drift_payload = NULL,
                acknowledged_at = NULL,
                acknowledged_by = NULL
          WHERE id = ?
            AND drift_status = 'accepted'`,
        [assignmentId]
      );
    }

    console.log(`[CA] Auto-expired ${overdue.length} exemption(s) across ${affectedAssignments.size} assignment(s); drift re-raised.`);
    return overdue.length;
  } catch (err) {
    console.warn(`[CA] expireExemptions failed: ${err.message}`);
    return 0;
  }
}

/**
 * Live Graph extraction of every CA policy in a tenant. Reusable by both the
 * /export/:tenantId route handler (template-import workflow) and the audit
 * tenant-snapshot bundler (so audit-only tenants get the same raw policy
 * dump that managed tenants get when an operator clicks Export). Returns
 * { policies, errors } — caller decides what to do with them.
 *
 * @param {object} tenant - { id, tenant_id, display_name } (only tenant_id used for Graph)
 * @returns {Promise<{policies: Array, errors: Array<string>}>}
 */
async function exportCaPoliciesLive(tenant) {
  const azureTenantId = tenant.tenant_id;
  const errors = [];
  let policies = [];
  try {
    policies = await graph.callGraphPaged(
      azureTenantId,
      '/identity/conditionalAccess/policies',
      { version: 'v1.0', maxPages: 10 }
    );
  } catch (err) {
    const msg = `Failed to fetch CA policies: ${err.message}`;
    console.warn(`[CA:Export] ${msg}`);
    errors.push(msg);
  }
  return { policies, errors };
}

/**
 * Live Graph extraction of named locations in a tenant. CA policies reference
 * named-location GUIDs, so the audit consumer needs them to resolve which
 * country/IP-range a CA policy applies to.
 */
async function exportNamedLocationsLive(tenant) {
  const azureTenantId = tenant.tenant_id;
  const errors = [];
  let locations = [];
  try {
    locations = await graph.callGraphPaged(
      azureTenantId,
      '/identity/conditionalAccess/namedLocations',
      { version: 'v1.0', maxPages: 5 }
    );
  } catch (err) {
    const msg = `Failed to fetch named locations: ${err.message}`;
    console.warn(`[CA:Export] ${msg}`);
    errors.push(msg);
  }
  return { locations, errors };
}

// Export router as default, plus checkDrift for the drift scheduler
router.checkDrift = checkDrift;
router.expireExemptions = expireExemptions;
router.exportCaPoliciesLive = exportCaPoliciesLive;
router.exportNamedLocationsLive = exportNamedLocationsLive;
router.schemaReady = caSchemaReady;
module.exports = router;
