/**
 * Panoptica365 — Microsoft Message Center Worker (Feature 8.8)
 *
 * Once a day, pulls the Microsoft 365 Message Center from ONE operator-chosen
 * source tenant, asks Haiku whether each new message affects a monitored
 * control, and — only when it does — raises a SINGLE MSP-level alert naming
 * the change and the tenants it may affect. There is no list page; if nothing
 * relevant is in the feed, the operator hears nothing.
 *
 * This surfaces a third class of drift — Microsoft-caused — alongside the
 * operator-caused and attacker-caused drift the platform already tracks.
 *
 * Worker conventions mirror src/ual-worker.js: start()/stop(), an internal
 * polling loop, concurrency guard, defensive try/catch so one bad message
 * never wedges the cycle. The loop wakes hourly but only does real work once
 * per 24h (watermark in message_center_state) so a restart can't skip a day.
 *
 * Locked design (see Build Instructions 2026-05-30):
 *   - Single source tenant, operator-selected; default None = feature off.
 *   - Haiku decides relevance (classification only). Tenant impact is a
 *     deterministic local DB join, never Haiku's job.
 *   - Affected tenants (v1) = all enabled, non-audit-only tenants.
 *   - One MSP-level alert per relevant message; dedup by mc_id.
 */

'use strict';

const config = require('../config/default');
const db = require('./db/database');
const graph = require('./graph');
const tenantMode = require('./lib/tenant-mode');
const aiAnalysis = require('./ai-analysis');
const alertEngine = require('./alert-engine');
const notifier = require('./notifier');
const registry = require('./lib/security-settings/registry');
const store = require('./lib/message-center-store');
const workerHeartbeat = require('./worker-heartbeat');

const WAKE_INTERVAL_MS = 60 * 60 * 1000;   // wake hourly
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // act once per 24h
const FIRST_RUN_DELAY_MS = 90 * 1000;       // defer first wake past startup work
const MAX_PAGES = 50;                        // pagination safety cap

// Categories worth Haiku tokens. stayInformed is FYI/marketing — skip.
const RELEVANT_CATEGORIES = new Set(['planForChange', 'preventOrFixIssue']);
const SEVERITY_RANK = { info: 1, low: 2, medium: 3, high: 4, severe: 5 };

let loopHandle = null;
let cycleInProgress = false;
// Stuck-cycle watchdog (Reliability P0, 2026-06-12): if the guard is older
// than this, the previous cycle's `finally` never ran (hung await) — clear it
// and proceed on this tick rather than skipping for the rest of the process.
let guardSetAt = 0;
const MAX_CYCLE_RUNTIME_MS = 30 * 60 * 1000;

/** Resolve the configured source-tenant GUID to its internal tenant row. */
async function resolveSourceTenant(guid) {
  if (!guid) return null;
  return db.queryOne(
    `SELECT id, tenant_id, display_name, psa_name, language, mode, enabled
       FROM tenants WHERE tenant_id = ? LIMIT 1`,
    [guid]
  );
}

/**
 * Deterministic affected-tenant join (v1): all enabled, non-audit-only
 * tenants. Returns [{ id, display_name }] sorted by display name. Audit-only
 * tenants are excluded via the in-memory tenant-mode gate (same rule as the
 * UAL worker — audit-only tenants get no alerts).
 */
async function listAffectedTenants() {
  const candidates = await db.queryRows(
    `SELECT id, display_name FROM tenants WHERE enabled = TRUE ORDER BY display_name`
  );
  const out = [];
  for (const t of candidates) {
    if (await tenantMode.shouldProcessTenant(t.id)) out.push(t);
  }
  return out;
}

/** Build the monitored-control catalog Haiku correlates against. */
function buildControlCatalog() {
  return registry.SETTINGS.map(s => ({
    setting_id: s.setting_id,
    name: s.name,
    description: s.description,
  }));
}

/** Pull every Message Center message from the source tenant (paginated). */
async function pullMessages(azureTenantId) {
  const all = [];
  let endpoint = '/admin/serviceAnnouncement/messages';
  let pages = 0;
  while (endpoint && pages < MAX_PAGES) {
    const data = await graph.callGraph(azureTenantId, endpoint, { version: 'v1.0', method: 'GET' });
    if (data && Array.isArray(data.value)) all.push(...data.value);
    endpoint = data?.['@odata.nextLink'] || null;
    pages++;
  }
  if (pages >= MAX_PAGES) {
    console.warn(`[MessageCenter] Hit ${MAX_PAGES}-page cap pulling messages — feed may be truncated`);
  }
  return all;
}

