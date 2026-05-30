/**
 * Panoptica — Alert Engine (Phase 3)
 * Evaluates alert policies against metric snapshots and audit logs.
 *
 * Three detection patterns:
 *   1. CHANGE DETECTION (delta) — compare current to previous snapshot, alert on differences
 *   2. THRESHOLD — count exceeds a configured value in a time window
 *   3. BASELINE COMPARISON — current value vs same day last week (volume_spike)
 *
 * Deduplication: if the same condition persists across polls, increment recurrence_count
 * on the existing open alert instead of creating a duplicate.
 *
 * AI analysis: every new alert gets a Haiku analysis (risk, explanation, recommendations).
 *
 * Required Graph API permissions (in addition to fetchers.js):
 *   ThreatHunting.Read.All — for Advanced Hunting (email threat detection)
 *
 * ─── CA Exemption-Aware Evaluators (convention, read this before adding one) ──
 *
 * Some alert conditions are CAUSED BY a Conditional Access control. If an
 * operator has explicitly excluded a user from that control (via CA
 * conditions.users.excludeUsers/excludeGroups) and Panoptica has accepted
 * the exclusion as an exemption, the corresponding alert should NOT fire
 * for that user — the exclusion IS the permission.
 *
 * To make a new evaluator exemption-aware:
 *
 *   1. Decide the control dimension(s). Each is a short lower-snake
 *      identifier (e.g. block_geographic_access, require_mfa) naming the
 *      semantic enforcement the alert depends on. Keep names stable —
 *      they are persisted in ca_templates.control_dimensions. The canonical
 *      list is in src/lib/ca-policy-classifier.js.
 *
 *   2. Tag each CA template that enforces this dimension by setting
 *      control_dimensions: ['<dim>']. Tagging is done automatically by
 *      the classifier (src/lib/ca-policy-classifier.js) — do NOT add
 *      name-LIKE migration rules. For a one-time backfill on an existing
 *      DB, run: node scripts/classify-ca-templates.js.
 *
 *   3. Tag the alert policy's detection_logic with
 *        depends_on_controls: ['<dim>']
 *      Both the migration file and seed-policies.sql must be updated so
 *      existing and fresh tenants both get the declaration.
 *
 *   4. In the evaluator, inline the filter after the candidate list is
 *      built. Copy the shape from foreignLogin (≈ line 1800) or
 *      evaluateMfaDisabled. The shape is: read logic.depends_on_controls,
 *      for each candidate extract the UPN, look it up in
 *      ctx.exemptedUpnsByControl.get(dim); on hit, call
 *      exemptionResolver.logSuppression (fire-and-forget) and drop the
 *      candidate. Write a one-line console.log at SUPPRESSED level so the
 *      operator trace is consistent across evaluators.
 *
 * When NOT to wire an evaluator:
 *   - The alert is caused by a Microsoft service outside CA (e.g. Defender
 *     XDR email-threat signals, identity-protection risk detections). These
 *     fire regardless of CA exclusions and mixing the concerns is wrong.
 *   - The alert detects changes to CA policies themselves (drift/monitored
 *     fields). That is a separate audit path — the change-log + drift
 *     scheduler — not an exemption-aware alert.
 *   - The alert isn't user-scoped (app creation, role elevation, etc.).
 *     Exemptions are per-UPN.
 *
 * Current wired evaluators:
 *   - foreignLogin ↔ block_geographic_access
 *   - mfaDisabled  ↔ require_mfa
 */

const db = require('./db/database');
const graph = require('./graph');
const notifier = require('./notifier');
const aiAnalysis = require('./ai-analysis');
const exemptionResolver = require('./lib/exemption-resolver');
const alertExemptionMatcher = require('./lib/alert-exemption-matcher');
const { classifyCaPolicy } = require('./lib/ca-policy-classifier');
const namedLocationResolver = require('./lib/named-location-resolver');
const tenantMode = require('./lib/tenant-mode');
const signinCache = require('./lib/signin-cache');

