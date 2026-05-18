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

const router = express.Router();

// All routes require an authenticated session
router.use(auth.requireAuth);

// ─── Tenant resolution helper ───────────────────────────────────────────────
// Accepts either the numeric DB id or the Azure tenant GUID.
async function resolveTenant(idOrGuid) {
  if (!idOrGuid) return null;
  const isGuid = /^[0-9a-f-]{36}$/i.test(String(idOrGuid));
  const sql = isGuid
    ? 'SELECT id, tenant_id, display_name FROM tenants WHERE tenant_id = ? LIMIT 1'
    : 'SELECT id, tenant_id, display_name FROM tenants WHERE id = ? LIMIT 1';
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

// ─── Audit: start / progress / list / fetch / delete ────────────────────────
// Tracks running audits in-memory; persists to DB on completion.

const auditSessions = new Map();   // auditDbId → progress snapshot

// A3 (May 9, 2026): operator — triggers SharePoint audit run.
router.post('/audit/:tenantId', auth.requireMemberOrAdmin, async (req, res) => {
  const t = await resolveTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });

  const { siteId, driveId, driveName, siteUrl } = req.body || {};
  if (!siteId || !driveId || !driveName || !siteUrl) {
    return res.status(400).json({ error: 'Required: siteId, driveId, driveName, siteUrl' });
  }

  let siteName = '';
  try { siteName = new URL(siteUrl).pathname.split('/').filter(Boolean).pop() || siteId; } catch { siteName = siteId; }

  const auditId = await db.insert(
    `INSERT INTO sp_audits (tenant_id, site_id, site_name, site_url, drive_id, drive_name, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`,
    [t.id, siteId, siteName, siteUrl, driveId, driveName]
  );

  const progress = {
    status: 'running',
    foldersTotal: 0,
    foldersScanned: 0,
    explicitCount: 0,
    message: 'Initializing audit...',
  };
  auditSessions.set(auditId, progress);

  // Fire-and-forget async crawl. Pass Express app so we can emit on completion.
  const app = req.app;
  runAudit(auditId, t, siteId, driveId, driveName, siteUrl, siteName, progress, app)
    .catch(err => {
      console.error('[SP Audit] Unhandled:', err.message);
      progress.status = 'error';
      progress.message = err.message;
      db.execute(
        `UPDATE sp_audits SET status='error', error_message=?, finished_at=NOW() WHERE id=?`,
        [err.message.substring(0, 500), auditId]
      ).catch(() => {});
      emitAuditEvent(app, 'sp:audit:error', {
        auditId, tenantId: t.id, driveName, message: err.message.substring(0, 200),
      });
    });

  res.json({ auditId });
});

function emitAuditEvent(app, eventName, payload) {
  try {
    const io = app.get('io');
    if (io) io.emit(eventName, payload);
  } catch (e) {
    console.error('[SP Audit] Socket emit failed:', e.message);
  }
}

