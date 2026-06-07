/**
 * Panoptica365 — Tenant Snapshot Aggregator
 *
 * Collects every piece of tenant data we currently store into a structured
 * bundle. Used by the Data Export endpoint to ship a ZIP that an MSP can
 * feed into their own analysis workflow (their own LLM, vulnerability
 * assessment app, etc.).
 *
 * Pure data gathering — no Express, no streaming, no zip. Returns:
 *   { manifest, files }
 * where files is { 'path/in/zip.json': <plain-object>, ... } and manifest
 * describes what was collected.
 *
 * Works for BOTH managed and audit-only tenants. For audit-only tenants
 * many of the activity-based files will be empty (no alerts generated,
 * no msp_audit events written) — that's expected.
 */

const db = require('../db/database');
// Lazy-required inside collectTenant to avoid any circular-require risk
// (routes can pull in lib modules; we want lib → routes only at call time).
let _caRoutes = null;
let _intuneRoutes = null;
function getCaRoutes() {
  if (!_caRoutes) _caRoutes = require('../routes/api-ca');
  return _caRoutes;
}
function getIntuneRoutes() {
  if (!_intuneRoutes) _intuneRoutes = require('../routes/api-intune');
  return _intuneRoutes;
}

/** Safe JSON parse — strings come back as primitives from MySQL JSON columns
 *  in some cases (per project memory: mysql2 auto-parses JSON columns), so
 *  this no-ops on non-strings and falls back to the raw value on parse error. */
function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

/** Build a filesystem-safe basename for a per-policy file:
 *    "{paddedAssignmentId}_{sanitisedName}"
 *  e.g. (id=42, name="Block Legacy Auth (Strict)") → "042_Block_Legacy_Auth_Strict"
 *  ID prefix gives stable sort + collision avoidance when two templates share
 *  a name (rare, but possible after a rename / re-import).                  */
function policyFilename(id, name) {
  const safeName = String(name || 'unnamed')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unnamed';
  const idPart = String(id || 0).padStart(3, '0');
  return `${idPart}_${safeName}`;
}

