/**
 * Panoptica365 — Security Settings API (Phase A1)
 *
 * Endpoints (all require auth; tenant_id in the URL path):
 *
 *   GET  /api/security/tenants/:tid/settings
 *        List all settings + per-tenant state for the tenant's list view.
 *        Joins security_settings × tenant_security_config. Returns the shape
 *        the SPA list view expects; see buildListRow() for the row schema.
 *
 *   GET  /api/security/tenants/:tid/settings/:sid
 *        Full detail for one setting (Overview modal). Includes the text
 *        fields (description, security_impact, user_impact, admin_notes).
 *
 *   POST /api/security/tenants/:tid/refresh
 *        Manual per-tab refresh button. Runs pollTenantSecurity() for this
 *        tenant only; does NOT touch the global slow-poll queue. Intended
 *        for the ↻ icon on the Security tab (per D.6 in the design doc).
 *
 * Phase A1 is read-only. No Apply/Match/Remediate endpoints — they return
 * 501 (not implemented) with a "Phase B" message so the frontend fails
 * loudly rather than silently pretending an apply worked.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const { SETTINGS, byId } = require('../lib/security-settings/registry');
const { pollTenantSecurity } = require('../lib/security-settings/poll');
const graphReaders = require('../lib/security-settings/graph-readers');
const pwshReaders  = require('../lib/security-settings/pwsh-readers');
const writers      = require('../lib/security-settings/writers');  // strategy-aware Apply dispatcher
const { logMspAudit, CATEGORY } = require('../msp-audit');
const alertEngine  = require('../alert-engine');  // SECURITY_DRIFT auto-resolve on Accept/Remediate
const changeLog    = require('../change-log');    // Tenant Change Log integration
const applyJobs    = require('../lib/security-settings/apply-jobs');  // May 6, 2026 — async Apply queue

// Apr 27, 2026 — dedup-key shape for SECURITY_DRIFT alerts. Mirrors the
// constant in src/lib/security-settings/poll.js. Same key in both places —
// poll.js fires the alert; api-security.js resolves it on Accept/Remediate.
const securityDriftDedupKey = (settingId) => `security_drift:${settingId}`;

/**
 * Apr 27, 2026 — write a tenant change-log row for any security-setting
 * action (Apply, Match, Remediate, Accept). Wraps logPanopticaChange with
 * security-settings-specific defaults (category, surface, actor capture).
 *
 * Audit-trail rationale: even Match/Accept don't write to Microsoft, but
 * they change Panoptica's monitoring baseline. If a hostile actor changes
 * a policy and an operator carelessly Accepts, this row is the audit
 * record of who did what when.
 *
 * Wrapped in a try/catch at every call site — change-log failures must
 * never block the actual operation. The mutation has already succeeded by
 * the time we get here.
 */
async function logSecuritySettingChange(req, tenant, setting, verb, descriptionTail = '') {
  try {
    const operatorEmail = operatorEmailOf(req) || 'panoptica-system';
    const description = descriptionTail
      ? `${verb} ${setting.name} — ${descriptionTail}`
      : `${verb} ${setting.name}`;
    await changeLog.logPanopticaChange({
      tenantId: tenant.id,
      category: changeLog.CATEGORY.SECURITY_SETTING_CHANGE,
      surfaces: [changeLog.SURFACE.SECURITY_SETTING],
      description: description.slice(0, 500),
      templateKey: 'security_setting_change',
      templateParams: { verb, settingName: setting.name },
      // Apr 28, 2026: tag with the specific setting_id so drift attribution
      // can disambiguate. Without this, the surface 'security_setting' is
      // shared by ALL security setting changes — applying TEA-02 then having
      // ENT-05 drift fire 1 minute later would falsely attribute the ENT-05
      // alert to the TEA-02 change. The poll's attribution lookup filters
      // on this prefix.
      correlationTag: `security_setting:${setting.setting_id}`,
      createdBy: operatorEmail,
      ...changeLog.captureActorContext(req),
    });
  } catch (e) {
    console.error(`[api-security] logSecuritySettingChange failed (${verb} ${setting?.setting_id}):`, e.message);
  }
}

const router = express.Router();
router.use(auth.requireAuth);

/**
 * Shape each list-view row. Deliberately omits the setting_id string from
 * the visible payload — the ID is returned only under `_internal_id` so the
 * frontend can route modal opens without ever displaying it (per D.3 UX
 * decision: "never shown to the MSP operator").
 */
function buildListRow(row) {
  return {
    _internal_id: row.setting_id,
    name: row.name,
    category: row.category,
    priority: row.priority,
    licence_required: row.licence_required,
    poll_strategy: row.poll_strategy,
    // Per-tenant state (all nullable for settings never polled yet)
    status: row.status || 'not_polled',
    current_value_interpreted: extractInterpretedFromCurrent(row.current_value, row.setting_id),
    last_checked_at: row.last_checked_at,
    last_check_error: row.last_check_error,
  };
}

/**
 * Resolve the `current_value` JSON into an interpreted display payload.
 *
 * All 17 readers route through `setting.writer.interpret(currentValue)` which
 * returns `{template_key, params}`; the frontend translates via window.t()
 * at render time, falling back to en when a non-en locale is missing a key.
 *
 * Returns:
 *   - `{template_key, params}` when the writer interprets the value
 *   - `null` when the value is missing, malformed, or no writer.interpret()
 *     exists for the setting (UI renders an em-dash)
 *
 * History: this used to be a 230-line switch with 14 hardcoded English
 * branches that each setting type matched on. As of i18n Phase 6 (May 1,
 * 2026) every setting has writer.interpret(); the legacy switch was deleted
 * and this helper is now a thin router. See phase-6-pre snapshot for the
 * pre-cleanup state if you ever need to compare.
 */
function extractInterpretedFromCurrent(currentValueJson, settingId) {
  if (!currentValueJson || !settingId) return null;
  let v;
  try {
    v = typeof currentValueJson === 'string' ? JSON.parse(currentValueJson) : currentValueJson;
  } catch { return null; }
  if (!v || typeof v !== 'object') return null;

  try {
    const setting = byId(settingId);
    if (!setting || !setting.writer || typeof setting.writer.interpret !== 'function') return null;
    const struct = setting.writer.interpret(v);
    if (struct && typeof struct === 'object' && struct.template_key) return struct;
    return null;
  } catch (e) {
    console.warn(`[security] writer.interpret() threw for ${settingId}: ${e.message}`);
    return null;
  }
}

// ─── Validate tenant_id path param ─────────────────────────────
// Select tenant_id (Azure GUID) as well as the INT id — the poll path
// needs the GUID to talk to Graph, the INT for DB writes.
async function loadTenantOrBail(req, res) {
  const tid = parseInt(req.params.tid, 10);
  if (!Number.isInteger(tid) || tid <= 0) {
    res.status(400).json({ error: 'Invalid tenant id' });
    return null;
  }
  const t = await db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [tid]);
  if (!t) {
    res.status(404).json({ error: 'Tenant not found' });
    return null;
  }
  return t;
}

