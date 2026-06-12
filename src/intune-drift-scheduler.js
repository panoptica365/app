/**
 * Panoptica — Intune Drift Scheduler
 * Runs automatic drift checks every 60 minutes for all Intune policy deployments.
 * Monitor-only — fires alerts but does NOT auto-remediate.
 */

const cron = require('node-cron');
const heartbeat = require('./drift-scheduler-heartbeat');
// drift_scheduler_runs keeps per-run HISTORY (useful here); the registry stamp
// is additive so the worker_liveness health check reads ONE table for all loops.
const workerHeartbeat = require('./worker-heartbeat');

let driftJob = null;
let runDriftChecksFn = null;

/**
 * Start the Intune drift scheduler.
 * @param {Function} runAllChecks - The runAllIntuneDriftChecks function from api-intune.js.
 *                                  Returns {total, drifted, remediated, errors} for the heartbeat.
 * @param {Promise}  schemaReady  - Resolves when intune tables exist
 */
function start(runAllChecks, schemaReady) {
  runDriftChecksFn = runAllChecks;

  // Wraps the drift run with heartbeat start/end. Heartbeat failures never
  // block the cycle — they're logged in drift-scheduler-heartbeat.js.
  const safeRun = async () => {
    if (schemaReady) await schemaReady;  // wait for tables to exist
    const runId = await heartbeat.recordStart('intune');
    const cycleStart = Date.now();
    workerHeartbeat.stampStart('intune_drift');
    try {
      const summary = await runDriftChecksFn();
      await heartbeat.recordEnd(runId, summary);
      workerHeartbeat.stampSuccess('intune_drift', Date.now() - cycleStart);
    } catch (err) {
      await heartbeat.recordEnd(runId, null, err.message || String(err));
      workerHeartbeat.stampError('intune_drift', err.message || String(err));
      throw err;
    }
  };

  // Run every 60 minutes at :30 (offset from CA drift at :00 to avoid collision)
  driftJob = cron.schedule('30 * * * *', async () => {
    try {
      await safeRun();
    } catch (err) {
      console.error('[IntuneDrift] Cycle error:', err.message);
    }
  });

  console.log('[IntuneDrift] Started — drift checks every 60 minutes at :30');

  // Run initial check 60 seconds after startup
  setTimeout(() => {
    safeRun().catch(err =>
      console.error('[IntuneDrift] Initial drift check error:', err.message)
    );
  }, 60000);
}

function stop() {
  if (driftJob) {
    driftJob.stop();
    driftJob = null;
  }
  console.log('[IntuneDrift] Stopped');
}

module.exports = { start, stop };
