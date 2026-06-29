/**
 * Panoptica — CA Templates Page Script
 * Global template library management.
 */
(function () {
  'use strict';

  let templates = [];
  let tenantsForPicker = [];
  let currentTemplateId = null;

  // #20 — whole-ZIP / multi-policy import (parity with Intune). Upload a ZIP or
  // JSON file, pick which policies to import; they import in small chunks with
  // per-item results + retry. Name/description come from each policy.
  const CA_IMPORT_CHUNK_SIZE = 5;
  let caImportData = null;       // { policies:[], sourceTenantId|null }
  let caImportStatus = {};       // original policy index -> { state:'ok'|'failed'|'collision', … }
  let caCollisionMode = false;   // true while resolving duplicate-name collisions

  // ─── JSZip loader (loaded on demand from CDN, same as Intune export) ───
  let JSZipLib = null;
  async function loadJSZip() {
    if (JSZipLib) return JSZipLib;
    if (window.JSZip) { JSZipLib = window.JSZip; return JSZipLib; }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = () => { JSZipLib = window.JSZip; resolve(JSZipLib); };
      s.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(s);
    });
  }

  async function init() {
    // Wire static buttons
    document.getElementById('ca-import-btn').addEventListener('click', showImportModal);
    document.getElementById('ca-import-cancel-btn').addEventListener('click', hideImportModal);
    // #20 — import is file/ZIP → pick which policies → bulk import.
    document.getElementById('ca-import-submit-btn').addEventListener('click', submitCaBulkImport);
    document.getElementById('ca-import-file').addEventListener('change', handleCaFileSelect);
    document.getElementById('ca-import-select-all').addEventListener('click', () => toggleAllCaImports(true));
    document.getElementById('ca-import-select-none').addEventListener('click', () => toggleAllCaImports(false));
    document.getElementById('ca-import-list').addEventListener('change', updateCaImportCount);
    document.getElementById('ca-export-btn').addEventListener('click', showExportModal);
    document.getElementById('ca-export-cancel-btn').addEventListener('click', hideExportModal);
    document.getElementById('ca-export-start-btn').addEventListener('click', startExport);
    document.getElementById('ca-detail-close-btn').addEventListener('click', hideDetailModal);
    document.getElementById('ca-detail-delete-btn').addEventListener('click', deleteTemplate);
    document.getElementById('ca-detail-save-btn').addEventListener('click', saveTemplate);

    // Close modals when the overlay backdrop is clicked (matches Intune pattern).
    ['ca-import-overlay', 'ca-export-overlay', 'ca-detail-overlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target.id === id) e.target.style.display = 'none';
        });
      }
    });

    await loadTemplates();
  }

  function destroy() {
    templates = [];
    currentTemplateId = null;
  }

  // ─── Load & Render Templates ───

  async function loadTemplates() {
    try {
      templates = await Panoptica.api('/api/ca/templates');
      renderTemplates();
    } catch (err) {
      document.getElementById('ca-template-list').innerHTML =
        '<div class="panel-error">Failed to load templates.</div>';
    }
  }

  function renderTemplates() {
    const container = document.getElementById('ca-template-list');
    const countEl = document.getElementById('ca-template-count');

    countEl.textContent = `${templates.length} template${templates.length !== 1 ? 's' : ''}`;

    if (templates.length === 0) {
      container.innerHTML = `
        <div class="ca-empty-state" style="text-align:center; padding:60px 20px; color:var(--p-text-muted);">
          <div style="font-size:2.5rem; margin-bottom:12px;">&#x1F6E1;</div>
          <div style="font-size:1.1rem; margin-bottom:8px;">No CA policy templates yet</div>
          <div style="font-size:0.85rem;">Import a Conditional Access policy JSON from Entra to get started.</div>
        </div>`;
      return;
    }

    container.innerHTML = templates.map(t => {
      const stateClass = t.state === 'enabled' ? 'ca-state-enabled'
        : t.state === 'disabled' ? 'ca-state-disabled' : 'ca-state-report';
      const stateLabel = t.state === 'enabledForReportingButNotEnforced' ? 'Report-only' : t.state;

      return `
        <div class="ca-template-card" data-template-id="${t.id}">
          <div class="ca-card-header">
            <span class="ca-card-name">${esc(t.name)}</span>
            <span class="ca-state-badge ${stateClass}">${stateLabel}</span>
          </div>
          ${t.description ? `<div class="ca-card-desc">${esc(t.description)}</div>` : ''}
          <div class="ca-card-fields">
            <div class="ca-field-row"><span class="ca-field-label">Grant:</span> ${esc(t.grant_controls || 'None')}</div>
            <div class="ca-field-row"><span class="ca-field-label">Users:</span> ${esc(t.target_users || 'N/A')}</div>
            <div class="ca-field-row"><span class="ca-field-label">Apps:</span> ${esc(t.target_apps || 'N/A')}</div>
            ${t.conditions_summary && t.conditions_summary !== 'No extra conditions'
              ? `<div class="ca-field-row"><span class="ca-field-label">Conditions:</span> ${esc(t.conditions_summary)}</div>` : ''}
          </div>
          <div class="ca-card-footer">
            Created ${formatDate(t.created_at)}
          </div>
        </div>`;
    }).join('');

    // Wire card click handlers via delegation
    container.querySelectorAll('.ca-template-card[data-template-id]').forEach(card => {
      card.addEventListener('click', () => showDetail(parseInt(card.dataset.templateId, 10)));
    });
  }

  // ─── Export Modal (mirrors Intune export flow) ───

  async function showExportModal() {
    const overlay = document.getElementById('ca-export-overlay');
    const select = document.getElementById('ca-export-tenant');
    const progress = document.getElementById('ca-export-progress');
    const startBtn = document.getElementById('ca-export-start-btn');
    const indicator = document.getElementById('ca-export-indicator');
    const status = document.getElementById('ca-export-status');

    // Reset modal state.
    if (progress) progress.style.display = 'none';
    if (startBtn) startBtn.disabled = false;
    if (indicator) indicator.className = 'stage-indicator pending';
    if (status) status.textContent = 'Fetching policies...';
    if (select) select.value = '';

    // Populate tenant list — reuse the shared loader so both the import
    // source-tenant picker and the export picker stay in sync.
    try {
      await ensureTenantsForPicker();
      if (select) {
        const opts = ['<option value="">Select a tenant...</option>'];
        for (const t of tenantsForPicker) {
          opts.push(`<option value="${t.id}">${esc(t.display_name || t.tenant_id)}</option>`);
        }
        select.innerHTML = opts.join('');
      }
    } catch (e) {
      console.warn('[CA Templates] Failed to load tenant list for export picker:', e.message);
    }

    if (overlay) overlay.style.display = 'flex';
  }

  function hideExportModal() {
    const overlay = document.getElementById('ca-export-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function safeFilename(name) {
    return (name || 'policy')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80);
  }

  async function startExport() {
    const tenantId = document.getElementById('ca-export-tenant').value;
    if (!tenantId) { Panoptica.showToast(window.t('ca_templates.toast_select_tenant'), 'warning'); return; }

    const btn = document.getElementById('ca-export-start-btn');
    const progressDiv = document.getElementById('ca-export-progress');
    const indicator = document.getElementById('ca-export-indicator');
    const statusEl = document.getElementById('ca-export-status');

    btn.disabled = true;
    progressDiv.style.display = 'block';
    indicator.className = 'stage-indicator active';
    statusEl.textContent = 'Loading ZIP library...';

    try {
      const JSZip = await loadJSZip();

      statusEl.textContent = 'Fetching CA policies from tenant...';
      const data = await Panoptica.api(`/api/ca/export/${tenantId}`);

      if (!data.policies || data.policies.length === 0) {
        indicator.className = 'stage-indicator completed';
        statusEl.textContent = 'Tenant has 0 CA policies — nothing to export.';
        Panoptica.showToast(window.t('ca_templates.toast_no_policies'), 'warning');
        btn.disabled = false;
        return;
      }

      statusEl.textContent = `Building ZIP with ${data.totalPolicies} policy file(s)...`;

      const zip = new JSZip();
      const tenantSlug = (data.tenant || 'tenant').replace(/[^a-zA-Z0-9]/g, '_');
      const folderName = `ca-${tenantSlug}`;
      const folder = zip.folder(folderName);

      // De-duplicate filenames the same way the Intune export does, since two
      // CA policies can share a displayName even if that's unusual.
      const usedNames = {};
      for (const policy of data.policies) {
        const baseName = safeFilename(policy.displayName || 'policy');
        let fileName = baseName;
        if (usedNames[fileName.toLowerCase()]) {
          let n = 2;
          while (usedNames[`${fileName} (${n})`.toLowerCase()]) n++;
          fileName = `${baseName} (${n})`;
        }
        usedNames[fileName.toLowerCase()] = true;
        folder.file(`${fileName}.json`, JSON.stringify(policy, null, 2));
      }

      folder.file('_manifest.json', JSON.stringify({
        tenant: data.tenant,
        azureTenantId: data.azureTenantId,
        exportedAt: data.exportedAt,
        totalPolicies: data.totalPolicies,
        errors: data.errors || [],
        policies: data.policies.map(p => ({
          id: p.id,
          displayName: p.displayName,
          state: p.state,
        })),
      }, null, 2));

      statusEl.textContent = 'Generating ZIP file...';
      const blob = await zip.generateAsync({ type: 'blob' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      indicator.className = 'stage-indicator completed';
      statusEl.textContent = `Exported ${data.totalPolicies} CA policies as individual JSON files`;
      if (data.errors && data.errors.length > 0) {
        statusEl.textContent += ` (${data.errors.length} error(s) — see _manifest.json)`;
      }

      Panoptica.showToast(window.t('ca_templates.toast_export_done', { count: data.totalPolicies }), 'success');
      setTimeout(hideExportModal, 1500);

    } catch (err) {
      indicator.className = 'stage-indicator error';
      statusEl.textContent = `Export failed: ${err.message}`;
      btn.disabled = false;
      Panoptica.showToast(window.t('ca_templates.toast_export_failed', { message: err.message }), 'error');
    }
  }

  // ─── Import Modal ───

  async function showImportModal() {
    // #20 — file-only import. Start clean: empty picker, hidden until a file is
    // chosen. Name/description/monitoring all come from each policy.
    caImportData = null;
    caImportStatus = {};
    caCollisionMode = false;
    document.getElementById('ca-import-file').value = '';
    document.getElementById('ca-import-bulk').style.display = 'none';
    document.getElementById('ca-import-list').innerHTML = '';
    document.getElementById('ca-import-count').textContent = '0';
    setCaImportStatus('', null);
    const btn = document.getElementById('ca-import-submit-btn');
    btn.textContent = window.t('ca_templates.import_select_count_btn', { count: 0 });
    btn.disabled = true;

    // Load the tenant list so a ZIP's manifest tenant can be matched for
    // location-GUID substitution (non-fatal — import still works without it).
    try {
      await ensureTenantsForPicker();
    } catch (e) {
      console.warn('[CA Templates] Failed to load tenant list for source resolution:', e.message);
    }

    document.getElementById('ca-import-overlay').style.display = 'flex';
  }

  function hideImportModal() {
    document.getElementById('ca-import-overlay').style.display = 'none';
  }

  // Load the tenant list (id + azure tenant_id) used by resolveSourceTenantId
  // to auto-resolve a ZIP's source tenant from its manifest.
  async function ensureTenantsForPicker() {
    const list = await Panoptica.api('/api/tenants');
    tenantsForPicker = Array.isArray(list) ? list : [];
  }

  // ═══════════════════════════════════════════
  // #20 — file/ZIP import (pick policies, import in chunks)
  // ═══════════════════════════════════════════

  // Parse the uploaded file (ZIP of policies, an array, or a single policy
  // JSON) and show the picker.
  async function handleCaFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      try {
        const JSZip = await loadJSZip();
        const zip = await JSZip.loadAsync(file);
        const policies = [];
        const jsonFiles = Object.keys(zip.files)
          .filter(name => name.endsWith('.json') && !name.endsWith('_manifest.json') && !zip.files[name].dir)
          .sort();
        for (const fname of jsonFiles) {
          try { policies.push(JSON.parse(await zip.files[fname].async('text'))); }
          catch (parseErr) { console.warn(`[CA:Import] Failed to parse ${fname}:`, parseErr.message); }
        }
        // A ZIP comes from one tenant; auto-resolve it from the manifest so
        // location-GUID substitution happens without the operator picking.
        let sourceTenantId = null;
        const manifestFile = Object.keys(zip.files).find(n => n.endsWith('_manifest.json'));
        if (manifestFile) {
          try {
            const manifest = JSON.parse(await zip.files[manifestFile].async('text'));
            sourceTenantId = resolveSourceTenantId(manifest.azureTenantId);
          } catch (e2) { /* ignore unreadable manifest */ }
        }
        enterCaBulkMode(policies, sourceTenantId);
      } catch (zipErr) {
        Panoptica.showToast(window.t('ca_templates.toast_zip_read_failed', { message: zipErr.message }), 'error');
      }
      return;
    }

    // Plain JSON file — one policy, an array, or { policies:[…] }.
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        let policies, sourceTenantId = null;
        if (parsed && Array.isArray(parsed.policies)) { policies = parsed.policies; sourceTenantId = resolveSourceTenantId(parsed.azureTenantId); }
        else if (Array.isArray(parsed)) { policies = parsed; }
        else { policies = [parsed]; }
        enterCaBulkMode(policies, sourceTenantId);
      } catch (parseErr) {
        Panoptica.showToast(window.t('ca_templates.toast_invalid_json', { message: parseErr.message }), 'error');
      }
    };
    reader.readAsText(file);
  }

  // Map an exported manifest's Azure tenant id to a known tenant's DB id (for
  // server-side location-GUID substitution). null = unknown/not onboarded →
  // import raw (templates still load, just non-portable).
  function resolveSourceTenantId(azureTenantId) {
    if (!azureTenantId) return null;
    const match = (tenantsForPicker || []).find(t => t.tenant_id === azureTenantId);
    return match ? match.id : null;
  }

  function enterCaBulkMode(policies, sourceTenantId) {
    if (!Array.isArray(policies) || policies.length === 0) {
      Panoptica.showToast(window.t('ca_templates.toast_zip_read_failed', { message: 'no policies found' }), 'warning');
      return;
    }
    caImportData = { policies, sourceTenantId: sourceTenantId || null };
    caImportStatus = {};
    caCollisionMode = false;
    document.getElementById('ca-import-bulk').style.display = '';
    document.getElementById('ca-import-count').textContent = policies.length;
    setCaImportStatus('', null);
    renderCaImportList();
    updateCaImportCount();
  }

  function caPolicyName(p) {
    return (p && (p.displayName || p.name || (p.policy && p.policy.displayName))) || 'Unnamed Policy';
  }

  // Render the per-policy rows, honouring caImportStatus: imported rows lock
  // with a ✓, failed rows stay checked and show the reason for one-click retry.
  function renderCaImportList() {
    const list = document.getElementById('ca-import-list');
    const policies = (caImportData && caImportData.policies) || [];
    list.innerHTML = policies.map((p, i) => {
      const name = caPolicyName(p);
      const state = p && p.state ? String(p.state) : '';
      const meta = state ? `<div style="color:var(--p-text-muted); font-size:0.75rem;">${esc(state)}</div>` : '';
      const st = caImportStatus[i];

      if (st && st.state === 'ok') {
        return `
        <div class="ca-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle); opacity:0.6;">
          <span style="color:#3fb950; font-size:1rem; width:16px; text-align:center;">✓</span>
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            ${meta}
          </div>
          <span style="font-size:0.75rem; color:#3fb950;">${esc(window.t('ca_templates.import_status_imported'))}</span>
        </div>`;
      }

      const failed = st && st.state === 'failed';
      const reasonRow = failed ? `<div style="color:#f85149; font-size:0.75rem; margin-top:2px;">⚠ ${esc(caImportReasonText(st))}</div>` : '';
      return `
        <label class="ca-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle); cursor:pointer;">
          <input type="checkbox" class="ca-import-check" data-index="${i}" checked style="margin-top:0;">
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            ${meta}
            ${reasonRow}
          </div>
        </label>`;
    }).join('');
  }

  // Shared progress / results banner above the bulk list.
  function setCaImportStatus(text, type) {
    const el = document.getElementById('ca-import-status');
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = text;
    el.style.color = type === 'warning' ? '#f85149' : 'var(--p-text-muted)';
    el.style.fontWeight = type === 'warning' ? '600' : '400';
    el.style.display = 'block';
  }

  function caImportReasonText(st) {
    const KEYS = {
      duplicate_name: 'import_reason_duplicate_name',
      db_busy: 'import_reason_db_busy',
      too_large: 'import_reason_too_large',
      missing_fields: 'import_reason_missing_fields',
      request_failed: 'import_reason_request_failed',
      generic: 'import_reason_generic',
    };
    const key = st && KEYS[st.reason];
    if (key) return window.t('ca_templates.' + key);
    return (st && st.error) || window.t('ca_templates.import_reason_generic');
  }

  function updateCaImportCount() {
    // The collision step manages its own button (Apply); don't let the choice
    // <select>s reset it.
    if (caCollisionMode) return;
    const checked = document.querySelectorAll('.ca-import-check:checked').length;
    const btn = document.getElementById('ca-import-submit-btn');
    // After a partial import some rows carry a status → the button retries the
    // still-failed (checked) ones; before any import it's a fresh selection.
    btn.textContent = Object.keys(caImportStatus).length > 0
      ? window.t('ca_templates.import_retry_failed_btn', { count: checked })
      : window.t('ca_templates.import_select_count_btn', { count: checked });
    btn.disabled = checked === 0;
  }

  function toggleAllCaImports(state) {
    document.querySelectorAll('.ca-import-check').forEach(cb => { cb.checked = state; });
    updateCaImportCount();
  }

  async function submitCaBulkImport() {
    // In the collision step the button applies the New/Overwrite choices.
    if (caCollisionMode) return applyCaCollisionChoices();
    if (!caImportData) return;
    const checkboxes = document.querySelectorAll('.ca-import-check:checked');
    const selectedIndices = [...checkboxes].map(cb => parseInt(cb.dataset.index, 10));
    if (selectedIndices.length === 0) { Panoptica.showToast(window.t('ca_templates.toast_no_policies_selected'), 'warning'); return; }

    document.getElementById('ca-import-submit-btn').disabled = true;

    const attempts = selectedIndices.map(i => {
      const p = caImportData.policies[i];
      const name = caPolicyName(p);
      return { index: i, name, payload: { name, description: '', policy_json: p } };
    });

    await importCaChunks(attempts);
    await loadTemplates();
    finishCaImport();
  }

  // Chunked POST + per-item correlation (ok / collision / failed). Shared by the
  // first pass, failure-retry, and the collision re-submit.
  async function importCaChunks(attempts) {
    const total = attempts.length;
    let done = 0;
    setCaImportStatus(window.t('ca_templates.import_progress', { done, total }), 'info');
    const sourceTenantId = caImportData.sourceTenantId || undefined;
    for (let start = 0; start < attempts.length; start += CA_IMPORT_CHUNK_SIZE) {
      const chunk = attempts.slice(start, start + CA_IMPORT_CHUNK_SIZE);
      try {
        const body = { templates: chunk.map(a => a.payload) };
        if (sourceTenantId) body.source_tenant_id = sourceTenantId;
        const result = await Panoptica.api('/api/ca/templates/bulk', { method: 'POST', body: JSON.stringify(body) });
        // Correlate by the REQUESTED name (the name we sent), not the final
        // stored name — 'new' renames the template, so they differ.
        const okNames = (result.templates || []).map(x => x.requested_name || x.name);
        const errs = (result.errors || []).slice();
        const cols = (result.collisions || []).slice();
        for (const a of chunk) {
          const okPos = okNames.indexOf(a.name);
          if (okPos !== -1) { okNames.splice(okPos, 1); caImportStatus[a.index] = { state: 'ok' }; continue; }
          const cPos = cols.findIndex(c => c.name === a.name);
          if (cPos !== -1) { const c = cols.splice(cPos, 1)[0]; caImportStatus[a.index] = { state: 'collision', existing_id: c.existing_id, deployed_count: c.deployed_count, payload: a.payload }; continue; }
          const ePos = errs.findIndex(e => (e.name || 'unknown') === a.name);
          const e = ePos !== -1 ? errs.splice(ePos, 1)[0] : null;
          caImportStatus[a.index] = { state: 'failed', reason: (e && e.reason) || 'generic', error: e && e.error };
        }
      } catch (err) {
        console.warn('[CA:Import] Chunk failed:', err && err.message);
        const reason = classifyCaChunkError(err);
        for (const a of chunk) caImportStatus[a.index] = { state: 'failed', reason, error: err && err.message };
      }
      done += chunk.length;
      setCaImportStatus(window.t('ca_templates.import_progress', { done, total }), 'info');
    }
  }

  // After a pass: resolve collisions FIRST, then failures (retry), else success.
  function finishCaImport() {
    const collisions = Object.keys(caImportStatus)
      .filter(i => caImportStatus[i].state === 'collision')
      .map(i => Object.assign({ index: Number(i) }, caImportStatus[i]));
    const okCount = Object.values(caImportStatus).filter(s => s.state === 'ok').length;
    const failCount = Object.values(caImportStatus).filter(s => s.state === 'failed').length;

    if (collisions.length > 0) {
      caCollisionMode = true;
      renderCaImportCollisions(collisions);
      return;
    }
    caCollisionMode = false;
    if (failCount === 0) {
      Panoptica.showToast(window.t('ca_templates.toast_imported', { imported: okCount }), 'success');
      hideImportModal();
      return;
    }
    Panoptica.showToast(window.t('ca_templates.toast_imported_with_failures', { imported: okCount, failed: failCount }), 'warning');
    setCaImportStatus(window.t('ca_templates.import_results_summary', { imported: okCount, failed: failCount }), 'warning');
    renderCaImportList();
    updateCaImportCount();
  }

  // Collision step: one row per name clash with a New-copy / Overwrite choice.
  // Overwrite on a DEPLOYED template shows the blast-radius warning.
  function renderCaImportCollisions(collisions) {
    const list = document.getElementById('ca-import-list');
    setCaImportStatus(window.t('ca_templates.import_collisions_summary', { count: collisions.length }), 'warning');
    list.innerHTML = collisions.map(c => {
      const name = c.payload.name;
      const warn = c.deployed_count > 0
        ? `<div style="color:#f85149; font-size:0.75rem; margin-top:2px;">⚠ ${esc(window.t('ca_templates.import_collision_deployed_warn', { count: c.deployed_count }))}</div>`
        : '';
      const opt = (v, label) => `<option value="${v}">${esc(label)}</option>`;
      return `
        <div class="ca-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle);">
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            <div style="color:var(--p-text-muted); font-size:0.75rem;">${esc(window.t('ca_templates.import_reason_duplicate_name'))}</div>
            ${warn}
          </div>
          <select class="ca-collision-choice form-control" data-index="${c.index}" style="width:auto; min-width:170px; font-size:0.78rem; padding:4px 8px;">
            ${opt('new', window.t('ca_templates.import_collision_new'))}${opt('overwrite', window.t('ca_templates.import_collision_overwrite'))}
          </select>
        </div>`;
    }).join('');
    const btn = document.getElementById('ca-import-submit-btn');
    btn.textContent = window.t('ca_templates.import_collision_apply', { count: collisions.length });
    btn.disabled = false;
  }

  // Re-submit just the collisions, each with its chosen on_collision directive.
  async function applyCaCollisionChoices() {
    const attempts = [];
    document.querySelectorAll('.ca-collision-choice').forEach(sel => {
      const idx = parseInt(sel.dataset.index, 10);
      const st = caImportStatus[idx];
      if (!st || st.state !== 'collision') return;
      const choice = sel.value === 'overwrite' ? 'overwrite' : 'new';
      attempts.push({ index: idx, name: st.payload.name, payload: Object.assign({}, st.payload, { on_collision: choice }) });
    });
    if (attempts.length === 0) return;
    document.getElementById('ca-import-submit-btn').disabled = true;
    await importCaChunks(attempts);
    await loadTemplates();
    finishCaImport();
  }

  function classifyCaChunkError(err) {
    const m = String((err && err.message) || '').toLowerCase();
    if (/413|too large|payload|entity too large/.test(m)) return 'too_large';
    return 'request_failed';
  }

  // ─── Detail / Edit Modal ───

  // Each entry has an i18nKey pointing into ca_templates.* keys in en.json/fr.json.
  // The English `label` stays as a fallback for graceful degradation if the
  // locale fetch failed or a key is missing — the renderer below uses
  // tOrFallback(key, label).
  const ALL_MONITOR_FIELDS = [
    { value: 'state', label: 'Policy state (enabled/disabled)', i18nKey: 'ca_templates.field_state' },
    { value: 'grantControls.builtInControls', label: 'Grant controls (MFA, compliant device, etc.)', i18nKey: 'ca_templates.field_grant_controls' },
    { value: 'conditions.users.includeUsers', label: 'Target users', i18nKey: 'ca_templates.field_target_users' },
    { value: 'conditions.users.includeRoles', label: 'Target roles', i18nKey: 'ca_templates.field_target_roles' },
    { value: 'conditions.users.includeGroups', label: 'Target groups', i18nKey: 'ca_templates.field_target_groups' },
    { value: 'conditions.applications.includeApplications', label: 'Target applications', i18nKey: 'ca_templates.field_target_applications' },
    { value: 'conditions.platforms.includePlatforms', label: 'Platform conditions', i18nKey: 'ca_templates.field_platforms' },
    { value: 'conditions.locations.includeLocations', label: 'Included locations', i18nKey: 'ca_templates.field_included_locations' },
    { value: 'conditions.locations.excludeLocations', label: 'Excluded locations', i18nKey: 'ca_templates.field_excluded_locations' },
    { value: 'conditions.devices.deviceFilter', label: 'Device filter (compliance, etc.)', i18nKey: 'ca_templates.field_device_filter' },
    { value: 'conditions.signInRiskLevels', label: 'Sign-in risk levels', i18nKey: 'ca_templates.field_signin_risk' },
    { value: 'conditions.userRiskLevels', label: 'User risk levels', i18nKey: 'ca_templates.field_user_risk' },
    { value: 'conditions.clientAppTypes', label: 'Client app types', i18nKey: 'ca_templates.field_client_app_types' },
    { value: 'sessionControls', label: 'Session controls', i18nKey: 'ca_templates.field_session_controls' },
    { value: 'conditions.authenticationFlows', label: 'Authentication flows (device code, etc.)', i18nKey: 'ca_templates.field_authentication_flows' },
  ];

  async function showDetail(id) {
    currentTemplateId = id;
    try {
      const t = await Panoptica.api(`/api/ca/templates/${id}`);
      document.getElementById('ca-detail-title').textContent = window.t('ca_templates.modal_edit_title');

      const policy = typeof t.policy_json === 'string' ? JSON.parse(t.policy_json) : t.policy_json;
      const monitored = typeof t.monitored_fields === 'string' ? JSON.parse(t.monitored_fields) : (t.monitored_fields || []);
      const monitoredSet = new Set(monitored);

      document.getElementById('ca-detail-body').innerHTML = `
        <div class="ca-detail-section">
          <div class="form-group">
            <label>${esc(window.t('ca_templates.label_template_name'))}</label>
            <input type="text" id="ca-edit-name" class="form-control" data-role-readonly="admin" value="${esc(t.name)}">
          </div>
          <div class="form-group">
            <label>${esc(window.t('ca_templates.label_description'))}</label>
            <input type="text" id="ca-edit-desc" class="form-control" data-role-readonly="admin" value="${esc(t.description || '')}" placeholder="${esc(window.t('ca_templates.placeholder_optional_desc'))}">
          </div>
        </div>
        <div class="ca-detail-section" style="margin-top:16px;">
          <h4 style="color:var(--p-warm); margin:0 0 8px;">${esc(window.t('ca_templates.section_summary'))} <span style="font-size:0.7rem; color:var(--p-text-muted); font-weight:400;">${esc(window.t('ca_templates.section_summary_hint'))}</span></h4>
          <div class="ca-detail-grid">
            <div><span class="ca-field-label">${esc(window.t('ca_templates.field_label_state'))}</span> ${esc(t.state)}</div>
            <div><span class="ca-field-label">${esc(window.t('ca_templates.field_label_grant_controls'))}</span> ${esc(t.grant_controls)}</div>
            <div><span class="ca-field-label">${esc(window.t('ca_templates.field_label_target_users'))}</span> ${esc(t.target_users)}</div>
            <div><span class="ca-field-label">${esc(window.t('ca_templates.field_label_target_apps'))}</span> ${esc(t.target_apps)}</div>
            <div><span class="ca-field-label">${esc(window.t('ca_templates.field_label_conditions'))}</span> ${esc(t.conditions_summary)}</div>
          </div>
        </div>
        <div class="ca-detail-section" style="margin-top:16px;">
          <h4 style="color:var(--p-warm); margin:0 0 8px;">${esc(window.t('ca_templates.label_fields_to_monitor'))}</h4>
          <div id="ca-edit-fields" class="ca-field-checks" style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px;">
            ${ALL_MONITOR_FIELDS.map(f => {
              const label = window.PanopticaI18n.tOrFallback(f.i18nKey, f.label);
              return `<label class="ca-check"><input type="checkbox" data-role-readonly="admin" value="${f.value}" ${monitoredSet.has(f.value) ? 'checked' : ''}> ${esc(label)}</label>`;
            }).join('')}
          </div>
        </div>
        <div class="ca-detail-section" style="margin-top:16px;">
          <h4 style="color:var(--p-warm); margin:0 0 8px;">${esc(window.t('ca_templates.section_alert_routing'))} <span style="font-size:0.7rem; color:var(--p-text-muted); font-weight:400;">${esc(window.t('ca_templates.section_alert_routing_hint'))}</span></h4>
          <select id="ca-edit-alert-routing" class="form-control" data-role-readonly="admin" style="max-width:280px;">
            <option value="both" ${(t.alert_routing || 'both') === 'both' ? 'selected' : ''}>${esc(window.t('ca_templates.routing_email_and_psa'))}</option>
            <option value="support" ${t.alert_routing === 'support' ? 'selected' : ''}>${esc(window.t('ca_templates.routing_psa_only'))}</option>
            <option value="personal" ${t.alert_routing === 'personal' ? 'selected' : ''}>${esc(window.t('ca_templates.routing_email_only'))}</option>
            <option value="none" ${t.alert_routing === 'none' ? 'selected' : ''}>${esc(window.t('ca_templates.routing_none'))}</option>
          </select>
        </div>
        <div class="ca-detail-section" style="margin-top:16px;">
          <h4 style="color:var(--p-warm); margin:0 0 8px;">${esc(window.t('ca_templates.section_raw_json'))}</h4>
          <pre class="ca-json-pre">${esc(JSON.stringify(policy, null, 2))}</pre>
        </div>`;

      document.getElementById('ca-detail-overlay').style.display = 'flex';
    } catch (err) {
      Panoptica.showToast(window.t('ca_templates.toast_load_detail_failed'), 'error');
    }
  }

  function hideDetailModal() {
    document.getElementById('ca-detail-overlay').style.display = 'none';
    currentTemplateId = null;
  }

  async function saveTemplate() {
    if (!currentTemplateId) return;

    const name = document.getElementById('ca-edit-name').value.trim();
    const description = document.getElementById('ca-edit-desc').value.trim();
    if (!name) return Panoptica.showToast(window.t('ca_templates.toast_template_name_required'), 'error');

    const monitored_fields = [];
    document.querySelectorAll('#ca-edit-fields input:checked').forEach(cb => {
      monitored_fields.push(cb.value);
    });
    const alert_routing = document.getElementById('ca-edit-alert-routing').value;

    try {
      await Panoptica.api(`/api/ca/templates/${currentTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description: description || null, monitored_fields, alert_routing }),
      });
      Panoptica.showToast(window.t('ca_templates.toast_template_updated'), 'success');
      hideDetailModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('ca_templates.toast_save_failed', { message: err.message }), 'error');
    }
  }

  async function deleteTemplate() {
    if (!currentTemplateId) return;
    if (!(await Panoptica.confirmModal(window.t('ca_templates.confirm_delete'), { danger: true }))) return;

    try {
      await Panoptica.api(`/api/ca/templates/${currentTemplateId}`, { method: 'DELETE' });
      Panoptica.showToast(window.t('ca_templates.toast_template_deleted'), 'success');
      hideDetailModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('ca_templates.toast_delete_failed', { message: err.message }), 'error');
    }
  }

  // ─── Helpers ───

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-CA');
  }

  // ─── Expose ───
  window.PanopticaPage = {
    init,
    destroy,
    showImportModal,
    hideImportModal,
    showDetail,
    hideDetailModal,
    deleteTemplate,
  };
})();
