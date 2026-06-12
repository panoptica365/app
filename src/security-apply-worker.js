/**
 * Panoptica365 — Security Setting Apply Worker
 *
 * Background worker that processes the security_setting_apply_jobs queue.
 * Built May 6, 2026 to unblock MSP-scale deployments where customer
 * tenants commonly have 100s of mailboxes — synchronous Apply was hitting
 * HTTP gateway timeouts on tenants with as few as 51 mailboxes because
 * a Set-Mailbox-per-mailbox loop legitimately takes ~60-90s.
 *
 * Loop:
 *   - Every WORKER_POLL_INTERVAL_MS, claim the oldest queued job.
 *   - Run via the existing writers.applySetting dispatcher, but with an
 *     onProgress callback that writes [PANOPTICA-PROGRESS] markers from
 *     PowerShell stdout into security_setting_apply_jobs.progress_*.
 *   - On clean exit: completeJob(jobId, output).
 *   - On any error / timeout: failJob(jobId, errorMessage).
 *
 * Concurrency: 1. Operators rarely need parallel Applies (per Jacques,
 * each setting is typically applied once per tenant during onboarding).
 * PowerShell shells are heavy (~100MB each) and EXO V3 connections are
 * stateful, so even if N>1 were desirable, it'd be a careful design.
 *
 * Hard timeout: 30 min per job (apply-jobs.MAX_JOB_RUNTIME_MS). After
 * that, the spawned pwsh process is SIGTERM'd, then SIGKILL'd if it
 * doesn't exit, and the job is marked 'timeout'.
 *
 * Lifecycle:
 *   - Started from server.js after the DB is ready.
 *   - On graceful shutdown (SIGINT/SIGTERM), the worker stops claiming
 *     new jobs but lets the in-flight job complete (up to 30s grace).
 *   - On hard process kill, in-flight jobs are recovered via
 *     applyJobs.recoverStrandedJobs() at next startup.
 */

'use strict';

const applyJobs = require('./lib/security-settings/apply-jobs');
const writers = require('./lib/security-settings/writers');
const pwshRunner = require('./lib/security-settings/pwsh-runner');
const tenantMode = require('./lib/tenant-mode');
const { byId } = require('./lib/security-settings/registry');
const db = require('./db/database');
const workerHeartbeat = require('./worker-heartbeat');

// Liveness stamp throttle (Reliability P0, 2026-06-12). The poll loop ticks
// every 2s — stamping every tick would be 43k writes/day to one row for zero
// signal gain. One stamp per 5 min is plenty for the worker_liveness check
// (warn threshold is well above this).
const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;
let lastHeartbeatMs = 0;

// May 6, 2026 — Lazy-loaded because src/routes/api-security.js can't be
// imported at module-load time without circular-dependency risk through
// the Express router setup. Loaded on first processJob call.
let _apiSecurity = null;
function getApiSecurityHelpers() {
  if (!_apiSecurity) {
    _apiSecurity = require('./routes/api-security');
  }
  return _apiSecurity;
}

let pollHandle = null;
let stopRequested = false;
let currentJob = null; // { id, child } when actively processing

// ──────────────────────────────────────────────────────────────────────
// PROGRESS MARKER CONTRACT
// ──────────────────────────────────────────────────────────────────────
//
// PowerShell scripts emit progress on stdout as:
//   [PANOPTICA-PROGRESS] current=5 total=51 message=Setting AuditOwner...
//
// pwsh-runner.js intercepts these lines and calls our onProgress callback,
// which forwards the parsed fields to applyJobs.updateProgress(). The
// frontend polls /api/security/jobs/:jobId every ~2s and renders.

/**
 * Resolve the tenant's Azure AD GUID from the Panoptica integer id.
 * Required because writers.applySetting takes the Azure GUID, but the
 * job row carries the Panoptica integer id (FK to tenants).
 */
async function resolveTenantAzureId(tenantPk) {
  const row = await db.queryOne(
    'SELECT tenant_id FROM tenants WHERE id = ? LIMIT 1',
    [tenantPk]
  );
  return row?.tenant_id || null;
}

