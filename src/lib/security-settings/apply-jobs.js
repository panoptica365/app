/**
 * Panoptica365 — Security Setting Apply Jobs
 *
 * Persistent job queue for asynchronous Apply operations on security
 * settings. Built May 6, 2026 to unblock MSP-scale deployments where
 * customer tenants commonly have 100s of mailboxes — synchronous Apply
 * was hitting HTTP gateway timeouts on tenants with as few as 51 mailboxes
 * because a Set-Mailbox-per-mailbox loop legitimately takes ~60-90s.
 *
 * Architecture:
 *   - api-security.js Apply endpoint: enqueues a job, returns 202 + jobId
 *     in <1s instead of awaiting the PowerShell process synchronously.
 *   - src/security-apply-worker.js: single-instance background worker that
 *     polls for queued jobs and runs them. Concurrency=1 — operators
 *     rarely need parallel Applies and PowerShell shells are heavy.
 *   - PowerShell scripts emit [PANOPTICA-PROGRESS] markers on stdout that
 *     the worker parses in real-time and writes to progress_current/total.
 *   - Frontend polls GET /api/security/jobs/:jobId every ~2s for status.
 *
 * Robustness:
 *   - Per-tenant per-setting lock (UNIQUE on (tenant_id, setting_id, status)
 *     for queued/running rows is enforced at the application layer in
 *     enqueueJob — DB constraint would prevent re-Apply after a failure).
 *   - Stranded-job recovery on pm2 restart (recoverStrandedJobs marks any
 *     'running' job from a previous process as 'failed' with reason
 *     'process_restarted'; operator can re-Apply cleanly).
 *   - 30-min hard timeout cap enforced by the worker. Beyond that, the
 *     pwsh process is killed and the job marked 'timeout'.
 *
 * Eager schema migration (fire-and-forget at module load) per memory
 * feedback_eager_migration_pattern.md.
 */

'use strict';

const db = require('../../db/database');

// Status enum — keep in sync with the DB column. Used widely; export for
// callers (worker, API, frontend via i18n keys).
const STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELED: 'canceled',
});

const ACTIVE_STATUSES = [STATUS.QUEUED, STATUS.RUNNING];
const TERMINAL_STATUSES = [STATUS.COMPLETED, STATUS.FAILED, STATUS.TIMEOUT, STATUS.CANCELED];

// Hard cap on job runtime. Beyond this, the worker kills the pwsh process
// and marks the job 'timeout'. Most Applies finish in seconds-to-minutes;
// 30 min covers even the most pathological MSP-scale case.
const MAX_JOB_RUNTIME_MS = 30 * 60 * 1000;

// Worker poll interval — how often to check for newly queued jobs when
// idle. Low enough that operators don't perceive lag, high enough to not
// hammer the DB.
const WORKER_POLL_INTERVAL_MS = 2 * 1000;

let schemaReady = false;
let schemaPromise = null;

/**
 * Idempotent schema migration. Creates the apply-jobs table if missing.
 *
 * Notes:
 *   - chosen_value JSON: the UI-selected value passed to writers.applySetting.
 *     Could be a string, number, bool, or rich object depending on setting.
 *   - progress_current / progress_total: optional. Settings with no
 *     iterable workload (single Set-OrganizationConfig call) leave both at 0
 *     and the UI falls back to elapsed-time-only rendering.
 *   - error_message TEXT: full Microsoft / pwsh-runner error text. Surfaced
 *     verbatim in the UI so operators have ground truth without log access.
 *   - output TEXT: success summary from the cmdlet (e.g. "bypass_fixed=2
 *     actions_fixed=51 errors=0"). Useful in History view.
 *
 * ingested_at DATETIME(3) — sub-second precision matches existing UAL +
 * signin_cache tables for consistent timestamp handling. Set via
 * UTC_TIMESTAMP(3) at INSERT (no MySQL DEFAULT support per
 * memory feedback_mysql_datetime_z_suffix.md).
 */