// ─── LIST: all settings × tenant state ─────────────────────────
router.get('/tenants/:tid/settings', async (req, res) => {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return;

  try {
    const rows = await db.queryRows(
      `SELECT s.setting_id, s.name, s.category, s.priority, s.licence_required, s.poll_strategy,
              c.status, c.current_value, c.last_checked_at, c.last_check_error
         FROM security_settings s
         LEFT JOIN tenant_security_config c
           ON c.tenant_id = ? AND c.setting_id = s.setting_id
        ORDER BY FIELD(s.priority, 'critical','high','medium','low'), s.category, s.setting_id`,
      [tenant.id]
    );

    // Summary bar counts (per D.3) — derived from the same rows.
    const summary = {
      critical_total: 0,
      critical_monitored: 0,
      critical_drift: 0,
      monitored_total: 0,
      not_applied_total: 0,
      poll_error_total: 0,
      unavailable_total: 0,
    };
    for (const r of rows) {
      const status = r.status || 'not_polled';
      if (r.priority === 'critical') summary.critical_total++;
      if (status === 'monitored') summary.monitored_total++;
      if (status === 'drift') { summary.critical_drift += r.priority === 'critical' ? 1 : 0; }
      if (status === 'not_applied' || status === 'not_polled') summary.not_applied_total++;
      if (status === 'poll_error') summary.poll_error_total++;
      if (status === 'unavailable') summary.unavailable_total++;
    }

    res.json({
      tenant: { id: tenant.id, display_name: tenant.display_name },
      summary,
      settings: rows.map(buildListRow),
    });
  } catch (e) {
    console.error('[api-security] list failed:', e.message);
    res.status(500).json({ error: 'list failed', detail: e.message });
  }
});

// ─── DETAIL: full content for Overview modal ───────────────────
router.get('/tenants/:tid/settings/:sid', async (req, res) => {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return;
  const sid = String(req.params.sid || '').toUpperCase();

  // Validate against the registry — blocks path-parameter mischief from
  // pulling arbitrary rows by crafting a setting_id that isn't in the
  // library. Defense in depth; the FK already prevents orphan rows but
  // a 404 here is faster and clearer.
  if (!byId(sid)) {
    return res.status(404).json({ error: `Unknown setting ${sid}` });
  }

  try {
    const row = await db.queryOne(
      `SELECT s.setting_id, s.name, s.category, s.priority, s.poll_strategy, s.licence_required,
              s.description, s.security_impact, s.user_impact, s.admin_notes,
              c.status, c.current_value, c.applied_value, c.last_checked_at, c.last_check_error,
              c.applied_at, c.applied_by
         FROM security_settings s
         LEFT JOIN tenant_security_config c
           ON c.tenant_id = ? AND c.setting_id = s.setting_id
        WHERE s.setting_id = ?`,
      [tenant.id, sid]
    );
    if (!row) return res.status(404).json({ error: 'Setting not found' });

    // Phase B: expose the WRITER metadata (sans functions) so the frontend
    // can render the Configure tab form. Strip buildPayload/matches — those
    // are server-side only and not JSON-serializable anyway.
    //
    // Apr 26 v3: include `input` metadata per option so the frontend knows
    // when to render a text area, plus the pre-populated current input value
    // (extracted via writer.extractInputFromCurrent).
    const regSetting = byId(row.setting_id);
    const currentForExtract = safeParse(row.current_value);
    const writerMeta = regSetting && regSetting.writer ? {
      strategy: regSetting.writer.strategy,
      ui: regSetting.writer.ui,
      recommended_label: regSetting.writer.recommended_label || null,
      options: Array.isArray(regSetting.writer.options)
        ? regSetting.writer.options.map(o => ({
            value: o.value,
            label: o.label,
            recommended: !!o.recommended,
            danger: !!o.danger,
            input: o.input ? {
              multiline: !!o.input.multiline,
              line_kind: o.input.line_kind || null,
              placeholder: o.input.placeholder || '',
              help: o.input.help || '',
              empty_ok: !!o.input.empty_ok,
              // May 3, 2026 — per-input length bounds for client-side
              // validation. Surfaces Microsoft API constraints (e.g., ENT-06
              // banned words must be 4-16 chars per Microsoft) before the
              // operator hits a Graph 400 on Apply.
              min_length: (typeof o.input.min_length === 'number') ? o.input.min_length : null,
              max_length: (typeof o.input.max_length === 'number') ? o.input.max_length : null,
            } : null,
          }))
        : null,
      // Pre-population value for text-input options (only sent when writer
      // exposes extractInputFromCurrent). Frontend uses this to fill the
      // text area when the modal opens.
      current_input: typeof regSetting.writer.extractInputFromCurrent === 'function'
        ? (regSetting.writer.extractInputFromCurrent(currentForExtract) || '')
        : null,
      // Apr 26 v4 — secondary_section metadata (e.g. ENT-01 additional
      // auth methods checklist) + the currently-enabled additionals to
      // pre-populate checkboxes on first open.
      secondary_section: regSetting.writer.secondary_section ? {
        toggle_label: regSetting.writer.secondary_section.toggle_label,
        help: regSetting.writer.secondary_section.help || '',
        options: regSetting.writer.secondary_section.options.map(o => ({ id: o.id, label: o.label })),
        current_additionals: regSetting.writer.secondary_section.extractCurrentAdditionals(currentForExtract) || [],
      } : null,
      // Apr 27 — audit-only writers (CMP-02 DLP) carry these fields instead
      // of options[]. Frontend renders a warning banner and shows Match only
      // (no Apply button). empty_state_note shown when current_value reports
      // zero policies/items.
      audit_only: regSetting.writer.audit_only === true,
      warning_banner: regSetting.writer.warning_banner || null,
      empty_state_note: regSetting.writer.empty_state_note || null,
    } : null;

    // Pre-compute "which option does current_value match" for the frontend.
    // Lets the UI pick the right primary CTA (Match vs Apply) without
    // re-implementing the matches() comparator client-side.
    let currentMatchesOption = null;
    const currentParsed = safeParse(row.current_value);
    if (regSetting && regSetting.writer && currentParsed) {
      for (const opt of regSetting.writer.options || []) {
        if (regSetting.writer.matches(opt.value, currentParsed)) {
          currentMatchesOption = opt.value;
          break;
        }
      }
    }

    res.json({
      tenant: { id: tenant.id, display_name: tenant.display_name },
      setting: {
        // _internal_id — available for the frontend but UX rule says not displayed
        _internal_id: row.setting_id,
        name: row.name,
        category: row.category,
        priority: row.priority,
        licence_required: row.licence_required,
        poll_strategy: row.poll_strategy,
        description: row.description,
        security_impact: row.security_impact,
        user_impact: row.user_impact,
        admin_notes: row.admin_notes,
        writer: writerMeta,
      },
      state: {
        status: row.status || 'not_polled',
        current_value: safeParse(row.current_value),
        current_value_interpreted: extractInterpretedFromCurrent(row.current_value, row.setting_id),
        applied_value: safeParse(row.applied_value),
        last_checked_at: row.last_checked_at,
        last_check_error: row.last_check_error,
        applied_at: row.applied_at,
        applied_by: row.applied_by,
        // Phase B: which writer option (if any) matches the current state.
        // Frontend uses this to pick Match vs Apply as the primary CTA.
        current_matches_option: currentMatchesOption,
      },
    });
  } catch (e) {
    console.error('[api-security] detail failed:', e.message);
    res.status(500).json({ error: 'detail failed', detail: e.message });
  }
});