router.get('/audit/:auditId/progress', (req, res) => {
  const p = auditSessions.get(parseInt(req.params.auditId, 10));
  if (p) return res.json(p);
  // Fall back to DB if session evicted (e.g. after restart or after 5-min TTL)
  db.queryOne('SELECT status, folders_scanned, explicit_count, error_message FROM sp_audits WHERE id=?', [req.params.auditId])
    .then(row => {
      if (!row) return res.status(404).json({ error: 'Audit not found' });
      res.json({
        status: row.status,
        foldersTotal: row.folders_scanned,
        foldersScanned: row.folders_scanned,
        explicitCount: row.explicit_count,
        message: row.status === 'complete' ? 'Audit complete.' : (row.error_message || 'Audit finished.'),
      });
    })
    .catch(err => res.status(500).json({ error: err.message }));
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
      `SELECT a.*, t.display_name AS tenant_display_name
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
    generateLibraryPermissionsPDF(data, res);
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
    generateUserPermissionsPDF(audits, t.display_name, res);
  } catch (err) {
    console.error('[SP PDF] User error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Async audit worker ─────────────────────────────────────────────────────

async function runAudit(auditId, tenantRow, siteId, driveId, driveName, siteUrl, siteName, progress, app) {
  const tenantGuid = tenantRow.tenant_id;

  progress.message = 'Resolving library...';
  const rootItem = await sp.getDriveRoot(tenantGuid, driveId);

  const librarySize = await sp.getDriveQuota(tenantGuid, driveId);
  // Verified domains — used to flag external users in normalizePermissions
  const verifiedDomains = await sp.getVerifiedDomains(tenantGuid);

  progress.message = 'Crawling folder tree...';
  let discovered = 0;
  const folders = await sp.crawlFolders(tenantGuid, driveId, 'root', '', 0, (c) => {
    discovered += c;
    progress.foldersTotal = discovered;
    progress.message = `Discovering folders... ${discovered} found`;
  });

  const allFolders = [
    { id: rootItem.id, name: '(root)', path: '/', depth: 0, webUrl: rootItem.webUrl },
    ...folders,
  ];
  progress.foldersTotal = allFolders.length;
  progress.message = `Reading permissions on ${allFolders.length} folders...`;

  // Baseline from root
  const rootPerms = await sp.getItemPermissions(tenantGuid, driveId, rootItem.id);
  const baselineNorm = sp.normalizePermissions(rootPerms.allPermissions, verifiedDomains);
  const baselinePermissions = await sp.resolvePermissionMembers(tenantGuid, baselineNorm);

  // Explicit permission detection
  const foldersWithExplicitPermissions = [];
  let scanned = 0;
  const CONC = 5;

  for (let i = 0; i < allFolders.length; i += CONC) {
    const batch = allFolders.slice(i, i + CONC);
    await Promise.all(batch.map(async f => {
      if (f.id === rootItem.id) {
        scanned++;
        progress.foldersScanned = scanned;
        return;
      }
      try {
        const p = await sp.getItemPermissions(tenantGuid, driveId, f.id);
        if (p.uniquePermissions.length > 0) {
          const norm = sp.normalizePermissions(p.allPermissions, verifiedDomains);
          const resolved = await sp.resolvePermissionMembers(tenantGuid, norm);
          foldersWithExplicitPermissions.push({
            folderPath: f.path || f.name,
            folderName: f.name,
            depth: f.depth,
            roleAssignments: resolved,
          });
          progress.explicitCount = foldersWithExplicitPermissions.length;
        }
      } catch (e) {
        console.log(`[SP Audit] Perm err on ${f.name}: ${e.message.substring(0, 100)}`);
      }
      scanned++;
      progress.foldersScanned = scanned;
      progress.message = `Scanning ${scanned}/${allFolders.length} (${foldersWithExplicitPermissions.length} explicit)`;
    }));
  }

  foldersWithExplicitPermissions.sort((a, b) => a.folderPath.localeCompare(b.folderPath));

  const result = {
    tenantId: tenantGuid,
    tenantName: tenantRow.display_name,
    siteId, siteName, siteUrl,
    driveId, driveName,
    timestamp: new Date().toISOString(),
    foldersScanned: allFolders.length,
    librarySize,
    baselinePermissions,
    foldersWithExplicitPermissions,
  };

  await db.execute(
    `UPDATE sp_audits SET status='complete', finished_at=NOW(),
            folders_scanned=?, library_size=?, explicit_count=?, result_json=?
      WHERE id=?`,
    [
      allFolders.length,
      librarySize,
      foldersWithExplicitPermissions.length,
      JSON.stringify(result),
      auditId,
    ]
  );

  progress.status = 'complete';
  progress.foldersScanned = allFolders.length;
  progress.message = `Audit complete. ${allFolders.length} folders, ${foldersWithExplicitPermissions.length} explicit.`;

  // Notify any connected Panoptica session so a toast can fire even if the
  // user closed the modal and navigated away.
  emitAuditEvent(app, 'sp:audit:complete', {
    auditId,
    tenantId: tenantRow.id,
    tenantName: tenantRow.display_name,
    driveName,
    siteName,
    foldersScanned: allFolders.length,
    explicitCount: foldersWithExplicitPermissions.length,
  });

  // Evict session after 5 minutes
  setTimeout(() => auditSessions.delete(auditId), 5 * 60 * 1000);
}

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