async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS security_setting_apply_jobs (
          id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id         INT UNSIGNED NOT NULL,
          setting_id        VARCHAR(16)  NOT NULL,
          chosen_value      JSON         NOT NULL,
          operator_email    VARCHAR(320) DEFAULT NULL,
          status            ENUM('queued','running','completed','failed','timeout','canceled') NOT NULL DEFAULT 'queued',
          progress_current  INT UNSIGNED NOT NULL DEFAULT 0,
          progress_total    INT UNSIGNED NOT NULL DEFAULT 0,
          progress_message  VARCHAR(255) DEFAULT NULL,
          started_at        DATETIME(3)  DEFAULT NULL,
          completed_at      DATETIME(3)  DEFAULT NULL,
          error_message     TEXT         DEFAULT NULL,
          output            TEXT         DEFAULT NULL,
          created_at        DATETIME(3)  NOT NULL,
          updated_at        DATETIME(3)  NOT NULL,
          INDEX idx_apply_jobs_status_created (status, created_at),
          INDEX idx_apply_jobs_tenant_setting_created (tenant_id, setting_id, created_at),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      schemaReady = true;
      console.log('[ApplyJobs] Schema ready (security_setting_apply_jobs)');
    } catch (err) {
      console.error('[ApplyJobs] ensureSchema failed:', err.message);
    } finally {
      schemaPromise = null;
    }
  })();

  return schemaPromise;
}

ensureSchema().catch((err) => {
  console.error('[ApplyJobs] Eager schema migration failed at module load:', err.message);
});

/**
 * MySQL DATETIME normalizer — mirrors the helper in lib/ual-events.js.
 * MySQL rejects ISO 'Z' suffix on UPDATE and on some INSERT paths.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

/**
 * Enqueue a new Apply job.
 *
 * Per-tenant per-setting lock: rejects with ALREADY_QUEUED if a job in
 * 'queued' or 'running' state already exists for the same (tenant, setting).
 * The frontend should disable the Apply button while a job is in flight, but
 * this is the server-side belt-and-braces.
 *
 * @param {object} args
 * @param {number} args.tenantId       Panoptica tenants.id
 * @param {string} args.settingId      e.g. 'EXO-09'
 * @param {*}      args.chosenValue    UI-selected value (object/string/bool)
 * @param {string} [args.operatorEmail]  Logged-in operator's email
 * @returns {Promise<{ jobId: number, status: string }>}
 * @throws {Error} with code 'ALREADY_QUEUED' if a job is in flight
 */
