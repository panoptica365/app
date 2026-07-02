/**
 * Panoptica365 — Bundle deployment worker (Phase 3: deploy engine, §3.6)
 *
 * Executes `running` bundle_deployments jobs. Loop mechanics copied from
 * sp-audit-worker.js (setInterval tick + in-flight set). Execution rules
 * locked with Jacques:
 *
 *   - STRICTLY SERIAL within a tenant — each item must return before the
 *     next starts.
 *   - Small bounded concurrency ACROSS tenants: BUNDLE_DEPLOY_TENANT_CONCURRENCY
 *     env var, default 2. One constant — set to 1 for fully serial if
 *     throttling bites.
 *   - 429/Retry-After backoff is inherited from graph.callGraph (every Graph
 *     call in the reused deploy paths goes through it).
 *   - Consent is RE-CHECKED per tenant at execution time (preflight can go
 *     stale); a failed re-check fails that tenant's items gracefully and the
 *     rest of the job proceeds.
 *   - Partial failure is the expected case: every item records its own
 *     exec_status/exec_error; the job finishes 'done' unless EVERY item failed.
 *
 * REUSE, not reimplementation: CA items go through api-ca's
 * deployCaAssignment/remediatePolicy; Intune items through api-intune's
 * deployIntuneTemplateCore — the same code paths as the dashboard buttons,
 * so bundle-deployed policies are byte-identical to hand-deployed ones and
 * show up in the existing tabs/drift monitoring unchanged.
 */

'use strict';

const db = require('./db/database');
const auth = require('./auth');
const graph = require('./graph');
const jobs = require('./lib/bundle-deploy-jobs');
const workerHeartbeat = require('./worker-heartbeat');
const mspAudit = require('./msp-audit');
const caApi = require('./routes/api-ca');
const intuneApi = require('./routes/api-intune');

const TENANT_CONCURRENCY = Math.max(1, parseInt(process.env.BUNDLE_DEPLOY_TENANT_CONCURRENCY, 10) || 2);
const POLL_INTERVAL_MS = 3 * 1000;
const FIRST_RUN_DELAY_MS = 25 * 1000;
const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let loopHandle = null;
let stopRequested = false;
let lastHeartbeat = 0;
let lastPrune = 0;
const processingJobs = new Set(); // job ids currently owned by this process

// ─────────────────────────────────────────────────────────────────────────
// Item execution — one item, one reused deploy path
// ─────────────────────────────────────────────────────────────────────────

const CA_STATE_TO_GRAPH = {
  report_only: 'enabledForReportingButNotEnforced',
  enabled: 'enabled',
};

// Item options (ca_state / assignment_target / alert_routing) come from the
// SNAPSHOT taken at submit time (bundle_deployment_items columns) — what the
// operator reviewed and armed is exactly what executes, even if the bundle
// was edited in between.

