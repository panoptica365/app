/**
 * Panoptica365 — Known-Good Apps drift worker (Feature 8.9 §9)
 *
 * The slow backstop that keeps "all green" honest. Runs once per ~24h per
 * managed tenant (NEVER in the 15-minute poll cycle), re-collects the
 * enterprise-app + app-registration permission sets, and compares each blessed
 * app against its baseline. A blessed app that gained permissions beyond
 * baseline (a superset) breaks out of known-good and fires a one-shot
 * `known_good_app_drift` alert. New apps are handled by the real-time UAL
 * consent alert — this loop is the backstop, not the primary detector.
 *
 * refreshTenant() is shared with the on-demand Refresh button (api-applications)
 * so the button and the loop run identical collection + drift logic. It also
 * rebuilds the inventory snapshot cache the Applications tab reads from.
 *
 * Conventions mirror src/ual-worker.js: start()/stop(), deferred first run,
 * audit-only tenants excluded (shouldProcessTenant), unref'd timer.
 */

'use strict';

const db = require('./db/database');
const collector = require('./lib/enterprise-apps-graph');
const store = require('./lib/known-good-store');
const tenantMode = require('./lib/tenant-mode');
const alertEngine = require('./alert-engine');
const workerHeartbeat = require('./worker-heartbeat');

const LOOP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const FIRST_RUN_DELAY_MS = 90 * 1000;         // let boot work settle

let loopHandle = null;
let cycleInProgress = false;
// Stuck-cycle watchdog (Reliability P0, 2026-06-12): if the guard is older
// than this, the previous cycle's `finally` never ran (hung await) — clear it
// and proceed on this tick rather than skipping for the rest of the process.
let guardSetAt = 0;
const MAX_CYCLE_RUNTIME_MS = 30 * 60 * 1000;

/**
 * Re-collect + drift-check ONE tenant, rebuild its inventory snapshot.
 * @param {object} tenant  { id, tenant_id, display_name, ... }
 * @param {object} opts    { fireAlerts=true }
 * @returns {object} summary { total, blessed, drifted, driftedNow }
 */
async function refreshTenant(tenant, opts = {}) {
  const fireAlerts = opts.fireAlerts !== false;
  await store.ensureSchema();

  const { apps } = await collector.collectApps(tenant.tenant_id);
  const baselines = await store.getBaselines(tenant.id);
  const prevInv = await store.readInventory(tenant.id);
  const prevSonnet = new Map(); // `${kind}:${appId}` → {verdict,reasons,evaluated_at}
  if (prevInv && Array.isArray(prevInv.apps)) {
    for (const a of prevInv.apps) {
      if (a && a.sonnet) prevSonnet.set(`${a.kind}:${a.appId}`, a.sonnet);
    }
  }

  let blessed = 0;
  let drifted = 0;
  let driftedNow = 0;
  const invApps = [];

  for (const app of apps) {
    const key = `${app.kind}:${app.appId}`;
    const signature = store.appSignature(app);
    const baseline = baselines.get(key);

    let driftState = null;
    let sonnet = prevSonnet.get(key) || null;

    if (baseline) {
      blessed += 1;
      const isDrift = store.isDrifted(baseline.baseline_perms || [], signature);
      // Blessed apps carry their own persisted Sonnet verdict.
      if (baseline.sonnet_verdict) {
        sonnet = {
          verdict: baseline.sonnet_verdict,
          reasons: baseline.sonnet_rationale || {},
          evaluated_at: baseline.sonnet_evaluated_at || null,
        };
      }
      if (isDrift) {
        drifted += 1;
        driftState = 'drifted';
        const wasClean = baseline.drift_state === 'clean';
        if (wasClean) {
          await store.setDriftState(tenant.id, app.appId, app.kind, 'drifted');
          driftedNow += 1;
          if (fireAlerts) {
            await fireDriftAlert(tenant, app, baseline, signature);
          }
        }
      } else {
        driftState = 'clean';
        // Permissions reverted to (or below) baseline — clear a stale drift flag.
        if (baseline.drift_state === 'drifted') {
          await store.setDriftState(tenant.id, app.appId, app.kind, 'clean');
        }
      }
    }

    invApps.push({
      ...app,
      signature,
      blessed: !!baseline,
      approved_at: baseline ? baseline.approved_at : null,
      approved_by: baseline ? baseline.approved_by : null,
      drift_state: driftState,
      sonnet,
    });
  }

  await store.writeInventory(tenant.id, {
    generated_at: store.toMysqlDatetime(new Date()),
    total: invApps.length,
    apps: invApps,
  });

  return { total: invApps.length, blessed, drifted, driftedNow };
}

