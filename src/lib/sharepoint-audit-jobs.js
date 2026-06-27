/**
 * Panoptica365 — SharePoint audit job store.
 *
 * DB-backed queue for SharePoint library audits, modelled on the async-apply
 * framework (src/lib/security-settings/apply-jobs.js). One job = one document
 * library. The worker (src/sp-audit-worker.js) drains the queue at bounded
 * concurrency and runs each job via the extracted audit runner.
 *
 * States: queued → running → done | failed | cancelled.
 * Dedupe: never two queued/running jobs for the same (tenant, site, library).
 * DB-backed so a pm2 restart / page reload doesn't lose in-flight work
 * (recoverStrandedJobs requeues interrupted 'running' jobs at boot).
 */

'use strict';

const db = require('../db/database');

const STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

let schemaReady = false;
let schemaPromise = null;

function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sp_audit_jobs (
          id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id        INT UNSIGNED NOT NULL,
          site_id          VARCHAR(512) NOT NULL,
          site_name        VARCHAR(255),
          site_url         VARCHAR(1024),
          library_id       VARCHAR(255) NOT NULL,
          library_name     VARCHAR(255) NOT NULL,
          status           ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
          origin           ENUM('single','site','global') NOT NULL DEFAULT 'single',
          requested_by     VARCHAR(320) DEFAULT NULL,
          audit_id         INT UNSIGNED DEFAULT NULL,
          items_total      INT UNSIGNED NOT NULL DEFAULT 0,
          items_processed  INT UNSIGNED NOT NULL DEFAULT 0,
          progress_message VARCHAR(255) DEFAULT NULL,
          claim_token      VARCHAR(64) DEFAULT NULL,
          error            TEXT DEFAULT NULL,
          queued_at        DATETIME(3) NOT NULL,
          started_at       DATETIME(3) DEFAULT NULL,
          finished_at      DATETIME(3) DEFAULT NULL,
          INDEX idx_spaj_status (status, queued_at),
          INDEX idx_spaj_tenant (tenant_id, queued_at),
          -- PREFIX index: full (tenant_id, site_id, library_id) under utf8mb4
          -- (4 + 512*4 + 255*4 = 3072 B) hits InnoDB's 3072-byte key limit
          -- exactly. Prefixes keep it well under (4 + 200*4 + 200*4 = 1604 B).
          -- Dedupe correctness is from the WHERE equality, not this index, so a
          -- prefix is purely a lookup aid — safe.
          INDEX idx_spaj_dedupe (tenant_id, site_id(200), library_id(200)),
          INDEX idx_spaj_finished (finished_at),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      schemaReady = true;
    })();
  }
  try {
    await schemaPromise;
  } catch (err) {
    schemaPromise = null;
    throw err;
  }
}

/**
 * Enqueue one library-audit job. Dedupe: if a queued/running job already
 * exists for the same (tenant, site, library), returns { skipped:true } and
 * does not insert. Re-auditing a previously-completed library IS allowed —
 * dedupe only blocks concurrent duplicates.
 * @returns {Promise<{ jobId:number, skipped:boolean }>}
 */