/** Downgrade-only severity: Haiku may lower the 'low' baseline, never raise it. */
function applyDowngradeOnly(baseline, proposed) {
  if (!proposed || !SEVERITY_RANK[proposed]) return baseline;
  return SEVERITY_RANK[proposed] < SEVERITY_RANK[baseline] ? proposed : baseline;
}

/**
 * Raise one MSP-level alert for a relevant message. Inserts via the normal
 * alert plumbing (createOrUpdateAlert → dedup), flips it to alert_scope='msp'
 * with the purpose-built 3-locale Haiku analysis, then sends the notification
 * directly.
 *
 * NOTE: we deliberately do NOT route through alertEngine.processNewAlert here.
 * That helper re-runs the generic per-alert Haiku analyzer, which would spend
 * a second Haiku call and OVERWRITE the Message-Center-specific 3-locale
 * explanation we already produced. We reuse the same notifier the normal path
 * uses, just without the redundant re-analysis.
 *
 * @param {boolean} [suppressEmail] - when true, create the dashboard alert but
 *   skip the email/notification. Used on the FIRST run for a source tenant so
 *   the entire historical Message Center backlog lands in the dashboard for
 *   awareness without flooding the operator's inbox. Steady-state runs email
 *   normally (subject to the policy's notification_target).
 */
async function raiseAlert(sourceTenant, policy, msg, correlation, affectedTenants, suppressEmail = false) {
  const affectedTenantIds = affectedTenants.map(t => t.id);
  const affectedTenantNames = affectedTenants.map(t => t.display_name);
  const baseSeverity = policy.severity || 'low';
  const effectiveSeverity = applyDowngradeOnly(baseSeverity, correlation.proposed_severity);

  const actionRequiredBy = msg.actionRequiredByDateTime
    ? String(msg.actionRequiredByDateTime).substring(0, 10) // YYYY-MM-DD
    : '';

  const webUrl = store.messageWebUrl(msg.id);
  const rawData = {
    kind: 'message_center',
    mc_id: msg.id,
    ms_web_url: webUrl,
    learn_more_url: webUrl,
    affectedTenantIds,
    affectedTenantNames,
    affectedAreas: correlation.affected_control_names || [],
    // Phase 9b structured template for display-time localization.
    message_template_key: 'alerts.message_format.ms_change',
    message_template_params: {
      msTitle: msg.title || '(untitled)',
      actionRequiredBy,
      affectedCount: affectedTenantIds.length,
      affectedTenants: affectedTenantNames.join(', '),
    },
  };

  const alertData = {
    severity: effectiveSeverity,
    message: `Microsoft change — ${msg.title || '(untitled)'}`,
    raw_data: rawData,
    dedup_key: `mc:${msg.id}`,
  };

  const alert = await alertEngine.createOrUpdateAlert(sourceTenant, policy, alertData);
  if (!alert || !alert.isNew) {
    // Already an open alert for this message (belt-and-suspenders — mc-item
    // dedup normally prevents reaching here twice). Nothing more to do.
    return null;
  }

  // Flip to MSP scope + store the purpose-built 3-locale analysis and the
  // rule (baseline) severity for the severity-history column.
  await db.execute(
    `UPDATE alerts
        SET alert_scope = 'msp',
            rule_severity = ?,
            ai_severity_reason = ?,
            ai_analysis_en = ?, ai_analysis_fr = ?, ai_analysis_es = ?
      WHERE id = ?`,
    [
      baseSeverity,
      correlation.severity_reason || null,
      correlation.en, correlation.fr, correlation.es,
      alert.id,
    ]
  );

  // Enrich the in-memory alert object for the notifier (msp branch reads
  // alert_scope + raw_data.affectedTenantNames; the AI section reads
  // ai_analysis_*).
  alert.alert_scope = 'msp';
  alert.ai_analysis_en = correlation.en;
  alert.ai_analysis_fr = correlation.fr;
  alert.ai_analysis_es = correlation.es;

  // First-run backlog: alert lands in the dashboard, but we don't email it.
  // Without this, enabling the feature for the first time would email the
  // operator the entire historical Message Center (dozens of posts at once).
  if (suppressEmail) {
    console.log(`[MessageCenter] First-run backlog — alert ${alert.id} created, email suppressed`);
    return alert;
  }

  try {
    await notifier.sendAlertNotification(alert, sourceTenant);
  } catch (e) {
    console.error(`[MessageCenter] Notification failed for alert ${alert.id}: ${e.message}`);
  }

  return alert;
}