// JSON-column read tolerance:
// mysql2 AUTO-PARSES JSON columns. So a JSON-stored object comes back as a
// JS object; a JSON-stored primitive (string/boolean/number) comes back as
// that primitive. The OLD implementation called JSON.parse on whatever it
// got — which throws on a primitive string like '2af84b1e-...' and lost the
// value entirely. That broke drift detection for ENT-09 and would break it
// for SPO-01 too (any string-valued applied_value).
//
// Rule: if mysql2 already gave us a non-string, return it. If it's a string,
// try to parse it; if that fails, treat it as a primitive string value.
function safeParse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

// ─── ASYNC REFRESH: kick off poll, return 202 ─────────────────
//
// A full pollTenantSecurity pass takes 60-100s on a tenant with many
// pwsh-backed settings (cold-connect overhead per cmdlet × 9 cmdlets).
// That exceeds Nginx's default proxy_read_timeout (60s) and produces a
// 504 even though the polling itself is healthy. Fix: kick off the poll
// in the background, return 202 immediately, expose a status endpoint
// the frontend can poll for completion.
//
// State is held in-memory per process. pm2 restart loses it, which is
// fine — the slow-tier polling cycle picks up the data anyway, and the
// frontend's status-poll loop times out gracefully.
const REFRESH_STATE = new Map();
// shape per entry: {
//   startedAt: ISO string,
//   completedAt: ISO string | null,
//   pollsRun, errors, unavailable: numbers (after completion),
//   error: string | null  (if the background job threw),
// }

// A3 (May 9, 2026): operator — manual security-settings refresh trigger.
router.post('/tenants/:tid/refresh', auth.requireMemberOrAdmin, async (req, res) => {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return;

  const existing = REFRESH_STATE.get(tenant.id);
  if (existing && !existing.completedAt) {
    // Already in flight — return current status so the client can attach
    // to the existing job rather than starting a duplicate.
    return res.status(409).json({
      ok: false,
      inFlight: true,
      startedAt: existing.startedAt,
      message: 'Refresh already in progress for this tenant',
    });
  }

  const startedAt = new Date().toISOString();
  REFRESH_STATE.set(tenant.id, { startedAt, completedAt: null });

  // Run the poll in the background. setImmediate yields to the event loop
  // so we can send the 202 first; the polling work happens after.
  setImmediate(async () => {
    try {
      const result = await pollTenantSecurity(tenant);
      REFRESH_STATE.set(tenant.id, {
        startedAt,
        completedAt: new Date().toISOString(),
        pollsRun: result.pollsRun,
        errors: result.errors,
        unavailable: result.unavailable,
        error: null,
      });
    } catch (e) {
      console.error('[api-security] async refresh failed:', e.message);
      REFRESH_STATE.set(tenant.id, {
        startedAt,
        completedAt: new Date().toISOString(),
        error: e.message,
      });
    }
  });

  res.status(202).json({
    ok: true,
    inFlight: true,
    startedAt,
    statusUrl: `/api/security/tenants/${tenant.id}/refresh-status`,
  });
});

// ─── REFRESH-STATUS: poll for completion ──────────────────────
router.get('/tenants/:tid/refresh-status', async (req, res) => {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return;

  const state = REFRESH_STATE.get(tenant.id);
  if (!state) {
    // No refresh has ever been kicked off for this tenant in this process
    // lifetime. Return a clean "no job" response — distinguishable from
    // "in flight" by the inFlight=false + hasRun=false combination.
    return res.json({ ok: true, inFlight: false, hasRun: false });
  }
  res.json({
    ok: true,
    inFlight: !state.completedAt,
    hasRun: true,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    pollsRun: state.pollsRun,
    errors: state.errors,
    unavailable: state.unavailable,
    error: state.error,
  });
});

// ════════════════════════════════════════════════════════════════
// Phase B v1 — Apply / Match / Remediate / Accept
// ════════════════════════════════════════════════════════════════
//
// Four operator verbs, all routed through writeBackend() which centralises
// the validation → write → verify → persist → audit chain. Per-verb routes
// are thin shells around it.
//
// State transitions handled here (drift detection itself lives in poll.js):
//   apply      : not_applied/monitored/drift/poll_error → pending → monitored (after verify) or stays pending
//   match      : not_applied/poll_error                 → monitored (no write)
//   remediate  : drift                                  → pending → monitored
//   accept     : drift                                  → monitored (no write; updates baseline)
//
// applied_value stores the OPERATOR'S CHOSEN UI VALUE (not the Graph payload).
// This is the single source of truth for drift comparison via writer.matches().
// Storing the payload would force every drift check to know payload→current
// translation per setting; storing the chosen value keeps it as one symmetric
// matches(chosen, current) check the registry already exposes.

/**
 * Single-step strategy-aware setting fetch. Returns the same shape pollSetting
 * does. Used for the immediate verification poll after Apply, and for the
 * freshness re-read on Match (so applied_value reflects the actual up-to-date
 * value, not a stale row from the last slow-tier poll).
 *
 * Dispatch mirrors poll.js's STRATEGY table: graph → graph-readers,
 * powershell_* → pwsh-readers. Phase B v2 (Apr 26): added pwsh dispatch so
 * Apply verification works for EXO/Teams/Compliance settings.
 */
async function readSettingNow(tenantAzureId, settingId) {
  const setting = byId(settingId);
  if (!setting) return { ok: false, error: `Unknown setting ${settingId}` };
  switch (setting.poll_strategy) {
    case 'graph':
      return graphReaders.pollSetting(tenantAzureId, settingId);
    case 'powershell_exo':
    case 'powershell_teams':
      return pwshReaders.pollSetting(tenantAzureId, settingId);
    case 'powershell_spo':
      return { ok: false, error: `Setting ${settingId} uses powershell_spo — reader not yet implemented` };
    default:
      return { ok: false, error: `Setting ${settingId} has unknown poll_strategy=${setting.poll_strategy}` };
  }
}

