/**
 * Panoptica365 — SharePoint Audit API routes
 * Mirrors the Tabula Accessus endpoints but:
 *   - Uses Panoptica's existing authenticated session (auth.requireAuth)
 *   - Gets tenant credentials from the MySQL `tenants` table (via id or tenant_id)
 *   - Persists audits to MySQL `sp_audits` (instead of JSON files)
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const sp = require('../lib/sharepoint-graph');
const { generateLibraryPermissionsPDF, generateUserPermissionsPDF } = require('../lib/sharepoint-pdf');
const auditJobs = require('../lib/sharepoint-audit-jobs');

const router = express.Router();

// All routes require an authenticated session
router.use(auth.requireAuth);

// ─── Tenant resolution helper ───────────────────────────────────────────────
// Accepts either the numeric DB id or the Azure tenant GUID.
async function resolveTenant(idOrGuid) {
  if (!idOrGuid) return null;
  const isGuid = /^[0-9a-f-]{36}$/i.test(String(idOrGuid));
  const sql = isGuid
    ? 'SELECT id, tenant_id, display_name, language FROM tenants WHERE tenant_id = ? LIMIT 1'
    : 'SELECT id, tenant_id, display_name, language FROM tenants WHERE id = ? LIMIT 1';
  return db.queryOne(sql, [idOrGuid]);
}

// ─── Preflight: permissions check ───────────────────────────────────────────

router.get('/preflight/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const r = await sp.preflight(t.tenant_id);
    res.json({ tenant: t.display_name, ...r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Inventory ──────────────────────────────────────────────────────────────

router.get('/inventory/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const inventory = await sp.getInventory(t.tenant_id);
    // Attach last-audit timestamps (sp_audits is keyed per site + drive). Site
    // rows show the most recent audit across their libraries; drive rows show
    // their own. finished_at preferred, started_at as fallback (matches the
    // audit-list endpoint). #11
    const auditRows = await db.queryRows(
      `SELECT site_id, drive_id, MAX(COALESCE(finished_at, started_at)) AS last_audit
         FROM sp_audits WHERE tenant_id = ? AND status = 'complete'
         GROUP BY site_id, drive_id`,
      [t.id]
    );
    const byDrive = new Map();
    const bySite = new Map();
    for (const r of auditRows) {
      if (r.drive_id) byDrive.set(r.drive_id, r.last_audit);
      const prev = bySite.get(r.site_id);
      if (!prev || new Date(r.last_audit) > new Date(prev)) bySite.set(r.site_id, r.last_audit);
    }
    for (const site of inventory) {
      site.lastAuditAt = bySite.get(site.id) || null;
      for (const d of site.drives || []) d.lastAuditAt = byDrive.get(d.id) || null;
    }
    res.json({
      tenantId: t.id,
      tenantGuid: t.tenant_id,
      tenantName: t.display_name,
      siteCount: inventory.length,
      totalDrives: inventory.reduce((s, x) => s + x.driveCount, 0),
      inventory,
    });
  } catch (err) {
    console.error('[SP] Inventory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sites/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const sites = await sp.listSites(t.tenant_id);
    res.json({ count: sites.length, sites });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Audit jobs: enqueue / list / cancel ────────────────────────────────────
// v0.2.26 — audits are tracked background jobs (sp_audit_jobs), drained by
// src/sp-audit-worker.js at bounded concurrency. Enqueuing NEVER navigates the
// operator anywhere (fixes #12); the Audits tab is the status surface.

function mapJob(r) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name || null,
    siteId: r.site_id,
    siteName: r.site_name,
    libraryId: r.library_id,
    libraryName: r.library_name,
    status: r.status,
    origin: r.origin,
    requestedBy: r.requested_by,
    auditId: r.audit_id,
    itemsTotal: Number(r.items_total || 0),
    itemsProcessed: Number(r.items_processed || 0),
    progressMessage: r.progress_message,
    error: r.error,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function siteNameFromUrl(siteUrl, fallback) {
  try { return new URL(siteUrl).pathname.split('/').filter(Boolean).pop() || fallback; } catch { return fallback; }
}

// Enqueue ONE library audit. Replaces the old POST /audit fire-and-forget.
router.post('/audit-jobs/:tenantId/library', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  const { siteId, driveId, driveName, siteUrl } = req.body || {};
  if (!siteId || !driveId) return res.status(400).json({ error: 'Required: siteId, driveId' });
  try {
    const by = (req.session && req.session.user && req.session.user.email) || null;
    const r = await auditJobs.enqueueJob({
      tenantId: t.id, siteId, siteName: siteNameFromUrl(siteUrl, siteId), siteUrl,
      libraryId: driveId, libraryName: driveName || driveId, origin: 'single', requestedBy: by,
    });
    res.json({ enqueued: r.skipped ? 0 : 1, skipped: r.skipped ? 1 : 0, jobId: r.jobId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Enqueue one job per document library in a SITE.
router.post('/audit-jobs/:tenantId/site', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  const { siteId, siteUrl } = req.body || {};
  if (!siteId) return res.status(400).json({ error: 'Required: siteId' });
  try {
    const siteName = req.body.siteName || siteNameFromUrl(siteUrl, siteId);
    const drives = await sp.listDrives(t.tenant_id, siteId);
    const by = (req.session && req.session.user && req.session.user.email) || null;
    let enqueued = 0, skipped = 0;
    for (const d of drives) {
      const r = await auditJobs.enqueueJob({
        tenantId: t.id, siteId, siteName, siteUrl, libraryId: d.id, libraryName: d.name,
        origin: 'site', requestedBy: by,
      });
      r.skipped ? skipped++ : enqueued++;
    }
    res.json({ enqueued, skipped, libraries: drives.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Enqueue one job per document library across ALL sites in the selected tenant.
router.post('/audit-jobs/:tenantId/all', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const inventory = await sp.getInventory(t.tenant_id);
    const by = (req.session && req.session.user && req.session.user.email) || null;
    let enqueued = 0, skipped = 0, libraries = 0, sites = 0;
    for (const site of inventory) {
      if (!site.drives || site.drives.length === 0) continue;
      sites++;
      for (const d of site.drives) {
        libraries++;
        const r = await auditJobs.enqueueJob({
          tenantId: t.id, siteId: site.id, siteName: site.displayName || site.name,
          siteUrl: site.webUrl, libraryId: d.id, libraryName: d.name, origin: 'global', requestedBy: by,
        });
        r.skipped ? skipped++ : enqueued++;
      }
    }
    res.json({ enqueued, skipped, libraries, sites });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fleet view: jobs across ALL tenants (with tenant name) — "Show all tenant
// jobs". Distinct path so it never collides with /audit-jobs/:tenantId.
router.get('/audit-jobs-fleet', async (req, res) => {
  try {
    const rows = await auditJobs.listAllJobs(48);
    res.json(rows.map(mapJob));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel ALL queued jobs across ALL tenants (fleet safety valve).
router.post('/audit-jobs-fleet/cancel-queued', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const cancelled = await auditJobs.cancelAllQueuedFleet();
    res.json({ cancelled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List jobs for the Audits tab (active + terminal within the retention window).
router.get('/audit-jobs/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const rows = await auditJobs.listJobsForTenant(t.id, 48);
    res.json(rows.map(mapJob));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel ALL queued jobs for the tenant (safety valve after a big Audit-All).
router.post('/audit-jobs/:tenantId/cancel-queued', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const cancelled = await auditJobs.cancelAllQueued(t.id);
    res.json({ cancelled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel ONE queued job (running jobs are left to finish).
router.post('/audit-jobs/:tenantId/:jobId/cancel', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const ok = await auditJobs.cancelJob(t.id, parseInt(req.params.jobId, 10));
    if (!ok) return res.status(409).json({ error: 'Job is not queued (already running/finished)' });
    res.json({ cancelled: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audits/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const rows = await db.queryRows(
      `SELECT id, site_id, site_name, drive_id, drive_name, started_at, finished_at,
              status, folders_scanned, library_size, explicit_count
         FROM sp_audits
        WHERE tenant_id=? AND status='complete'
        ORDER BY started_at DESC`,
      [t.id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      siteId: r.site_id,
      siteName: r.site_name,
      driveId: r.drive_id,
      driveName: r.drive_name,
      timestamp: r.finished_at || r.started_at,
      foldersScanned: r.folders_scanned,
      librarySize: Number(r.library_size || 0),
      explicitCount: r.explicit_count,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audit-data/:auditId', async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT a.*, t.display_name AS tenant_display_name, t.tenant_id AS tenant_guid
         FROM sp_audits a JOIN tenants t ON t.id=a.tenant_id
        WHERE a.id=?`,
      [req.params.auditId]
    );
    if (!row) return res.status(404).json({ error: 'Audit not found' });
    if (!row.result_json) return res.status(409).json({ error: 'Audit has no result yet' });
    const data = JSON.parse(row.result_json);
    data.tenantName = row.tenant_display_name;
    data.tenantGuid = row.tenant_guid;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// A3 (May 9, 2026): operator — clear audit history for a tenant.
router.delete('/audits/:tenantId', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const n = await db.execute('DELETE FROM sp_audits WHERE tenant_id=?', [t.id]);
    console.log(`[SP] Deleted ${n} audits for tenant ${t.display_name}`);
    res.json({ deleted: n });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PDF exports ────────────────────────────────────────────────────────────

router.get('/export/library-pdf/:auditId', async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT a.*, t.display_name AS tenant_display_name, t.language AS tenant_language
         FROM sp_audits a JOIN tenants t ON t.id=a.tenant_id
        WHERE a.id=?`,
      [req.params.auditId]
    );
    if (!row || !row.result_json) return res.status(404).json({ error: 'Audit not found' });

    const data = JSON.parse(row.result_json);
    data.tenantName = row.tenant_display_name;

    const safe = (data.driveName || 'library').replace(/[^a-zA-Z0-9_-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Library_Permissions_${safe}_${date}.pdf"`);
    generateLibraryPermissionsPDF(data, res, row.tenant_language);
  } catch (err) {
    console.error('[SP PDF] Library error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.get('/export/user-pdf/:tenantId', async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const rows = await db.queryRows(
      `SELECT result_json FROM sp_audits WHERE tenant_id=? AND status='complete' AND result_json IS NOT NULL`,
      [t.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No audits found for this tenant' });

    const audits = rows.map(r => JSON.parse(r.result_json));
    const safeName = (t.display_name || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="User_Permissions_${safeName}_${date}.pdf"`);
    generateUserPermissionsPDF(audits, t.display_name, res, t.language);
  } catch (err) {
    console.error('[SP PDF] User error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Startup orphan sweep ─────────────────────────────────────────────────
// Marks any sp_audits stuck in 'running' as 'error' on boot. Needed because
// audit worker state is in-memory — a server restart strands the row.
(async () => {
  try {
    const n = await db.execute(
      `UPDATE sp_audits SET status='error',
              error_message='Server restarted before audit completed',
              finished_at=NOW()
        WHERE status='running'`
    );
    if (n > 0) console.log(`[SP] Startup sweep: marked ${n} stranded audit(s) as error`);
  } catch (e) {
    // Table may not exist yet on first deploy; ignore.
  }
})();

module.exports = router;