/**
 * Run one full cycle. Idempotent w.r.t. already-seen messages (mc-item dedup).
 * Exposed for tests and for a manual operator "run now" trigger.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - ignore the 24h watermark (manual trigger).
 */
async function runOnce(opts = {}) {
  if (cycleInProgress) {
    const ageMs = guardSetAt ? Date.now() - guardSetAt : 0;
    if (ageMs > MAX_CYCLE_RUNTIME_MS) {
      console.error(`[Watchdog] [MessageCenter] previous cycle still flagged in-progress after ${Math.round(ageMs / 60000)} min (max ${MAX_CYCLE_RUNTIME_MS / 60000}) — abandoning it and starting a fresh cycle`);
    } else {
      console.log('[MessageCenter] Skipping cycle — previous run still in progress');
      return { skipped: 'in_progress' };
    }
  }

  const guid = (config.messageCenter && config.messageCenter.sourceTenant) || '';
  if (!guid) {
    return { skipped: 'disabled' }; // feature off — default None
  }

  // 24h gate (unless forced). Loop wakes hourly; act only when due. The
  // watermark is global (only one source tenant is active at a time).
  let lastRun = null;
  try {
    lastRun = await store.getLastRunAt();
  } catch (e) {
    console.warn(`[MessageCenter] last-run lookup failed (proceeding): ${e.message}`);
  }
  if (!opts.force && lastRun && (Date.now() - lastRun.getTime()) < RUN_INTERVAL_MS) {
    return { skipped: 'not_due', lastRun };
  }

  cycleInProgress = true;
  guardSetAt = Date.now();
  workerHeartbeat.stampStart('message_center');
  // firstRun is decided per source tenant below (after we resolve it), once we
  // know whether any items already exist for that tenant.
  const summary = { source: guid, firstRun: false, pulled: 0, newItems: 0, filtered: 0, correlated: 0, alerted: 0, emailsSuppressed: 0, errors: 0 };
  const cycleStart = Date.now();

  try {
    await store.ensureSchema();

    const sourceTenant = await resolveSourceTenant(guid);
    if (!sourceTenant) {
      console.warn(`[MessageCenter] Source tenant ${guid} not found — feature configured but tenant missing. No-op.`);
      await store.setLastRunNow();
      workerHeartbeat.stampSuccess('message_center', Date.now() - cycleStart);
      return { ...summary, skipped: 'source_missing' };
    }
    if (!sourceTenant.enabled) {
      console.warn(`[MessageCenter] Source tenant "${sourceTenant.display_name}" is disabled — no-op this cycle.`);
      await store.setLastRunNow();
      workerHeartbeat.stampSuccess('message_center', Date.now() - cycleStart);
      return { ...summary, skipped: 'source_disabled' };
    }

    const policy = await store.ensurePolicy();
    const catalog = buildControlCatalog();

    // First run FOR THIS SOURCE TENANT? Decided before we insert anything, by
    // checking whether any items already exist for this tenant. On first run
    // the historical backlog is created in the dashboard but NOT emailed —
    // otherwise enabling the feed (or switching the source tenant) would email
    // the operator dozens of past announcements at once.
    const isFirstRun = !(await store.hasItemsForTenant(sourceTenant.tenant_id));
    summary.firstRun = isFirstRun;
    if (isFirstRun) {
      console.log(`[MessageCenter] First run for source tenant "${sourceTenant.display_name}" — historical backlog will be created without email`);
    }

    let messages;
    try {
      messages = await pullMessages(sourceTenant.tenant_id);
    } catch (e) {
      console.error(`[MessageCenter] Graph pull failed for "${sourceTenant.display_name}": ${e.message}`);
      // Do NOT stamp last-run — let the next hourly wake retry today.
      workerHeartbeat.stampError('message_center', e.message);
      return { ...summary, error: e.message };
    }
    summary.pulled = messages.length;

    // Dedup-insert; collect only the newly-seen messages.
    const fresh = [];
    for (const msg of messages) {
      if (!msg || !msg.id) continue;
      try {
        const isNew = await store.insertIfNew(sourceTenant.tenant_id, msg);
        if (isNew) fresh.push(msg);
      } catch (e) {
        summary.errors++;
        console.warn(`[MessageCenter] insert failed for ${msg.id}: ${e.message}`);
      }
    }
    summary.newItems = fresh.length;

    // Resolve the affected-tenant join ONCE per cycle (same for every message).
    const affectedTenants = await listAffectedTenants();

    for (const msg of fresh) {
      try {
        // Cheap prefilter — only planForChange / preventOrFixIssue reach Haiku.
        if (!RELEVANT_CATEGORIES.has(msg.category)) {
          await store.markProcessedNotRelevant(msg.id, sourceTenant.tenant_id);
          summary.filtered++;
          continue;
        }

        const correlation = await aiAnalysis.analyzeMessageCenterItem(msg, catalog);
        if (!correlation) {
          // API/parse failure — leave unprocessed so the next run retries it.
          summary.errors++;
          continue;
        }
        summary.correlated++;

        if (!correlation.affects_monitored_control) {
          await store.markProcessedNotRelevant(msg.id, sourceTenant.tenant_id, correlation);
          continue;
        }

        if (affectedTenants.length === 0) {
          // Relevant but no eligible tenants to notify about — record outcome,
          // don't raise an empty alert.
          await store.markProcessedNotRelevant(msg.id, sourceTenant.tenant_id, correlation);
          console.log(`[MessageCenter] ${msg.id} relevant but no enabled non-audit-only tenants — no alert raised`);
          continue;
        }

        const alert = await raiseAlert(sourceTenant, policy, msg, correlation, affectedTenants, isFirstRun);
        if (alert) {
          await store.markAlerted(msg.id, sourceTenant.tenant_id, {
            alertId: alert.id,
            affectedAreas: correlation.affected_control_names || [],
            affectedTenantIds: affectedTenants.map(t => t.id),
            analysis: { en: correlation.en, fr: correlation.fr, es: correlation.es },
          });
          summary.alerted++;
          if (isFirstRun) summary.emailsSuppressed++;
          console.log(`[MessageCenter] Raised MSP alert ${alert.id} for ${msg.id} — "${msg.title}" (${affectedTenants.length} tenants)`);
        } else {
          // Dedup hit at alert layer — still mark the item processed so we
          // don't re-correlate it next run.
          await store.markProcessedNotRelevant(msg.id, sourceTenant.tenant_id, correlation);
        }
      } catch (e) {
        summary.errors++;
        console.error(`[MessageCenter] Processing ${msg.id} failed: ${e.message}`);
      }
    }

    await store.setLastRunNow();
  } catch (err) {
    workerHeartbeat.stampError('message_center', err.message);
    throw err;
  } finally {
    cycleInProgress = false;
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  const firstRunNote = summary.firstRun
    ? ` (first run — ${summary.emailsSuppressed} backlog alert(s) created without email)`
    : '';
  console.log(`[MessageCenter] Cycle complete in ${elapsed}s — pulled ${summary.pulled}, new ${summary.newItems}, filtered ${summary.filtered}, correlated ${summary.correlated}, alerted ${summary.alerted}, errors ${summary.errors}${firstRunNote}`);
  workerHeartbeat.stampSuccess('message_center', Date.now() - cycleStart);
  return summary;
}

/** Start the hourly loop. Idempotent. */
function start() {
  if (loopHandle) {
    console.warn('[MessageCenter] start() called twice — ignoring duplicate');
    return;
  }
  console.log(`[MessageCenter] Starting worker — wake every ${WAKE_INTERVAL_MS / 1000}s, act every 24h`);
  setTimeout(() => {
    runOnce().catch(err => console.error('[MessageCenter] Initial cycle failed:', err.message));
    loopHandle = setInterval(() => {
      runOnce().catch(err => console.error('[MessageCenter] Cycle failed:', err.message));
    }, WAKE_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
}

function stop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
    console.log('[MessageCenter] Worker stopped');
  }
}

module.exports = {
  start,
  stop,
  runOnce,
  // Exposed for tests / manual operator triggers
  _resolveSourceTenant: resolveSourceTenant,
  _listAffectedTenants: listAffectedTenants,
  _buildControlCatalog: buildControlCatalog,
  _applyDowngradeOnly: applyDowngradeOnly,
};