/**
 * Find which of the writer's documented options corresponds to a given
 * current_value. Returns the option.value (the chosen UI value) or null if
 * the current state doesn't match any option (e.g. tenant has a custom GUID
 * we don't enumerate).
 */
function deriveChosenFromCurrent(setting, currentValue) {
  if (!setting.writer || !Array.isArray(setting.writer.options)) return null;
  for (const opt of setting.writer.options) {
    if (setting.writer.matches(opt.value, currentValue)) return opt.value;
  }
  return null;
}

/**
 * Map a WriterError code → HTTP status. Centralised so per-route error
 * handling is one line.
 */
function httpStatusFromWriterCode(code) {
  switch (code) {
    case 'PERMS':                   return 403;
    case 'NOT_FOUND':               return 404;
    case 'BAD_REQUEST':             return 400;
    case 'BAD_VALUE':               return 400;
    case 'NO_WRITER':               return 400;
    case 'CONFLICT':                return 409;
    case 'RATE_LIMITED':            return 429;
    case 'NETWORK':                 return 502;
    // Apr 28, 2026 — delegated_teams strategy returns this when the
    // operator's session lacks a Teams admin refresh token (or the token
    // expired). 401 + a JSON body containing the auth URL prompts the
    // frontend to open the sign-in popup.
    case 'DELEGATED_AUTH_REQUIRED': return 401;
    default:                        return 500;
  }
}

/**
 * Persist a state transition + emit security_setting_events row + msp_audit_events row.
 * Idempotent on transient failure: the audit writes are wrapped per the
 * msp-audit contract so a logging failure does NOT abort the mutation.
 *
 * @param {object} args
 * @param {object} args.tenant            { id, tenant_id (GUID), display_name }
 * @param {string} args.settingId
 * @param {object} args.setting           registry row
 * @param {string} args.action            'apply'|'match'|'remediate'|'accept'
 * @param {*}      args.newAppliedValue   chosen UI value (string|bool|null)
 * @param {object|null} args.currentValue most recent reader output
 * @param {string} args.newStatus         destination status enum
 * @param {*}      args.previousAppliedValue prior applied_value (for the event row)
 * @param {string} args.operatorEmail
 * @param {object} args.req               express req (for msp-audit actor capture)
 * @param {string|null} args.lastCheckError  forwarded into tenant_security_config
 */
async function persistTransition(args) {
  const {
    tenant, settingId, setting, action, newAppliedValue, currentValue,
    newStatus, previousAppliedValue, operatorEmail, req, lastCheckError = null,
  } = args;

  const currentJson  = currentValue !== undefined && currentValue !== null
    ? JSON.stringify(currentValue) : null;
  const appliedJson  = newAppliedValue !== undefined && newAppliedValue !== null
    ? JSON.stringify(newAppliedValue) : null;
  const previousJson = previousAppliedValue !== undefined && previousAppliedValue !== null
    ? JSON.stringify(previousAppliedValue) : null;

  // UPSERT — Phase A may have already created a not_applied row from polling.
  // Use INSERT ... ON DUPLICATE KEY UPDATE so we don't lose created_at.
  await db.execute(
    `INSERT INTO tenant_security_config
       (tenant_id, setting_id, status, applied_value, current_value,
        applied_at, applied_by, last_checked_at, last_check_error)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       status           = VALUES(status),
       applied_value    = VALUES(applied_value),
       current_value    = COALESCE(VALUES(current_value), current_value),
       applied_at       = VALUES(applied_at),
       applied_by       = VALUES(applied_by),
       last_checked_at  = VALUES(last_checked_at),
       last_check_error = VALUES(last_check_error)`,
    [tenant.id, settingId, newStatus, appliedJson, currentJson, operatorEmail, lastCheckError]
  );

  // Map operator action → security_setting_events.event_type
  const EVENT_TYPE = {
    apply: 'applied',
    match: 'matched',
    remediate: 'remediated',
    accept: 'accepted',
  };
  const eventType = EVENT_TYPE[action];
  if (eventType) {
    try {
      await db.execute(
        `INSERT INTO security_setting_events
           (tenant_id, setting_id, event_type, previous_value, new_value,
            operator_email, source)
         VALUES (?, ?, ?, ?, ?, ?, 'operator')`,
        [tenant.id, settingId, eventType, previousJson, appliedJson, operatorEmail]
      );
    } catch (e) {
      console.error('[api-security] security_setting_events write failed:', e.message);
    }
  }

  // MSP-level audit log. Wrapped — a logging failure must NOT abort the
  // mutation (per msp-audit.js contract).
  try {
    await logMspAudit({
      req,
      category: CATEGORY.SETTINGS_CHANGE,
      action: `security.${action}`,
      description: `${capitalise(action)} ${setting.name} on ${tenant.display_name}`,
      templateKey: `security.${action}`,
      templateParams: { settingName: setting.name, tenantName: tenant.display_name },
      targetType: 'security_setting',
      targetId: settingId,
      targetName: setting.name,
      metadata: {
        tenantId: tenant.id,
        tenantName: tenant.display_name,
        previousAppliedValue: previousAppliedValue ?? null,
        newAppliedValue: newAppliedValue ?? null,
        currentValueAfter: currentValue ?? null,
        newStatus,
      },
    });
  } catch (e) {
    console.error('[api-security] logMspAudit failed:', e.message);
  }
}

function capitalise(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}

function operatorEmailOf(req) {
  return req.session?.user?.email || 'unknown@panoptica';
}

/**
 * Load tenant + validate setting + ensure writer exists. Centralises the
 * 400/404 returns so each verb route is short.
 */
async function loadContextOrBail(req, res, requireWriter = true) {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return null;
  const sid = String(req.params.sid || '').toUpperCase();
  const setting = byId(sid);
  if (!setting) {
    res.status(404).json({ error: `Unknown setting ${sid}` });
    return null;
  }
  if (requireWriter && !setting.writer) {
    res.status(400).json({
      error: `Setting ${sid} has no writer in Phase B v1`,
      detail: 'Write surface is not yet implemented for this setting. Read-only.',
    });
    return null;
  }
  return { tenant, settingId: sid, setting };
}

/** Load the prior applied_value (for the event row's previous_value field). */
async function priorAppliedValue(tenantId, settingId) {
  const row = await db.queryOne(
    'SELECT applied_value FROM tenant_security_config WHERE tenant_id = ? AND setting_id = ?',
    [tenantId, settingId]
  );
  if (!row || row.applied_value == null) return null;
  return safeParse(row.applied_value);
}