async function enqueueJob({ tenantId, siteId, siteName, siteUrl, libraryId, libraryName, origin = 'single', requestedBy = null }) {
  if (!tenantId || !siteId || !libraryId) throw new Error('enqueueJob: tenantId, siteId, libraryId required');
  await ensureSchema();

  const existing = await db.queryOne(
    `SELECT id FROM sp_audit_jobs
      WHERE tenant_id = ? AND site_id = ? AND library_id = ? AND status IN ('queued','running')
      LIMIT 1`,
    [tenantId, siteId, libraryId]
  );
  if (existing) return { jobId: existing.id, skipped: true };

  const now = toMysqlDatetime(new Date());
  const jobId = await db.insert(
    `INSERT INTO sp_audit_jobs
       (tenant_id, site_id, site_name, site_url, library_id, library_name, status, origin, requested_by, queued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [tenantId, siteId, siteName || null, siteUrl || null, libraryId, libraryName || libraryId, origin, requestedBy, now]
  );
  return { jobId, skipped: false };
}

/**
 * Atomically claim the oldest queued job (UPDATE-then-SELECT by claim token,
 * mirrors apply-jobs.claimNextJob). Returns the claimed row or null.
 */
async function claimNextJob() {
  await ensureSchema();
  const claimToken = `c-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const affected = await db.execute(
    `UPDATE sp_audit_jobs
        SET status='running', started_at=UTC_TIMESTAMP(3), claim_token=?
      WHERE status='queued'
      ORDER BY queued_at ASC
      LIMIT 1`,
    [claimToken]
  );
  if (!affected) return null;
  const row = await db.queryOne(
    `SELECT * FROM sp_audit_jobs WHERE claim_token=? AND status='running' LIMIT 1`,
    [claimToken]
  );
  if (!row) return null;
  await db.execute(`UPDATE sp_audit_jobs SET claim_token=NULL WHERE id=?`, [row.id]).catch(() => {});
  return row;
}

async function updateProgress(jobId, { itemsTotal, itemsProcessed, message } = {}) {
  await db.execute(
    `UPDATE sp_audit_jobs
        SET items_total = COALESCE(?, items_total),
            items_processed = COALESCE(?, items_processed),
            progress_message = COALESCE(?, progress_message)
      WHERE id = ?`,
    [
      itemsTotal == null ? null : itemsTotal,
      itemsProcessed == null ? null : itemsProcessed,
      message == null ? null : String(message).substring(0, 255),
      jobId,
    ]
  ).catch(() => {});
}

async function completeJob(jobId, auditId) {
  await db.execute(
    `UPDATE sp_audit_jobs SET status='done', finished_at=UTC_TIMESTAMP(3), audit_id=?, error=NULL WHERE id=?`,
    [auditId || null, jobId]
  );
}

async function failJob(jobId, errorMessage) {
  await db.execute(
    `UPDATE sp_audit_jobs SET status='failed', finished_at=UTC_TIMESTAMP(3), error=? WHERE id=?`,
    [String(errorMessage || 'unknown error').substring(0, 2000), jobId]
  );
}

/** Cancel a single QUEUED job (running jobs are left to finish). */
async function cancelJob(tenantId, jobId) {
  const affected = await db.execute(
    `UPDATE sp_audit_jobs SET status='cancelled', finished_at=UTC_TIMESTAMP(3)
      WHERE id=? AND tenant_id=? AND status='queued'`,
    [jobId, tenantId]
  );
  return affected > 0;
}

/** Cancel ALL queued jobs for a tenant. Returns count cancelled. */
async function cancelAllQueued(tenantId) {
  return db.execute(
    `UPDATE sp_audit_jobs SET status='cancelled', finished_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND status='queued'`,
    [tenantId]
  );
}

async function getJob(jobId) {
  await ensureSchema();
  return db.queryOne(`SELECT * FROM sp_audit_jobs WHERE id=? LIMIT 1`, [jobId]);
}

/** How many jobs are currently running (across all tenants). */
async function countRunning() {
  await ensureSchema();
  const row = await db.queryOne(`SELECT COUNT(*) AS n FROM sp_audit_jobs WHERE status='running'`);
  return row ? Number(row.n) : 0;
}

/**
 * Jobs for the Audits tab: all active (queued/running) plus terminal jobs
 * finished within `recentHours`. Ordered running → queued → recent terminal.
 */
async function listJobsForTenant(tenantId, recentHours = 48) {
  await ensureSchema();
  return db.queryRows(
    `SELECT * FROM sp_audit_jobs
      WHERE tenant_id = ?
        AND (status IN ('queued','running')
             OR finished_at >= (UTC_TIMESTAMP(3) - INTERVAL ? HOUR))
      ORDER BY FIELD(status,'running','queued','failed','done','cancelled'),
               queued_at DESC`,
    [tenantId, recentHours]
  );
}

/**
 * Fleet variant of listJobsForTenant: jobs across ALL tenants, joined to the
 * tenant display name for the "Show all tenant jobs" view.
 */
async function listAllJobs(recentHours = 48) {
  await ensureSchema();
  return db.queryRows(
    `SELECT j.*, t.display_name AS tenant_name
       FROM sp_audit_jobs j
       JOIN tenants t ON t.id = j.tenant_id
      WHERE j.status IN ('queued','running')
         OR j.finished_at >= (UTC_TIMESTAMP(3) - INTERVAL ? HOUR)
      ORDER BY FIELD(j.status,'running','queued','failed','done','cancelled'),
               j.queued_at DESC`,
    [recentHours]
  );
}

/** Cancel ALL queued jobs across ALL tenants. Returns count cancelled. */
async function cancelAllQueuedFleet() {
  await ensureSchema();
  return db.execute(
    `UPDATE sp_audit_jobs SET status='cancelled', finished_at=UTC_TIMESTAMP(3) WHERE status='queued'`
  );
}

/**
 * Boot recovery: jobs left 'running' by a crashed/restarted process didn't
 * finish. Audits are safely re-runnable, so requeue them (they resume) rather
 * than failing them. Returns count requeued.
 */
async function recoverStrandedJobs() {
  await ensureSchema();
  const n = await db.execute(
    `UPDATE sp_audit_jobs
        SET status='queued', started_at=NULL, claim_token=NULL,
            items_processed=0, progress_message='Requeued after restart'
      WHERE status='running'`
  );
  if (n > 0) console.log(`[SpAuditJobs] Requeued ${n} stranded running job(s) after restart`);
  return n;
}

module.exports = {
  STATUS,
  ensureSchema,
  enqueueJob,
  claimNextJob,
  updateProgress,
  completeJob,
  failJob,
  cancelJob,
  cancelAllQueued,
  cancelAllQueuedFleet,
  getJob,
  countRunning,
  listJobsForTenant,
  listAllJobs,
  recoverStrandedJobs,
};