// ─────────────────────────────────────────────────────────────
// Slugify policy.name → snake_case key for i18n lookups.
// ─────────────────────────────────────────────────────────────
// Mirror of the client-side slugify in public/js/shared/i18n.js. Used to
// build alert_policy_names.<slug> lookup keys for the message_template_params
// payload (see Phase 9b — per-alert-type structured templates). Stable
// English policy.name → stable slug ensures the locale lookup works.
function policySlug(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ─────────────────────────────────────────────────────────────
// Derive allowed countries per tenant from live CA policies.
// ─────────────────────────────────────────────────────────────
// The foreign-login evaluator needs to know which countries are allowed for
// a given tenant. The canonical source is the tenant's own CA policies: any
// policy that classifies as `block_geographic_access` declares, via its
// includeLocations/excludeLocations, what geography is allowed. This function
// unions the allowlist countries across all enabled geo-blocking policies.
//
// Per-tenant cache (15 min). Callers: evaluateTenant during ctx build.
const _allowedCountriesCache = new Map();
const ALLOWED_COUNTRIES_TTL_MS = 15 * 60 * 1000;

async function deriveAllowedCountriesFromCa(azureTenantId) {
  const entry = _allowedCountriesCache.get(azureTenantId);
  if (entry && (Date.now() - entry.ts) < ALLOWED_COUNTRIES_TTL_MS) {
    return entry.countries;
  }

  const countries = new Set();
  try {
    const resp = await graph.callGraph(
      azureTenantId,
      '/identity/conditionalAccess/policies',
      { version: 'v1.0', method: 'GET' }
    );
    const policies = Array.isArray(resp?.value) ? resp.value : [];

    for (const policy of policies) {
      if (policy.state !== 'enabled') continue;
      const classified = classifyCaPolicy(policy);
      const geo = classified.dimensions.find(d => d.dimension === 'block_geographic_access');
      if (!geo) continue;
      const semantic = await namedLocationResolver.computeGeoSemantic(azureTenantId, geo.scope);
      if (semantic.mode === 'allowlist') {
        for (const c of semantic.countries) countries.add(c);
      }
      // blocklist semantic doesn't contribute allowed countries — it just
      // blocks specific locations. Ignored here by design.
    }
  } catch (e) {
    console.error(`[AlertEngine] deriveAllowedCountriesFromCa failed for ${azureTenantId}: ${e.message}`);
    // Fall through with whatever we accumulated (possibly empty).
  }

  _allowedCountriesCache.set(azureTenantId, { ts: Date.now(), countries });
  return countries;
}

// ═══════════════════════════════════════════
// AUTO-MIGRATION (adds Phase 3 columns)
// ═══════════════════════════════════════════

async function ensureAlertColumns() {
  const columns = [
    { name: 'dedup_key', sql: "ALTER TABLE alerts ADD COLUMN dedup_key VARCHAR(512) DEFAULT NULL COMMENT 'Unique condition key for deduplication' AFTER email_sent" },
    { name: 'recurrence_count', sql: "ALTER TABLE alerts ADD COLUMN recurrence_count INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Times condition detected consecutively' AFTER dedup_key" },
    { name: 'last_seen_at', sql: "ALTER TABLE alerts ADD COLUMN last_seen_at DATETIME DEFAULT NULL COMMENT 'Last time condition was detected' AFTER recurrence_count" },
    { name: 'notes', sql: "ALTER TABLE alerts ADD COLUMN notes TEXT COMMENT 'Operator working notes (Quill HTML)' AFTER ai_analysis_en" },
    { name: 'auto_attributed_change_id', sql: "ALTER TABLE alerts ADD COLUMN auto_attributed_change_id INT UNSIGNED DEFAULT NULL COMMENT 'FK to tenant_change_events.id when drift is attributed to a Panoptica-initiated change' AFTER notes" },
    // May 20, 2026 — moved from src/db/migrate-alert-exemption-rules.sql so
    // fresh-DB MSP installs get these columns automatically. The migrate
    // file was the only source-of-truth for these two columns; on
    // production it was applied manually back on Apr 30 (Phase 11 exemption
    // system). Container deployments need them in code.
    { name: 'resolution_reason', sql: "ALTER TABLE alerts ADD COLUMN resolution_reason VARCHAR(32) DEFAULT NULL COMMENT 'manual | exemption_rule | drift_cleared | etc.' AFTER status" },
    { name: 'resolution_rule_id', sql: "ALTER TABLE alerts ADD COLUMN resolution_rule_id INT UNSIGNED DEFAULT NULL COMMENT 'FK alert_exemption_rules.id when resolution_reason = exemption_rule' AFTER resolution_reason" },
  ];

  for (const col of columns) {
    try {
      const exists = await db.queryRows(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND COLUMN_NAME = ?",
        [col.name]
      );
      if (exists.length === 0) {
        await db.execute(col.sql);
        console.log(`[AlertEngine] Added column alerts.${col.name}`);
      }
    } catch (e) {
      console.error(`[AlertEngine] Migration error for ${col.name}:`, e.message);
    }
  }

  // Add index for dedup lookups
  try {
    const idxExists = await db.queryRows(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'idx_alerts_dedup'"
    );
    if (idxExists.length === 0) {
      await db.execute("ALTER TABLE alerts ADD INDEX idx_alerts_dedup (tenant_id, dedup_key, status)");
      console.log('[AlertEngine] Added index idx_alerts_dedup');
    }
  } catch (e) {
    // Index may already exist
  }

  // Index for auto-attribution reverse lookups (find alerts attributed to a given change event)
  try {
    const idxExists = await db.queryRows(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'idx_alerts_attribution'"
    );
    if (idxExists.length === 0) {
      await db.execute("ALTER TABLE alerts ADD INDEX idx_alerts_attribution (auto_attributed_change_id)");
      console.log('[AlertEngine] Added index idx_alerts_attribution');
    }
  } catch (e) {
    // Index may already exist
  }

  // Daily event counts table — accumulates event counts across poll cycles
  // for proper daily volume spike comparison (per-poll batches are too small)
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS daily_event_counts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT UNSIGNED NOT NULL,
        policy_id INT UNSIGNED NOT NULL,
        event_date DATE NOT NULL,
        event_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tenant_policy_date (tenant_id, policy_id, event_date),
        INDEX idx_baseline_lookup (tenant_id, policy_id, event_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured daily_event_counts table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] daily_event_counts migration error:', e.message);
    }
  }

  // Daily event details table — stores individual sign-in events for today only.
  // Feeds the drill-down modal when a user clicks a tenant in the donut legend.
  // Purged daily: rows older than today are deleted at the start of each poll cycle.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS daily_event_details (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT UNSIGNED NOT NULL,
        event_type ENUM('login_failure','ca_block') NOT NULL,
        event_time DATETIME NOT NULL,
        user_display_name VARCHAR(255) DEFAULT NULL,
        user_principal_name VARCHAR(255) DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        city VARCHAR(255) DEFAULT NULL,
        country VARCHAR(100) DEFAULT NULL,
        app_display_name VARCHAR(255) DEFAULT NULL,
        error_code INT DEFAULT NULL,
        failure_reason TEXT DEFAULT NULL,
        ca_status VARCHAR(50) DEFAULT NULL,
        device_detail_browser VARCHAR(255) DEFAULT NULL,
        device_detail_os VARCHAR(255) DEFAULT NULL,
        risk_level VARCHAR(50) DEFAULT NULL,
        graph_event_id VARCHAR(255) DEFAULT NULL,
        event_date DATE NOT NULL,
        UNIQUE KEY uq_graph_event (graph_event_id),
        INDEX idx_tenant_type_date (tenant_id, event_type, event_date),
        INDEX idx_event_date (event_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured daily_event_details table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] daily_event_details migration error:', e.message);
    }
  }

  // Add UNIQUE index on graph_event_id if table already existed without it
  try {
    await db.execute(`
      ALTER TABLE daily_event_details
      ADD UNIQUE KEY uq_graph_event (graph_event_id)
    `);
  } catch (e) {
    // Ignore "Duplicate key name" — index already exists
  }

  // Daily event summaries — AI-generated batch summaries per tenant per event type.
  // Generated by Haiku at poll time; displayed in the drill-down modal header.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS daily_event_summaries (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT UNSIGNED NOT NULL,
        event_type ENUM('login_failure','ca_block') NOT NULL,
        event_date DATE NOT NULL,
        summary TEXT NOT NULL,
        event_count INT UNSIGNED NOT NULL DEFAULT 0,
        generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tenant_type_date (tenant_id, event_type, event_date),
        INDEX idx_event_date (event_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured daily_event_summaries table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] daily_event_summaries migration error:', e.message);
    }
  }

  // Phase 8b Migration (2026-04-18) — hide repurposed telemetry policies from admin UI
  // so they can't be accidentally re-enabled (which would reintroduce the alert noise
  // Phase 8 eliminated). See migrate-hidden-from-ui.sql for the standalone migration.
  try {
    await db.execute(
      "ALTER TABLE alert_policies ADD COLUMN hidden_from_ui TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled"
    );
    console.log('[AlertEngine] Migration: added alert_policies.hidden_from_ui column');
  } catch (e) {
    if (!e.message.includes('Duplicate column')) {
      console.error('[AlertEngine] hidden_from_ui migration error:', e.message);
    }
  }

  // Migration: add "Global Administrator" to "Admin role assignment" policy
  // and bump severity/polling tier so GA elevation is caught by audit logs, not just snapshot comparison
  try {
    const policy = await db.queryOne(
      "SELECT id, detection_logic FROM alert_policies WHERE name = 'Admin role assignment' LIMIT 1"
    );
    if (policy) {
      const logic = typeof policy.detection_logic === 'string'
        ? JSON.parse(policy.detection_logic)
        : policy.detection_logic;
      const roles = logic.role_names || [];
      if (!roles.map(r => r.toLowerCase()).includes('global administrator')) {
        roles.unshift('Global Administrator');
        logic.role_names = roles;
        await db.execute(
          "UPDATE alert_policies SET detection_logic = ?, severity = 'high', polling_tier = 'critical', description = 'User assigned to a privileged administrative role (including Global Administrator)' WHERE id = ?",
          [JSON.stringify(logic), policy.id]
        );
        console.log('[AlertEngine] Migration: added Global Administrator to "Admin role assignment" policy');
      }
    }
  } catch (e) {
    console.error('[AlertEngine] Admin role assignment migration error:', e.message);
  }

  // ═══════════════════════════════════════════
  // Phase 8 Migration (2026-04-09) — Ambient telemetry redesign
  // ═══════════════════════════════════════════
  // The three aggregate volume policies below fired every poll cycle on ambient activity
  // and were the primary source of alert noise. They are now disabled for alerting and
  // repurposed as telemetry feeds for the Daily Activity donut charts.
  //
  // "Sign-ins blocked by Conditional Access" → ca_blocks donut
  // "User login failure summary"              → login_failures donut
  // "Admin login failures"                    → disabled entirely (superseded by
  //                                              Account lockouts + Admin blocked by CA)
  //
  // A new policy "Admin blocked by Conditional Access" is inserted to fire
  // critical alerts on any CA block of an admin UPN (rare, high-signal event).
  try {
    const telemetryUpdates = [
      {
        name: 'Sign-ins blocked by Conditional Access',
        widget: 'ca_blocks',
        description: 'Tenant-wide telemetry: daily count of sign-ins blocked by Conditional Access policies. Feeds the Daily Activity donut chart.',
      },
      {
        name: 'User login failure summary',
        widget: 'login_failures',
        description: 'Tenant-wide telemetry: daily count of user login failures. Feeds the Daily Activity donut chart.',
      },
    ];
    for (const u of telemetryUpdates) {
      const policy = await db.queryOne(
        'SELECT id, detection_logic FROM alert_policies WHERE name = ? LIMIT 1',
        [u.name]
      );
      if (!policy) continue;
      const logic = typeof policy.detection_logic === 'string'
        ? JSON.parse(policy.detection_logic)
        : policy.detection_logic;
      // Idempotent — only update if not already migrated
      if (logic.track_daily_telemetry === true && logic.daily_activity_widget === u.widget) continue;
      logic.track_daily_telemetry = true;
      logic.daily_activity_widget = u.widget;
      logic.threshold_type = 'telemetry_only';
      // Strip volume_spike specifics that no longer apply
      delete logic.baseline_window_hours;
      delete logic.spike_multiplier;
      delete logic.min_count;
      delete logic.threshold_count;
      await db.execute(
        'UPDATE alert_policies SET enabled = FALSE, hidden_from_ui = TRUE, detection_logic = ?, description = ? WHERE id = ?',
        [JSON.stringify(logic), u.description, policy.id]
      );
      console.log(`[AlertEngine] Phase 8 migration: converted "${u.name}" → telemetry-only (${u.widget}), enabled=FALSE, hidden_from_ui=TRUE`);
    }

    // Phase 8b catch-up: ensure hidden_from_ui is set on rows that were
    // migrated under the pre-8b version of the loop above (which only set
    // enabled=FALSE). Idempotent — no-op once all three rows are hidden.
    await db.execute(
      `UPDATE alert_policies
          SET hidden_from_ui = TRUE
        WHERE name IN (
          'Sign-ins blocked by Conditional Access',
          'User login failure summary',
          'Admin login failures'
        )
          AND hidden_from_ui = 0`
    );

    // Disable "Admin login failures" entirely (no widget, no alerting)
    const adminFail = await db.queryOne(
      "SELECT id, enabled, detection_logic FROM alert_policies WHERE name = 'Admin login failures' LIMIT 1"
    );
    if (adminFail && adminFail.enabled) {
      const logic = typeof adminFail.detection_logic === 'string'
        ? JSON.parse(adminFail.detection_logic)
        : adminFail.detection_logic;
      logic.threshold_type = 'telemetry_only';
      delete logic.baseline_window_hours;
      delete logic.spike_multiplier;
      await db.execute(
        'UPDATE alert_policies SET enabled = FALSE, hidden_from_ui = TRUE, detection_logic = ?, description = ? WHERE id = ?',
        [
          JSON.stringify(logic),
          'Unusual volume of administrator login failures. DISABLED — superseded by Account lockouts (per-user brute force) and Admin blocked by Conditional Access.',
          adminFail.id,
        ]
      );
      console.log('[AlertEngine] Phase 8 migration: disabled "Admin login failures" (superseded), hidden_from_ui=TRUE');
    }

    // Insert new "Admin blocked by Conditional Access" policy if missing
    const newAdminCa = await db.queryOne(
      "SELECT id FROM alert_policies WHERE name = 'Admin blocked by Conditional Access' LIMIT 1"
    );
    if (!newAdminCa) {
      const caLogic = {
        endpoint: '/auditLogs/signIns',
        filter: "conditionalAccessStatus eq 'failure'",
        admin_only: true,
        threshold_type: 'any_new',
        lookback_minutes: 15,
      };
      await db.execute(
        `INSERT INTO alert_policies (name, description, category, severity, polling_tier, notification_target, enabled, detection_logic)
         VALUES (?, ?, 'risky_signins', 'severe', 'critical', 'both', TRUE, ?)`,
        [
          'Admin blocked by Conditional Access',
          'A user in a privileged administrative role was blocked by a Conditional Access policy. Admin logins should succeed; any CA block of an admin UPN is treated as critical.',
          JSON.stringify(caLogic),
        ]
      );
      console.log('[AlertEngine] Phase 8 migration: inserted "Admin blocked by Conditional Access" policy');
    }

    // Close out any still-open alerts from the retired volume_spike policies so
    // the alert dashboard stops showing stale noise.
    try {
      const retired = await db.queryRows(
        "SELECT id FROM alert_policies WHERE name IN ('Sign-ins blocked by Conditional Access', 'User login failure summary', 'Admin login failures')"
      );
      if (retired.length > 0) {
        const ids = retired.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const affected = await db.execute(
          `UPDATE alerts
             SET status = 'resolved',
                 closed_at = NOW(),
                 notes = CONCAT(COALESCE(notes, ''), '<p><em>Auto-resolved by Phase 8 migration — policy converted to ambient telemetry (see Daily Activity dashboard).</em></p>')
           WHERE policy_id IN (${placeholders}) AND status IN ('new', 'investigating')`,
          ids
        );
        if (affected > 0) {
          console.log(`[AlertEngine] Phase 8 migration: auto-resolved ${affected} stale alert(s) from retired volume_spike policies`);
        }
      }
    } catch (e) {
      // Non-fatal — column name / concat syntax may vary; fall back silently
      console.warn('[AlertEngine] Phase 8 auto-resolve stale alerts (non-fatal):', e.message);
    }
  } catch (e) {
    console.error('[AlertEngine] Phase 8 migration error:', e.message);
  }

  // Phase 11 cleanup (2026-04-14) — Delete 5 dead alert policies identified by audit.
  // These policies had no working detection path: either their threshold_type
  // (volume_spike, daily_aggregate) was a no-op after Phase 8 with no telemetry
  // widget configured, OR their endpoint was never wired into getEventsForPolicy().
  // Auto-resolve any stale open alerts first, then DELETE the rows.
  try {
    const deadPolicyNames = [
      'Admin login failures',              // superseded by Account lockouts + Admin blocked by CA
      'Unusual external file access',      // volume_spike no-op, endpoint never handled
      'Unusual external file sharing volume', // volume_spike no-op, endpoint never handled
      'External site invitations',         // volume_spike no-op, endpoint never handled
      'SharePoint file access',            // daily_aggregate no-op, endpoint never handled
    ];

    const dead = await db.queryRows(
      `SELECT id, name FROM alert_policies WHERE name IN (${deadPolicyNames.map(() => '?').join(',')})`,
      deadPolicyNames
    );
    if (dead.length > 0) {
      const ids = dead.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');

      // Auto-resolve any open alerts referencing these policies
      try {
        const affected = await db.execute(
          `UPDATE alerts
             SET status = 'resolved',
                 closed_at = NOW(),
                 notes = CONCAT(COALESCE(notes, ''), '<p><em>Auto-resolved by Phase 11 cleanup — policy deleted (had no working detection path).</em></p>')
           WHERE policy_id IN (${placeholders}) AND status IN ('new', 'investigating')`,
          ids
        );
        if (affected > 0) {
          console.log(`[AlertEngine] Phase 11 cleanup: auto-resolved ${affected} stale alert(s) from dead policies`);
        }
      } catch (e) {
        console.warn('[AlertEngine] Phase 11 auto-resolve (non-fatal):', e.message);
      }

      // Delete the dead policies. daily_event_counts has FK to alert_policies — clear it first.
      try {
        await db.execute(
          `DELETE FROM daily_event_counts WHERE policy_id IN (${placeholders})`,
          ids
        );
      } catch (e) {
        // Table may not exist or no rows — non-fatal
      }

      const deleted = await db.execute(
        `DELETE FROM alert_policies WHERE id IN (${placeholders})`,
        ids
      );
      console.log(`[AlertEngine] Phase 11 cleanup: deleted ${deleted} dead policy row(s): ${dead.map(d => d.name).join(', ')}`);
    }
  } catch (e) {
    console.error('[AlertEngine] Phase 11 cleanup error:', e.message);
  }

  // ═══════════════════════════════════════════
  // Change Log feature (2026-04-19) — tenant_change_events
  // ═══════════════════════════════════════════
  // Operator-logged context events (manual source) + future Panoptica-initiated
  // change events (panoptica source, Phase 1 auto-attribution — schema-ready,
  // wiring TBD). Haiku daily digest reads this table as NARRATIVE CONTEXT only;
  // severity and suppression are never touched by note content. Panoptica-
  // sourced rows with a correlation_tag will be used for deterministic drift
  // suppression in a later phase.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_change_events (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT UNSIGNED NOT NULL,
        source ENUM('manual','panoptica') NOT NULL DEFAULT 'manual',
        category ENUM(
          'ca_deploy','ca_retire','ca_edit',
          'intune_push','intune_retire','intune_edit',
          'named_location','exemption','exemption_apply','exemption_revoke',
          'remediation',
          'manual_cleanup','incident_response','migration','other'
        ) NOT NULL,
        affected_surface JSON NOT NULL,
        started_at DATETIME NOT NULL,
        ended_at DATETIME DEFAULT NULL,
        impact ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        description VARCHAR(500) DEFAULT NULL,
        correlation_tag VARCHAR(128) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        INDEX idx_tenant_started (tenant_id, started_at),
        INDEX idx_tenant_day (tenant_id, started_at, deleted_at),
        INDEX idx_correlation (correlation_tag)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured tenant_change_events table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] tenant_change_events migration error:', e.message);
    }
  }

  // Append-only edit audit table. Every PUT/DELETE on tenant_change_events
  // writes a snapshot row here BEFORE mutating the parent. Never pruned.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_change_event_edits (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_id INT UNSIGNED NOT NULL,
        edited_by VARCHAR(255) DEFAULT NULL,
        edited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        action ENUM('update','delete','restore') NOT NULL,
        snapshot JSON NOT NULL,
        INDEX idx_event (event_id, edited_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured tenant_change_event_edits table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] tenant_change_event_edits migration error:', e.message);
    }
  }

  // Expand tenant_change_events.category ENUM to cover Panoptica-originated
  // categories. The original schema (Apr 19 morning) used collapsed values
  // ('exemption', 'remediation', 'named_location') suited for operator UI.
  // Phase 1 auto-attribution (Apr 19 afternoon) needed finer distinctions —
  // most importantly apply vs revoke for exemptions. We keep the original
  // short names for backward compat with existing rows and add the new ones.
  // Idempotent: MODIFY is a no-op if the ENUM already matches.
  try {
    await db.execute(`
      ALTER TABLE tenant_change_events
        MODIFY COLUMN category ENUM(
          'ca_deploy','ca_retire','ca_edit',
          'intune_push','intune_retire','intune_edit',
          'named_location','exemption','exemption_apply','exemption_revoke',
          'remediation',
          'alert_status_change','alert_note','ai_severity_revert',
          'enforcement_toggle','tenant_lifecycle','named_location_create',
          'security_setting_change',
          'manual_cleanup','incident_response','migration','other'
        ) NOT NULL
    `);
    console.log('[AlertEngine] Ensured tenant_change_events.category ENUM includes Panoptica categories');
  } catch (e) {
    console.error('[AlertEngine] tenant_change_events category ENUM expansion error:', e.message);
  }

  // Audit-trail columns (Apr 19 2026 evening) — actor_ip, actor_user_agent,
  // actor_session_id. Nullable; populated from req at the call site when the
  // mutation is user-initiated. Background/poller-initiated mutations leave
  // these null — the created_by='panoptica-system' tells you why. Added in
  // support of a commercial-grade audit journal (SOC 2 attestation later).
  //
  // Column sizes:
  //   actor_ip: VARCHAR(45) — IPv6 text is 39ch (e.g. 2001:db8:...), pad to 45
  //             to cover IPv4-mapped-IPv6 ("::ffff:a.b.c.d") without truncation.
  //   actor_user_agent: VARCHAR(500) — modern UAs can exceed 300ch; clamp rather
  //             than TEXT to keep the row width bounded (this is a hot-read table).
  //   actor_session_id: VARCHAR(128) — express-session SIDs are 32ch; reserve
  //             headroom in case we rotate session backends.
  const auditColumns = [
    { name: 'actor_ip',         def: "VARCHAR(45)  DEFAULT NULL COMMENT 'Originating IP of the operator request, or NULL for background/poller actions' AFTER created_by" },
    { name: 'actor_user_agent', def: "VARCHAR(500) DEFAULT NULL COMMENT 'HTTP User-Agent header, truncated to 500ch' AFTER actor_ip" },
    { name: 'actor_session_id', def: "VARCHAR(128) DEFAULT NULL COMMENT 'express-session ID for linking related events from the same login' AFTER actor_user_agent" },
  ];
  for (const col of auditColumns) {
    try {
      const exists = await db.queryOne(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_change_events' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (!exists || exists.c === 0) {
        await db.execute(`ALTER TABLE tenant_change_events ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[AlertEngine] Added tenant_change_events.${col.name}`);
      }
    } catch (e) {
      console.error(`[AlertEngine] tenant_change_events.${col.name} migration error:`, e.message);
    }
  }

  // May 8, 2026 — i18n templating for description.
  // Adds template_key + template_params so the renderer can produce localized
  // descriptions in the operator's language at read time. Existing rows leave
  // both NULL and the renderer falls back to the English description column.
  // Same pattern as msp_audit_events.
  const tplColumns = [
    { name: 'template_key',    def: "VARCHAR(64) DEFAULT NULL COMMENT 'i18n key under event_descriptions.tenant_change.<key>; NULL = legacy row, render description as-is' AFTER description" },
    { name: 'template_params', def: "JSON        DEFAULT NULL COMMENT 'Param map for template interpolation, e.g. {tenantName, policyName}' AFTER template_key" },
  ];
  for (const col of tplColumns) {
    try {
      const exists = await db.queryOne(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_change_events' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (!exists || exists.c === 0) {
        await db.execute(`ALTER TABLE tenant_change_events ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[AlertEngine] Added tenant_change_events.${col.name}`);
      }
    } catch (e) {
      console.error(`[AlertEngine] tenant_change_events.${col.name} migration error:`, e.message);
    }
  }

  // Apr 28, 2026 — "Mailbox-level forwarding enabled" alert policy.
  // Idempotent — only inserts if missing. Sibling vector to inbox-rule
  // forwarding policies; corresponds to evaluateMailboxLevelForwardingEnabled
  // and fetchMailboxLevelForwarding (pwsh-backed; Graph doesn't expose this).
  try {
    await ensureMailboxLevelForwardingPolicy();
  } catch (e) {
    console.error('[AlertEngine] Mailbox-level forwarding policy bootstrap failed:', e.message);
  }

  // May 8, 2026 — Documentation report snapshot store.
  // Each generated Documentation report writes its full underlying data here
  // so the next run can compute "what changed since [date]". Idempotent.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS documentation_snapshots (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT UNSIGNED NOT NULL,
        generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        generated_by VARCHAR(255) DEFAULT NULL COMMENT 'Operator email at time of generation',
        language VARCHAR(8) NOT NULL DEFAULT 'en',
        snapshot_json LONGTEXT NOT NULL COMMENT 'Full gather output, JSON-encoded — used for diff against next run',
        summary_json TEXT DEFAULT NULL COMMENT 'Compact card-summary slice for quick lookups without parsing the full snapshot',
        pdf_filename VARCHAR(255) DEFAULT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        INDEX idx_tenant_generated (tenant_id, generated_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured documentation_snapshots table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] documentation_snapshots migration error:', e.message);
    }
  }

  // May 20, 2026 — operator-defined alert exemption rules (Phase 11).
  // Migrated here from src/db/migrate-alert-exemption-rules.sql so fresh-DB
  // container deployments get the table automatically. Production VM has
  // had this since Apr 30; CREATE TABLE IF NOT EXISTS is a no-op there.
  // Schema mirrored verbatim from the migrate-*.sql file.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS alert_exemption_rules (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id         INT UNSIGNED NOT NULL,
        policy_id         INT UNSIGNED NOT NULL,
        match_upn         VARCHAR(255) NOT NULL COMMENT 'Lowercased UPN; exact match',
        match_country     CHAR(2) DEFAULT NULL COMMENT 'ISO-3166-1 alpha-2, uppercase',
        match_ip_cidr     VARCHAR(64) DEFAULT NULL COMMENT 'IPv4/IPv6 CIDR; matcher uses ipaddr.js if available',
        match_asn         VARCHAR(32) DEFAULT NULL COMMENT 'RESERVED — ASN enrichment not yet wired',
        reason            TEXT NOT NULL COMMENT 'Operator justification, REQUIRED at create',
        expires_at        DATETIME NOT NULL COMMENT 'Hard expiry — no never expire',
        created_by        VARCHAR(255) NOT NULL,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        revoked_at        DATETIME DEFAULT NULL,
        revoked_by        VARCHAR(255) DEFAULT NULL,
        revoke_reason     VARCHAR(64) DEFAULT NULL COMMENT 'manual | expired',
        match_count       INT UNSIGNED NOT NULL DEFAULT 0,
        last_matched_at   DATETIME DEFAULT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (policy_id) REFERENCES alert_policies(id) ON DELETE CASCADE,
        INDEX idx_lookup (tenant_id, policy_id, match_upn, revoked_at, expires_at),
        INDEX idx_expiry (expires_at, revoked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[AlertEngine] Ensured alert_exemption_rules table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[AlertEngine] alert_exemption_rules migration error:', e.message);
    }
  }
}

/**
 * Idempotent insert of the "Mailbox-level forwarding enabled" alert policy.
 * Mirrors the pattern in src/lib/security-settings/seed.js::ensureSecurityDriftPolicy.
 * Existing tenants don't get the row from seed-policies.sql (init-schema's
 * seed only runs when alert_policies is empty), so this bootstrap is the
 * way to add new policies without forcing a manual SQL migration.
 */
