/**
 * Panoptica365 — Bundle deployment API (Phase 3: deploy engine)
 *
 * Thin HTTP surface over lib/bundle-deploy-jobs.js:
 *
 *   POST   /api/bundle-deployments            Submit = create + preflight (SAFE, no Graph writes)
 *   GET    /api/bundle-deployments            Job list w/ rollups (Job Queue tab)
 *   GET    /api/bundle-deployments/:id        Job detail w/ per-tenant/per-item ledger
 *   PATCH  /api/bundle-deployments/:id/items  Operator overwrite/skip resolution (armed jobs only)
 *   POST   /api/bundle-deployments/:id/start  Deploy — the one scary button (armed → running ONLY)
 *   POST   /api/bundle-deployments/:id/cancel Cancel a preflight/armed job
 *
 * There is deliberately NO route that bypasses preflight: the ledger's state
 * machine (startDeployment refuses anything but `armed`, and only
 * runPreflight arms) enforces it below the HTTP layer.
 *
 * RBAC: reads all roles; mutations operator (member) + admin. Every
 * submit/start/cancel audited with the resolved target expansion.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const mspAudit = require('../msp-audit');
const jobs = require('../lib/bundle-deploy-jobs');

const router = express.Router();
router.use(auth.requireAuth);

router.use(async (req, res, next) => {
  try {
    await jobs.whenReady();
    next();
  } catch (err) {
    res.status(503).json({ error: 'Bundle-deploy module not ready — schema migration failed.' });
  }
});

function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ERR_STATUS = {
  unknown_bundle: 404,
  empty_bundle: 400,
  unknown_tenant: 400,
  unknown_group: 400,
  invalid_target_kind: 400,
  empty_targets: 400,
  invalid_action: 400,
  no_items: 400,
  not_found: 404,
  not_armed: 409,
  not_cancellable: 409,
};

function sendErr(res, err) {
  const status = ERR_STATUS[err.code] || 500;
  if (status === 500) console.error('[BundleDeployAPI] Unexpected:', err.message);
  res.status(status).json({ error: err.code || 'internal_error', message: err.message });
}

// ── Submit: build + preflight only (no Graph writes) ──
router.post('/', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const bundleId = toId(req.body?.bundle_id);
    const targetKind = req.body?.target_kind;
    const rawIds = Array.isArray(req.body?.target_ids) ? req.body.target_ids : [];
    const targetIds = [...new Set(rawIds.map(toId))];
    if (!bundleId) return res.status(400).json({ error: 'invalid_bundle_id' });
    if (targetKind !== 'tenant' && targetKind !== 'group') return res.status(400).json({ error: 'invalid_target_kind' });
    if (targetIds.length === 0 || targetIds.some(x => x === null)) return res.status(400).json({ error: 'invalid_target_ids' });

    const createdBy = req.session.user?.email || 'unknown';
    const { jobId, tenantCount, itemCount } = await jobs.createDeployment({ bundleId, targetKind, targetIds, createdBy });

    // Preflight runs async (it does per-tenant token checks); the UI polls
    // the job and watches preflight → armed. An infrastructure failure
    // CLOSES the job as failed with the reason on its items — a job must
    // never sit in `preflight` forever with no visible error.
    jobs.runPreflight(jobId).catch(err => {
      console.error(`[BundleDeployAPI] Preflight for job ${jobId} failed:`, err.message);
      jobs.failPreflight(jobId, err.message).catch(e2 =>
        console.error(`[BundleDeployAPI] failPreflight(${jobId}) also failed:`, e2.message)
      );
    });

    const job = await jobs.getJob(jobId);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      action: 'org.bundle.deploy.submit',
      description: `Submitted bundle deployment #${jobId} ("${job?.bundle_name}") — ${tenantCount} tenant(s), ${itemCount} item(s)`,
      templateKey: 'org.bundle.deploy.submit',
      templateParams: { bundle: job?.bundle_name || String(bundleId), tenants: tenantCount, items: itemCount },
      targetType: 'setting',
      targetId: String(jobId),
      targetName: job?.bundle_name || null,
      metadata: { target_summary: job?.target_summary || null },
      req,
    }).catch(() => {});

    res.status(201).json({ id: jobId, tenant_count: tenantCount, item_count: itemCount });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── Job list (Job Queue tab) ──
router.get('/', async (req, res) => {
  try {
    res.json(await jobs.listJobs(req.query.limit));
  } catch (err) {
    console.error('[BundleDeployAPI] List failed:', err.message);
    res.status(500).json({ error: 'Failed to load deployment jobs' });
  }
});

// ── Job detail (collapsible Job ▸ Tenant ▸ Setting) ──
router.get('/:id', async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const job = await jobs.getJob(id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(job);
  } catch (err) {
    console.error('[BundleDeployAPI] Get failed:', err.message);
    res.status(500).json({ error: 'Failed to load deployment job' });
  }
});

// ── Operator overwrite/skip resolution (armed jobs only) ──
router.patch('/:id/items', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const { item_ids, all_skip_present, action } = req.body || {};
    const result = await jobs.setItemActions(id, {
      itemIds: item_ids,
      allSkipPresent: all_skip_present === true,
      action,
    });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

// ── Deploy (armed → running; the ledger refuses anything else) ──
router.post('/:id/start', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    await jobs.startDeployment(id);

    const job = await jobs.getJob(id);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      action: 'org.bundle.deploy.start',
      description: `Started bundle deployment #${id} ("${job?.bundle_name}") — live writes begin`,
      templateKey: 'org.bundle.deploy.start',
      templateParams: {
        bundle: job?.bundle_name || String(id),
        tenants: job?.target_summary?.tenants?.length || 0,
      },
      targetType: 'setting',
      targetId: String(id),
      targetName: job?.bundle_name || null,
      metadata: { target_summary: job?.target_summary || null },
      req,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── Cancel (preflight/armed only — running jobs finish their ledger) ──
router.post('/:id/cancel', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    await jobs.cancelJob(id);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      action: 'org.bundle.deploy.cancel',
      description: `Cancelled bundle deployment #${id} before any writes`,
      templateKey: 'org.bundle.deploy.cancel',
      templateParams: { job: String(id) },
      targetType: 'setting',
      targetId: String(id),
      req,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