// ─── APPLY ─────────────────────────────────────────────────────
// A3 (May 9, 2026): operator — apply security setting writer to a tenant.
router.post('/tenants/:tid/settings/:sid/apply', auth.requireMemberOrAdmin, async (req, res) => {
  const ctx = await loadContextOrBail(req, res);
  if (!ctx) return;
  const { tenant, settingId, setting } = ctx;

  // Apr 27 — audit-only writers (CMP-02 DLP) cannot Apply by design. Only Match
  // and Accept are valid actions. Surfaces a 405 with operator-actionable detail.
  if (setting.writer && setting.writer.audit_only === true) {
    return res.status(405).json({
      error: 'Apply not available',
      detail: 'This setting is audit-only — Panoptica monitors changes but does not modify the configuration. Use Match to capture a baseline; manage the underlying configuration via the Microsoft admin portal.',
    });
  }

  // Validate body { value: <chosen> }. Empty/missing → 400.
  const chosenValue = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value')
    ? req.body.value : undefined;
  if (chosenValue === undefined) {
    return res.status(400).json({ error: 'Missing body.value' });
  }

  const previous = await priorAppliedValue(tenant.id, settingId);
  const operatorEmail = operatorEmailOf(req);

  // Step 1: read CURRENT state first — some writers (ENT-06's prepareGraphCall)
  // need the pre-write current_value to decide POST vs PATCH and which path
  // to call. Fetch via the strategy-aware helper used by the verification poll.
  let preReadResult;
  try {
    preReadResult = await readSettingNow(tenant.tenant_id, settingId);
  } catch (e) {
    preReadResult = { ok: false, error: `Pre-write read failed: ${e.message}` };
  }
  const preReadCurrent = preReadResult?.ok ? preReadResult.current_value : null;

  // Step 2: write to Graph / pwsh.
  let writeResult;
  try {
    // Apr 28, 2026 — pass req through so delegated_teams writers can read
    // the operator's session for the refresh token. Other writer strategies
    // ignore the req field; only delegated_teams reads it.
    writeResult = await writers.applySetting(tenant.tenant_id, settingId, chosenValue, {
      currentValue: preReadCurrent,
      req,
    });
  } catch (e) {
    const code = e.code || 'UNKNOWN';
    const status = httpStatusFromWriterCode(code);
    // Apr 28, 2026 — special handling for delegated_teams: the auth
    // requirement isn't an error, it's a workflow step. Return 401 with
    // the auth URL so the frontend can open the sign-in popup transparently.
    if (code === 'DELEGATED_AUTH_REQUIRED') {
      return res.status(401).json({
        error: 'Delegated authentication required',
        code,
        detail: e.message,
        auth_url: '/auth/teams-delegated/login',
      });
    }
    // Persist failure as a security_setting_events row? No — failed writes
    // do NOT change applied_value and so are not "transitions" in the
    // state-machine sense. Log to msp_audit_events with success=false instead.
    try {
      await logMspAudit({
        req,
        category: CATEGORY.SETTINGS_CHANGE,
        action: 'security.apply',
        description: `Apply ${setting.name} on ${tenant.display_name} FAILED`,
        templateKey: 'security.apply_failed',
        templateParams: { settingName: setting.name, tenantName: tenant.display_name },
        success: false,
        errorMessage: `${code}: ${e.message}`,
        targetType: 'security_setting',
        targetId: settingId,
        targetName: setting.name,
        metadata: { attemptedValue: chosenValue, code, statusCode: e.statusCode || null },
      });
    } catch {/* swallow */}
    return res.status(status).json({ error: 'Apply failed', code, detail: e.message });
  }

  // Step 2: immediate verification poll.
  // If reader confirms current_value matches chosenValue → status='monitored'.
  // If reader can't confirm yet (Microsoft propagation lag) → status='pending';
  // the next slow-tier poll picks it up.
  let verifyResult;
  try {
    verifyResult = await readSettingNow(tenant.tenant_id, settingId);
  } catch (e) {
    verifyResult = { ok: false, error: `Verification poll threw: ${e.message}` };
  }

  let newStatus, currentValue, lastCheckError = null;
  if (verifyResult.ok && setting.writer.matches(chosenValue, verifyResult.current_value)) {
    newStatus = 'monitored';
    currentValue = verifyResult.current_value;
  } else if (verifyResult.ok) {
    // Write returned success but read shows different value — propagation lag
    // is the most likely cause. Stay 'pending'; slow-tier poll will catch up.
    newStatus = 'pending';
    currentValue = verifyResult.current_value;
  } else {
    // Read failed; keep status pending and surface the read error.
    newStatus = 'pending';
    currentValue = null;
    lastCheckError = verifyResult.error || 'verification poll failed';
  }

  // captureBaseline (Apr 26 v2): for settings that need snapshot tracking
  // (e.g. EXO-06's impersonation lists), wrap the chosen primitive into a
  // rich object that includes the captured snapshot. matches() will then
  // compare both state AND snapshot for drift detection.
  const baselineToStore = setting.writer.captureBaseline
    ? setting.writer.captureBaseline(chosenValue, currentValue)
    : chosenValue;

  await persistTransition({
    tenant, settingId, setting,
    action: 'apply',
    newAppliedValue: baselineToStore,
    currentValue,
    newStatus,
    previousAppliedValue: previous,
    operatorEmail,
    req,
    lastCheckError,
  });

  // Apr 27, 2026 — Tenant Change Log row.
  // Apply writes to Microsoft, so this row is what enables 60-min drift
  // attribution: a SECURITY_DRIFT alert that fires within an hour of this
  // row will auto-tag with auto_attributed_change_id pointing here.
  // Description includes the chosen option's label when available so the
  // operator scanning the change log sees "Applied SSPR → Standard config"
  // not just "Applied SSPR".
  let chosenLabel = '';
  try {
    const optDef = (setting.writer.options || []).find(
      o => JSON.stringify(o.value) === JSON.stringify(
        (chosenValue && typeof chosenValue === 'object' && 'option' in chosenValue) ? chosenValue.option : chosenValue
      )
    );
    chosenLabel = optDef?.label || '';
  } catch { /* swallow — descriptive only */ }
  const tail = chosenLabel
    ? `set to "${chosenLabel}"${newStatus === 'pending' ? ' (Microsoft propagation in progress)' : ''}`
    : `applied${newStatus === 'pending' ? ' (Microsoft propagation in progress)' : ''}`;
  await logSecuritySettingChange(req, tenant, setting, 'Applied', tail);

  res.json({
    ok: true,
    status: newStatus,
    applied_value: chosenValue,
    current_value: currentValue,
    // Strategy-dependent: graph writers return {payload}, pwsh writers
    // return {cmdlet}. Surface whichever is present so the response payload
    // is informative for both writer types.
    payload_sent: writeResult.payload || writeResult.cmdlet || null,
    verification: verifyResult.ok
      ? (newStatus === 'monitored' ? 'confirmed' : 'pending — value mismatch (likely propagation lag)')
      : `failed: ${lastCheckError}`,
  });
});