/**
 * Process one claimed job end-to-end. Catches all errors and translates
 * to failJob — never throws back to the loop, so a buggy writer can't
 * wedge the worker.
 *
 * @param {object} job  Row from apply_jobs.claimNextJob()
 */
async function processJob(job) {
  // Audit-only contract gate. shouldProcessTenant returns false for
  // audit_only tenants — for those, refuse the Apply with a specific
  // error so the operator sees why nothing happened. (api-security.js
  // should also gate this upstream, but defense-in-depth.)
  if (!await tenantMode.shouldProcessTenant(job.tenant_id)) {
    await applyJobs.failJob(
      job.id,
      'Audit-only tenant — security setting Apply is refused. Switch the tenant to managed mode to enable Apply.'
    );
    return;
  }

  const tenantAzureId = await resolveTenantAzureId(job.tenant_id);
  if (!tenantAzureId) {
    await applyJobs.failJob(job.id, `Tenant id=${job.tenant_id} not found in tenants table`);
    return;
  }

  console.log(`[ApplyWorker] Processing jobId=${job.id} tenant=${job.tenant_id} setting=${job.setting_id}`);

  // ── 30-min hard timeout via spawn handle ────────────────────────────
  // We pass a handleProcess callback to pwsh-runner. It calls us
  // synchronously with the spawned child so we can attach a timer that
  // SIGTERMs the pwsh process at the 30-min mark. After SIGTERM, give the
  // process 5s to clean up; if still alive, SIGKILL.
  let hardTimeoutHandle = null;
  let escalateKillHandle = null;
  let timedOut = false;

  const handleProcess = (child) => {
    currentJob = { id: job.id, child };
    hardTimeoutHandle = setTimeout(() => {
      timedOut = true;
      console.warn(`[ApplyWorker] jobId=${job.id} exceeded ${applyJobs.MAX_JOB_RUNTIME_MS / 1000}s — sending SIGTERM to pwsh process`);
      try { child.kill('SIGTERM'); } catch (e) { /* may have already exited */ }
      escalateKillHandle = setTimeout(() => {
        if (!child.killed) {
          console.warn(`[ApplyWorker] jobId=${job.id} did not exit on SIGTERM — escalating to SIGKILL`);
          try { child.kill('SIGKILL'); } catch (e) { /* shrug */ }
        }
      }, 5000);
    }, applyJobs.MAX_JOB_RUNTIME_MS);
  };

  // ── Progress callback ───────────────────────────────────────────────
  const onProgress = (p) => {
    // Non-blocking write — don't await inside the stdout-line parser to
    // avoid backpressure on the pwsh output stream. Errors are logged
    // but not surfaced to the caller; an occasional missed progress
    // update is acceptable.
    applyJobs.updateProgress(job.id, p).catch((err) => {
      console.warn(`[ApplyWorker] updateProgress failed for jobId=${job.id}: ${err.message}`);
    });
  };

  // Resolve helpers + setting registry entry now (we need them throughout).
  const setting = byId(job.setting_id);
  if (!setting) {
    await applyJobs.failJob(job.id, `Setting ${job.setting_id} not found in registry`);
    if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
    if (escalateKillHandle) clearTimeout(escalateKillHandle);
    currentJob = null;
    return;
  }
  const apiSec = getApiSecurityHelpers();

  // Synthetic req — used by audit log + change log helpers that normally
  // pull operator email from req.session. The worker has no real session;
  // we reconstruct a minimal shape from the job row's operator_email.
  const syntheticReq = {
    session: {
      user: {
        email: job.operator_email || null,
        name: job.operator_email || 'panoptica-system',
      },
    },
    // Some logging helpers also read req.headers / req.ip — provide
    // empty defaults so they don't NPE.
    headers: {},
    ip: 'panoptica-async-worker',
  };

  // Tenant row — needed by persistTransition + change-log helpers.
  const tenantRow = await db.queryOne(
    'SELECT id, tenant_id, display_name FROM tenants WHERE id = ? LIMIT 1',
    [job.tenant_id]
  );
  if (!tenantRow) {
    await applyJobs.failJob(job.id, `Tenant id=${job.tenant_id} not found`);
    if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
    if (escalateKillHandle) clearTimeout(escalateKillHandle);
    currentJob = null;
    return;
  }

  let writeResult;
  let preReadCurrent = null;
  try {
    // Pre-read — some writers (ENT-06) need pre-write state to decide
    // POST vs PATCH. Same call the sync /apply endpoint makes.
    try {
      const pre = await apiSec.readSettingNow(tenantRow.tenant_id, job.setting_id);
      preReadCurrent = pre?.ok ? pre.current_value : null;
    } catch (e) {
      console.warn(`[ApplyWorker] pre-read failed for jobId=${job.id}: ${e.message} (continuing anyway)`);
    }

    // The actual write — this is the long-running PowerShell or Graph call.
    writeResult = await writers.applySetting(
      tenantAzureId,
      job.setting_id,
      job.chosen_value,
      {
        currentValue: preReadCurrent,
        req: syntheticReq,
        onProgress,
        handleProcess,
      }
    );

    if (timedOut) {
      console.warn(`[ApplyWorker] jobId=${job.id} timer fired after clean exit — investigate scheduler skew`);
    }
  } catch (err) {
    if (timedOut) {
      await applyJobs.failJob(
        job.id,
        `Timeout: Apply exceeded ${applyJobs.MAX_JOB_RUNTIME_MS / 60000} min hard cap. The pwsh process was killed; some objects may have been partially updated. Reader's next poll will show current state.`,
        { timeout: true }
      );
    } else {
      const msg = err?.message || String(err);
      const codeStr = err?.code ? ` [${err.code}]` : '';
      await applyJobs.failJob(job.id, `${msg}${codeStr}`);
    }
    if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
    if (escalateKillHandle) clearTimeout(escalateKillHandle);
    currentJob = null;
    return;
  }

  // Write succeeded — now run the verification + persistence pipeline that
  // the sync /apply endpoint normally does. This is the same logic; we
  // import the helpers from api-security.js.
  let verifyResult;
  try {
    verifyResult = await apiSec.readSettingNow(tenantRow.tenant_id, job.setting_id);
  } catch (e) {
    verifyResult = { ok: false, error: `Verification poll threw: ${e.message}` };
  }

  let newStatus, currentValue, lastCheckError = null;
  if (verifyResult.ok && setting.writer.matches(job.chosen_value, verifyResult.current_value)) {
    newStatus = 'monitored';
    currentValue = verifyResult.current_value;
  } else if (verifyResult.ok) {
    // Microsoft propagation lag — slow-tier poll picks it up later.
    newStatus = 'pending';
    currentValue = verifyResult.current_value;
  } else {
    newStatus = 'pending';
    currentValue = null;
    lastCheckError = verifyResult.error || 'verification poll failed';
  }

  // captureBaseline — same hook as the sync endpoint.
  const baselineToStore = setting.writer.captureBaseline
    ? setting.writer.captureBaseline(job.chosen_value, currentValue)
    : job.chosen_value;

  let previousAppliedValue = null;
  try {
    previousAppliedValue = await apiSec.priorAppliedValue(tenantRow.id, job.setting_id);
  } catch (e) { /* swallow — descriptive only */ }

  try {
    await apiSec.persistTransition({
      tenant: tenantRow,
      settingId: job.setting_id,
      setting,
      action: 'apply',
      newAppliedValue: baselineToStore,
      currentValue,
      newStatus,
      previousAppliedValue,
      operatorEmail: job.operator_email,
      req: syntheticReq,
      lastCheckError,
    });
  } catch (e) {
    console.error(`[ApplyWorker] persistTransition failed for jobId=${job.id}: ${e.message}`);
    // Don't fail the job — the WRITE succeeded. The persistence failure is
    // a Panoptica-internal issue, not a customer-facing one.
  }

  // Tenant Change Log row — for drift attribution.
  try {
    let chosenLabel = '';
    try {
      const optDef = (setting.writer.options || []).find(
        o => JSON.stringify(o.value) === JSON.stringify(
          (job.chosen_value && typeof job.chosen_value === 'object' && 'option' in job.chosen_value)
            ? job.chosen_value.option
            : job.chosen_value
        )
      );
      chosenLabel = optDef?.label || '';
    } catch { /* swallow */ }
    const tail = chosenLabel
      ? `set to "${chosenLabel}"${newStatus === 'pending' ? ' (Microsoft propagation in progress)' : ''}`
      : `applied${newStatus === 'pending' ? ' (Microsoft propagation in progress)' : ''}`;
    await apiSec.logSecuritySettingChange(syntheticReq, tenantRow, setting, 'Applied', tail);
  } catch (e) {
    console.warn(`[ApplyWorker] logSecuritySettingChange failed for jobId=${job.id}: ${e.message}`);
  }

  // Mark job complete. The output column gets the cmdlet/payload summary.
  const summary = writeResult?.cmdlet
    ? `cmdlet: ${String(writeResult.cmdlet).slice(0, 800)}`
    : writeResult?.payload
      ? `payload: ${JSON.stringify(writeResult.payload).slice(0, 800)}`
      : (typeof writeResult === 'object' ? JSON.stringify(writeResult).slice(0, 800) : String(writeResult));
  const summaryWithStatus = `status=${newStatus}; ${summary}`;
  await applyJobs.completeJob(job.id, summaryWithStatus);

  if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
  if (escalateKillHandle) clearTimeout(escalateKillHandle);
  currentJob = null;
}