async function execCaItem(item, tenant, createdBy) {
  const existing = await db.queryOne(
    'SELECT id, live_policy_id FROM ca_assignments WHERE template_id = ? AND tenant_id = ?',
    [item.template_id, item.tenant_id]
  );

  if (item.action === 'overwrite') {
    // Overwrite = the EXISTING safe update path (remediate: PATCH monitored
    // fields on the live policy). Never delete-recreate a live CA policy.
    if (!existing || !existing.live_policy_id) {
      throw new Error('Overwrite requested but no live policy is linked anymore — re-run preflight (new job) and deploy as create.');
    }
    const assignment = await db.queryOne(
      `SELECT a.*, t.policy_json, t.monitored_fields, t.name AS template_name,
              t.alert_routing AS template_alert_routing, tn.tenant_id AS azure_tenant_id
         FROM ca_assignments a
         JOIN ca_templates t ON t.id = a.template_id
         JOIN tenants tn ON tn.id = a.tenant_id
        WHERE a.id = ?`,
      [existing.id]
    );
    let livePol = null;
    try {
      livePol = await graph.callGraph(
        assignment.azure_tenant_id,
        `/identity/conditionalAccess/policies/${assignment.live_policy_id}`,
        { version: 'v1.0' }
      );
    } catch (_) { /* best-effort — remediate tolerates a missing live read */ }
    const result = await caApi.remediatePolicy(assignment, livePol, createdBy, {});
    if (!result || result.success !== true) {
      throw new Error((result && result.message) || 'Remediate did not report success');
    }
    // Routing override applied only AFTER a successful write — a failed
    // overwrite must not mutate the assignment's alerting config.
    if (item.alert_routing) {
      await db.execute('UPDATE ca_assignments SET alert_routing = ? WHERE id = ?', [item.alert_routing, existing.id]);
    }
    return;
  }

  // action === 'create'
  let assignmentId;
  if (existing) {
    if (existing.live_policy_id) {
      // Present since preflight (stale) — honor the skip-by-default rule.
      throw Object.assign(new Error('Policy appeared on the tenant after preflight — skipped (re-run to overwrite).'), { becameSkip: true });
    }
    assignmentId = existing.id;
  } else {
    assignmentId = await db.insert(
      'INSERT INTO ca_assignments (template_id, tenant_id, enforcement, alert_routing) VALUES (?, ?, \'monitor\', ?)',
      [item.template_id, item.tenant_id, item.alert_routing || null]
    );
  }

  const assignment = await caApi.loadAssignmentForDeploy(assignmentId);
  if (!assignment) throw new Error('Assignment row vanished before deploy');
  const result = await caApi.deployCaAssignment(assignment, {
    createdBy,
    stateOverride: CA_STATE_TO_GRAPH[item.ca_state] || CA_STATE_TO_GRAPH.report_only,
  });
  if (!result || result.success !== true) {
    throw new Error((result && result.message) || 'Deploy did not report success');
  }
  // Pre-existing (never-deployed) assignment rows get the bundle's routing
  // only after the deploy actually landed.
  if (existing && item.alert_routing) {
    await db.execute('UPDATE ca_assignments SET alert_routing = ? WHERE id = ?', [item.alert_routing, assignmentId]);
  }
}

