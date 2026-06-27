/**
 * Panoptica365 — SharePoint library-audit runner.
 *
 * The core audit routine, extracted verbatim from the old fire-and-forget
 * runAudit() in routes/api-sharepoint.js so it can be driven by the tracked
 * background-job worker (src/sp-audit-worker.js) instead. NO audit logic
 * changed — this is the same crawl + permission read + sp_audits write.
 *
 * One call = one document-library audit = one sp_audits row.
 */

'use strict';

const db = require('../db/database');
const sp = require('./sharepoint-graph');

/**
 * Run one library audit. Creates its own sp_audits row (status 'running'),
 * crawls + reads permissions, then marks the row 'complete'. On failure the
 * row is marked 'error' and the error is re-thrown so the caller (worker) can
 * mark the job failed.
 *
 * @param {object} tenantRow  { id, tenant_id, display_name }
 * @param {object} params     { siteId, driveId, driveName, siteUrl, siteName }
 * @param {function} [onProgress]  ({ foldersTotal, foldersScanned, explicitCount, message }) => void
 * @returns {Promise<{ auditId:number, foldersScanned:number, explicitCount:number }>}
 */
async function runLibraryAudit(tenantRow, params, onProgress) {
  const { siteId, driveId, driveName, siteUrl } = params;
  let siteName = params.siteName;
  if (!siteName) {
    try { siteName = new URL(siteUrl).pathname.split('/').filter(Boolean).pop() || siteId; } catch { siteName = siteId; }
  }
  const tenantGuid = tenantRow.tenant_id;
  const emit = (p) => { try { if (onProgress) onProgress(p); } catch { /* progress is best-effort */ } };

  const auditId = await db.insert(
    `INSERT INTO sp_audits (tenant_id, site_id, site_name, site_url, drive_id, drive_name, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`,
    [tenantRow.id, siteId, siteName, siteUrl, driveId, driveName]
  );

  try {
    emit({ message: 'Resolving library...' });
    const rootItem = await sp.getDriveRoot(tenantGuid, driveId);
    const librarySize = await sp.getDriveQuota(tenantGuid, driveId);
    const verifiedDomains = await sp.getVerifiedDomains(tenantGuid);

    emit({ message: 'Crawling folder tree...' });
    let discovered = 0;
    const folders = await sp.crawlFolders(tenantGuid, driveId, 'root', '', 0, (c) => {
      discovered += c;
      emit({ foldersTotal: discovered, message: `Discovering folders... ${discovered} found` });
    });

    const allFolders = [
      { id: rootItem.id, name: '(root)', path: '/', depth: 0, webUrl: rootItem.webUrl },
      ...folders,
    ];
    emit({ foldersTotal: allFolders.length, message: `Reading permissions on ${allFolders.length} folders...` });

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
          emit({ foldersScanned: scanned, foldersTotal: allFolders.length, explicitCount: foldersWithExplicitPermissions.length });
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
          }
        } catch (e) {
          console.log(`[SP Audit] Perm err on ${f.name}: ${e.message.substring(0, 100)}`);
        }
        scanned++;
        emit({
          foldersScanned: scanned,
          foldersTotal: allFolders.length,
          explicitCount: foldersWithExplicitPermissions.length,
          message: `Scanning ${scanned}/${allFolders.length} (${foldersWithExplicitPermissions.length} explicit)`,
        });
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
      [allFolders.length, librarySize, foldersWithExplicitPermissions.length, JSON.stringify(result), auditId]
    );

    emit({
      status: 'complete',
      foldersScanned: allFolders.length,
      foldersTotal: allFolders.length,
      explicitCount: foldersWithExplicitPermissions.length,
      message: `Audit complete. ${allFolders.length} folders, ${foldersWithExplicitPermissions.length} explicit.`,
    });

    return { auditId, foldersScanned: allFolders.length, explicitCount: foldersWithExplicitPermissions.length };
  } catch (err) {
    await db.execute(
      `UPDATE sp_audits SET status='error', error_message=?, finished_at=NOW() WHERE id=?`,
      [String(err.message || err).substring(0, 500), auditId]
    ).catch(() => {});
    err.auditId = auditId;
    throw err;
  }
}

module.exports = { runLibraryAudit };
