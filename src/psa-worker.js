/**
 * Panoptica365 — PSA worker (Feature 8.3)
 *
 * Follows the ual-worker.js conventions: start()/stop(), started from server.js
 * after the DB is ready, wired into SIGINT/SIGTERM shutdown. The loop wakes
 * every minute and acts only when PSA_POLL_INTERVAL_MIN has elapsed since the
 * last action — so a settings change to the interval takes effect on the next
 * tick without a restart.
 *
 * Each action cycle:
 *   1. Retry pass — error-state link rows (retry_count < MAX) whose backoff
 *      window (2^retry_count minutes) has elapsed → re-attempt the failed op.
 *   2. Poll pass  — batch-query all open linked tickets; close-status tickets
 *      auto-resolve their open alerts; missing tickets close out too.
 *
 * The worker no-ops entirely unless PSA is configured (provider selected +
 * credentials present). All business logic lives in psa/index.js — this file
 * is timing + orchestration only.
 */

const config = require('../config/default');
const psa = require('./psa');
const store = require('./psa/store');

const TICK_MS = 60 * 1000;       // wake every minute
const MAX_RETRIES = 10;          // matches store default + spec §5.3

let tickHandle = null;
let cycleInProgress = false;
let lastActionMs = 0;

/** Has the configured poll interval elapsed since the last action cycle? */
function intervalElapsed() {
  const minutes = (config.psa && config.psa.pollIntervalMin) || 10;
  return Date.now() - lastActionMs >= minutes * 60 * 1000;
}

/** Backoff gate: only retry once 2^retry_count minutes have passed. */
function retryWindowElapsed(linkRow) {
  const last = linkRow.last_synced_at ? new Date(linkRow.last_synced_at + 'Z').getTime() : 0;
  if (!last) return true; // never attempted on a timer — eligible now
  const waitMs = Math.pow(2, linkRow.retry_count || 0) * 60 * 1000;
  return Date.now() - last >= waitMs;
}

async function runOnce() {
  if (cycleInProgress) return { skipped: 'in_progress' };
  if (!psa.isConfigured()) return { skipped: 'not_configured' };
  cycleInProgress = true;
  const summary = { retried: 0, retryCleared: 0, polled: 0, closed: 0 };

  try {
    // ─── Retry pass ───
    let retryable = [];
    try {
      retryable = await store.getRetryableLinks(MAX_RETRIES);
    } catch (err) {
      console.error(`[PsaWorker] getRetryableLinks failed: ${err.message}`);
    }
    for (const row of retryable) {
      if (!retryWindowElapsed(row)) continue;
      summary.retried += 1;
      try {
        const ok = await psa.retryErroredLink(row);
        if (ok) summary.retryCleared += 1;
      } catch (err) {
        console.error(`[PsaWorker] retry failed for link ${row.id}: ${err.message}`);
      }
    }

    // ─── Poll pass ───
    try {
      const r = await psa.pollLinkedTickets();
      summary.polled = r.polled;
      summary.closed = r.closed;
    } catch (err) {
      console.error(`[PsaWorker] poll failed: ${err.message}`);
    }
  } finally {
    cycleInProgress = false;
  }

  if (summary.retried || summary.closed) {
    console.log(`[PsaWorker] Cycle — retried ${summary.retried} (cleared ${summary.retryCleared}), polled ${summary.polled} tickets, closed ${summary.closed} alert(s)`);
  }
  return summary;
}

function start() {
  if (tickHandle) {
    console.warn('[PsaWorker] start called twice — ignoring duplicate');
    return;
  }
  console.log(`[PsaWorker] Starting — tick ${TICK_MS / 1000}s, acts every PSA_POLL_INTERVAL_MIN`);
  // Defer the first tick by 45s so we don't pile onto startup work. The first
  // action runs on that first tick (lastActionMs starts at 0 → interval elapsed).
  setTimeout(() => {
    tick();
    tickHandle = setInterval(tick, TICK_MS);
  }, 45 * 1000);
}

function tick() {
  if (!psa.isConfigured()) return;        // off by default — cheap no-op
  if (!intervalElapsed()) return;
  lastActionMs = Date.now();
  runOnce().catch(err => console.error('[PsaWorker] Cycle error:', err.message));
}

function stop() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
    console.log('[PsaWorker] Stopped');
  }
}

module.exports = {
  start,
  stop,
  runOnce, // exposed for an admin "poll now" trigger / tests
};