/**
 * Single iteration of the poll loop. Called repeatedly via setInterval.
 * Concurrency is enforced by the `currentJob` guard: if a job is in flight,
 * we don't claim a new one. This bounds in-flight jobs to 1.
 */
async function tick() {
  if (stopRequested) return;
  if (Date.now() - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
    lastHeartbeatMs = Date.now();
    workerHeartbeat.stampSuccess('security_apply', null);
  }
  if (currentJob) return; // already running one

  let job;
  try {
    job = await applyJobs.claimNextJob();
  } catch (err) {
    console.error(`[ApplyWorker] claimNextJob failed: ${err.message}`);
    return;
  }
  if (!job) return; // nothing queued

  try {
    await processJob(job);
  } catch (err) {
    // processJob is supposed to catch everything internally. This is the
    // belt-and-braces in case something escapes.
    console.error(`[ApplyWorker] processJob escaped uncaught for jobId=${job.id}: ${err.message}`);
    try { await applyJobs.failJob(job.id, `Uncaught worker error: ${err.message}`); }
    catch (e) { /* DB might be down too; nothing else to do */ }
  }
}

/**
 * Start the worker. Runs an immediate tick, then every WORKER_POLL_INTERVAL_MS.
 * Idempotent — calling start twice is a no-op.
 */