async function ensureMailboxLevelForwardingPolicy() {
  const POLICY_NAME = 'Mailbox-level forwarding enabled';
  const existing = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [POLICY_NAME]
  );
  if (existing) return existing.id;

  const id = await db.insert(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      POLICY_NAME,
      'A user mailbox now has Set-Mailbox -ForwardingSmtpAddress set. Detected via snapshot-delta on Get-Mailbox output. Sibling vector to inbox-rule forwarding — covers the case where forwarding is configured directly on the mailbox rather than via an inbox rule. Source: PowerShell (Graph does not expose this property).',
      'risky_signins',
      'high',
      'medium',
      'both',
      JSON.stringify({
        delta_query: true,
        delta_source: 'mailbox_forwarding.users',
        delta_type: 'enabled',
        threshold_type: 'any_new',
        external_only: false,
      }),
    ]
  );
  console.log(`[AlertEngine] Created "Mailbox-level forwarding enabled" alert policy id=${id}`);
  return id;
}

// ═══════════════════════════════════════════
// DAILY EVENT COUNT ACCUMULATOR
// ═══════════════════════════════════════════

/**
 * Accumulate a poll cycle's event count into the daily running total.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE to atomically increment.
 */
async function accumulateDailyCount(tenantDbId, policyId, batchCount) {
  if (batchCount <= 0) return;
  try {
    await db.execute(
      `INSERT INTO daily_event_counts (tenant_id, policy_id, event_date, event_count)
       VALUES (?, ?, CURDATE(), ?)
       ON DUPLICATE KEY UPDATE event_count = event_count + VALUES(event_count)`,
      [tenantDbId, policyId, batchCount]
    );
  } catch (e) {
    console.error(`[AlertEngine] Failed to accumulate daily count for policy ${policyId}:`, e.message);
  }
}

/**
 * Get today's accumulated event count for a policy + tenant.
 */
async function getDailyCount(tenantDbId, policyId) {
  const rows = await db.queryRows(
    `SELECT event_count FROM daily_event_counts
     WHERE tenant_id = ? AND policy_id = ? AND event_date = CURDATE()`,
    [tenantDbId, policyId]
  );
  return rows.length > 0 ? rows[0].event_count : 0;
}

/**
 * Get baseline: rolling average of the last 7 days (excluding today).
 * More resilient than exact same-day-last-week — tolerates missing days,
 * smooths weekday/weekend variance, and builds up faster for new deployments.
 * Returns { avg, days } or null if no historical data exists.
 */
async function getDailyBaseline(tenantDbId, policyId) {
  const rows = await db.queryRows(
    `SELECT AVG(event_count) AS avg_count, COUNT(*) AS day_count
     FROM daily_event_counts
     WHERE tenant_id = ? AND policy_id = ?
       AND event_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       AND event_date < CURDATE()`,
    [tenantDbId, policyId]
  );
  if (rows.length === 0 || rows[0].day_count === 0) return null;
  return {
    avg: Math.round(rows[0].avg_count),
    days: rows[0].day_count,
  };
}

// ═══════════════════════════════════════════
// DAILY EVENT DETAIL STORAGE + AI SUMMARY
// ═══════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/default');

