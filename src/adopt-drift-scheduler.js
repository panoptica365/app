/**
 * Panoptica — Adopt-in-Place Drift Scheduler
 *
 * Hourly drift reconcile for tenant-sourced (adopted) CA + Intune cards. Moved
 * off the daily known-good worker (2026-06-28) so a weakening change to an
 * adopted policy alerts within the hour — matching deployed-template drift
 * (CA at :00, Intune at :30) rather than within a day.
 *
 * Runs at :15, offset from both deployed-drift schedulers to avoid a load
 * collision. Below security ingestion by construction: tenants processed
 * serially, Graph reads ride the same graph-layer throttle/back-off the
 * deployed schedulers use, audit-only tenants excluded via shouldProcessTenant.
 * Reuses the existing per-surface reconcile (adopt-store.computeDrift + the
 * surface drift-alert path) verbatim — no new diff logic, no store merge.
 */

'use strict';

const cron = require('node-cron');
const db = require('./db/database');
const tenantMode = require('./lib/tenant-mode');
const adoptService = require('./lib/adopt-service');
const workerHeartbeat = require('./worker-heartbeat');

let job = null;
let firstRunTimer = null;
let cycleInProgress = false;
// Stuck-cycle watchdog (mirrors known-good-worker): if the guard is older than
// this the previous cycle's finally never ran (hung await) — proceed anyway.
let guardSetAt = 0;
const MAX_CYCLE_RUNTIME_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 120 * 1000; // let boot work settle before first sweep

/**
 * One hourly sweep: reconcile adopted CA + Intune cards for every enabled,
 * non-audit-only tenant. reconcileTenant already isolates each surface in its
 * own try/catch, so a CA failure never blocks Intune (and vice versa).
 */
async function runOnce() {
  if (cycleInProgress) {
    if (Date.now() - guardSetAt < MAX_CYCLE_RUNTIME_MS) {
      console.warn('[AdoptDrift] previous cycle still running — skipping this tick');
      return { skipped: true };
    }
    console.warn('[AdoptDrift] stuck-cycle guard expired — proceeding');
  }
  cycleInProgress = true;
  guardSetAt = Date.now();
  const start = Date.now();
  workerHeartbeat.stampStart('adopt_drift');
  let processed = 0;
  let driftedTotal = 0;

  try {
    const tenants = await db.queryRows(
      `SELECT id, tenant_id, display_name, psa_name FROM tenants WHERE enabled = TRUE ORDER BY id`
    );
    for (const tenant of tenants) {
      // Audit-only tenants stay excluded (same gate as the daily loop).
      if (!await tenantMode.shouldProcessTenant(tenant.id)) continue;
      try {
        const out = await adoptService.reconcileTenant(tenant, { fireAlerts: true });
        processed += 1;
        for (const s of Object.values(out)) {
          if (s && typeof s.drifted === 'number') driftedTotal += s.drifted;
        }
      } catch (err) {
        console.error(`[AdoptDrift] reconcile failed for tenant ${tenant.id} (${tenant.display_name}): ${err.message}`);
      }
    }
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[AdoptDrift] Hourly cycle complete in ${secs}s — ${processed} tenant(s), ${driftedTotal} new drift event(s)`);
    workerHeartbeat.stampSuccess('adopt_drift', Date.now() - start);
    return { processed, driftedTotal };
  } catch (err) {
    workerHeartbeat.stampError('adopt_drift', err.message || String(err));
    throw err;
  } finally {
    cycleInProgress = false;
  }
}

function start() {
  if (job) {
    console.warn('[AdoptDrift] start called twice — ignoring');
    return;
  }
  // Every hour at :15 — offset from deployed CA drift (:00) and Intune (:30).
  job = cron.schedule('15 * * * *', () => {
    runOnce().catch(err => console.error('[AdoptDrift] Cycle failed:', err.message));
  });
  console.log('[AdoptDrift] Started — adopted CA+Intune drift hourly at :15');

  // First sweep shortly after boot so adopted drift is current without waiting
  // for the next :15. unref'd so it never holds the process open.
  firstRunTimer = setTimeout(() => {
    runOnce().catch(err => console.error('[AdoptDrift] Initial cycle failed:', err.message));
  }, FIRST_RUN_DELAY_MS);
  if (firstRunTimer.unref) firstRunTimer.unref();
}

function stop() {
  if (job) {
    job.stop();
    job = null;
  }
  if (firstRunTimer) {
    clearTimeout(firstRunTimer);
    firstRunTimer = null;
  }
  console.log('[AdoptDrift] Stopped');
}

module.exports = { runOnce, start, stop };
