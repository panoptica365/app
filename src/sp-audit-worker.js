/**
 * Panoptica365 — SharePoint audit worker.
 *
 * Drains the sp_audit_jobs queue at BOUNDED concurrency (default 3, env
 * SP_AUDIT_CONCURRENCY) and runs each job through the extracted audit runner.
 * Modelled on src/security-apply-worker.js (start/stop, poll loop, heartbeat,
 * boot recovery) but allows N concurrent jobs instead of 1.
 *
 * Priority note: audits run at a deliberately LOW concurrency so they never
 * starve the security-ingestion / drift workers competing for the same Graph
 * budget. Each Graph call already backs off on 429 via sharepoint-graph's
 * spRequest. A global Graph token bucket is deferred (see the build spec).
 */

'use strict';

const db = require('./db/database');
const jobs = require('./lib/sharepoint-audit-jobs');
const runner = require('./lib/sharepoint-audit-runner');
const workerHeartbeat = require('./worker-heartbeat');

const CONCURRENCY = Math.max(1, parseInt(process.env.SP_AUDIT_CONCURRENCY, 10) || 3);
const POLL_INTERVAL_MS = 3 * 1000;
const FIRST_RUN_DELAY_MS = 20 * 1000;
const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;

let loopHandle = null;
let stopRequested = false;
let lastHeartbeat = 0;
const inFlight = new Set();

async function processJob(job) {
  const startedAt = Date.now();
  try {
    const tenant = await db.queryOne(
      'SELECT id, tenant_id, display_name FROM tenants WHERE id = ? LIMIT 1',
      [job.tenant_id]
    );
    if (!tenant) {
      await jobs.failJob(job.id, 'Tenant not found (removed?)');
      return;
    }

    const onProgress = (p) => {
      jobs.updateProgress(job.id, {
        itemsTotal: p.foldersTotal,
        itemsProcessed: p.foldersScanned,
        message: p.message,
      });
    };

    const { auditId } = await runner.runLibraryAudit(
      tenant,
      {
        siteId: job.site_id,
        siteName: job.site_name,
        siteUrl: job.site_url,
        driveId: job.library_id,
        driveName: job.library_name,
      },
      onProgress
    );

    await jobs.completeJob(job.id, auditId);
    workerHeartbeat.stampSuccess('sp_audit', Date.now() - startedAt);
  } catch (err) {
    console.error(`[SpAuditWorker] Job ${job.id} (${job.library_name}) failed: ${err.message}`);
    await jobs.failJob(job.id, err.message).catch(() => {});
    workerHeartbeat.stampError('sp_audit', err.message);
  }
}

async function tick() {
  if (stopRequested) return;
  const now = Date.now();
  if (now - lastHeartbeat > HEARTBEAT_THROTTLE_MS) {
    workerHeartbeat.stampStart('sp_audit');
    lastHeartbeat = now;
  }
  // Fill open concurrency slots from the queue.
  while (!stopRequested && inFlight.size < CONCURRENCY) {
    let job;
    try {
      job = await jobs.claimNextJob();
    } catch (err) {
      console.error('[SpAuditWorker] claimNextJob failed:', err.message);
      break;
    }
    if (!job) break;
    const p = processJob(job).catch(e =>
      console.error('[SpAuditWorker] processJob crashed:', e.message)
    ).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
}

function start() {
  if (loopHandle) {
    console.warn('[SpAuditWorker] start called twice — ignoring');
    return;
  }
  stopRequested = false;
  console.log(`[SpAuditWorker] Starting (concurrency ${CONCURRENCY}, poll ${POLL_INTERVAL_MS / 1000}s)`);
  const first = setTimeout(() => {
    tick().catch(err => console.error('[SpAuditWorker] Initial tick failed:', err.message));
    loopHandle = setInterval(() => {
      tick().catch(err => console.error('[SpAuditWorker] Tick failed:', err.message));
    }, POLL_INTERVAL_MS);
    if (loopHandle.unref) loopHandle.unref();
  }, FIRST_RUN_DELAY_MS);
  if (first.unref) first.unref();
}

function stop() {
  stopRequested = true;
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
    console.log('[SpAuditWorker] Stopped claiming new jobs (in-flight jobs finish)');
  }
}

// _tick / _inFlight exposed for unit tests (drive one drain pass with fakes).
module.exports = { start, stop, _tick: tick, _inFlight: inFlight };