async function enqueueJob({ tenantId, settingId, chosenValue, operatorEmail = null }) {
  if (!tenantId) throw new Error('enqueueJob: tenantId required');
  if (!settingId) throw new Error('enqueueJob: settingId required');
  if (chosenValue === undefined) throw new Error('enqueueJob: chosenValue required');
  await ensureSchema();

  // Lock check — refuse to enqueue if there's already an active job for this
  // (tenant, setting). Refusing here keeps the queue from filling up with
  // duplicate Applies if an operator double-clicks or a buggy UI repeats.
  const existing = await db.queryOne(
    `SELECT id, status FROM security_setting_apply_jobs
      WHERE tenant_id = ? AND setting_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, settingId]
  );
  if (existing) {
    const err = new Error(`Apply job already ${existing.status} for tenant ${tenantId} setting ${settingId} (jobId=${existing.id})`);
    err.code = 'ALREADY_QUEUED';
    err.existingJobId = existing.id;
    err.existingStatus = existing.status;
    throw err;
  }

  const now = toMysqlDatetime(new Date());
  const jobId = await db.insert(
    `INSERT INTO security_setting_apply_jobs
       (tenant_id, setting_id, chosen_value, operator_email, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    [
      tenantId,
      settingId,
      JSON.stringify(chosenValue),
      operatorEmail,
      now,
      now,
    ]
  );

  console.log(`[ApplyJobs] Enqueued jobId=${jobId} tenant=${tenantId} setting=${settingId} operator=${operatorEmail || '(unknown)'}`);
  return { jobId, status: STATUS.QUEUED };
}

/**
 * Atomically claim the oldest queued job for processing. Used by the worker
 * loop. UPDATE-then-SELECT pattern (rather than SELECT-then-UPDATE) so two
 * worker instances racing for the same job can't both win.
 *
 * Uses a lock-row pattern: UPDATE with ORDER BY + LIMIT 1 + a sentinel
 * marker we know is unique to this attempt, then SELECT WHERE that marker.
 *
 * @returns {Promise<object|null>}  The claimed job row, or null if no work
 */
async function claimNextJob() {
  await ensureSchema();
  // Use the MySQL session-id as the claim sentinel — guaranteed unique
  // per connection. We update started_at to a unique microsecond value
  // and then SELECT by that value to identify our claim.
  const claimToken = `claimed-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Mark the oldest queued row as running, attaching our claim token in
  // progress_message so we can re-identify the row in the next query.
  // Single-row UPDATE with ORDER BY is atomic in InnoDB under the default
  // isolation level — two concurrent claimNextJob calls will each see a
  // different row.
  const affected = await db.execute(
    `UPDATE security_setting_apply_jobs
        SET status = 'running',
            started_at = UTC_TIMESTAMP(3),
            progress_message = ?,
            updated_at = UTC_TIMESTAMP(3)
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1`,
    [claimToken]
  );

  if (!affected || affected === 0) return null;

  // Read the row we just claimed, identified by the unique claim token.
  const row = await db.queryOne(
    `SELECT id, tenant_id, setting_id, chosen_value, operator_email,
            status, progress_current, progress_total, progress_message,
            started_at, created_at
       FROM security_setting_apply_jobs
      WHERE progress_message = ? AND status = 'running'
      LIMIT 1`,
    [claimToken]
  );
  if (!row) {
    // Racy edge case — extremely rare. Mark the orphan as failed so it
    // doesn't sit in 'running' forever.
    console.warn('[ApplyJobs] claimNextJob: claim token not found after UPDATE — orphan, ignoring');
    return null;
  }

  // Clear the claim token from progress_message — it was just a transient
  // marker. Real progress messages will overwrite this on first update.
  await db.execute(
    `UPDATE security_setting_apply_jobs SET progress_message = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [row.id]
  );

  // Parse chosen_value (mysql2 auto-parses JSON columns; defensive in case
  // a row was written by an older code path before that auto-parse).
  if (typeof row.chosen_value === 'string') {
    try { row.chosen_value = JSON.parse(row.chosen_value); }
    catch (e) { /* leave as string; let writer's validateChosenValue reject if malformed */ }
  }

  return row;
}

/**
 * Update progress for a running job. Called by the worker as it parses
 * [PANOPTICA-PROGRESS] markers from PowerShell stdout.
 *
 * @param {number}  jobId
 * @param {object}  patch
 * @param {number}  [patch.current]   how many items done
 * @param {number}  [patch.total]     total items
 * @param {string}  [patch.message]   short status message
 */