function start() {
  if (pollHandle) {
    console.warn('[ApplyWorker] start() called twice — ignoring duplicate');
    return;
  }
  console.log(`[ApplyWorker] Starting — poll interval ${applyJobs.WORKER_POLL_INTERVAL_MS / 1000}s, max job runtime ${applyJobs.MAX_JOB_RUNTIME_MS / 60000} min`);
  // Defer the first tick by 5s so we don't compete with other startup work.
  setTimeout(() => {
    tick().catch(err => console.error('[ApplyWorker] Initial tick failed:', err.message));
    pollHandle = setInterval(() => {
      tick().catch(err => console.error('[ApplyWorker] Tick failed:', err.message));
    }, applyJobs.WORKER_POLL_INTERVAL_MS);
  }, 5000);
}

/**
 * Stop accepting new jobs. The in-flight job (if any) continues; on hard
 * shutdown it'll be recovered via recoverStrandedJobs() on next start.
 *
 * Called from server.js SIGINT/SIGTERM handlers.
 */
function stop() {
  stopRequested = true;
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    console.log('[ApplyWorker] Stopped (in-flight job, if any, will not block shutdown)');
  }
}

module.exports = {
  start,
  stop,
  // Exposed for testing / admin tooling
  _tick: tick,
  _processJob: processJob,
  _currentJob: () => currentJob,
};
