/**
 * Panoptica365 — Deployment page (Tenant Groups & Configuration Bundles)
 *
 * Phase 1: left pane = tenant-group CRUD (manual + dynamic), right pane =
 * bundle placeholder (Phase 2). Group membership counts come from the
 * server-side resolver (GET /api/org/groups → member_count) — never
 * computed client-side.
 *
 * RBAC: viewers see the list read-only (mutating buttons carry
 * data-role-required="member" and the API enforces the same server-side).
 *
 * SPA lifecycle: window.PanopticaPage = { init, destroy }. Handlers are
 * wired with addEventListener inside init(), per the app.js loader contract.
 */
(function () {
  'use strict';

  let groups = [];
  let tenants = null;      // lazy — loaded when the modal first opens
  let serviceTiers = null; // lazy
  let salesReps = null;    // lazy
  let previewSeq = 0;      // guards out-of-order preview responses

  function dT(key, params) { return window.t('deployment.' + key, params); }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Panoptica.api throws Error(err.error) — map the API's machine codes to
  // operator-readable, localized messages instead of leaking codes.
  function errMessage(err) {
    const code = (err && err.message) || '';
    const known = {
      duplicate_name: 'error_duplicate_name',
      invalid_name: 'error_invalid_name',
      empty_rule: 'error_empty_rule',
      invalid_member_ids: 'error_members',
      unknown_tenant: 'error_members',
      duplicate_item: 'error_duplicate_item',
      unknown_template: 'error_unknown_template',
      assignment_target_required: 'picker_target_required',
      not_found: 'error_not_found',
      invalid_id: 'error_not_found',
      invalid_alert_routing: 'error_invalid_option',
      invalid_ca_state: 'error_invalid_option',
      invalid_assignment_target: 'error_invalid_option',
      invalid_rule: 'error_invalid_option',
      invalid_rule_match: 'error_invalid_option',
      unknown_service_tier: 'error_invalid_option',
      unknown_sales_rep: 'error_invalid_option',
      invalid_description: 'error_invalid_option',
      no_fields: 'error_generic',
      not_armed: 'error_not_armed',
      not_cancellable: 'error_not_cancellable',
      empty_bundle: 'error_empty_bundle',
      empty_targets: 'error_empty_targets',
      unknown_bundle: 'error_not_found',
      unknown_group: 'error_not_found',
      invalid_bundle_id: 'error_invalid_option',
      invalid_target_ids: 'error_invalid_option',
      invalid_target_kind: 'error_invalid_option',
      deploy_in_progress: 'error_deploy_in_progress',
    };
    return known[code] ? dT(known[code]) : code || dT('error_generic');
  }

  // ── Bundle state (Phase 2 — authoring only, no deploy path) ──
  let bundles = [];
  let currentBundle = null;   // detail object when the editor is open, else null
  let caTemplates = null;     // lazy — loaded when a picker first opens
  let intuneTemplates = null; // lazy

  // ── Job Queue state (Phase 3) ──
  let currentTab = 'overview';
  let queueJobs = [];
  const jobDetails = new Map();     // jobId → detail (fetched when expanded)
  const expandedJobs = new Set();
  const expandedTenants = new Set(); // `${jobId}:${tenantId}`
  let queuePollTimer = null;

  async function init(params) {
    document.getElementById('dep-add-group')?.addEventListener('click', () => openGroupModal(null));
    document.getElementById('dep-add-bundle')?.addEventListener('click', () => openBundleMetaModal(null));
    document.getElementById('dep-deploy-btn')?.addEventListener('click', openDeployModal);
    document.querySelectorAll('.dep-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.depTab));
    });
    await Promise.all([loadGroups(), loadBundles()]);
    if (params && params.tab === 'queue') switchTab('queue');
  }

  function destroy() {
    stopQueuePoll();
    groups = [];
    tenants = null;
    serviceTiers = null;
    salesReps = null;
    bundles = [];
    currentBundle = null;
    caTemplates = null;
    intuneTemplates = null;
    queueJobs = [];
    jobDetails.clear();
    expandedJobs.clear();
    expandedTenants.clear();
    currentTab = 'overview';
  }

  function switchTab(tab) {
    currentTab = tab === 'queue' ? 'queue' : 'overview';
    document.querySelectorAll('.dep-tab').forEach(b => b.classList.toggle('active', b.dataset.depTab === currentTab));
    const ov = document.getElementById('dep-tab-overview');
    const qu = document.getElementById('dep-tab-queue');
    if (ov) ov.style.display = currentTab === 'overview' ? '' : 'none';
    if (qu) qu.style.display = currentTab === 'queue' ? '' : 'none';
    if (currentTab === 'queue') {
      refreshQueue();
      startQueuePoll();
    } else {
      stopQueuePoll();
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Group list
  // ────────────────────────────────────────────────────────────────

  async function loadGroups() {
    const listEl = document.getElementById('dep-groups-list');
    if (!listEl) return;
    try {
      groups = await Panoptica.api('/api/org/groups');
      renderGroups();
    } catch (err) {
      listEl.innerHTML = `<div class="dep-error">${escHtml(dT('groups_load_failed', { message: err.message }))}</div>`;
    }
  }

  function renderGroups() {
    const listEl = document.getElementById('dep-groups-list');
    if (!listEl) return;
    if (!groups.length) {
      listEl.innerHTML = `<div class="dep-empty">${escHtml(dT('groups_empty'))}</div>`;
      return;
    }
    listEl.innerHTML = groups.map(g => {
      const typeLabel = g.group_type === 'dynamic' ? dT('type_dynamic') : dT('type_manual');
      const ruleDesc = g.group_type === 'dynamic' ? dynamicRuleLabel(g) : (g.description || '');
      return `<div class="dep-group-row">
        <div class="dep-group-main">
          <div class="dep-group-name">${escHtml(g.name)} <span class="dep-type-pill ${g.group_type === 'dynamic' ? 'dynamic' : ''}">${escHtml(typeLabel)}</span></div>
          ${ruleDesc ? `<div class="dep-group-desc">${escHtml(ruleDesc)}</div>` : ''}
        </div>
        <span class="dep-badge" title="${escHtml(dT('badge_tooltip', { count: g.member_count }))}">${Number(g.member_count) || 0}</span>
        <div class="dep-row-actions">
          <button class="btn-secondary" data-dep-act="edit" data-id="${g.id}" data-role-required="member">${escHtml(dT('edit_btn'))}</button>
          <button class="btn-danger" data-dep-act="delete" data-id="${g.id}" data-role-required="member">${escHtml(dT('delete_btn'))}</button>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-dep-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        if (btn.dataset.depAct === 'edit') openGroupModal(id);
        else deleteGroup(id);
      });
    });
  }

  // Human-readable dynamic-rule summary, e.g. "Tier: Silver AND Rep: Marie".
  function dynamicRuleLabel(g) {
    const parts = [];
    if (g.rule_service_tier_name) parts.push(dT('rule_tier_part', { name: g.rule_service_tier_name }));
    if (g.rule_sales_rep_name) parts.push(dT('rule_rep_part', { name: g.rule_sales_rep_name }));
    const joiner = g.rule_match === 'any' ? ` ${dT('rule_or')} ` : ` ${dT('rule_and')} `;
    return parts.join(joiner);
  }

  async function deleteGroup(id) {
    const g = groups.find(x => x.id === id);
    if (!g) return;
    const proceed = await Panoptica.confirmModal(dT('confirm_delete', { name: g.name }), { danger: true });
    if (!proceed) return;
    try {
      await Panoptica.api(`/api/org/groups/${id}`, { method: 'DELETE' });
      Panoptica.showToast(dT('toast_deleted', { name: g.name }), 'success');
      await loadGroups();
    } catch (err) {
      Panoptica.showToast(dT('toast_delete_failed', { message: errMessage(err) }), 'error');
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Add / Edit modal
  // ────────────────────────────────────────────────────────────────

  async function ensureModalData() {
    const jobs = [];
    if (!tenants) jobs.push(Panoptica.api('/api/tenants').then(r => { tenants = Array.isArray(r) ? r : []; }));
    if (!serviceTiers) jobs.push(Panoptica.api('/api/org/service-tiers').then(r => { serviceTiers = Array.isArray(r) ? r : []; }));
    if (!salesReps) jobs.push(Panoptica.api('/api/org/sales-reps').then(r => { salesReps = Array.isArray(r) ? r : []; }));
    await Promise.all(jobs);
  }

  // Dropdown options for the rule builder: active entries, plus the group's
  // current (possibly soft-deleted) selection so editing never drops it.
  function ruleOptions(list, currentId) {
    const cur = currentId == null ? null : Number(currentId);
    let html = `<option value=""${cur === null ? ' selected' : ''}>${escHtml(dT('rule_option_none'))}</option>`;
    for (const item of list) {
      if (!item.active && Number(item.id) !== cur) continue;
      const label = item.active ? item.name : dT('rule_option_inactive', { name: item.name });
      html += `<option value="${Number(item.id)}"${Number(item.id) === cur ? ' selected' : ''}>${escHtml(label)}</option>`;
    }
    return html;
  }

  async function openGroupModal(groupId) {
    let detail = null;
    try {
      await ensureModalData();
      if (groupId != null) detail = await Panoptica.api(`/api/org/groups/${groupId}`);
    } catch (err) {
      Panoptica.showToast(dT('modal_load_failed', { message: err.message }), 'error');
      return;
    }

    const isEdit = detail != null;
    const memberSet = new Set(isEdit && detail.group_type === 'manual' ? detail.member_ids.map(Number) : []);
    const curType = isEdit ? detail.group_type : null; // no default on create (required choice)

    const tenantRows = tenants
      .slice()
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      .map(t => `<label><input type="checkbox" class="dep-member-cb" value="${Number(t.id)}"${memberSet.has(Number(t.id)) ? ' checked' : ''}> <span>${escHtml(t.display_name)}</span></label>`)
      .join('');

    const bodyHtml = `
      <div class="form-group">
        <label>${escHtml(dT('label_name'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('helper_name'))}</div>
        <input type="text" id="dep-group-name" maxlength="150" value="${escHtml(isEdit ? detail.name : '')}">
      </div>
      <div class="form-group">
        <label>${escHtml(dT('label_description'))}</label>
        <input type="text" id="dep-group-desc" maxlength="500" value="${escHtml(isEdit && detail.description ? detail.description : '')}">
      </div>
      <div class="form-group">
        <label>${escHtml(dT('label_type'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('helper_type'))}</div>
        <div class="mode-picker">
          <label class="mode-card" style="border:1px solid rgba(102,119,153,0.22);">
            <input type="radio" name="dep-group-type" value="manual"${curType === 'manual' ? ' checked' : ''}>
            <div class="mode-card-body">
              <div class="mode-card-title">${escHtml(dT('type_manual'))}</div>
              <div class="mode-card-desc">${escHtml(dT('type_manual_desc'))}</div>
            </div>
          </label>
          <label class="mode-card" style="border:1px solid rgba(102,119,153,0.22);">
            <input type="radio" name="dep-group-type" value="dynamic"${curType === 'dynamic' ? ' checked' : ''}>
            <div class="mode-card-body">
              <div class="mode-card-title">${escHtml(dT('type_dynamic'))}</div>
              <div class="mode-card-desc">${escHtml(dT('type_dynamic_desc'))}</div>
            </div>
          </label>
        </div>
      </div>

      <div id="dep-manual-section" style="display:${curType === 'manual' ? '' : 'none'};">
        <div class="form-group">
          <label>${escHtml(dT('label_members'))}</label>
          <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('helper_members'))}</div>
          <div class="dep-member-list">${tenantRows || `<div class="dep-empty">${escHtml(dT('no_tenants'))}</div>`}</div>
        </div>
      </div>

      <div id="dep-dynamic-section" style="display:${curType === 'dynamic' ? '' : 'none'};">
        <div class="form-row">
          <div class="form-group">
            <label>${escHtml(dT('label_rule_tier'))}</label>
            <select id="dep-rule-tier">${ruleOptions(serviceTiers, isEdit ? detail.rule_service_tier_id : null)}</select>
          </div>
          <div class="form-group">
            <label>${escHtml(dT('label_rule_rep'))}</label>
            <select id="dep-rule-rep">${ruleOptions(salesReps, isEdit ? detail.rule_sales_rep_id : null)}</select>
          </div>
        </div>
        <div class="form-group">
          <label>${escHtml(dT('label_rule_match'))}</label>
          <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('helper_rule_match'))}</div>
          <select id="dep-rule-match">
            <option value="all"${!isEdit || detail.rule_match !== 'any' ? ' selected' : ''}>${escHtml(dT('match_all'))}</option>
            <option value="any"${isEdit && detail.rule_match === 'any' ? ' selected' : ''}>${escHtml(dT('match_any'))}</option>
          </select>
        </div>
        <div class="dep-rule-preview" id="dep-rule-preview"></div>
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="dep-group-save">${escHtml(window.t('modals.save'))}</button>
    `;

    Panoptica.openModal(isEdit ? dT('modal_edit_title') : dT('modal_add_title'), bodyHtml, footerHtml);

    // Type toggle shows the matching section.
    document.querySelectorAll('input[name="dep-group-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const type = document.querySelector('input[name="dep-group-type"]:checked')?.value;
        const man = document.getElementById('dep-manual-section');
        const dyn = document.getElementById('dep-dynamic-section');
        if (man) man.style.display = type === 'manual' ? '' : 'none';
        if (dyn) dyn.style.display = type === 'dynamic' ? '' : 'none';
        if (type === 'dynamic') updateRulePreview();
      });
    });

    // Live matched-count preview for the dynamic rule.
    ['dep-rule-tier', 'dep-rule-rep', 'dep-rule-match'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', updateRulePreview);
    });
    if (curType === 'dynamic') updateRulePreview();

    document.getElementById('dep-group-save')?.addEventListener('click', () => saveGroup(groupId));
  }

  async function updateRulePreview() {
    const out = document.getElementById('dep-rule-preview');
    if (!out) return;
    const tier = document.getElementById('dep-rule-tier')?.value || '';
    const rep = document.getElementById('dep-rule-rep')?.value || '';
    const match = document.getElementById('dep-rule-match')?.value || 'all';
    if (!tier && !rep) { out.textContent = dT('preview_pick_dimension'); return; }
    const seq = ++previewSeq;
    out.textContent = dT('preview_loading');
    try {
      const r = await Panoptica.api('/api/org/groups/preview', {
        method: 'POST',
        body: JSON.stringify({
          rule_service_tier_id: tier || null,
          rule_sales_rep_id: rep || null,
          rule_match: match,
        }),
      });
      if (seq !== previewSeq) return; // a newer preview superseded this one
      out.textContent = dT('preview_matches', { count: Number(r.count) || 0 });
    } catch (err) {
      if (seq !== previewSeq) return;
      out.textContent = dT('preview_failed');
    }
  }

  async function saveGroup(groupId) {
    const name = document.getElementById('dep-group-name')?.value?.trim();
    if (!name) { Panoptica.showToast(dT('validation_name_required'), 'error'); return; }
    const type = document.querySelector('input[name="dep-group-type"]:checked')?.value;
    if (type !== 'manual' && type !== 'dynamic') { Panoptica.showToast(dT('validation_type_required'), 'error'); return; }

    const payload = {
      name,
      description: document.getElementById('dep-group-desc')?.value?.trim() || null,
      group_type: type,
    };
    if (type === 'manual') {
      payload.member_ids = Array.from(document.querySelectorAll('.dep-member-cb:checked')).map(cb => parseInt(cb.value, 10));
    } else {
      const tier = document.getElementById('dep-rule-tier')?.value || '';
      const rep = document.getElementById('dep-rule-rep')?.value || '';
      if (!tier && !rep) { Panoptica.showToast(dT('validation_rule_required'), 'error'); return; }
      payload.rule_service_tier_id = tier || null;
      payload.rule_sales_rep_id = rep || null;
      payload.rule_match = document.getElementById('dep-rule-match')?.value === 'any' ? 'any' : 'all';
    }

    const btn = document.getElementById('dep-group-save');
    if (btn) btn.setAttribute('disabled', 'disabled');
    try {
      if (groupId != null) {
        await Panoptica.api(`/api/org/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await Panoptica.api('/api/org/groups', { method: 'POST', body: JSON.stringify(payload) });
      }
      Panoptica.closeModal();
      Panoptica.showToast(dT('toast_saved', { name }), 'success');
      await loadGroups();
    } catch (err) {
      if (btn) btn.removeAttribute('disabled');
      Panoptica.showToast(dT('toast_save_failed', { message: errMessage(err) }), 'error');
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Configuration Bundles (Phase 2 — authoring only, no deploy path)
  // ════════════════════════════════════════════════════════════════

  // Label helpers — reuse the app's existing routing/assignment vocabulary.
  function routingLabel(v) {
    if (v == null || v === '') return dT('routing_inherit');
    const key = { both: 'email_psa', support: 'psa_only', personal: 'email_only', none: 'none' }[v];
    return key ? window.t('tenant_dashboard.routing.' + key) : v;
  }
  const ROUTING_VALUES = ['both', 'support', 'personal', 'none'];
  const TARGET_VALUES = ['none', 'all_users', 'all_devices'];
  function targetLabel(v) {
    const key = { none: 'assign_none', all_users: 'assign_all_users', all_devices: 'assign_all_devices' }[v];
    return key ? window.t('intune_templates.' + key) : v;
  }
  const CA_STATE_VALUES = ['report_only', 'enabled'];
  function caStateLabel(v) { return v === 'enabled' ? dT('ca_state_on') : dT('ca_state_report'); }

  async function loadBundles() {
    const body = document.getElementById('dep-bundles-body');
    if (!body) return;
    try {
      bundles = await Panoptica.api('/api/bundles');
      renderBundlesPane();
    } catch (err) {
      body.innerHTML = `<div class="dep-error">${escHtml(dT('bundles_load_failed', { message: err.message }))}</div>`;
    }
  }

  function renderBundlesPane() {
    if (currentBundle) renderBundleEditor();
    else renderBundleList();
  }

  // ── Bundle list ──
  function renderBundleList() {
    const body = document.getElementById('dep-bundles-body');
    if (!body) return;
    if (!bundles.length) {
      body.innerHTML = `<div class="dep-empty">${escHtml(dT('bundles_empty'))}</div>`;
      return;
    }
    body.innerHTML = bundles.map(b => `
      <div class="dep-group-row" data-bundle-open="${b.id}" style="cursor:pointer;">
        <div class="dep-group-main">
          <div class="dep-group-name">${escHtml(b.name)}</div>
          ${b.description ? `<div class="dep-group-desc">${escHtml(b.description)}</div>` : ''}
        </div>
        <span class="dep-count-pill">${escHtml(dT('bundle_counts', { ca: Number(b.ca_count) || 0, intune: Number(b.intune_count) || 0 }))}</span>
        <div class="dep-row-actions">
          <button class="btn-danger" data-bundle-del="${b.id}" data-role-required="member">${escHtml(dT('delete_btn'))}</button>
        </div>
      </div>`).join('');
    body.querySelectorAll('[data-bundle-open]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-bundle-del]')) return; // delete button handles itself
        openBundleEditor(parseInt(row.dataset.bundleOpen, 10));
      });
    });
    body.querySelectorAll('[data-bundle-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteBundle(parseInt(btn.dataset.bundleDel, 10)));
    });
  }

  async function openBundleEditor(id) {
    try {
      currentBundle = await Panoptica.api(`/api/bundles/${id}`);
      renderBundleEditor();
    } catch (err) {
      Panoptica.showToast(dT('bundle_open_failed', { message: errMessage(err) }), 'error');
    }
  }

  async function closeBundleEditor() {
    currentBundle = null;
    await loadBundles(); // refresh list + item counts
  }

  // ── Bundle editor ──
  function renderBundleEditor() {
    const body = document.getElementById('dep-bundles-body');
    if (!body || !currentBundle) return;
    const b = currentBundle;

    const caRows = (b.ca_items || []).map(it => `
      <div class="dep-item-row">
        <div class="dep-item-head">
          <span class="dep-item-name" title="${escHtml(it.template_name)}">${escHtml(it.template_name)}</span>
          <button class="dep-item-remove" data-bitem-remove data-kind="ca" data-tid="${Number(it.ca_template_id)}" data-role-required="member" title="${escHtml(dT('item_remove'))}">&#10005;</button>
        </div>
        <div class="dep-item-ctrls">
          <label>${escHtml(dT('item_ca_state'))}</label>
          <select data-bitem-field="ca_state" data-kind="ca" data-tid="${Number(it.ca_template_id)}" data-role-readonly="member">
            ${CA_STATE_VALUES.map(v => `<option value="${v}"${it.ca_state === v ? ' selected' : ''}>${escHtml(caStateLabel(v))}</option>`).join('')}
          </select>
          <label>${escHtml(dT('item_routing'))}</label>
          <select data-bitem-field="alert_routing" data-kind="ca" data-tid="${Number(it.ca_template_id)}" data-role-readonly="member">
            <option value=""${it.alert_routing == null ? ' selected' : ''}>${escHtml(dT('routing_inherit'))}</option>
            ${ROUTING_VALUES.map(v => `<option value="${v}"${it.alert_routing === v ? ' selected' : ''}>${escHtml(routingLabel(v))}</option>`).join('')}
          </select>
        </div>
      </div>`).join('');

    const intuneRows = (b.intune_items || []).map(it => `
      <div class="dep-item-row">
        <div class="dep-item-head">
          <span class="dep-item-name" title="${escHtml(it.template_name)}">${escHtml(it.template_name)}</span>
          <button class="dep-item-remove" data-bitem-remove data-kind="intune" data-tid="${Number(it.intune_template_id)}" data-role-required="member" title="${escHtml(dT('item_remove'))}">&#10005;</button>
        </div>
        <div class="dep-item-ctrls">
          <label>${escHtml(dT('item_target'))}</label>
          <select data-bitem-field="assignment_target" data-kind="intune" data-tid="${Number(it.intune_template_id)}" data-role-readonly="member">
            ${TARGET_VALUES.map(v => `<option value="${v}"${it.assignment_target === v ? ' selected' : ''}>${escHtml(targetLabel(v))}</option>`).join('')}
          </select>
          <label>${escHtml(dT('item_routing'))}</label>
          <select data-bitem-field="alert_routing" data-kind="intune" data-tid="${Number(it.intune_template_id)}" data-role-readonly="member">
            <option value=""${it.alert_routing == null ? ' selected' : ''}>${escHtml(dT('routing_inherit'))}</option>
            ${ROUTING_VALUES.map(v => `<option value="${v}"${it.alert_routing === v ? ' selected' : ''}>${escHtml(routingLabel(v))}</option>`).join('')}
          </select>
        </div>
      </div>`).join('');

    body.innerHTML = `
      <button class="dep-back-link" id="dep-bundle-back">&larr; ${escHtml(dT('back_to_bundles'))}</button>
      <div class="dep-bundle-title">
        <h4>${escHtml(b.name)}</h4>
        <button class="btn-secondary" id="dep-bundle-edit-meta" data-role-required="member" style="padding:3px 10px; font-size:.74rem;">${escHtml(dT('edit_btn'))}</button>
      </div>
      ${b.description ? `<div class="dep-bundle-desc">${escHtml(b.description)}</div>` : ''}

      <div class="dep-section-head">
        <h5>${escHtml(dT('section_ca', { count: (b.ca_items || []).length }))}</h5>
        <button class="btn-secondary" id="dep-add-ca-item" data-role-required="member">${escHtml(dT('add_item'))}</button>
      </div>
      ${caRows || `<div class="dep-empty">${escHtml(dT('section_ca_empty'))}</div>`}

      <div class="dep-section-head">
        <h5>${escHtml(dT('section_intune', { count: (b.intune_items || []).length }))}</h5>
        <button class="btn-secondary" id="dep-add-intune-item" data-role-required="member">${escHtml(dT('add_item'))}</button>
      </div>
      ${intuneRows || `<div class="dep-empty">${escHtml(dT('section_intune_empty'))}</div>`}
    `;

    document.getElementById('dep-bundle-back')?.addEventListener('click', closeBundleEditor);
    document.getElementById('dep-bundle-edit-meta')?.addEventListener('click', () => openBundleMetaModal(b));
    document.getElementById('dep-add-ca-item')?.addEventListener('click', () => openItemPicker('ca'));
    document.getElementById('dep-add-intune-item')?.addEventListener('click', () => openItemPicker('intune'));
    body.querySelectorAll('[data-bitem-field]').forEach(sel => {
      sel.addEventListener('change', () => onItemFieldChange(sel.dataset.kind, parseInt(sel.dataset.tid, 10), sel.dataset.bitemField, sel.value));
    });
    body.querySelectorAll('[data-bitem-remove]').forEach(btn => {
      btn.addEventListener('click', () => onItemRemove(btn.dataset.kind, parseInt(btn.dataset.tid, 10)));
    });
  }

  function itemSlug(kind) { return kind === 'ca' ? 'ca-items' : 'intune-items'; }

  async function onItemFieldChange(kind, templateId, field, value) {
    if (!currentBundle) return;
    const payload = {};
    payload[field] = field === 'alert_routing' && value === '' ? null : value;
    try {
      await Panoptica.api(`/api/bundles/${currentBundle.id}/${itemSlug(kind)}/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      // keep local state in sync so a re-render shows the saved value
      const list = kind === 'ca' ? currentBundle.ca_items : currentBundle.intune_items;
      const idKey = kind === 'ca' ? 'ca_template_id' : 'intune_template_id';
      const item = (list || []).find(x => Number(x[idKey]) === templateId);
      if (item) item[field] = payload[field];
    } catch (err) {
      Panoptica.showToast(dT('item_save_failed', { message: errMessage(err) }), 'error');
      // reload from the server so the select reverts to the stored value
      openBundleEditor(currentBundle.id);
    }
  }

  async function onItemRemove(kind, templateId) {
    if (!currentBundle) return;
    // Confirm — removal also drops the item's per-item options (state/
    // routing overrides), which re-adding does not restore.
    const list = kind === 'ca' ? currentBundle.ca_items : currentBundle.intune_items;
    const idKey = kind === 'ca' ? 'ca_template_id' : 'intune_template_id';
    const item = (list || []).find(x => Number(x[idKey]) === templateId);
    const proceed = await Panoptica.confirmModal(
      dT('confirm_remove_item', { name: item ? item.template_name : `#${templateId}` }),
      { danger: true }
    );
    if (!proceed) return;
    try {
      await Panoptica.api(`/api/bundles/${currentBundle.id}/${itemSlug(kind)}/${templateId}`, { method: 'DELETE' });
      await openBundleEditor(currentBundle.id);
    } catch (err) {
      Panoptica.showToast(dT('item_remove_failed', { message: errMessage(err) }), 'error');
    }
  }

  // ── Create / rename bundle (name + description modal) ──
  function openBundleMetaModal(bundle) {
    const isEdit = bundle != null;
    const bodyHtml = `
      <div class="form-group">
        <label>${escHtml(dT('bundle_label_name'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('bundle_helper_name'))}</div>
        <input type="text" id="dep-bundle-name" maxlength="150" value="${escHtml(isEdit ? bundle.name : '')}">
      </div>
      <div class="form-group">
        <label>${escHtml(dT('label_description'))}</label>
        <input type="text" id="dep-bundle-desc" maxlength="500" value="${escHtml(isEdit && bundle.description ? bundle.description : '')}">
      </div>`;
    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="dep-bundle-meta-save">${escHtml(window.t('modals.save'))}</button>`;
    Panoptica.openModal(isEdit ? dT('bundle_modal_edit_title') : dT('bundle_modal_add_title'), bodyHtml, footerHtml);

    document.getElementById('dep-bundle-meta-save')?.addEventListener('click', async () => {
      const name = document.getElementById('dep-bundle-name')?.value?.trim();
      if (!name) { Panoptica.showToast(dT('validation_bundle_name_required'), 'error'); return; }
      const description = document.getElementById('dep-bundle-desc')?.value?.trim() || null;
      const btn = document.getElementById('dep-bundle-meta-save');
      if (btn) btn.setAttribute('disabled', 'disabled');
      try {
        if (isEdit) {
          await Panoptica.api(`/api/bundles/${bundle.id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
          Panoptica.closeModal();
          await openBundleEditor(bundle.id);
        } else {
          const created = await Panoptica.api('/api/bundles', { method: 'POST', body: JSON.stringify({ name, description }) });
          Panoptica.closeModal();
          await openBundleEditor(created.id);
        }
        Panoptica.showToast(dT('bundle_saved', { name }), 'success');
      } catch (err) {
        if (btn) btn.removeAttribute('disabled');
        Panoptica.showToast(dT('bundle_save_failed', { message: errMessage(err) }), 'error');
      }
    });
  }

  async function deleteBundle(id) {
    const b = bundles.find(x => x.id === id);
    if (!b) return;
    const proceed = await Panoptica.confirmModal(dT('confirm_delete_bundle', { name: b.name }), { danger: true });
    if (!proceed) return;
    try {
      await Panoptica.api(`/api/bundles/${id}`, { method: 'DELETE' });
      Panoptica.showToast(dT('bundle_deleted', { name: b.name }), 'success');
      if (currentBundle && currentBundle.id === id) currentBundle = null;
      await loadBundles();
    } catch (err) {
      Panoptica.showToast(dT('bundle_delete_failed', { message: errMessage(err) }), 'error');
    }
  }

  // ── Add-items picker (CA / Intune) ──
  async function ensureTemplates(kind) {
    if (kind === 'ca') {
      if (!caTemplates) {
        const r = await Panoptica.api('/api/ca/templates');
        caTemplates = Array.isArray(r) ? r : [];
      }
      return caTemplates;
    }
    if (!intuneTemplates) {
      const r = await Panoptica.api('/api/intune/templates');
      intuneTemplates = Array.isArray(r) ? r : [];
    }
    return intuneTemplates;
  }

  async function openItemPicker(kind) {
    if (!currentBundle) return;
    let templates;
    try {
      templates = await ensureTemplates(kind);
    } catch (err) {
      Panoptica.showToast(dT('templates_load_failed', { message: err.message }), 'error');
      return;
    }
    const existing = new Set(
      kind === 'ca'
        ? (currentBundle.ca_items || []).map(x => Number(x.ca_template_id))
        : (currentBundle.intune_items || []).map(x => Number(x.intune_template_id))
    );
    const candidates = templates.filter(t => !existing.has(Number(t.id)));

    const listHtml = candidates.length
      ? candidates.map(t => `<label><input type="checkbox" class="dep-pick-cb" value="${Number(t.id)}"> <span>${escHtml(t.name)}</span></label>`).join('')
      : `<div class="dep-empty">${escHtml(dT('picker_none_left'))}</div>`;

    // Intune: assignment target is a REQUIRED choice with NO default (form
    // convention) — the placeholder option is unselectable-by-save.
    const intuneTargetHtml = kind === 'intune' ? `
      <div class="form-group">
        <label>${escHtml(dT('item_target'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('picker_target_helper'))}</div>
        <select id="dep-pick-target">
          <option value="" selected disabled>${escHtml(dT('picker_target_placeholder'))}</option>
          ${TARGET_VALUES.map(v => `<option value="${v}">${escHtml(targetLabel(v))}</option>`).join('')}
        </select>
      </div>` : '';

    const bodyHtml = `
      <div class="form-helper" style="font-size:0.8rem; color:var(--p-text-muted); margin-bottom:10px;">
        ${escHtml(kind === 'ca' ? dT('picker_ca_helper') : dT('picker_intune_helper'))}
      </div>
      ${intuneTargetHtml}
      <div class="form-group">
        <label>${escHtml(kind === 'ca' ? dT('picker_ca_label') : dT('picker_intune_label'))}</label>
        <div class="dep-member-list">${listHtml}</div>
      </div>`;
    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="dep-pick-add"${candidates.length ? '' : ' disabled'}>${escHtml(dT('picker_add_btn'))}</button>`;
    Panoptica.openModal(kind === 'ca' ? dT('picker_ca_title') : dT('picker_intune_title'), bodyHtml, footerHtml);

    document.getElementById('dep-pick-add')?.addEventListener('click', async () => {
      const ids = Array.from(document.querySelectorAll('.dep-pick-cb:checked')).map(cb => parseInt(cb.value, 10));
      if (!ids.length) { Panoptica.showToast(dT('picker_pick_something'), 'error'); return; }
      let target = null;
      if (kind === 'intune') {
        target = document.getElementById('dep-pick-target')?.value || '';
        if (!target) { Panoptica.showToast(dT('picker_target_required'), 'error'); return; }
      }
      const btn = document.getElementById('dep-pick-add');
      if (btn) btn.setAttribute('disabled', 'disabled');
      let failed = 0;
      for (const templateId of ids) {
        const payload = { template_id: templateId };
        if (kind === 'intune') payload.assignment_target = target;
        try {
          await Panoptica.api(`/api/bundles/${currentBundle.id}/${itemSlug(kind)}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (err) {
          failed++;
          console.warn('[Deployment] add bundle item failed:', templateId, err.message);
        }
      }
      Panoptica.closeModal();
      if (failed > 0) Panoptica.showToast(dT('picker_partial_failed', { failed, total: ids.length }), 'error');
      else Panoptica.showToast(dT('picker_added', { count: ids.length }), 'success');
      await openBundleEditor(currentBundle.id);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Deploy modal + Job Queue (Phase 3)
  // ════════════════════════════════════════════════════════════════

  // ── Deploy modal: target kind → multi-select targets → bundle → Submit.
  //    Submit = build + preflight only (safe); the Graph writes only start
  //    from the armed job's Deploy button in the queue. ──
  async function openDeployModal() {
    try {
      await ensureModalData(); // tenants + lookups (groups/bundles already loaded)
      await Promise.all([loadGroups(), loadBundles()]);
    } catch (err) {
      Panoptica.showToast(dT('deploy_modal_load_failed', { message: err.message }), 'error');
      return;
    }
    if (!bundles.length) { Panoptica.showToast(dT('deploy_no_bundles'), 'error'); return; }

    const tenantRows = tenants.slice()
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      .map(t => `<label><input type="checkbox" class="dep-target-cb" value="${Number(t.id)}"> <span>${escHtml(t.display_name)}</span></label>`)
      .join('');
    const groupRows = groups.map(g =>
      `<label><input type="checkbox" class="dep-target-cb" value="${Number(g.id)}"> <span>${escHtml(g.name)} (${Number(g.member_count) || 0})</span></label>`
    ).join('');

    const bodyHtml = `
      <div class="form-group">
        <label>${escHtml(dT('deploy_label_kind'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('deploy_helper_kind'))}</div>
        <div class="mode-picker">
          <label class="mode-card" style="border:1px solid rgba(102,119,153,0.22);">
            <input type="radio" name="dep-target-kind" value="tenant">
            <div class="mode-card-body">
              <div class="mode-card-title">${escHtml(dT('deploy_kind_tenant'))}</div>
              <div class="mode-card-desc">${escHtml(dT('deploy_kind_tenant_desc'))}</div>
            </div>
          </label>
          <label class="mode-card" style="border:1px solid rgba(102,119,153,0.22);">
            <input type="radio" name="dep-target-kind" value="group">
            <div class="mode-card-body">
              <div class="mode-card-title">${escHtml(dT('deploy_kind_group'))}</div>
              <div class="mode-card-desc">${escHtml(dT('deploy_kind_group_desc'))}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group" id="dep-target-list-wrap" style="display:none;">
        <label id="dep-target-list-label"></label>
        <div class="dep-member-list" id="dep-target-list"></div>
      </div>
      <div class="form-group">
        <label>${escHtml(dT('deploy_label_bundle'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">${escHtml(dT('deploy_helper_bundle'))}</div>
        <select id="dep-deploy-bundle">
          <option value="" selected disabled>${escHtml(dT('deploy_bundle_placeholder'))}</option>
          ${bundles.map(b => `<option value="${Number(b.id)}">${escHtml(b.name)} (${escHtml(dT('bundle_counts', { ca: Number(b.ca_count) || 0, intune: Number(b.intune_count) || 0 }))})</option>`).join('')}
        </select>
      </div>
      <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted);">${escHtml(dT('deploy_submit_note'))}</div>
    `;
    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="dep-deploy-submit">${escHtml(dT('deploy_submit_btn'))}</button>`;
    Panoptica.openModal(dT('deploy_modal_title'), bodyHtml, footerHtml);

    document.querySelectorAll('input[name="dep-target-kind"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const kind = document.querySelector('input[name="dep-target-kind"]:checked')?.value;
        const wrap = document.getElementById('dep-target-list-wrap');
        const list = document.getElementById('dep-target-list');
        const label = document.getElementById('dep-target-list-label');
        if (!wrap || !list || !label) return;
        wrap.style.display = '';
        if (kind === 'tenant') {
          label.textContent = dT('deploy_targets_tenants');
          list.innerHTML = tenantRows || `<div class="dep-empty">${escHtml(dT('no_tenants'))}</div>`;
        } else {
          label.textContent = dT('deploy_targets_groups');
          list.innerHTML = groupRows || `<div class="dep-empty">${escHtml(dT('deploy_no_groups'))}</div>`;
        }
      });
    });

    document.getElementById('dep-deploy-submit')?.addEventListener('click', async () => {
      const kind = document.querySelector('input[name="dep-target-kind"]:checked')?.value;
      if (kind !== 'tenant' && kind !== 'group') { Panoptica.showToast(dT('deploy_validation_kind'), 'error'); return; }
      const ids = Array.from(document.querySelectorAll('.dep-target-cb:checked')).map(cb => parseInt(cb.value, 10));
      if (!ids.length) { Panoptica.showToast(dT('deploy_validation_targets'), 'error'); return; }
      const bundleId = document.getElementById('dep-deploy-bundle')?.value;
      if (!bundleId) { Panoptica.showToast(dT('deploy_validation_bundle'), 'error'); return; }

      const btn = document.getElementById('dep-deploy-submit');
      if (btn) btn.setAttribute('disabled', 'disabled');
      try {
        await Panoptica.api('/api/bundle-deployments', {
          method: 'POST',
          body: JSON.stringify({ bundle_id: parseInt(bundleId, 10), target_kind: kind, target_ids: ids }),
        });
        Panoptica.closeModal();
        Panoptica.showToast(dT('deploy_submitted'), 'success');
        switchTab('queue');
      } catch (err) {
        if (btn) btn.removeAttribute('disabled');
        Panoptica.showToast(dT('deploy_submit_failed', { message: errMessage(err) }), 'error');
      }
    });
  }

  // ── Queue polling (SP-audits pattern: 3s while the tab is active) ──
  function startQueuePoll() {
    stopQueuePoll();
    queuePollTimer = setInterval(() => {
      if (currentTab !== 'queue') { stopQueuePoll(); return; }
      refreshQueue();
    }, 3000);
  }
  function stopQueuePoll() {
    if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null; }
  }

  let lastQueueSig = '';

  function queueSignature() {
    // Cheap change signature: re-render only when something the operator can
    // SEE changed. This keeps the 3s poll from rebuilding the DOM under an
    // open action <select> on an armed job (armed jobs are static until the
    // operator acts, so their signature is stable while they review).
    const jobsSig = queueJobs.map(j => [j.id, j.status, JSON.stringify(j.rollup || null)].join(':')).join('|');
    const detailSig = [...expandedJobs].sort().map(id => {
      const d = jobDetails.get(id);
      if (!d) return `${id}:none`;
      return `${id}:${d.status}:` + (d.items || []).map(i => [i.id, i.action, i.preflight_status, i.exec_status].join(',')).join(';');
    }).join('|');
    const uiSig = [...expandedJobs].sort().join(',') + '#' + [...expandedTenants].sort().join(',');
    return jobsSig + '##' + detailSig + '##' + uiSig;
  }

  async function refreshQueue(force) {
    try {
      queueJobs = await Panoptica.api('/api/bundle-deployments');
      // refresh details for expanded jobs so live progress moves
      await Promise.all([...expandedJobs].map(async id => {
        try { jobDetails.set(id, await Panoptica.api(`/api/bundle-deployments/${id}`)); }
        catch (_) { /* transient — keep last detail */ }
      }));
      const sig = queueSignature();
      if (force || sig !== lastQueueSig) {
        lastQueueSig = sig;
        renderQueue();
      }
    } catch (err) {
      const el = document.getElementById('dep-queue-list');
      if (el && !queueJobs.length) el.innerHTML = `<div class="dep-error">${escHtml(dT('queue_load_failed', { message: err.message }))}</div>`;
    }
  }

  function statusBadge(status) {
    return `<span class="dep-status ${escHtml(status)}">${escHtml(dT('status_' + status))}</span>`;
  }

  function jobRollupText(j) {
    const r = j.rollup || {};
    if (j.status === 'preflight') return dT('rollup_preflighting');
    if (j.status === 'armed') {
      return dT('rollup_armed', {
        tenants: Number(r.tenant_count) || 0,
        items: Number(r.total) || 0,
        present: Number(r.already_present) || 0,
        blocked: Number(r.blocked) || 0,
      });
    }
    const done = (Number(r.success) || 0) + (Number(r.failed) || 0) + (Number(r.skipped) || 0);
    return dT('rollup_exec', {
      done, total: Number(r.total) || 0,
      ok: Number(r.success) || 0, failed: Number(r.failed) || 0, skipped: Number(r.skipped) || 0,
    });
  }

  function renderQueue() {
    const el = document.getElementById('dep-queue-list');
    if (!el || currentTab !== 'queue') return;
    lastQueueSig = queueSignature(); // every render records what it drew
    if (!queueJobs.length) {
      el.innerHTML = `<div class="dep-empty">${escHtml(dT('queue_empty'))}</div>`;
      return;
    }
    el.innerHTML = queueJobs.map(j => {
      const open = expandedJobs.has(j.id);
      const detail = open ? jobDetails.get(j.id) : null;
      const when = j.created_at ? new Date(j.created_at + 'Z').toLocaleString() : '';
      return `<div class="dep-job">
        <div class="dep-job-head" data-job-toggle="${j.id}">
          <span class="dep-caret">${open ? '▾' : '▸'}</span>
          <span class="dep-job-title">${escHtml(j.bundle_name)}</span>
          ${statusBadge(j.status)}
          <span class="dep-job-meta">#${j.id} · ${escHtml(when)} · ${escHtml(j.created_by || '')}</span>
          <span class="dep-job-rollup">${escHtml(jobRollupText(j))}</span>
        </div>
        ${open ? renderJobBody(j, detail) : ''}
      </div>`;
    }).join('');

    // wire
    el.querySelectorAll('[data-job-toggle]').forEach(head => {
      head.addEventListener('click', async (e) => {
        if (e.target.closest('button, select')) return;
        const id = parseInt(head.dataset.jobToggle, 10);
        if (expandedJobs.has(id)) { expandedJobs.delete(id); renderQueue(); return; }
        expandedJobs.add(id);
        try { jobDetails.set(id, await Panoptica.api(`/api/bundle-deployments/${id}`)); }
        catch (err) { Panoptica.showToast(dT('queue_load_failed', { message: err.message }), 'error'); }
        renderQueue();
      });
    });
    el.querySelectorAll('[data-jt-toggle]').forEach(head => {
      head.addEventListener('click', () => {
        const key = head.dataset.jtToggle;
        if (expandedTenants.has(key)) expandedTenants.delete(key);
        else expandedTenants.add(key);
        renderQueue();
      });
    });
    el.querySelectorAll('[data-job-start]').forEach(btn => {
      btn.addEventListener('click', () => startJob(parseInt(btn.dataset.jobStart, 10)));
    });
    el.querySelectorAll('[data-job-cancel]').forEach(btn => {
      btn.addEventListener('click', () => cancelJob(parseInt(btn.dataset.jobCancel, 10)));
    });
    el.querySelectorAll('select[data-job-bulk]').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value === 'skip' || sel.value === 'overwrite') {
          bulkItemAction(parseInt(sel.dataset.jobBulk, 10), sel.value);
        }
      });
    });
    el.querySelectorAll('[data-item-action]').forEach(sel => {
      sel.addEventListener('change', () => setItemAction(
        parseInt(sel.dataset.jobId, 10), parseInt(sel.dataset.itemAction, 10), sel.value
      ));
    });
  }

  function renderJobBody(job, detail) {
    if (!detail) return `<div class="dep-job-body"><div class="dep-loading">${escHtml(dT('queue_loading'))}</div></div>`;
    const armed = detail.status === 'armed';
    const hasPresent = (detail.items || []).some(i => i.preflight_status === 'skip_present');

    // Already-present bulk control: a labeled dropdown whose value always
    // REFLECTS the items' current actions (mixed per-item choices show an
    // explicit "Mixed" state) — changing it applies to every already-present
    // item and confirms with a toast. Replaces the old apply-buttons that
    // gave no visible feedback.
    let presentCtl = '';
    if (armed && hasPresent) {
      const presentItems = (detail.items || []).filter(i => i.preflight_status === 'skip_present');
      const allOver = presentItems.every(i => i.action === 'overwrite');
      const allSkip = presentItems.every(i => i.action === 'skip');
      const bulkVal = allOver ? 'overwrite' : (allSkip ? 'skip' : '');
      presentCtl = `
        <div class="dep-present-ctl">
          <label for="dep-bulk-${detail.id}">${escHtml(dT('present_action_label'))}</label>
          <select id="dep-bulk-${detail.id}" data-job-bulk="${detail.id}" data-role-readonly="member">
            ${bulkVal === '' ? `<option value="" selected disabled>${escHtml(dT('present_action_mixed'))}</option>` : ''}
            <option value="skip"${bulkVal === 'skip' ? ' selected' : ''}>${escHtml(dT('action_skip'))}</option>
            <option value="overwrite"${bulkVal === 'overwrite' ? ' selected' : ''}>${escHtml(dT('action_overwrite'))}</option>
          </select>
        </div>`;
    }

    // Armed control bar — hint on its own row; controls row below with the
    // already-present dropdown left and Deploy/Cancel pinned right, so the
    // layout holds in all three locales.
    const armedBar = armed ? `
      <div class="dep-armed-bar">
        <div class="dep-armed-hint">${escHtml(dT('armed_hint'))}</div>
        <div class="dep-armed-controls" data-role-required="member">
          ${presentCtl}
          <div class="dep-armed-right">
            <button class="btn-danger" data-job-start="${detail.id}">${escHtml(dT('start_btn'))}</button>
            <button class="btn-secondary" data-job-cancel="${detail.id}">${escHtml(dT('cancel_btn'))}</button>
          </div>
        </div>
      </div>` : (detail.status === 'preflight' ? `
      <div class="dep-armed-bar">
        <div class="dep-armed-hint">${escHtml(dT('preflight_running_hint'))}</div>
        <div class="dep-armed-controls">
          <div class="dep-armed-right">
            <button class="btn-secondary" data-job-cancel="${detail.id}" data-role-required="member">${escHtml(dT('cancel_btn'))}</button>
          </div>
        </div>
      </div>` : '');

    // Group items by tenant (Job ▸ Tenant ▸ Setting)
    const byTenant = new Map();
    for (const it of detail.items || []) {
      if (!byTenant.has(it.tenant_id)) byTenant.set(it.tenant_id, { name: it.tenant_name, items: [] });
      byTenant.get(it.tenant_id).items.push(it);
    }

    const tenantBlocks = [...byTenant.entries()].map(([tenantId, t]) => {
      const key = `${detail.id}:${tenantId}`;
      const open = expandedTenants.has(key);
      const ok = t.items.filter(i => i.exec_status === 'success').length;
      const failed = t.items.filter(i => i.exec_status === 'failed').length;
      const skipped = t.items.filter(i => i.exec_status === 'skipped').length;
      const pending = t.items.filter(i => i.exec_status === 'pending').length;
      const blocked = t.items.filter(i => i.preflight_status === 'blocked').length;
      const rollup = detail.status === 'armed' || detail.status === 'preflight'
        ? dT('jt_rollup_pre', { items: t.items.length, blocked })
        : dT('jt_rollup_exec', { ok, failed, skipped, pending });
      const rows = open ? t.items.map(it => renderItemRow(detail, it)).join('') : '';
      return `<div class="dep-jt">
        <div class="dep-jt-head" data-jt-toggle="${escHtml(key)}">
          <span class="dep-caret">${open ? '▾' : '▸'}</span>
          <span class="dep-jt-name">${escHtml(t.name)}</span>
          <span class="dep-jt-rollup">${escHtml(rollup)}</span>
        </div>
        ${rows}
      </div>`;
    }).join('');

    return `<div class="dep-job-body">${armedBar}${tenantBlocks}</div>`;
  }

  function renderItemRow(job, it) {
    const typePill = `<span class="dep-type-pill ${it.item_type === 'ca' ? 'dynamic' : ''}">${it.item_type === 'ca' ? 'CA' : 'Intune'}</span>`;
    const pf = it.preflight_status
      ? `<span class="dep-pf ${escHtml(it.preflight_status)}">${escHtml(dT('pf_' + it.preflight_status))}</span>` : '';
    const ex = `<span class="dep-ex ${escHtml(it.exec_status)}">${escHtml(dT('ex_' + it.exec_status))}</span>`;

    // Action control: only on an armed job, member+, and never for blocked.
    let actionCtl = '';
    if (job.status === 'armed' && it.preflight_status && it.preflight_status !== 'blocked') {
      const opts = it.preflight_status === 'skip_present'
        ? [['skip', dT('action_skip')], ['overwrite', dT('action_overwrite')]]
        : [['create', dT('action_create')], ['skip', dT('action_skip')]];
      actionCtl = `<select data-item-action="${it.id}" data-job-id="${job.id}" data-role-readonly="member">
        ${opts.map(([v, l]) => `<option value="${v}"${it.action === v ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}
      </select>`;
    } else if (it.action) {
      actionCtl = `<span style="font-size:.72rem; color:var(--p-text-muted);">${escHtml(dT('action_' + it.action))}</span>`;
    }

    return `<div class="dep-ji">
      <span class="dep-ji-name">${escHtml(it.template_name || ('#' + it.template_id))}</span>
      ${typePill} ${pf} ${ex} ${actionCtl}
      ${it.preflight_note ? `<div class="dep-ji-note">${escHtml(it.preflight_note)}</div>` : ''}
      ${it.exec_error ? `<div class="dep-ji-err">${escHtml(it.exec_error)}</div>` : ''}
    </div>`;
  }

  async function setItemAction(jobId, itemId, action) {
    try {
      await Panoptica.api(`/api/bundle-deployments/${jobId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ item_ids: [itemId], action }),
      });
      jobDetails.set(jobId, await Panoptica.api(`/api/bundle-deployments/${jobId}`));
      renderQueue();
    } catch (err) {
      Panoptica.showToast(dT('action_save_failed', { message: errMessage(err) }), 'error');
      refreshQueue();
    }
  }

  async function bulkItemAction(jobId, action) {
    try {
      const r = await Panoptica.api(`/api/bundle-deployments/${jobId}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ all_skip_present: true, action }),
      });
      jobDetails.set(jobId, await Panoptica.api(`/api/bundle-deployments/${jobId}`));
      renderQueue();
      Panoptica.showToast(
        dT('bulk_applied', { action: action === 'overwrite' ? dT('action_overwrite') : dT('action_skip'), count: Number(r.affected) || 0 }),
        'success'
      );
    } catch (err) {
      Panoptica.showToast(dT('action_save_failed', { message: errMessage(err) }), 'error');
      refreshQueue(true);
    }
  }

  async function startJob(jobId) {
    const detail = jobDetails.get(jobId);
    const tenantCount = detail?.target_summary?.tenants?.length || 0;
    const proceed = await Panoptica.confirmModal(
      dT('confirm_start', { bundle: detail?.bundle_name || `#${jobId}`, tenants: tenantCount }),
      { danger: true }
    );
    if (!proceed) return;
    try {
      await Panoptica.api(`/api/bundle-deployments/${jobId}/start`, { method: 'POST' });
      Panoptica.showToast(dT('start_ok'), 'success');
      refreshQueue();
    } catch (err) {
      Panoptica.showToast(dT('start_failed', { message: errMessage(err) }), 'error');
      refreshQueue();
    }
  }

  async function cancelJob(jobId) {
    const proceed = await Panoptica.confirmModal(dT('confirm_cancel_job'), { danger: true });
    if (!proceed) return;
    try {
      await Panoptica.api(`/api/bundle-deployments/${jobId}/cancel`, { method: 'POST' });
      refreshQueue();
    } catch (err) {
      Panoptica.showToast(dT('cancel_failed', { message: errMessage(err) }), 'error');
      refreshQueue();
    }
  }

  window.PanopticaPage = { init, destroy };
})();
