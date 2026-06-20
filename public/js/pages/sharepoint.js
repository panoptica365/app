/**
 * Panoptica365 — SharePoint Audit page
 * Ported from Tabula Accessus public/app.js. Integrates with Panoptica SPA:
 *   - uses window.Panoptica.api() for fetch
 *   - uses window.Panoptica.showToast() for notifications
 *   - exposes init()/destroy() via window.PanopticaPage
 */
(function () {
  'use strict';

  const api = (path, opts = {}) => window.Panoptica.api(path, opts);
  const toast = (msg, type) => window.Panoptica.showToast(msg, type);

  // ─── State ───
  let tenants = [];
  let currentInventory = null;
  let currentTenantId = null;   // DB id (int)
  let currentAuditId = null;
  let auditPollTimer = null;
  let currentAuditData = null;
  let allAuditFiles = [];
  let storageCache = new Map();

  // ─── Utilities ───
  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Detect raw directoryObject GUIDs that leak through when SharePoint can't
  // resolve a principal (deleted users, external B2B guests with uncached
  // UPN, orphaned permissions, service principals). Substitute a human label
  // in CSV output so customers don't see hex strings in permissions audits.
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function resolvePrincipalLabel(s) {
    if (!s) return '';
    return GUID_RE.test(String(s).trim()) ? window.t('sharepoint.unresolved_principal') : s;
  }
  function shortUrl(u) { if (!u) return ''; try { const o = new URL(u); return o.hostname + o.pathname; } catch { return u; } }
  function roleClass(r) {
    const l = (r || '').toLowerCase();
    if (l.includes('full control')) return 'full';
    if (l.includes('edit') || l.includes('design')) return 'edit';
    if (l.includes('contribute')) return 'contribute';
    if (l.includes('read') || l.includes('view')) return 'read';
    return 'default';
  }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : '—'; }
  function fmtSize(bytes) {
    if (!bytes) return '—';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return gb.toFixed(2) + ' GB';
    return (bytes / (1024 ** 2)).toFixed(1) + ' MB';
  }

  // ─── Tab switching ───
  function switchTab(name) {
    document.querySelectorAll('#sp-page .sp-tab').forEach(t => t.classList.toggle('active', t.dataset.spTab === name));
    document.querySelectorAll('#sp-page .sp-section').forEach(s => s.classList.toggle('active', s.id === `sp-tab-${name}`));
    if (name === 'library-permissions' && currentTenantId) loadAuditList(currentTenantId);
    if (name === 'user-permissions') loadUserPermissions();
    if (name === 'storage') renderStorage();
  }

  // ─── Init / Destroy ───
  async function init() {
    // Wire tab clicks
    document.querySelectorAll('#sp-page .sp-tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.spTab));
    });

    document.getElementById('sp-tenant-select').addEventListener('change', onTenantChange);
    document.getElementById('sp-btn-run-inventory').addEventListener('click', runInventory);
    document.getElementById('sp-btn-export-csv').addEventListener('click', exportInventoryCsv);

    document.getElementById('sp-audit-select').addEventListener('change', e => {
      if (e.target.value) loadAuditData(parseInt(e.target.value, 10));
    });
    document.getElementById('sp-btn-export-audit-csv').addEventListener('click', exportAuditCsv);
    document.getElementById('sp-btn-export-lib-pdf').addEventListener('click', exportLibraryPdf);
    document.getElementById('sp-btn-delete-all').addEventListener('click', deleteAllAudits);

    document.getElementById('sp-user-search').addEventListener('input', e => renderUserPermissions(e.target.value.trim().toLowerCase()));
    document.getElementById('sp-btn-export-user-pdf').addEventListener('click', exportUserPdf);
    document.getElementById('sp-btn-export-user-csv').addEventListener('click', exportUserCsv);

    document.getElementById('sp-btn-close-audit-modal').addEventListener('click', () => {
      // Hide UI but DO NOT kill the poller — it keeps updating progress in the
      // background. The global Socket.IO listener in app.js will toast on
      // completion, so navigation away is safe too.
      document.getElementById('sp-audit-modal').classList.remove('open');
    });

    document.getElementById('sp-preflight-btn').addEventListener('click', runPreflight);

    await loadTenants();
  }

  function destroy() {
    if (auditPollTimer) { clearInterval(auditPollTimer); auditPollTimer = null; }
  }

  // ─── Tenants ───
  async function loadTenants() {
    try {
      tenants = await api('/api/tenants');
      const sel = document.getElementById('sp-tenant-select');
      sel.innerHTML = `<option value="">${escHtml(window.t('sharepoint.option_select_tenant'))}</option>` +
        tenants.map(t => `<option value="${t.id}">${escHtml(t.display_name || t.name)}</option>`).join('');
    } catch (err) {
      toast(window.t('sharepoint.toast_load_tenants_failed', { message: err.message }), 'error');
    }
  }

  function onTenantChange(e) {
    const id = parseInt(e.target.value, 10);
    currentTenantId = Number.isFinite(id) ? id : null;
    document.getElementById('sp-btn-run-inventory').disabled = !currentTenantId;

    // Reset everything
    document.getElementById('sp-inventory-empty').style.display = '';
    document.getElementById('sp-inventory-table-container').style.display = 'none';
    document.getElementById('sp-inventory-summary').style.display = 'none';
    document.getElementById('sp-btn-export-csv').disabled = true;
    currentInventory = null;

    if (currentTenantId) runPreflight(true); // silent mode — only show banner on problem
  }

  // ─── Preflight ───
  async function runPreflight(silent = false) {
    const banner = document.getElementById('sp-preflight-banner');
    const text = document.getElementById('sp-preflight-text');
    if (!currentTenantId) {
      banner.style.display = 'none';
      return;
    }
    try {
      const r = await api(`/api/sharepoint/preflight/${currentTenantId}`);
      if (r.ok) {
        if (silent) banner.style.display = 'none';
        else {
          banner.style.display = '';
          banner.style.borderLeft = '3px solid #388E3C';
          text.textContent = window.t('sharepoint.preflight.ok');
          setTimeout(() => { banner.style.display = 'none'; }, 3000);
        }
      } else {
        banner.style.display = '';
        banner.style.borderLeft = '3px solid #D32F2F';
        text.innerHTML = window.t('sharepoint.preflight.missing_html', { errors: escHtml(r.errors?.join(' | ') || '') });
      }
    } catch (err) {
      banner.style.display = '';
      banner.style.borderLeft = '3px solid #D32F2F';
      text.textContent = window.t('sharepoint.preflight.exception', { message: err.message });
    }
  }

  // ─── Inventory ───
  async function runInventory() {
    if (!currentTenantId) return;
    const btn = document.getElementById('sp-btn-run-inventory');
    const prog = document.getElementById('sp-inventory-progress');
    const progFill = document.getElementById('sp-inventory-progress-fill');
    const progText = document.getElementById('sp-inventory-progress-text');

    btn.disabled = true; btn.textContent = window.t('sharepoint.btn_running');
    prog.style.display = '';
    progFill.style.width = '15%';
    progText.textContent = window.t('sharepoint.inventory.progress_enumerating');
    document.getElementById('sp-inventory-empty').style.display = 'none';
    document.getElementById('sp-inventory-table-container').style.display = 'none';
    document.getElementById('sp-inventory-summary').style.display = 'none';

    try {
      const data = await api(`/api/sharepoint/inventory/${currentTenantId}`);
      currentInventory = data;
      storageCache.set(currentTenantId, data);

      const usable = data.inventory.filter(s => !s.error && s.driveCount > 0);
      const totalDrives = usable.reduce((s, x) => s + x.driveCount, 0);

      progFill.style.width = '100%';
      progText.textContent = window.t('sharepoint.inventory.progress_complete', { sites: usable.length, drives: totalDrives });

      document.getElementById('sp-sum-tenant').textContent = data.tenantName;
      document.getElementById('sp-sum-sites').textContent = usable.length;
      document.getElementById('sp-sum-libs').textContent = totalDrives;
      document.getElementById('sp-inventory-summary').style.display = '';

      renderInventoryTable(usable);
      document.getElementById('sp-inventory-table-container').style.display = '';
      document.getElementById('sp-btn-export-csv').disabled = false;

      toast(window.t('sharepoint.toast_inventory_complete', { sites: usable.length, drives: totalDrives }), 'success');
    } catch (err) {
      progFill.style.width = '0%';
      progText.textContent = window.t('sharepoint.inventory.progress_error', { message: err.message });
      toast(window.t('sharepoint.toast_inventory_failed', { message: err.message }), 'error');
    } finally {
      btn.disabled = false; btn.textContent = window.t('sharepoint.btn_run_inventory_short');
      setTimeout(() => { prog.style.display = 'none'; }, 4000);
    }
  }

  function renderInventoryTable(inv) {
    const tbody = document.getElementById('sp-inventory-tbody');
    let html = '';
    inv.forEach((site, idx) => {
      const lastMod = fmtDate(site.lastModifiedDateTime);
      html += `
        <tr class="sp-site-row" data-idx="${idx}">
          <td><span class="sp-arrow" id="sp-arrow-${idx}">▶</span></td>
          <td><strong>${escHtml(site.displayName || site.name || window.t('sharepoint.unnamed_site'))}</strong></td>
          <td><a href="${escHtml(site.webUrl)}" target="_blank" style="color: var(--p-accent-light); text-decoration:none;">${escHtml(shortUrl(site.webUrl))}</a></td>
          <td><span class="sp-badge">${site.driveCount} ${window.t('sharepoint.lib_count', { count: site.driveCount })}</span></td>
          <td style="color: var(--p-text-muted); font-size:0.83rem;">${lastMod}</td>
          <td></td>
        </tr>
      `;
      site.drives.forEach(drive => {
        const size = (drive.quota && drive.quota.used) ? fmtSize(drive.quota.used) : '—';
        const dMod = fmtDate(drive.lastModifiedDateTime);
        html += `
          <tr class="sp-drive-row hidden" data-site="${idx}">
            <td></td>
            <td style="padding-left:24px;">📄 ${escHtml(drive.name)}</td>
            <td><a href="${escHtml(drive.webUrl)}" target="_blank" style="color: var(--p-accent-light); text-decoration:none;">${escHtml(shortUrl(drive.webUrl))}</a></td>
            <td style="color: var(--p-text-muted); font-size:0.83rem;">${size}</td>
            <td style="color: var(--p-text-muted); font-size:0.83rem;">${dMod}</td>
            <td><button class="btn-primary" data-role-required="member" style="padding:4px 10px;font-size:0.78rem;" data-act="audit" data-site-id="${escHtml(site.id)}" data-drive-id="${escHtml(drive.id)}" data-drive-name="${escHtml(drive.name)}" data-site-url="${escHtml(site.webUrl)}">${escHtml(window.t('sharepoint.btn_audit'))}</button></td>
          </tr>
        `;
      });
    });
    tbody.innerHTML = html;
    // Wire click handlers
    tbody.querySelectorAll('tr.sp-site-row').forEach(r => {
      r.addEventListener('click', () => toggleDrives(parseInt(r.dataset.idx, 10)));
    });
    tbody.querySelectorAll('button[data-act="audit"]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        startAudit(b.dataset.siteId, b.dataset.driveId, b.dataset.driveName, b.dataset.siteUrl);
      });
    });
  }

  function toggleDrives(idx) {
    const rows = document.querySelectorAll(`#sp-inventory-tbody tr[data-site="${idx}"]`);
    const arrow = document.getElementById(`sp-arrow-${idx}`);
    const hidden = rows.length > 0 && rows[0].classList.contains('hidden');
    rows.forEach(r => r.classList.toggle('hidden', !hidden));
    if (arrow) arrow.style.transform = hidden ? 'rotate(90deg)' : 'rotate(0deg)';
  }

  function exportInventoryCsv() {
    if (!currentInventory) return;
    const rows = [[
      window.t('sharepoint.csv_inv.col_site_name'),
      window.t('sharepoint.csv_inv.col_site_url'),
      window.t('sharepoint.csv_inv.col_library_name'),
      window.t('sharepoint.csv_inv.col_library_url'),
      window.t('sharepoint.csv_inv.col_used_gb'),
      window.t('sharepoint.csv_inv.col_last_modified'),
    ]];
    currentInventory.inventory.filter(s => !s.error && s.driveCount > 0).forEach(site => {
      site.drives.forEach(drive => {
        const gb = drive.quota && drive.quota.used ? (drive.quota.used / (1024 ** 3)).toFixed(2) : '';
        rows.push([site.displayName || site.name || '', site.webUrl || '', drive.name || '', drive.webUrl || '', gb, drive.lastModifiedDateTime || '']);
      });
    });
    Panoptica.downloadCsv(rows, `sharepoint_inventory_${(currentInventory.tenantName || 'tenant').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast(window.t('sharepoint.toast_csv_exported'), 'success');
  }

  // CSV download now lives in the shared helper (Panoptica.downloadCsv) — see
  // public/js/shared/csv-export.js. Same UTF-8-BOM behavior, reused by the
  // Applications, Access Review, and Audit Log exports too.

  // ─── Audit ───
  async function startAudit(siteId, driveId, driveName, siteUrl) {
    if (!currentTenantId) { toast(window.t('sharepoint.toast_select_tenant_first'), 'error'); return; }

    document.getElementById('sp-audit-modal-library').textContent = driveName;
    document.getElementById('sp-audit-folders-scanned').textContent = '0';
    document.getElementById('sp-audit-explicit-count').textContent = '0';
    document.getElementById('sp-audit-progress-fill').style.width = '0%';
    document.getElementById('sp-audit-status-text').textContent = window.t('sharepoint.audit.status_starting');
    document.getElementById('sp-audit-modal').classList.add('open');

    try {
      const r = await api(`/api/sharepoint/audit/${currentTenantId}`, {
        method: 'POST',
        body: JSON.stringify({ siteId, driveId, driveName, siteUrl }),
      });
      currentAuditId = r.auditId;
      pollAuditProgress(r.auditId);
    } catch (err) {
      document.getElementById('sp-audit-modal').classList.remove('open');
      toast(window.t('sharepoint.toast_audit_start_failed', { message: err.message }), 'error');
    }
  }

  function pollAuditProgress(auditId) {
    if (auditPollTimer) clearInterval(auditPollTimer);
    auditPollTimer = setInterval(async () => {
      try {
        const p = await api(`/api/sharepoint/audit/${auditId}/progress`);
        document.getElementById('sp-audit-folders-scanned').textContent = p.foldersScanned || 0;
        document.getElementById('sp-audit-explicit-count').textContent = p.explicitCount || 0;
        document.getElementById('sp-audit-status-text').textContent = p.message || window.t('sharepoint.audit.status_scanning');
        if (p.foldersTotal > 0) {
          const pct = Math.min(100, Math.round((p.foldersScanned / p.foldersTotal) * 100));
          document.getElementById('sp-audit-progress-fill').style.width = pct + '%';
        }
        if (p.status === 'complete') {
          clearInterval(auditPollTimer); auditPollTimer = null;
          document.getElementById('sp-audit-progress-fill').style.width = '100%';
          document.getElementById('sp-audit-status-text').textContent = window.t('sharepoint.audit.status_complete');
          toast(window.t('sharepoint.toast_audit_complete_short', { folders: p.foldersScanned, explicit: p.explicitCount }), 'success');
          setTimeout(() => {
            document.getElementById('sp-audit-modal').classList.remove('open');
            switchTab('library-permissions');
          }, 1500);
        } else if (p.status === 'error') {
          clearInterval(auditPollTimer); auditPollTimer = null;
          document.getElementById('sp-audit-status-text').textContent = window.t('sharepoint.audit.error_prefix', { message: p.message || window.t('sharepoint.audit.error_unknown') });
          toast(window.t('sharepoint.toast_audit_error', { message: p.message || '' }), 'error');
        }
      } catch (err) {
        clearInterval(auditPollTimer); auditPollTimer = null;
        document.getElementById('sp-audit-status-text').textContent = window.t('sharepoint.audit.poll_error', { message: err.message });
      }
    }, 1000);
  }

  // ─── Library Permissions ───
  async function loadAuditList(tenantId) {
    try {
      const audits = await api(`/api/sharepoint/audits/${tenantId}`);
      const sel = document.getElementById('sp-audit-select');
      const empty = document.getElementById('sp-libperm-empty');
      const content = document.getElementById('sp-libperm-content');
      if (audits.length === 0) {
        sel.innerHTML = `<option value="">${escHtml(window.t('sharepoint.option_no_audits'))}</option>`;
        empty.style.display = ''; content.style.display = 'none';
        document.getElementById('sp-btn-export-audit-csv').disabled = true;
        document.getElementById('sp-btn-export-lib-pdf').disabled = true;
        document.getElementById('sp-btn-delete-all').disabled = true;
        return;
      }
      document.getElementById('sp-btn-delete-all').disabled = false;
      sel.innerHTML = audits.map(a => {
        const ts = new Date(a.timestamp).toLocaleString();
        return `<option value="${a.id}">${escHtml(window.t('sharepoint.audit_select_option', { driveName: a.driveName, siteName: a.siteName, ts, explicit: a.explicitCount }))}</option>`;
      }).join('');
      empty.style.display = 'none';
      loadAuditData(audits[0].id);
    } catch (err) {
      toast(window.t('sharepoint.toast_load_audits_failed', { message: err.message }), 'error');
    }
  }

  async function loadAuditData(auditId) {
    try {
      const data = await api(`/api/sharepoint/audit-data/${auditId}`);
      currentAuditData = { ...data, _auditId: auditId };
      renderLibraryPermissions(data);
      document.getElementById('sp-btn-export-audit-csv').disabled = false;
      document.getElementById('sp-btn-export-lib-pdf').disabled = false;
    } catch (err) {
      toast(window.t('sharepoint.toast_load_audit_failed', { message: err.message }), 'error');
    }
  }

  function renderLibraryPermissions(data) {
    const content = document.getElementById('sp-libperm-content');
    content.style.display = '';
    const explicit = data.foldersWithExplicitPermissions || [];
    const sizeGB = data.librarySize ? (data.librarySize / (1024 ** 3)).toFixed(2) : null;

    // Count distinct external users (User (external) type) across baseline + explicit
    const externals = new Set();
    const collectExt = rows => (rows || []).forEach(r => {
      if (r.principalType === 'User (external)') {
        externals.add((r.principalEmail || r.loginName || r.principalName || '').toLowerCase());
      }
      // Group members are also flagged if they came from an externally-shared link's identities
      (r.members || []).forEach(m => {
        const email = (m.email || '').toLowerCase();
        if (!email) return;
        const dom = email.split('@')[1];
        if (dom && data._tenantDomains && !data._tenantDomains.includes(dom)) externals.add(email);
      });
    });
    collectExt(data.baselinePermissions);
    explicit.forEach(f => collectExt(f.roleAssignments));

    document.getElementById('sp-libperm-kpis').innerHTML = `
      <div class="sp-kpi"><div class="sp-kpi-value">${data.foldersScanned || 0}</div><div class="sp-kpi-label">${window.t('sharepoint.kpi.total_folders')}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-value ${explicit.length ? 'danger' : ''}">${explicit.length}</div><div class="sp-kpi-label">${window.t('sharepoint.kpi.explicit_permissions')}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-value ${externals.size ? 'danger' : ''}">${externals.size}</div><div class="sp-kpi-label">${window.t('sharepoint.kpi.external_users')}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-value">${sizeGB !== null ? sizeGB : '—'}</div><div class="sp-kpi-label">${sizeGB !== null ? window.t('sharepoint.kpi.library_size_gb') : window.t('sharepoint.kpi.library_size')}</div></div>
    `;

    document.getElementById('sp-baseline-permissions').innerHTML = renderPermissionRows(data.baselinePermissions || []);

    const explDiv = document.getElementById('sp-explicit-folders');
    const noExpl = document.getElementById('sp-no-explicit');
    const banner = document.getElementById('sp-explicit-count-banner');
    if (explicit.length === 0) {
      explDiv.innerHTML = '';
      noExpl.style.display = '';
      banner.style.display = 'none';
    } else {
      noExpl.style.display = 'none';
      banner.style.display = '';
      banner.innerHTML = `<span class="sp-badge danger">${window.t('sharepoint.explicit_count_banner', { count: explicit.length })}</span>`;
      explDiv.innerHTML = explicit.map(f => `
        <div class="sp-explicit-folder">
          <div class="sp-explicit-path">${escHtml(f.folderPath)}</div>
          ${renderPermissionRows(f.roleAssignments || [])}
        </div>
      `).join('');
    }
  }

  function renderPermissionRows(assignments) {
    if (!assignments.length) return `<div style="padding:6px; color: var(--p-text-muted); font-size: 0.85rem;">${escHtml(window.t('sharepoint.no_permissions'))}</div>`;
    return assignments.map(a => {
      const roles = (a.roles || []).map(r => `<span class="sp-role ${roleClass(r)}">${escHtml(r)}</span>`).join('');
      const members = (a.members && a.members.length > 0)
        ? `<div class="sp-members">${a.members.map(m => `<div class="sp-member">${escHtml(m.displayName)} <span class="muted">&lt;${escHtml(m.email)}&gt;</span></div>`).join('')}</div>`
        : '';
      const isExt = a.principalType === 'User (external)';
      const extBadge = isExt ? `<span class="sp-badge danger" style="margin-left:6px;">${escHtml(window.t('sharepoint.badge_external'))}</span>` : '';
      const viaLine = a.sharedVia
        ? `<div style="font-size:0.76rem; color: var(--p-text-muted); margin-top:2px;">${escHtml(window.t('sharepoint.via_label', { sharedVia: a.sharedVia }))}</div>`
        : '';
      return `
        <div class="sp-perm-row" style="${isExt ? 'border-left:3px solid #D32F2F;' : ''}">
          <div class="sp-perm-header">
            <div>
              <span class="sp-principal">${escHtml(resolvePrincipalLabel(a.principalName))}</span>
              <span class="sp-ptype">${escHtml(a.principalType)}</span>${extBadge}
              ${a.principalEmail && !GUID_RE.test(String(a.principalEmail).trim()) ? `<span class="sp-ptype">&lt;${escHtml(a.principalEmail)}&gt;</span>` : ''}
              ${viaLine}
            </div>
            <div>${roles}</div>
          </div>
          ${members}
        </div>
      `;
    }).join('');
  }

  function exportAuditCsv() {
    if (!currentAuditData) return;
    const lib = currentAuditData.driveName || '';
    const site = currentAuditData.siteName || '';
    const rows = [[
      window.t('sharepoint.csv_audit.col_library'),
      window.t('sharepoint.csv_audit.col_site'),
      window.t('sharepoint.csv_audit.col_folder_path'),
      window.t('sharepoint.csv_audit.col_principal_name'),
      window.t('sharepoint.csv_audit.col_principal_type'),
      window.t('sharepoint.csv_audit.col_email'),
      window.t('sharepoint.csv_audit.col_external'),
      window.t('sharepoint.csv_audit.col_shared_via'),
      window.t('sharepoint.csv_audit.col_roles'),
      window.t('sharepoint.csv_audit.col_member_count'),
      window.t('sharepoint.csv_audit.col_members'),
    ]];

    const pushRow = (folderPath, a) => {
      // Blank (not 0) when members weren't expanded — avoids the false
      // certainty that a group is "empty" when it was really just not resolved.
      const hasMembers = Array.isArray(a.members) && a.members.length > 0;
      const memberCount = hasMembers ? a.members.length : '';
      const members = hasMembers
        ? a.members.map(m => `${m.displayName || ''} <${m.email || ''}>`).join('; ')
        : '';
      const isExt = a.principalType === 'User (external)' ? window.t('sharepoint.common.yes') : window.t('sharepoint.common.no');
      const via = a.sharedVia || (a.principalType === 'Site User' ? window.t('sharepoint.via_direct') : '');
      rows.push([
        lib, site, folderPath,
        resolvePrincipalLabel(a.principalName) || '', a.principalType || '',
        resolvePrincipalLabel(a.principalEmail || a.loginName) || '',
        isExt, via,
        (a.roles || []).join(', '),
        memberCount,
        members,
      ]);
    };

    (currentAuditData.baselinePermissions || []).forEach(a => pushRow(window.t('sharepoint.folder_root_inherited'), a));
    (currentAuditData.foldersWithExplicitPermissions || []).forEach(f => {
      (f.roleAssignments || []).forEach(a => pushRow(f.folderPath, a));
    });

    Panoptica.downloadCsv(rows, `audit_${(currentAuditData.driveName || 'lib').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast(window.t('sharepoint.toast_audit_csv_exported'), 'success');
  }

  async function exportLibraryPdf() {
    if (!currentAuditData || !currentAuditData._auditId) return;
    const name = (currentAuditData.driveName || 'library').replace(/\s+/g, '_');
    await downloadPdf(`/api/sharepoint/export/library-pdf/${currentAuditData._auditId}`,
      `Library_Permissions_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function deleteAllAudits() {
    if (!currentTenantId) return;
    const t = tenants.find(x => x.id === currentTenantId);
    const name = t ? (t.display_name || t.name) : 'this tenant';
    if (!(await Panoptica.confirmModal(window.t('sharepoint.confirm_delete_all', { name }), { danger: true }))) return;
    try {
      const r = await api(`/api/sharepoint/audits/${currentTenantId}`, { method: 'DELETE' });
      toast(window.t('sharepoint.toast_audits_deleted', { count: r.deleted }), 'success');
      document.getElementById('sp-audit-select').innerHTML = `<option value="">${escHtml(window.t('sharepoint.option_no_audits'))}</option>`;
      document.getElementById('sp-libperm-empty').style.display = '';
      document.getElementById('sp-libperm-content').style.display = 'none';
      document.getElementById('sp-btn-export-audit-csv').disabled = true;
      document.getElementById('sp-btn-export-lib-pdf').disabled = true;
      document.getElementById('sp-btn-delete-all').disabled = true;
      currentAuditData = null;
      allAuditFiles = [];
    } catch (err) {
      toast(window.t('sharepoint.toast_delete_failed', { message: err.message }), 'error');
    }
  }

  async function downloadPdf(url, filename) {
    toast(window.t('sharepoint.toast_generating_pdf'), 'info');
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const txt = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const burl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = burl; a.download = filename; a.click();
      URL.revokeObjectURL(burl);
      toast(window.t('sharepoint.toast_pdf_downloaded'), 'success');
    } catch (err) {
      toast(window.t('sharepoint.toast_pdf_export_failed', { message: err.message }), 'error');
    }
  }

  // ─── User Permissions ───
  async function loadUserPermissions() {
    const empty = document.getElementById('sp-userperm-empty');
    const content = document.getElementById('sp-userperm-content');
    const search = document.getElementById('sp-user-search');
    const pdfBtn = document.getElementById('sp-btn-export-user-pdf');
    const csvBtn = document.getElementById('sp-btn-export-user-csv');
    if (!currentTenantId) {
      empty.style.display = ''; content.style.display = 'none';
      search.disabled = true; pdfBtn.disabled = true; csvBtn.disabled = true;
      return;
    }
    try {
      const audits = await api(`/api/sharepoint/audits/${currentTenantId}`);
      if (audits.length === 0) {
        empty.style.display = ''; content.style.display = 'none';
        search.disabled = true; pdfBtn.disabled = true; csvBtn.disabled = true;
        return;
      }
      allAuditFiles = [];
      for (const a of audits) {
        try {
          const d = await api(`/api/sharepoint/audit-data/${a.id}`);
          allAuditFiles.push(d);
        } catch {}
      }
      renderUserPermissions();
      search.disabled = false; pdfBtn.disabled = false; csvBtn.disabled = false;
    } catch (err) {
      toast(window.t('sharepoint.toast_load_userperm_failed', { message: err.message }), 'error');
    }
  }

  function renderUserPermissions(searchTerm = '') {
    const empty = document.getElementById('sp-userperm-empty');
    const content = document.getElementById('sp-userperm-content');
    const container = document.getElementById('sp-user-list');
    const userMap = new Map();
    for (const audit of allAuditFiles) {
      const lib = `${audit.driveName} (${audit.siteName || ''})`;
      for (const p of audit.baselinePermissions || []) addToMap(userMap, p, lib, '(root — inherited)');
      for (const f of audit.foldersWithExplicitPermissions || []) {
        for (const p of f.roleAssignments || []) addToMap(userMap, p, lib, f.folderPath);
      }
    }
    let users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (searchTerm) {
      users = users.filter(u => {
        const types = Array.from(u.types || [u.type]).join(' ').toLowerCase();
        return u.name.toLowerCase().includes(searchTerm) ||
          (u.email || '').toLowerCase().includes(searchTerm) ||
          types.includes(searchTerm);
      });
    }
    if (users.length === 0) {
      empty.style.display = ''; content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = '';
    container.innerHTML = users.map((u, i) => {
      const detailRows = u.accesses.map(a => `
        <div class="sp-user-access">
          <div>
            <strong>${escHtml(a.library)}</strong>
            <div class="sp-access-folder">${escHtml(a.folder)}</div>
            ${a.via ? `<div class="sp-access-folder" style="opacity:0.7;">${escHtml(window.t('sharepoint.via_label', { sharedVia: a.via }))}</div>` : ''}
          </div>
          <div>${(a.roles || []).map(r => `<span class="sp-role ${roleClass(r)}">${escHtml(r)}</span>`).join('')}</div>
        </div>
      `).join('');
      // If the principal was seen under multiple type labels, render them all
      const typeLabels = Array.from(u.types || [u.type]).filter(Boolean);
      const typesHtml = typeLabels.map(t => `<span class="sp-ptype">${escHtml(t)}</span>`).join(' ');
      const isExt = typeLabels.includes('User (external)');
      return `
        <div class="sp-user-card" data-idx="${i}" style="${isExt ? 'border-left:3px solid #D32F2F;' : ''}">
          <div class="sp-user-card-header">
            <div>
              <span class="sp-principal">${escHtml(u.name)}</span>
              ${typesHtml}
              ${u.email && u.email !== u.name ? `<br><span class="sp-ptype">${escHtml(u.email)}</span>` : ''}
            </div>
            <span class="sp-badge${isExt ? ' danger' : ''}">${window.t('sharepoint.access_locations_count', { count: u.accesses.length })}</span>
          </div>
          <div class="sp-user-details">${detailRows}</div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.sp-user-card').forEach(c => {
      c.addEventListener('click', () => c.classList.toggle('open'));
    });
  }

  // Dedupe primarily by email (lowercased) so the same person isn't listed
  // twice when SharePoint returns both siteUser and Entra user records.
  // Fall back to name::type for principals without an email (groups, links, etc.)
  function addToMap(map, perm, lib, folder) {
    const emailKey = (perm.principalEmail || perm.loginName || '').trim().toLowerCase();
    const key = emailKey || `${perm.principalName}::${perm.principalType}`;

    if (!map.has(key)) {
      map.set(key, {
        name: perm.principalName,
        email: perm.principalEmail || perm.loginName || '',
        type: perm.principalType,
        types: new Set([perm.principalType]),   // track all types seen
        accesses: [],
      });
    } else {
      // Update the entry with richer info if we have it
      const entry = map.get(key);
      entry.types.add(perm.principalType);
      // Prefer a display name with a real name over one that's just the email
      if (perm.principalName && !perm.principalName.includes('@') && entry.name.includes('@')) {
        entry.name = perm.principalName;
      }
      // Promote "User (external)" as primary type if seen (more informative than "Site User")
      if (perm.principalType === 'User (external)') entry.type = 'User (external)';
    }
    map.get(key).accesses.push({
      library: lib,
      folder,
      roles: perm.roles,
      via: perm.sharedVia || (perm.principalType === 'Site User' ? 'Direct SharePoint permission' : null),
    });

    if (perm.members && perm.members.length > 0) {
      for (const m of perm.members) {
        const memEmail = (m.email || '').trim().toLowerCase();
        const mk = memEmail || `${m.displayName}::User`;
        if (!map.has(mk)) {
          map.set(mk, {
            name: m.displayName,
            email: m.email || '',
            type: 'User (via group)',
            types: new Set(['User (via group)']),
            accesses: [],
          });
        } else {
          map.get(mk).types.add('User (via group)');
        }
        map.get(mk).accesses.push({
          library: lib,
          folder: `${folder} (via ${perm.principalName})`,
          roles: perm.roles,
          via: `Group: ${perm.principalName}`,
        });
      }
    }
  }

  async function exportUserPdf() {
    if (!currentTenantId) return;
    const t = tenants.find(x => x.id === currentTenantId);
    const safe = (t && (t.display_name || t.name) || 'tenant').replace(/\s+/g, '_');
    await downloadPdf(`/api/sharepoint/export/user-pdf/${currentTenantId}`,
      `User_Permissions_${safe}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  // Deduped User Permissions CSV — mirrors the User Permissions tab.
  // One row per unique person (by email), with aggregated access info.
  function exportUserCsv() {
    if (!allAuditFiles || allAuditFiles.length === 0) {
      toast(window.t('sharepoint.toast_no_audit_data'), 'error');
      return;
    }

    // Rebuild the same deduped map the UI renders from.
    const userMap = new Map();
    for (const audit of allAuditFiles) {
      const lib = `${audit.driveName} (${audit.siteName || ''})`;
      for (const p of audit.baselinePermissions || []) addToMap(userMap, p, lib, '(root — inherited)');
      for (const f of audit.foldersWithExplicitPermissions || []) {
        for (const p of f.roleAssignments || []) addToMap(userMap, p, lib, f.folderPath);
      }
    }

    const users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const rows = [[
      'Name', 'Email', 'Types', 'External', 'Access Count',
      'Unique Libraries', 'Access Details',
    ]];

    for (const u of users) {
      const types = Array.from(u.types || [u.type]).filter(Boolean);
      const isExt = types.includes('User (external)') ? 'Yes' : 'No';
      const libs = Array.from(new Set(u.accesses.map(a => a.library))).join('; ');
      // Pipe-separated access lines so one row per user stays preserved.
      // Format: "<library> -> <folder> [roles] via <via>"
      const details = u.accesses.map(a => {
        const roles = (a.roles || []).join(', ');
        const via = a.via ? ` via ${a.via}` : '';
        return `${a.library} -> ${a.folder} [${roles}]${via}`;
      }).join(' || ');
      rows.push([
        resolvePrincipalLabel(u.name) || '',
        resolvePrincipalLabel(u.email) || '',
        types.join(', '),
        isExt,
        u.accesses.length,
        libs,
        details,
      ]);
    }

    const t = tenants.find(x => x.id === currentTenantId);
    const safe = (t && (t.display_name || t.name) || 'tenant').replace(/\s+/g, '_');
    Panoptica.downloadCsv(rows, `user_permissions_${safe}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast(window.t('sharepoint.toast_userperm_csv_exported'), 'success');
  }

  // ─── Storage Overview ───
  async function renderStorage() {
    const empty = document.getElementById('sp-storage-empty');
    const content = document.getElementById('sp-storage-content');
    const chart = document.getElementById('sp-storage-chart');
    const totals = document.getElementById('sp-storage-totals');
    if (!currentTenantId) {
      empty.style.display = ''; content.style.display = 'none';
      return;
    }
    let data = storageCache.get(currentTenantId);
    if (!data) {
      empty.innerHTML = `<div class="sp-empty-icon">⏳</div><p>${escHtml(window.t('sharepoint.storage.loading'))}</p>`;
      empty.style.display = ''; content.style.display = 'none';
      try {
        data = await api(`/api/sharepoint/inventory/${currentTenantId}`);
        storageCache.set(currentTenantId, data);
      } catch (err) {
        empty.innerHTML = `<div class="sp-empty-icon">📊</div><p>Failed to load inventory: ${escHtml(err.message)}</p>`;
        return;
      }
    }

    const libs = [];
    let total = 0;
    for (const site of data.inventory || []) {
      if (site.error || !site.drives) continue;
      for (const drive of site.drives) {
        const used = drive.quota && drive.quota.used ? drive.quota.used : 0;
        total += used;
        libs.push({ site: site.displayName || site.name || '(unnamed)', drive: drive.name || '(unnamed)', used });
      }
    }
    libs.sort((a, b) => b.used - a.used);
    if (libs.length === 0) {
      empty.innerHTML = '<div class="sp-empty-icon">📊</div><p>No document libraries found. Run an Inventory first.</p>';
      empty.style.display = ''; content.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    content.style.display = '';

    const palette = ['#42A5F5', '#29B6F6', '#66BB6A', '#FFA726', '#EF5350', '#AB47BC', '#26C6DA', '#FFCA28', '#8D6E63', '#EC407A'];
    const siteColors = {};
    let i = 0;
    for (const l of libs) if (!siteColors[l.site]) siteColors[l.site] = palette[i++ % palette.length];

    totals.innerHTML = `
      <div class="sp-kpi"><div class="sp-kpi-value">${(total / (1024 ** 3)).toFixed(2)}</div><div class="sp-kpi-label">Total Storage (GB)</div></div>
      <div class="sp-kpi"><div class="sp-kpi-value">${libs.length}</div><div class="sp-kpi-label">Document Libraries</div></div>
      <div class="sp-kpi"><div class="sp-kpi-value">${Object.keys(siteColors).length}</div><div class="sp-kpi-label">Sites</div></div>
    `;

    const max = libs[0].used || 1;
    chart.innerHTML = libs.map(l => {
      const pct = max > 0 ? Math.max(1, (l.used / max) * 100) : 0;
      const label = l.used >= 1024 ** 3 ? (l.used / 1024 ** 3).toFixed(2) + ' GB' : (l.used / 1024 ** 2).toFixed(1) + ' MB';
      const barW = l.used === 0 ? '2px' : pct + '%';
      return `
        <div class="sp-storage-bar-row">
          <div class="sp-storage-label">
            <span class="sp-site-dot" style="background:${siteColors[l.site]};"></span>
            <div style="min-width:0;">
              <div class="sp-storage-site-name">${escHtml(l.site)}</div>
              <div class="sp-storage-drive-name">${escHtml(l.drive)}</div>
            </div>
          </div>
          <div class="sp-storage-bar-track"><div class="sp-storage-bar-fill" style="width:${barW}; background:${siteColors[l.site]};"></div></div>
          <div class="sp-storage-value">${label}</div>
        </div>
      `;
    }).join('');
  }

  // ─── Expose to SPA ───
  window.PanopticaPage = { init, destroy };
})();