// ─── APPLY (ASYNC) — enqueue + status polling ─────────────────────
//
// May 6, 2026 — built to unblock MSP-scale deployments where customer
// tenants commonly have 100s of mailboxes. The synchronous /apply path
// above stays as a fallback (works fine for graph-strategy settings that
// finish in <2s); the async path is what the frontend uses for any
// pwsh-strategy setting with iterable per-object work (EXO-09 in
// particular needs ~75s for a 51-mailbox tenant, which exceeds typical
// reverse-proxy timeouts).
//
// Flow:
//   1. POST /apply-async — validates input, enqueues a job, returns 202
//      with {jobId} in <1s.
//   2. The background worker (src/security-apply-worker.js) picks up the
//      job, runs writers.applySetting + the full post-write pipeline
//      (verify + persist + audit) using helpers exported from this module.
//   3. PowerShell scripts emit [PANOPTICA-PROGRESS] markers; the worker
//      parses them and writes to apply_jobs.progress_*.
//   4. Frontend polls GET /tenants/:tid/jobs/:jid every ~2s for status.
//
// Per-tenant per-setting lock: enqueueJob refuses if a job is already
// queued/running for the same (tenant, setting). Returns 409 Conflict
// with the existing jobId so the frontend can resume polling that job.
// A3 (May 9, 2026): operator — async Apply (background worker job).
router.post('/tenants/:tid/settings/:sid/apply-async', auth.requireMemberOrAdmin, async (req, res) => {
  const ctx = await loadContextOrBail(req, res);
  if (!ctx) return;
  const { tenant, settingId, setting } = ctx;

  // Audit-only writers (CMP-02) cannot Apply by design.
  if (setting.writer && setting.writer.audit_only === true) {
    return res.status(405).json({
      error: 'Apply not available',
      detail: 'This setting is audit-only — Panoptica monitors changes but does not modify the configuration.',
    });
  }

  // delegated_teams writers can't run from the async worker (no req.session
  // context). Tell the frontend to use the sync /apply endpoint for these.
  if (setting.writer && setting.writer.strategy === 'delegated_teams') {
    return res.status(409).json({
      error: 'Async Apply not supported for this setting',
      detail: 'Delegated-Teams settings require an interactive operator session and run via the synchronous /apply endpoint.',
      code: 'ASYNC_NOT_SUPPORTED',
    });
  }

  const chosenValue = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value')
    ? req.body.value : undefined;
  if (chosenValue === undefined) {
    return res.status(400).json({ error: 'Missing body.value' });
  }

  const operatorEmail = operatorEmailOf(req);

  let job;
  try {
    job = await applyJobs.enqueueJob({
      tenantId: tenant.id,
      settingId,
      chosenValue,
      operatorEmail,
    });
  } catch (e) {
    if (e.code === 'ALREADY_QUEUED') {
      // Frontend resumes polling the existing job rather than queuing a dup.
      return res.status(409).json({
        error: 'Apply already in progress',
        code: 'ALREADY_QUEUED',
        detail: e.message,
        existingJobId: e.existingJobId,
        existingStatus: e.existingStatus,
      });
    }
    return res.status(500).json({ error: 'Failed to enqueue Apply job', detail: e.message });
  }

  res.status(202).json({
    jobId: job.jobId,
    status: job.status,
    pollUrl: `/api/security/tenants/${tenant.id}/jobs/${job.jobId}`,
  });
});

// GET — poll job status. Returns the row including elapsed_seconds so the
// frontend can render "X/Y mailboxes (Ns elapsed)" without timezone math.
router.get('/tenants/:tid/jobs/:jid', async (req, res) => {
  const tenantId = parseInt(req.params.tid, 10);
  const jobId = parseInt(req.params.jid, 10);
  if (!tenantId || !jobId) return res.status(400).json({ error: 'Invalid tenantId or jobId' });

  // Light auth: caller must be authenticated. Tenant scoping check below
  // ensures one operator can't peek at another tenant's jobs by guessing IDs.
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });

  const job = await applyJobs.getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.tenant_id !== tenantId) {
    // Job exists but for a different tenant — refuse without leaking.
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: job.id,
    settingId: job.setting_id,
    status: job.status,
    progress: {
      current: job.progress_current,
      total: job.progress_total,
      message: job.progress_message,
    },
    elapsedSeconds: job.elapsed_seconds || 0,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    error: job.error_message,
    output: job.output,
  });
});

// GET — find any active (queued/running) job for a (tenant, setting). Used
// by the frontend to detect "Apply already in progress, resume polling"
// when the operator reopens the Configure tab.
router.get('/tenants/:tid/settings/:sid/active-job', async (req, res) => {
  const ctx = await loadContextOrBail(req, res, false);  // don't require writer
  if (!ctx) return;
  const { tenant, settingId } = ctx;

  const job = await applyJobs.getActiveJobForTenantSetting(tenant.id, settingId);
  if (!job) return res.json({ active: false });
  res.json({
    active: true,
    jobId: job.id,
    status: job.status,
    progress: {
      current: job.progress_current,
      total: job.progress_total,
      message: job.progress_message,
    },
    startedAt: job.started_at,
  });
});