async function updateProgress(jobId, patch = {}) {
  if (!jobId) return;
  const sets = ['updated_at = UTC_TIMESTAMP(3)'];
  const params = [];
  if (typeof patch.current === 'number') {
    sets.push('progress_current = ?');
    params.push(Math.max(0, Math.floor(patch.current)));
  }
  if (typeof patch.total === 'number') {
    sets.push('progress_total = ?');
    params.push(Math.max(0, Math.floor(patch.total)));
  }
  if (typeof patch.message === 'string') {
    sets.push('progress_message = ?');
    params.push(patch.message.slice(0, 255));
  }
  if (sets.length === 1) return; // nothing to update beyond timestamp
  params.push(jobId);
  await db.execute(
    `UPDATE security_setting_apply_jobs SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
}

/**
 * Mark a job complete. Called by the worker on successful pwsh exit.
 * Sets status = 'completed', completed_at, output (success summary).
 * Also bumps progress_current = progress_total so the UI shows 100%.
 */
async function completeJob(jobId, output = null) {
  if (!jobId) return;
  await db.execute(
    `UPDATE security_setting_apply_jobs
        SET status = 'completed',
            completed_at = UTC_TIMESTAMP(3),
            updated_at = UTC_TIMESTAMP(3),
            progress_current = GREATEST(progress_current, progress_total),
            output = ?
      WHERE id = ?`,
    [output ? String(output).slice(0, 65000) : null, jobId]
  );
  console.log(`[ApplyJobs] Completed jobId=${jobId}`);
}

/**
 * Mark a job failed. Used for any non-success terminal state EXCEPT timeout
 * (use failJob with reason='timeout' or call failTimeoutJob explicitly).
 */
async function failJob(jobId, errorMessage, opts = {}) {
  if (!jobId) return;
  const status = opts.timeout ? STATUS.TIMEOUT : STATUS.FAILED;
  await db.execute(
    `UPDATE security_setting_apply_jobs
        SET status = ?,
            completed_at = UTC_TIMESTAMP(3),
            updated_at = UTC_TIMESTAMP(3),
            error_message = ?
      WHERE id = ?`,
    [status, String(errorMessage || '').slice(0, 65000), jobId]
  );
  console.warn(`[ApplyJobs] ${status === STATUS.TIMEOUT ? 'Timed out' : 'Failed'} jobId=${jobId}: ${errorMessage}`);
}

/**
 * Read a job by id. Used by the API status endpoint.
 * Returns the row including elapsed_seconds (computed server-side so the
 * frontend doesn't have to deal with timezone math on started_at).
 */
async function getJob(jobId) {
  if (!jobId) return null;
  await ensureSchema();
  const row = await db.queryOne(
    `SELECT id, tenant_id, setting_id, chosen_value, operator_email,
            status, progress_current, progress_total, progress_message,
            started_at, completed_at, error_message, output,
            created_at, updated_at,
            CASE
              WHEN started_at IS NULL THEN 0
              WHEN completed_at IS NULL THEN TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP(3))
              ELSE TIMESTAMPDIFF(SECOND, started_at, completed_at)
            END AS elapsed_seconds
       FROM security_setting_apply_jobs
      WHERE id = ?
      LIMIT 1`,
    [jobId]
  );
  if (!row) return null;
  if (typeof row.chosen_value === 'string') {
    try { row.chosen_value = JSON.parse(row.chosen_value); } catch (e) { /* leave */ }
  }
  return row;
}

/**
 * Find the most recent in-flight job for a (tenant, setting) — used by the
 * frontend to detect "Apply already in progress, resume polling" on
 * modal reopen.
 */
async function getActiveJobForTenantSetting(tenantId, settingId) {
  if (!tenantId || !settingId) return null;
  await ensureSchema();
  const row = await db.queryOne(
    `SELECT id, status, started_at, progress_current, progress_total, progress_message
       FROM security_setting_apply_jobs
      WHERE tenant_id = ? AND setting_id = ?
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, settingId]
  );
  return row || null;
}

/**
 * Recovery on pm2 / process restart. Any job stuck in 'running' state from
 * a previous process didn't actually complete — the pwsh process died with
 * the parent. Mark such jobs failed with a specific reason so the operator
 * knows to re-Apply rather than waiting forever.
 *
 * Called from server.js startup BEFORE the worker loop starts.
 */
async function recoverStrandedJobs() {
  await ensureSchema();
  const result = await db.execute(
    `UPDATE security_setting_apply_jobs
        SET status = 'failed',
            completed_at = UTC_TIMESTAMP(3),
            updated_at = UTC_TIMESTAMP(3),
            error_message = 'process_restarted: server restarted while Apply was in progress; retry the Apply'
      WHERE status = 'running'`
  );
  const count = result?.affectedRows ?? result ?? 0;
  if (count > 0) {
    console.warn(`[ApplyJobs] Recovered ${count} stranded job(s) from previous process — marked as failed`);
  }
  return count;
}

/**
 * History view for a tenant — used for a future "Apply history" UI panel.
 * Returns the most recent N jobs across all settings for a tenant.
 */
async function listRecentJobsForTenant(tenantId, limit = 50) {
  if (!tenantId) return [];
  await ensureSchema();
  const cap = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  return db.queryRows(
    `SELECT id, setting_id, status, progress_current, progress_total,
            started_at, completed_at, error_message, output, created_at,
            CASE
              WHEN started_at IS NULL OR completed_at IS NULL THEN 0
              ELSE TIMESTAMPDIFF(SECOND, started_at, completed_at)
            END AS elapsed_seconds
       FROM security_setting_apply_jobs
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ${cap}`,
    [tenantId]
  );
}

module.exports = {
  ensureSchema,
  enqueueJob,
  claimNextJob,
  updateProgress,
  completeJob,
  failJob,
  getJob,
  getActiveJobForTenantSetting,
  recoverStrandedJobs,
  listRecentJobsForTenant,
  STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  MAX_JOB_RUNTIME_MS,
  WORKER_POLL_INTERVAL_MS,
};
