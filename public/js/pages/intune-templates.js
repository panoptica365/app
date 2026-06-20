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
    const list = document.getElementById('intune-import-list');
    const countEl = document.getElementById('intune-import-count');

    countEl.textContent = policies.length;
    preview.style.display = 'block';

    list.innerHTML = policies.map((p, i) => {
      const name = p.name || p.displayName || p.policy?.name || p.policy?.displayName || 'Unnamed Policy';
      const type = p.policyType || 'unknown';
      const cat = p.category || '';
      return `
        <label class="intune-import-item" style="display:flex; gap:10px; align-items:center; padding:8px 4px; border-bottom:1px solid var(--p-border-subtle); cursor:pointer;">
          <input type="checkbox" class="intune-import-check" data-index="${i}" checked style="margin-top:0;">
          <div style="flex:1; min-width:0;">
            <div style="color:var(--p-text-bright); font-size:0.9rem;">${esc(name)}</div>
            <div style="color:var(--p-text-muted); font-size:0.75rem;">
              ${esc(policyTypeLabel(type))}${cat ? ' — ' + esc(categoryLabel(cat)) : ''}
            </div>
          </div>
          <select class="intune-import-assign form-control" data-index="${i}" style="width:auto; min-width:110px; font-size:0.75rem; padding:3px 6px;">
            <option value="none">None</option>
            <option value="all_users">All Users</option>
            <option value="all_devices">All Devices</option>
          </select>
        </label>`;
    }).join('');

    // Wire default assignment dropdown to set all per-policy dropdowns
    const defaultAssignEl = document.getElementById('intune-import-default-assign');
    if (defaultAssignEl) {
      defaultAssignEl.onchange = () => {
        list.querySelectorAll('.intune-import-assign').forEach(sel => { sel.value = defaultAssignEl.value; });
      };
    }

    document.getElementById('intune-import-submit-btn').disabled = false;
    list.addEventListener('change', updateImportCount);
    updateImportCount();
  }

  function updateImportCount() {
    const checked = document.querySelectorAll('.intune-import-check:checked').length;
    const btn = document.getElementById('intune-import-submit-btn');
    btn.textContent = `Import Selected (${checked})`;
    btn.disabled = checked === 0;
  }

  function toggleAllImports(state) {
    document.querySelectorAll('.intune-import-check').forEach(cb => { cb.checked = state; });
    updateImportCount();
  }

  async function submitImport() {
    if (!importData) return;

    const checkboxes = document.querySelectorAll('.intune-import-check:checked');
    const selectedIndices = [...checkboxes].map(cb => parseInt(cb.dataset.index, 10));
    if (selectedIndices.length === 0) { Panoptica.showToast(window.t('intune_templates.toast_no_policies_selected'), 'warning'); return; }

    const btn = document.getElementById('intune-import-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Importing...';

    const templatesToImport = selectedIndices.map(i => {
      const p = importData.policies[i];
      const name = p.name || p.displayName || p.policy?.name || p.policy?.displayName || 'Unnamed Policy';
      let policyJson = p.policy || p;
      if (p.settings && Array.isArray(p.settings)) policyJson = { ...policyJson, settings: p.settings };
      if (p.definitionValues && Array.isArray(p.definitionValues)) policyJson = { ...policyJson, definitionValues: p.definitionValues };

      // Get per-policy assignment target from dropdown
      const assignSel = document.querySelector(`.intune-import-assign[data-index="${i}"]`);
      const assignTarget = assignSel ? assignSel.value : 'none';

      return {
        name,
        description: p.description || p.policy?.description || '',
        category: p.category || p.templateFamily || 'other',
        policy_type: p.policyType || 'configurationPolicies',
        platform: p.policy?.platforms || 'windows10',
        template_family: p.templateFamily || p.policy?.templateReference?.templateFamily || null,
        policy_json: policyJson,
        source_tenant: importData.sourceTenant || null,
        assignment_target: assignTarget,
      };
    });

    try {
      const result = await Panoptica.api('/api/intune/templates/bulk', {
        method: 'POST',
        body: JSON.stringify({ templates: templatesToImport }),
      });
      Panoptica.showToast(
        result.failed > 0
          ? window.t('intune_templates.toast_imported_with_failures', { imported: result.imported, failed: result.failed })
          : window.t('intune_templates.toast_imported', { imported: result.imported }),
        result.failed > 0 ? 'warning' : 'success'
      );
      hideImportModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('intune_templates.toast_import_failed', { message: err.message }), 'error');
      btn.disabled = false;
      btn.textContent = window.t('intune_templates.btn_import_selected_count', { count: selectedIndices.length });
    }
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