async function collectTenant(tenantId) {
  const id = parseInt(tenantId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`collectTenant: invalid tenantId "${tenantId}"`);
  }
  const t0 = Date.now();
  const log = (step, extra = '') => {
    console.log(`[Snapshot] tenant=${id} ${step} (+${Date.now() - t0}ms)${extra ? ' ' + extra : ''}`);
  };
  log('start');

  // ─── Tenant identity ───────────────────────────────────────────────────
  const tenant = await db.queryOne(
    `SELECT id, tenant_id, display_name, psa_name, language, mode,
            audit_expires_at, polling_interval, enabled, consented_at,
            last_polled_at, created_at
     FROM tenants WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!tenant) throw new Error('Tenant not found');
  log('tenant identity loaded');

  // ─── All metric snapshots (latest of each metric_name) ────────────────
  // metric_snapshots is the catch-all bucket for poll-time security data:
  // secure_score, MFA stats, user counts, CA policy snapshot, mail forwarding,
  // device compliance, OS distribution, inactive users, risky users, etc.
  // Use the GROUP BY + JOIN pattern (much faster than a correlated subquery
  // when metric_snapshots has thousands of rows for the tenant). Catch-wrap
  // so a slow / failed metric query doesn't kill the entire export.
  const latestMetrics = await db.queryRows(
    `SELECT ms.service, ms.metric_name, ms.metric_value, ms.captured_at
     FROM metric_snapshots ms
     INNER JOIN (
       SELECT metric_name, MAX(captured_at) AS max_at
       FROM metric_snapshots
       WHERE tenant_id = ?
       GROUP BY metric_name
     ) latest
       ON ms.metric_name = latest.metric_name
      AND ms.captured_at = latest.max_at
     WHERE ms.tenant_id = ?`,
    [id, id]
  ).catch(err => { console.warn('[Snapshot] metric_snapshots query failed:', err.message); return []; });
  log(`metric_snapshots loaded`, `(${latestMetrics.length} rows)`);

  const metricsByName = {};
  const metricsByService = {};
  for (const m of latestMetrics) {
    const parsed = safeJsonParse(m.metric_value);
    metricsByName[m.metric_name] = {
      service: m.service,
      captured_at: m.captured_at,
      value: parsed,
    };
    if (!metricsByService[m.service]) metricsByService[m.service] = {};
    metricsByService[m.service][m.metric_name] = {
      captured_at: m.captured_at,
      value: parsed,
    };
  }

  // Helper: timed query with catch-fallback. Logs the per-query duration so
  // we can spot slow tables in the server log when an export feels sluggish.
  async function timedQuery(label, sql, params = []) {
    const tStart = Date.now();
    try {
      const rows = await db.queryRows(sql, params);
      log(label, `OK ${rows.length} rows in ${Date.now() - tStart}ms`);
      return rows;
    } catch (e) {
      log(label, `FAILED in ${Date.now() - tStart}ms: ${e.message}`);
      return [];
    }
  }

  // ─── Conditional Access — assigned templates + drift history ──────────
  // ca_assignments: per-tenant assignment rows, joined to the template defs.
  // SELECT a.* gets every assignment column without me guessing them.
  const caAssignments = await timedQuery('ca_assignments',
    `SELECT a.*, t.name AS template_name, t.description AS template_description,
            t.policy_json AS template_policy_json, t.state AS template_state,
            t.grant_controls AS template_grant_controls,
            t.target_users AS template_target_users,
            t.target_apps AS template_target_apps,
            t.conditions_summary AS template_conditions_summary,
            t.monitored_fields AS template_monitored_fields,
            t.control_dimensions AS template_control_dimensions
     FROM ca_assignments a
     LEFT JOIN ca_templates t ON t.id = a.template_id
     WHERE a.tenant_id = ?
     ORDER BY a.id DESC`,
    [id]);

  // ca_exemptions: linked via assignment_id → ca_assignments.tenant_id
  // (no direct tenant_id column on ca_exemptions).
  const caExemptions = await timedQuery('ca_exemptions',
    `SELECT e.*, a.template_id, t.name AS template_name
     FROM ca_exemptions e
     JOIN ca_assignments a ON a.id = e.assignment_id
     LEFT JOIN ca_templates t ON t.id = a.template_id
     WHERE a.tenant_id = ?
     ORDER BY e.id DESC`,
    [id]);

  // ca_drift_log: also linked via assignment_id, no direct tenant_id.
  const caDriftRecent = await timedQuery('ca_drift_log',
    `SELECT dl.*, a.template_id, t.name AS template_name
     FROM ca_drift_log dl
     JOIN ca_assignments a ON a.id = dl.assignment_id
     LEFT JOIN ca_templates t ON t.id = a.template_id
     WHERE a.tenant_id = ?
     ORDER BY dl.id DESC LIMIT 500`,
    [id]);

  // ─── Intune — deployed templates ──────────────────────────────────────
  // Renamed alias from `id` (collided with the column `id`) to `d`.
  const intuneDeployments = await timedQuery('intune_deployments',
    `SELECT d.*, t.name AS template_name, t.description AS template_description,
            t.category AS template_category, t.policy_type AS template_policy_type,
            t.platform AS template_platform, t.template_family,
            t.policy_json AS template_policy_json, t.assignment_target AS template_assignment_target
     FROM intune_deployments d
     LEFT JOIN intune_templates t ON t.id = d.template_id
     WHERE d.tenant_id = ?
     ORDER BY d.id DESC`,
    [id]);

  // ─── Security settings — per-tenant state lives in tenant_security_config ─
  // The catalog (security_settings) is global; per-tenant state joins onto it.
  const securitySettings = await timedQuery('tenant_security_config + security_settings',
    `SELECT s.setting_id, s.category, s.priority, s.title, s.description,
            s.recommended_value,
            c.status, c.applied_value, c.current_value,
            c.applied_at, c.applied_by, c.last_checked_at, c.last_check_error
     FROM security_settings s
     LEFT JOIN tenant_security_config c
       ON c.setting_id = s.setting_id AND c.tenant_id = ?
     ORDER BY FIELD(s.priority,'critical','high','medium','low'), s.category, s.setting_id`,
    [id]);

  const securitySettingEvents = await timedQuery('security_setting_events',
    `SELECT setting_id, event_type, previous_value, new_value, source,
            operator_email, created_at
     FROM security_setting_events
     WHERE tenant_id = ? AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
     ORDER BY created_at DESC LIMIT 500`,
    [id]);

  // ─── SharePoint audit results ─────────────────────────────────────────
  const sharepointAudits = await timedQuery('sp_audits',
    `SELECT * FROM sp_audits WHERE tenant_id = ? ORDER BY id DESC LIMIT 50`,
    [id]);

  // ─── Alerts (last 90 days) ────────────────────────────────────────────
  const alerts = await timedQuery('alerts',
    `SELECT a.id, a.severity, a.message, a.status, a.triggered_at, a.closed_at,
            a.recurrence_count, a.last_seen_at, a.ai_analysis_en AS ai_analysis, a.dedup_key,
            p.name AS policy_name, p.category
     FROM alerts a
     JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
       AND a.is_rollup = 0
     ORDER BY a.triggered_at DESC`,
    [id]);

  // ─── Operator audit log (MSP actions on this tenant) ──────────────────
  // msp_audit_events has NO tenant_id column. Tenant linkage is via
  // (target_type='tenant', target_id=<tenant_id>). This was a guess in v1.
  const mspAudit = await timedQuery('msp_audit_events',
    `SELECT id, category, action, actor_email, actor_oid, actor_role,
            actor_ip, actor_user_agent, actor_session_id,
            target_type, target_id, target_name,
            description, metadata, success, error_message, created_at
     FROM msp_audit_events
     WHERE target_type = 'tenant' AND target_id = ?
       AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 180 DAY)
     ORDER BY created_at DESC`,
    [String(id)]);

  // ─── Tenant change journal ────────────────────────────────────────────
  // Real columns: started_at (not event_date), affected_surface (not surfaces).
  // SELECT * to grab everything without column-name guessing.
  const tenantChangeEvents = await timedQuery('tenant_change_events',
    `SELECT * FROM tenant_change_events
     WHERE tenant_id = ? AND deleted_at IS NULL
     ORDER BY started_at DESC, id DESC LIMIT 1000`,
    [id]);

  // ─── API health pings (last 30 days) ──────────────────────────────────
  const apiHealth = await timedQuery('api_health',
    `SELECT * FROM api_health
     WHERE tenant_id = ?
     ORDER BY id DESC LIMIT 1000`,
    [id]);

  // ─── LIVE Graph extraction — CA + Intune policies + named locations ────
  // Apr 29, 2026 — closes the audit-only gap where ca_assignments and
  // intune_deployments are empty by design (audit-only tenants get no
  // template pushes), so the bundle's CA + Intune sections were empty
  // for the first paying audit. We now ALWAYS pull the live policies
  // straight from Graph so the audit consumer gets actual current state.
  // For managed tenants this runs alongside the assignment-table data —
  // two views: what Panoptica tracks vs what's live in the tenant.
  // Errors are collected (not thrown) so a Graph hiccup on Intune doesn't
  // kill the CA section or vice versa.
  const liveTimerStart = Date.now();
  let caLive = { policies: [], errors: [] };
  let namedLocLive = { locations: [], errors: [] };
  let intuneLive = { policiesByType: {}, errors: [] };
  try {
    const caRoutes = getCaRoutes();
    caLive = await caRoutes.exportCaPoliciesLive(tenant);
    log('live CA policies', `OK ${caLive.policies.length} policies in ${Date.now() - liveTimerStart}ms`);
  } catch (e) {
    log('live CA policies', `FAILED: ${e.message}`);
    caLive.errors.push(e.message);
  }
  const namedLocStart = Date.now();
  try {
    const caRoutes = getCaRoutes();
    namedLocLive = await caRoutes.exportNamedLocationsLive(tenant);
    log('live named locations', `OK ${namedLocLive.locations.length} locations in ${Date.now() - namedLocStart}ms`);
  } catch (e) {
    log('live named locations', `FAILED: ${e.message}`);
    namedLocLive.errors.push(e.message);
  }
  const intuneStart = Date.now();
  try {
    const intuneRoutes = getIntuneRoutes();
    intuneLive = await intuneRoutes.exportIntunePoliciesLive(tenant);
    const totalIntune = Object.values(intuneLive.policiesByType).reduce((s, arr) => s + arr.length, 0);
    log('live Intune policies', `OK ${totalIntune} policies across ${Object.keys(intuneLive.policiesByType).length} types in ${Date.now() - intuneStart}ms`);
  } catch (e) {
    log('live Intune policies', `FAILED: ${e.message}`);
    intuneLive.errors.push(e.message);
  }

  log('all queries done — building manifest + files');

  // ─── Build the file map ───────────────────────────────────────────────
  const generatedAt = new Date().toISOString();

  const files = {
    'tenant.json': {
      id: tenant.id,
      azure_tenant_id: tenant.tenant_id,
      display_name: tenant.display_name,
      psa_name: tenant.psa_name,
      language: tenant.language,
      mode: tenant.mode,
      audit_expires_at: tenant.audit_expires_at,
      polling_interval_min: tenant.polling_interval,
      enabled: !!tenant.enabled,
      consented_at: tenant.consented_at,
      last_polled_at: tenant.last_polled_at,
      created_at: tenant.created_at,
    },


    'secure-score.json': metricsByName.secure_score
      ? { captured_at: metricsByName.secure_score.captured_at, value: metricsByName.secure_score.value }
      : { note: 'No secure score snapshot found.' },

    'metrics-by-service.json': metricsByService,
    'metrics-by-name.json':    metricsByName,

    // CA: per-policy files in conditional-access/policies/ + a flat index
    // for quick overview. Matches the existing CA template export convention.
    'conditional-access/index.json': caAssignments.map(r => ({
      assignment_id: r.id,
      template_id: r.template_id,
      template_name: r.template_name,
      enforcement: r.enforcement,
      template_state: r.template_state,
      file: `conditional-access/policies/${policyFilename(r.id, r.template_name)}.json`,
    })),
    'conditional-access/exemptions.json': caExemptions,
    'conditional-access/drift-history-90d.json': caDriftRecent,

    // Intune: per-policy files + index, same pattern as CA.
    'intune/index.json': intuneDeployments.map(r => ({
      deployment_id: r.id,
      template_id: r.template_id,
      template_name: r.template_name,
      template_policy_type: r.template_policy_type,
      template_platform: r.template_platform,
      status: r.status,
      assignment_target: r.assignment_target,
      drift_status: r.drift_status,
      file: `intune/policies/${policyFilename(r.id, r.template_name)}.json`,
    })),

    // Security settings catalog joined to per-tenant state. Catalog rows with
    // null status mean Panoptica defines the setting but this tenant has no
    // observation yet (never polled, or applies-to-other-platform).
    'security-settings/state.json': securitySettings.map(r => ({
      setting_id: r.setting_id,
      category: r.category,
      priority: r.priority,
      title: r.title,
      description: r.description,
      recommended_value: safeJsonParse(r.recommended_value),
      tenant_status: r.status,
      tenant_applied_value: safeJsonParse(r.applied_value),
      tenant_current_value: safeJsonParse(r.current_value),
      applied_at: r.applied_at,
      applied_by: r.applied_by,
      last_checked_at: r.last_checked_at,
      last_check_error: r.last_check_error,
    })),
    'security-settings/event-history-90d.json': securitySettingEvents.map(r => ({
      setting_id: r.setting_id,
      event_type: r.event_type,
      previous_value: safeJsonParse(r.previous_value),
      new_value: safeJsonParse(r.new_value),
      source: r.source,
      operator_email: r.operator_email,
      created_at: r.created_at,
    })),

    'sharepoint/audits.json': sharepointAudits,

    'alerts/last-90d.json': alerts,

    'msp-audit-log/last-180d.json': mspAudit.map(r => ({
      ...r,
      metadata: safeJsonParse(r.metadata),
    })),

    'tenant-change-events/last-1000.json': tenantChangeEvents.map(r => ({
      ...r,
      affected_surface: safeJsonParse(r.affected_surface),
    })),

    'diagnostics/api-health-30d.json': apiHealth,
  };

  // ─── Per-policy CA + Intune files ─────────────────────────────────────
  // Each assignment / deployment becomes its own JSON in conditional-access/
  // policies/ or intune/policies/, with the parsed template payload embedded
  // (no separate raw _json string fields — those are serialized inside the
  // parsed object). This matches the existing per-template export convention
  // and lets an LLM (or you) target individual policies.
  for (const a of caAssignments) {
    const fname = `conditional-access/policies/${policyFilename(a.id, a.template_name)}.json`;
    files[fname] = {
      assignment_id: a.id,
      tenant_id: a.tenant_id,
      template_id: a.template_id,
      template_name: a.template_name,
      template_description: a.template_description,
      template_state: a.template_state,
      template_grant_controls: a.template_grant_controls,
      template_target_users: a.template_target_users,
      template_target_apps: a.template_target_apps,
      template_conditions_summary: a.template_conditions_summary,
      template_monitored_fields: safeJsonParse(a.template_monitored_fields),
      template_control_dimensions: safeJsonParse(a.template_control_dimensions),
      enforcement: a.enforcement,
      template_policy: safeJsonParse(a.template_policy_json),
    };
  }
  for (const d of intuneDeployments) {
    const fname = `intune/policies/${policyFilename(d.id, d.template_name)}.json`;
    files[fname] = {
      deployment_id: d.id,
      tenant_id: d.tenant_id,
      template_id: d.template_id,
      template_name: d.template_name,
      template_description: d.template_description,
      template_category: d.template_category,
      template_policy_type: d.template_policy_type,
      template_platform: d.template_platform,
      template_family: d.template_family,
      assignment_target: d.assignment_target,
      drift_status: d.drift_status,
      status: d.status,
      template_policy: safeJsonParse(d.template_policy_json),
    };
  }

  // ─── LIVE Graph extraction — per-policy files ─────────────────────────
  // For audit-only tenants this is the ONLY source of CA + Intune policy
  // data (assignment tables are empty). For managed tenants this runs
  // alongside the assignment data above — two views, both useful.
  // Folder layout:
  //   conditional-access/live/policies/{id}_{name}.json   — one per CA policy
  //   conditional-access/live/named-locations.json        — flat list (small)
  //   conditional-access/live/index.json                  — sortable summary
  //   intune/live/{policyType}/{id}_{name}.json           — one per Intune policy
  //   intune/live/index.json                              — sortable summary
  //
  // The `id` portion of the filename is a 0-padded counter (1..N within
  // the type) NOT the Graph GUID — keeps filenames sortable and short.
  // The full Graph id is preserved in the file body (`graphId` field for
  // Intune; `id` field for CA — Graph natively returns it).
  const caLiveIndex = caLive.policies.map((p, i) => {
    const counter = String(i + 1).padStart(3, '0');
    const fname = `conditional-access/live/policies/${counter}_${policyFilename(0, p.displayName).replace(/^\d+_/, '')}.json`;
    files[fname] = p;  // raw Graph object — unmodified
    return {
      policy_id: p.id,
      display_name: p.displayName,
      state: p.state,
      file: fname,
    };
  });
  if (caLive.policies.length > 0 || namedLocLive.locations.length > 0) {
    files['conditional-access/live/index.json'] = {
      generated_at: generatedAt,
      total_policies: caLive.policies.length,
      total_named_locations: namedLocLive.locations.length,
      policies: caLiveIndex,
      errors: [...caLive.errors, ...namedLocLive.errors],
    };
  }
  if (namedLocLive.locations.length > 0) {
    files['conditional-access/live/named-locations.json'] = namedLocLive.locations;
  }

  const intuneLiveIndex = [];
  for (const [policyType, items] of Object.entries(intuneLive.policiesByType)) {
    items.forEach((item, i) => {
      const counter = String(i + 1).padStart(3, '0');
      const baseName = policyFilename(0, item.name).replace(/^\d+_/, '');
      const fname = `intune/live/${policyType}/${counter}_${baseName}.json`;
      files[fname] = item;
      intuneLiveIndex.push({
        policy_type: policyType,
        policy_name: item.name,
        graph_id: item.graphId,
        category: item.category,
        template_family: item.templateFamily,
        file: fname,
      });
    });
  }
  if (intuneLiveIndex.length > 0 || intuneLive.errors.length > 0) {
    files['intune/live/index.json'] = {
      generated_at: generatedAt,
      total_policies: intuneLiveIndex.length,
      by_type: Object.fromEntries(
        Object.entries(intuneLive.policiesByType).map(([k, v]) => [k, v.length])
      ),
      policies: intuneLiveIndex,
      errors: intuneLive.errors,
    };
  }

  // ─── Manifest ─────────────────────────────────────────────────────────
  const manifest = {
    schema_version: 1,
    generator: 'Panoptica365 Tenant Snapshot Aggregator',
    generated_at: generatedAt,
    tenant: {
      id: tenant.id,
      azure_tenant_id: tenant.tenant_id,
      display_name: tenant.display_name,
      mode: tenant.mode,
    },
    files: Object.keys(files).sort().map(name => ({
      path: name,
      kind: name.endsWith('.json') ? 'json' : 'unknown',
    })),
    counts: {
      ca_assignments: caAssignments.length,
      ca_exemptions: caExemptions.length,
      ca_drift_log: caDriftRecent.length,
      ca_live_policies: caLive.policies.length,
      ca_live_named_locations: namedLocLive.locations.length,
      intune_deployments: intuneDeployments.length,
      intune_live_policies: Object.values(intuneLive.policiesByType).reduce((s, arr) => s + arr.length, 0),
      intune_live_by_type: Object.fromEntries(
        Object.entries(intuneLive.policiesByType).map(([k, v]) => [k, v.length])
      ),
      security_settings: securitySettings.length,
      security_setting_events: securitySettingEvents.length,
      sharepoint_audits: sharepointAudits.length,
      alerts_90d: alerts.length,
      msp_audit_180d: mspAudit.length,
      tenant_change_events: tenantChangeEvents.length,
      metric_snapshots: latestMetrics.length,
    },
    live_extraction_errors: {
      ca: caLive.errors,
      named_locations: namedLocLive.errors,
      intune: intuneLive.errors,
    },
    notes: [
      tenant.mode === 'audit_only'
        ? 'Audit-only tenant. Activity-based files (alerts, msp-audit-log, tenant-change-events) will be empty or near-empty by design. Live policy data is in conditional-access/live/ and intune/live/.'
        : 'Managed tenant. Activity-based files reflect Panoptica observation history. The conditional-access/policies/ and intune/policies/ folders show what Panoptica has DEPLOYED via templates; the conditional-access/live/ and intune/live/ folders show what is ACTUALLY in the tenant right now via live Graph reads.',
      'Time-bounded files note their window in the filename (e.g., last-90d, last-180d).',
      'security-settings/state.json reflects the latest captured state per setting key.',
      'metric_snapshots are deduped to the latest captured_at per metric_name.',
      'Live policy files in conditional-access/live/policies/ and intune/live/{type}/ are the raw Graph response objects for each policy — feed them into your analysis tooling as-is.',
    ],
  };

  return { manifest, files };
}

/** README rendered into the bundle. Plain markdown — opens nicely in any
 *  editor, GitHub, or LLM context. Includes 5 ready-to-copy LLM prompts so
 *  the MSP doesn't have to invent the analysis workflow from scratch. */
function buildReadme(manifest) {
  const t = manifest.tenant;
  const lines = [
    `# Panoptica365 Tenant Snapshot — ${t.display_name}`,
    ``,
    `**Tenant**: ${t.display_name}`,
    `**Azure Tenant ID**: \`${t.azure_tenant_id}\``,
    `**Mode**: ${t.mode}`,
    `**Generated**: ${manifest.generated_at}`,
    `**Bundle schema version**: ${manifest.schema_version}`,
    ``,
    `## What's in this bundle`,
    ``,
    `Each \`.json\` file is a structured snapshot of a single area of the tenant\'s`,
    `Microsoft 365 + Defender + Intune configuration as observed by Panoptica365.`,
    `\`manifest.json\` describes every file and the row counts that produced it.`,
    ``,
  ];
  for (const f of manifest.files) {
    lines.push(`- \`${f.path}\``);
  }
  lines.push(``);
  lines.push(`## Counts`);
  lines.push(``);
  for (const [k, v] of Object.entries(manifest.counts)) {
    lines.push(`- ${k}: **${v}**`);
  }
  lines.push(``);
  lines.push(`## Suggested LLM prompts`);
  lines.push(``);
  lines.push(`Drop this entire folder (or specific files) into your favorite LLM`);
  lines.push(`(Claude, ChatGPT, Gemini, etc.) and paste one of these prompts:`);
  lines.push(``);
  lines.push(`### 1. Top security gaps (executive)`);
  lines.push('```');
  lines.push(`Analyse the attached Panoptica365 tenant snapshot and identify the top 5`);
  lines.push(`security gaps in priority order. For each gap: severity, business risk,`);
  lines.push(`one-paragraph remediation. Tone: executive summary.`);
  lines.push('```');
  lines.push(``);
  lines.push(`### 2. CA policy review`);
  lines.push('```');
  lines.push(`Review conditional-access/assignments.json against zero-trust best practices`);
  lines.push(`for a small business on Microsoft 365 Business Premium. Identify gaps in:`);
  lines.push(`(a) MFA enforcement, (b) device compliance, (c) location controls, (d) legacy auth`);
  lines.push(`block, (e) admin protection. Cite specific policy IDs.`);
  lines.push('```');
  lines.push(``);
  lines.push(`### 3. Vulnerability assessment input`);
  lines.push('```');
  lines.push(`I am writing a vulnerability assessment for this tenant. Using the attached`);
  lines.push(`snapshot, generate three sections:`);
  lines.push(`  - Executive Summary (3 paragraphs)`);
  lines.push(`  - Technical Findings (table: finding, evidence file, severity, recommendation)`);
  lines.push(`  - Remediation Roadmap (3 horizons: immediate, 30d, 90d)`);
  lines.push(`Stay grounded in the snapshot — flag inferences as inferences.`);
  lines.push('```');
  lines.push(``);
  lines.push(`### 4. Compliance posture`);
  lines.push('```');
  lines.push(`Assess this tenant against the CIS Microsoft 365 Foundations Benchmark v3.1`);
  lines.push(`Level 1 controls. For each control: pass / fail / N/A, evidence from the`);
  lines.push(`snapshot, and remediation if failed.`);
  lines.push('```');
  lines.push(``);
  lines.push(`### 5. Quick wins`);
  lines.push('```');
  lines.push(`Identify the 10 highest-impact security improvements that can be made in`);
  lines.push(`under 1 hour each. Sort by impact-to-effort ratio. Cite the snapshot file`);
  lines.push(`that supports each recommendation.`);
  lines.push('```');
  lines.push(``);
  lines.push(`## Generated by`);
  lines.push(``);
  lines.push(`${manifest.generator}`);
  return lines.join('\n');
}

module.exports = { collectTenant, buildReadme };
