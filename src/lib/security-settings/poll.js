/**
 * Panoptica365 — Security Settings Poller
 *
 * Walks the settings registry for a given tenant, invokes the appropriate
 * reader per setting, and upserts tenant_security_config. Phase A1 only
 * writes to `current_value`, `last_checked_at`, `last_check_error`, and
 * `status` — `applied_value` stays NULL (no Apply/Match UI in Phase A1),
 * so the derived status is always one of:
 *   'not_applied'   — read succeeded; no baseline; we just have a value to show
 *   'poll_error'    — read failed; error recorded
 *   'unavailable'   — poll_strategy requires PowerShell Core infra that is
 *                     not yet online. This is DISTINCT from poll_error so the
 *                     UI can render "Awaiting infrastructure" rather than
 *                     "check failed".
 *
 * We intentionally do NOT write a poll_ok/poll_error event row on every
 * poll. Phase A1 writes events only on status *transitions* (the first time
 * a setting goes into error, the first time it recovers). This keeps the
 * event table from bloating by 25 × 15 tenants × 288 polls/day = 108k rows
 * per day of no-signal noise. The transition rule is enforced by comparing
 * the new status to the prior row's status inside updateRow().
 *
 * Phase B will start emitting applied/matched/drift_detected events on
 * operator actions — those go through a different code path, not this
 * polling loop.
 */

'use strict';

const db = require('../../db/database');
const { SETTINGS, byId } = require('./registry');
const graphReaders = require('./graph-readers');
const pwshReaders = require('./pwsh-readers');
const alertEngine = require('../../alert-engine');
const changeLog = require('../../change-log');  // 60-min drift auto-attribution
const i18n = require('../../i18n');             // Apr 30, 2026 — render English fallback for alert message