async function execIntuneItem(item, tenant, createdBy) {
  // Both create and overwrite go through the same core — it self-detects an
  // existing policy and takes the established update path (PATCH for legacy
  // types; merge-and-recreate for Settings Catalog, the documented hazard
  // that makes Overwrite an explicit opt-in).
  const r = await intuneApi.deployIntuneTemplateCore({
    templateId: item.template_id,
    tenantId: item.tenant_id,
    assignmentTarget: item.assignment_target, // bundle-item snapshot wins at deploy (locked)
    deployedBy: createdBy,
    actorContext: {},
  });
  const body = r && r.body ? r.body : {};
  // The policy itself landed whenever deployedPolicyId is present — apply the
  // routing override even on a 207 (assignment/verification warning), so a
  // partial outcome still carries the bundle's alerting choice.
  if (item.alert_routing && body.deploymentId && body.deployedPolicyId) {
    await db.execute('UPDATE intune_deployments SET alert_routing = ? WHERE id = ?', [item.alert_routing, body.deploymentId]);
  }
  if (!body.success) {
    const details = [body.error, ...(body.warnings || [])].filter(Boolean).join('; ');
    throw new Error(details || `Deploy returned HTTP ${r ? r.httpStatus : '?'} without success`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Per-tenant serial execution
// ─────────────────────────────────────────────────────────────────────────

async function markItem(itemId, execStatus, execError) {
  await db.execute(
    `UPDATE bundle_deployment_items
        SET exec_status = ?, exec_error = ?, finished_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [execStatus, execError ? String(execError).slice(0, 2000) : null, itemId]
  );
}

async function processTenant(job, tenant, tenantItems) {
  // Execution-time re-checks — preflight can go stale (§3.6).
  // (1) Managed/enabled gate (a tenant demoted between arm and deploy must
  //     not receive live writes); (2) consent/token.
  if (!tenant.enabled || tenant.mode !== 'managed') {
    const reason = !tenant.enabled ? 'disabled' : 'audit-only';
    for (const it of tenantItems) {
      if (it.action === 'skip') await markItem(it.id, 'skipped', null);
      else await markItem(it.id, 'failed', `Tenant became ${reason} after preflight — bundle deployments only target managed, enabled tenants.`);
    }
    return;
  }
  try {
    await auth.acquireTokenForTenant(tenant.tenant_id);
  } catch (err) {
    for (const it of tenantItems) {
      if (it.action === 'skip') await markItem(it.id, 'skipped', null);
      else await markItem(it.id, 'failed', `Consent/token check failed at execution: ${err.message}`);
    }
    return;
  }

  // Strictly serial within the tenant: CA first, then Intune, stable order.
  for (const it of tenantItems) {
    if (stopRequested) return; // shutdown: leave remaining items pending for boot recovery
    if (it.action === 'skip' || !it.action) {
      await markItem(it.id, 'skipped', null);
      continue;
    }
    try {
      if (it.item_type === 'ca') {
        await execCaItem(it, tenant, job.created_by || 'bundle-deploy');
      } else {
        await execIntuneItem(it, tenant, job.created_by || 'bundle-deploy');
      }
      await markItem(it.id, 'success', null);
    } catch (err) {
      if (err && err.becameSkip) {
        await markItem(it.id, 'skipped', err.message);
      } else {
        console.error(`[BundleDeploy] Item ${it.id} (${it.item_type} t${it.template_id} → tenant ${it.tenant_id}) failed:`, err.message);
        await markItem(it.id, 'failed', err.message);
      }
      // Partial failure is expected — carry on with the next item.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Job processing — bounded tenant concurrency
// ─────────────────────────────────────────────────────────────────────────

async function processJob(job) {
  console.log(`[BundleDeploy] Job ${job.id} ("${job.bundle_name || job.bundle_id}") starting — tenant concurrency ${TENANT_CONCURRENCY}`);

  const items = await db.queryRows(
    `SELECT i.* FROM bundle_deployment_items i
      WHERE i.deployment_id = ? AND i.exec_status = 'pending'
      ORDER BY i.tenant_id, i.item_type, i.template_id`,
    [job.id]
  );

  const byTenant = new Map();
  for (const it of items) {
    if (!byTenant.has(it.tenant_id)) byTenant.set(it.tenant_id, []);
    byTenant.get(it.tenant_id).push(it);
  }

  // Bounded worker pool over tenants (serial inside each tenant).
  const tenantIds = [...byTenant.keys()];
  let cursor = 0;
  const runNext = async () => {
    while (!stopRequested) {
      const idx = cursor++;
      if (idx >= tenantIds.length) return;
      const tenantId = tenantIds[idx];
      const tenant = await db.queryOne('SELECT id, tenant_id, display_name, enabled, mode FROM tenants WHERE id = ?', [tenantId]);
      if (!tenant) {
        for (const it of byTenant.get(tenantId)) await markItem(it.id, 'failed', 'Tenant no longer exists');
        continue;
      }
      try {
        await processTenant(job, tenant, byTenant.get(tenantId));
      } catch (err) {
        console.error(`[BundleDeploy] Tenant ${tenantId} lane crashed:`, err.message);
        for (const it of byTenant.get(tenantId)) {
          await db.execute(
            `UPDATE bundle_deployment_items SET exec_status = 'failed', exec_error = ?, finished_at = UTC_TIMESTAMP()
              WHERE id = ? AND exec_status = 'pending'`,
            [`Tenant lane crashed: ${err.message}`.slice(0, 2000), it.id]
          ).catch(() => {});
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TENANT_CONCURRENCY, tenantIds.length) }, runNext));

  if (stopRequested) return; // boot recovery will close the job honestly

  // ── Completion: done unless EVERY item failed (§3.6) ──
  const tally = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(exec_status = 'failed')  AS failed,
            SUM(exec_status = 'success') AS success,
            SUM(exec_status = 'skipped') AS skipped
       FROM bundle_deployment_items WHERE deployment_id = ?`,
    [job.id]
  );
  const finalStatus = tally.total > 0 && Number(tally.failed) === Number(tally.total) ? 'failed' : 'done';
  await db.execute(
    "UPDATE bundle_deployments SET status = ?, finished_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'running'",
    [finalStatus, job.id]
  );
  console.log(`[BundleDeploy] Job ${job.id} ${finalStatus} — ${tally.success} ok, ${tally.failed} failed, ${tally.skipped} skipped of ${tally.total}`);

  mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.TENANT_CONFIG,
    action: 'org.bundle.deploy.finished',
    description: `Bundle deployment #${job.id} finished (${finalStatus}) — ${tally.success} ok, ${tally.failed} failed, ${tally.skipped} skipped`,
    templateKey: 'org.bundle.deploy.finished',
    templateParams: {
      bundle: job.bundle_name || String(job.bundle_id),
      status: finalStatus,
      ok: Number(tally.success) || 0,
      failed: Number(tally.failed) || 0,
      skipped: Number(tally.skipped) || 0,
    },
    targetType: 'setting',
    targetId: String(job.id),
    targetName: job.bundle_name || null,
    actorEmail: job.created_by || null,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────────────────────────────────

async function tick() {
  if (stopRequested) return;
  // Schema gate first: drives the migration retry after a failed boot and
  // keeps a missing-table state from spamming a scan error every 3 seconds
  // (both happened at a customer on the 0.3.0 boot race).
  try {
    await jobs.whenReady();
  } catch (err) {
    workerHeartbeat.stampError('bundle_deploy', `schema not ready: ${err.message}`);
    return;
  }
  const now = Date.now();
  if (now - lastHeartbeat > HEARTBEAT_THROTTLE_MS) {
    workerHeartbeat.stampStart('bundle_deploy');
    lastHeartbeat = now;
  }
  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    lastPrune = now;
    jobs.pruneOldJobs().catch(err => console.warn('[BundleDeploy] prune failed:', err.message));
  }

  let running;
  try {
    running = await db.queryRows(
      `SELECT d.*, b.name AS bundle_name
         FROM bundle_deployments d
         JOIN config_bundles b ON b.id = d.bundle_id
        WHERE d.status = 'running'`
    );
  } catch (err) {
    console.error('[BundleDeploy] job scan failed:', err.message);
    workerHeartbeat.stampError('bundle_deploy', err.message);
    return;
  }

  // ONE job at a time, oldest first. Serializing jobs guarantees "strictly
  // serial within a tenant" holds globally — two overlapping jobs hitting
  // the same tenant can otherwise race the CA create path into duplicate
  // live policies. Queued jobs simply wait their turn.
  if (processingJobs.size > 0) return;
  const job = running.sort((a, b) => new Date(a.started_at || 0) - new Date(b.started_at || 0))[0];
  if (!job) return;

  processingJobs.add(job.id);
  const startedAt = Date.now();
  processJob(job)
    .then(() => workerHeartbeat.stampSuccess('bundle_deploy', Date.now() - startedAt))
    .catch(err => {
      console.error(`[BundleDeploy] processJob ${job.id} crashed:`, err.message);
      workerHeartbeat.stampError('bundle_deploy', err.message);
      // Close the job honestly rather than leaving a running orphan — and
      // sweep its still-pending items so nothing shows "pending" forever.
      db.execute(
        `UPDATE bundle_deployment_items
            SET exec_status = 'skipped', exec_error = ?, finished_at = UTC_TIMESTAMP()
          WHERE deployment_id = ? AND exec_status = 'pending'`,
        [`Job crashed before this item ran: ${String(err.message).slice(0, 500)}`, job.id]
      ).catch(() => {});
      db.execute(
        "UPDATE bundle_deployments SET status = 'failed', finished_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'running'",
        [job.id]
      ).catch(() => {});
    })
    .finally(() => processingJobs.delete(job.id));
}

function start() {
  if (loopHandle) {
    console.warn('[BundleDeploy] start called twice — ignoring');
    return;
  }
  stopRequested = false;
  console.log(`[BundleDeploy] Starting (tenant concurrency ${TENANT_CONCURRENCY}, poll ${POLL_INTERVAL_MS / 1000}s)`);
  const first = setTimeout(() => {
    tick().catch(err => console.error('[BundleDeploy] Initial tick failed:', err.message));
    loopHandle = setInterval(() => {
      tick().catch(err => console.error('[BundleDeploy] Tick failed:', err.message));
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
  }
  console.log('[BundleDeploy] Stopped (in-flight items finish or are recovered at next boot)');
}

module.exports = { start, stop };
