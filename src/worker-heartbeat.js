/**
 * Panoptica — Generalized Worker Heartbeat Registry (Reliability P0, 2026-06-12)
 *
 * One row per background loop in `worker_heartbeats` — a REGISTRY, not
 * history (drift_scheduler_runs keeps per-run history for the CA/Intune
 * schedulers; those two stamp BOTH). Before this module, only 2 of ~12 loops
 * had any liveness signal: if the UAL worker (25 of the 45 alert types) died,
 * most of the detection surface went dark with no indication anywhere.
 *
 * Modeled on drift-scheduler-heartbeat.js: every write is best-effort and
 * swallows its own errors with one stderr line — a heartbeat failure must
 * never break the worker cycle it instruments.
 *
 * Usage in a worker's cycle function:
 *
 *   const workerHeartbeat = require('./worker-heartbeat');
 *   workerHeartbeat.stampStart('ual');               // fire-and-forget OK
 *   try {
 *     ... cycle ...
 *     workerHeartbeat.stampSuccess('ual', Date.now() - t0);
 *   } catch (err) {
 *     workerHeartbeat.stampError('ual', err.message);
 *     throw err;
 *   }
 *
 * Consumed by the `worker_liveness` check in src/routes/api-health.js, which
 * applies per-worker staleness thresholds and reports workers that are
 * configured off (PSA without a provider, Message Center without a source
 * tenant) as "idle by configuration", not stale.
 */

'use strict';

const db = require('./db/database');

// Known worker names (VARCHAR(40) PK). Not enforced as an ENUM on purpose —
// adding a worker must never require an ALTER — but stamps from unlisted
// names log a warning so a typo can't silently create a ghost row.
const KNOWN_WORKERS = new Set([
  'polling',
  'ual',
  'psa',
  'known_good',
  'email_auth',
  'message_center',
  'morning_briefing',
  'audit_expiry',
  'security_apply',
  'license_refresh',
  'update_checker',
  'retention',
  'ca_drift',
  'intune_drift',
]);

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS worker_heartbeats (
          worker VARCHAR(40) PRIMARY KEY,
          last_start DATETIME(3) DEFAULT NULL,
          last_success DATETIME(3) DEFAULT NULL,
          last_error DATETIME(3) DEFAULT NULL,
          last_error_message VARCHAR(500) DEFAULT NULL,
          consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
          last_duration_ms INT UNSIGNED DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[WorkerHeartbeat] Ensured worker_heartbeats table exists');
    } catch (e) {
      console.error('[WorkerHeartbeat] Schema ensure failed:', e.message);
    }
  })();
  return schemaReady;
}

function checkName(worker) {
  if (!KNOWN_WORKERS.has(worker)) {
    console.warn(`[WorkerHeartbeat] stamp for unregistered worker name '${worker}' — typo, or add it to KNOWN_WORKERS`);
  }
}

/** Stamp the start of a cycle. Best-effort, never throws. */
async function stampStart(worker) {
  checkName(worker);
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO worker_heartbeats (worker, last_start)
       VALUES (?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE last_start = UTC_TIMESTAMP(3)`,
      [worker]
    );
  } catch (e) {
    console.error(`[WorkerHeartbeat] stampStart('${worker}') failed:`, e.message);
  }
}

/** Stamp a successful cycle end; resets consecutive_failures. Never throws. */
async function stampSuccess(worker, durationMs) {
  checkName(worker);
  const dur = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null;
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO worker_heartbeats (worker, last_success, last_duration_ms, consecutive_failures)
       VALUES (?, UTC_TIMESTAMP(3), ?, 0)
       ON DUPLICATE KEY UPDATE
         last_success = UTC_TIMESTAMP(3),
         last_duration_ms = VALUES(last_duration_ms),
         consecutive_failures = 0`,
      [worker, dur]
    );
  } catch (e) {
    console.error(`[WorkerHeartbeat] stampSuccess('${worker}') failed:`, e.message);
  }
}

/** Stamp a failed cycle; increments consecutive_failures. Never throws. */
async function stampError(worker, message) {
  checkName(worker);
  const msg = message ? String(message).slice(0, 500) : null;
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO worker_heartbeats (worker, last_error, last_error_message, consecutive_failures)
       VALUES (?, UTC_TIMESTAMP(3), ?, 1)
       ON DUPLICATE KEY UPDATE
         last_error = UTC_TIMESTAMP(3),
         last_error_message = VALUES(last_error_message),
         consecutive_failures = consecutive_failures + 1`,
      [worker, msg]
    );
  } catch (e) {
    console.error(`[WorkerHeartbeat] stampError('${worker}') failed:`, e.message);
  }
}

/**
 * Health-check helper: all registry rows with seconds-since computed in SQL
 * (UTC vs UTC — no session-timezone trap). Returns a Map keyed by worker.
 */
async function getAllHeartbeats() {
  try {
    await ensureSchema();
    const rows = await db.queryRows(
      `SELECT worker, last_start, last_success, last_error, last_error_message,
              consecutive_failures, last_duration_ms,
              TIMESTAMPDIFF(SECOND, last_success, UTC_TIMESTAMP(3)) AS seconds_since_success,
              TIMESTAMPDIFF(SECOND, last_start,   UTC_TIMESTAMP(3)) AS seconds_since_start
         FROM worker_heartbeats`
    );
    const out = new Map();
    for (const r of rows) out.set(r.worker, r);
    return out;
  } catch (e) {
    console.error('[WorkerHeartbeat] getAllHeartbeats failed:', e.message);
    return new Map();
  }
}

module.exports = {
  ensureSchema,
  stampStart,
  stampSuccess,
  stampError,
  getAllHeartbeats,
  KNOWN_WORKERS,
};