/** Fire the one-shot known_good_app_drift alert for a newly-drifted app. */
async function fireDriftAlert(tenant, app, baseline, signature) {
  const policy = await store.getDriftPolicy();
  if (!policy || !policy.enabled) return;

  const { added } = store.diffSignatures(baseline.baseline_perms || [], signature);
  const addedHuman = added.map(humanizeToken);
  const message =
    `Known-good app "${app.displayName || app.appId}" gained ${added.length} permission(s) beyond baseline: ${addedHuman.join(', ')}`;

  const alertData = {
    dedup_key: `known_good_app_drift:${app.appId}`,
    severity: policy.severity || 'high',
    message,
    raw_data: {
      appId: app.appId,
      appName: app.displayName || app.appId,
      appKind: app.kind,
      objectId: app.objectId || null,
      added: addedHuman,
      approved_at: baseline.approved_at || null,
      approved_by: baseline.approved_by || null,
      // Deep-link so the alert slideout can jump to the app's row.
      deepLink: { view: 'tenant-dashboard', tenantId: tenant.id, tab: 'applications', appId: app.appId },
    },
  };

  try {
    const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
    if (result && result.isNew && !result.isAutoResolved) {
      alertEngine.processNewAlert(result, tenant).catch(e =>
        console.error(`[KnownGood] processNewAlert failed for alert ${result.id}: ${e.message}`));
    }
  } catch (err) {
    console.error(`[KnownGood] drift alert insert failed (tenant ${tenant.id}, app ${app.appId}): ${err.message}`);
  }
}

/** Turn a signature token (del|res|scope) into a readable "Scope (resource)". */
function humanizeToken(token) {
  const parts = String(token).split('|');
  const kind = parts[0];
  const value = parts[parts.length - 1];
  if (kind === 'cred') return `credential ${value}`;
  if (kind === 'uri') return `redirect URI ${value}`;
  return value;
}

// ──────────────────────────────────────────────────────────────────────
// Daily loop
// ──────────────────────────────────────────────────────────────────────

async function runOnce() {
  if (cycleInProgress) {
    const ageMs = guardSetAt ? Date.now() - guardSetAt : 0;
    if (ageMs > MAX_CYCLE_RUNTIME_MS) {
      console.error(`[Watchdog] [KnownGood] previous cycle still flagged in-progress after ${Math.round(ageMs / 60000)} min (max ${MAX_CYCLE_RUNTIME_MS / 60000}) — abandoning it and starting a fresh cycle`);
    } else {
      console.log('[KnownGood] Skipping cycle — previous run still in progress');
      return { skipped: true };
    }
  }
  cycleInProgress = true;
  guardSetAt = Date.now();
  const start = Date.now();
  workerHeartbeat.stampStart('known_good');
  let processed = 0;
  let driftedTotal = 0;

  try {
    await store.ensureSchema();
    const candidates = await db.queryRows(
      `SELECT id, tenant_id, display_name, psa_name FROM tenants WHERE enabled = TRUE ORDER BY id`
    );
    for (const tenant of candidates) {
      // Audit-only tenants are excluded from the scheduled loop (spec §9.2).
      if (!await tenantMode.shouldProcessTenant(tenant.id)) continue;
      try {
        const r = await refreshTenant(tenant, { fireAlerts: true });
        processed += 1;
        driftedTotal += r.driftedNow;
      } catch (err) {
        console.error(`[KnownGood] refresh failed for tenant ${tenant.id} (${tenant.display_name}): ${err.message}`);
      }
    }
  } catch (err) {
    workerHeartbeat.stampError('known_good', err.message);
    throw err;
  } finally {
    cycleInProgress = false;
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[KnownGood] Daily cycle complete in ${secs}s — ${processed} tenant(s), ${driftedTotal} new drift event(s)`);
  workerHeartbeat.stampSuccess('known_good', Date.now() - start);
  return { processed, driftedTotal };
}

function start() {
  if (loopHandle) {
    console.warn('[KnownGood] start called twice — ignoring');
    return;
  }
  console.log(`[KnownGood] Starting daily drift loop (interval ${LOOP_INTERVAL_MS / 3600000}h)`);
  const first = setTimeout(() => {
    runOnce().catch(err => console.error('[KnownGood] Initial cycle failed:', err.message));
    loopHandle = setInterval(() => {
      runOnce().catch(err => console.error('[KnownGood] Cycle failed:', err.message));
    }, LOOP_INTERVAL_MS);
    if (loopHandle.unref) loopHandle.unref();
  }, FIRST_RUN_DELAY_MS);
  if (first.unref) first.unref();
}

function stop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
    console.log('[KnownGood] Daily drift loop stopped');
  }
}

module.exports = { refreshTenant, runOnce, start, stop };