// Apr 27, 2026 — SECURITY_DRIFT alert wiring.
// Map a setting's registry priority to an alerts.severity enum value.
// 'critical' priority settings (DLP, MFA, audit log) jump to top of the
// alerts queue; lower-priority settings stay proportional. Falls back to
// 'medium' for any unexpected value so drift never fails to alert.
const PRIORITY_TO_SEVERITY = {
  critical: 'severe',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

// Dedup-key shape for SECURITY_DRIFT alerts. Tenant scope is enforced by the
// SQL `WHERE tenant_id = ?` guard in createOrUpdateAlert; the key just needs
// to be unique per (tenant, setting). Same setting drifting again before the
// existing alert is resolved bumps recurrence_count instead of creating a
// duplicate row.
function driftDedupKey(settingId) {
  return `security_drift:${settingId}`;
}

// Lookup-and-cache the SECURITY_DRIFT alert_policies row. Populated lazily on
// first drift detected after server boot. The seed bootstrap in seed.js
// (ensureSecurityDriftPolicy) creates the row at startup, so this lookup is
// expected to succeed; if it doesn't (e.g. seed failed), we log and skip
// alert creation rather than crashing the polling loop.
let _cachedDriftPolicy = null;
async function getDriftPolicy() {
  if (_cachedDriftPolicy) return _cachedDriftPolicy;
  try {
    const row = await db.queryOne(
      'SELECT id, name, severity, category, notification_target FROM alert_policies WHERE name = ? LIMIT 1',
      ['Security Setting Drift Detected']
    );
    if (!row) {
      console.warn('[SecurityPoll] SECURITY_DRIFT alert policy missing — alerts will not fire until seed.js bootstrap runs successfully');
      return null;
    }
    _cachedDriftPolicy = row;
    return row;
  } catch (e) {
    console.error('[SecurityPoll] getDriftPolicy() lookup failed:', e.message);
    return null;
  }
}

// Phase B: how long after an Apply we keep status='pending' instead of
// flipping to 'drift' when current_value still mismatches applied_value.
// Microsoft propagation can take 1-2 minutes for some surfaces. This is the
// per-setting verification window; after it expires, a mismatch is treated as
// real drift.
const PENDING_VERIFICATION_WINDOW_MS = 5 * 60 * 1000;  // 5 minutes

// Per-strategy dispatch. Phase A2.1 wires 'powershell_exo' to a real
// dispatcher; SPO and Teams remain "unavailable" stubs (Phase A2.2+).
//
// Dispatcher signature: dispatch(tenantAzureId, settingId)
//   tenantAzureId — the Azure AD GUID (tenants.tenant_id), which is what
//                   both Graph's token endpoint AND Connect-ExchangeOnline
//                   expect via -Organization. Passing the internal INT id
//                   yields AADSTS90002 "Tenant 'N' not found".
const STRATEGY = {
  graph: graphReaders.pollSetting,
  powershell_exo:   pwshReaders.pollSetting,
  powershell_teams: pwshReaders.pollSetting,
  powershell_spo:   async () => ({ ok: false, unavailable: true, error: 'Awaiting Phase A2.4 — SharePoint Online PowerShell readers' }),
};

/**
 * Decide new status given the read result and the prior row (if any).
 *
 * Phase A1 rules:
 *   - unavailable:   read explicitly marked as awaiting infra
 *   - poll_error:    read failed with a real error
 *   - not_applied:   read succeeded; no baseline
 *
 * Phase B additions (when applied_value is non-null AND a writer exists):
 *   - monitored:     current_value matches applied_value via writer.matches()
 *   - drift:         current_value does NOT match applied_value
 *   - pending:       mismatch but applied_at is within the verification window
 *                    (Microsoft propagation lag). Becomes drift after window expires.
 *
 * Drift comparison uses writer.matches(applied, current) — same canonical
 * comparator the API layer uses for Apply verification, so the entire system
 * has ONE definition of "this matches".
 *
 * @param {object}      result    reader output { ok, current_value, error, unavailable }
 * @param {object|null} priorRow  current tenant_security_config row (or null)
 *                                Expected fields: applied_value (JSON string|null),
 *                                applied_at (Date|string|null), status (string|null)
 */
function deriveStatus(result, priorRow) {
  if (result.unavailable) return 'unavailable';
  if (!result.ok) return 'poll_error';

  // No baseline → not_applied (Phase A behavior).
  if (!priorRow || priorRow.applied_value == null) return 'not_applied';

  // Baseline exists → drift comparison via writer.matches.
  // If the registry has no writer for this setting (read-only setting that
  // somehow got an applied_value — shouldn't happen, but defend), fall back
  // to not_applied so we don't lie about being monitored.
  const settingId = priorRow._settingId;
  const setting = settingId ? byId(settingId) : null;
  if (!setting || !setting.writer || typeof setting.writer.matches !== 'function') {
    return 'not_applied';
  }

  // mysql2 AUTO-PARSES JSON columns. A JSON-stored primitive (string/bool/
  // number) comes back as that primitive — JSON.parse on that throws and
  // loses the value, which used to flip status back to not_applied for
  // string-typed applied_values like ENT-09's GUID. Be tolerant: pass-through
  // non-strings, attempt parse on strings, fall back to the raw string if
  // the string isn't valid JSON (= it's a primitive string value).
  let appliedValue;
  const rawApplied = priorRow.applied_value;
  if (typeof rawApplied !== 'string') {
    appliedValue = rawApplied;
  } else {
    try { appliedValue = JSON.parse(rawApplied); }
    catch { appliedValue = rawApplied; }
  }

  const matches = setting.writer.matches(appliedValue, result.current_value);
  if (matches) return 'monitored';

  // Mismatch — check verification window. ONLY suppress to 'pending' if the
  // prior status was already 'pending' (i.e. we're still in a post-Apply
  // verification cycle waiting for Microsoft propagation). After Match or
  // Accept, prior status is 'monitored' — there was no write, no propagation
  // to wait for, so any mismatch is real drift and should fire immediately.
  // Bug fix Apr 26, 2026: the original window check applied to both Apply
  // and Match; that incorrectly suppressed real drift when an external change
  // happened within 5 min of a Match.
  if (priorRow.status === 'pending' && priorRow.applied_at) {
    const appliedAtMs = new Date(priorRow.applied_at).getTime();
    if (!Number.isNaN(appliedAtMs) && (Date.now() - appliedAtMs) < PENDING_VERIFICATION_WINDOW_MS) {
      return 'pending';
    }
  }
  return 'drift';
}

/**
 * Upsert a tenant_security_config row based on a poll result.
 * Returns {statusChanged, prevStatus, newStatus, currentValue, appliedValue}
 * so the caller can decide whether to emit a transition event.
 *
 * Phase B: prior row carries applied_value + applied_at into deriveStatus so
 * drift detection works. The _settingId injection on the prior row lets
 * deriveStatus look up the writer.matches() function in the registry.
 */
async function updateRow(tenantId, settingId, result) {
  const prior = await db.queryOne(
    'SELECT id, status, applied_value, applied_at FROM tenant_security_config WHERE tenant_id = ? AND setting_id = ?',
    [tenantId, settingId]
  );

  // Inject settingId so deriveStatus can resolve the writer for drift comparison.
  const priorWithCtx = prior ? { ...prior, _settingId: settingId } : null;
  const newStatus = deriveStatus(result, priorWithCtx);
  const currentValueJson = result.ok ? JSON.stringify(result.current_value) : null;
  const errorText = !result.ok ? (result.error || 'unknown') : null;

  if (prior) {
    await db.execute(
      `UPDATE tenant_security_config
         SET status           = ?,
             current_value    = CASE WHEN ? IS NOT NULL THEN ? ELSE current_value END,
             last_checked_at  = NOW(),
             last_check_error = ?
       WHERE id = ?`,
      [newStatus, currentValueJson, currentValueJson, errorText, prior.id]
    );
  } else {
    await db.execute(
      `INSERT INTO tenant_security_config
         (tenant_id, setting_id, status, current_value, last_checked_at, last_check_error)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [tenantId, settingId, newStatus, currentValueJson, errorText]
    );
  }

  // Same JSON-column read-tolerance rule as deriveStatus: if mysql2 already
  // returned a non-string (object or primitive), pass through. If it returned
  // a string that JSON.parse can't handle, treat as primitive string.
  let appliedValueParsed = null;
  if (prior && prior.applied_value != null) {
    const raw = prior.applied_value;
    if (typeof raw !== 'string') {
      appliedValueParsed = raw;
    } else {
      try { appliedValueParsed = JSON.parse(raw); }
      catch { appliedValueParsed = raw; }
    }
  }

  return {
    statusChanged: !prior || prior.status !== newStatus,
    prevStatus: prior ? prior.status : null,
    newStatus,
    currentValue: result.ok ? result.current_value : null,
    appliedValue: appliedValueParsed,
  };
}

/**
 * Emit a security_setting_events row on a status transition. No-op unless
 * the transition is meaningful (same status in, same status out → skip).
 *
 * Phase A1 emits: poll_ok, poll_error
 * Phase B adds:   drift_detected (transition INTO drift)
 *
 * Transitions into 'unavailable' are NOT audit-worthy (infra not online).
 * Transitions into 'monitored' from 'pending' are NOT logged here either —
 * those are the verification-window catch-up signal, not an operator action.
 *
 * The Apply/Match/Remediate/Accept event_types are written by the API layer
 * (api-security.js → persistTransition), not by the poll loop.
 */
async function maybeLogTransition(tenantId, settingId, transition, result) {
  if (!transition.statusChanged) return;
  const { newStatus, prevStatus } = transition;
  if (newStatus === 'unavailable') return;

  let eventType = null;
  let valuePayload = null;

  if (newStatus === 'poll_error') {
    eventType = 'poll_error';
    valuePayload = JSON.stringify({ error: result.error });
  } else if (prevStatus === 'poll_error' && newStatus !== 'poll_error') {
    // Recovery from error.
    eventType = 'poll_ok';
    valuePayload = result.ok ? JSON.stringify(result.current_value) : null;
  } else if (newStatus === 'drift') {
    // First entry into drift since last monitored/pending state.
    eventType = 'drift_detected';
    valuePayload = result.ok ? JSON.stringify(result.current_value) : null;
  }
  if (!eventType) return;

  try {
    await db.execute(
      `INSERT INTO security_setting_events
         (tenant_id, setting_id, event_type, previous_value, new_value, source)
       VALUES (?, ?, ?, ?, ?, 'panoptica')`,
      [
        tenantId, settingId, eventType,
        // For drift events, previous_value = applied_value (the baseline we drifted from)
        eventType === 'drift_detected' && transition.appliedValue != null
          ? JSON.stringify(transition.appliedValue) : null,
        valuePayload,
      ]
    );
  } catch (e) {
    // Audit-write failures must not mask the polling outcome.
    console.error('[SecurityPoll] Failed to log transition event:', e.message);
  }

  // Apr 27, 2026 — SECURITY_DRIFT alert wiring.
  // Drift INTO this state fires an alert; transient drift cleared without
  // operator action auto-resolves any open alerts. Wrapped in its own
  // try/catch so an alert-side failure can't break the polling pipeline.
  try {
    if (newStatus === 'drift' && eventType === 'drift_detected') {
      await fireDriftAlert(tenantId, settingId, transition, result);
    } else if (prevStatus === 'drift' && newStatus === 'monitored') {
      // Operator-initiated transitions out of drift (Accept / Remediate)
      // resolve their own alerts via api-security.js BEFORE this poll
      // observes the state change. By the time we get here for those, the
      // alert is already resolved and resolveOpenAlerts is a no-op (status
      // filter excludes 'resolved' rows). For the case where drift cleared
      // *without* operator action (someone reverted via Microsoft portal),
      // this is the path that auto-resolves the alert.
      await alertEngine.resolveOpenAlerts(
        tenantId,
        driftDedupKey(settingId),
        'Auto-resolved — drift transitioned back to monitored without operator action (likely external revert)'
      );
    }
  } catch (e) {
    console.error('[SecurityPoll] SECURITY_DRIFT alert wiring failed:', e.message);
  }
}

/**
 * Apr 27, 2026 — fire a SECURITY_DRIFT alert into the central alerts table.
 * Severity is computed from the setting's registry priority (critical→severe
 * etc.), overriding the policy's default severity. Dedup key is
 * security_drift:<settingId> — same setting drifting again before resolve
 * bumps recurrence_count instead of inserting a duplicate row.
 */
async function fireDriftAlert(tenantId, settingId, transition, result) {
  const setting = byId(settingId);
  if (!setting) {
    console.warn(`[SecurityPoll] fireDriftAlert: unknown setting ${settingId}`);
    return;
  }
  const policy = await getDriftPolicy();
  if (!policy) return;  // already logged in getDriftPolicy

  // Compose a human-readable message. The Alerts UI renders this in the row;
  // the slideout shows raw_data for full context. Keep the message short
  // (the table column truncates long lines) and put detail in raw_data.
  //
  // Apr 30, 2026 — i18n Phase 6: when the writer exposes interpret() the
  // structured {template_key, params} pair is computed and stored in raw_data
  // so the Alerts UI can re-render the message in the operator's locale.
  // The stored `message` column stays English (legacy fallback for emails,
  // exports, audit logs, and unmigrated UI surfaces).
  const wasInterpreted = '(see baseline in detail panel)';
  let interpretedStruct = null;
  if (result.ok && typeof setting.writer.interpret === 'function') {
    try {
      interpretedStruct = setting.writer.interpret(result.current_value);
    } catch (e) {
      console.warn(`[SecurityPoll] writer.interpret() threw for ${settingId}: ${e.message}`);
    }
  }
  let isInterpreted;
  if (interpretedStruct && interpretedStruct.template_key) {
    // Render the English form for the stored message column.
    isInterpreted = i18n.t(interpretedStruct.template_key, { ...(interpretedStruct.params || {}), lang: 'en' });
  } else {
    isInterpreted = result.ok && result.interpreted ? result.interpreted : '(unable to read current value)';
  }
  const message = `Drift on ${setting.name}: now ${isInterpreted}`;

  const severity = PRIORITY_TO_SEVERITY[setting.priority] || 'medium';

  // Apr 27, 2026 — if the writer exposes computeDiff (currently CMP-02), call
  // it to attach a structured diff to the alert. Surfaces "what changed" in
  // the slideout's raw_data so operators (and us, while debugging) can see
  // baseline vs current at a glance instead of staring at two opaque JSON
  // blobs. Wrapped in try/catch — diff is diagnostic, not load-bearing.
  let diff = null;
  try {
    if (typeof setting.writer.computeDiff === 'function' && result.ok) {
      diff = setting.writer.computeDiff(transition.appliedValue, result.current_value);
    }
  } catch (e) {
    console.error(`[SecurityPoll] computeDiff threw for ${settingId}:`, e.message);
    diff = { error: `computeDiff threw: ${e.message}` };
  }

  let createdAlert = null;
  try {
    const tenantStub = { id: tenantId };
    const policyForCreate = { ...policy, severity };
    createdAlert = await alertEngine.createOrUpdateAlert(tenantStub, policyForCreate, {
      severity,
      message,
      dedup_key: driftDedupKey(settingId),
      raw_data: {
        // Schema marker so future Alerts UI enhancements can render a
        // setting-specific slideout instead of the generic JSON dump.
        kind: 'security_setting_drift',
        setting_id: settingId,
        setting_name: setting.name,
        setting_category: setting.category,
        setting_priority: setting.priority,
        // Structured diff (when the writer supports it). For CMP-02 this
        // shows: added_policies, removed_policies, modified_policies (with
        // per-policy mode/workload/rule changes). When empty_diff_warning
        // is non-null, matches() and computeDiff() disagree — meaning the
        // normalizer is missing an axis (e.g. workload non-determinism).
        diff,
        applied_value: transition.appliedValue,
        current_value: result.ok ? result.current_value : null,
        // Apr 30, 2026 — i18n Phase 6: store BOTH the legacy English string
        // (back-compat for unmigrated UI surfaces and email exports) AND the
        // structured {template_key, params} (used by the Alerts UI to render
        // in the operator's locale at display time). When migrated, the
        // structured form drives display; when null, UI falls back to string.
        current_value_interpreted: result.ok ? result.interpreted : null,
        current_value_interpreted_struct: interpretedStruct,
        // Message-template metadata for Alerts UI re-rendering. Settings
        // without writer.interpret() yet leave these null and the UI shows
        // the stored English `message` column unchanged.
        message_template_key: interpretedStruct ? 'alerts.security_drift_message_format' : null,
        message_template_params: interpretedStruct ? {
          settingNameKey: `security_settings.${settingId}.name`,
          settingNameFallback: setting.name,
          interpretedKey: interpretedStruct.template_key,
          interpretedParams: interpretedStruct.params || {},
        } : null,
        last_check_error: result.ok ? null : (result.error || 'unknown'),
        // Click-through hint for the UI: link to the Security tab modal for
        // this (tenant, setting). Not enforced server-side; just metadata.
        deep_link: `/security?tenant=${tenantId}&setting=${encodeURIComponent(settingId)}`,
      },
    });
  } catch (e) {
    console.error(`[SecurityPoll] createOrUpdateAlert failed for ${settingId}:`, e.message);
  }

  // Apr 27, 2026 — auto-attribute this drift to a recent Panoptica change
  // on the SECURITY_SETTING surface. Same pattern as api-ca.js:340 — the
  // alert still fires (operator gets the signal), but if it overlaps a
  // Panoptica push within 60 minutes, alerts.auto_attributed_change_id is
  // set to the originating change's id so the slideout can render
  // "caused by your Apply at 14:32" instead of an unattributed drift.
  // Only run on NEW alerts (recurrence dedup returns null/no-isNew → skip).
  //
  // Apr 28, 2026 — added correlationTagPrefix filter. The SECURITY_SETTING
  // surface is shared across ALL security setting changes; without the
  // prefix, an ENT-05 drift could falsely attribute to a recent TEA-02
  // Apply (same surface, different setting). The api-security.js change
  // log writes correlationTag = `security_setting:<setting_id>`, and we
  // filter here on the same prefix to keep attribution per-setting.
  if (createdAlert && createdAlert.isNew && createdAlert.id) {
    try {
      const attrib = await changeLog.findAttributingChange(
        tenantId,
        [changeLog.SURFACE.SECURITY_SETTING],
        { correlationTagPrefix: `security_setting:${settingId}` }
      );
      if (attrib) {
        await db.execute(
          'UPDATE alerts SET auto_attributed_change_id = ? WHERE id = ?',
          [attrib.id, createdAlert.id]
        );
        console.log(`[SecurityPoll] Alert ${createdAlert.id} auto-attributed to change event ${attrib.id} (${attrib.category})`);
      }
    } catch (attribErr) {
      console.warn(`[SecurityPoll] Auto-attribution lookup failed for alert ${createdAlert.id} (non-fatal): ${attribErr.message}`);
    }
  }
}

/**
 * Poll all registered settings for a single tenant.
 * Sequential, not parallel — Graph rate limits per tenant are already
 * pressured by the live-tier fetchers. One setting at a time, each setting
 * at most one Graph call. Total ~25 calls spread over a few seconds.
 *
 * Accepts either a full tenant row ({id, tenant_id, ...}) or, for back-
 * compat, an INT id — in which case the row is loaded from the DB. Prefer
 * passing the row if you already have it.
 *
 * The INT id (tenant.id) is used for DB writes (FK target in
 * tenant_security_config). The Azure GUID (tenant.tenant_id) is used for
 * Graph API calls. These are DIFFERENT identifiers; swapping them is the
 * classic bug that causes AADSTS90002 "Tenant '1' not found".
 *
 * @param {number|{id:number, tenant_id:string}} tenantOrId
 * @returns {Promise<{pollsRun: number, errors: number, unavailable: number}>}
 */
async function pollTenantSecurity(tenantOrId) {
  let tenant = tenantOrId;
  if (typeof tenantOrId === 'number' || typeof tenantOrId === 'string') {
    tenant = await db.queryOne(
      'SELECT id, tenant_id FROM tenants WHERE id = ?',
      [tenantOrId]
    );
    if (!tenant) {
      throw new Error(`pollTenantSecurity: tenant id=${tenantOrId} not found`);
    }
  }
  if (!tenant || !tenant.id || !tenant.tenant_id) {
    throw new Error('pollTenantSecurity: tenant row missing id or tenant_id (Azure GUID)');
  }

  let pollsRun = 0;
  let errors = 0;
  let unavailable = 0;

  for (const s of SETTINGS) {
    const dispatch = STRATEGY[s.poll_strategy];
    if (!dispatch) {
      console.warn(`[SecurityPoll] Unknown poll_strategy '${s.poll_strategy}' for ${s.setting_id}`);
      continue;
    }
    pollsRun++;

    let result;
    try {
      // Graph readers want the AZURE GUID. DB writes use tenant.id.
      result = await dispatch(tenant.tenant_id, s.setting_id);
    } catch (e) {
      // Defensive — a reader that throws (rather than returning {ok:false})
      // should not abort the whole poll pass.
      result = { ok: false, error: `reader threw: ${e.message}` };
    }

    if (result.unavailable) unavailable++;
    else if (!result.ok) errors++;

    try {
      const transition = await updateRow(tenant.id, s.setting_id, result);
      await maybeLogTransition(tenant.id, s.setting_id, transition, result);
    } catch (e) {
      console.error(`[SecurityPoll] updateRow failed for ${tenant.id}/${s.setting_id}:`, e.message);
    }
  }

  return { pollsRun, errors, unavailable };
}

module.exports = {
  pollTenantSecurity,
  // Exported for unit testing and for the Refresh button to poll a single setting
  _internal: { deriveStatus, updateRow, maybeLogTransition },
};
