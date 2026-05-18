/**
 * Panoptica — CA Drift Scheduler
 * Runs automatic drift checks every 60 minutes for all CA assignments.
 * Auto-remediates if enforcement mode is 'remediate'.
 * Drift events are routed to the alert dashboard via createDriftAlert().
 */

const cron = require('node-cron');
const db = require('./db/database');
const heartbeat = require('./drift-scheduler-heartbeat');

let driftJob = null;
let checkDriftFn = null;
let expireExemptionsFn = null;

/**
 * Start the drift scheduler.
 * @param {Function} checkDrift - The checkDrift function from api-ca.js
 * @param {Function} [expireExemptions] - Optional: expireExemptions from api-ca.js.
 *   Runs at the top of each cycle to auto-revoke overdue CA exemptions.
 */
function start(checkDrift, expireExemptions) {
  checkDriftFn = checkDrift;
  expireExemptionsFn = expireExemptions || null;

  // Run every 60 minutes at the top of the hour
  driftJob = cron.schedule('0 * * * *', async () => {
    try {
      await runAllDriftChecks();
    } catch (err) {
      console.error('[DriftScheduler] Cycle error:', err.message);
    }
  });

  console.log('[DriftScheduler] Started — drift checks every 60 minutes at :00');

  // Run initial check 30 seconds after startup (give server time to initialize)
  setTimeout(() => {
    runAllDriftChecks().catch(err =>
      console.error('[DriftScheduler] Initial drift check error:', err.message)
    );
  }, 30000);
}

function stop() {
  if (driftJob) {
    driftJob.stop();
    driftJob = null;
  }
  console.log('[DriftScheduler] Stopped');
}

/**
 * Run drift checks for all assignments that have a live_policy_id.
 * Only checks assignments with a linked policy — undeployed ones are skipped.
 *
 * Heartbeat: opens a drift_scheduler_runs row on entry, closes it on exit
 * with totals — direct signal for /api/health (replaces the old indirect
 * inference from api_health rows). Heartbeat failures never block the cycle.
 */
async function runAllDriftChecks() {
  if (!checkDriftFn) {
    console.warn('[DriftScheduler] checkDrift function not initialized');
    return;
  }

  const runId = await heartbeat.recordStart('ca');

  try {
    // Expire overdue CA exemptions before the drift cycle — so that any
    // monitored_fields drift that was previously suppressed (because the
    // excludeUsers/excludeGroups change was covered by an active exemption)
    // can surface again once its expiry has passed.
    if (expireExemptionsFn) {
      try { await expireExemptionsFn(); }
      catch (err) { console.warn('[DriftScheduler] expireExemptions error:', err.message); }
    }

    const assignments = await db.queryRows(
      `SELECT a.*, t.policy_json, t.monitored_fields, t.name AS template_name,
              t.alert_routing AS template_alert_routing,
              tn.tenant_id AS azure_tenant_id
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       JOIN tenants tn ON tn.id = a.tenant_id
       WHERE a.live_policy_id IS NOT NULL
         AND tn.enabled = TRUE
         AND tn.mode = 'managed'`
    );

    if (assignments.length === 0) {
      console.log('[DriftScheduler] No linked assignments to check');
      await heartbeat.recordEnd(runId, { total: 0, drifted: 0, remediated: 0, errors: 0 });
      return;
    }

    console.log(`[DriftScheduler] Checking ${assignments.length} assignment(s) for drift`);

    let driftCount = 0;
    let remediatedCount = 0;
    let errorCount = 0;

    for (const assignment of assignments) {
      try {
        const result = await checkDriftFn(assignment);
        if (result.drift_status === 'drifted') driftCount++;
        if (result.remediated) remediatedCount++;
      } catch (err) {
        errorCount++;
        console.error(`[DriftScheduler] Check failed for assignment ${assignment.id} (${assignment.template_name}):`, err.message);
      }
    }

    console.log(`[DriftScheduler] Complete: ${assignments.length} checked, ${driftCount} drifted, ${remediatedCount} remediated, ${errorCount} errors`);
    await heartbeat.recordEnd(runId, {
      total: assignments.length,
      drifted: driftCount,
      remediated: remediatedCount,
      errors: errorCount,
    });
  } catch (err) {
    await heartbeat.recordEnd(runId, null, err.message || String(err));
    throw err;
  }
}

module.exports = { start, stop, runAllDriftChecks };