let _anthropicClient = null;
function getAiClient() {
  if (!_anthropicClient && config.ai.apiKey) {
    _anthropicClient = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return _anthropicClient;
}

/**
 * Purge event details and summaries older than today.
 * Called once per poll cycle — idempotent.
 */
async function purgeOldEventDetails() {
  try {
    const deleted = await db.execute(
      'DELETE FROM daily_event_details WHERE event_date < CURDATE()'
    );
    const deletedSummaries = await db.execute(
      'DELETE FROM daily_event_summaries WHERE event_date < CURDATE()'
    );
    if (deleted > 0 || deletedSummaries > 0) {
      console.log(`[AlertEngine] Purged ${deleted} old event detail rows, ${deletedSummaries} old summary rows`);
    }
  } catch (e) {
    console.warn('[AlertEngine] Purge old event details failed:', e.message);
  }
}

/**
 * Store individual sign-in events for drill-down.
 * Uses INSERT IGNORE with graph_event_id to dedup from the 30-min overlap buffer.
 *
 * Returns the count of events that were *newly* inserted this call — used by
 * the telemetry accumulator to avoid double-counting when the sign-in fetcher's
 * latency buffer causes the same event to appear in multiple poll batches.
 *
 * @param {number} tenantDbId - Internal tenant ID
 * @param {string} eventType - 'login_failure' or 'ca_block'
 * @param {Array} events - Raw Graph sign-in event objects
 * @returns {Promise<number>} Count of newly-inserted rows (0 if all were duplicates).
 */
async function storeEventDetails(tenantDbId, eventType, events) {
  if (!events || events.length === 0) return 0;
  let newCount = 0;
  for (const ev of events) {
    try {
      // db.execute returns affectedRows. For INSERT IGNORE:
      //   1 = new row written, 0 = duplicate skipped.
      const affected = await db.execute(
        `INSERT IGNORE INTO daily_event_details
         (tenant_id, event_type, event_time, user_display_name, user_principal_name,
          ip_address, city, country, app_display_name, error_code, failure_reason,
          ca_status, device_detail_browser, device_detail_os, risk_level,
          graph_event_id, event_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
        [
          tenantDbId,
          eventType,
          ev.createdDateTime ? new Date(ev.createdDateTime) : new Date(),
          ev.userDisplayName || null,
          ev.userPrincipalName || null,
          ev.ipAddress || null,
          ev.location?.city || null,
          ev.location?.countryOrRegion || null,
          ev.appDisplayName || null,
          ev.status?.errorCode ?? null,
          ev.status?.failureReason || null,
          ev.conditionalAccessStatus || null,
          ev.deviceDetail?.browser || null,
          ev.deviceDetail?.operatingSystem || null,
          ev.riskLevelDuringSignIn || null,
          ev.id || null,
        ]
      );
      if (affected > 0) newCount++;
    } catch (e) {
      if (!e.message.includes('Duplicate')) {
        console.warn(`[AlertEngine] Failed to store event detail: ${e.message}`);
      }
    }
  }
  return newCount;
}

/**
 * Fetch operator-logged change events from the current day that overlap the
 * control dimensions relevant to a given event_type. Used as narrative
 * context by generateEventSummary — never a suppression signal.
 *
 * Event-type → surface mapping:
 *   login_failure → identity, mfa  (auth/identity-layer context)
 *   ca_block      → ca, identity   (CA policy deploys, identity changes)
 *
 * Returns [] on any DB error (non-fatal — the prompt still runs without context).
 */
async function getChangeEventContextForEventType(tenantDbId, eventType) {
  const surfaceMap = {
    login_failure: ['identity', 'mfa'],
    ca_block: ['ca', 'identity'],
  };
  const surfaces = surfaceMap[eventType] || [];
  if (surfaces.length === 0) return [];

  try {
    // Fetch all of today's change events for this tenant, then filter surface
    // overlap in JS. Matches the codebase convention of JS-side JSON filtering
    // (see Claude.md note on MySQL JSON function semantics).
    const rows = await db.queryRows(
      `SELECT id, source, category, affected_surface, started_at, ended_at,
              impact, description, created_by
         FROM tenant_change_events
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND DATE(started_at) = CURDATE()
        ORDER BY started_at DESC
        LIMIT 50`,
      [tenantDbId]
    );
    const surfaceSet = new Set(surfaces);
    return rows
      .map(r => {
        let surfaceArr = r.affected_surface;
        if (typeof surfaceArr === 'string') {
          try { surfaceArr = JSON.parse(surfaceArr); } catch (_) { surfaceArr = []; }
        }
        if (!Array.isArray(surfaceArr)) surfaceArr = [];
        return {
          category: r.category,
          impact: r.impact,
          surfaces: surfaceArr,
          started_at: r.started_at,
          description: r.description,
          created_by: r.created_by,
        };
      })
      .filter(r => r.surfaces.some(s => surfaceSet.has(s)))
      .slice(0, 10);
  } catch (e) {
    console.warn(`[AlertEngine] Change context fetch failed for event_type=${eventType}: ${e.message}`);
    return [];
  }
}

/**
 * Generate a Haiku batch summary for today's events for a tenant + event type.
 * Overwrites any existing summary for the same tenant/type/date (latest poll wins).
 *
 * Reads the full day's deduped events from daily_event_details rather than
 * using the current poll's batch — otherwise the summary describes only the
 * latest overlap window and desyncs from the modal's event list (e.g. modal
 * shows 4 unique events, summary said "1 event" because that was the last batch).
 */
async function generateEventSummary(tenantDbId, tenantName, eventType) {
  const anthropic = getAiClient();
  if (!anthropic) return;

  // Query the full day's deduped events, matching what the drill-down modal
  // will show. Shape into the same object used by the prompt.
  const rows = await db.queryRows(
    `SELECT event_time, user_principal_name, user_display_name,
            ip_address, city, country, app_display_name,
            error_code, failure_reason, ca_status
       FROM daily_event_details
      WHERE tenant_id = ? AND event_type = ? AND event_date = CURDATE()
      ORDER BY event_time DESC
      LIMIT 30`,
    [tenantDbId, eventType]
  );
  if (rows.length === 0) return;

  // Fetch any operator-logged change events overlapping today whose
  // affected_surface intersects this event type's control dimension.
  // Used as NARRATIVE CONTEXT ONLY — strictly forbidden from influencing
  // severity or suppressing events. See api-change-events.js governance
  // note and the OUTPUT RULES on this prompt.
  const changeContext = await getChangeEventContextForEventType(tenantDbId, eventType);

  // Count the full day — not just the returned sample — for the summary metadata.
  const countRow = await db.queryRows(
    `SELECT COUNT(*) AS n FROM daily_event_details
      WHERE tenant_id = ? AND event_type = ? AND event_date = CURDATE()`,
    [tenantDbId, eventType]
  );
  const totalCount = countRow[0]?.n || rows.length;

  const batch = rows.map(ev => ({
    time: ev.event_time,
    user: ev.user_principal_name || ev.user_display_name || 'unknown',
    ip: ev.ip_address || 'unknown',
    location: [ev.city, ev.country].filter(Boolean).join(', ') || 'unknown',
    app: ev.app_display_name || 'unknown',
    error: ev.error_code,
    reason: ev.failure_reason || '',
    caStatus: ev.ca_status || '',
  }));

  const eventLabel = eventType === 'ca_block' ? 'Conditional Access blocks' : 'login failures';

  // Render operator-logged change events as a CONTEXT block, or an explicit
  // "None logged" sentinel so the model can't confabulate one. Explicit-
  // absence follows the same pattern the Apr 19 Sonnet overhaul uses.
  const contextSection = changeContext.length > 0
    ? `OPERATOR CONTEXT EVENTS (narrative context only — do not suppress or downgrade):
${changeContext.map(c =>
  `- ${c.started_at} [${c.category}, impact=${c.impact}, surfaces=${c.surfaces.join(',')}] by ${c.created_by || 'unknown'}: ${c.description || '(no description)'}`
).join('\n')}`
    : `OPERATOR CONTEXT EVENTS: None logged for this window.`;

  const prompt = `You are a Microsoft 365 security analyst for a managed services provider (MSP).
Summarize today's ${totalCount} ${eventLabel} for tenant "${tenantName}".
(Sample of up to 30 most recent events shown below.)

${contextSection}

EVENTS:
${JSON.stringify(batch, null, 1).substring(0, 3000)}

Provide a concise 2-3 sentence security assessment:
- Note patterns: same users targeted, geographic clustering, credential stuffing signatures, brute force indicators, lockout chains.
- Call out anything that looks like a real threat vs. normal background noise.
- Be specific about user counts, top source countries/IPs, and error codes.
- If OPERATOR CONTEXT EVENTS are listed AND plausibly explain the event pattern, you MAY mention that context in one clause. You MUST NOT treat operator context as evidence of safety, suppress alerts, or downgrade severity on the basis of it. Severity is set elsewhere — do not describe events as "expected" or "safe" merely because an operator logged a change.

OUTPUT RULES:
- Plain prose only. NO markdown formatting of any kind.
- Do NOT use: # or ## headings, **bold**, *italic*, bullet points (- or *), tables, or pipe separators (|).
- Do NOT start with a title or preamble like "Login Failure Summary" or labels like "Date:", "Total Events:", "Tenant:". Start directly with the assessment.
- One flowing paragraph.`;

  try {
    const response = await anthropic.messages.create({
      model: config.ai.haikuModel,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = response.content?.[0]?.text;
    if (!summary) return;

    await db.execute(
      `INSERT INTO daily_event_summaries (tenant_id, event_type, event_date, summary, event_count, generated_at)
       VALUES (?, ?, CURDATE(), ?, ?, NOW())
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), event_count = VALUES(event_count), generated_at = NOW()`,
      [tenantDbId, eventType, summary, totalCount]
    );
  } catch (e) {
    console.warn(`[AlertEngine] Haiku summary failed for ${tenantName} ${eventType}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════
// AUDIT LOG FETCHERS (watermark-based)
// ═══════════════════════════════════════════

/**
 * Fetch sign-in logs since the last poll.
 * Three queries: failed sign-ins, CA-blocked, and successful (for geo/compliance analysis).
 *
 * Uses a latency buffer (30 min) to account for Graph API sign-in log delays.
 * Events that appeared late in the API but have older createdDateTime values
 * would otherwise be permanently missed by the watermark. Deduplication in
 * createOrUpdateAlert() prevents duplicate alerts from the overlap window.
 */
async function fetchSignInLogs(tenantId, since) {
  // Apply 30-minute buffer to catch late-arriving sign-in events
  const bufferedSince = new Date(since.getTime() - 30 * 60 * 1000);
  const sinceStr = bufferedSince.toISOString();
  // appliedConditionalAccessPolicies added 2026-05-04 for UAL Phase 1 — required by
  // src/lib/ca-compliance-correlation.js to identify which CA policy enforced a sign-in
  // (specifically: was access gated by a compliant-device control?). Without this field,
  // we can detect deviceDetail.isCompliant=true but cannot prove which policy honored it,
  // and the suppression rule for UAL geo/IP alerts (§4.7 of UAL Strategy doc) loses fidelity.
  const signInFields = 'id,createdDateTime,userDisplayName,userPrincipalName,status,conditionalAccessStatus,riskLevelDuringSignIn,riskLevelAggregated,ipAddress,location,appDisplayName,deviceDetail,appliedConditionalAccessPolicies';

  // Failed sign-ins (error code != 0)
  let failedSignIns = [];
  try {
    failedSignIns = await graph.callGraphPaged(tenantId,
      `/auditLogs/signIns?$filter=createdDateTime ge ${sinceStr} and status/errorCode ne 0&$select=${signInFields}&$top=100&$orderby=createdDateTime desc`
    ) || [];
  } catch (e) {
    if (e.statusCode !== 403) {
      console.warn(`[AlertEngine] Sign-in logs (failed) error for ${tenantId}:`, e.message);
    }
  }

  // CA-blocked sign-ins
  let caBlockedSignIns = [];
  try {
    caBlockedSignIns = await graph.callGraphPaged(tenantId,
      `/auditLogs/signIns?$filter=createdDateTime ge ${sinceStr} and conditionalAccessStatus eq 'failure'&$select=${signInFields}&$top=100&$orderby=createdDateTime desc`
    ) || [];
  } catch (e) {
    if (e.statusCode !== 403) {
      console.warn(`[AlertEngine] Sign-in logs (CA blocked) error for ${tenantId}:`, e.message);
    }
  }

  // Successful sign-ins (for foreign login + compliance analysis)
  let successfulSignIns = [];
  try {
    successfulSignIns = await graph.callGraphPaged(tenantId,
      `/auditLogs/signIns?$filter=createdDateTime ge ${sinceStr} and status/errorCode eq 0&$select=${signInFields}&$top=200&$orderby=createdDateTime desc`
    ) || [];
  } catch (e) {
    if (e.statusCode !== 403) {
      console.warn(`[AlertEngine] Sign-in logs (successful) error for ${tenantId}:`, e.message);
    }
  }

  // Diagnostic logging — sign-in fetcher results
  console.log(`[AlertEngine:SignIns] ${tenantId} — failed: ${failedSignIns.length}, CA-blocked: ${caBlockedSignIns.length}, successful: ${successfulSignIns.length} (since ${sinceStr})`);

  if (successfulSignIns.length > 0) {
    const countries = successfulSignIns.map(s => s.location?.countryOrRegion || '?');
    console.log(`[AlertEngine] ${successfulSignIns.length} successful sign-in(s) for ${tenantId} — countries: ${[...new Set(countries)].join(', ')}`);
  }

  return { failedSignIns, caBlockedSignIns, successfulSignIns };
}

/**
 * Fetch directory audit logs since the last poll.
 * Targeted queries for specific activity types that alert policies care about.
 */
async function fetchDirectoryAudits(tenantId, since) {
  const sinceStr = since.toISOString();
  const results = {};

  const auditQueries = [
    { key: 'passwordChanges', filter: "activityDisplayName eq 'Change user password'" },
    { key: 'licenseChanges', filter: "activityDisplayName eq 'Change user license'" },
    // NOTE (2026-04-17): Set-Mailbox and *-InboxRule events are NOT in directoryAudits —
    // they live in the Office 365 Unified Audit Log (Management Activity API) which
    // requires Audit Premium. The mailboxSettingChanges / newInboxRule / setInboxRule /
    // removeInboxRule filters here returned empty arrays every poll and the four alert
    // policies that depended on them never fired. Replaced by snapshot-delta detection
    // on fetchMailForwarding output: see evaluateInboxRuleCreated /
    // evaluateInboxRuleModified / evaluateExternalForwardingNew.
    { key: 'fileDeleted', filter: "activityDisplayName eq 'FileDeleted'" },
    { key: 'sharingSet', filter: "activityDisplayName eq 'SharingSet'" },
    { key: 'addMember', filter: "activityDisplayName eq 'Add member to role'" },
    { key: 'addGuest', filter: "activityDisplayName eq 'Invite external user'" },
    // Consent grant attacks — user or admin grants OAuth permissions to an app
    { key: 'consentGrant', filter: "activityDisplayName eq 'Consent to application'" },
    // Conditional Access policy changes — critical security config
    { key: 'addCaPolicy', filter: "activityDisplayName eq 'Add conditional access policy'" },
    { key: 'updateCaPolicy', filter: "activityDisplayName eq 'Update conditional access policy'" },
    { key: 'deleteCaPolicy', filter: "activityDisplayName eq 'Delete conditional access policy'" },
  ];

  for (const { key, filter } of auditQueries) {
    try {
      const events = await graph.callGraphPaged(tenantId,
        `/auditLogs/directoryAudits?$filter=activityDateTime ge ${sinceStr} and ${filter}&$select=id,activityDateTime,activityDisplayName,result,targetResources,initiatedBy&$top=100&$orderby=activityDateTime desc`
      ) || [];
      results[key] = events;
    } catch (e) {
      if (e.statusCode !== 403) {
        console.warn(`[AlertEngine] Directory audit (${key}) error for ${tenantId}:`, e.message);
      } else {
        console.warn(`[AlertEngine:Audit] ${key} — 403 FORBIDDEN for ${tenantId}`);
      }
      results[key] = [];
    }
  }

  // Diagnostic logging — audit fetcher results
  const nonEmpty = Object.entries(results).filter(([, v]) => v.length > 0).map(([k, v]) => `${k}:${v.length}`);
  console.log(`[AlertEngine:Audit] ${tenantId} — ${nonEmpty.length > 0 ? nonEmpty.join(', ') : 'all empty'} (since ${sinceStr})`);

  return results;
}

/**
 * Fetch risk detections since the last poll.
 */
async function fetchRiskDetections(tenantId, since) {
  const sinceStr = since.toISOString();
  try {
    return await graph.callGraphPaged(tenantId,
      `/identityProtection/riskDetections?$filter=detectedDateTime ge ${sinceStr}&$select=id,detectedDateTime,riskEventType,riskLevel,riskState,userDisplayName,userPrincipalName,ipAddress,location,activity&$top=100&$orderby=detectedDateTime desc`
    ) || [];
  } catch (e) {
    if (e.statusCode !== 403) {
      console.warn(`[AlertEngine] Risk detections error for ${tenantId}:`, e.message);
    }
    return [];
  }
}

/**
 * Fetch email threat events via Advanced Hunting (Defender for Office 365).
 * Queries the EmailEvents table for blocked/detected threats.
 * Returns normalized array of threat events.
 * Requires ThreatHunting.Read.All permission; gracefully returns [] if unavailable.
 */
async function fetchEmailThreats(tenantId, since) {
  const sinceStr = since.toISOString().replace('Z', '');
  const kql = `EmailEvents
| where Timestamp > datetime(${sinceStr})
| where DeliveryAction in ("Blocked", "Replaced", "Junked") or ThreatTypes != ""
| project Timestamp, NetworkMessageId, RecipientEmailAddress, SenderFromAddress, SenderFromDomain, Subject, ThreatTypes, ThreatNames, DeliveryAction, DeliveryLocation, DetectionMethods, EmailDirection
| order by Timestamp desc
| take 200`;

  try {
    const result = await graph.callGraph(tenantId, '/security/runHuntingQuery', {
      method: 'POST',
      body: { Query: kql },
      silent: true,
    });

    if (!result?.results) return [];

    // Normalize the results into a consistent event format
    const threats = result.results.map(row => ({
      timestamp: row.Timestamp,
      networkMessageId: row.NetworkMessageId,
      recipientEmail: row.RecipientEmailAddress,
      senderEmail: row.SenderFromAddress,
      senderDomain: row.SenderFromDomain,
      subject: row.Subject,
      threatTypes: row.ThreatTypes || '',
      threatNames: row.ThreatNames || '',
      deliveryAction: row.DeliveryAction,
      deliveryLocation: row.DeliveryLocation,
      detectionMethods: row.DetectionMethods || '',
      emailDirection: row.EmailDirection,
    }));

    if (threats.length > 0) {
      console.log(`[AlertEngine:EmailThreats] ${tenantId} — ${threats.length} threat(s): ${threats.slice(0, 3).map(t => `${t.senderDomain} → ${t.recipientEmail} (${t.threatTypes || 'unknown'}, ${t.deliveryAction})`).join('; ')}`);
    }
    return threats;
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn(`[AlertEngine:EmailThreats] ${tenantId} — 403 FORBIDDEN (missing ThreatHunting.Read.All?)`);
      return [];
    }
    if (e.statusCode === 400) {
      // EmailEvents table doesn't exist = tenant lacks Defender for Office 365 P2 license
      if (e.message && e.message.includes('EmailEvents')) {
        // Suppress to debug level — this is expected for tenants without MDO P2
      } else {
        console.warn(`[AlertEngine:EmailThreats] ${tenantId} — KQL error: ${e.message}`);
      }
      return [];
    }
    console.warn(`[AlertEngine:EmailThreats] ${tenantId} — ERROR: ${e.message}`);
    return [];
  }
}

/**
 * Fetch security alerts (Defender).
 * Two-path strategy:
 *   1. /security/alerts_v2 (REST API) — works for MDE alerts
 *   2. Advanced Hunting AlertInfo table — catches MDO (Defender for Office 365) alerts
 *      that don't always appear in alerts_v2 (e.g. "malware after delivery" via AIR/ZAP)
 * Results are merged and deduplicated by alert ID.
 */
async function fetchSecurityAlerts(tenantId, since) {
  const sinceStr = since.toISOString();

  // Path 1: REST API
  let restAlerts = [];
  try {
    const raw = await graph.callGraphPaged(tenantId,
      `/security/alerts_v2?$filter=createdDateTime ge ${sinceStr}&$select=id,title,severity,category,createdDateTime,status,description,serviceSource&$top=100&$orderby=createdDateTime desc`
    ) || [];
    // Normalize serviceSource (singular string) → serviceSources (array) to match hunting-path shape
    restAlerts = raw.map(a => ({ ...a, serviceSources: a.serviceSource ? [a.serviceSource] : [] }));
    if (restAlerts.length > 0) {
      console.log(`[AlertEngine:SecurityAlerts:REST] ${tenantId} — ${restAlerts.length} alert(s): ${restAlerts.map(a => `${a.category}/${a.severity}: "${a.title}"`).join(', ')}`);
    }
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn(`[AlertEngine:SecurityAlerts:REST] ${tenantId} — 403 FORBIDDEN`);
    } else {
      console.warn(`[AlertEngine:SecurityAlerts:REST] ${tenantId} — ERROR: ${e.message}`);
    }
  }

  // Path 2: Advanced Hunting — AlertInfo + AlertEvidence for MDO alerts
  let huntingAlerts = [];
  try {
    const huntSinceStr = since.toISOString().replace('Z', '');
    const kql = `AlertInfo
| where Timestamp > datetime(${huntSinceStr})
| where ServiceSource in ("Microsoft Defender for Office 365", "Microsoft Defender for Endpoint", "Microsoft Defender for Identity", "Microsoft Defender for Cloud Apps")
| project AlertId, Timestamp, Title, Severity, Category, ServiceSource, DetectionSource, AttackTechniques
| join kind=leftouter (
    AlertEvidence
    | where Timestamp > datetime(${huntSinceStr})
    | where EntityType in ("MailMessage", "Mailbox", "Url", "File", "User")
    | project AlertId, EntityType, EvidenceRole, RemoteUrl, FileName, AccountUpn, NetworkMessageId
) on AlertId
| summarize EvidenceCount=count(), EntityTypes=make_set(EntityType), Accounts=make_set(AccountUpn), Files=make_set(FileName) by AlertId, Timestamp, Title, Severity, Category, ServiceSource, DetectionSource, AttackTechniques
| order by Timestamp desc
| take 100`;

    const result = await graph.callGraph(tenantId, '/security/runHuntingQuery', {
      method: 'POST',
      body: { Query: kql },
      silent: true,
    });

    if (result?.results?.length > 0) {
      huntingAlerts = result.results.map(row => ({
        // Normalize to match REST API alert shape so evaluators work on both
        id: row.AlertId,
        title: row.Title,
        severity: (row.Severity || '').toLowerCase(),
        category: row.Category || '',
        createdDateTime: row.Timestamp,
        status: 'new',
        description: `${row.ServiceSource}: ${row.Title}`,
        serviceSources: [row.ServiceSource],
        // Extra fields from hunting
        detectionSource: row.DetectionSource,
        attackTechniques: row.AttackTechniques,
        evidenceCount: row.EvidenceCount,
        entityTypes: row.EntityTypes,
        accounts: row.Accounts,
        files: row.Files,
        _source: 'hunting', // tag so we can distinguish later
      }));

      console.log(`[AlertEngine:SecurityAlerts:Hunting] ${tenantId} — ${huntingAlerts.length} alert(s): ${huntingAlerts.slice(0, 5).map(a => `${a.serviceSources[0]}/${a.severity}: "${a.title}"`).join(', ')}`);
    }
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn(`[AlertEngine:SecurityAlerts:Hunting] ${tenantId} — 403 FORBIDDEN (needs ThreatHunting.Read.All)`);
    } else if (e.statusCode === 400) {
      console.warn(`[AlertEngine:SecurityAlerts:Hunting] ${tenantId} — KQL error: ${e.message}`);
    } else {
      console.warn(`[AlertEngine:SecurityAlerts:Hunting] ${tenantId} — ERROR: ${e.message}`);
    }
  }

  // Merge and deduplicate (REST alerts take priority)
  const seenIds = new Set(restAlerts.map(a => a.id));
  const merged = [...restAlerts];
  for (const ha of huntingAlerts) {
    if (!seenIds.has(ha.id)) {
      merged.push(ha);
      seenIds.add(ha.id);
    }
  }

  if (merged.length > 0) {
    const huntingOnly = merged.length - restAlerts.length;
    console.log(`[AlertEngine:SecurityAlerts] ${tenantId} — merged total: ${merged.length} (${restAlerts.length} REST + ${huntingOnly} hunting-only)`);
  } else {
    console.log(`[AlertEngine:SecurityAlerts] ${tenantId} — no alerts (REST: 0, Hunting: 0)`);
  }

  return merged;
}

// ═══════════════════════════════════════════
// POLICY EVALUATORS
// ═══════════════════════════════════════════

/**
 * Evaluate all enabled policies for a tenant.
 * Called after each poll cycle.
 *
 * @param {object} tenant - Tenant row from DB (id, tenant_id, display_name, etc.)
 * @param {object} pollResults - The metric data collected in this poll cycle { services: { security: {...}, entra: {...}, ... } }
 * @param {Date} pollStart - When this poll cycle began (watermark for audit logs)
 */
async function evaluateTenant(tenant, pollResults, pollStart) {
  // Audit-only contract gate. Audit-only tenants must NOT generate alerts —
  // they're for snapshot collection only, with auto-deletion after the
  // 14d+7d lifecycle. Polling/snapshotting still happens upstream of here
  // (we need that data for the audit export); we just skip evaluation +
  // alert insertion. shouldProcessTenant returns false for audit_only,
  // true for managed (the safe default if mode is unknown).
  // See src/lib/tenant-mode.js. Wired Apr 29 after first paying audit
  // accidentally generated 123 spam-blocked alerts within minutes of
  // role-assignment-driven first poll.
  if (!await tenantMode.shouldProcessTenant(tenant.id)) {
    console.log(`[AlertEngine] Skipping audit-only tenant ${tenant.id} (${tenant.tenant_id}) — alerts disabled by audit_only contract`);
    return;
  }

  // Load all policies, then filter in JS. Two categories pass the filter:
  //   1. enabled = TRUE           → evaluated for alerting
  //   2. track_daily_telemetry    → telemetry accumulator only (Phase 8)
  // We filter in JS (not SQL) because MySQL's JSON_EXTRACT comparison with boolean
  // literals has inconsistent semantics across versions — simpler and more reliable
  // to parse the JSON column on the ~30-row policies table.
  const allPolicies = await db.queryRows('SELECT * FROM alert_policies');
  const policies = allPolicies.filter(p => {
    if (p.enabled) return true;
    let logic;
    try {
      logic = typeof p.detection_logic === 'string'
        ? JSON.parse(p.detection_logic)
        : p.detection_logic;
    } catch {
      return false;
    }
    return logic?.track_daily_telemetry === true;
  });

  if (policies.length === 0) return;

  // Determine watermark — use last_polled_at or fall back to 24h ago for first run
  const lastPolled = tenant.last_polled_at
    ? new Date(tenant.last_polled_at)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fetch audit logs (event-based data not covered by Phase 2 fetchers) plus
  // this tenant's CA exemption map. The exemption map is Map<controlDim, Set<upn>>
  // and is consumed by evaluators that declare depends_on_controls in their
  // detection_logic — they filter the fire set by checking whether the target
  // UPN is exempted for the control dimension whose absence moots the alert.
  const [signInData, auditData, riskDetections, securityAlerts, emailThreats, exemptedUpnsByControl, allowedCountriesFromCa] = await Promise.all([
    // UAL Phase 1b (May 2026): every sign-in fetch double-writes to signin_cache
    // so src/lib/ca-compliance-correlation.js can do fast in-DB lookups when
    // UAL events arrive 60-90 min later. Cache write is fire-and-forget — it
    // must never break the live alert pipeline. tenant.id (PK int) is the FK
    // target; tenant.tenant_id (GUID) is what fetchSignInLogs takes.
    fetchSignInLogs(tenant.tenant_id, lastPolled).then((buckets) => {
      signinCache.cacheSignIns(tenant.id, buckets).catch((err) => {
        console.warn(`[AlertEngine] signin_cache write failed for tenant ${tenant.id}: ${err.message}`);
      });
      return buckets;
    }),
    fetchDirectoryAudits(tenant.tenant_id, lastPolled),
    fetchRiskDetections(tenant.tenant_id, lastPolled),
    fetchSecurityAlerts(tenant.tenant_id, lastPolled),
    fetchEmailThreats(tenant.tenant_id, lastPolled),
    exemptionResolver.buildExemptedUpnsByControl(tenant.id, tenant.tenant_id),
    deriveAllowedCountriesFromCa(tenant.tenant_id),
  ]);

  const auditContext = {
    signIns: signInData,
    audits: auditData,
    riskDetections,
    securityAlerts,
    emailThreats,
    snapshots: pollResults,
    tenant,
    lastPolled,
    exemptedUpnsByControl,
    allowedCountriesFromCa,
  };

  const newAlerts = [];

  for (const policy of policies) {
    try {
      const logic = typeof policy.detection_logic === 'string'
        ? JSON.parse(policy.detection_logic)
        : policy.detection_logic;

      // Telemetry accumulation — runs for any policy with track_daily_telemetry,
      // regardless of whether the policy is enabled for alerting. This feeds
      // daily_event_counts for the Daily Activity donut charts.
      //
      // IMPORTANT: The sign-in fetcher uses a 30-min latency buffer (see the
      // fetch comments), so the same Graph event can appear in multiple poll
      // batches. We MUST dedupe before counting, otherwise the donut counter
      // inflates relative to the unique events visible in the drill-down modal.
      // The sequence here is: store-first (INSERT IGNORE dedupes), then count
      // only the newly-inserted rows. The Haiku summary is regenerated from
      // the full day's deduped events whenever something new lands.
      if (logic.track_daily_telemetry) {
        try {
          const events = getEventsForPolicy(policy, logic, auditContext);
          const batchSeen = Array.isArray(events) ? events.length : 0;
          if (batchSeen > 0) {
            const eventType = (logic.filter && logic.filter.includes('conditionalAccessStatus'))
              ? 'ca_block'
              : 'login_failure';
            try {
              const newCount = await storeEventDetails(tenant.id, eventType, events);
              await accumulateDailyCount(tenant.id, policy.id, newCount);
              if (newCount > 0) {
                console.log(`[AlertEngine:Telemetry] "${policy.name}" for ${tenant.display_name} — seen: ${batchSeen}, new: ${newCount}`);
                await generateEventSummary(tenant.id, tenant.display_name, eventType);
              } else {
                console.log(`[AlertEngine:Telemetry] "${policy.name}" for ${tenant.display_name} — seen: ${batchSeen}, all duplicates (no counter increment)`);
              }
            } catch (detailErr) {
              console.warn(`[AlertEngine:EventDetails] ${tenant.display_name} ${eventType} — ${detailErr.message}`);
            }
          }
        } catch (e) {
          console.warn(`[AlertEngine:Telemetry] "${policy.name}" for ${tenant.display_name} — accumulator error: ${e.message}`);
        }
      }

      // Disabled policies skip alerting entirely (they may still have run the
      // telemetry accumulator above if flagged).
      if (!policy.enabled) continue;

      const triggered = await evaluatePolicy(policy, logic, auditContext);

      if (triggered && triggered.length > 0) {
        for (const alert of triggered) {
          const savedAlert = await createOrUpdateAlert(tenant, policy, alert);
          if (savedAlert && savedAlert.isNew) {
            newAlerts.push(savedAlert);
          }
        }
      }
    } catch (e) {
      console.error(`[AlertEngine] Policy "${policy.name}" evaluation failed for ${tenant.display_name}:`, e.message);
    }
  }

  // Process new alerts: AI analysis + email notification
  if (newAlerts.length > 0) {
    console.log(`[AlertEngine] ${newAlerts.length} new alert(s) for ${tenant.display_name}`);

    for (const alert of newAlerts) {
      // Apr 30, 2026 — auto-resolved by an alert exemption rule. The
      // alert row is already in the DB with status='resolved'. Skip AI
      // analysis (wasted compute on something the operator pre-decided
      // is benign), email notification (the whole point — no fatigue),
      // and severity adjustment (irrelevant for resolved). The row is
      // still visible in the dashboard with "Show auto-resolved" on.
      if (alert.isAutoResolved) {
        console.log(`[AlertEngine] Skipping AI/notify for auto-resolved alert ${alert.id} (rule ${alert.autoResolvedRuleId})`);
        continue;
      }

      // The rule-based severity at alert creation time. We preserve this for
      // the email notification AND persist it to alerts.rule_severity so the
      // UI can always show "this fired at X, AI adjusted to Y".
      const ruleSeverity = alert.severity;
      let aiResult = null;

      try {
        // Get Haiku AI analysis — Phase 9a: returns
        // { ai_analysis_en, ai_analysis_fr, ai_analysis_es,
        //   proposedSeverity, proposedReason }.
        // Phase 9c (May 2, 2026): expose all three localized variants on the
        // in-memory alert so the notifier can pick the right one per
        // recipient's preferred language. `alert.ai_analysis` stays as the
        // English copy for any legacy reader; new path uses
        // alert.ai_analysis_en/fr/es directly.
        aiResult = await aiAnalysis.analyzeAlert(alert, tenant);
        if (aiResult && aiResult.ai_analysis_en) {
          await db.execute(
            `UPDATE alerts
                SET ai_analysis_en = ?,
                    ai_analysis_fr = ?,
                    ai_analysis_es = ?,
                    rule_severity = ?
              WHERE id = ?`,
            [
              aiResult.ai_analysis_en,
              aiResult.ai_analysis_fr || null,
              aiResult.ai_analysis_es || null,
              ruleSeverity,
              alert.id,
            ]
          );
          alert.ai_analysis = aiResult.ai_analysis_en;
          alert.ai_analysis_en = aiResult.ai_analysis_en;
          alert.ai_analysis_fr = aiResult.ai_analysis_fr || null;
          alert.ai_analysis_es = aiResult.ai_analysis_es || null;
        }
      } catch (e) {
        console.error(`[AlertEngine] AI analysis failed for alert ${alert.id}:`, e.message);
      }

      try {
        // Notification fires at the ORIGINAL rule severity. `alert.severity`
        // in memory is still ruleSeverity at this point — the DB severity is
        // adjusted below, after the email is out. This is the safer default:
        // AI adjustment affects the dashboard view; the email already fired
        // at rule severity so a wrongly-downgraded real threat is still
        // visible in the operator's inbox.
        await notifier.sendAlertNotification(alert, tenant);
      } catch (e) {
        console.error(`[AlertEngine] Notification failed for alert ${alert.id}:`, e.message);
      }

      // Apply severity adjustment AFTER the email has gone out.
      // Guardrails:
      //   - Only downgrade (rank decreases). Upgrades are logged but not applied.
      //   - Kill switch: config.ai.canAdjustSeverity (default true) disables entirely.
      //   - No proposal → no change.
      try {
        if (aiResult && aiResult.proposedSeverity && config.ai?.canAdjustSeverity !== false) {
          const proposed = aiResult.proposedSeverity;
          const reason = aiResult.proposedReason || 'AI adjustment (no reason given)';
          const rank = { info: 1, low: 2, medium: 3, high: 4, severe: 5 };
          const ruleRank = rank[ruleSeverity] || 0;
          const proposedRank = rank[proposed] || 0;

          if (proposedRank > 0 && proposedRank < ruleRank) {
            // Downgrade — apply.
            await db.execute(
              'UPDATE alerts SET severity = ?, ai_severity_reason = ? WHERE id = ?',
              [proposed, reason, alert.id]
            );
            alert.severity = proposed;
            alert.ai_severity_reason = reason;
            console.log(`[AlertEngine] Alert ${alert.id} severity adjusted by AI: ${ruleSeverity} → ${proposed} (${reason})`);
          } else if (proposedRank > ruleRank) {
            // Upgrade proposal — log, do not apply. Stored in ai_severity_reason
            // so the operator can see "AI thinks this is more serious".
            const upgradeNote = `AI proposed upgrade to ${proposed} (not applied): ${reason}`;
            await db.execute(
              'UPDATE alerts SET ai_severity_reason = ? WHERE id = ?',
              [upgradeNote, alert.id]
            );
            alert.ai_severity_reason = upgradeNote;
            console.log(`[AlertEngine] Alert ${alert.id} AI proposed upgrade ${ruleSeverity} → ${proposed} (not applied)`);
          }
          // proposedRank === ruleRank → no-op, no note.
        }
      } catch (e) {
        console.error(`[AlertEngine] Severity adjustment failed for alert ${alert.id}:`, e.message);
      }
    }
  }

  return newAlerts;
}

/**
 * Evaluate a single policy against the audit context.
 * Returns an array of triggered alert objects (may be empty).
 */
async function evaluatePolicy(policy, logic, ctx) {
  // Internally-triggered policies (CA drift, Intune drift, system health) — not poll-evaluated
  if (logic.type === 'ca_drift' || logic.type === 'intune_drift' || logic.type === 'system_health') {
    return [];
  }

  // May 20, 2026 — Bundle A-F UAL policies (Defender alerts, anonymous SharePoint
  // links, mass file deletions, etc.) are evaluated by the separate engine in
  // src/ual-evaluators.js, not by this threshold_type dispatcher. They appear in
  // the master policy list iterated by evaluateTenant() because they share the
  // same alert_policies table, but they don't carry threshold_type. Without this
  // skip, every poll cycle logs 25 "Unknown threshold_type" warnings per tenant
  // (one per UAL policy) — pure log noise. Convention: every UAL policy's name
  // starts with "UAL:" (set at bootstrap time in ual-evaluators.js).
  if (policy.name && policy.name.startsWith('UAL:')) {
    return [];
  }

  // Delta/change detection takes priority — snapshot comparison policies
  // may have threshold_type set for event-based fallback, but delta_query
  // or check_mfa_disabled means they need snapshot comparison, not event matching.
  if (logic.delta_query || logic.check_mfa_disabled) {
    return evaluateChangeDetection(policy, logic, ctx);
  }

  const thresholdType = logic.threshold_type;

  switch (thresholdType) {
    case 'any_new':
      return evaluateAnyNew(policy, logic, ctx);
    case 'count_per_user':
      return evaluateCountPerUser(policy, logic, ctx);
    // Phase 8: volume_spike, daily_aggregate, and telemetry_only are no-ops for
    // alerting. The two surviving data flows — user login failures and CA blocks —
    // are now surfaced as ambient telemetry on the Daily Activity dashboard. The
    // accumulator runs earlier in evaluateTenant() for any policy flagged with
    // track_daily_telemetry, so these cases simply skip alert creation.
    case 'volume_spike':
    case 'daily_aggregate':
    case 'telemetry_only':
      return [];
    case 'imperative':
      // Apr 27, 2026 — alerts of this type are fired by direct calls (e.g.
      // SECURITY_DRIFT from src/lib/security-settings/poll.js), NOT by the
      // scheduled evaluator. Skipping cleanly without a warning keeps the
      // boot logs clean.
      return [];
    default:
      console.warn(`[AlertEngine] Unknown threshold_type: ${thresholdType} in policy "${policy.name}"`);
      return [];
  }
}

// ─── Pattern 1: Any New Events ───

function evaluateAnyNew(policy, logic, ctx) {
  const events = getEventsForPolicy(policy, logic, ctx);
  if (!events || events.length === 0) return [];

  return events.map(event => {
    // Phase 9b — buildAlertMessage now returns a structured payload. Spread
    // message_template_key + message_template_params into raw_data so the
    // Alerts UI can localize the message at display time. The English
    // `message` string remains the canonical stored form for emails / exports.
    const built = buildAlertMessage(policy, event);
    return {
      message: built.message,
      raw_data: {
        ...event,
        message_template_key: built.message_template_key,
        message_template_params: built.message_template_params,
      },
      dedup_key: buildDedupKey(policy, event),
    };
  });
}

// ─── Pattern 2: REMOVED in Phase 8 (2026-04-09) — Volume Spike ───
//
// evaluateVolumeSpike() was deleted because tenant-wide volume alerts on ambient
// activity (login failures, CA blocks, external sharing, file deletion) produced
// constant noise that operators had to clear every poll. These data flows are now
// surfaced as ambient telemetry via the Daily Activity donut charts instead.
//
// What remains from the volume_spike machinery:
//   • accumulateDailyCount() / getDailyCount() / getDailyBaseline() — still used
//     by the telemetry accumulator pass in evaluateTenant() to feed daily_event_counts
//   • The daily_event_counts table itself — feeds /api/daily-activity
//
// The threshold types `volume_spike`, `daily_aggregate`, and the new `telemetry_only`
// all route to a no-op return in evaluatePolicy().

// ─── Pattern 3: Count Per User ───

function evaluateCountPerUser(policy, logic, ctx) {
  const events = getEventsForPolicy(policy, logic, ctx);
  if (!events || events.length === 0) return [];

  const threshold = logic.threshold_count || 5;
  const windowMinutes = logic.window_minutes || 30;
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

  // Group events by user
  const userCounts = {};
  for (const event of events) {
    const user = event.userPrincipalName || event.userDisplayName || 'unknown';
    const eventTime = new Date(event.createdDateTime || event.activityDateTime);
    if (eventTime >= cutoff) {
      userCounts[user] = (userCounts[user] || 0) + 1;
    }
  }

  const alerts = [];
  for (const [user, count] of Object.entries(userCounts)) {
    if (count >= threshold) {
      const slug = policySlug(policy.name);
      alerts.push({
        message: `${policy.name}: ${user} — ${count} occurrences in ${windowMinutes} minutes`,
        raw_data: {
          user, count, threshold, windowMinutes,
          // Phase 9b — structured payload for i18n display-time rendering.
          // Frontend reads message_template_key + message_template_params from
          // raw_data (via JSON_EXTRACT at the API layer) and re-renders the
          // message in the operator's locale. Stored English `message` above
          // remains the canonical form for emails / exports / unmigrated UI.
          message_template_key: 'alerts.message_format.count_per_user',
          message_template_params: {
            policyNameKey: `alert_policy_names.${slug}`,
            policyNameFallback: policy.name,
            user,
            count,
            windowMinutes,
          },
        },
        dedup_key: `${policy.id}:user:${user}`,
      });
    }
  }

  return alerts;
}

// ─── Pattern 4: REMOVED in Phase 8 (2026-04-09) — Daily Aggregate ───
//
// evaluateDailyAggregate() was deleted alongside evaluateVolumeSpike(). It was
// only used by "User login failure summary" to fire an alert when >50 failed
// logins accumulated in a day. That workflow is now the Daily Activity donut.

// ─── Change Detection (Delta) ───

async function evaluateChangeDetection(policy, logic, ctx) {
  // Compare current snapshot to previous snapshot for the relevant metric
  const endpoint = logic.endpoint;

  // Global admin elevation
  if (endpoint === '/directoryRoles' && logic.role_template_id) {
    return evaluateRoleChange(policy, logic, ctx);
  }

  // Enterprise app creation
  if (endpoint === '/applications') {
    return evaluateAppChange(policy, logic, ctx);
  }

  // Guest user addition
  if (endpoint === '/users' && logic.filter?.includes('Guest')) {
    return evaluateGuestUserChange(policy, logic, ctx);
  }

  // MFA disabled detection — uses snapshot comparison
  if (logic.check_mfa_disabled) {
    return evaluateMfaDisabled(policy, logic, ctx);
  }

  // Inbox rule + external forwarding — snapshot-delta on mail_forwarding.
  // logic.delta_source identifies which subset to compare:
  //   "mail_forwarding.allRules"      = every enabled inbox rule (created/modified/deleted)
  //   "mail_forwarding.externalRules" = forwarding-to-external subset (created)
  //
  // NOTE on "deleted": the snapshot only contains ENABLED rules (fetchMailForwarding
  // skips disabled ones), so a user disabling a rule looks identical to deletion at
  // this layer. Kept as severity=info + notification_target=none for exactly this
  // reason — info-level dashboard signal, no email noise.
  if (logic.delta_source === 'mail_forwarding.allRules') {
    if (logic.delta_type === 'created') return evaluateInboxRuleCreated(policy, logic, ctx);
    if (logic.delta_type === 'modified') return evaluateInboxRuleModified(policy, logic, ctx);
    if (logic.delta_type === 'deleted') return evaluateInboxRuleDeleted(policy, logic, ctx);
  }
  if (logic.delta_source === 'mail_forwarding.externalRules' && logic.delta_type === 'created') {
    return evaluateExternalForwardingNew(policy, logic, ctx);
  }

  // Apr 28, 2026: mailbox-level forwarding (Set-Mailbox -ForwardingSmtpAddress).
  // Sibling vector to inbox-rule forwarding — covered by a separate fetcher
  // because Microsoft Graph doesn't expose this property.
  if (logic.delta_source === 'mailbox_forwarding.users' && logic.delta_type === 'enabled') {
    return evaluateMailboxLevelForwardingEnabled(policy, logic, ctx);
  }

  return [];
}

async function evaluateRoleChange(policy, logic, ctx) {
  const current = ctx.snapshots?.services?.security?.global_admins;
  if (!current?.admins) return [];

  // Get previous snapshot
  const prev = await getPreviousSnapshot(ctx.tenant.id, 'security', 'global_admins');
  if (!prev?.admins) return []; // No previous data, skip

  const currentIds = new Set(current.admins.map(a => a.id));
  const prevIds = new Set(prev.admins.map(a => a.id));

  const newAdmins = current.admins.filter(a => !prevIds.has(a.id));

  return newAdmins.map(admin => ({
    message: `${policy.name}: ${admin.displayName} (${admin.userPrincipalName}) added as Global Administrator`,
    raw_data: {
      newAdmin: admin,
      currentCount: current.count,
      previousCount: prev.count,
      message_template_key: 'alerts.message_format.global_admin_privilege_elevation',
      message_template_params: {
        policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
        policyNameFallback: policy.name,
        displayName: admin.displayName || '',
        userPrincipalName: admin.userPrincipalName || '',
      },
    },
    dedup_key: `${policy.id}:admin:${admin.id}`,
  }));
}

async function evaluateAppChange(policy, logic, ctx) {
  const current = ctx.snapshots?.services?.entra?.registered_apps;
  if (!Array.isArray(current)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'entra', 'registered_apps');
  if (!Array.isArray(prev)) return [];

  const prevIds = new Set(prev.map(a => a.appId || a.id));
  const newApps = current.filter(a => !prevIds.has(a.appId || a.id));

  return newApps.map(app => ({
    message: `${policy.name}: "${app.displayName}" registered`,
    raw_data: {
      app,
      message_template_key: 'alerts.message_format.enterprise_application_creation',
      message_template_params: {
        policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
        policyNameFallback: policy.name,
        appName: app.displayName || '',
      },
    },
    dedup_key: `${policy.id}:app:${app.appId || app.id}`,
  }));
}

async function evaluateGuestUserChange(policy, logic, ctx) {
  // Use audit log data for guest additions
  const addGuestEvents = ctx.audits?.addGuest || [];

  return addGuestEvents.map(event => {
    const target = (event.targetResources || [])[0];
    const guestName = target?.displayName || target?.userPrincipalName || 'Unknown guest';
    return {
      message: `${policy.name}: ${guestName} invited as external user`,
      raw_data: {
        event,
        message_template_key: 'alerts.message_format.external_user_addition',
        message_template_params: {
          policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
          policyNameFallback: policy.name,
          guestName,
        },
      },
      dedup_key: `${policy.id}:guest:${target?.id || guestName}`,
    };
  });
}

async function evaluateMfaDisabled(policy, logic, ctx) {
  const current = ctx.snapshots?.services?.security?.mfa_not_registered_users;
  if (!Array.isArray(current)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'security', 'mfa_not_registered_users');
  if (!Array.isArray(prev)) return [];

  // Collector (fetchMfaStatus) emits { name, upn } — NOT userDisplayName/
  // userPrincipalName/id. Reading the wrong keys made every entry's identity
  // resolve to `undefined`, collapsing all unregistered users into a single
  // alert keyed `:mfa:undefined` with an ever-climbing recurrence_count
  // (latent since initial import; surfaced 2026-05-30).
  const prevSet = new Set(prev.map(u => u.upn));
  let newUnregistered = current.filter(u => !prevSet.has(u.upn));

  // Exemption-aware: if the policy declares depends_on_controls, any UPN in
  // the tenant's active exemption set for *any* of those control dimensions
  // is skipped. Typical pairing: this alert ↔ "Require MFA" CA template with
  // control_dimensions: ["require_mfa"]. A user excluded from the MFA
  // requirement by policy design shouldn't trigger an "MFA disabled" alert.
  //
  // Same inline pattern as foreignLogin (see endpoint === 'foreignLogin' above).
  // Mirrors the contract: one suppression audit row per dropped candidate,
  // best-effort (fire-and-forget).
  const dependsOn = Array.isArray(logic.depends_on_controls) ? logic.depends_on_controls : [];
  if (dependsOn.length > 0 && ctx.exemptedUpnsByControl) {
    const tenantDbId = ctx.tenant?.id;
    const policyId = policy?.id;
    newUnregistered = newUnregistered.filter(u => {
      const upn = (u.upn || '').toLowerCase();
      if (!upn) return true; // no UPN, can't match an exemption — keep it
      for (const dim of dependsOn) {
        const exemptSet = ctx.exemptedUpnsByControl.get(dim);
        if (exemptSet && exemptSet.has(upn)) {
          exemptionResolver.logSuppression({
            tenantDbId,
            policyId,
            evaluator: 'mfaDisabled',
            upn,
            controlDimension: dim,
            eventSnippet: `${u.name || upn} — MFA not registered`,
          }).catch(() => {});
          console.log(`[AlertEngine:MfaDisabled] SUPPRESSED ${upn} — exempted for '${dim}'`);
          return false;
        }
      }
      return true;
    });
  }

  return newUnregistered.map(user => ({
    message: `${policy.name}: ${user.name || user.upn} — MFA not registered`,
    raw_data: {
      user,
      message_template_key: 'alerts.message_format.mfa_disabled_users',
      message_template_params: {
        policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
        policyNameFallback: policy.name,
        userName: user.name || user.upn || '',
      },
    },
    dedup_key: `${policy.id}:mfa:${user.upn}`,
  }));
}

// ─── Inbox Rule + External Forwarding (snapshot-delta) ───
//
// These three evaluators all operate on the same ctx.snapshots.services.exchange.mail_forwarding
// data produced by fetchMailForwarding(). fetchMailForwarding runs on the SLOW tier, so
// alerts from this family fire at that cadence, not every live poll.
//
// Dedup keys embed policy.id + UPN + stable identifier (ruleId falls back to ruleName)
// so rename-only changes don't re-fire the created alert.

function _ruleKey(r) {
  return `${r.userPrincipalName}:${r.ruleId || r.ruleName}`;
}

async function evaluateInboxRuleCreated(policy, logic, ctx) {
  // Use allRules (full inbox rule set); `rules` is the forwarding-only subset
  // reserved for the dashboard.
  const current = ctx.snapshots?.services?.exchange?.mail_forwarding?.allRules;
  if (!Array.isArray(current)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'exchange', 'mail_forwarding');
  // First-ever poll for this tenant: no baseline, so existing rules are not "new".
  // Also skip if the previous snapshot predates the allRules addition (legacy shape).
  if (!prev || !Array.isArray(prev.allRules)) return [];

  const prevKeys = new Set(prev.allRules.map(_ruleKey));
  const newRules = current.filter(r => !prevKeys.has(_ruleKey(r)));

  return newRules.map(rule => {
    const extNote = rule.isExternal
      ? ` — forwards externally to ${rule.externalTargets.join(', ')}`
      : (rule.hasForwardingAction ? ' — forwards internally' : '');
    // Phase 9b — pre-resolve the forwarding-note variant to a translatable
    // sub-key. Three branches: external (with target list), internal-only, none.
    // Frontend renders the parent template with {extNote} substituted, where
    // extNote itself is the translation of the chosen sub-key.
    const externalTargets = rule.isExternal ? (rule.externalTargets || []).join(', ') : '';
    const extNoteVariant = rule.isExternal
      ? 'external'
      : (rule.hasForwardingAction ? 'internal' : 'none');
    return {
      message: `${policy.name}: "${rule.ruleName}" created on ${rule.user} (${rule.userPrincipalName})${extNote}`,
      raw_data: {
        rule,
        message_template_key: 'alerts.message_format.inbox_rule_created',
        message_template_params: {
          policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
          policyNameFallback: policy.name,
          ruleName: rule.ruleName || '',
          user: rule.user || '',
          userPrincipalName: rule.userPrincipalName || '',
          extNoteKey: `alerts.message_format.inbox_rule_ext_note_created.${extNoteVariant}`,
          extNoteFallback: extNote,
          externalTargets,
        },
      },
      dedup_key: `${policy.id}:inboxrule:${_ruleKey(rule)}`,
    };
  });
}

async function evaluateInboxRuleModified(policy, logic, ctx) {
  const current = ctx.snapshots?.services?.exchange?.mail_forwarding?.allRules;
  if (!Array.isArray(current)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'exchange', 'mail_forwarding');
  if (!prev || !Array.isArray(prev.allRules)) return [];

  const prevByKey = new Map(prev.allRules.map(r => [_ruleKey(r), r]));

  const modified = [];
  for (const rule of current) {
    const key = _ruleKey(rule);
    const prevRule = prevByKey.get(key);
    if (!prevRule) continue;                        // new rule — created evaluator handles
    if (!prevRule.actionHash) continue;             // legacy snapshot without hash — skip one cycle
    if (prevRule.actionHash === rule.actionHash) continue; // unchanged

    // Meaningful-action filter: only alert when the NEW actions include a
    // forward, redirect, delete, or move-to-folder action. Filters out benign
    // edits (renames, condition tweaks, disable/enable cycles on non-risky rules).
    const a = rule.actions || {};
    const hasSignificantAction =
      (a.forwardTo && a.forwardTo.length) ||
      (a.redirectTo && a.redirectTo.length) ||
      (a.forwardAsAttachmentTo && a.forwardAsAttachmentTo.length) ||
      a.delete === true ||
      a.permanentDelete === true ||
      !!a.moveToFolder;

    if (!hasSignificantAction) continue;

    const extNote = rule.isExternal
      ? ` — now forwards externally to ${rule.externalTargets.join(', ')}`
      : (rule.hasForwardingAction ? ' — forwards internally' : '');
    const externalTargets = rule.isExternal ? (rule.externalTargets || []).join(', ') : '';
    const extNoteVariant = rule.isExternal
      ? 'external'
      : (rule.hasForwardingAction ? 'internal' : 'none');
    modified.push({
      message: `${policy.name}: "${rule.ruleName}" modified on ${rule.user} (${rule.userPrincipalName})${extNote}`,
      raw_data: {
        rule,
        previousActionHash: prevRule.actionHash,
        newActionHash: rule.actionHash,
        previousActions: prevRule.actions,
        message_template_key: 'alerts.message_format.inbox_rule_modified',
        message_template_params: {
          policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
          policyNameFallback: policy.name,
          ruleName: rule.ruleName || '',
          user: rule.user || '',
          userPrincipalName: rule.userPrincipalName || '',
          extNoteKey: `alerts.message_format.inbox_rule_ext_note_modified.${extNoteVariant}`,
          extNoteFallback: extNote,
          externalTargets,
        },
      },
      // Include actionHash in dedup_key so the SAME modification doesn't re-fire,
      // but a subsequent modification (different hash) will.
      dedup_key: `${policy.id}:inboxrule-mod:${_ruleKey(rule)}:${rule.actionHash}`,
    });
  }

  return modified;
}

async function evaluateInboxRuleDeleted(policy, logic, ctx) {
  // Mirror of evaluateInboxRuleCreated — diff the previous snapshot's rule set
  // against the current one, emitting an alert for each rule key that is gone.
  //
  // Caveat: fetchMailForwarding's allRules only includes ENABLED rules, so a user
  // disabling a rule (without deleting it) will ALSO trigger this evaluator. This
  // is why the policy is severity=info and notification_target=none by default —
  // it's a dashboard-only signal, not a pager-worthy event.
  const current = ctx.snapshots?.services?.exchange?.mail_forwarding?.allRules;
  if (!Array.isArray(current)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'exchange', 'mail_forwarding');
  // First-ever poll for this tenant: no baseline, so existing rules aren't "deleted".
  // Also skip if the previous snapshot predates the allRules addition (legacy shape).
  if (!prev || !Array.isArray(prev.allRules)) return [];

  const currKeys = new Set(current.map(_ruleKey));
  const deleted = prev.allRules.filter(r => !currKeys.has(_ruleKey(r)));

  return deleted.map(rule => {
    const extNote = rule.isExternal
      ? ` — had forwarded externally to ${(rule.externalTargets || []).join(', ')}`
      : (rule.hasForwardingAction ? ' — had internal forwarding' : '');
    const externalTargets = rule.isExternal ? (rule.externalTargets || []).join(', ') : '';
    const extNoteVariant = rule.isExternal
      ? 'external'
      : (rule.hasForwardingAction ? 'internal' : 'none');
    return {
      message: `${policy.name}: "${rule.ruleName}" deleted or disabled on ${rule.user} (${rule.userPrincipalName})${extNote}`,
      raw_data: {
        rule,
        note: 'Rule is missing from current snapshot; may have been deleted OR disabled.',
        message_template_key: 'alerts.message_format.inbox_rule_deleted',
        message_template_params: {
          policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
          policyNameFallback: policy.name,
          ruleName: rule.ruleName || '',
          user: rule.user || '',
          userPrincipalName: rule.userPrincipalName || '',
          extNoteKey: `alerts.message_format.inbox_rule_ext_note_deleted.${extNoteVariant}`,
          extNoteFallback: extNote,
          externalTargets,
        },
      },
      // One-shot event per rule key — once gone, gone. Dedup guards against
      // the snapshot-delta briefly returning the same diff across overlapping polls.
      dedup_key: `${policy.id}:inboxrule-del:${_ruleKey(rule)}`,
    };
  });
}

/**
 * Mailbox-level forwarding enabled (Apr 28, 2026).
 *
 * Fires when a user's mailbox-level forwardingSmtpAddress or forwardingAddress
 * goes from empty/null to set, comparing snapshot to snapshot. The current
 * fleet has tenant-level auto-forward to remote domains BLOCKED via remote-
 * domain config, so a non-empty forwardingSmtpAddress here likely fails to
 * actually deliver — but the SETTING existing still indicates compromise
 * intent and warrants an alert.
 *
 * `delta_type='enabled'` keyed because we explicitly do NOT alert on disable
 * (operator cleanup) or modify (rare; a noisy signal). New-only is the
 * security-relevant transition.
 *
 * Dedup key: policy.id + UPN — same UPN re-enabling forwarding after a
 * disable will fire again, which is the correct behavior.
 */
async function evaluateMailboxLevelForwardingEnabled(policy, logic, ctx) {
  const currentUsers = ctx.snapshots?.services?.exchange?.mailbox_forwarding?.users;
  if (!Array.isArray(currentUsers)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'exchange', 'mailbox_forwarding');
  if (!prev || !Array.isArray(prev.users)) return []; // first cycle — no baseline

  const prevByUpn = new Map(prev.users.map(u => [u.upn, u]));
  const externalOnly = logic.external_only === true;

  const newlyEnabled = [];
  for (const u of currentUsers) {
    if (!u.hasForwarding) continue;
    if (externalOnly && !u.isExternal) continue;
    const before = prevByUpn.get(u.upn);
    if (before && before.hasForwarding) continue; // already had forwarding — not a new event

    const target = u.forwardingSmtpAddress || u.forwardingAddress || '(unspecified)';
    const externalTag = u.isExternal ? ' (EXTERNAL DOMAIN)' : '';
    newlyEnabled.push({
      message: `${policy.name}: ${u.upn} mailbox-level forwarding enabled → ${target}${externalTag}`,
      raw_data: {
        upn: u.upn,
        forwardingSmtpAddress: u.forwardingSmtpAddress,
        forwardingAddress: u.forwardingAddress,
        deliverToMailboxAndForward: u.deliverToMailboxAndForward,
        isExternal: u.isExternal,
        message_template_key: 'alerts.message_format.mailbox_level_forwarding_enabled',
        message_template_params: {
          policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
          policyNameFallback: policy.name,
          upn: u.upn || '',
          target,
          externalTagKey: u.isExternal
            ? 'alerts.message_format.mbx_fwd_external_tag.external'
            : 'alerts.message_format.mbx_fwd_external_tag.none',
          externalTagFallback: externalTag,
        },
      },
      dedup_key: `${policy.id}:mbxfwd:${u.upn}:${target.toLowerCase()}`,
    });
  }
  return newlyEnabled;
}

async function evaluateExternalForwardingNew(policy, logic, ctx) {
  const currentExternal = ctx.snapshots?.services?.exchange?.mail_forwarding?.externalRules;
  if (!Array.isArray(currentExternal)) return [];

  const prev = await getPreviousSnapshot(ctx.tenant.id, 'exchange', 'mail_forwarding');
  if (!prev || !Array.isArray(prev.externalRules)) return [];

  // Key on UPN + ruleId (or name) + external target — each UPN/rule/target triple is one alert.
  const prevKeys = new Set();
  for (const r of prev.externalRules) {
    const base = _ruleKey(r);
    for (const target of r.externalTargets || []) {
      prevKeys.add(`${base}:${target.toLowerCase()}`);
    }
  }

  const newEntries = [];
  for (const rule of currentExternal) {
    const base = _ruleKey(rule);
    for (const target of rule.externalTargets || []) {
      const k = `${base}:${target.toLowerCase()}`;
      if (prevKeys.has(k)) continue;
      newEntries.push({
        message: `${policy.name}: ${rule.user} (${rule.userPrincipalName}) — rule "${rule.ruleName}" forwards to external address ${target}`,
        raw_data: {
          rule,
          externalTarget: target,
          message_template_key: 'alerts.message_format.external_forwarding_rule_creation',
          message_template_params: {
            policyNameKey: `alert_policy_names.${policySlug(policy.name)}`,
            policyNameFallback: policy.name,
            user: rule.user || '',
            userPrincipalName: rule.userPrincipalName || '',
            ruleName: rule.ruleName || '',
            target,
          },
        },
        dedup_key: `${policy.id}:extfwd:${base}:${target.toLowerCase()}`,
      });
    }
  }

  return newEntries;
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/**
 * Map a policy's endpoint/filter to the actual events from the audit context.
 */
function getEventsForPolicy(policy, logic, ctx) {
  const endpoint = logic.endpoint;

  // Sign-in log policies
  if (endpoint === '/auditLogs/signIns') {
    if (logic.filter?.includes('conditionalAccessStatus')) {
      let events = ctx.signIns?.caBlockedSignIns || [];
      if (logic.admin_only) {
        const adminUpns = getAdminUpns(ctx);
        events = events.filter(s =>
          adminUpns.has((s.userPrincipalName || '').toLowerCase())
        );
      }
      return events;
    }
    if (logic.filter?.includes('errorCode eq 50053')) {
      return (ctx.signIns?.failedSignIns || []).filter(s =>
        s.status?.errorCode === 50053
      );
    }
    if (logic.admin_only) {
      const adminUpns = getAdminUpns(ctx);
      return (ctx.signIns?.failedSignIns || []).filter(s =>
        adminUpns.has((s.userPrincipalName || '').toLowerCase())
      );
    }
    if (logic.filter?.includes("userType eq 'Guest'")) {
      return (ctx.signIns?.failedSignIns || []).filter(s =>
        s.userPrincipalName?.includes('#EXT#')
      );
    }
    // Default: all failed sign-ins
    return ctx.signIns?.failedSignIns || [];
  }

  // Foreign login detection — successful sign-ins from outside allowed countries,
  // excluding compliant (Intune-managed) devices.
  //
  // Exemption-aware: if the policy declares depends_on_controls, any UPN in
  // the tenant's active exemption set for *any* of those control dimensions
  // is skipped. Every skip writes an audit row to alerts_suppressed — we do
  // NOT silently drop signals. For the foreign-login case this turns the
  // Tatum/Alexandre false positive into a one-time "exemption granted"
  // drift alert plus silence afterwards until the exemption expires or is
  // revoked.
  if (endpoint === 'foreignLogin') {
    // Allowed-country set resolution — explicit > derived > empty.
    //   1. If detection_logic.allowed_countries is set, it wins (operator override).
    //   2. Else derive from the tenant's live CA policies classified as
    //      block_geographic_access (union of allowlist country codes).
    //   3. Else empty → evaluator returns empty (no alerts). Behaviour derives
    //      from policy structure; there is no hardcoded country default.
    let allowedCountries;
    if (Array.isArray(logic.allowed_countries) && logic.allowed_countries.length > 0) {
      allowedCountries = logic.allowed_countries.map(c => String(c).toUpperCase());
    } else if (ctx.allowedCountriesFromCa && ctx.allowedCountriesFromCa.size > 0) {
      allowedCountries = [...ctx.allowedCountriesFromCa].map(c => String(c).toUpperCase());
    } else {
      allowedCountries = [];
    }
    if (allowedCountries.length === 0) {
      console.warn(`[AlertEngine:ForeignLogin] Tenant ${ctx.tenant?.tenant_id?.slice(0, 8)}… has no allowed_countries configured and no block_geographic_access CA policy — skipping evaluator`);
      return [];
    }
    const excludeCompliant = logic.exclude_compliant_devices !== false; // default true
    const successfulOnly = logic.successful_only !== false; // default true
    const dependsOn = Array.isArray(logic.depends_on_controls) ? logic.depends_on_controls : [];

    const signIns = successfulOnly
      ? (ctx.signIns?.successfulSignIns || [])
      : [...(ctx.signIns?.successfulSignIns || []), ...(ctx.signIns?.failedSignIns || [])];

    const tenantDbId = ctx.tenant?.id;
    const policyId = policy?.id;

    return signIns.filter(s => {
      const country = (s.location?.countryOrRegion || '').toUpperCase();
      if (!country) return false;
      if (allowedCountries.includes(country)) return false;
      if (excludeCompliant && s.deviceDetail?.isCompliant === true) return false;

      // Exemption check — only if the policy declares a dependency and the
      // resolver built a non-empty map for that dimension in this tenant.
      if (dependsOn.length > 0 && ctx.exemptedUpnsByControl) {
        const upn = (s.userPrincipalName || '').toLowerCase();
        if (upn) {
          for (const dim of dependsOn) {
            const exemptSet = ctx.exemptedUpnsByControl.get(dim);
            if (exemptSet && exemptSet.has(upn)) {
              // Suppress and audit. Fire-and-forget — we do not block the
              // filter on the DB write.
              exemptionResolver.logSuppression({
                tenantDbId,
                policyId,
                evaluator: 'foreignLogin',
                upn,
                controlDimension: dim,
                eventSnippet: `${s.userDisplayName || upn} from ${country} (${s.location?.city || '?'})`,
              }).catch(() => {});
              console.log(`[AlertEngine:ForeignLogin] SUPPRESSED ${upn} from ${country} — exempted for '${dim}'`);
              return false;
            }
          }
        }
      }
      return true;
    });
  }

  // Risk detections — supports filtering by risk level and specific event types
  if (endpoint === '/identityProtection/riskDetections') {
    let detections = ctx.riskDetections || [];
    if (logic.filter?.includes('impossibleTravel')) {
      return detections.filter(r => r.riskEventType === 'impossibleTravel');
    }
    if (logic.min_risk_level) {
      const riskLevels = { low: 1, medium: 2, high: 3 };
      const minLevel = riskLevels[logic.min_risk_level] || 0;
      detections = detections.filter(r => {
        const level = riskLevels[r.riskLevel] || 0;
        return level >= minLevel;
      });
    }
    if (logic.exclude_event_types) {
      const excluded = new Set(logic.exclude_event_types);
      detections = detections.filter(r => !excluded.has(r.riskEventType));
    }
    return detections;
  }

  // Security alerts (Defender) — merged from REST API + Advanced Hunting
  if (endpoint === '/security/alerts_v2') {
    let alerts = ctx.securityAlerts || [];
    if (logic.filter?.includes("category eq 'Malware'")) {
      // Match on category OR title keywords — MDO "malware after delivery" alerts
      // may have varying categories but always mention malware in the title
      const malwareKeywords = ['malware', 'malicious'];
      alerts = alerts.filter(a => {
        const cat = (a.category || '').toLowerCase();
        const title = (a.title || '').toLowerCase();
        return cat === 'malware' || cat === 'unwantedsoftware' ||
               malwareKeywords.some(kw => title.includes(kw));
      });
    }
    if (logic.filter?.includes('SharePoint Online')) {
      alerts = alerts.filter(a =>
        (a.serviceSources || []).some(s => s.includes('SharePoint'))
      );
    }
    return alerts;
  }

  // Email threat policies (Advanced Hunting — EmailEvents)
  if (endpoint === 'emailThreats') {
    let threats = ctx.emailThreats || [];
    if (logic.filter_threat_type) {
      // Filter to specific threat type: "Malware", "Phish", "Spam"
      const filterType = logic.filter_threat_type.toLowerCase();
      threats = threats.filter(t =>
        (t.threatTypes || '').toLowerCase().includes(filterType)
      );
    }
    if (logic.filter_direction) {
      // Filter by direction: "Inbound", "Outbound"
      threats = threats.filter(t =>
        (t.emailDirection || '').toLowerCase() === logic.filter_direction.toLowerCase()
      );
    }
    if (logic.filter_action) {
      // Filter by delivery action: "Blocked", "Junked", "Replaced"
      threats = threats.filter(t =>
        (t.deliveryAction || '').toLowerCase() === logic.filter_action.toLowerCase()
      );
    }
    return threats;
  }

  // Directory audit policies
  if (endpoint === '/auditLogs/directoryAudits') {
    if (logic.filter?.includes('Change user password')) {
      return ctx.audits?.passwordChanges || [];
    }
    if (logic.filter?.includes('Change user license')) {
      return ctx.audits?.licenseChanges || [];
    }
    // Set-Mailbox / InboxRule dispatches removed 2026-04-17 — those events are not
    // in directoryAudits (see fetchDirectoryAudits comment). Detection moved to
    // snapshot-delta on mail_forwarding in evaluateInboxRule* / evaluateExternalForwardingNew.
    if (logic.filter?.includes('FileDeleted')) {
      return ctx.audits?.fileDeleted || [];
    }
    if (logic.filter?.includes('SharingSet')) {
      return ctx.audits?.sharingSet || [];
    }
    // Consent grant attacks
    if (logic.filter?.includes('Consent to application')) {
      return ctx.audits?.consentGrant || [];
    }
    // Conditional Access policy changes — exclude changes made by Panoptica itself
    // (auto-remediation creates audit events that would otherwise trigger alerts)
    if (logic.filter?.includes('conditional access policy')) {
      const allCaEvents = [
        ...(ctx.audits?.addCaPolicy || []),
        ...(ctx.audits?.updateCaPolicy || []),
        ...(ctx.audits?.deleteCaPolicy || []),
      ];
      return allCaEvents.filter(e => {
        const appName = (e.initiatedBy?.app?.displayName || '').toLowerCase();
        if (appName === 'panoptica') return false; // Skip self-initiated changes
        return true;
      });
    }
    // Admin role changes (Add member to role) — including Global Administrator
    if (logic.filter?.includes('Add member to role')) {
      let events = ctx.audits?.addMember || [];
      // If specific roles are listed, filter to those
      if (logic.role_names && Array.isArray(logic.role_names)) {
        const roleSet = new Set(logic.role_names.map(r => r.toLowerCase()));
        events = events.filter(e => {
          const modified = e.targetResources?.[0]?.modifiedProperties || [];
          const roleProp = modified.find(p => p.displayName === 'Role.DisplayName');
          const roleName = (roleProp?.newValue || '').replace(/"/g, '').toLowerCase();
          return roleSet.has(roleName);
        });
      }
      return events;
    }
    return [];
  }

  // Snapshot-based policies (not event-based)
  return null;
}

/**
 * Get admin UPNs from current snapshot for cross-referencing.
 */
function getAdminUpns(ctx) {
  const admins = ctx.snapshots?.services?.security?.global_admins?.admins || [];
  return new Set(admins.map(a => (a.userPrincipalName || '').toLowerCase()));
}

/**
 * Get the previous snapshot for a metric (the one before the current poll).
 */
async function getPreviousSnapshot(tenantDbId, service, metricName) {
  const rows = await db.queryRows(
    `SELECT metric_value FROM metric_snapshots
     WHERE tenant_id = ? AND service = ? AND metric_name = ?
       AND metric_name NOT LIKE 'daily_agg_%'
     ORDER BY captured_at DESC
     LIMIT 1 OFFSET 1`,
    [tenantDbId, service, metricName]
  );

  if (rows.length === 0) return null;

  // mysql2 execute() auto-parses JSON columns into JS objects.
  // If it's already an object, use it directly; only JSON.parse if it's a string.
  const raw = rows[0].metric_value;
  if (typeof raw === 'object' && raw !== null) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/// NOTE: Old getBaseline() removed — it compared alert counts from 7 days ago,
// not event counts. Replaced by getDailyBaseline() which uses rolling 7-day avg from daily_event_counts table.

/**
 * Build a human-readable alert message.
 */
// Phase 9b — buildAlertMessage now returns a structured object instead of a
// bare string. Each branch picks an i18n template_key under
// alerts.message_format.* + params; evaluateAnyNew spreads them into raw_data.
// The English `message` string is still produced (legacy email / export /
// unmigrated UI fallback) and stored on the alerts row.
function buildAlertMessage(policy, event) {
  const policyKey = `alert_policy_names.${policySlug(policy.name)}`;
  const baseParams = { policyNameKey: policyKey, policyNameFallback: policy.name };

  // Email threat events (Advanced Hunting)
  if (event.recipientEmail) {
    const threat = event.threatNames || event.threatTypes || 'threat detected';
    const action = event.deliveryAction || 'blocked';
    const subjectPhrase = event.subject ? ` — "${event.subject}"` : '';
    return {
      message: `${policy.name}: ${event.senderEmail} → ${event.recipientEmail}${subjectPhrase} (${threat}, ${action})`,
      message_template_key: 'alerts.message_format.email_threat',
      message_template_params: {
        ...baseParams,
        senderEmail: event.senderEmail || '',
        recipientEmail: event.recipientEmail || '',
        subjectPhraseKey: event.subject
          ? 'alerts.message_format.email_threat_subject.present'
          : 'alerts.message_format.email_threat_subject.absent',
        subjectPhraseFallback: subjectPhrase,
        subject: event.subject || '',
        threat: String(threat),
        action: String(action),
      },
    };
  }

  // Foreign login events (sign-in logs with location data)
  if (event.location?.countryOrRegion && event.deviceDetail) {
    const country = event.location.countryOrRegion;
    const city = event.location.city || '';
    const loc = city ? `${city}, ${country}` : country;
    const device = event.deviceDetail?.isCompliant ? 'compliant device' : 'non-compliant device';
    const managed = event.deviceDetail?.isManaged ? 'managed' : 'unmanaged';
    const userName = event.userDisplayName || event.userPrincipalName || '';
    const appName = event.appDisplayName || 'unknown app';
    return {
      message: `${policy.name}: ${userName} signed in from ${loc} (${managed}, ${device}) via ${appName}`,
      message_template_key: 'alerts.message_format.foreign_login',
      message_template_params: {
        ...baseParams,
        userName,
        location: loc,
        country,
        city,
        managedKey: event.deviceDetail?.isManaged
          ? 'alerts.message_format.device_managed.managed'
          : 'alerts.message_format.device_managed.unmanaged',
        managedFallback: managed,
        deviceKey: event.deviceDetail?.isCompliant
          ? 'alerts.message_format.device_compliance.compliant'
          : 'alerts.message_format.device_compliance.non_compliant',
        deviceFallback: device,
        appName,
      },
    };
  }

  // Directory audit events with target resources (consent grants, role changes, CA policies, inbox rules)
  if (event.targetResources?.length > 0 && event.activityDisplayName) {
    const target = event.targetResources[0];
    const initiator = event.initiatedBy?.user?.displayName || event.initiatedBy?.user?.userPrincipalName || 'System';
    const targetName = target.displayName || target.userPrincipalName || '';

    // Role assignments — extract the role name from modifiedProperties
    if (event.activityDisplayName === 'Add member to role') {
      const modified = target.modifiedProperties || [];
      const roleProp = modified.find(p => p.displayName === 'Role.DisplayName');
      const roleName = roleProp ? roleProp.newValue.replace(/"/g, '') : 'unknown role';
      return {
        message: `${policy.name}: ${targetName} added to ${roleName} by ${initiator}`,
        message_template_key: 'alerts.message_format.role_added',
        message_template_params: {
          ...baseParams, targetName, roleName, initiator,
        },
      };
    }

    // CA policy changes
    if (event.activityDisplayName.includes('conditional access policy')) {
      const action = event.activityDisplayName.replace('conditional access policy', 'CA policy');
      return {
        message: `${policy.name}: ${action} — "${targetName}" by ${initiator}`,
        message_template_key: 'alerts.message_format.ca_policy_change',
        message_template_params: {
          ...baseParams, action, targetName, initiator,
        },
      };
    }

    // Consent grants
    if (event.activityDisplayName === 'Consent to application') {
      return {
        message: `${policy.name}: ${initiator} granted consent to "${targetName}"`,
        message_template_key: 'alerts.message_format.consent_granted',
        message_template_params: {
          ...baseParams, initiator, targetName,
        },
      };
    }

    // Inbox rules
    if (event.activityDisplayName.includes('InboxRule')) {
      return {
        message: `${policy.name}: ${event.activityDisplayName} by ${initiator} — ${targetName}`,
        message_template_key: 'alerts.message_format.inbox_rule_audit',
        message_template_params: {
          ...baseParams,
          activity: event.activityDisplayName,
          initiator, targetName,
        },
      };
    }

    return {
      message: `${policy.name}: ${event.activityDisplayName} — ${targetName} by ${initiator}`,
      message_template_key: 'alerts.message_format.audit_generic',
      message_template_params: {
        ...baseParams,
        activity: event.activityDisplayName,
        targetName, initiator,
      },
    };
  }

  // Security alerts (REST or hunting-sourced) — have title + severity + serviceSources
  if (event.title && event.serviceSources) {
    const source = Array.isArray(event.serviceSources) ? event.serviceSources[0] : event.serviceSources;
    const sev = (event.severity || '').toUpperCase();
    const accounts = event.accounts?.filter(a => a)?.join(', ') || '';
    const accountInfo = accounts ? ` — ${accounts}` : '';
    return {
      message: `${policy.name}: [${sev}] ${event.title}${accountInfo} (${source})`,
      message_template_key: 'alerts.message_format.security_alert',
      message_template_params: {
        ...baseParams,
        severity: sev,
        title: event.title,
        accountPhraseKey: accounts
          ? 'alerts.message_format.security_alert_accounts.present'
          : 'alerts.message_format.security_alert_accounts.absent',
        accountPhraseFallback: accountInfo,
        accounts,
        source: String(source),
      },
    };
  }

  const who = event.userDisplayName || event.userPrincipalName || event.title || '';
  const what = event.activityDisplayName || event.riskEventType || event.category || '';

  if (who && what) {
    return {
      message: `${policy.name}: ${who} — ${what}`,
      message_template_key: 'alerts.message_format.who_what',
      message_template_params: { ...baseParams, who, what },
    };
  }
  if (who) {
    return {
      message: `${policy.name}: ${who}`,
      message_template_key: 'alerts.message_format.who_only',
      message_template_params: { ...baseParams, who },
    };
  }
  return {
    message: policy.name,
    message_template_key: 'alerts.message_format.policy_only',
    message_template_params: { ...baseParams },
  };
}

/**
 * Build a deduplication key for an event.
 *
 * Foreign logins: aggregate by user + country + calendar day so that one
 * foreign session (which generates dozens of per-app sign-in records) produces
 * a single alert whose recurrence count climbs, instead of flooding.
 */
function buildDedupKey(policy, event) {
  // Email threat events — dedup by network message ID (unique per email)
  if (event.networkMessageId) {
    return `${policy.id}:email:${event.networkMessageId}`.substring(0, 512);
  }
  // Foreign-login sign-in events — aggregate by user + country + date
  // A single foreign session creates many sign-in records (one per app/token).
  // Grouping by user+country+day keeps it to one alert per foreign session.
  if (event.location?.countryOrRegion && event.id) {
    const user = (event.userPrincipalName || event.id).toLowerCase();
    const country = event.location.countryOrRegion.toUpperCase();
    const day = (event.createdDateTime || new Date().toISOString()).substring(0, 10); // YYYY-MM-DD
    return `${policy.id}:foreign:${user}:${country}:${day}`.substring(0, 512);
  }
  // Security alerts (REST or hunting) — dedup by alert ID
  if (event.serviceSources && event.id) {
    return `${policy.id}:secalert:${event.id}`.substring(0, 512);
  }
  const userId = event.userPrincipalName || event.userId || '';
  const eventType = event.riskEventType || event.activityDisplayName || event.category || '';
  return `${policy.id}:${eventType}:${userId}`.substring(0, 512);
}

// ═══════════════════════════════════════════
// ALERT CREATION / DEDUPLICATION
// ═══════════════════════════════════════════

/**
 * Create a new alert or update an existing open one (deduplication).
 * Returns the alert object with `isNew` flag.
 */
async function createOrUpdateAlert(tenant, policy, alertData) {
  const dedupKey = alertData.dedup_key;

  // Check for existing open alert with the same dedup key
  if (dedupKey) {
    const existing = await db.queryOne(
      `SELECT id, recurrence_count FROM alerts
       WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating')
       LIMIT 1`,
      [tenant.id, dedupKey]
    );

    if (existing) {
      // Update recurrence count
      const newCount = (existing.recurrence_count || 1) + 1;
      await db.execute(
        'UPDATE alerts SET recurrence_count = ?, last_seen_at = NOW(), raw_data = ? WHERE id = ?',
        [newCount, JSON.stringify(alertData.raw_data), existing.id]
      );
      console.log(`[AlertEngine] Alert ${existing.id} recurrence: ${newCount}x`);
      return null; // Not a new alert
    }
  }

  // Apr 27, 2026 — severity override. Some alert types (notably
  // SECURITY_DRIFT) compute severity per-event from external metadata
  // rather than inheriting it from the policy. If alertData.severity is
  // provided AND is a valid enum, use it; otherwise fall back to
  // policy.severity (existing behavior).
  const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'severe']);
  const effectiveSeverity = (alertData.severity && VALID_SEVERITIES.has(alertData.severity))
    ? alertData.severity
    : policy.severity;

  // Apr 30, 2026 — Operator-defined alert exemption rules. If a rule
  // matches the would-be alert's match signal (UPN + country + optional
  // IP), write the alert with status='resolved' immediately and skip the
  // downstream notify/AI pipeline. Different from ca_exemptions: those
  // suppress at evaluator filter time and never write a row. Alert
  // exemption rules WRITE the row so post-incident forensics still see
  // the event in the dashboard (with "Show auto-resolved" toggled on).
  // See src/lib/alert-exemption-matcher.js + migrate-alert-exemption-rules.sql.
  let matchedRule = null;
  try {
    const signal = alertExemptionMatcher.extractSignal(alertData.raw_data);
    if (signal.upn) {
      matchedRule = await alertExemptionMatcher.findMatchingRule(
        tenant.id,
        policy.id,
        signal
      );
    }
  } catch (e) {
    // Match query should never break alerting. Loud-log and proceed as
    // if no rule matched.
    console.warn(`[AlertEngine] Exemption rule match failed for tenant ${tenant.id}, policy ${policy.id}: ${e.message}`);
    matchedRule = null;
  }

  // Create new alert. Branch on matchedRule: auto-resolved alerts are
  // inserted with status='resolved' + resolution_reason + resolution_rule_id
  // so the dashboard can filter them in/out and the audit trail links
  // back to the rule that resolved them.
  let id;
  if (matchedRule) {
    id = await db.insert(
      `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key,
                           recurrence_count, last_seen_at, triggered_at,
                           status, resolution_reason, resolution_rule_id, closed_at,
                           notes)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW(),
               'resolved', 'exemption_rule', ?, NOW(),
               ?)`,
      [
        tenant.id,
        policy.id,
        effectiveSeverity,
        alertData.message,
        JSON.stringify(alertData.raw_data),
        dedupKey,
        matchedRule.id,
        `Auto-resolved by alert exemption rule #${matchedRule.id}: ${matchedRule.reason || '(no reason recorded)'}`,
      ]
    );
    // Bump rule telemetry — fire-and-forget
    alertExemptionMatcher.recordRuleMatch(matchedRule.id).catch(() => {});
    console.log(`[AlertEngine] Alert ${id} auto-resolved by exemption rule ${matchedRule.id} (tenant=${tenant.display_name}, policy="${policy.name}")`);
  } else {
    id = await db.insert(
      `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key, recurrence_count, last_seen_at, triggered_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        tenant.id,
        policy.id,
        effectiveSeverity,
        alertData.message,
        JSON.stringify(alertData.raw_data),
        dedupKey,
      ]
    );
  }

  return {
    id,
    isNew: true,
    // Apr 30, 2026 — short-circuit downstream pipeline for auto-resolved
    // alerts (skip AI analysis + email + severity adjustment).
    isAutoResolved: !!matchedRule,
    autoResolvedRuleId: matchedRule ? matchedRule.id : null,
    tenant_id: tenant.id,
    policy_id: policy.id,
    policy_name: policy.name,
    severity: effectiveSeverity,
    category: policy.category,
    message: alertData.message,
    raw_data: alertData.raw_data,
    notification_target: policy.notification_target,
    notification_limit: policy.notification_limit,
  };
}

/**
 * Run the post-creation pipeline on a fresh alert: Haiku AI analysis,
 * email/Teams notification, and AI-driven severity adjustment. Mirrors
 * the inline loop in evaluateTenant() but extracted so imperative
 * alert producers (UAL evaluators / Bundle F / SECURITY_DRIFT) can run
 * the same pipeline instead of silently inserting a row.
 *
 * Wired May 12, 2026 after Bundle F's first real-world alert surfaced
 * with no AI analysis and no email — every UAL alert was hitting this
 * gap silently. Auto-resolved alerts skip the pipeline as before.
 *
 * @param {object} alert    Alert object returned by createOrUpdateAlert (has id, severity, etc.)
 * @param {object} tenant   Tenant row from DB
 * @returns {Promise<void>}
 */
async function processNewAlert(alert, tenant) {
  if (!alert || !alert.id) return;
  if (alert.isAutoResolved) {
    console.log(`[AlertEngine] Skipping AI/notify for auto-resolved alert ${alert.id}`);
    return;
  }

  // Defensive tenant enrichment — the notifier's buildAttribution() reads
  // tenant.psa_name to emit the //<PSA_NAME>// tag that routes Autotask
  // tickets to the right customer company. Callers in ual-worker and
  // polling.js have been corrected to SELECT psa_name, but a future
  // imperative caller could still pass an incomplete tenant row and
  // silently misroute every ticket through the MSP's catch-all company.
  // Reload the missing columns from the DB rather than trust the caller.
  // Added May 13, 2026 after Bundle F's first real alert opened a Trilogiam
  // ticket for a Dienamex incident — backfill script and ual-worker both
  // had the same psa_name omission.
  if (tenant && tenant.id && (tenant.psa_name === undefined || tenant.language === undefined)) {
    try {
      const enriched = await db.queryOne(
        `SELECT id, tenant_id, display_name, psa_name, language, mode
           FROM tenants WHERE id = ? LIMIT 1`,
        [tenant.id]
      );
      if (enriched) {
        // Merge — preserve any caller-provided fields, fill in the rest.
        for (const k of Object.keys(enriched)) {
          if (tenant[k] === undefined) tenant[k] = enriched[k];
        }
      }
    } catch (err) {
      console.warn(`[AlertEngine] tenant enrichment failed for alert ${alert.id} tenant ${tenant.id}: ${err.message}`);
    }
  }

  const ruleSeverity = alert.severity;
  let aiResult = null;

  try {
    aiResult = await aiAnalysis.analyzeAlert(alert, tenant);
    if (aiResult && aiResult.ai_analysis_en) {
      await db.execute(
        `UPDATE alerts
            SET ai_analysis_en = ?,
                ai_analysis_fr = ?,
                ai_analysis_es = ?,
                rule_severity = ?
          WHERE id = ?`,
        [
          aiResult.ai_analysis_en,
          aiResult.ai_analysis_fr || null,
          aiResult.ai_analysis_es || null,
          ruleSeverity,
          alert.id,
        ]
      );
      alert.ai_analysis = aiResult.ai_analysis_en;
      alert.ai_analysis_en = aiResult.ai_analysis_en;
      alert.ai_analysis_fr = aiResult.ai_analysis_fr || null;
      alert.ai_analysis_es = aiResult.ai_analysis_es || null;
    }
  } catch (e) {
    console.error(`[AlertEngine] AI analysis failed for alert ${alert.id}:`, e.message);
  }

  try {
    await notifier.sendAlertNotification(alert, tenant);
  } catch (e) {
    console.error(`[AlertEngine] Notification failed for alert ${alert.id}:`, e.message);
  }

  try {
    if (aiResult && aiResult.proposedSeverity && config.ai?.canAdjustSeverity !== false) {
      const proposed = aiResult.proposedSeverity;
      const reason = aiResult.proposedReason || 'AI adjustment (no reason given)';
      const rank = { info: 1, low: 2, medium: 3, high: 4, severe: 5 };
      const ruleRank = rank[ruleSeverity] || 0;
      const proposedRank = rank[proposed] || 0;

      if (proposedRank > 0 && proposedRank < ruleRank) {
        await db.execute(
          'UPDATE alerts SET severity = ?, ai_severity_reason = ? WHERE id = ?',
          [proposed, reason, alert.id]
        );
        alert.severity = proposed;
        alert.ai_severity_reason = reason;
        console.log(`[AlertEngine] Alert ${alert.id} severity adjusted by AI: ${ruleSeverity} → ${proposed} (${reason})`);
      } else if (proposedRank > ruleRank) {
        const upgradeNote = `AI proposed upgrade to ${proposed} (not applied): ${reason}`;
        await db.execute(
          'UPDATE alerts SET ai_severity_reason = ? WHERE id = ?',
          [upgradeNote, alert.id]
        );
        alert.ai_severity_reason = upgradeNote;
        console.log(`[AlertEngine] Alert ${alert.id} AI proposed upgrade ${ruleSeverity} → ${proposed} (not applied)`);
      }
    }
  } catch (e) {
    console.error(`[AlertEngine] Severity adjustment failed for alert ${alert.id}:`, e.message);
  }
}

/**
 * Apr 27, 2026 — Resolve all open alerts matching a dedup key.
 * Used by the security-settings drift code path: when the operator clicks
 * Accept Drift / Remediate (api-security.js) OR when a poll observes drift
 * has cleared without operator action (poll.js), the open SECURITY_DRIFT
 * alerts for that (tenant, setting) pair should auto-resolve. Same pattern
 * generalizes to any future imperatively-fired alert type.
 *
 * @param {number} tenantId   — internal tenants.id
 * @param {string} dedupKey   — same key used at createOrUpdateAlert time
 * @param {string} reason     — short note appended to alerts.notes for audit
 * @returns {Promise<number>} — count of alerts resolved
 */
async function resolveOpenAlerts(tenantId, dedupKey, reason = 'Auto-resolved') {
  if (!tenantId || !dedupKey) return 0;
  // Append the reason to notes (preserving any existing operator note) so
  // the audit trail captures what actually happened. Quoted as plain text;
  // alerts.notes is Quill HTML in operator-edited cases but appending plain
  // text on top is safe — Quill renders text nodes verbatim.
  const stamp = new Date().toISOString();
  const noteSuffix = `\n[${stamp}] ${reason}`;
  // db.execute() returns affectedRows directly (see src/db/database.js).
  const affectedRows = await db.execute(
    `UPDATE alerts
        SET status = 'resolved',
            closed_at = NOW(),
            notes = CONCAT(COALESCE(notes, ''), ?)
      WHERE tenant_id = ?
        AND dedup_key = ?
        AND status IN ('new', 'investigating')`,
    [noteSuffix, tenantId, dedupKey]
  );
  if (affectedRows > 0) {
    console.log(`[AlertEngine] Auto-resolved ${affectedRows} open alert(s) for dedup_key=${dedupKey} — ${reason}`);
  }
  return affectedRows || 0;
}

// ═══════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════

module.exports = {
  ensureAlertColumns,
  evaluateTenant,
  purgeOldEventDetails,
  // Apr 27, 2026 — exposed for imperative alert wiring (SECURITY_DRIFT from
  // security-settings/poll.js + api-security.js). Same dedup/lifecycle as the
  // existing scheduled evaluator path.
  createOrUpdateAlert,
  // May 12, 2026 — extracted from evaluateTenant's inline loop so UAL
  // evaluators (Bundle A–F) can run the same AI / email / sev-adjust
  // pipeline after createOrUpdateAlert. Previously every UAL alert went
  // silent (no Haiku, no email) — that's how Bundle F's first real-world
  // alert surfaced unanalyzed.
  processNewAlert,
  resolveOpenAlerts,
  // May 5, 2026 — exposed for UAL evaluators (src/ual-evaluators.js). The
  // helper reads the tenant's CA policies and returns the set of country
  // codes treated as "normal" for sign-in / file-access alerts. Reused as-is
  // so UAL geo evaluators stay consistent with sign-in geo evaluators.
  deriveAllowedCountriesFromCa,
};