// ─── MATCH ─────────────────────────────────────────────────────
// A3 (May 9, 2026): operator — Match Current (adopt live state as baseline).
router.post('/tenants/:tid/settings/:sid/match', auth.requireMemberOrAdmin, async (req, res) => {
  const ctx = await loadContextOrBail(req, res);
  if (!ctx) return;
  const { tenant, settingId, setting } = ctx;

  // Re-read to make sure we capture the *current* state, not a stale row.
  let readResult;
  try {
    readResult = await readSettingNow(tenant.tenant_id, settingId);
  } catch (e) {
    return res.status(502).json({ error: 'Match read failed', detail: e.message });
  }
  if (!readResult.ok) {
    return res.status(502).json({ error: 'Match read failed', detail: readResult.error });
  }

  // Apr 27 — audit-only writers (CMP-02 DLP) bypass the option-matching path.
  // There are no documented options to map current state to; the snapshot IS
  // the chosen value. captureBaseline returns the full current snapshot,
  // applied_value gets stored as the snapshot directly, and matches() will
  // later do deep snapshot equality. Empty state (zero policies) is valid —
  // captures empty baseline, future config creation fires drift.
  let chosenValue;
  if (setting.writer && setting.writer.audit_only === true) {
    chosenValue = setting.writer.captureBaseline(null, readResult.current_value);
  } else {
    // Match requires the current value to map to one of the writer's documented
    // options. If it doesn't (operator has a custom configuration we don't
    // enumerate), Match is not safe — drift detection later wouldn't know what
    // to compare against. Return 409 with explanation.
    chosenValue = deriveChosenFromCurrent(setting, readResult.current_value);
    if (chosenValue === null) {
      return res.status(409).json({
        error: 'Match not available',
        detail: 'Current configuration does not correspond to any documented option. Use Apply to set an explicit baseline.',
      });
    }
  }

  const previous = await priorAppliedValue(tenant.id, settingId);
  const operatorEmail = operatorEmailOf(req);

  // For audit-only, chosenValue IS the captured baseline (snapshot already).
  // For others, run captureBaseline to wrap if the writer wants snapshot tracking.
  const baselineToStoreMatch = (setting.writer && setting.writer.audit_only === true)
    ? chosenValue
    : (setting.writer.captureBaseline
        ? setting.writer.captureBaseline(chosenValue, readResult.current_value)
        : chosenValue);

  await persistTransition({
    tenant, settingId, setting,
    action: 'match',
    newAppliedValue: baselineToStoreMatch,
    currentValue: readResult.current_value,
    newStatus: 'monitored',
    previousAppliedValue: previous,
    operatorEmail,
    req,
  });

  // Apr 27, 2026 — Tenant Change Log row.
  // Match doesn't write to Microsoft, but it changes Panoptica's monitoring
  // baseline. Audit-trail must capture this — particularly important for
  // audit-only settings (CMP-02) where Match IS the only operator action.
  // Description distinguishes baseline-update from change-on-tenant so
  // operators reviewing the log see clearly what touched the tenant vs what
  // touched our view of it.
  const matchTail = (setting.writer && setting.writer.audit_only === true)
    ? `captured current configuration as monitoring baseline (read-only)`
    : `captured current state as baseline (no change to tenant)`;
  await logSecuritySettingChange(req, tenant, setting, 'Matched', matchTail);

  // Apr 27, 2026 (second iteration) — auto-resolve any open SECURITY_DRIFT
  // alert. If status was drift before this Match, the operator just took
  // an explicit action to resolve it (re-baseline to current state). Same
  // intent as Accept/Remediate; same auto-resolve treatment. Without this,
  // re-matching after drift would leave a stale alert in the dashboard
  // even though the state is now fine.
  try {
    await alertEngine.resolveOpenAlerts(
      tenant.id,
      securityDriftDedupKey(settingId),
      `Auto-resolved — operator clicked Match (${operatorEmail || 'unknown'}) — baseline updated to current state`,
      { operatorEmail }
    );
  } catch (e) {
    console.error(`[api-security] resolveOpenAlerts on Match failed: ${e.message}`);
  }

  res.json({
    ok: true,
    status: 'monitored',
    applied_value: chosenValue,
    current_value: readResult.current_value,
  });
});

// ─── REMEDIATE — restore drifted setting to applied_value ─────
// A3 (May 9, 2026): operator — restore drifted setting to baseline.
router.post('/tenants/:tid/settings/:sid/remediate', auth.requireMemberOrAdmin, async (req, res) => {
  const ctx = await loadContextOrBail(req, res);
  if (!ctx) return;
  const { tenant, settingId, setting } = ctx;

  // Apr 27 — audit-only writers (CMP-02 DLP) cannot Remediate. Drift on an
  // audit-only setting must be resolved by either (a) reverting the change
  // via the source admin portal, or (b) Accept Drift to adopt the new state
  // as baseline.
  if (setting.writer && setting.writer.audit_only === true) {
    return res.status(405).json({
      error: 'Remediate not available',
      detail: 'This setting is audit-only — Panoptica cannot restore the configuration. Either revert the change via the Microsoft admin portal, or click Accept Drift to adopt the new state as the baseline.',
    });
  }

  const existing = await db.queryOne(
    'SELECT status, applied_value FROM tenant_security_config WHERE tenant_id = ? AND setting_id = ?',
    [tenant.id, settingId]
  );
  if (!existing || existing.applied_value == null) {
    return res.status(409).json({
      error: 'Remediate not available',
      detail: 'No applied_value baseline exists. Apply or Match first.',
    });
  }
  if (existing.status !== 'drift') {
    return res.status(409).json({
      error: 'Remediate not available',
      detail: `Current status is "${existing.status}". Remediate is only valid when status=drift.`,
    });
  }

  const appliedValue = safeParse(existing.applied_value);
  const operatorEmail = operatorEmailOf(req);

  // Re-PATCH the baseline value through the writer.
  // For settings with snapshot tracking (e.g. EXO-06), applied_value is a
  // rich object — extract the chosen primitive for the cmdlet path. Default
  // identity for settings without extractChosen.
  const cmdletInput = setting.writer.extractChosen
    ? setting.writer.extractChosen(appliedValue)
    : appliedValue;
  // Pre-read for writers needing currentValue (ENT-06's POST/PATCH branching)
  let preReadResult;
  try { preReadResult = await readSettingNow(tenant.tenant_id, settingId); }
  catch (e) { preReadResult = { ok: false, error: e.message }; }
  const preReadCurrent = preReadResult?.ok ? preReadResult.current_value : null;
  let writeResult;
  try {
    writeResult = await writers.applySetting(tenant.tenant_id, settingId, cmdletInput, {
      currentValue: preReadCurrent,
      req,  // Apr 28 — required for delegated_teams writer strategy
    });
  } catch (e) {
    const code = e.code || 'UNKNOWN';
    if (code === 'DELEGATED_AUTH_REQUIRED') {
      return res.status(401).json({
        error: 'Delegated authentication required',
        code,
        detail: e.message,
        auth_url: '/auth/teams-delegated/login',
      });
    }
    return res.status(httpStatusFromWriterCode(code)).json({
      error: 'Remediate failed', code, detail: e.message,
    });
  }

  // Verification poll.
  let verifyResult;
  try { verifyResult = await readSettingNow(tenant.tenant_id, settingId); }
  catch (e) { verifyResult = { ok: false, error: `Verification poll threw: ${e.message}` }; }

  let newStatus, currentValue, lastCheckError = null;
  if (verifyResult.ok && setting.writer.matches(appliedValue, verifyResult.current_value)) {
    newStatus = 'monitored';
    currentValue = verifyResult.current_value;
  } else if (verifyResult.ok) {
    newStatus = 'pending';
    currentValue = verifyResult.current_value;
  } else {
    newStatus = 'pending';
    currentValue = null;
    lastCheckError = verifyResult.error;
  }

  await persistTransition({
    tenant, settingId, setting,
    action: 'remediate',
    newAppliedValue: appliedValue,           // unchanged — restore-to-baseline
    currentValue,
    newStatus,
    previousAppliedValue: appliedValue,      // baseline didn't change
    operatorEmail,
    req,
    lastCheckError,
  });

  // Apr 27, 2026 — Tenant Change Log row.
  // Remediate writes to Microsoft (re-applies the baseline). Like Apply,
  // this row enables 60-min drift attribution if the same setting drifts
  // again shortly after.
  const remediateTail = newStatus === 'pending'
    ? 'restored to baseline (Microsoft propagation in progress)'
    : 'restored to baseline';
  await logSecuritySettingChange(req, tenant, setting, 'Remediated', remediateTail);

  // Apr 27, 2026 — auto-resolve the open SECURITY_DRIFT alert. Operator's
  // intent on Remediate is "restore baseline" — drift signal has been
  // processed. Wrapped in try/catch so an alert-side failure doesn't break
  // the API response (the actual remediation already succeeded).
  if (newStatus === 'monitored') {
    try {
      await alertEngine.resolveOpenAlerts(
        tenant.id,
        securityDriftDedupKey(settingId),
        `Auto-resolved — operator clicked Remediate (${operatorEmail || 'unknown'})`,
        { operatorEmail }
      );
    } catch (e) {
      console.error(`[api-security] resolveOpenAlerts on Remediate failed: ${e.message}`);
    }
  }

  res.json({
    ok: true,
    status: newStatus,
    applied_value: appliedValue,
    current_value: currentValue,
    // Strategy-dependent: graph writers return {payload}, pwsh writers
    // return {cmdlet}. Surface whichever is present so the response payload
    // is informative for both writer types.
    payload_sent: writeResult.payload || writeResult.cmdlet || null,
  });
});

