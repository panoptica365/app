/**
 * Panoptica — Drift Scheduler Heartbeat
 *
 * Records every cycle of the CA + Intune drift schedulers as a row in
 * `drift_scheduler_runs`. Replaces the indirect inference where /api/health
 * tried to deduce scheduler liveness from `api_health` rows that schedulers
 * happened to leave behind. Direct heartbeat = direct health signal.
 *
 * Usage in scheduler module:
 *
 *   const heartbeat = require('./drift-scheduler-heartbeat');
 *   await heartbeat.ensureSchema();           // once at boot
 *   const runId = await heartbeat.recordStart('ca');
 *   try {
 *     const summary = await runDriftChecks();
 *     await heartbeat.recordEnd(runId, summary);  // {total, drifted, remediated, errors}
 *   } catch (err) {
 *     await heartbeat.recordEnd(runId, null, err.message);
 *   }
 *
 * Failure of recordStart/recordEnd never blocks the actual drift cycle —
 * heartbeat writes are best-effort, errors logged loudly to stderr.
 */

const db = require('./db/database');

const VALID_SCHEDULERS = new Set(['ca', 'intune']);
let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS drift_scheduler_runs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          scheduler ENUM('ca','intune') NOT NULL,
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME DEFAULT NULL,
          total_checks INT UNSIGNED DEFAULT NULL,
          drifted INT UNSIGNED DEFAULT NULL,
          remediated INT UNSIGNED DEFAULT NULL,
          errors INT UNSIGNED DEFAULT NULL,
          error_message TEXT DEFAULT NULL,
          INDEX idx_scheduler_started (scheduler, started_at),
          INDEX idx_scheduler_ended   (scheduler, ended_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[DriftHeartbeat] Ensured drift_scheduler_runs table exists');
    } catch (e) {
      console.error('[DriftHeartbeat] Schema ensure failed:', e.message);
    }
  })();
  return schemaReady;
}

/**
 * Insert a row marking the start of a drift cycle. Returns the new row's id
 * so recordEnd can target it. Returns null on DB error (caller must tolerate
 * — heartbeat must never break the drift cycle itself).
 */
async function recordStart(scheduler) {
  if (!VALID_SCHEDULERS.has(scheduler)) {
    console.error(`[DriftHeartbeat] recordStart: invalid scheduler='${scheduler}'`);
    return null;
  }
  try {
    await ensureSchema();
    const id = await db.insert(
      'INSERT INTO drift_scheduler_runs (scheduler, started_at) VALUES (?, NOW())',
      [scheduler]
    );
    return id;
  } catch (e) {
    console.error(`[DriftHeartbeat] recordStart('${scheduler}') failed:`, e.message);
    return null;
  }
}

/**
 * Mark a previously-started cycle as complete. `summary` is an optional
 * object with totals (total/drifted/remediated/errors). `errorMessage` is
 * non-null only when the cycle threw.
 */
async function recordEnd(runId, summary, errorMessage) {
  if (!runId) return;
  try {
    await db.execute(
      `UPDATE drift_scheduler_runs
          SET ended_at      = NOW(),
              total_checks  = ?,
              drifted       = ?,
              remediated    = ?,
              errors        = ?,
              error_message = ?
        WHERE id = ?`,
      [
        summary?.total ?? null,
        summary?.drifted ?? null,
        summary?.remediated ?? null,
        summary?.errors ?? null,
        errorMessage ?? null,
        runId,
      ]
    );
  } catch (e) {
    console.error(`[DriftHeartbeat] recordEnd(${runId}) failed:`, e.message);
  }
}

/**
 * Health-check helper: returns the most recent successful run per scheduler.
 * Used by /api/health to compute scheduler-staleness directly.
 *
 * Returns: { ca: {started_at, ended_at, ageSeconds, ...}|null, intune: {...}|null }
 */
async function getLastRunPerScheduler() {
  try {
    const rows = await db.queryRows(
      `SELECT r.scheduler, r.started_at, r.ended_at,
              r.total_checks, r.drifted, r.remediated, r.errors, r.error_message,
              TIMESTAMPDIFF(SECOND, r.ended_at, NOW()) AS seconds_since_end
         FROM drift_scheduler_runs r
         JOIN (
           SELECT scheduler, MAX(id) AS last_id
             FROM drift_scheduler_runs
            WHERE ended_at IS NOT NULL
            GROUP BY scheduler
         ) latest ON latest.last_id = r.id`
    );
    const out = { ca: null, intune: null };
    for (const r of rows) {
      out[r.scheduler] = {
        started_at: r.started_at,
        ended_at: r.ended_at,
        seconds_since_end: r.seconds_since_end,
        total_checks: r.total_checks,
        drifted: r.drifted,
        remediated: r.remediated,
        errors: r.errors,
        error_message: r.error_message,
      };
    }
    return out;
  } catch (e) {
    console.error('[DriftHeartbeat] getLastRunPerScheduler failed:', e.message);
    return { ca: null, intune: null };
  }
}

module.exports = {
  ensureSchema,
  recordStart,
  recordEnd,
  getLastRunPerScheduler,
};
