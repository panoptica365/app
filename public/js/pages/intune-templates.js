/**
 * Panoptica — Intune Templates Page Script
 * Export from tenant (as ZIP of individual JSONs), import as templates, view, deploy.
 */
(function () {
  'use strict';

  let templates = [];
  let tenants = [];
  let currentTemplateId = null;
  let importData = null;

  // #20 — import in small chunks so one big ZIP never sends a single oversized
  // request body (the cause of the "HTTP 500" on multi-policy import), and so
  // the DB is paced. State that survives across a retry of the failed subset:
  const IMPORT_CHUNK_SIZE = 5;
  let importStatus = {};   // original policy index -> { state:'ok'|'failed', reason, error }
  let importAssign = {};   // original policy index -> chosen assignment_target (kept across retry)
  let importMode = 'initial'; // 'initial' | 'results' — drives the submit button label

  // ─── JSZip loader (loaded on demand from CDN) ───
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

  // ─── Category Labels ───
  const CATEGORY_LABELS = {
    endpointSecurityAttackSurfaceReduction: 'ASR Rules',
    endpointSecurityAntivirus: 'Defender Antivirus',
    endpointSecurityDiskEncryption: 'Disk Encryption',
    endpointSecurityEndpointDetectionAndResponse: 'EDR',
    endpointSecurityFirewall: 'Firewall',
    endpointSecurityAccountProtection: 'Account Protection',
    settingsCatalog: 'Settings Catalog',
    administrativeTemplates: 'Admin Templates',
    securityBaseline: 'Security Baseline',
    compliancePolicy: 'Compliance Policy',
    deviceConfiguration: 'Device Configuration',
    windowsHealthMonitoringConfiguration: 'Health Monitoring',
    windows10CompliancePolicy: 'Windows Compliance',
    iosCompliancePolicy: 'iOS Compliance',
    none: 'Uncategorized',
    other: 'Other',
  };

  const POLICY_TYPE_LABELS = {
    configurationPolicies: 'Settings Catalog',
    deviceConfigurations: 'Device Config (Legacy)',
    deviceCompliancePolicies: 'Compliance',
    groupPolicyConfigurations: 'Admin Templates',
    intents: 'Security Baselines',
  };

  function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || cat;
  }

  function policyTypeLabel(pt) {
    return POLICY_TYPE_LABELS[pt] || pt;
  }

  // ─── Lifecycle ───

  async function init() {
    document.getElementById('intune-import-btn').addEventListener('click', showImportModal);
    document.getElementById('intune-export-btn').addEventListener('click', showExportModal);
    document.getElementById('intune-export-cancel-btn').addEventListener('click', hideExportModal);
    document.getElementById('intune-export-start-btn').addEventListener('click', startExport);
    document.getElementById('intune-import-cancel-btn').addEventListener('click', hideImportModal);
    document.getElementById('intune-import-submit-btn').addEventListener('click', submitImport);
    document.getElementById('intune-import-file').addEventListener('change', handleFileSelect);
    document.getElementById('intune-import-select-all').addEventListener('click', () => toggleAllImports(true));
    document.getElementById('intune-import-select-none').addEventListener('click', () => toggleAllImports(false));
    // Keep the submit-button count in sync as checkboxes toggle (delegated once).
    document.getElementById('intune-import-list').addEventListener('change', updateImportCount);
    document.getElementById('intune-detail-close-btn').addEventListener('click', closeDetail);
    document.getElementById('intune-detail-delete-btn').addEventListener('click', deleteTemplate);
    document.getElementById('intune-detail-save-btn').addEventListener('click', saveTemplate);
    document.getElementById('intune-detail-deploy-btn').addEventListener('click', showDeployFromDetail);
    document.getElementById('intune-deploy-cancel-btn').addEventListener('click', hideDeployModal);
    document.getElementById('intune-deploy-start-btn').addEventListener('click', startDeploy);
    document.getElementById('intune-category-filter').addEventListener('change', renderTemplates);

    // Close modals when the overlay backdrop is clicked
    ['intune-export-overlay', 'intune-import-overlay', 'intune-detail-overlay', 'intune-deploy-overlay'].forEach(id => {
      document.getElementById(id).addEventListener('click', (e) => {
        if (e.target.id === id) e.target.style.display = 'none';
      });
    });

    await Promise.all([loadTemplates(), loadTenants()]);
  }

  function destroy() {
    templates = [];
    tenants = [];
    currentTemplateId = null;
    importData = null;
  }

  // ─── Load Data ───

  async function loadTenants() {
    try {
      tenants = await Panoptica.api('/api/tenants');
    } catch (err) {
      console.error('[Intune] Failed to load tenants:', err);
      tenants = [];
    }
  }

  async function loadTemplates() {
    try {
      templates = await Panoptica.api('/api/intune/templates');
      populateCategoryFilter();
      renderTemplates();
    } catch (err) {
      document.getElementById('intune-template-list').innerHTML =
        '<div class="panel-error">Failed to load templates.</div>';
    }
  }

  function populateCategoryFilter() {
    const select = document.getElementById('intune-category-filter');
    const categories = [...new Set(templates.map(t => t.category))].sort();
    select.innerHTML = '<option value="">All Categories</option>' +
      categories.map(c => `<option value="${esc(c)}">${esc(categoryLabel(c))}</option>`).join('');
  }

  function populateTenantSelect(selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Select a tenant...</option>' +
      tenants.map(t => `<option value="${t.id}">${esc(t.display_name)}</option>`).join('');
  }

  // ─── Render Templates ───

  function renderTemplates() {
    const container = document.getElementById('intune-template-list');
    const countEl = document.getElementById('intune-template-count');
    const filter = document.getElementById('intune-category-filter').value;

    const filtered = filter ? templates.filter(t => t.category === filter) : templates;
    countEl.textContent = `${filtered.length} template${filtered.length !== 1 ? 's' : ''}${filter ? ` in ${categoryLabel(filter)}` : ''}`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="ca-empty-state" style="text-align:center; padding:60px 20px; color:var(--p-text-muted);">
          <div style="font-size:2.5rem; margin-bottom:12px;">&#x1F4CB;</div>
          <div style="font-size:1.1rem; margin-bottom:8px;">No Intune policy templates yet</div>
          <div style="font-size:0.85rem;">Export policies from a tenant, then import the ones you want as templates.</div>
        </div>`;
      return;
    }

    const groups = {};
    for (const t of filtered) {
      const cat = t.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    let html = '';
    for (const [cat, items] of Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))) {
      html += `<div class="intune-cat-header" style="grid-column:1/-1; margin-top:16px; margin-bottom:4px;">
        <span style="color:var(--p-warm-bright); font-family:'Inter',sans-serif; font-size:1rem; letter-spacing:0.08em; text-transform:uppercase;">
          ${esc(categoryLabel(cat))}
        </span>
        <span style="color:var(--p-text-muted); font-size:0.8rem; margin-left:8px;">${items.length}</span>
      </div>`;

      for (const t of items) {
        html += `
          <div class="ca-template-card" data-template-id="${t.id}" style="cursor:pointer;">
            <div class="ca-card-header">
              <span class="ca-card-name">${esc(t.name)}</span>
              <span class="ca-state-badge ca-state-enabled" style="font-size:0.7rem;">${esc(policyTypeLabel(t.policy_type))}</span>
            </div>
            ${t.description ? `<div class="ca-card-desc">${esc(truncate(t.description, 120))}</div>` : ''}
            <div class="ca-card-fields">
              <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('intune_templates.detail_label_platform'))}</span> ${esc(t.platform || window.t('intune_templates.detail_platform_na'))}</div>
              ${t.template_family ? `<div class="ca-field-row"><span class="ca-field-label">Family:</span> ${esc(categoryLabel(t.template_family))}</div>` : ''}
              ${t.source_tenant ? `<div class="ca-field-row"><span class="ca-field-label">Source:</span> ${esc(t.source_tenant)}</div>` : ''}
              ${t.tags ? `<div class="ca-field-row"><span class="ca-field-label">${esc(window.t('intune_templates.detail_label_tags'))}</span> ${esc(t.tags)}</div>` : ''}
              <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('intune_templates.detail_label_assignment'))}</span> ${esc(window.t(t.assignment_target === 'all_users' ? 'intune_templates.assign_all_users' : t.assignment_target === 'all_devices' ? 'intune_templates.assign_all_devices' : 'intune_templates.assign_none'))}</div>
              <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('intune_templates.detail_label_alerts'))}</span> ${esc(window.t({both:'intune_templates.alert_email_and_psa',support:'intune_templates.alert_psa_only',personal:'intune_templates.alert_email_only',none:'intune_templates.alert_none'}[t.alert_routing || 'both']))}</div>
            </div>
            <div class="ca-card-footer">
              Imported ${formatDate(t.created_at)}
            </div>
          </div>`;
      }
    }

    container.innerHTML = html;

    container.querySelectorAll('.ca-template-card[data-template-id]').forEach(card => {
      card.addEventListener('click', () => showDetail(parseInt(card.dataset.templateId, 10)));
    });
  }

  // ═══════════════════════════════════════════
  // EXPORT FLOW
  // ═══════════════════════════════════════════

  function showExportModal() {
    populateTenantSelect('intune-export-tenant');
    document.getElementById('intune-export-progress').style.display = 'none';
    document.getElementById('intune-export-start-btn').disabled = false;
    document.getElementById('intune-export-overlay').style.display = 'flex';
  }

  function hideExportModal() {
    document.getElementById('intune-export-overlay').style.display = 'none';
  }

  function safeFilename(name) {
    return (name || 'policy')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80);
  }

  async function startExport() {
    const tenantId = document.getElementById('intune-export-tenant').value;
    if (!tenantId) { Panoptica.showToast(window.t('intune_templates.toast_select_tenant'), 'warning'); return; }

    const btn = document.getElementById('intune-export-start-btn');
    const progressDiv = document.getElementById('intune-export-progress');
    const indicator = document.getElementById('intune-export-indicator');
    const statusEl = document.getElementById('intune-export-status');

    btn.disabled = true;
    progressDiv.style.display = 'block';
    indicator.className = 'stage-indicator active';
    statusEl.textContent = 'Loading ZIP library...';

    try {
      const JSZip = await loadJSZip();

      statusEl.textContent = 'Fetching policies from tenant... This may take a minute.';
      const data = await Panoptica.api(`/api/intune/export/${tenantId}`);

      statusEl.textContent = `Building ZIP with ${data.totalPolicies} policy files...`;

      const zip = new JSZip();
      const tenantSlug = (data.tenant || 'tenant').replace(/[^a-zA-Z0-9]/g, '_');
      const folderName = `intune-${tenantSlug}`;
      const folder = zip.folder(folderName);

      const usedNames = {};
      for (const policy of data.policies) {
        const individual = {
          policyType: policy.policyType,
          name: policy.name,
          description: policy.description,
          category: policy.category,
          templateFamily: policy.templateFamily,
          policy: policy.policy,
        };
        if (policy.settings) individual.settings = policy.settings;
        if (policy.definitionValues) individual.definitionValues = policy.definitionValues;

        let baseName = safeFilename(policy.name);
        let fileName = baseName;
        if (usedNames[fileName.toLowerCase()]) {
          let n = 2;
          while (usedNames[`${fileName} (${n})`.toLowerCase()]) n++;
          fileName = `${baseName} (${n})`;
        }
        usedNames[fileName.toLowerCase()] = true;
        folder.file(`${fileName}.json`, JSON.stringify(individual, null, 2));
      }

      folder.file('_manifest.json', JSON.stringify({
        tenant: data.tenant,
        exportedAt: data.exportedAt,
        totalPolicies: data.totalPolicies,
        errors: data.errors || [],
        policies: data.policies.map(p => ({ name: p.name, policyType: p.policyType, category: p.category })),
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
      statusEl.textContent = `Exported ${data.totalPolicies} policies as individual JSON files`;
      if (data.errors && data.errors.length > 0) {
        statusEl.textContent += ` (${data.errors.length} endpoint(s) had errors)`;
      }

      Panoptica.showToast(window.t('intune_templates.toast_export_done', { count: data.totalPolicies }), 'success');
      setTimeout(hideExportModal, 2000);

    } catch (err) {
      indicator.className = 'stage-indicator error';
      statusEl.textContent = `Export failed: ${err.message}`;
      btn.disabled = false;
      Panoptica.showToast(window.t('intune_templates.toast_export_failed', { message: err.message }), 'error');
    }
  }

  // ═══════════════════════════════════════════
  // IMPORT FLOW
  // ═══════════════════════════════════════════

  function showImportModal() {
    importData = null;
    importStatus = {};
    importAssign = {};
    importMode = 'initial';
    document.getElementById('intune-import-file').value = '';
    document.getElementById('intune-import-preview').style.display = 'none';
    document.getElementById('intune-import-submit-btn').disabled = true;
    document.getElementById('intune-import-overlay').style.display = 'flex';
  }

  function hideImportModal() {
    document.getElementById('intune-import-overlay').style.display = 'none';
    importData = null;
  }

  async function handleFileSelect(e) {
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
          try {
            const content = await zip.files[fname].async('text');
            policies.push(JSON.parse(content));
          } catch (parseErr) {
            console.warn(`[Intune:Import] Failed to parse ${fname}:`, parseErr.message);
          }
        }

        importData = { sourceTenant: null, policies };
        const manifestFile = Object.keys(zip.files).find(n => n.endsWith('_manifest.json'));
        if (manifestFile) {
          try {
            const manifest = JSON.parse(await zip.files[manifestFile].async('text'));
            importData.sourceTenant = manifest.tenant || null;
          } catch (e) { /* ignore */ }
        }
        renderImportPreview(policies);
      } catch (zipErr) {
        Panoptica.showToast(window.t('intune_templates.toast_zip_read_failed', { message: zipErr.message }), 'error');
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        let policies;
        if (parsed.policies && Array.isArray(parsed.policies)) {
          policies = parsed.policies;
          importData = { sourceTenant: parsed.tenant || null, policies };
        } else if (Array.isArray(parsed)) {
          policies = parsed;
          importData = { sourceTenant: null, policies };
        } else {
          policies = [parsed];
          importData = { sourceTenant: null, policies };
        }
        renderImportPreview(policies);
      } catch (parseErr) {
        Panoptica.showToast(window.t('intune_templates.toast_invalid_json_file', { message: parseErr.message }), 'error');
      }
    };
    reader.readAsText(file);
  }

  function renderImportPreview(policies) {
    const preview = document.getElementById('intune-import-preview');
    const countEl = document.getElementById('intune-import-count');

    // Fresh selection — clear any results from a previous import session.
    importStatus = {};
    importAssign = {};
    importMode = 'initial';
    setImportStatus('', null);

    countEl.textContent = policies.length;
    preview.style.display = 'block';

    renderImportList();

    // Wire default assignment dropdown to set all per-policy dropdowns
    const defaultAssignEl = document.getElementById('intune-import-default-assign');
    if (defaultAssignEl) {
      defaultAssignEl.onchange = () => {
        document.querySelectorAll('.intune-import-assign').forEach(sel => { sel.value = defaultAssignEl.value; });
      };
    }

    document.getElementById('intune-import-submit-btn').disabled = false;
    updateImportCount();
  }

  // Render the per-policy rows, honouring importStatus: already-imported rows
  // are locked with a ✓, failed rows stay selectable (checked) and show the
  // reason so the operator can retry just those. Pristine rows look as before.
  function renderImportList() {
    const list = document.getElementById('intune-import-list');
    const policies = (importData && importData.policies) || [];
    list.innerHTML = policies.map((p, i) => {
      const name = p.name || p.displayName || p.policy?.name || p.policy?.displayName || 'Unnamed Policy';
      const type = p.policyType || 'unknown';
      const cat = p.category || '';
      const meta = `${esc(policyTypeLabel(type))}${cat ? ' — ' + esc(categoryLabel(cat)) : ''}`;
      const st = importStatus[i];

      if (st && st.state === 'ok') {
        return `
        <div class="intune-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle); opacity:0.6;">
          <span style="color:#3fb950; font-size:1rem; width:16px; text-align:center;">✓</span>
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            <div style="color:var(--p-text-muted); font-size:0.75rem;">${meta}</div>
          </div>
          <span style="font-size:0.75rem; color:#3fb950;">${esc(window.t('intune_templates.import_status_imported'))}</span>
        </div>`;
      }

      const assignVal = importAssign[i] || 'none';
      const opt = (v, label) => `<option value="${v}"${assignVal === v ? ' selected' : ''}>${label}</option>`;
      const failed = st && st.state === 'failed';
      const reasonRow = failed
        ? `<div style="color:#f85149; font-size:0.75rem; margin-top:2px;">⚠ ${esc(importReasonText(st))}</div>`
        : '';
      return `
        <label class="intune-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle); cursor:pointer;">
          <input type="checkbox" class="intune-import-check" data-index="${i}" checked style="margin-top:0;">
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            <div style="color:var(--p-text-muted); font-size:0.75rem;">${meta}</div>
            ${reasonRow}
          </div>
          <select class="intune-import-assign form-control" data-index="${i}" style="width:auto; min-width:110px; font-size:0.75rem; padding:3px 6px;">
            ${opt('none', 'None')}${opt('all_users', 'All Users')}${opt('all_devices', 'All Devices')}
          </select>
        </label>`;
    }).join('');
  }

  // Shared progress / results banner above the list. type: null|'info'|'warning'.
  function setImportStatus(text, type) {
    const el = document.getElementById('intune-import-status');
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = text;
    el.style.color = type === 'warning' ? '#f85149' : 'var(--p-text-muted)';
    el.style.fontWeight = type === 'warning' ? '600' : '400';
    el.style.display = 'block';
  }

  // Map a backend reason code (or chunk-level failure) to a localized string,
  // falling back to the server's safe English text if the code is unknown.
  function importReasonText(st) {
    const KEYS = {
      duplicate_name: 'import_reason_duplicate_name',
      db_busy: 'import_reason_db_busy',
      too_large: 'import_reason_too_large',
      missing_fields: 'import_reason_missing_fields',
      request_failed: 'import_reason_request_failed',
      generic: 'import_reason_generic',
    };
    const key = st && KEYS[st.reason];
    if (key) return window.t('intune_templates.' + key);
    return (st && st.error) || window.t('intune_templates.import_reason_generic');
  }

  function updateImportCount() {
    // The collision step manages its own button (Apply); don't let list changes
    // (the choice <select>s) reset it.
    if (importMode === 'collisions') return;
    const checked = document.querySelectorAll('.intune-import-check:checked').length;
    const btn = document.getElementById('intune-import-submit-btn');
    btn.textContent = importMode === 'results'
      ? window.t('intune_templates.import_retry_failed_btn', { count: checked })
      : window.t('intune_templates.btn_import_selected_count', { count: checked });
    btn.disabled = checked === 0;
  }

  function toggleAllImports(state) {
    document.querySelectorAll('.intune-import-check').forEach(cb => { cb.checked = state; });
    updateImportCount();
  }

  async function submitImport() {
    // In the collision-resolution step the button applies the New/Overwrite
    // choices instead of importing checked rows.
    if (importMode === 'collisions') return applyCollisionChoices();
    if (!importData) return;

    const checkboxes = document.querySelectorAll('.intune-import-check:checked');
    const selectedIndices = [...checkboxes].map(cb => parseInt(cb.dataset.index, 10));
    if (selectedIndices.length === 0) { Panoptica.showToast(window.t('intune_templates.toast_no_policies_selected'), 'warning'); return; }

    const btn = document.getElementById('intune-import-submit-btn');
    btn.disabled = true;

    // Capture every visible assignment choice so a retry re-render keeps them.
    document.querySelectorAll('.intune-import-assign').forEach(sel => {
      importAssign[parseInt(sel.dataset.index, 10)] = sel.value;
    });

    // Build one attempt per selected policy; the original index lets us map the
    // backend's results back onto the right row for the failure/retry display.
    const attempts = selectedIndices.map(i => {
      const p = importData.policies[i];
      const name = p.name || p.displayName || p.policy?.name || p.policy?.displayName || 'Unnamed Policy';
      let policyJson = p.policy || p;
      if (p.settings && Array.isArray(p.settings)) policyJson = { ...policyJson, settings: p.settings };
      if (p.definitionValues && Array.isArray(p.definitionValues)) policyJson = { ...policyJson, definitionValues: p.definitionValues };
      return {
        index: i,
        name,
        payload: {
          name,
          description: p.description || p.policy?.description || '',
          category: p.category || p.templateFamily || 'other',
          policy_type: p.policyType || 'configurationPolicies',
          platform: p.policy?.platforms || 'windows10',
          template_family: p.templateFamily || p.policy?.templateReference?.templateFamily || null,
          policy_json: policyJson,
          source_tenant: importData.sourceTenant || null,
          assignment_target: importAssign[i] || 'none',
        },
      };
    });

    await importChunks(attempts);
    // Refresh the grid behind the modal so newly imported templates show up.
    await loadTemplates();
    finishImport();
  }

  // Chunked POST + per-item correlation (ok / collision / failed). Shared by the
  // first pass, the failure-retry, and the collision re-submit. Updates
  // importStatus keyed by original policy index.
  async function importChunks(attempts) {
    const total = attempts.length;
    let done = 0;
    setImportStatus(window.t('intune_templates.import_progress', { done, total }), 'info');
    for (let start = 0; start < attempts.length; start += IMPORT_CHUNK_SIZE) {
      const chunk = attempts.slice(start, start + IMPORT_CHUNK_SIZE);
      try {
        const result = await Panoptica.api('/api/intune/templates/bulk', {
          method: 'POST',
          body: JSON.stringify({ templates: chunk.map(a => a.payload) }),
        });
        // Correlate results by name (backend returns successes / errors /
        // collisions in processing order; consume greedily so duplicate names
        // still resolve sensibly).
        // Correlate by the REQUESTED name (the name we sent), not the final
        // stored name — 'new' renames the template, so they differ.
        const okNames = (result.templates || []).map(x => x.requested_name || x.name);
        const errs = (result.errors || []).slice();
        const cols = (result.collisions || []).slice();
        for (const a of chunk) {
          const okPos = okNames.indexOf(a.name);
          if (okPos !== -1) { okNames.splice(okPos, 1); importStatus[a.index] = { state: 'ok' }; continue; }
          const cPos = cols.findIndex(c => c.name === a.name);
          if (cPos !== -1) {
            const c = cols.splice(cPos, 1)[0];
            importStatus[a.index] = { state: 'collision', existing_id: c.existing_id, deployed_count: c.deployed_count, payload: a.payload };
            continue;
          }
          const ePos = errs.findIndex(e => (e.name || 'unknown') === a.name);
          const e = ePos !== -1 ? errs.splice(ePos, 1)[0] : null;
          importStatus[a.index] = { state: 'failed', reason: (e && e.reason) || 'generic', error: e && e.error };
        }
      } catch (err) {
        // Whole-chunk failure — attribute to every policy in it.
        console.warn('[Intune:Import] Chunk failed:', err && err.message);
        const reason = classifyChunkError(err);
        for (const a of chunk) importStatus[a.index] = { state: 'failed', reason, error: err && err.message };
      }
      done += chunk.length;
      setImportStatus(window.t('intune_templates.import_progress', { done, total }), 'info');
    }
  }

  // After an import pass: resolve name collisions FIRST (operator decision), then
  // surface failures for retry, else close on full success.
  function finishImport() {
    const collisions = Object.keys(importStatus)
      .filter(i => importStatus[i].state === 'collision')
      .map(i => Object.assign({ index: Number(i) }, importStatus[i]));
    const okCount = Object.values(importStatus).filter(s => s.state === 'ok').length;
    const failCount = Object.values(importStatus).filter(s => s.state === 'failed').length;

    if (collisions.length > 0) {
      importMode = 'collisions';
      renderImportCollisions(collisions);
      return;
    }
    if (failCount === 0) {
      Panoptica.showToast(window.t('intune_templates.toast_imported', { imported: okCount }), 'success');
      hideImportModal();
      return;
    }
    // Partial failure: keep the modal open, re-offer the failed rows for retry.
    importMode = 'results';
    Panoptica.showToast(window.t('intune_templates.toast_imported_with_failures', { imported: okCount, failed: failCount }), 'warning');
    setImportStatus(window.t('intune_templates.import_results_summary', { imported: okCount, failed: failCount }), 'warning');
    renderImportList();
    updateImportCount();
  }

  // Collision-resolution step: one row per name clash with a New-copy / Overwrite
  // choice. Overwrite on a DEPLOYED template shows the blast-radius warning.
  function renderImportCollisions(collisions) {
    const list = document.getElementById('intune-import-list');
    setImportStatus(window.t('intune_templates.import_collisions_summary', { count: collisions.length }), 'warning');
    list.innerHTML = collisions.map(c => {
      const name = c.payload.name;
      const warn = c.deployed_count > 0
        ? `<div style="color:#f85149; font-size:0.75rem; margin-top:2px;">⚠ ${esc(window.t('intune_templates.import_collision_deployed_warn', { count: c.deployed_count }))}</div>`
        : '';
      const opt = (v, label) => `<option value="${v}">${esc(label)}</option>`;
      return `
        <div class="intune-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle);">
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            <div style="color:var(--p-text-muted); font-size:0.75rem;">${esc(window.t('intune_templates.import_reason_duplicate_name'))}</div>
            ${warn}
          </div>
          <select class="intune-collision-choice form-control" data-index="${c.index}" style="width:auto; min-width:170px; font-size:0.78rem; padding:4px 8px;">
            ${opt('new', window.t('intune_templates.import_collision_new'))}${opt('overwrite', window.t('intune_templates.import_collision_overwrite'))}
          </select>
        </div>`;
    }).join('');
    const btn = document.getElementById('intune-import-submit-btn');
    btn.textContent = window.t('intune_templates.import_collision_apply', { count: collisions.length });
    btn.disabled = false;
  }

  // Re-submit just the collisions, each with its chosen on_collision directive.
  async function applyCollisionChoices() {
    const attempts = [];
    document.querySelectorAll('.intune-collision-choice').forEach(sel => {
      const idx = parseInt(sel.dataset.index, 10);
      const st = importStatus[idx];
      if (!st || st.state !== 'collision') return;
      const choice = sel.value === 'overwrite' ? 'overwrite' : 'new';
      attempts.push({ index: idx, name: st.payload.name, payload: Object.assign({}, st.payload, { on_collision: choice }) });
    });
    if (attempts.length === 0) return;
    document.getElementById('intune-import-submit-btn').disabled = true;
    await importChunks(attempts);
    await loadTemplates();
    finishImport();
  }

  // Classify a whole-chunk request failure (the request never reached the
  // per-item loop) into a reason code shared with importReasonText().
  function classifyChunkError(err) {
    const m = String((err && err.message) || '').toLowerCase();
    if (/413|too large|payload|entity too large/.test(m)) return 'too_large';
    return 'request_failed';
  }

  // ═══════════════════════════════════════════
  // DETAIL VIEW — with Save and collapsible JSON
  // ═══════════════════════════════════════════

  async function showDetail(id) {
    currentTemplateId = id;

    try {
      const t = await Panoptica.api(`/api/intune/templates/${id}`);
      document.getElementById('intune-detail-title').textContent = t.name;

      const pj = typeof t.policy_json === 'object' ? t.policy_json : JSON.parse(t.policy_json || '{}');
      const jsonPreview = JSON.stringify(pj, null, 2);

      document.getElementById('intune-detail-body').innerHTML = `
        <div style="display:grid; grid-template-columns:120px 1fr; gap:8px 16px; margin-bottom:16px;">
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_name'))}</span>
          <input type="text" id="intune-detail-name" class="form-control" data-role-readonly="admin" value="${escAttr(t.name)}" style="font-size:0.9rem;">
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_description'))}</span>
          <input type="text" id="intune-detail-desc" class="form-control" data-role-readonly="admin" value="${escAttr(t.description || '')}" placeholder="${escAttr(window.t('intune_templates.detail_placeholder_desc'))}" style="font-size:0.9rem;">
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_category'))}</span>
          <span style="color:var(--p-text-bright);">${esc(categoryLabel(t.category))}</span>
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_policy_type'))}</span>
          <span style="color:var(--p-text-bright);">${esc(policyTypeLabel(t.policy_type))}</span>
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_platform'))}</span>
          <span style="color:var(--p-text-bright);">${esc(t.platform || window.t('intune_templates.detail_platform_na'))}</span>
          ${t.template_family ? `
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_family'))}</span>
          <span style="color:var(--p-text-bright);">${esc(categoryLabel(t.template_family))}</span>` : ''}
          ${t.source_tenant ? `
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_source'))}</span>
          <span style="color:var(--p-text-bright);">${esc(t.source_tenant)}</span>` : ''}
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_tags'))}</span>
          <input type="text" id="intune-detail-tags" class="form-control" data-role-readonly="admin" value="${escAttr(t.tags || '')}" placeholder="${escAttr(window.t('intune_templates.detail_placeholder_tags'))}" style="font-size:0.9rem;">
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_assignment'))}</span>
          <select id="intune-detail-assign" class="form-control" data-role-readonly="admin" style="font-size:0.9rem; width:auto;">
            <option value="none"${(t.assignment_target || 'none') === 'none' ? ' selected' : ''}>${esc(window.t('intune_templates.assign_none'))}</option>
            <option value="all_users"${t.assignment_target === 'all_users' ? ' selected' : ''}>${esc(window.t('intune_templates.assign_all_users'))}</option>
            <option value="all_devices"${t.assignment_target === 'all_devices' ? ' selected' : ''}>${esc(window.t('intune_templates.assign_all_devices'))}</option>
          </select>
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_alerts'))}</span>
          <select id="intune-detail-alert-routing" class="form-control" data-role-readonly="admin" style="font-size:0.9rem; width:auto;">
            <option value="both"${(t.alert_routing || 'both') === 'both' ? ' selected' : ''}>${esc(window.t('intune_templates.alert_email_and_psa'))}</option>
            <option value="support"${t.alert_routing === 'support' ? ' selected' : ''}>${esc(window.t('intune_templates.alert_psa_only'))}</option>
            <option value="personal"${t.alert_routing === 'personal' ? ' selected' : ''}>${esc(window.t('intune_templates.alert_email_only'))}</option>
            <option value="none"${t.alert_routing === 'none' ? ' selected' : ''}>${esc(window.t('intune_templates.alert_none'))}</option>
          </select>
          <span style="color:var(--p-text-muted);">${esc(window.t('intune_templates.detail_label_imported'))}</span>
          <span style="color:var(--p-text-bright);">${formatDate(t.created_at)}</span>
        </div>
        <details class="intune-json-toggle">
          <summary style="color:var(--p-text-muted); font-size:0.85rem; cursor:pointer; user-select:none; padding:6px 0;">
            ${esc(window.t('intune_templates.detail_policy_json'))} <span style="font-size:0.75rem; color:var(--p-secondary-muted);">${esc(window.t('intune_templates.detail_click_to_expand'))}</span>
          </summary>
          <pre style="background:var(--p-surface-sunken); color:var(--p-text-bright); border:1px solid var(--p-border-subtle); border-radius:4px; padding:12px; font-size:0.7rem; max-height:20vh; overflow:auto; white-space:pre-wrap; word-break:break-all; margin-top:8px;">${esc(jsonPreview)}</pre>
        </details>
      `;

      document.getElementById('intune-detail-overlay').style.display = 'flex';

    } catch (err) {
      Panoptica.showToast(window.t('intune_templates.toast_load_template_failed', { message: err.message }), 'error');
    }
  }

  function hideDetailModal() {
    document.getElementById('intune-detail-overlay').style.display = 'none';
    currentTemplateId = null;
  }

  /**
   * Save editable fields (name, description, tags), then close.
   */
  async function saveTemplate() {
    if (!currentTemplateId) return;

    const name = document.getElementById('intune-detail-name')?.value?.trim();
    const description = document.getElementById('intune-detail-desc')?.value?.trim();
    const tags = document.getElementById('intune-detail-tags')?.value?.trim();
    const assignment_target = document.getElementById('intune-detail-assign')?.value || 'none';
    const alert_routing = document.getElementById('intune-detail-alert-routing')?.value || 'both';

    if (!name) {
      Panoptica.showToast(window.t('intune_templates.toast_name_empty'), 'warning');
      return;
    }

    try {
      await Panoptica.api(`/api/intune/templates/${currentTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description, tags, assignment_target, alert_routing }),
      });
      Panoptica.showToast(window.t('intune_templates.toast_template_saved'), 'success');
      hideDetailModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('intune_templates.toast_save_failed', { message: err.message }), 'error');
    }
  }

  /**
   * Close detail modal — check for unsaved changes, prompt if needed.
   */
  async function closeDetail() {
    if (currentTemplateId) {
      const nameEl = document.getElementById('intune-detail-name');
      const descEl = document.getElementById('intune-detail-desc');
      const tagsEl = document.getElementById('intune-detail-tags');

      // Check if any editable field has been modified
      const t = templates.find(t => t.id === currentTemplateId);
      if (t && nameEl && descEl && tagsEl) {
        const nameChanged = nameEl.value.trim() !== (t.name || '');
        const descChanged = descEl.value.trim() !== (t.description || '');
        const tagsChanged = tagsEl.value.trim() !== (t.tags || '');

        if (nameChanged || descChanged || tagsChanged) {
          if (await Panoptica.confirmModal(window.t('intune_templates.confirm_unsaved_changes'))) {
            await saveTemplate();
            return;
          }
        }
      }
    }
    hideDetailModal();
  }

  async function deleteTemplate() {
    if (!currentTemplateId) return;
    if (!(await Panoptica.confirmModal(window.t('intune_templates.confirm_delete'), { danger: true }))) return;

    try {
      await Panoptica.api(`/api/intune/templates/${currentTemplateId}`, { method: 'DELETE' });
      Panoptica.showToast(window.t('intune_templates.toast_template_deleted'), 'success');
      hideDetailModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('intune_templates.toast_delete_failed', { message: err.message }), 'error');
    }
  }

  // ═══════════════════════════════════════════
  // DEPLOY FLOW
  // ═══════════════════════════════════════════

  function showDeployFromDetail() {
    if (!currentTemplateId) return;
    const t = templates.find(t => t.id === currentTemplateId);
    if (!t) return;
    hideDetailModal();
    showDeployModal(t);
  }

  function showDeployModal(template) {
    currentTemplateId = template.id;
    document.getElementById('intune-deploy-template-name').textContent = template.name;
    populateTenantSelect('intune-deploy-tenant');
    // Pre-populate assignment dropdown with template default
    const assignEl = document.getElementById('intune-deploy-assign');
    if (assignEl) assignEl.value = template.assignment_target || 'none';
    document.getElementById('intune-deploy-progress').style.display = 'none';
    document.getElementById('intune-deploy-start-btn').disabled = false;
    document.getElementById('intune-deploy-overlay').style.display = 'flex';
  }

  function hideDeployModal() {
    document.getElementById('intune-deploy-overlay').style.display = 'none';
  }

  async function startDeploy() {
    const tenantId = document.getElementById('intune-deploy-tenant').value;
    if (!tenantId) { Panoptica.showToast(window.t('intune_templates.toast_select_target_tenant'), 'warning'); return; }

    const btn = document.getElementById('intune-deploy-start-btn');
    const progressDiv = document.getElementById('intune-deploy-progress');
    const indicator = document.getElementById('intune-deploy-indicator');
    const statusEl = document.getElementById('intune-deploy-status');

    btn.disabled = true;
    progressDiv.style.display = 'block';
    indicator.className = 'stage-indicator active';
    statusEl.textContent = 'Deploying policy to tenant...';

    try {
      const assignEl = document.getElementById('intune-deploy-assign');
      const assignTarget = assignEl ? assignEl.value : 'none';
      const result = await Panoptica.api('/api/intune/deploy', {
        method: 'POST',
        body: JSON.stringify({ templateId: currentTemplateId, tenantId: parseInt(tenantId, 10), assignment_target: assignTarget }),
      });

      // Three outcomes: clean success (2xx, success=true, no warnings),
      // partial success (207, success=false, warnings[]), or error (caught below).
      // We don't collapse warnings into "deploy failed" — the policy may still
      // be tracked and drift-monitored even when assignment failed.
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      if (result.success && warnings.length === 0) {
        indicator.className = 'stage-indicator completed';
        statusEl.textContent = result.message;
        Panoptica.showToast(result.message, 'success');
        setTimeout(hideDeployModal, 2500);
      } else if (warnings.length > 0) {
        indicator.className = 'stage-indicator error';
        statusEl.textContent = result.message || ('Deployed with issues: ' + warnings.join('; '));
        Panoptica.showToast(window.t('intune_templates.toast_deployed_with_issues'), 'warning');
        btn.disabled = false;
      } else {
        indicator.className = 'stage-indicator error';
        statusEl.textContent = 'Deploy failed: ' + (result.error || result.message || 'Unknown error');
        btn.disabled = false;
      }
    } catch (err) {
      indicator.className = 'stage-indicator error';
      statusEl.textContent = 'Deploy failed: ' + err.message;
      btn.disabled = false;
      Panoptica.showToast(window.t('intune_templates.toast_deploy_failed', { message: err.message }), 'error');
    }
  }

  // ═══════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(str) {
    return esc(str).replace(/'/g, '&#39;');
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.substring(0, max) + '...';
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  window.PanopticaPage = { init, destroy };
})();