// ─── ACCEPT — adopt the drifted current value as the new baseline ─
// A3 (May 9, 2026): operator — accept drift as new baseline.
router.post('/tenants/:tid/settings/:sid/accept', auth.requireMemberOrAdmin, async (req, res) => {
  const ctx = await loadContextOrBail(req, res);
  if (!ctx) return;
  const { tenant, settingId, setting } = ctx;

  const existing = await db.queryOne(
    'SELECT status, applied_value, current_value FROM tenant_security_config WHERE tenant_id = ? AND setting_id = ?',
    [tenant.id, settingId]
  );
  if (!existing) {
    return res.status(409).json({ error: 'Accept not available', detail: 'No row for this setting yet.' });
  }
  if (existing.status !== 'drift') {
    return res.status(409).json({
      error: 'Accept not available',
      detail: `Current status is "${existing.status}". Accept is only valid when status=drift.`,
    });
  }

  // Re-read current state to make sure we adopt the FRESH value, not a stale
  // row. Drift could have moved again between the slow-tier poll and now.
  let readResult;
  try { readResult = await readSettingNow(tenant.tenant_id, settingId); }
  catch (e) { return res.status(502).json({ error: 'Accept read failed', detail: e.message }); }
  if (!readResult.ok) return res.status(502).json({ error: 'Accept read failed', detail: readResult.error });

  // Apr 27 — audit-only writers bypass option-matching (no documented options).
  // Accept = capture the current snapshot as the new baseline.
  let newChosen;
  if (setting.writer && setting.writer.audit_only === true) {
    newChosen = setting.writer.captureBaseline(null, readResult.current_value);
  } else {
    newChosen = deriveChosenFromCurrent(setting, readResult.current_value);
    if (newChosen === null) {
      return res.status(409).json({
        error: 'Accept not available',
        detail: 'Drifted current value does not correspond to any documented option. Use Apply to set an explicit value.',
      });
    }
  }

  const previous = safeParse(existing.applied_value);
  const operatorEmail = operatorEmailOf(req);

  const baselineToStoreAccept = (setting.writer && setting.writer.audit_only === true)
    ? newChosen   // already a snapshot
    : (setting.writer.captureBaseline
        ? setting.writer.captureBaseline(newChosen, readResult.current_value)
        : newChosen);

  await persistTransition({
    tenant, settingId, setting,
    action: 'accept',
    newAppliedValue: baselineToStoreAccept,
    currentValue: readResult.current_value,
    newStatus: 'monitored',
    previousAppliedValue: previous,
    operatorEmail,
    req,
  });

  // Apr 27, 2026 — Tenant Change Log row.
  // Accept doesn't write to Microsoft, but it's the most security-sensitive
  // of the four verbs: an operator is explicitly adopting a CHANGED state
  // as the new baseline. If a hostile actor pushed the change and the
  // operator carelessly Accepted, this row is the audit-trail record of
  // that human decision. Description makes it unambiguous.
  await logSecuritySettingChange(req, tenant, setting, 'Accepted',
    'drift adopted as new baseline (no change to tenant — Panoptica baseline updated)');

  // Apr 27, 2026 — auto-resolve the open SECURITY_DRIFT alert. Accept Drift
  // = "this new state is the baseline now." Drift signal has been processed
  // by an explicit operator action; leaving the alert open just clutters.
  // Wrapped so alert-side failures can't break the API response.
  try {
    await alertEngine.resolveOpenAlerts(
      tenant.id,
      securityDriftDedupKey(settingId),
      `Auto-resolved — operator clicked Accept Drift (${operatorEmail || 'unknown'})`,
      { operatorEmail }
    );
  } catch (e) {
    console.error(`[api-security] resolveOpenAlerts on Accept failed: ${e.message}`);
  }

  res.json({
    ok: true,
    status: 'monitored',
    applied_value: newChosen,
    current_value: readResult.current_value,
  });
});

// ─── HISTORY — events for a single (tenant × setting) ─────────
// Powers the History tab in the per-setting modal.
router.get('/tenants/:tid/settings/:sid/history', async (req, res) => {
  const tenant = await loadTenantOrBail(req, res);
  if (!tenant) return;
  const sid = String(req.params.sid || '').toUpperCase();
  if (!byId(sid)) return res.status(404).json({ error: `Unknown setting ${sid}` });

  try {
    const rows = await db.queryRows(
      `SELECT id, event_type, previous_value, new_value, operator_email,
              source, created_at
         FROM security_setting_events
        WHERE tenant_id = ? AND setting_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 200`,
      [tenant.id, sid]
    );
    res.json({
      tenant: { id: tenant.id, display_name: tenant.display_name },
      setting_id: sid,
      events: rows.map(r => ({
        id: r.id,
        event_type: r.event_type,
        previous_value: safeParse(r.previous_value),
        new_value: safeParse(r.new_value),
        operator_email: r.operator_email,
        source: r.source,
        created_at: r.created_at,
      })),
    });
  } catch (e) {
    console.error('[api-security] history failed:', e.message);
    res.status(500).json({ error: 'history failed', detail: e.message });
  }
});

// May 6, 2026 — async Apply pattern. Expose internal helpers so the
// background worker (src/security-apply-worker.js) can run the full
// post-write pipeline (verify + persist + audit) outside an HTTP request
// context. The worker constructs a synthetic req with just operator_email
// for audit/change-log attribution.
module.exports = Object.assign(router, {
  // Helpers reused by the async-Apply worker:
  readSettingNow,
  persistTransition,
  logSecuritySettingChange,
  httpStatusFromWriterCode,
  operatorEmailOf,
  priorAppliedValue,
  // Module-level constants the worker may want for parity:
  securityDriftDedupKey,
});
