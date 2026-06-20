/**
 * Panoptica — CA Templates Page Script
 * Global template library management.
 */
(function () {
  'use strict';

  let templates = [];
  let tenantsForPicker = [];
  let currentTemplateId = null;

  // GUID shape — used by scanForLocationGUIDs() to decide whether the pasted
  // policy JSON references any raw named-location IDs. Sentinels like 'All',
  // 'AllTrusted', 'None' are not GUIDs and won't match, which is what we want.
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    document.getElementById('ca-import-submit-btn').addEventListener('click', importTemplate);
    document.getElementById('ca-export-btn').addEventListener('click', showExportModal);
    document.getElementById('ca-export-cancel-btn').addEventListener('click', hideExportModal);
    document.getElementById('ca-export-start-btn').addEventListener('click', startExport);
    document.getElementById('ca-detail-close-btn').addEventListener('click', hideDetailModal);
    document.getElementById('ca-detail-delete-btn').addEventListener('click', deleteTemplate);
    document.getElementById('ca-detail-save-btn').addEventListener('click', saveTemplate);

    // Wire live scanning on the JSON textarea — any change revisits whether
    // a source tenant needs to be picked. Use 'input' (covers paste + type)
    // rather than 'paste' specifically, so pasted-then-edited JSON still
    // re-triggers the scan.
    const jsonEl = document.getElementById('ca-import-json');
    if (jsonEl) {
      jsonEl.addEventListener('input', onJsonChanged);
    }

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
    document.getElementById('ca-import-name').value = '';
    document.getElementById('ca-import-desc').value = '';
    document.getElementById('ca-import-json').value = '';
    // Reset checkboxes to defaults
    document.querySelectorAll('#ca-field-checkboxes input').forEach(cb => {
      cb.checked = ['state', 'grantControls.builtInControls', 'conditions.users.includeUsers',
        'conditions.users.includeGroups', 'conditions.applications.includeApplications'].includes(cb.value);
    });
    // Reset source-tenant container to hidden + no selection. The scan fires
    // again as soon as the user pastes JSON, so we only need to start clean.
    const srcContainer = document.getElementById('ca-import-source-container');
    const srcSelect = document.getElementById('ca-import-source-tenant');
    if (srcContainer) srcContainer.style.display = 'none';
    if (srcSelect) srcSelect.value = '';

    // Lazy-load tenant list on first open — fine to refresh every time, the
    // list is small and the endpoint is fast. Keeps the dropdown in sync if
    // a tenant was added/removed since the page loaded.
    try {
      await ensureTenantsForPicker();
    } catch (e) {
      console.warn('[CA Templates] Failed to load tenant list for source-tenant picker:', e.message);
      // Non-fatal — user can still import, they just won't see the picker.
      // If they paste a policy with location GUIDs the scan will reveal the
      // picker with an empty list, at which point they can retry.
    }

    document.getElementById('ca-import-overlay').style.display = 'flex';
  }

  function hideImportModal() {
    document.getElementById('ca-import-overlay').style.display = 'none';
  }

  async function ensureTenantsForPicker() {
    const list = await Panoptica.api('/api/tenants');
    tenantsForPicker = Array.isArray(list) ? list : [];
    const srcSelect = document.getElementById('ca-import-source-tenant');
    if (!srcSelect) return;
    const opts = ['<option value="">Select source tenant…</option>'];
    for (const t of tenantsForPicker) {
      opts.push(`<option value="${t.id}">${esc(t.display_name || t.tenant_id)}</option>`);
    }
    srcSelect.innerHTML = opts.join('');
  }

  /**
   * Scan the pasted JSON for named-location GUIDs. If any are found, reveal
   * the source-tenant picker. If none, hide it. Cheap enough to run on every
   * keystroke.
   */
  function onJsonChanged() {
    const jsonStr = document.getElementById('ca-import-json').value || '';
    const hasLocationGUIDs = scanForLocationGUIDs(jsonStr);
    const container = document.getElementById('ca-import-source-container');
    if (!container) return;
    container.style.display = hasLocationGUIDs ? '' : 'none';
  }

  function scanForLocationGUIDs(jsonStr) {
    if (!jsonStr || jsonStr.trim().length === 0) return false;
    let policy;
    try {
      policy = JSON.parse(jsonStr);
    } catch (e) {
      return false; // Invalid JSON — let the Import button handle that.
    }
    const locs = policy && policy.conditions && policy.conditions.locations;
    if (!locs) return false;
    for (const arr of [locs.includeLocations, locs.excludeLocations]) {
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        if (typeof v === 'string' && GUID_RE.test(v)) return true;
      }
    }
    return false;
  }

  async function importTemplate() {
    const name = document.getElementById('ca-import-name').value.trim();
    const description = document.getElementById('ca-import-desc').value.trim();
    const jsonStr = document.getElementById('ca-import-json').value.trim();

    if (!name) return Panoptica.showToast(window.t('ca_templates.toast_template_name_required'), 'error');
    if (!jsonStr) return Panoptica.showToast(window.t('ca_templates.toast_policy_json_required'), 'error');

    let policy_json;
    try {
      policy_json = JSON.parse(jsonStr);
    } catch (e) {
      return Panoptica.showToast(window.t('ca_templates.toast_invalid_json', { message: e.message }), 'error');
    }

    // Gather monitored fields
    const monitored_fields = [];
    document.querySelectorAll('#ca-field-checkboxes input:checked').forEach(cb => {
      monitored_fields.push(cb.value);
    });

    // Source-tenant handling: if the (live) picker is visible it means the
    // scan detected location GUIDs — a source tenant is required. If it's
    // hidden the picker value is ignored server-side.
    const srcContainer = document.getElementById('ca-import-source-container');
    const srcSelect = document.getElementById('ca-import-source-tenant');
    const sourceVisible = srcContainer && srcContainer.style.display !== 'none';
    const sourceValue = srcSelect ? srcSelect.value : '';
    if (sourceVisible && !sourceValue) {
      return Panoptica.showToast(window.t('ca_templates.toast_source_tenant_required'), 'error');
    }

    // Auto-fill name from policy displayName if user left it as-is
    const finalName = name || policy_json.displayName || 'Unnamed Template';

    const body = { name: finalName, description, policy_json, monitored_fields };
    if (sourceValue) body.source_tenant_id = parseInt(sourceValue, 10);

    try {
      const resp = await Panoptica.api('/api/ca/templates', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      // Success path. New response shape is { template, substitution }.
      // Fall back to treating resp as the template for forward-compatibility
      // in case the API layer ever reverts shape.
      const substitution = (resp && resp.substitution) || null;
      if (substitution && substitution.substitutedCount > 0) {
        Panoptica.showToast(window.t('ca_templates.toast_template_imported_with_subs', { count: substitution.substitutedCount }), 'success');
      } else {
        Panoptica.showToast(window.t('ca_templates.toast_template_imported'), 'success');
      }

      // Secondary non-blocking warning for IP-based (or otherwise unresolved)
      // location references that stayed raw in the stored JSON.
      if (substitution && Array.isArray(substitution.skipped) && substitution.skipped.length > 0) {
        const ipCount = substitution.skipped.filter(s => s.type === 'ip').length;
        const unresolvedCount = substitution.skipped.filter(s => s.type === 'unresolved').length;
        const otherCount = substitution.skipped.length - ipCount - unresolvedCount;
        const parts = [];
        if (ipCount > 0) parts.push(window.t('ca_templates.skipped_ip_based', { count: ipCount }));
        if (unresolvedCount > 0) parts.push(window.t('ca_templates.skipped_unresolved', { count: unresolvedCount }));
        if (otherCount > 0) parts.push(window.t('ca_templates.skipped_other', { count: otherCount }));
        setTimeout(() => {
          Panoptica.showToast(
            window.t('ca_templates.toast_heads_up', { parts: parts.join(', ') }),
            'warning'
          );
        }, 150); // Slight delay so the success toast lands first.
      }

      hideImportModal();
      await loadTemplates();
    } catch (err) {
      Panoptica.showToast(window.t('ca_templates.toast_import_failed', { message: err.message }), 'error');
    }
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
    importTemplate,
    showDetail,
    hideDetailModal,
    deleteTemplate,
  };
})();
