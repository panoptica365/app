/**
 * Panoptica — Tenant Dashboard (Phase 2 — Two-Zone Layout)
 * Zone 1: Compact metric cards in a 3-column grid (at-a-glance stats)
 * Zone 2: Full-width collapsible list panels (drill-down details)
 */

(function () {
  'use strict';

  let tenantId = null;
  let tenantData = null;
  let tenantInfo = null;
  let currentView = 'overview'; // 'overview' or 'alerts'
  let tenantAlertsModule = null;
  let tenantFilterBar = null; // Panoptica.AlertFilterBar instance for the alerts tab
  let chatBusy = false;
  let chatSessionId = null;
  let pollWatchdog = null;       // safety-net timer for a missed poll-complete event
  let pollSocketHandlers = null; // { socket, updated, failed } — kept for destroy() cleanup
  let appsInventory = null;      // Feature 8.9 — cached Applications inventory for the current tenant

  // ─── Lifecycle ───

  async function init(params) {
    tenantId = params.id;
    if (!tenantId) {
      document.getElementById('td-card-grid').innerHTML =
        '<div class="panel-error">' + window.t('tenant_dashboard.error.no_tenant') + '</div>';
      return;
    }

    const pollBtn = document.getElementById('td-poll-now');
    if (pollBtn) pollBtn.addEventListener('click', () => pollNow());
    wirePollSocket();

    // Wire view toggle
    document.querySelectorAll('#td-view-toggle .td-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === currentView) return;
        currentView = view;
        document.querySelectorAll('#td-view-toggle .td-view-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.view === view));
        toggleView();
      });
    });

    // Header tenant switcher — populate the dropdown + wire tenant changes.
    wireTenantSwitcher();

    wireTenantChat();
    wireTenantDigest();
    ChangeLog.wire();

    // Tab preservation across a tenant switch: the switcher re-navigates with
    // params.view set to the tab that was active. Mark that tab active up
    // front and hide the Overview zone so its cards don't flash before
    // loadTenantData resolves.
    const requestedView = params.view;
    if (requestedView && requestedView !== 'overview' &&
        document.querySelector('#td-view-toggle .td-view-btn[data-view="' + requestedView + '"]')) {
      currentView = requestedView;
      document.querySelectorAll('#td-view-toggle .td-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === currentView));
      ['td-card-grid', 'td-digest-card', 'td-ask-claude', 'td-list-panels'].forEach(id => {
        const node = el(id);
        if (node) node.style.display = 'none';
      });
    }

    await loadTenantData();

    // Show the requested non-overview tab now that its scaffolding exists.
    if (currentView !== 'overview') toggleView();

    // Apr 28, 2026: deep-link from the per-alert breadcrumb badge.
    // navigateTo('tenant-dashboard', { id, change_id }) — open the named
    // change event directly. Done after loadTenantData so the view scaffolding
    // exists before we toggle to change-log.
    if (params.change_id) {
      ChangeLog.openById(parseInt(params.change_id, 10));
    }
  }

  function destroy() {
    // Close any open alert slideout so it doesn't stay stuck over the next page
    if (window.Panoptica && Panoptica.AlertSlideout) Panoptica.AlertSlideout.close();
    // Drop the poll-completion socket listeners + any pending watchdog so they
    // don't fire against a torn-down page or leak across tenant navigations.
    if (pollSocketHandlers) {
      pollSocketHandlers.socket.off('tenant:updated', pollSocketHandlers.updated);
      pollSocketHandlers.socket.off('tenant:poll_failed', pollSocketHandlers.failed);
      pollSocketHandlers = null;
    }
    if (pollWatchdog) { clearTimeout(pollWatchdog); pollWatchdog = null; }
    tenantId = null;
    tenantData = null;
    tenantInfo = null;
    currentView = 'overview';
    tenantFilterBar = null; // DOM gets torn down with the page; drop the ref
    chatBusy = false;
    chatSessionId = null;
  }

  // ─── Tenant switcher (header dropdown) ───
  // Populates the header <select> with every tenant. Picking one re-navigates
  // to that tenant's dashboard, carrying the active tab in params.view so the
  // operator stays on the same tab (e.g. Intune Policies) after the switch.
  async function wireTenantSwitcher() {
    const sel = el('td-tenant-switcher');
    if (!sel) return;

    sel.addEventListener('change', () => {
      const newId = sel.value;
      if (!newId || String(newId) === String(tenantId)) return;
      Panoptica.navigateTo('tenant-dashboard', { id: newId, view: currentView });
    });

    try {
      const tenants = await Panoptica.api('/api/tenants');
      sel.innerHTML = '';
      tenants.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.display_name;
        if (String(t.id) === String(tenantId)) opt.selected = true;
        sel.appendChild(opt);
      });
    } catch (e) {
      // Non-fatal — the dashboard still works, switching is just unavailable.
      // Degrade to a single option for the current tenant.
      console.error('[TenantDashboard] Failed to load tenant list:', e);
      sel.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = tenantId;
      opt.textContent = (tenantInfo && tenantInfo.display_name) || window.t('tenant_dashboard.title');
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function toggleView() {
    const grid = el('td-card-grid');
    const askClaude = el('td-ask-claude');
    const digestCard = el('td-digest-card');
    const listPanels = el('td-list-panels');
    const alertsView = el('td-alerts-view');
    const caView = el('td-ca-view');

    // Hide all views
    grid.style.display = 'none';
    if (askClaude) askClaude.style.display = 'none';
    if (digestCard) digestCard.style.display = 'none';
    if (listPanels) listPanels.style.display = 'none';
    alertsView.style.display = 'none';
    if (caView) caView.style.display = 'none';
    const intuneView = el('td-intune-view');
    if (intuneView) intuneView.style.display = 'none';

    const changelogView = el('td-changelog-view');
    if (changelogView) changelogView.style.display = 'none';

    const appsView = el('td-applications-view');
    if (appsView) appsView.style.display = 'none';

    if (currentView === 'overview') {
      grid.style.display = '';
      if (digestCard) digestCard.style.display = '';
      if (askClaude) askClaude.style.display = '';
      if (listPanels) listPanels.style.display = '';
    } else if (currentView === 'alerts') {
      alertsView.style.display = 'block';
      loadTenantAlerts();
    } else if (currentView === 'ca-policies') {
      if (caView) caView.style.display = 'block';
      loadCaAssignments();
    } else if (currentView === 'intune-policies') {
      if (intuneView) intuneView.style.display = 'block';
      loadIntuneDeployments();
    } else if (currentView === 'applications') {
      if (appsView) appsView.style.display = 'block';
      loadApplications();
    } else if (currentView === 'change-log') {
      if (changelogView) changelogView.style.display = 'block';
      ChangeLog.show();
    }
  }

  // ─── Applications tab (Feature 8.9 — known-good / drift inventory) ───

  async function loadApplications() {
    const list = el('td-apps-list');
    const link = el('td-apps-entra-link');
    if (link && tenantInfo && tenantInfo.tenant_id) {
      link.href = `https://entra.microsoft.com/${tenantInfo.tenant_id}/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview`;
    }
    // onclick assignment is idempotent across re-mounts (the partial is re-injected
    // on each navigation, so these are fresh elements anyway).
    const refBtn = el('td-apps-refresh-btn');
    const saveBtn = el('td-apps-save-btn');
    if (refBtn) refBtn.onclick = refreshApplications;
    if (saveBtn) saveBtn.onclick = saveApplications;
    try {
      const data = await Panoptica.api(`/api/applications?tenant_id=${tenantId}`);
      appsInventory = data.inventory;
      renderApplications();
    } catch (e) {
      list.innerHTML = `<div class="panel-error">${esc(window.t('tenant_dashboard.applications.load_failed'))}</div>`;
    }
  }

  // Show/clear the persistent progress+result banner above the app list.
  // Persists across tab switches (it's a sibling of #td-apps-list, untouched by
  // renderApplications) so a Save result is still visible when the operator
  // tabs away and comes back.
  function setAppsProgress(html, isError) {
    const p = el('td-apps-progress');
    if (!p) return;
    if (!html) { p.style.display = 'none'; p.innerHTML = ''; return; }
    p.className = 'td-apps-progress' + (isError ? ' is-error' : '');
    p.style.display = 'flex';
    p.innerHTML = html;
  }

  // Per-app deep-link straight to the app's blade in Entra, where the Delete
  // button lives — operator clicks Delete → Yes without hunting the app list.
  // Read-only: Panoptica never deletes anything itself.
  function entraDeleteLink(a) {
    const tid = (tenantInfo && tenantInfo.tenant_id) ? tenantInfo.tenant_id + '/' : '';
    const base = 'https://entra.microsoft.com/' + tid + '#view/';
    if (a.kind === 'registration') {
      return base + 'Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/' + encodeURIComponent(a.appId);
    }
    return base + 'Microsoft_AAD_IAM/ManagedAppMenuBlade/~/Properties/objectId/'
      + encodeURIComponent(a.objectId || '') + '/appId/' + encodeURIComponent(a.appId);
  }

  function appsTimeNow() {
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const loc = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    return new Date().toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  }

  async function refreshApplications() {
    const saveBtn = el('td-apps-save-btn');
    const refBtn = el('td-apps-refresh-btn');
    if (refBtn) refBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    setAppsProgress(`<div class="loading-spinner"></div><span>${esc(window.t('tenant_dashboard.applications.refreshing'))}</span>`, false);
    try {
      const res = await Panoptica.api(`/api/applications/refresh?tenant_id=${tenantId}`, { method: 'POST' });
      appsInventory = res.inventory;
      renderApplications();
      setAppsProgress(null);
      if (window.Panoptica && Panoptica.showToast) Panoptica.showToast(window.t('tenant_dashboard.applications.refresh_done'), 'success');
    } catch (e) {
      setAppsProgress(esc(window.t('tenant_dashboard.applications.refresh_failed', { message: e.message })), true);
    } finally {
      if (refBtn) refBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function saveApplications() {
    const saveBtn = el('td-apps-save-btn');
    const refBtn = el('td-apps-refresh-btn');
    const checked = Array.from(document.querySelectorAll('#td-apps-list .app-kg-check:checked'))
      .map(cb => ({ appId: cb.dataset.appid, kind: cb.dataset.kind }));
    const checkedKeys = new Set(checked.map(c => `${c.kind}:${c.appId}`));
    const apps = (appsInventory && appsInventory.apps) || [];
    // Apps that will be sent to Sonnet: not being sanctioned now, not already
    // known-good, and not already carrying a verdict.
    const toEval = apps.filter(a =>
      !checkedKeys.has(`${a.kind}:${a.appId}`) && !a.blessed && !(a.sonnet && a.sonnet.verdict)).length;

    if (checked.length === 0 && toEval === 0) {
      setAppsProgress(esc(window.t('tenant_dashboard.applications.save_nothing')), true);
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (refBtn) refBtn.disabled = true;
    // Immediate feedback — names the work (N sanctioned, M to Sonnet) and warns
    // the Sonnet pass can take a moment, so a slow Save never looks like a no-op.
    setAppsProgress(`<div class="loading-spinner"></div><span>${esc(window.t('tenant_dashboard.applications.saving', { blessed: checked.length, evaluated: toEval }))}</span>`, false);

    try {
      const res = await Panoptica.api('/api/applications/save', {
        method: 'POST',
        body: JSON.stringify({ tenant_id: tenantId, blessed: checked }),
      });
      appsInventory = res.inventory;
      renderApplications();
      setAppsProgress(`<span>${esc(window.t('tenant_dashboard.applications.save_result', { when: appsTimeNow(), blessed: res.blessed, evaluated: res.evaluated }))}</span>`, false);
      if (window.Panoptica && Panoptica.showToast) {
        Panoptica.showToast(window.t('tenant_dashboard.applications.save_done', { blessed: res.blessed, evaluated: res.evaluated }), 'success');
      }
    } catch (e) {
      setAppsProgress(esc(window.t('tenant_dashboard.applications.save_failed', { message: e.message })), true);
      if (window.Panoptica && Panoptica.showToast) Panoptica.showToast(window.t('tenant_dashboard.applications.save_failed', { message: e.message }), 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (refBtn) refBtn.disabled = false;
    }
  }

  function appsSortRank(x) {
    if (x.blessed && x.drift_state === 'drifted') return 0;
    if (x.sonnet && x.sonnet.verdict === 'red') return 1;
    if (x.sonnet && x.sonnet.verdict === 'yellow') return 2;
    if (x.blessed) return 4;
    return 3;
  }

  // Sonnet triage assessment, shown at the TOP of the expanded row so the
  // verdict's reasoning is visible (the dot's tooltip was undiscoverable).
  // Framed as triage, never absolution (spec §7): a green dot is "nothing
  // alarming", not "safe" — only sanctioning stores a protected baseline.
  function appAssessmentHtml(app, lang) {
    const s = app.sonnet;
    if (!s || !s.verdict) {
      return `<div class="app-assess app-assess-none">
        <div class="app-assess-title">${esc(window.t('tenant_dashboard.applications.assessment_title'))}</div>
        <div class="app-perm-res">${esc(window.t('tenant_dashboard.applications.assessment_none'))}</div>
      </div>`;
    }
    const reason = (s.reasons && (s.reasons[lang] || s.reasons.en)) || '';
    const vlabel = window.t('tenant_dashboard.applications.assessment_' + s.verdict);
    const when = s.evaluated_at ? window.t('tenant_dashboard.applications.assessment_on', { when: String(s.evaluated_at).slice(0, 16) }) : '';
    return `<div class="app-assess app-assess-${esc(s.verdict)}">
      <div class="app-assess-head">
        <span class="app-dot app-dot-${esc(s.verdict)}"></span>
        <span class="app-assess-verdict">${esc(vlabel)}</span>
        <span class="app-assess-title">${esc(window.t('tenant_dashboard.applications.assessment_title'))}</span>
        ${when ? `<span class="app-assess-when">${esc(when)}</span>` : ''}
      </div>
      ${reason ? `<div class="app-assess-reason">${esc(reason)}</div>` : ''}
      <div class="app-assess-note">${esc(window.t('tenant_dashboard.applications.assessment_disclaimer'))}</div>
    </div>`;
  }

  function appPermsHtml(app) {
    function group(title, items, fmt) {
      if (!items || !items.length) return '';
      return `<div class="app-perm-group"><div class="app-perm-title">${esc(title)}</div>${items.map(fmt).join('')}</div>`;
    }
    let html = '';
    html += group(window.t('tenant_dashboard.applications.perm_delegated'), app.delegatedPermissions,
      p => `<div class="app-perm">${esc(p.scope)} <span class="app-perm-res">— ${esc(p.resource || '')}${p.consentType === 'AllPrincipals' ? ' (' + esc(window.t('tenant_dashboard.applications.tenant_wide')) + ')' : ''}</span></div>`);
    html += group(window.t('tenant_dashboard.applications.perm_application'), app.applicationPermissions,
      p => `<div class="app-perm app-perm-high">${esc(p.role)} <span class="app-perm-res">— ${esc(p.resource || '')}</span></div>`);
    html += group(window.t('tenant_dashboard.applications.perm_requested'), app.requiredResourceAccess,
      p => `<div class="app-perm">${esc(p.value)} <span class="app-perm-res">— ${esc(p.resource || '')} (${esc(p.permType || '')})</span></div>`);
    html += group(window.t('tenant_dashboard.applications.perm_credentials'), app.credentials,
      c => `<div class="app-perm">${esc(c.type)} ${esc(c.displayName || c.keyId || '')} <span class="app-perm-res">${c.endDateTime ? '— exp ' + esc(String(c.endDateTime).slice(0, 10)) : ''}</span></div>`);
    html += group(window.t('tenant_dashboard.applications.perm_redirects'), app.redirectUris,
      u => `<div class="app-perm">${esc(u)}</div>`);
    if (!html) html = `<div class="app-perm-res" style="padding:6px;">${esc(window.t('tenant_dashboard.applications.no_perms'))}</div>`;
    return html;
  }

  function appRowHtml(a, lang) {
    const v = a.sonnet && a.sonnet.verdict;
    const reason = (a.sonnet && a.sonnet.reasons && (a.sonnet.reasons[lang] || a.sonnet.reasons.en)) || '';
    const dot = v
      ? `<span class="app-dot app-dot-${esc(v)}" title="${esc(reason)}"></span>`
      : `<span class="app-dot app-dot-none" title="${esc(window.t('tenant_dashboard.applications.not_evaluated'))}"></span>`;
    const kindBadge = `<span class="app-kind app-kind-${esc(a.kind)}">${esc(window.t('tenant_dashboard.applications.kind_' + a.kind))}</span>`;
    let status = '';
    if (a.blessed && a.drift_state === 'drifted') {
      status = `<span class="app-status app-status-drift">${esc(window.t('tenant_dashboard.applications.status_drift'))}</span>`;
    } else if (a.blessed) {
      const when = a.approved_at ? ' · ' + esc(String(a.approved_at).slice(0, 10)) : '';
      status = `<span class="app-status app-status-good">${esc(window.t('tenant_dashboard.applications.status_known_good'))}${when}</span>`;
    }
    const verified = a.verifiedPublisher
      ? ` <span class="app-verified" title="${esc(window.t('tenant_dashboard.applications.verified'))}">✓</span>` : '';
    return `<tr class="app-row">
        <td>${dot}</td>
        <td><button type="button" class="app-name-btn">${esc(a.displayName || a.appId)}</button> ${kindBadge}</td>
        <td class="app-perm-res" style="font-size:0.78rem;">${esc(a.publisher || '—')}${verified}</td>
        <td>${status}</td>
        <td style="text-align:center;"><input type="checkbox" class="app-kg-check" data-appid="${esc(a.appId)}" data-kind="${esc(a.kind)}" ${a.blessed ? 'checked' : ''}></td>
        <td style="text-align:center;"><a class="app-del-link" href="${esc(entraDeleteLink(a))}" target="_blank" rel="noopener" title="${esc(window.t('tenant_dashboard.applications.delete_title'))}">${esc(window.t('tenant_dashboard.applications.delete_link'))}</a></td>
      </tr>
      <tr class="app-detail-row" style="display:none;"><td></td><td colspan="5">${appAssessmentHtml(a, lang)}${appPermsHtml(a)}</td></tr>`;
  }

  function setAppsStatus(inv) {
    const s = el('td-apps-status');
    if (!s) return;
    if (!inv || !inv.apps) { s.textContent = ''; return; }
    const total = inv.apps.length;
    const blessed = inv.apps.filter(a => a.blessed).length;
    const drifted = inv.apps.filter(a => a.drift_state === 'drifted').length;
    let txt = window.t('tenant_dashboard.applications.summary', { total, blessed, drifted });
    if (inv.generated_at) txt += ' · ' + window.t('tenant_dashboard.applications.refreshed', { when: String(inv.generated_at).slice(0, 16) });
    s.textContent = txt;
  }

  function renderApplications() {
    const list = el('td-apps-list');
    const inv = appsInventory;
    if (!inv || !Array.isArray(inv.apps) || inv.apps.length === 0) {
      list.innerHTML = `<div class="ca-empty-state" style="text-align:center; padding:48px 20px; color:var(--p-text-muted);">
        <div style="font-size:2.5rem; margin-bottom:12px;">🧩</div>
        <div>${esc(window.t('tenant_dashboard.applications.empty'))}</div></div>`;
      setAppsStatus(inv);
      return;
    }
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const apps = inv.apps.slice().sort((a, b) => {
      const ra = appsSortRank(a), rb = appsSortRank(b);
      if (ra !== rb) return ra - rb;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    });
    list.innerHTML = `<div class="td-intune-scroll"><table class="td-list-table app-table"><thead><tr>
        <th style="width:34px;"></th>
        <th>${esc(window.t('tenant_dashboard.applications.col_app'))}</th>
        <th>${esc(window.t('tenant_dashboard.applications.col_publisher'))}</th>
        <th>${esc(window.t('tenant_dashboard.applications.col_status'))}</th>
        <th style="width:110px; text-align:center;">${esc(window.t('tenant_dashboard.applications.col_known_good'))}</th>
        <th style="width:80px; text-align:center;">${esc(window.t('tenant_dashboard.applications.col_remove'))}</th>
      </tr></thead><tbody>${apps.map(a => appRowHtml(a, lang)).join('')}</tbody></table></div>`;
    list.querySelectorAll('.app-name-btn').forEach(b => b.addEventListener('click', () => {
      const detail = b.closest('tr').nextElementSibling;
      if (detail && detail.classList.contains('app-detail-row')) {
        detail.style.display = detail.style.display === 'none' ? '' : 'none';
      }
    }));
    setAppsStatus(inv);
  }
  // Alerts tab: mount the shared filter bar once, then hand off to the table
  // reloader. toggleView() calls this every time the tab is shown; the
  // mount-once guard lets users preserve their filter selection when they
  // tab between Overview and Alerts.
  async function loadTenantAlerts() {
    const view = el('td-alerts-view');

    if (!tenantFilterBar) {
      view.innerHTML = `
        <div id="td-alerts-filter-container"></div>
        <div id="td-alerts-table-container">
          <div class="loading-container" style="height:200px;"><div class="loading-spinner"></div>${window.t('tenant_dashboard.alerts.loading')}</div>
        </div>
      `;
      tenantFilterBar = await Panoptica.AlertFilterBar.mount(
        el('td-alerts-filter-container'),
        {
          showTenantSelector: false,
          onChange: () => reloadTenantAlertsTable(),
        }
      );
    }

    await reloadTenantAlertsTable();
  }

  async function reloadTenantAlertsTable() {
    const tableContainer = el('td-alerts-table-container');
    if (!tableContainer) return;

    tableContainer.innerHTML = '<div class="loading-container" style="height:200px;"><div class="loading-spinner"></div>' + window.t('tenant_dashboard.alerts.loading') + '</div>';

    try {
      // Layer the tenant id on top of whatever filters the user set. Drop
      // empty values so we don't send tenant_id=&severity=&status=... which
      // the API parses as literal empty strings.
      const filters = tenantFilterBar ? tenantFilterBar.getFilters() : {};
      filters.tenant_id = tenantId;
      const params = new URLSearchParams({ ...filters, limit: 50 });
      for (const [k, v] of [...params.entries()]) { if (!v) params.delete(k); }

      const data = await Panoptica.api(`/api/alerts?${params}`);
      const alerts = data.alerts || [];

      if (alerts.length === 0) {
        tableContainer.innerHTML = '<div class="td-no-data">' + window.t('tenant_dashboard.alerts.empty') + '</div>';
        return;
      }

      let html = '<table class="alert-table"><thead><tr>';
      html += `<th>${window.t('tenant_dashboard.alerts.col_severity')}</th><th>${window.t('tenant_dashboard.alerts.col_alert')}</th><th>${window.t('tenant_dashboard.alerts.col_category')}</th><th>${window.t('tenant_dashboard.alerts.col_time')}</th><th>${window.t('tenant_dashboard.alerts.col_recurrence')}</th><th>${window.t('tenant_dashboard.alerts.col_status')}</th>`;
      html += '</tr></thead><tbody>';
      for (const a of alerts) {
        html += `<tr class="alert-row" data-id="${a.id}">
          <td><span class="alert-severity-badge sev-${a.severity}">${a.severity}</span></td>
          <td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.message)}</td>
          <td>${formatCategory(a.category)}</td>
          <td>${formatTime(a.triggered_at)}</td>
          <td>${a.recurrence_count > 1 ? a.recurrence_count + '×' : ''}</td>
          <td><span class="alert-status-pill status-${a.status}">${a.status}</span></td>
        </tr>`;
      }
      html += '</tbody></table>';
      if (data.pagination?.total > 50) {
        html += `<div style="padding:10px;font-family:Inter,sans-serif;font-size:0.85rem;color:var(--p-text-muted);">${window.t('tenant_dashboard.alerts.showing_link', { total: data.pagination.total, tenantId: tenantId })}</div>`;
      }
      tableContainer.innerHTML = html;

      // Wire row clicks → shared alert slideout. Refresh only the table on
      // status change so the user's filter selection survives.
      tableContainer.querySelectorAll('.alert-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = parseInt(row.dataset.id, 10);
          if (!id || !Panoptica.AlertSlideout) return;
          Panoptica.AlertSlideout.open(id, {
            onStatusChanged: () => reloadTenantAlertsTable(),
          });
        });
      });
    } catch (e) {
      tableContainer.innerHTML = '<div class="panel-error">' + window.t('tenant_dashboard.alerts.load_failed_inline', { message: esc(e.message) }) + '</div>';
    }
  }

  function formatCategory(cat) {
    if (!cat) return '—';
    const key = 'tenant_dashboard.alert_category.' + cat;
    const translated = window.t(key);
    // window.t returns the key itself when missing — fall back to raw cat in that case
    return (translated === key) ? cat : translated;
  }

  function formatTime(ts) {
    if (!ts) return '—';
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    return new Date(ts).toLocaleString(dateLocale, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
  }

  // ─── Poll Now ───
  //
  // The server runs the poll in the background and returns 202 right away —
  // a full poll can take minutes (see api-tenants.js). The button stays in
  // its "polling" state until the poll engine emits `tenant:updated` for
  // this tenant, or `tenant:poll_failed` on error — both handled in
  // wirePollSocket(). The watchdog is a safety net: if neither event lands
  // (socket dropped, or a poll running past the timeout) it releases the
  // button so it can't stay stuck.

  const POLL_WATCHDOG_MS = 8 * 60 * 1000;

  function isPolling() {
    const btn = document.getElementById('td-poll-now');
    return !!(btn && btn.classList.contains('polling'));
  }

  function endPollUi() {
    const btn = document.getElementById('td-poll-now');
    if (btn) {
      btn.classList.remove('polling');
      btn.textContent = window.t('tenant_dashboard.btn_poll_now');
    }
    if (pollWatchdog) { clearTimeout(pollWatchdog); pollWatchdog = null; }
  }

  async function pollNow() {
    const btn = document.getElementById('td-poll-now');
    if (!btn || btn.classList.contains('polling')) return;
    btn.classList.add('polling');
    btn.textContent = window.t('tenant_dashboard.btn_polling');

    try {
      await Panoptica.api(`/api/tenants/${tenantId}/poll`, { method: 'POST', body: JSON.stringify({ full: true }) });
      pollWatchdog = setTimeout(() => {
        pollWatchdog = null;
        if (!isPolling()) return;
        endPollUi();
        Panoptica.showToast(window.t('tenant_dashboard.toast_poll_running_bg'), 'info');
        loadTenantData();
      }, POLL_WATCHDOG_MS);
    } catch (err) {
      // The request to *start* the poll failed (network / 5xx) — nothing is
      // running server-side, so release the button immediately.
      endPollUi();
      Panoptica.showToast(window.t('tenant_dashboard.toast_poll_failed', { message: err.message }), 'error');
    }
  }

  function wirePollSocket() {
    const socket = window.Panoptica && Panoptica.getSocket && Panoptica.getSocket();
    if (!socket) return; // Socket.IO unavailable — pollNow() still finishes via its watchdog

    const updated = (payload) => {
      if (!payload || String(payload.tenantId) !== String(tenantId)) return;
      if (!isPolling()) return; // a scheduled background poll, not our manual one
      endPollUi();
      Panoptica.showToast(window.t('tenant_dashboard.toast_full_poll_completed'), 'success');
      loadTenantData();
    };
    const failed = (payload) => {
      if (!payload || String(payload.tenantId) !== String(tenantId)) return;
      if (!isPolling()) return;
      endPollUi();
      Panoptica.showToast(window.t('tenant_dashboard.toast_poll_failed', { message: payload.error || 'unknown error' }), 'error');
    };
    socket.on('tenant:updated', updated);
    socket.on('tenant:poll_failed', failed);
    pollSocketHandlers = { socket, updated, failed };
  }

  // ─── Data Loading ───

  async function loadTenantData() {
    try {
      const [info, allData] = await Promise.all([
        Panoptica.api(`/api/tenants/${tenantId}`),
        Panoptica.api(`/api/tenants/${tenantId}/data`).catch(() => ({ services: {} })),
      ]);

      tenantInfo = info;
      tenantData = allData;

      renderInfoBar(info);
      renderDashboard();
    } catch (err) {
      document.getElementById('td-card-grid').innerHTML =
        '<div class="panel-error">' + window.t('tenant_dashboard.error.load_failed_inline', { message: esc(err.message) }) + '</div>';
    }
  }

  // ─── Info Bar ───

  function renderInfoBar(t) {
    el('td-display-name').textContent = t.display_name;
    const statusEl = el('td-status');
    statusEl.innerHTML = t.enabled
      ? '<span class="status-badge status-enabled">' + window.t('tenant_dashboard.status_enabled') + '</span>'
      : '<span class="status-badge status-disabled">' + window.t('tenant_dashboard.status_disabled') + '</span>';
    el('td-polling').textContent = window.t('tenant_dashboard.minutes_short', { count: (t.polling_interval || 15) });
    el('td-last-polled').textContent = t.last_polled_at || window.t('common.never');
    const pcEl = el('td-poll-count');
    if (pcEl) pcEl.textContent = t.poll_count != null ? t.poll_count : '—';
  }

  // ═══════════════════════════════════════
  // TWO-ZONE RENDERER
  // ═══════════════════════════════════════

  function renderDashboard() {
    const container = el('td-card-grid');
    const svc = tenantData?.services || {};
    const sec = svc.security || {};
    const entra = svc.entra || {};
    const exch = svc.exchange || {};
    const sp = svc.sharepoint || {};
    const od = svc.onedrive || {};
    const teams = svc.teams || {};

    let cards = '';   // Zone 1: compact stat cards
    let panels = '';  // Zone 2: full-width collapsible lists

    // ─── ZONE 1: METRIC CARDS ───

    // Secure Score — Microsoft-sourced scores use 2-decimal precision
    // to match the Defender console convention (83.27% not 83.3%).
    const score = sec.secure_score;
    if (score) {
      const pct = score.percentage;
      const color = scoreColor(pct);
      // Primary subtitle — raw score ratio.
      let subtitle = window.t('tenant_dashboard.card.score_format', { cur: score.currentScore.toFixed(1), max: score.maxScore.toFixed(1) });
      // Second line — Microsoft's average for similar-sized tenants.
      // averageScore is ALREADY a percentage (0-100), not a raw score —
      // Microsoft's schema docs suggest otherwise, but empirically it
      // matches what the Defender console displays. Verified against a
      // Thymox poll: averageScore ≈ 46.66 matched Defender's "Similar
      // size: 46.66%" exactly. Do not divide by maxScore.
      const totalSeatsAvg = (score.averageComparativeScores || [])
        .find(c => c.basis === 'TotalSeats');
      if (totalSeatsAvg && typeof totalSeatsAvg.averageScore === 'number') {
        subtitle += '<br>' + window.t('tenant_dashboard.card.similar_size_avg', { pct: fmtPct(totalSeatsAvg.averageScore, 2) });
      }
      cards += statCard(window.t('tenant_dashboard.card.secure_score'), `<span style="color:${color};">${fmtPct(pct, 2)}%</span>`,
        subtitle, color);
    }

    // Licensing summary
    const us = entra.user_summary;
    if (us) {
      // Subtitle has to reconcile to the displayed total: previously it
      // showed only `licensed` + `guests`, which silently hid unlicensed
      // members (e.g. 8 licensed + 40 guests = 48, not the 58 shown).
      // licensed_members + unlicensed + guests = total always (members =
      // licensed_members + unlicensed; total = members + guests).
      //
      // Fallback for snapshots polled before licensed_members was added:
      // members − unlicensed gives the same value without needing the
      // new field.
      const licensedMembers = us.licensed_members != null
        ? us.licensed_members
        : Math.max(0, (us.total ?? 0) - (us.guests ?? 0) - (us.unlicensed ?? 0));
      cards += statCard(
        window.t('tenant_dashboard.card.total_users'),
        us.total,
        window.t('tenant_dashboard.card.total_users_subtitle', {
          licensed: licensedMembers,
          unlicensed: us.unlicensed,
          guests: us.guests,
        })
      );
      cards += statCard(window.t('tenant_dashboard.card.licensed'), us.licensed, window.t('tenant_dashboard.card.licensed_subtitle', { unlicensed: us.unlicensed }), us.unlicensed > 0 ? 'var(--status-degraded)' : 'var(--status-healthy)');
    }

    // Global Admins
    const ga = sec.global_admins;
    if (ga) {
      const gaColor = ga.count > 5 ? 'var(--status-broken)' : ga.count > 2 ? 'var(--status-degraded)' : 'var(--status-healthy)';
      cards += statCard(window.t('tenant_dashboard.card.global_admins'), ga.count, '', gaColor);
    }

    // Conditional Access
    const ca = sec.conditional_access;
    if (Array.isArray(ca)) {
      const enabled = ca.filter(p => p.state === 'enabled').length;
      cards += statCard(window.t('tenant_dashboard.card.ca_policies'), ca.length, window.t('tenant_dashboard.card.ca_policies_subtitle', { enabled: enabled }));
    }

    // Security Defaults
    const sd = sec.security_defaults;
    if (sd) {
      const isOn = sd.isEnabled === true;
      cards += statCard(window.t('tenant_dashboard.card.security_defaults'), isOn ? window.t('tenant_dashboard.card.security_defaults_on') : window.t('tenant_dashboard.card.security_defaults_off'), '',
        isOn ? 'var(--status-healthy)' : 'var(--status-broken)');
    }

    // MFA
    const mfa = sec.mfa_status;
    if (mfa && mfa.total_users > 0) {
      const mfaColor = mfa.registration_percentage >= 90 ? 'var(--status-healthy)' : mfa.registration_percentage >= 70 ? 'var(--status-degraded)' : 'var(--status-broken)';
      cards += statCard(window.t('tenant_dashboard.card.mfa_registered'), fmtPct(mfa.registration_percentage) + '%',
        window.t('tenant_dashboard.card.mfa_not_registered', { count: mfa.mfa_not_registered }), mfaColor);
    }

    // Entra Connect
    const ec = entra.entra_connect;
    if (ec) {
      const syncOn = ec.onPremisesSyncEnabled === true;
      const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
      const lastSync = ec.onPremisesLastSyncDateTime ? new Date(ec.onPremisesLastSyncDateTime).toLocaleString(_dateLocale) : '';
      cards += statCard(window.t('tenant_dashboard.card.entra_connect'), syncOn ? window.t('tenant_dashboard.card.entra_connect_active') : window.t('tenant_dashboard.card.entra_connect_inactive'),
        syncOn ? lastSync : '', syncOn ? 'var(--status-healthy)' : 'var(--p-text-muted)');
    }

    // Devices — single "Compliant Devices" card driven off Intune managed
    // devices (the only source where Microsoft actually evaluates
    // compliance). The previous two cards (Entra device count + Entra
    // managed ratio) caused MSP confusion: Entra devices and Intune-managed
    // devices are different populations, and showing both totals next to a
    // "X of Y compliant" subtitle from Entra (which counts isCompliant!=null,
    // not actual policy state) produced apparently-contradictory numbers.
    // Now: one card, percentage of evaluable Intune devices that are
    // compliant, with a trend arrow vs. the previous poll.
    const ic = entra.intune_compliance;
    const dc = entra.device_counts; // kept for the "Devices by OS" panel below
    if (ic && ic.total > 0) {
      const evaluable = ic.compliant + ic.noncompliant;
      const pct = ic.percentage;
      const pctDisplay = pct == null ? '—' : (pct + '%');
      const color = pct == null
        ? 'var(--p-text-muted)'
        : pct >= 90 ? 'var(--status-healthy)'
        : pct >= 70 ? 'var(--status-degraded)'
        : 'var(--status-broken)';
      let subtitle = window.t('tenant_dashboard.card.compliant_subtitle', { compliant: ic.compliant, evaluated: evaluable });
      if (ic.notEvaluated > 0) {
        subtitle += window.t('tenant_dashboard.card.not_evaluated_suffix', { count: ic.notEvaluated });
      }
      // Trend arrow: ▲ if percentage rose since last poll, ▼ if it fell,
      // — if unchanged or no prior data point. Color matches direction
      // (green for improvement, red for regression).
      let trendHtml = '';
      if (ic.trend === 'up' || ic.trend === 'down') {
        const delta = (pct != null && ic.previous_percentage != null) ? (pct - ic.previous_percentage) : null;
        const sign = ic.trend === 'up' ? '▲' : '▼';
        const cls = ic.trend === 'up' ? 'td-trend-up' : 'td-trend-down';
        const deltaTxt = delta == null ? '' : ` ${delta > 0 ? '+' : ''}${delta}%`;
        const title = window.t('tenant_dashboard.card.trend_vs_previous_poll');
        trendHtml = ` <span class="td-trend ${cls}" title="${esc(title)}">${sign}${esc(deltaTxt)}</span>`;
      }
      cards += statCard(
        window.t('tenant_dashboard.card.compliant_devices'),
        pctDisplay + trendHtml,
        subtitle,
        color
      );
    } else if (dc && dc.total > 0) {
      // Tenant has Entra devices but no Intune license / no Intune
      // managed devices. Fall back to a plain device count so the card
      // doesn't disappear entirely.
      cards += statCard(
        window.t('tenant_dashboard.card.devices'),
        dc.total,
        window.t('tenant_dashboard.card.no_intune_data'),
        'var(--p-text-muted)'
      );
    }

    // SharePoint
    const spc = sp.sharepoint_counts;
    if (spc) {
      cards += statCard(window.t('tenant_dashboard.card.sp_sites'), spc.total_sites, window.t('tenant_dashboard.card.sp_sites_subtitle', { gb: spc.total_storage_gb, files: fmtNum(spc.total_files) }));
      if (spc.total_anonymous_links > 0) {
        cards += statCard(window.t('tenant_dashboard.card.anon_links'), spc.total_anonymous_links,
          window.t('tenant_dashboard.card.sites_count', { count: spc.sites_with_anonymous_links }), 'var(--status-broken)');
      }
    }

    // OneDrive
    const odc = od.onedrive_counts;
    if (odc) {
      cards += statCard(window.t('tenant_dashboard.card.onedrive'), odc.total_accounts, window.t('tenant_dashboard.card.onedrive_subtitle', { gb: odc.total_storage_gb, files: fmtNum(odc.total_files) }));
    }

    // Exchange
    const mc = exch.mailbox_counts;
    if (mc) {
      cards += statCard(window.t('tenant_dashboard.card.mailboxes'), mc.total, window.t('tenant_dashboard.card.gb_total', { gb: mc.total_storage_gb }));
    }

    // Mail Activity totals
    const mailAct = exch.mail_activity;
    if (mailAct && mailAct.length > 0) {
      const totals = mailAct.reduce((a, r) => { a.send += r.send; a.receive += r.receive; return a; }, { send: 0, receive: 0 });
      cards += statCard(window.t('tenant_dashboard.card.mail_7d'), window.t('tenant_dashboard.card.mail_value', { sent: fmtNum(totals.send), received: fmtNum(totals.receive) }), window.t('tenant_dashboard.card.mail_sent_received'));
    }

    // Teams
    const tc = teams.teams_counts;
    if (tc) {
      cards += statCard(window.t('tenant_dashboard.card.teams'), tc.total, window.t('tenant_dashboard.card.teams_subtitle', { pub: tc.public, pri: tc.private }));
    }

    // Inbox Rules — forwarding subset (stat card kept for backward-compat)
    const mf = exch.mail_forwarding;
    if (mf && mf.rules && mf.rules.length > 0) {
      const ext = (mf.externalRules || []).length;
      cards += statCard(window.t('tenant_dashboard.card.forwarding_rules'), mf.rules.length,
        ext > 0 ? window.t('tenant_dashboard.card.forwarding_external', { ext: ext }) : window.t('tenant_dashboard.card.forwarding_all_internal'),
        ext > 0 ? 'var(--status-broken)' : 'var(--status-healthy)');
    }
    // NEW (Apr 2026): total inbox rules across the tenant — makes it obvious
    // that the "Forwarding Rules" card is a strict subset, not the whole picture.
    if (mf && Array.isArray(mf.allRules) && mf.allRules.length > 0) {
      const totalRules = mf.allRules.length;
      const usersWithRules = new Set(mf.allRules.map(r => r.userPrincipalName || r.user)).size;
      const failedCount = (mf.failedUsers || []).length;
      const sub = failedCount > 0
        ? window.t('tenant_dashboard.card.inbox_rules_users_failed', { users: usersWithRules, failed: failedCount })
        : window.t('tenant_dashboard.card.inbox_rules_users', { count: usersWithRules });
      cards += statCard(window.t('tenant_dashboard.card.inbox_rules_all'), totalRules, sub,
        failedCount > 0 ? 'var(--status-degraded)' : '');
    }

    // Risky Users
    const rc = sec.risky_user_counts;
    if (rc && rc.total > 0) {
      cards += statCard(window.t('tenant_dashboard.card.risky_users'), rc.total,
        window.t('tenant_dashboard.card.risky_users_subtitle', { high: rc.high, medium: rc.medium }), 'var(--status-broken)');
    }

    // Inactive Users
    const iu = entra.inactive_users;
    if (iu) {
      const intCount = (iu.internalInactive || []).length;
      const extCount = (iu.externalInactive || []).length;
      if (intCount + extCount > 0) {
        cards += statCard(window.t('tenant_dashboard.card.inactive_90d'), intCount + extCount,
          window.t('tenant_dashboard.card.inactive_90d_subtitle', { int: intCount, ext: extCount }),
          intCount > 0 ? 'var(--status-degraded)' : '');
      }
    }

    // Inactive Devices
    const id_ = entra.inactive_devices;
    if (id_ && (id_.inactive || []).length > 0) {
      cards += statCard(window.t('tenant_dashboard.card.stale_devices'), id_.inactive.length, window.t('tenant_dashboard.card.stale_devices_subtitle'), 'var(--status-degraded)');
    }

    // Apps
    const regApps = entra.registered_apps;
    if (regApps && regApps.length > 0) {
      cards += statCard(window.t('tenant_dashboard.card.registered_apps'), regApps.length, '');
    }
    const entApps = entra.enterprise_apps;
    if (entApps && entApps.length > 0) {
      cards += statCard(window.t('tenant_dashboard.card.enterprise_apps'), entApps.length, window.t('tenant_dashboard.card.enterprise_apps_subtitle'));
    }

    // Domains
    const domains = sp.domains;
    if (domains && domains.length > 0) {
      const defDomain = domains.find(d => d.isDefault);
      let domainSub = window.t('tenant_dashboard.card.domains_count', { count: domains.length });
      if (defDomain && defDomain.dnsVerification) {
        const dns = defDomain.dnsVerification;
        const allOk = [dns.mx.status, dns.spf.status, dns.autodiscover.status].every(s => s === 'OK');
        domainSub = allOk ? window.t('tenant_dashboard.card.domains_dns_ok') : window.t('tenant_dashboard.card.domains_dns_issues');
      }
      cards += statCard(window.t('tenant_dashboard.card.domains'), domains.length, domainSub);
    }


    // ─── ZONE 2: COLLAPSIBLE LIST PANELS ───

    // Licensing details
    const licenses = entra.licenses;
    if (licenses && licenses.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.licensing'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.license_details'), licenses.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.license')}</th><th>${window.t('tenant_dashboard.col.status')}</th><th>${window.t('tenant_dashboard.col.assigned')}</th><th>${window.t('tenant_dashboard.col.total')}</th><th>${window.t('tenant_dashboard.col.available')}</th></tr></thead><tbody>`;
        licenses.forEach(l => {
          const cls = l.available <= 0 ? 'severity-high' : '';
          t += `<tr><td>${esc(l.displayName)}</td><td>${esc(l.status)}</td><td>${l.assigned}</td><td>${l.total}</td><td class="${cls}">${l.available}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
      if (entra.unlicensedUsers && entra.unlicensedUsers.length > 0) {
        panels += collapsePanel(window.t('tenant_dashboard.panel.unlicensed_users'), entra.unlicensedUsers.length, () => {
          let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th><th>${window.t('tenant_dashboard.col.enabled')}</th></tr></thead><tbody>`;
          entra.unlicensedUsers.forEach(u => {
            t += `<tr><td>${esc(u.displayName)}</td><td class="mono" style="font-size:0.75rem;">${esc(u.userPrincipalName)}</td><td>${u.enabled ? '✓' : '✗'}</td></tr>`;
          });
          return t + '</tbody></table>';
        });
      }
    }

    // Global Admins list
    if (ga && ga.admins && ga.admins.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.global_administrators'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.admin_list'), ga.count, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th><th>${window.t('tenant_dashboard.col.enabled')}</th><th>${window.t('tenant_dashboard.col.licensed')}</th></tr></thead><tbody>`;
        ga.admins.forEach(a => {
          t += `<tr><td>${esc(a.displayName)}</td><td class="mono" style="font-size:0.75rem;">${esc(a.userPrincipalName)}</td><td>${a.enabled ? '✓' : '✗'}</td><td>${a.licensed ? '✓' : '✗'}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Conditional Access details
    if (Array.isArray(ca) && ca.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.conditional_access_policies'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.policy_details'), ca.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.policy')}</th><th>${window.t('tenant_dashboard.col.state')}</th><th>${window.t('tenant_dashboard.col.conditions')}</th><th>${window.t('tenant_dashboard.col.controls')}</th></tr></thead><tbody>`;
        ca.forEach(p => {
          const stCls = p.state === 'enabled' ? 'score-green' : p.state === 'disabled' ? 'severity-high' : 'severity-medium';
          t += `<tr><td>${esc(p.name)}</td><td class="${stCls}">${esc(p.state)}</td><td style="font-size:0.75rem;">${esc(p.conditions)}</td><td style="font-size:0.75rem;">${esc(p.controls)}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // MFA not registered
    const notReg = sec.mfa_not_registered_users;
    if (notReg && notReg.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.mfa_registration'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.users_without_mfa'), notReg.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th></tr></thead><tbody>`;
        notReg.forEach(u => { t += `<tr><td>${esc(u.name)}</td><td class="mono" style="font-size:0.75rem;">${esc(u.upn)}</td></tr>`; });
        return t + '</tbody></table>';
      });
    }

    // Configured Domains + DNS
    if (domains && domains.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.configured_domains'));
      domains.forEach(d => {
        const defBadge = d.isDefault ? ' <span style="color:var(--p-highlight); font-size:0.65rem; font-weight:600;">' + window.t('tenant_dashboard.dns_label.default') + '</span>' : '';
        let headerExtra = '';
        if (d.isDefault && d.dnsVerification) {
          const dns = d.dnsVerification;
          headerExtra = '  ' + dnsBadge(window.t('tenant_dashboard.dns_label.mx'), dns.mx.status) + ' ' + dnsBadge(window.t('tenant_dashboard.dns_label.spf'), dns.spf.status) + ' ' +
            dnsBadge(window.t('tenant_dashboard.dns_label.dmarc'), dns.dmarc.status) + ' ' + dnsBadge(window.t('tenant_dashboard.dns_label.autodiscover'), dns.autodiscover.status);
          if (dns.dmarc.policy) headerExtra += ` <span style="font-size:0.65rem; color:var(--p-text-muted);">p=${dns.dmarc.policy}</span>`;
        }

        if (d.dnsRecordStatus && d.dnsRecordStatus.length > 0) {
          panels += collapsePanel(window.t('tenant_dashboard.panel.dns_records', { name: d.name }) + defBadge + headerExtra, d.dnsRecordStatus.length, () => {
            let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.type')}</th><th>${window.t('tenant_dashboard.col.service')}</th><th>${window.t('tenant_dashboard.col.expected')}</th><th>${window.t('tenant_dashboard.col.status')}</th></tr></thead><tbody>`;
            d.dnsRecordStatus.forEach(r => {
              const sCls = r.status === 'OK' ? 'score-green' : r.status === 'Missing' ? 'severity-high' : 'severity-medium';
              t += `<tr><td>${esc(r.type)}</td><td>${esc(r.service)}</td><td style="font-size:0.7rem; max-width:300px; overflow:hidden; text-overflow:ellipsis;">${esc(r.expectedValue)}</td><td class="${sCls}">${esc(r.status)}</td></tr>`;
            });
            return t + '</tbody></table>';
          });
        }
      });
    }

    // Devices: by OS, Intune
    if (dc) {
      panels += listSection(window.t('tenant_dashboard.section.devices'));
      if (dc.by_os && Object.keys(dc.by_os).length > 0) {
        panels += collapsePanel(window.t('tenant_dashboard.panel.devices_by_os'), Object.keys(dc.by_os).length, () => {
          let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.operating_system')}</th><th>${window.t('tenant_dashboard.col.count')}</th></tr></thead><tbody>`;
          Object.entries(dc.by_os).sort((a, b) => b[1] - a[1]).forEach(([os, count]) => {
            t += `<tr><td>${esc(os)}</td><td>${count}</td></tr>`;
          });
          return t + '</tbody></table>';
        });
      }
      const intune = entra.intune_devices;
      if (intune && intune.length > 0) {
        panels += collapsePanel(window.t('tenant_dashboard.panel.intune_managed_devices'), intune.length, () => {
          // Render ALL rows — operators were getting confused when the
          // visible count (capped at 30) didn't match the badge count.
          // Height is constrained by .td-intune-scroll CSS so a tenant
          // with 200+ devices doesn't make the dashboard scroll forever.
          let t = `<div class="td-intune-scroll"><table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.device')}</th><th>${window.t('tenant_dashboard.col.os')}</th><th>${window.t('tenant_dashboard.col.compliance')}</th><th>${window.t('tenant_dashboard.col.user')}</th><th>${window.t('tenant_dashboard.col.last_sync')}</th></tr></thead><tbody>`;
          const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
          const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
          intune.forEach(d => {
            // Display the 3-bucket label (Compliant / Non compliant /
            // Not evaluated), not the raw Graph complianceState string.
            // complianceBucket is set in fetchers.js; fall back for any
            // historical row written before this rolled out.
            const bucket = d.complianceBucket || bucketComplianceStateClient(d.complianceState);
            const cCls = bucket === 'compliant' ? 'score-green'
              : bucket === 'noncompliant' ? 'severity-high'
              : 'td-compliance-not-eval';
            const label = bucket === 'compliant' ? window.t('tenant_dashboard.compliance.compliant')
              : bucket === 'noncompliant' ? window.t('tenant_dashboard.compliance.noncompliant')
              : window.t('tenant_dashboard.compliance.not_evaluated');
            const lastSync = d.lastSync ? new Date(d.lastSync).toLocaleDateString(_dateLocale) : '—';
            t += `<tr><td>${esc(d.deviceName)}</td><td>${esc(d.os)}</td><td class="${cCls}">${esc(label)}</td><td>${esc(d.user || '—')}</td><td>${lastSync}</td></tr>`;
          });
          return t + '</tbody></table></div>';
        });
      }
    }

    // SharePoint site details
    const spSites = sp.sharepoint_sites;
    if (spSites && spSites.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.sharepoint'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.site_details'), spSites.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.site')}</th><th>${window.t('tenant_dashboard.col.files')}</th><th>${window.t('tenant_dashboard.col.storage')}</th><th>${window.t('tenant_dashboard.col.views')}</th><th>${window.t('tenant_dashboard.col.last_active')}</th></tr></thead><tbody>`;
        spSites.slice(0, 20).forEach(s => {
          const gb = (s.storageUsedBytes / (1024 * 1024 * 1024)).toFixed(2);
          t += `<tr><td title="${esc(s.siteUrl)}">${esc(s.siteName)}</td><td>${fmtNum(s.fileCount)}</td><td>${gb} GB</td><td>${fmtNum(s.pageViewCount)}</td><td>${s.lastActivityDate || '—'}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Anonymous Links
    const anonLinks = sp.anonymous_links || [];
    if (anonLinks.length > 0) {
      panels += collapsePanel(window.t('tenant_dashboard.panel.anonymous_sharing_links'), window.t('tenant_dashboard.card.sites_count', { count: anonLinks.length }), () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.site')}</th><th>${window.t('tenant_dashboard.col.anonymous_links')}</th><th>${window.t('tenant_dashboard.col.company_links')}</th></tr></thead><tbody>`;
        anonLinks.sort((a, b) => b.anonymousLinkCount - a.anonymousLinkCount).forEach(s => {
          t += `<tr><td>${esc(s.siteName)}</td><td class="severity-high">${fmtNum(s.anonymousLinkCount)}</td><td>${fmtNum(s.companyLinkCount)}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // OneDrive top users
    const odSites = od.onedrive_sites;
    if (odSites && odSites.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.onedrive'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.top_users_by_storage'), Math.min(odSites.length, 10), () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.owner')}</th><th>${window.t('tenant_dashboard.col.files')}</th><th>${window.t('tenant_dashboard.col.storage')}</th><th>${window.t('tenant_dashboard.col.last_active')}</th></tr></thead><tbody>`;
        odSites.slice(0, 10).forEach(s => {
          const mb = (s.storageUsedBytes / (1024 * 1024)).toFixed(1);
          t += `<tr><td>${esc(s.siteName)}</td><td>${fmtNum(s.fileCount)}</td><td>${mb} MB</td><td>${s.lastActivityDate || '—'}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Mailbox top 5
    const mboxUsage = exch.mailbox_usage;
    if (mboxUsage && mboxUsage.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.exchange'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.top_mailboxes_by_storage'), Math.min(mboxUsage.length, 5), () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.user')}</th><th>${window.t('tenant_dashboard.col.items')}</th><th>${window.t('tenant_dashboard.col.storage')}</th><th>${window.t('tenant_dashboard.col.last_active')}</th></tr></thead><tbody>`;
        mboxUsage.slice(0, 5).forEach(m => {
          const mb = (m.storageUsedBytes / (1024 * 1024)).toFixed(1);
          t += `<tr><td>${esc(m.displayName || m.upn)}</td><td>${fmtNum(m.itemCount)}</td><td>${mb} MB</td><td>${m.lastActivity || '—'}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Mail activity daily
    if (mailAct && mailAct.length > 0) {
      panels += collapsePanel(window.t('tenant_dashboard.panel.mail_activity_daily'), window.t('tenant_dashboard.panel.mail_activity_days', { count: mailAct.length }), () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.date')}</th><th>${window.t('tenant_dashboard.col.sent')}</th><th>${window.t('tenant_dashboard.col.received')}</th><th>${window.t('tenant_dashboard.col.read')}</th></tr></thead><tbody>`;
        mailAct.forEach(a => {
          t += `<tr><td>${a.date || '—'}</td><td>${fmtNum(a.send)}</td><td>${fmtNum(a.receive)}</td><td>${fmtNum(a.read)}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Inbox Rules — forwarding subset + full inventory (Apr 2026 rework)
    // Renamed from "Mail Forwarding" because the old panel only showed rules
    // with forwardTo/redirectTo actions, misleading operators into thinking
    // the tenant had no other inbox rules. Now split into two collapsible
    // sub-panels under a single "Inbox Rules" section.
    const hasForwarding = mf && Array.isArray(mf.rules) && mf.rules.length > 0;
    const hasAllRules = mf && Array.isArray(mf.allRules) && mf.allRules.length > 0;
    const failedUsers = (mf && Array.isArray(mf.failedUsers)) ? mf.failedUsers : [];
    const skippedNoMbx = (mf && typeof mf.usersSkippedNoMailbox === 'number') ? mf.usersSkippedNoMailbox : 0;

    if (hasForwarding || hasAllRules || failedUsers.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.inbox_rules'));

      // Coverage warning — surface real per-user fetch failures so operators know
      // the inbox-rule data set is incomplete for this poll cycle.
      if (failedUsers.length > 0) {
        const userList = failedUsers.slice(0, 5).map(f => esc(f.userPrincipalName || f.displayName || '?')).join(', ');
        const more = failedUsers.length > 5 ? window.t('tenant_dashboard.inbox_rules.more_users', { count: failedUsers.length - 5 }) : '';
        const usersWord = window.t('tenant_dashboard.inbox_rules.users_word', { count: failedUsers.length });
        panels += `<div class="td-inbox-warn" style="margin:6px 0 10px; padding:8px 12px; border-left:3px solid var(--status-degraded); background:rgba(255,170,0,0.06); color:var(--status-degraded); font-size:0.82rem;">
          ${window.t('tenant_dashboard.inbox_rules.fetch_warning', { count: failedUsers.length, users_word: usersWord, list: userList + more })}
        </div>`;
      }

      // Forwarding-only subset — rules that forward, redirect, or forward-as-attachment.
      // Kept intact to preserve the original stat card / operator expectations.
      if (hasForwarding) {
        panels += collapsePanel(window.t('tenant_dashboard.panel.forwarding_rules'), mf.rules.length, () => {
          let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.user')}</th><th>${window.t('tenant_dashboard.col.rule')}</th><th>${window.t('tenant_dashboard.col.target')}</th><th>${window.t('tenant_dashboard.col.type')}</th></tr></thead><tbody>`;
          mf.rules.slice(0, 20).forEach(r => {
            const typeCls = r.isExternal ? 'severity-high' : '';
            t += `<tr><td>${esc(r.user)}</td><td>${esc(r.ruleName)}</td><td class="mono" style="font-size:0.7rem;">${esc(r.targets.join(', '))}</td><td class="${typeCls}">${r.isExternal ? window.t('tenant_dashboard.inbox_rules.badge_external') : window.t('tenant_dashboard.inbox_rules.badge_internal')}</td></tr>`;
          });
          if (mf.rules.length > 20) t += `<tr><td colspan="4" style="text-align:center; color:var(--p-text-muted);">${window.t('tenant_dashboard.more_rows', { count: mf.rules.length - 20 })}</td></tr>`;
          return t + '</tbody></table>';
        });
      }

      // ALL enabled inbox rules, grouped by user. Includes move-to-folder,
      // mark-as-read, categorize, delete, etc. Backed by mf.allRules which the
      // alert engine already uses for snapshot-delta "Inbox rule created"
      // detection — so if you got an alert but see nothing in Forwarding Rules,
      // this is where to look.
      if (hasAllRules) {
        const footerBits = [];
        if (typeof mf.usersChecked === 'number') footerBits.push(window.t('tenant_dashboard.inbox_rules.users_checked', { count: mf.usersChecked }));
        if (skippedNoMbx > 0) footerBits.push(window.t('tenant_dashboard.inbox_rules.users_no_mailbox', { count: skippedNoMbx }));
        const footer = footerBits.length > 0 ? `<div style="margin-top:6px; font-size:0.72rem; color:var(--p-text-muted);">${footerBits.join(' · ')}</div>` : '';

        panels += collapsePanel(window.t('tenant_dashboard.panel.all_inbox_rules'), mf.allRules.length, () => {
          // Group by UPN
          const byUser = {};
          mf.allRules.forEach(r => {
            const key = r.userPrincipalName || r.user || 'unknown';
            if (!byUser[key]) byUser[key] = { user: r.user || key, upn: key, rules: [] };
            byUser[key].rules.push(r);
          });
          const userRows = Object.values(byUser)
            .sort((a, b) => (a.user || '').localeCompare(b.user || ''));

          const MAX_ROWS = 500;
          let rowCount = 0;
          let truncated = 0;

          let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.user')}</th><th>${window.t('tenant_dashboard.col.rule')}</th><th>${window.t('tenant_dashboard.col.actions')}</th></tr></thead><tbody>`;

          for (const ur of userRows) {
            for (let idx = 0; idx < ur.rules.length; idx++) {
              if (rowCount >= MAX_ROWS) { truncated++; continue; }
              const r = ur.rules[idx];
              const a = r.actions || {};

              // Summarize rule actions in a compact, operator-readable form.
              // Flag permanentDelete and external forwards as high-severity.
              const parts = [];
              if (r.hasForwardingAction) {
                const label = r.isExternal ? '<span class="severity-high">' + window.t('tenant_dashboard.inbox_action.forward_external') + '</span>' : window.t('tenant_dashboard.inbox_action.forward');
                parts.push(`${label} ${esc(r.targets.join(', '))}`);
              }
              if (a.redirectTo && (a.redirectTo || []).length > 0 && !r.hasForwardingAction) {
                parts.push(window.t('tenant_dashboard.inbox_action.redirect'));
              }
              if (a.moveToFolder) parts.push(window.t('tenant_dashboard.inbox_action.move_to_folder'));
              if (a.copyToFolder) parts.push(window.t('tenant_dashboard.inbox_action.copy_to_folder'));
              if (a.delete) parts.push(window.t('tenant_dashboard.inbox_action.delete'));
              if (a.permanentDelete) parts.push('<span class="severity-high">' + window.t('tenant_dashboard.inbox_action.permanent_delete') + '</span>');
              if (a.markAsRead) parts.push(window.t('tenant_dashboard.inbox_action.mark_read'));
              if (a.markImportance) parts.push(window.t('tenant_dashboard.inbox_action.importance', { value: esc(a.markImportance) }));
              if (a.assignCategories && a.assignCategories.length > 0) parts.push(window.t('tenant_dashboard.inbox_action.categorize', { list: esc(a.assignCategories.join(', ')) }));
              if (a.stopProcessingRules) parts.push(window.t('tenant_dashboard.inbox_action.stop_processing'));
              const actionSummary = parts.length > 0 ? parts.join(' · ') : '<span style="color:var(--p-text-muted);">' + window.t('tenant_dashboard.inbox_action.no_visible_actions') + '</span>';

              // Only render user name on the first row of that user's group
              const userCell = idx === 0
                ? `<strong>${esc(ur.user)}</strong><br><span class="mono" style="font-size:0.65rem; color:var(--p-text-muted);">${esc(ur.upn)}</span>`
                : '';

              t += `<tr><td>${userCell}</td><td>${esc(r.ruleName || window.t('tenant_dashboard.inbox_rules.rule_unnamed'))}</td><td style="font-size:0.78rem;">${actionSummary}</td></tr>`;
              rowCount++;
            }
          }

          if (truncated > 0) {
            t += `<tr><td colspan="3" style="text-align:center; color:var(--p-text-muted);">${window.t('tenant_dashboard.inbox_rules.more_rules', { count: truncated, max: MAX_ROWS })}</td></tr>`;
          }
          return t + '</tbody></table>' + footer;
        });
      }
    }

    // Teams list
    const teamsList = teams.teams_list;
    if (teamsList && teamsList.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.teams'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.all_teams'), teamsList.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.visibility')}</th><th>${window.t('tenant_dashboard.col.created')}</th></tr></thead><tbody>`;
        const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
        const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
        teamsList.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(tm => {
          const created = tm.created ? new Date(tm.created).toLocaleDateString(_dateLocale) : '—';
          const cls = tm.visibility === 'Public' ? 'score-green' : 'score-yellow';
          t += `<tr><td>${esc(tm.name)}</td><td class="${cls}">${esc(tm.visibility || '—')}</td><td>${created}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // Registered Apps
    if (regApps && regApps.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.applications'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.registered_applications'), regApps.length, () => {
        // Render ALL rows inside a height-capped scroll wrapper (Feature 8.9
        // Part A) — a truncated inventory that looks complete is worse than
        // none. Matches the Intune managed-devices panel pattern.
        let t = `<div class="td-intune-scroll"><table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.audience')}</th><th>${window.t('tenant_dashboard.col.created')}</th></tr></thead><tbody>`;
        const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
        const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
        regApps.forEach(a => {
          const created = a.created ? new Date(a.created).toLocaleDateString(_dateLocale) : '—';
          t += `<tr><td>${esc(a.displayName)}</td><td style="font-size:0.75rem;">${esc(a.signInAudience || '—')}</td><td>${created}</td></tr>`;
        });
        return t + '</tbody></table></div>';
      });
    }

    // Enterprise Apps
    if (entApps && entApps.length > 0) {
      panels += collapsePanel(window.t('tenant_dashboard.panel.enterprise_apps_third_party'), entApps.length, () => {
        // Render ALL rows inside a height-capped scroll wrapper (Feature 8.9
        // Part A) — no silent 30-row truncation on a security inventory.
        let t = `<div class="td-intune-scroll"><table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.publisher')}</th><th>${window.t('tenant_dashboard.col.enabled')}</th><th>${window.t('tenant_dashboard.col.created')}</th></tr></thead><tbody>`;
        const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
        const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
        entApps.forEach(a => {
          const created = a.created ? new Date(a.created).toLocaleDateString(_dateLocale) : '—';
          t += `<tr><td>${esc(a.displayName)}</td><td style="font-size:0.75rem;">${esc(a.publisher || '—')}</td><td>${a.enabled ? '✓' : '✗'}</td><td>${created}</td></tr>`;
        });
        return t + '</tbody></table></div>';
      });
    }

    // Inactive Users
    if (iu) {
      const intInact = iu.internalInactive || [];
      const extInact = iu.externalInactive || [];
      const intUnavail = iu.internalDataUnavailable || 0;
      const extUnavail = iu.externalDataUnavailable || 0;
      if (intInact.length + extInact.length + intUnavail + extUnavail > 0) {
        panels += listSection(window.t('tenant_dashboard.section.inactive_accounts_90d'));
        const _baseNote = window.t('tenant_dashboard.inactive_signin_note');
        const _footerStyle = 'margin-top:8px; padding:6px 0 2px 2px; font-size:0.7rem; color:var(--p-text-muted); font-style:italic;';
        const _inlineNoteStyle = 'margin:6px 0 4px 0; padding:8px 12px; color:var(--p-text-muted); font-style:italic; font-size:0.75rem; background:rgba(0,0,0,0.02); border-left:2px solid rgba(51,68,119,0.25); border-radius:0 4px 4px 0;';

        // Internal users panel
        if (intInact.length > 0) {
          panels += collapsePanel(window.t('tenant_dashboard.panel.inactive_internal_users'), intInact.length, () => {
            let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th><th>${window.t('tenant_dashboard.col.last_signin')}</th><th>${window.t('tenant_dashboard.col.licensed')}</th></tr></thead><tbody>`;
            const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
            const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
            const _never = window.t('common.never');
            intInact.slice(0, 25).forEach(u => {
              const last = u.lastSignIn === 'Never' ? _never : (u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString(_dateLocale) : '—');
              t += `<tr><td>${esc(u.displayName)}</td><td class="mono" style="font-size:0.7rem;">${esc(u.userPrincipalName)}</td><td>${last}</td><td>${u.licensed ? '✓' : '✗'}</td></tr>`;
            });
            if (intInact.length > 25) t += `<tr><td colspan="4" style="text-align:center; color:var(--p-text-muted);">${window.t('tenant_dashboard.more_rows', { count: intInact.length - 25 })}</td></tr>`;
            const unavailAddendum = intUnavail > 0 ? ' ' + window.t('tenant_dashboard.inactive_signin_unavailable_note', { count: intUnavail }) : '';
            return t + '</tbody></table>' + `<div style="${_footerStyle}">${_baseNote}${unavailAddendum}</div>`;
          });
        } else if (intUnavail > 0) {
          // No verifiable inactive internal users, but some could not be evaluated.
          // Render an inline note instead of a collapse panel with a zero badge.
          const unavailNote = window.t('tenant_dashboard.inactive_signin_unavailable_note', { count: intUnavail });
          panels += `<div style="${_inlineNoteStyle}">${_baseNote} ${unavailNote}</div>`;
        }

        // Guest users panel
        if (extInact.length > 0) {
          panels += collapsePanel(window.t('tenant_dashboard.panel.inactive_guest_users'), extInact.length, () => {
            let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th><th>${window.t('tenant_dashboard.col.last_signin')}</th></tr></thead><tbody>`;
            const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
            const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
            const _never = window.t('common.never');
            extInact.slice(0, 25).forEach(u => {
              const last = u.lastSignIn === 'Never' ? _never : (u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString(_dateLocale) : '—');
              t += `<tr><td>${esc(u.displayName)}</td><td class="mono" style="font-size:0.7rem;">${esc(u.userPrincipalName)}</td><td>${last}</td></tr>`;
            });
            const unavailAddendum = extUnavail > 0 ? ' ' + window.t('tenant_dashboard.inactive_signin_unavailable_note', { count: extUnavail }) : '';
            return t + '</tbody></table>' + `<div style="${_footerStyle}">${_baseNote}${unavailAddendum}</div>`;
          });
        } else if (extUnavail > 0) {
          // No verifiable inactive guests, but some could not be evaluated → inline note.
          // If an internal inline note was also rendered, the base P1 explanation appears twice;
          // accepted as the count differs (internal vs guest) and the redundancy is minor.
          const unavailNote = window.t('tenant_dashboard.inactive_signin_unavailable_note', { count: extUnavail });
          panels += `<div style="${_inlineNoteStyle}">${_baseNote} ${unavailNote}</div>`;
        }
      }
    }

    // Inactive Devices
    if (id_ && (id_.inactive || []).length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.stale_devices_90d'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.inactive_device_list'), id_.inactive.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.device')}</th><th>${window.t('tenant_dashboard.col.os')}</th><th>${window.t('tenant_dashboard.col.last_activity')}</th><th>${window.t('tenant_dashboard.col.trust_type')}</th></tr></thead><tbody>`;
        const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
        const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
        const _never = window.t('common.never');
        id_.inactive.slice(0, 25).forEach(d => {
          const last = d.lastActivity === 'Never' ? _never : (d.lastActivity ? new Date(d.lastActivity).toLocaleDateString(_dateLocale) : '—');
          t += `<tr><td>${esc(d.displayName)}</td><td>${esc(d.os || '—')}</td><td>${last}</td><td>${esc(d.trustType || '—')}</td></tr>`;
        });
        if (id_.inactive.length > 25) t += `<tr><td colspan="4" style="text-align:center; color:var(--p-text-muted);">${window.t('tenant_dashboard.more_rows', { count: id_.inactive.length - 25 })}</td></tr>`;
        return t + '</tbody></table>';
      });
    }

    // Risky Users
    const ru = sec.risky_users;
    if (ru && ru.length > 0) {
      panels += listSection(window.t('tenant_dashboard.section.risky_users'));
      panels += collapsePanel(window.t('tenant_dashboard.panel.at_risk_user_list'), ru.length, () => {
        let t = `<table class="td-list-table"><thead><tr><th>${window.t('tenant_dashboard.col.name')}</th><th>${window.t('tenant_dashboard.col.upn')}</th><th>${window.t('tenant_dashboard.col.risk_level')}</th><th>${window.t('tenant_dashboard.col.state')}</th></tr></thead><tbody>`;
        ru.forEach(u => {
          const cls = u.riskLevel === 'high' ? 'severity-high' : u.riskLevel === 'medium' ? 'severity-medium' : '';
          t += `<tr><td>${esc(u.name)}</td><td class="mono" style="font-size:0.7rem;">${esc(u.upn)}</td><td class="${cls}">${esc(u.riskLevel)}</td><td>${esc(u.riskState)}</td></tr>`;
        });
        return t + '</tbody></table>';
      });
    }

    // ─── ASSEMBLE ───

    let html = '';

    if (cards) {
      html += '<div class="td-stats-zone">' + cards + '</div>';
    }

    if (!html.trim()) {
      html = '<div class="td-no-data">' + window.t('tenant_dashboard.empty_state_no_data') + '</div>';
    }

    container.innerHTML = html;

    // Render collapsible list panels in separate container (below Ask Claude)
    const listContainer = el('td-list-panels');
    if (listContainer) {
      if (panels) {
        listContainer.innerHTML = '<div class="td-lists-zone">' + panels + '</div>';
        wireCollapseHandlers(listContainer);
      } else {
        listContainer.innerHTML = '';
      }
    }
  }

  // ═══════════════════════════════════════
  // TENANT DIGEST — "What's going on today?"
  // ═══════════════════════════════════════
  //
  // Calls POST /api/ai/tenant-digest/:tenantId which returns a Sonnet-generated
  // 24h narrative. Server-side cache is 15 min; the "Refresh" button passes
  // ?force=1 to bypass it. The cached flag + fromCacheAgeMinutes lets us show
  // the operator whether they're looking at a fresh generation or a cached
  // result, so they can decide if a refresh is warranted.

  let digestBusy = false;

  function wireTenantDigest() {
    const generateBtn = document.getElementById('td-digest-generate');
    const refreshBtn = document.getElementById('td-digest-refresh');
    if (!generateBtn) return;

    generateBtn.addEventListener('click', () => runTenantDigest(false));
    if (refreshBtn) refreshBtn.addEventListener('click', () => runTenantDigest(true));
  }

  async function runTenantDigest(force) {
    if (digestBusy || !tenantId) return;
    digestBusy = true;

    const generateBtn = document.getElementById('td-digest-generate');
    const refreshBtn = document.getElementById('td-digest-refresh');
    const output = document.getElementById('td-digest-output');
    const meta = document.getElementById('td-digest-meta');

    const originalGenerateLabel = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = window.t('tenant_dashboard.digest.thinking');
    if (refreshBtn) refreshBtn.disabled = true;
    if (meta) meta.textContent = window.t('tenant_dashboard.digest.reviewing');

    try {
      // Phase 8d (May 2, 2026): pass operator's current language; server
      // generates the digest in that locale. Cache key on the server is
      // (tenantId, lang) so different operators in different languages
      // don't collide.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const params = new URLSearchParams();
      if (force) params.set('force', '1');
      params.set('lang', lang);
      const path = `/api/ai/tenant-digest/${encodeURIComponent(tenantId)}?${params.toString()}`;
      const data = await Panoptica.api(path, { method: 'POST' });

      const noContent = window.t('tenant_dashboard.digest.no_content');
      output.style.display = 'block';
      output.innerHTML = Panoptica.mdToHtml
        ? Panoptica.mdToHtml(data.content || noContent)
        : esc(data.content || noContent).replace(/\n/g, '<br>');

      if (meta) {
        const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
        const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
        const stamp = data.generatedAt ? new Date(data.generatedAt).toLocaleString(_dateLocale, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        }) : '';
        if (data.cached) {
          const ageStr = data.fromCacheAgeMinutes != null
            ? ' (' + window.t('tenant_dashboard.digest.age_min', { count: data.fromCacheAgeMinutes }) + ')'
            : '';
          meta.textContent = window.t('tenant_dashboard.digest.cached', { stamp, age: ageStr });
        } else {
          meta.textContent = window.t('tenant_dashboard.digest.fresh', { stamp });
        }
      }

      if (refreshBtn) refreshBtn.style.display = '';
    } catch (err) {
      output.style.display = 'block';
      output.innerHTML = '<span style="color:var(--p-danger, #e74c3c);">' + esc(window.t('tenant_dashboard.digest.failed_inline', { message: err.message || window.t('tenant_dashboard.toast_unknown_error') })) + '</span>';
      if (meta) meta.textContent = '';
    } finally {
      digestBusy = false;
      generateBtn.disabled = false;
      generateBtn.textContent = originalGenerateLabel;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════
  // ASK CLAUDE — PER-TENANT CHAT
  // ═══════════════════════════════════════

  function wireTenantChat() {
    const input = document.getElementById('td-chat-input');
    const btn = document.getElementById('td-chat-send');
    const newBtn = document.getElementById('td-chat-new');
    if (!input || !btn) return;

    btn.addEventListener('click', () => sendTenantChat());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTenantChat();
      }
    });
    if (newBtn) newBtn.addEventListener('click', () => resetTenantChat());
  }

  async function sendTenantChat() {
    if (chatBusy || !tenantId) return;

    const input = document.getElementById('td-chat-input');
    const thread = document.getElementById('td-chat-thread');
    const newBtn = document.getElementById('td-chat-new');
    const question = input.value.trim();
    if (!question) return;

    chatBusy = true;
    const btn = document.getElementById('td-chat-send');
    btn.disabled = true;
    btn.textContent = window.t('tenant_dashboard.chat.btn_busy');

    thread.style.display = 'block';
    appendBubble(thread, 'user', question);
    const thinkingEl = appendBubble(thread, 'thinking', window.t('tenant_dashboard.chat.thinking'));
    input.value = '';

    try {
      // Phase 8d: include operator's current language so Claude responds
      // in their locale. Server prompt threads `lang` into a directive.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const payload = { question, tenantId: parseInt(tenantId, 10), lang };
      if (chatSessionId) payload.sessionId = chatSessionId;

      const data = await Panoptica.api('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      thinkingEl.remove();
      appendBubble(thread, 'assistant', data.answer);
      chatSessionId = data.sessionId;

      if (newBtn) newBtn.style.display = '';

      if (data.expired) {
        chatSessionId = null;
      }
    } catch (err) {
      thinkingEl.remove();
      appendBubble(thread, 'error', err.message || window.t('tenant_dashboard.toast_unknown_error'));
    } finally {
      chatBusy = false;
      btn.disabled = false;
      btn.textContent = window.t('tenant_dashboard.chat.btn_ask');
    }
  }

  function resetTenantChat() {
    const thread = document.getElementById('td-chat-thread');
    const newBtn = document.getElementById('td-chat-new');
    if (thread) { thread.innerHTML = ''; thread.style.display = 'none'; }
    if (newBtn) newBtn.style.display = 'none';
    chatSessionId = null;
  }

  function appendBubble(thread, role, text) {
    const div = document.createElement('div');
    if (role === 'user') {
      div.className = 'chat-bubble chat-bubble-user';
      div.innerHTML = '<span class="chat-bubble-label">' + esc(window.t('tenant_dashboard.chat.role_you')) + '</span>' + esc(text);
    } else if (role === 'assistant') {
      div.className = 'chat-bubble chat-bubble-assistant';
      div.innerHTML = '<span class="chat-bubble-label">' + esc(window.t('tenant_dashboard.chat.role_claude')) + '</span>' + Panoptica.mdToHtml(text);
    } else if (role === 'thinking') {
      div.className = 'chat-bubble chat-bubble-thinking';
      div.innerHTML = '<span class="chat-loading">' + esc(text) + '</span>';
    } else if (role === 'error') {
      div.className = 'chat-bubble chat-bubble-error';
      div.innerHTML = '<span class="chat-error">' + esc(window.t('tenant_dashboard.chat.error_prefix', { text })) + '</span>';
    }
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  /**
   * Compact stat card for zone 1.
   */
  function statCard(title, value, subtitle, accentColor) {
    const colorStyle = accentColor ? ` style="color:${accentColor};"` : '';
    const borderStyle = accentColor ? ` style="border-left-color:${accentColor};"` : '';
    return `<div class="td-stat-card"${borderStyle}>
      <div class="td-stat-title">${esc(title)}</div>
      <div class="td-stat-value"${colorStyle}>${value}</div>
      ${subtitle ? `<div class="td-stat-sub">${subtitle}</div>` : ''}
    </div>`;
  }

  /**
   * Section header for zone 2.
   */
  function listSection(title) {
    return `<div class="td-section-header">${esc(title)}</div>`;
  }

  function collapsePanel(title, badge, bodyFn) {
    const uid = 'cp-' + Math.random().toString(36).substr(2, 6);
    return `
      <div class="td-collapse" data-collapse-id="${uid}">
        <div class="td-collapse-header">
          <span class="td-collapse-chevron">▶</span>
          <span class="td-collapse-title">${title}</span>
          <span class="td-collapse-badge">${badge}</span>
        </div>
        <div class="td-collapse-body">${bodyFn()}</div>
      </div>`;
  }

  function dnsBadge(label, status) {
    const color = status === 'OK' ? 'var(--status-healthy)' : status === 'MISSING' || status === 'ERROR' ? 'var(--status-broken)' : 'var(--status-degraded)';
    return `<span style="display:inline-block; padding:1px 6px; border-radius:3px; font-size:0.6rem; font-weight:600; border:1px solid ${color}; color:${color};">${label}: ${status}</span>`;
  }

  function wireCollapseHandlers(container) {
    container.querySelectorAll('.td-collapse-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.td-collapse').classList.toggle('open');
      });
    });
  }

  function scoreColor(pct) {
    if (pct >= 70) return 'var(--status-healthy)';
    if (pct >= 45) return 'var(--status-degraded)';
    return 'var(--status-broken)';
  }

  function fmtPct(val, digits = 1) { return Number(val).toFixed(digits); }
  function fmtNum(n) {
    if (n == null) return '0';
    const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const _numLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
    return Number(n).toLocaleString(_numLocale);
  }
  function esc(str) { const div = document.createElement('div'); div.textContent = str || ''; return div.innerHTML; }
  function el(id) { return document.getElementById(id); }

  // Backstop for rows polled before the fetcher started writing
  // complianceBucket. Mirrors bucketComplianceState() in src/fetchers.js;
  // keep the two in sync if the bucketing rules ever change.
  function bucketComplianceStateClient(state) {
    if (state === 'compliant' || state === 'inGracePeriod') return 'compliant';
    if (state === 'noncompliant' || state === 'conflict' || state === 'error') return 'noncompliant';
    return 'not_evaluated';
  }

  // ═══════════════════════════════════════
  // CA POLICIES — TENANT ASSIGNMENTS
  // ═══════════════════════════════════════

  let caAssignments = [];

  async function loadCaAssignments() {
    const container = el('td-ca-assignments');
    if (!container) return;

    try {
      caAssignments = await Panoptica.api(`/api/ca/assignments?tenant_id=${tenantId}`);
      renderCaAssignments();
      wireCaCardActions();
      loadCaDriftLog();
    } catch (err) {
      container.innerHTML = '<div class="panel-error">' + esc(window.t('tenant_dashboard.ca.load_failed')) + '</div>';
    }

    // Wire static buttons
    const assignBtn = el('td-ca-assign-btn');
    if (assignBtn) assignBtn.onclick = showAssignModal;
    const checkAllBtn = el('td-ca-check-all-btn');
    if (checkAllBtn) checkAllBtn.onclick = checkAllDrift;
    const cancelBtn = el('td-ca-assign-cancel');
    if (cancelBtn) cancelBtn.onclick = hideAssignModal;
    const submitBtn = el('td-ca-assign-submit');
    if (submitBtn) submitBtn.onclick = assignTemplate;
  }

  function renderCaAssignments() {
    const container = el('td-ca-assignments');
    const summary = el('td-ca-status-summary');

    if (caAssignments.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--p-text-muted);">
          <div style="font-size:2rem; margin-bottom:8px;">&#x1F6E1;</div>
          <div>${esc(window.t('tenant_dashboard.ca.empty_title'))}</div>
          <div style="font-size:0.85rem; margin-top:4px;">${esc(window.t('tenant_dashboard.ca.empty_help'))}</div>
        </div>`;
      if (summary) summary.textContent = '';
      return;
    }

    const ok = caAssignments.filter(a => a.drift_status === 'ok').length;
    const drifted = caAssignments.filter(a => a.drift_status === 'drifted').length;
    const missing = caAssignments.filter(a => a.drift_status === 'missing').length;
    if (summary) {
      summary.innerHTML = `<span style="color:var(--status-healthy);">${esc(window.t('tenant_dashboard.ca.summary_ok', { count: ok }))}</span> · <span style="color:${drifted > 0 ? 'var(--status-broken)' : 'var(--p-text-muted)'};">${esc(window.t('tenant_dashboard.ca.summary_drifted', { count: drifted }))}</span> · <span style="color:${missing > 0 ? 'var(--status-degraded)' : 'var(--p-text-muted)'};">${esc(window.t('tenant_dashboard.ca.summary_missing', { count: missing }))}</span>`;
    }

    container.innerHTML = caAssignments.map(a => {
      // Phase 10: three-state drift display — ok (green) / drifted (red) / accepted (orange)
      const driftClass = a.drift_status === 'ok' ? 'ca-drift-ok'
        : a.drift_status === 'drifted' ? 'ca-drift-drifted'
        : a.drift_status === 'accepted' ? 'ca-drift-accepted'
        : a.drift_status === 'missing' ? 'ca-drift-missing' : 'ca-drift-unchecked';
      const driftLabel = a.drift_status === 'unchecked' ? window.t('tenant_dashboard.ca.not_checked') : a.drift_status;
      const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
      const lastChecked = a.last_checked_at ? new Date(a.last_checked_at).toLocaleString(_dateLocale) : window.t('common.never');
      const ROUTING_LABELS = {
        both: window.t('tenant_dashboard.routing.email_psa'),
        support: window.t('tenant_dashboard.routing.psa_only'),
        personal: window.t('tenant_dashboard.routing.email_only'),
        none: window.t('tenant_dashboard.routing.none'),
      };
      const effectiveRouting = a.alert_routing || a.template_alert_routing || 'both';
      const routingLabel = ROUTING_LABELS[effectiveRouting] || effectiveRouting;
      const isOverridden = a.alert_routing !== null && a.alert_routing !== undefined;
      const valueNa = window.t('tenant_dashboard.ca.field.value_na');

      // Accept button: only when live_policy_id exists and drift_status is 'drifted'
      const acceptBtnHtml = (a.live_policy_id && a.drift_status === 'drifted')
        ? `<button class="ca-accept-drift-btn" data-role-required="member" data-action="ca-accept-drift" data-id="${a.id}" title="${esc(window.t('tenant_dashboard.tooltip_accept_drift'))}">${esc(window.t('tenant_dashboard.btn_accept'))}</button>`
        : '';

      return `
        <div class="ca-template-card ca-assignment-card">
          <div class="ca-card-header">
            <span class="ca-card-name">${esc(a.template_name)}</span>
            <div class="ca-drift-badge-col">
              <span class="ca-drift-badge ${driftClass}">${esc(driftLabel)}</span>
              ${acceptBtnHtml}
            </div>
          </div>
          <div class="ca-card-fields">
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.ca.field.alerts'))}</span>
              <select class="ca-inline-select" data-role-required="member" data-action="change-routing" data-id="${a.id}">
                <option value="" ${!isOverridden ? 'selected' : ''}>${esc(window.t('tenant_dashboard.ca.template_default', { routing: ROUTING_LABELS[a.template_alert_routing || 'both'] }))}</option>
                <option value="both" ${a.alert_routing === 'both' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.email_psa'))}</option>
                <option value="support" ${a.alert_routing === 'support' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.psa_only'))}</option>
                <option value="personal" ${a.alert_routing === 'personal' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.email_only'))}</option>
                <option value="none" ${a.alert_routing === 'none' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.none'))}</option>
              </select>
            </div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.ca.field.grant'))}</span> ${esc(a.grant_controls || valueNa)}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.ca.field.users'))}</span> ${esc(a.target_users || valueNa)}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.ca.field.apps'))}</span> ${esc(a.target_apps || valueNa)}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.ca.field.last_checked'))}</span> ${esc(lastChecked)}</div>
          </div>
          <div class="ca-card-toolbar">
            <button class="ca-toolbar-btn" data-role-required="member" data-action="check-drift" data-id="${a.id}">${esc(window.t('tenant_dashboard.ca.btn.check_drift'))}</button>
            ${a.live_policy_id && a.drift_status === 'drifted' ? `<button class="ca-toolbar-btn ca-toolbar-danger" data-role-required="member" data-action="remediate" data-id="${a.id}" title="${esc(window.t('tenant_dashboard.ca.btn.push_template_tooltip'))}">${esc(window.t('tenant_dashboard.ca.btn.push_template'))}</button>` : ''}
            ${!a.live_policy_id ? `<button class="ca-toolbar-btn ca-toolbar-primary" data-role-required="member" data-action="deploy" data-id="${a.id}">${esc(window.t('tenant_dashboard.ca.btn.deploy'))}</button>` : ''}
            ${!a.live_policy_id ? `<button class="ca-toolbar-btn" data-role-required="member" data-action="auto-match" data-id="${a.id}">${esc(window.t('tenant_dashboard.ca.btn.match'))}</button>` : ''}
            <button class="ca-toolbar-btn ca-toolbar-danger" data-role-required="member" data-action="remove" data-id="${a.id}">${esc(window.t('tenant_dashboard.ca.btn.remove'))}</button>
          </div>
        </div>`;
    }).join('');
  }

  function wireCaCardActions() {
    const container = el('td-ca-assignments');
    if (!container) return;
    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.action;
        if (action === 'check-drift') checkDrift(id);
        else if (action === 'ca-accept-drift') caAcceptDrift(id);
        else if (action === 'remediate') remediate(id);
        else if (action === 'deploy') deployToTenant(id);
        else if (action === 'auto-match') autoMatch(id);
        else if (action === 'remove') removeAssignment(id);
      });
    });
    // Alert routing select change
    container.querySelectorAll('select[data-action="change-routing"]').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const id = parseInt(sel.dataset.id, 10);
        const value = sel.value || null; // empty string = inherit from template
        try {
          await Panoptica.api(`/api/ca/assignments/${id}/alert-routing`, {
            method: 'PATCH',
            body: JSON.stringify({ alert_routing: value }),
          });
          Panoptica.showToast(window.t('tenant_dashboard.toast_routing_updated'), 'success');
        } catch (err) {
          Panoptica.showToast(window.t('tenant_dashboard.toast_routing_update_failed', { message: err.message }), 'error');
          await loadCaAssignments(); // revert UI
        }
      });
    });
  }

  async function checkDrift(assignmentId) {
    Panoptica.showToast(window.t('tenant_dashboard.toast_running_drift'), 'info');
    try {
      const result = await Panoptica.api(`/api/ca/assignments/${assignmentId}/check`, { method: 'POST' });
      // v0.1.16: result.remediated path removed — scheduler never auto-remediates.
      if (result.drift_status === 'ok') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_no_drift'), 'success');
      } else if (result.drift_status === 'drifted') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_drift_changed', { count: result.drifts.length }), 'error');
      } else if (result.drift_status === 'missing') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_policy_not_found'), 'error');
      }
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_drift_check_failed', { message: err.message }), 'error');
    }
  }

  // Phase 3 MVP — two-path drift-accept dialog.
  // Replaces the bare confirm() with a modal offering (a) one-off accept (existing
  // behaviour) or (b) accept-as-exemption which lifts the drifted principals into
  // ca_exemptions with an expiry and feeds evaluator suppression.
  async function caAcceptDrift(assignmentId) {
    const a = caAssignments.find(x => x.id === assignmentId);
    if (!a) { Panoptica.showToast(window.t('tenant_dashboard.toast_assignment_not_found'), 'error'); return; }

    // drift_details is a JSON column — mysql2 returns it parsed, but handle both.
    let drifts = [];
    try {
      drifts = typeof a.drift_details === 'string'
        ? JSON.parse(a.drift_details)
        : (a.drift_details || []);
    } catch { drifts = []; }

    // Per-tenant fields mirror the server's NON_REMEDIABLE_FIELDS denylist. When
    // the drift is (in whole or part) one of these, "exemption" is the right
    // default — these are the principals you WANT to carve out permanently.
    const EXCLUSION_FIELDS = ['conditions.users.excludeUsers', 'conditions.users.excludeGroups'];
    const hasExclusionDrift = drifts.some(d => EXCLUSION_FIELDS.includes(d.field));

    const fmtValue = (v) => {
      if (v === undefined || v === null) return 'empty';
      if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
      return JSON.stringify(v).slice(0, 80);
    };

    const driftSummary = drifts.length === 0
      ? `<em style="color:var(--p-text-muted);">${esc(window.t('tenant_dashboard.ca.drift_unavailable'))}</em>`
      : `<ul style="margin:0; padding-left:1.2em;">${drifts.map(d => {
          const label = esc(d.field || 'unknown');
          const exp = esc(fmtValue(d.expected));
          const act = esc(fmtValue(d.actual));
          const badge = EXCLUSION_FIELDS.includes(d.field)
            ? ` <span style="background:var(--p-accent-muted); color:var(--p-accent-light); padding:1px 6px; border-radius:3px; font-size:0.75em; margin-left:4px;">${esc(window.t('tenant_dashboard.badge.per_tenant'))}</span>`
            : '';
          return `<li style="margin:3px 0;"><code style="font-size:0.85em; word-break:break-all; overflow-wrap:anywhere;">${label}</code>${badge}<div style="font-size:0.8em; color:var(--p-text-muted);">${esc(window.t('tenant_dashboard.ca.drift_line', { exp, act }))}</div></li>`;
        }).join('')}</ul>`;

    const defaultPath = hasExclusionDrift ? 'exemption' : 'oneoff';
    const tenantName = (tenantData && tenantData.display_name) || window.t('tenant_dashboard.tenant_fallback');

    const bodyHtml = `
      <div style="margin-bottom:12px; font-size:0.9em;">
        <div>${esc(window.t('tenant_dashboard.ca.modal.tenant_label'))} <strong>${esc(tenantName)}</strong></div>
        <div>${esc(window.t('tenant_dashboard.ca.modal.template_label'))} <strong>${esc(a.template_name)}</strong></div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:0.85em; color:var(--p-text-muted); margin-bottom:6px;">${esc(window.t('tenant_dashboard.ca.modal.drifted_fields_label'))}</div>
        ${driftSummary}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="display:flex; gap:10px; padding:12px; border:1px solid var(--p-border); border-radius:4px; cursor:pointer;">
          <input type="radio" name="drift-accept-path" value="oneoff" ${defaultPath === 'oneoff' ? 'checked' : ''} style="margin-top:3px;">
          <div>
            <strong>${esc(window.t('tenant_dashboard.ca.modal.accept_once_label'))}</strong>
            <div style="font-size:0.85em; color:var(--p-text-muted); margin-top:3px;">${esc(window.t('tenant_dashboard.ca.modal.accept_once_desc'))}</div>
          </div>
        </label>

        <label style="display:flex; gap:10px; padding:12px; border:1px solid var(--p-border); border-radius:4px; cursor:pointer;">
          <input type="radio" name="drift-accept-path" value="exemption" ${defaultPath === 'exemption' ? 'checked' : ''} style="margin-top:3px;">
          <div>
            <strong>${esc(window.t('tenant_dashboard.ca.modal.accept_expiry_label'))}${hasExclusionDrift ? ` <span style="color:var(--status-healthy); font-size:0.85em; font-weight:normal;">${esc(window.t('tenant_dashboard.ca.modal.recommended_badge'))}</span>` : ''}</strong>
            <div style="font-size:0.85em; color:var(--p-text-muted); margin-top:3px;">${esc(window.t('tenant_dashboard.ca.modal.accept_expiry_desc'))}</div>
          </div>
        </label>
      </div>

      <div id="drift-accept-exemption-fields" style="margin-top:16px; ${defaultPath === 'exemption' ? '' : 'display:none;'}">
        <div class="form-group">
          <label>${esc(window.t('tenant_dashboard.ca.modal.reason_label'))}</label>
          <textarea id="drift-accept-reason" rows="2" style="width:100%;" placeholder="${esc(window.t('tenant_dashboard.ca.modal.reason_placeholder'))}"></textarea>
        </div>
        <div class="form-group">
          <label>${esc(window.t('tenant_dashboard.expiry.label'))}</label>
          <select id="drift-accept-expiry" style="width:100%;">
            <option value="30">${esc(window.t('tenant_dashboard.expiry.30_days'))}</option>
            <option value="60">${esc(window.t('tenant_dashboard.expiry.60_days'))}</option>
            <option value="90">${esc(window.t('tenant_dashboard.expiry.90_days'))}</option>
            <option value="180" selected>${esc(window.t('tenant_dashboard.expiry.180_days_default'))}</option>
            <option value="365">${esc(window.t('tenant_dashboard.expiry.365_days_max'))}</option>
          </select>
          <div style="font-size:0.8em; color:var(--p-text-muted); margin-top:4px;">${esc(window.t('tenant_dashboard.ca.modal.expiry_helper'))}</div>
        </div>
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${esc(window.t('tenant_dashboard.btn_cancel'))}</button>
      <button class="btn-primary" id="drift-accept-submit" data-role-required="member" data-id="${a.id}">${esc(window.t('tenant_dashboard.btn_accept'))}</button>
    `;

    Panoptica.openModal(window.t('tenant_dashboard.ca.modal.title'), bodyHtml, footerHtml);

    // Show/hide exemption fields based on radio choice
    document.querySelectorAll('input[name="drift-accept-path"]').forEach(r => {
      r.addEventListener('change', () => {
        const fields = document.getElementById('drift-accept-exemption-fields');
        if (fields) fields.style.display = (r.value === 'exemption' && r.checked) ? '' : 'none';
      });
    });

    // Wire submit
    document.getElementById('drift-accept-submit')?.addEventListener('click', async () => {
      const path = document.querySelector('input[name="drift-accept-path"]:checked')?.value;
      const btn = document.getElementById('drift-accept-submit');
      if (btn) btn.disabled = true;
      try {
        let result;
        if (path === 'exemption') {
          const reason = document.getElementById('drift-accept-reason')?.value?.trim() || '';
          if (reason.length < 3) {
            Panoptica.showToast(window.t('tenant_dashboard.toast_reason_min_chars'), 'error');
            if (btn) btn.disabled = false;
            return;
          }
          const expiry_days = parseInt(document.getElementById('drift-accept-expiry')?.value, 10) || 180;
          result = await Panoptica.api(`/api/ca/assignments/${assignmentId}/accept-drift-as-exemption`, {
            method: 'POST',
            body: JSON.stringify({ reason, expiry_days }),
          });
        } else {
          result = await Panoptica.api(`/api/ca/accept-drift/${assignmentId}`, { method: 'POST' });
        }
        if (result && result.ok) {
          Panoptica.closeModal();
          const msg = path === 'exemption'
            ? window.t('tenant_dashboard.ca.toast_exemption_granted', { count: (result.exempted || []).length, date: (result.expires_at || '').slice(0, 10) })
            : window.t('tenant_dashboard.ca.toast_drift_accepted');
          Panoptica.showToast(msg, 'success');
          await loadCaAssignments();
        } else {
          Panoptica.showToast(window.t('tenant_dashboard.toast_accept_failed', { message: (result && result.error) ? result.error : window.t('tenant_dashboard.toast_unknown_error') }), 'error');
          if (btn) btn.disabled = false;
        }
      } catch (err) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_accept_failed', { message: err.message }), 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  // toggleEnforcement() removed in v0.1.16 — see CA scheduler comment block.

  async function checkAllDrift() {
    Panoptica.showToast(window.t('tenant_dashboard.toast_checking_all'), 'info');
    try {
      const results = await Panoptica.api(`/api/ca/check-all?tenant_id=${tenantId}`, { method: 'POST' });
      const drifted = results.filter(r => r.drift_status === 'drifted').length;
      const missing = results.filter(r => r.drift_status === 'missing').length;
      if (drifted === 0 && missing === 0) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_all_compliant'), 'success');
      } else {
        Panoptica.showToast(window.t('tenant_dashboard.toast_drift_summary', { drifted, missing }), drifted > 0 ? 'error' : 'warning');
      }
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_drift_check_failed', { message: err.message }), 'error');
    }
  }

  async function deployToTenant(assignmentId) {
    if (!confirm(window.t('tenant_dashboard.confirm_create_policy'))) return;
    Panoptica.showToast(window.t('tenant_dashboard.toast_deploying_to_tenant'), 'info');
    try {
      const result = await Panoptica.api(`/api/ca/assignments/${assignmentId}/deploy`, { method: 'POST' });
      Panoptica.showToast(window.t('tenant_dashboard.toast_policy_deployed', { name: result.displayName }), 'success');
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_deploy_failed', { message: err.message }), 'error');
    }
  }

  async function remediate(assignmentId) {
    const assignment = caAssignments.find(a => a.id === assignmentId);
    const name = assignment ? assignment.template_name : '';
    // v0.1.16: explicit operator-initiated push. Confirm dialog calls out the
    // wipe-on-PATCH semantics for excludeUsers/excludeGroups so the operator
    // can't be bitten without consent.
    if (!confirm(window.t('tenant_dashboard.confirm_push_template', { name }))) return;
    try {
      await Panoptica.api(`/api/ca/assignments/${assignmentId}/remediate`, { method: 'POST' });
      Panoptica.showToast(window.t('tenant_dashboard.toast_template_pushed'), 'success');
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_remediate_failed', { message: err.message }), 'error');
    }
  }

  async function autoMatch(assignmentId) {
    Panoptica.showToast(window.t('tenant_dashboard.toast_searching_match'), 'info');
    try {
      const result = await Panoptica.api(`/api/ca/assignments/${assignmentId}/auto-match`, { method: 'POST' });
      if (result.matched) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_matched', { name: result.displayName }), 'success');
      } else {
        Panoptica.showToast(window.t('tenant_dashboard.toast_no_match'), 'error');
      }
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_match_failed', { message: err.message }), 'error');
    }
  }

  async function removeAssignment(assignmentId) {
    const assignment = caAssignments.find(a => a.id === assignmentId);
    let deleteFromTenant = false;

    if (assignment && assignment.live_policy_id) {
      deleteFromTenant = confirm(window.t('tenant_dashboard.confirm_remove_with_delete'));
      if (!deleteFromTenant) {
        if (!confirm(window.t('tenant_dashboard.confirm_remove_only'))) return;
      }
    } else {
      if (!confirm(window.t('tenant_dashboard.confirm_remove_assignment'))) return;
    }

    try {
      const url = `/api/ca/assignments/${assignmentId}${deleteFromTenant ? '?delete_from_tenant=true' : ''}`;
      const result = await Panoptica.api(url, { method: 'DELETE' });
      if (result.policy_deleted) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_assignment_removed_with_delete'), 'success');
      } else {
        Panoptica.showToast(window.t('tenant_dashboard.toast_assignment_removed'), 'success');
      }
      await loadCaAssignments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_remove_failed', { message: err.message }), 'error');
    }
  }

  async function showAssignModal() {
    try {
      const templates = await Panoptica.api('/api/ca/templates');
      const listEl = el('td-ca-template-list');
      const selectAllEl = el('td-ca-select-all');

      // Filter out already assigned templates
      const assignedIds = new Set(caAssignments.map(a => a.template_id));
      const available = templates.filter(t => !assignedIds.has(t.id));

      if (available.length === 0) {
        listEl.innerHTML = `<div style="color:var(--p-text-muted); padding:12px 0;">${esc(window.t('tenant_dashboard.intune.add.all_assigned'))}</div>`;
        if (selectAllEl) selectAllEl.style.display = 'none';
      } else {
        listEl.innerHTML = available.map(t => `
          <label class="ca-assign-row" style="display:flex; align-items:center; gap:10px; padding:6px 4px; cursor:pointer; border-bottom:1px solid rgba(150,150,180,0.1);">
            <input type="checkbox" class="ca-assign-cb" value="${t.id}" checked>
            <span style="color:var(--p-text-bright); font-size:0.85rem;">${esc(t.name)}</span>
          </label>
        `).join('');
        if (selectAllEl) {
          selectAllEl.style.display = '';
          selectAllEl.checked = true;
          selectAllEl.onchange = () => {
            listEl.querySelectorAll('.ca-assign-cb').forEach(cb => { cb.checked = selectAllEl.checked; });
          };
          // Update select-all state when individual checkboxes change
          listEl.addEventListener('change', () => {
            const cbs = listEl.querySelectorAll('.ca-assign-cb');
            const allChecked = [...cbs].every(cb => cb.checked);
            selectAllEl.checked = allChecked;
          });
        }
      }
      el('td-ca-assign-overlay').style.display = 'flex';
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_load_templates_failed'), 'error');
    }
  }

  function hideAssignModal() {
    el('td-ca-assign-overlay').style.display = 'none';
  }

  async function assignTemplate() {
    const listEl = el('td-ca-template-list');
    const selectedIds = [...listEl.querySelectorAll('.ca-assign-cb:checked')].map(cb => parseInt(cb.value, 10));
    // v0.1.16: enforcement dropdown removed from modal — all new assignments
    // are created in monitor mode (auto-remediation has been retired).

    if (selectedIds.length === 0) return Panoptica.showToast(window.t('tenant_dashboard.toast_select_template'), 'error');

    let successCount = 0;
    let failCount = 0;

    for (const templateId of selectedIds) {
      try {
        await Panoptica.api('/api/ca/assignments', {
          method: 'POST',
          body: JSON.stringify({ template_id: templateId, tenant_id: parseInt(tenantId, 10) }),
        });
        successCount++;
      } catch (err) {
        failCount++;
        console.error(`[CA] Failed to assign template ${templateId}:`, err.message);
      }
    }

    if (successCount > 0) {
      Panoptica.showToast(
        failCount > 0
          ? window.t('tenant_dashboard.toast_templates_assigned_partial', { count: successCount, failed: failCount })
          : window.t('tenant_dashboard.toast_templates_assigned', { count: successCount }),
        successCount > 0 && failCount === 0 ? 'success' : 'warning'
      );
    } else {
      Panoptica.showToast(window.t('tenant_dashboard.toast_all_assignments_failed', { count: failCount }), 'error');
    }

    hideAssignModal();
    await loadCaAssignments();
  }

  async function loadCaDriftLog() {
    const section = el('td-ca-drift-log-section');
    const container = el('td-ca-drift-log');
    if (!section || !container) return;

    try {
      const logs = await Panoptica.api(`/api/ca/drift-log?tenant_id=${tenantId}&limit=20`);
      if (logs.length === 0) {
        section.style.display = 'none';
        return;
      }
      section.style.display = 'block';
      const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
      container.innerHTML = `<table class="alert-table"><thead><tr>
        <th>${esc(window.t('tenant_dashboard.ca.drift_log.col_time'))}</th><th>${esc(window.t('tenant_dashboard.ca.drift_log.col_template'))}</th><th>${esc(window.t('tenant_dashboard.ca.drift_log.col_event'))}</th><th>${esc(window.t('tenant_dashboard.ca.drift_log.col_field'))}</th><th>${esc(window.t('tenant_dashboard.ca.drift_log.col_details'))}</th>
      </tr></thead><tbody>
        ${logs.map(l => {
          const typeLabelMap = {
            field_changed: window.t('tenant_dashboard.ca.drift_event.field_changed'),
            policy_disabled: window.t('tenant_dashboard.ca.drift_event.policy_disabled'),
            policy_missing: window.t('tenant_dashboard.ca.drift_event.policy_missing'),
            policy_deleted: window.t('tenant_dashboard.ca.drift_event.policy_deleted'),
            remediated: window.t('tenant_dashboard.ca.drift_event.remediated'),
          };
          const typeLabel = typeLabelMap[l.drift_type] || l.drift_type;
          const typeClass = l.drift_type === 'remediated' ? 'score-green' : l.drift_type === 'field_changed' ? 'severity-high' : 'severity-medium';
          return `<tr>
            <td>${new Date(l.created_at).toLocaleString(_dateLocale)}</td>
            <td>${esc(l.template_name)}</td>
            <td class="${typeClass}">${esc(typeLabel)}</td>
            <td style="font-size:0.75rem;">${esc(l.field_path || '—')}</td>
            <td style="font-size:0.75rem; max-width:200px; overflow:hidden; text-overflow:ellipsis;">
              ${l.expected_value ? esc(window.t('tenant_dashboard.ca.drift_log.expected', { value: l.expected_value })) : ''}
              ${l.actual_value ? esc(window.t('tenant_dashboard.ca.drift_log.got', { value: l.actual_value })) : ''}
              ${l.remediated ? `<span class="score-green"> ${esc(window.t('tenant_dashboard.ca.drift_log.fixed'))}</span>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody></table>`;
    } catch (err) {
      section.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════
  // INTUNE POLICIES — TENANT DEPLOYMENTS
  // ═══════════════════════════════════════

  let intuneDeployments = [];

  async function loadIntuneDeployments() {
    const container = el('td-intune-deployments');
    if (!container) return;

    try {
      intuneDeployments = await Panoptica.api(`/api/intune/deployments?tenant_id=${tenantId}`);
      renderIntuneDeployments();
      wireIntuneCardActions();
    } catch (err) {
      container.innerHTML = `<div class="panel-error">${esc(window.t('tenant_dashboard.intune.load_failed'))}</div>`;
    }

    // Wire static buttons
    const addBtn = el('td-intune-add-btn');
    if (addBtn) addBtn.onclick = showIntuneAddModal;
    const checkAllBtn = el('td-intune-check-all-btn');
    if (checkAllBtn) checkAllBtn.onclick = intuneCheckAllDrift;
    const cancelBtn = el('td-intune-add-cancel');
    if (cancelBtn) cancelBtn.onclick = hideIntuneAddModal;
    const addOnlyBtn = el('td-intune-add-only');
    if (addOnlyBtn) addOnlyBtn.onclick = () => intuneAddPolicies(false);
    const addDeployBtn = el('td-intune-add-deploy');
    if (addDeployBtn) addDeployBtn.onclick = () => intuneAddPolicies(true);
  }

  // Intune policy-type labels — looked up by Graph type key. Translated at call-site
  // so locale switches reflect immediately without a re-render closure capture.
  function intunePolicyTypeLabel(key) {
    const map = {
      configurationPolicies: 'tenant_dashboard.intune.policy_type.configuration_policies',
      deviceConfigurations: 'tenant_dashboard.intune.policy_type.device_configurations',
      deviceCompliancePolicies: 'tenant_dashboard.intune.policy_type.device_compliance_policies',
      groupPolicyConfigurations: 'tenant_dashboard.intune.policy_type.group_policy_configurations',
      intents: 'tenant_dashboard.intune.policy_type.intents',
    };
    return map[key] ? window.t(map[key]) : key;
  }

  function intuneRoutingLabel(key) {
    const map = {
      both: 'tenant_dashboard.routing.email_psa',
      support: 'tenant_dashboard.routing.psa_only',
      personal: 'tenant_dashboard.routing.email_only',
      none: 'tenant_dashboard.routing.none',
    };
    return map[key] ? window.t(map[key]) : key;
  }

  function renderIntuneDeployments() {
    const container = el('td-intune-deployments');
    const summary = el('td-intune-status-summary');

    if (intuneDeployments.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--p-text-muted);">
          <div style="font-size:2rem; margin-bottom:8px;">&#x1F6E1;</div>
          <div>${esc(window.t('tenant_dashboard.intune.empty_title'))}</div>
          <div style="font-size:0.85rem; margin-top:4px;">${esc(window.t('tenant_dashboard.intune.empty_help'))}</div>
        </div>`;
      if (summary) summary.textContent = '';
      return;
    }

    const deployed = intuneDeployments.filter(d => d.status === 'deployed').length;
    const pending = intuneDeployments.filter(d => d.status === 'pending').length;
    const failed = intuneDeployments.filter(d => d.status === 'failed').length;
    const ok = intuneDeployments.filter(d => d.drift_status === 'ok').length;
    const drifted = intuneDeployments.filter(d => d.drift_status === 'drifted').length;
    if (summary) {
      summary.innerHTML = `<span style="color:var(--status-healthy);">${esc(window.t('tenant_dashboard.intune.summary.deployed', { count: deployed }))}</span> · <span style="color:var(--p-text-muted);">${esc(window.t('tenant_dashboard.intune.summary.pending', { count: pending }))}</span>${failed > 0 ? ` · <span style="color:var(--status-broken);">${esc(window.t('tenant_dashboard.intune.summary.failed', { count: failed }))}</span>` : ''}${drifted > 0 ? ` · <span style="color:var(--status-broken);">${esc(window.t('tenant_dashboard.intune.summary.drifted', { count: drifted }))}</span>` : ''}`;
    }

    container.innerHTML = intuneDeployments.map(d => {
      const statusClass = d.status === 'deployed' ? 'ca-drift-ok'
        : d.status === 'failed' ? 'ca-drift-drifted'
        : d.status === 'pending' ? 'ca-drift-unchecked' : 'ca-drift-missing';
      // Phase 9: three-state drift display — ok (green) / drifted (red) / accepted (orange)
      const driftClass = d.drift_status === 'ok' ? 'ca-drift-ok'
        : d.drift_status === 'drifted' ? 'ca-drift-drifted'
        : d.drift_status === 'accepted' ? 'ca-drift-accepted'
        : d.drift_status === 'missing' ? 'ca-drift-missing' : 'ca-drift-unchecked';
      const driftLabel = d.drift_status === 'unchecked' ? window.t('tenant_dashboard.ca.not_checked') : d.drift_status;
      const _lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const _dateLocale = _lang === 'fr' ? 'fr-CA' : (_lang === 'es' ? 'es' : 'en-CA');
      const lastChecked = d.last_checked_at ? new Date(d.last_checked_at).toLocaleString(_dateLocale) : window.t('common.never');
      const deployedAt = d.deployed_at ? new Date(d.deployed_at).toLocaleString(_dateLocale) : '—';
      const policyTypeLabel = intunePolicyTypeLabel(d.policy_type);
      const assignmentLabel = d.assignment_target === 'all_users'
        ? window.t('tenant_dashboard.intune.assignment.all_users')
        : d.assignment_target === 'all_devices'
          ? window.t('tenant_dashboard.intune.assignment.all_devices')
          : window.t('tenant_dashboard.intune.assignment.none');

      // Accept-drift button: only when actively drifted (not when ok or already accepted)
      const acceptBtnHtml = (d.status === 'deployed' && d.drift_status === 'drifted')
        ? `<button class="ca-accept-drift-btn" data-role-required="member" data-action="intune-accept-drift" data-id="${d.id}" title="${esc(window.t('tenant_dashboard.tooltip_accept_drift'))}">${esc(window.t('tenant_dashboard.btn_accept'))}</button>`
        : '';

      return `
        <div class="ca-template-card ca-assignment-card">
          <div class="ca-card-header">
            <span class="ca-card-name">${esc(d.template_name)}</span>
            <div class="ca-drift-badge-col">
              ${d.status === 'deployed'
                ? `<span class="ca-drift-badge ${driftClass}">${esc(driftLabel)}</span>`
                : `<span class="ca-drift-badge ${statusClass}">${d.status}</span>`}
              ${acceptBtnHtml}
            </div>
          </div>
          <div class="ca-card-fields">
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.type'))}</span> ${esc(policyTypeLabel)}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.category'))}</span> ${esc(d.category || '—')}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.status'))}</span> ${d.status}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.assignment'))}</span> ${esc(assignmentLabel)}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.alerts'))}</span>
              <select class="ca-inline-select" data-action="intune-change-routing" data-id="${d.id}">
                <option value="" ${!d.alert_routing ? 'selected' : ''}>${esc(window.t('tenant_dashboard.ca.template_default', { routing: intuneRoutingLabel(d.template_alert_routing || 'both') }))}</option>
                <option value="both" ${d.alert_routing === 'both' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.email_psa'))}</option>
                <option value="support" ${d.alert_routing === 'support' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.psa_only'))}</option>
                <option value="personal" ${d.alert_routing === 'personal' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.email_only'))}</option>
                <option value="none" ${d.alert_routing === 'none' ? 'selected' : ''}>${esc(window.t('tenant_dashboard.routing.none'))}</option>
              </select>
            </div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.deployed'))}</span> ${deployedAt}</div>
            <div class="ca-field-row"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.last_drift_check'))}</span> ${lastChecked}</div>
            ${d.error_message ? `<div class="ca-field-row" style="color:var(--status-broken);"><span class="ca-field-label">${esc(window.t('tenant_dashboard.intune.field.error'))}</span> ${esc(d.error_message.substring(0, 120))}</div>` : ''}
          </div>
          <div class="ca-card-toolbar">
            ${d.status === 'pending' ? `<button class="ca-toolbar-btn ca-toolbar-primary" data-role-required="member" data-action="intune-deploy" data-id="${d.id}" data-template-id="${d.template_id}">${esc(window.t('tenant_dashboard.intune.btn.deploy'))}</button>` : ''}
            ${d.status === 'deployed' ? `<button class="ca-toolbar-btn" data-role-required="member" data-action="intune-check-drift" data-id="${d.id}">${esc(window.t('tenant_dashboard.intune.btn.check_drift'))}</button>` : ''}
            ${d.status === 'failed' ? `<button class="ca-toolbar-btn ca-toolbar-primary" data-role-required="member" data-action="intune-deploy" data-id="${d.id}" data-template-id="${d.template_id}">${esc(window.t('tenant_dashboard.intune.btn.retry'))}</button>` : ''}
            <button class="ca-toolbar-btn ca-toolbar-danger" data-role-required="member" data-action="intune-remove" data-id="${d.id}">${esc(window.t('tenant_dashboard.intune.btn.remove'))}</button>
          </div>
        </div>`;
    }).join('');
  }

  function wireIntuneCardActions() {
    const container = el('td-intune-deployments');
    if (!container) return;
    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.action;
        if (action === 'intune-deploy') intuneDeploySingle(parseInt(btn.dataset.templateId, 10));
        else if (action === 'intune-check-drift') intuneCheckDrift(id);
        else if (action === 'intune-accept-drift') intuneAcceptDrift(id);
        else if (action === 'intune-remove') intuneRemoveDeployment(id);
      });
    });
    // Alert routing inline select change
    container.querySelectorAll('select[data-action="intune-change-routing"]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = parseInt(sel.dataset.id, 10);
        const value = sel.value || null; // empty string = inherit from template
        try {
          await Panoptica.api(`/api/intune/deployments/${id}/alert-routing`, {
            method: 'PATCH',
            body: JSON.stringify({ alert_routing: value }),
          });
          Panoptica.showToast(window.t('tenant_dashboard.toast_routing_updated'), 'success');
        } catch (err) {
          Panoptica.showToast(window.t('tenant_dashboard.toast_routing_update_failed', { message: err.message }), 'error');
          await loadIntuneDeployments(); // revert UI
        }
      });
    });
  }

  async function intuneDeploySingle(templateId) {
    if (!confirm(window.t('tenant_dashboard.confirm_create_intune_policy'))) return;
    Panoptica.showToast(window.t('tenant_dashboard.toast_deploying_policy'), 'info');
    try {
      const result = await Panoptica.api('/api/intune/deploy', {
        method: 'POST',
        body: JSON.stringify({ templateId, tenantId: parseInt(tenantId, 10) }),
      });
      if (result.success) {
        Panoptica.showToast(result.message, 'success');
      } else {
        Panoptica.showToast(window.t('tenant_dashboard.toast_deploy_failed', { message: result.error || window.t('tenant_dashboard.toast_unknown_error') }), 'error');
      }
      await loadIntuneDeployments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_deploy_failed', { message: err.message }), 'error');
      await loadIntuneDeployments();
    }
  }

  async function intuneCheckDrift(deploymentId) {
    Panoptica.showToast(window.t('tenant_dashboard.toast_running_drift'), 'info');
    try {
      const result = await Panoptica.api(`/api/intune/check-drift/${deploymentId}`, { method: 'POST' });
      if (result.drift_status === 'ok') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_no_drift'), 'success');
      } else if (result.drift_status === 'drifted') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_drift_detected_only'), 'error');
      } else if (result.drift_status === 'missing') {
        Panoptica.showToast(window.t('tenant_dashboard.toast_policy_not_found'), 'error');
      }
      await loadIntuneDeployments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_drift_check_failed', { message: err.message }), 'error');
    }
  }

  // Phase 3 MVP — two-path Intune drift-accept dialog.
  // Mirrors the CA modal shape but without the per-principal exemption
  // cross-reference (Intune drifts are policy-setting drifts, not per-user).
  //   Option 1: "Accept Once, forever" — no expiry, pure hash acknowledgment.
  //   Option 2: "Accept with expiry"   — same, plus a timer. On expiry the
  //                                      scheduler clears the hash and drift
  //                                      re-raises for re-review.
  async function intuneAcceptDrift(deploymentId) {
    const d = intuneDeployments.find(x => x.id === deploymentId);
    if (!d) { Panoptica.showToast(window.t('tenant_dashboard.toast_deployment_not_found'), 'error'); return; }

    let drifts = [];
    try {
      drifts = typeof d.drift_details === 'string'
        ? JSON.parse(d.drift_details)
        : (d.drift_details || []);
    } catch { drifts = []; }

    const fmtValue = (v) => {
      if (v === undefined || v === null) return 'empty';
      if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
      if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
      return String(v).slice(0, 80);
    };

    const driftSummary = drifts.length === 0
      ? `<em style="color:var(--p-text-muted);">${esc(window.t('tenant_dashboard.ca.drift_unavailable'))}</em>`
      : `<ul style="margin:0; padding-left:1.2em;">${drifts.map(drift => {
          const label = esc(drift.field || drift.path || 'unknown');
          const exp = esc(fmtValue(drift.expected));
          const act = esc(fmtValue(drift.actual));
          return `<li style="margin:3px 0;"><code style="font-size:0.85em; word-break:break-all; overflow-wrap:anywhere;">${label}</code><div style="font-size:0.8em; color:var(--p-text-muted);">${esc(window.t('tenant_dashboard.ca.drift_line', { exp, act }))}</div></li>`;
        }).join('')}</ul>`;

    const tenantName = (tenantData && tenantData.display_name) || window.t('tenant_dashboard.tenant_fallback');

    const bodyHtml = `
      <div style="margin-bottom:12px; font-size:0.9em;">
        <div>${esc(window.t('tenant_dashboard.ca.modal.tenant_label'))} <strong>${esc(tenantName)}</strong></div>
        <div>${esc(window.t('tenant_dashboard.ca.modal.template_label'))} <strong>${esc(d.template_name)}</strong></div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:0.85em; color:var(--p-text-muted); margin-bottom:6px;">${esc(window.t('tenant_dashboard.ca.modal.drifted_fields_label'))}</div>
        ${driftSummary}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <label style="display:flex; gap:10px; padding:12px; border:1px solid var(--p-border); border-radius:4px; cursor:pointer;">
          <input type="radio" name="intune-drift-accept-path" value="oneoff" checked style="margin-top:3px;">
          <div>
            <strong>${esc(window.t('tenant_dashboard.ca.modal.accept_once_label'))}</strong>
            <div style="font-size:0.85em; color:var(--p-text-muted); margin-top:3px;">${esc(window.t('tenant_dashboard.intune.modal.accept_once_desc'))}</div>
          </div>
        </label>

        <label style="display:flex; gap:10px; padding:12px; border:1px solid var(--p-border); border-radius:4px; cursor:pointer;">
          <input type="radio" name="intune-drift-accept-path" value="expiry" style="margin-top:3px;">
          <div>
            <strong>${esc(window.t('tenant_dashboard.ca.modal.accept_expiry_label'))}</strong> <span style="color:var(--status-healthy); font-size:0.8em;">${esc(window.t('tenant_dashboard.ca.modal.recommended_badge'))}</span>
            <div style="font-size:0.85em; color:var(--p-text-muted); margin-top:3px;">${esc(window.t('tenant_dashboard.intune.modal.accept_expiry_desc'))}</div>
          </div>
        </label>
      </div>

      <div id="intune-drift-expiry-fields" style="margin-top:16px; display:none;">
        <div class="form-group">
          <label>${esc(window.t('tenant_dashboard.ca.modal.reason_label'))}</label>
          <textarea id="intune-drift-reason" rows="2" style="width:100%;" placeholder="${esc(window.t('tenant_dashboard.intune.modal.reason_placeholder'))}"></textarea>
        </div>
        <div class="form-group">
          <label>${esc(window.t('tenant_dashboard.expiry.label'))}</label>
          <select id="intune-drift-expiry" style="width:100%;">
            <option value="30">${esc(window.t('tenant_dashboard.expiry.30_days'))}</option>
            <option value="60">${esc(window.t('tenant_dashboard.expiry.60_days'))}</option>
            <option value="90">${esc(window.t('tenant_dashboard.expiry.90_days'))}</option>
            <option value="180" selected>${esc(window.t('tenant_dashboard.expiry.180_days_default'))}</option>
            <option value="365">${esc(window.t('tenant_dashboard.expiry.365_days_max'))}</option>
          </select>
          <div style="font-size:0.8em; color:var(--p-text-muted); margin-top:4px;">${esc(window.t('tenant_dashboard.intune.modal.expiry_helper'))}</div>
        </div>
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${esc(window.t('tenant_dashboard.btn_cancel'))}</button>
      <button class="btn-primary" id="intune-drift-submit" data-role-required="member" data-id="${d.id}">${esc(window.t('tenant_dashboard.btn_accept'))}</button>
    `;

    Panoptica.openModal(window.t('tenant_dashboard.intune.modal.title'), bodyHtml, footerHtml);

    // Show/hide expiry fields based on radio choice
    document.querySelectorAll('input[name="intune-drift-accept-path"]').forEach(r => {
      r.addEventListener('change', () => {
        const fields = document.getElementById('intune-drift-expiry-fields');
        if (fields) fields.style.display = (r.value === 'expiry' && r.checked) ? '' : 'none';
      });
    });

    // Wire submit
    document.getElementById('intune-drift-submit')?.addEventListener('click', async () => {
      const path = document.querySelector('input[name="intune-drift-accept-path"]:checked')?.value;
      const btn = document.getElementById('intune-drift-submit');
      if (btn) btn.disabled = true;
      try {
        let body = {};
        if (path === 'expiry') {
          const reason = document.getElementById('intune-drift-reason')?.value?.trim() || '';
          if (reason.length < 3) {
            Panoptica.showToast(window.t('tenant_dashboard.toast_reason_min_chars'), 'error');
            if (btn) btn.disabled = false;
            return;
          }
          const expiry_days = parseInt(document.getElementById('intune-drift-expiry')?.value, 10) || 180;
          body = { reason, expiry_days };
        }
        const result = await Panoptica.api(`/api/intune/accept-drift/${deploymentId}`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (result && result.ok) {
          Panoptica.closeModal();
          const msg = path === 'expiry'
            ? window.t('tenant_dashboard.intune.toast_drift_accepted_expires', { date: (result.acknowledged_expires_at || '').slice(0, 10) })
            : window.t('tenant_dashboard.intune.toast_drift_accepted_no_expiry');
          Panoptica.showToast(msg, 'success');
          await loadIntuneDeployments();
        } else {
          Panoptica.showToast(window.t('tenant_dashboard.toast_accept_failed', { message: (result && result.error) ? result.error : window.t('tenant_dashboard.toast_unknown_error') }), 'error');
          if (btn) btn.disabled = false;
        }
      } catch (err) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_accept_failed', { message: err.message }), 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  async function intuneCheckAllDrift() {
    const deployed = intuneDeployments.filter(d => d.status === 'deployed');
    if (deployed.length === 0) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_no_deployed_policies'), 'warning');
      return;
    }
    Panoptica.showToast(window.t('tenant_dashboard.toast_checking_n_policies', { count: deployed.length }), 'info');
    let drifted = 0;
    let missing = 0;
    for (const d of deployed) {
      try {
        const result = await Panoptica.api(`/api/intune/check-drift/${d.id}`, { method: 'POST' });
        if (result.drift_status === 'drifted') drifted++;
        if (result.drift_status === 'missing') missing++;
      } catch (err) {
        console.error(`[Intune] Drift check failed for deployment ${d.id}:`, err.message);
      }
    }
    if (drifted === 0 && missing === 0) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_all_compliant'), 'success');
    } else {
      Panoptica.showToast(window.t('tenant_dashboard.toast_drift_summary', { drifted, missing }), drifted > 0 ? 'error' : 'warning');
    }
    await loadIntuneDeployments();
  }

  async function intuneRemoveDeployment(deploymentId) {
    const deployment = intuneDeployments.find(d => d.id === deploymentId);
    let deleteFromTenant = false;

    if (deployment && deployment.deployed_policy_id) {
      deleteFromTenant = confirm(window.t('tenant_dashboard.confirm_remove_deployment_with_delete'));
      if (!deleteFromTenant) {
        if (!confirm(window.t('tenant_dashboard.confirm_remove_deployment_only'))) return;
      }
    } else {
      if (!confirm(window.t('tenant_dashboard.confirm_remove_deployment_record'))) return;
    }

    try {
      const url = `/api/intune/deployments/${deploymentId}${deleteFromTenant ? '?delete_from_tenant=true' : ''}`;
      const result = await Panoptica.api(url, { method: 'DELETE' });
      if (result.policy_deleted) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_deployment_removed_with_delete'), 'success');
      } else {
        Panoptica.showToast(window.t('tenant_dashboard.toast_deployment_removed'), 'success');
      }
      await loadIntuneDeployments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_remove_failed', { message: err.message }), 'error');
    }
  }

  // ─── Intune Add Policies Modal ───

  async function showIntuneAddModal() {
    try {
      const templates = await Panoptica.api('/api/intune/templates');
      const listEl = el('td-intune-template-list');
      const selectAllEl = el('td-intune-select-all');
      const progressEl = el('td-intune-bulk-progress');
      if (progressEl) progressEl.style.display = 'none';

      // Filter out already assigned
      const assignedTemplateIds = new Set(intuneDeployments.filter(d => d.status !== 'removed').map(d => d.template_id));
      const available = templates.filter(t => !assignedTemplateIds.has(t.id));

      if (available.length === 0) {
        listEl.innerHTML = `<div style="color:var(--p-text-muted); padding:12px 0;">${esc(window.t('tenant_dashboard.intune.add.all_assigned'))}</div>`;
        if (selectAllEl) selectAllEl.parentElement.style.display = 'none';
      } else {
        listEl.innerHTML = available.map(t => {
          const typeLabel = intunePolicyTypeLabel(t.policy_type);
          const tDefault = t.assignment_target || 'none';
          return `
            <label class="ca-assign-row" style="display:flex; align-items:center; gap:10px; padding:6px 4px; cursor:pointer; border-bottom:1px solid rgba(150,150,180,0.1);">
              <input type="checkbox" class="intune-add-cb" value="${t.id}" checked>
              <span style="color:var(--p-text-bright); font-size:0.85rem; flex:1; min-width:0;">${esc(t.name)}</span>
              <select class="intune-add-assign form-control" data-template-id="${t.id}" style="width:auto; min-width:110px; font-size:0.75rem; padding:3px 6px;">
                <option value="none"${tDefault === 'none' ? ' selected' : ''}>${esc(window.t('tenant_dashboard.intune.assignment.none'))}</option>
                <option value="all_users"${tDefault === 'all_users' ? ' selected' : ''}>${esc(window.t('tenant_dashboard.intune.assignment.all_users'))}</option>
                <option value="all_devices"${tDefault === 'all_devices' ? ' selected' : ''}>${esc(window.t('tenant_dashboard.intune.assignment.all_devices'))}</option>
              </select>
              <span style="color:var(--p-text-muted); font-size:0.75rem; min-width:80px; text-align:right;">${esc(typeLabel)}</span>
            </label>`;
        }).join('');
        if (selectAllEl) {
          selectAllEl.parentElement.style.display = '';
          selectAllEl.checked = true;
          selectAllEl.onchange = () => {
            listEl.querySelectorAll('.intune-add-cb').forEach(cb => { cb.checked = selectAllEl.checked; });
          };
          listEl.addEventListener('change', () => {
            const cbs = listEl.querySelectorAll('.intune-add-cb');
            selectAllEl.checked = [...cbs].every(cb => cb.checked);
          });
        }
      }

      // Wire default assignment dropdown to set all per-policy dropdowns
      const defaultAssignEl = el('td-intune-default-assign');
      if (defaultAssignEl) {
        defaultAssignEl.value = 'none';
        defaultAssignEl.onchange = () => {
          listEl.querySelectorAll('.intune-add-assign').forEach(sel => { sel.value = defaultAssignEl.value; });
        };
      }

      // Re-enable buttons
      el('td-intune-add-only').disabled = false;
      el('td-intune-add-deploy').disabled = false;
      el('td-intune-add-overlay').style.display = 'flex';
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_load_templates_failed'), 'error');
    }
  }

  function hideIntuneAddModal() {
    el('td-intune-add-overlay').style.display = 'none';
  }

  async function intuneAddPolicies(deploy) {
    const listEl = el('td-intune-template-list');
    const selectedIds = [...listEl.querySelectorAll('.intune-add-cb:checked')].map(cb => parseInt(cb.value, 10));
    if (selectedIds.length === 0) return Panoptica.showToast(window.t('tenant_dashboard.toast_select_template'), 'error');

    // Collect per-policy assignment overrides
    const assignmentOverrides = {};
    listEl.querySelectorAll('.intune-add-assign').forEach(sel => {
      const tid = sel.dataset.templateId;
      if (tid && sel.value !== 'none') assignmentOverrides[tid] = sel.value;
    });

    const addOnlyBtn = el('td-intune-add-only');
    const addDeployBtn = el('td-intune-add-deploy');
    const cancelBtn = el('td-intune-add-cancel');
    const progressEl = el('td-intune-bulk-progress');
    const statusEl = el('td-intune-bulk-status');
    const barEl = el('td-intune-bulk-bar');

    addOnlyBtn.disabled = true;
    addDeployBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      // Step 1: Bulk add (create deployment records)
      if (progressEl) {
        progressEl.style.display = 'block';
        statusEl.textContent = window.t('tenant_dashboard.intune.add.progress_adding', { count: selectedIds.length });
        barEl.style.width = '10%';
      }

      const addResult = await Panoptica.api('/api/intune/deployments/bulk-add', {
        method: 'POST',
        body: JSON.stringify({ templateIds: selectedIds, tenantId: parseInt(tenantId, 10), assignmentOverrides }),
      });

      if (!deploy) {
        // Add only — done
        Panoptica.showToast(
          addResult.skipped > 0
            ? window.t('tenant_dashboard.toast_added_for_monitoring_skipped', { added: addResult.added, skipped: addResult.skipped })
            : window.t('tenant_dashboard.toast_added_for_monitoring', { added: addResult.added }),
          'success'
        );
        hideIntuneAddModal();
        await loadIntuneDeployments();
        cancelBtn.disabled = false;
        return;
      }

      // Step 2: Deploy each added policy sequentially
      const toDeploy = addResult.results.filter(r => r.status === 'added');
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < toDeploy.length; i++) {
        const item = toDeploy[i];
        const pct = Math.round(((i + 1) / toDeploy.length) * 100);
        if (statusEl) statusEl.textContent = window.t('tenant_dashboard.intune.add.progress_deploying', { i: i + 1, n: toDeploy.length, name: item.templateName });
        if (barEl) barEl.style.width = pct + '%';

        try {
          const itemAssign = assignmentOverrides[String(item.templateId)] || item.assignment_target || undefined;
          const result = await Panoptica.api('/api/intune/deploy', {
            method: 'POST',
            body: JSON.stringify({ templateId: item.templateId, tenantId: parseInt(tenantId, 10), assignment_target: itemAssign }),
          });
          if (result.success) successCount++;
          else failCount++;
        } catch (err) {
          failCount++;
          console.error(`[Intune] Deploy failed for template ${item.templateId}:`, err.message);
        }
      }

      if (barEl) barEl.style.width = '100%';
      let msg = window.t('tenant_dashboard.intune.add.toast_summary_base', { deployed: successCount });
      if (failCount > 0) msg += window.t('tenant_dashboard.intune.add.toast_summary_failed', { failed: failCount });
      if (addResult.skipped > 0) msg += window.t('tenant_dashboard.intune.add.toast_summary_existed', { existed: addResult.skipped });
      Panoptica.showToast(msg, failCount > 0 ? 'warning' : 'success');
      hideIntuneAddModal();
      await loadIntuneDeployments();
    } catch (err) {
      Panoptica.showToast(window.t('tenant_dashboard.toast_operation_failed', { message: err.message }), 'error');
    } finally {
      cancelBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Change Log — per-tenant operator-logged change events (2026-04-19)
  // ═══════════════════════════════════════════════════════════════════
  // Day-at-a-time view with prev/next/date-picker navigation. Slide-out
  // form for create + edit. Soft delete via form's Delete button. Feeds
  // the Haiku digest as narrative context only — no alert suppression.
  const ChangeLog = (function () {
    let currentDate = null;       // YYYY-MM-DD string
    let wiredAlready = false;

    // ─── Public entry points ─────────────────────────────────────────
    function wire() {
      if (wiredAlready) return;
      wiredAlready = true;

      const headerBtn = document.getElementById('td-log-change-btn');
      if (headerBtn) headerBtn.addEventListener('click', () => openFormNew());

      const viewBtn = document.getElementById('cl-log-change-btn-2');
      if (viewBtn) viewBtn.addEventListener('click', () => openFormNew());

      const prev = document.getElementById('cl-prev-day');
      const next = document.getElementById('cl-next-day');
      const today = document.getElementById('cl-today');
      const dateInput = document.getElementById('cl-date-input');
      if (prev) prev.addEventListener('click', () => shiftDay(-1));
      if (next) next.addEventListener('click', () => shiftDay(1));
      if (today) today.addEventListener('click', () => setDate(todayStr()));
      if (dateInput) dateInput.addEventListener('change', (e) => {
        if (e.target.value) setDate(e.target.value);
      });

      // Slide-out form wiring
      const closeBtn = document.getElementById('cl-form-close');
      const cancelBtn = document.getElementById('cl-form-cancel');
      const overlay = document.getElementById('cl-form-overlay');
      const submitBtn = document.getElementById('cl-form-submit');
      const deleteBtn = document.getElementById('cl-form-delete');
      const roCloseBtn = document.getElementById('cl-ro-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', closeForm);
      if (cancelBtn) cancelBtn.addEventListener('click', closeForm);
      if (overlay) overlay.addEventListener('click', closeForm);
      if (submitBtn) submitBtn.addEventListener('click', submitForm);
      if (deleteBtn) deleteBtn.addEventListener('click', deleteEvent);
      if (roCloseBtn) roCloseBtn.addEventListener('click', closeForm);

      // Quick-pick started-at buttons
      document.querySelectorAll('.cl-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const minutes = parseInt(btn.dataset.offset, 10) || 0;
          const d = new Date(Date.now() - minutes * 60000);
          document.getElementById('cl-form-started').value = toLocalInput(d);
        });
      });

      // Description char counter
      const desc = document.getElementById('cl-form-description');
      const count = document.getElementById('cl-form-desc-count');
      if (desc && count) desc.addEventListener('input', () => { count.textContent = desc.value.length; });

      // ESC closes form
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('cl-form-slideout')?.classList.contains('active')) closeForm();
      });
    }

    function show() {
      if (!currentDate) currentDate = todayStr();
      syncDateUI();
      loadEvents();
    }

    // ─── Day navigation ──────────────────────────────────────────────
    function shiftDay(delta) {
      if (!currentDate) currentDate = todayStr();
      const d = new Date(currentDate + 'T00:00:00');
      d.setDate(d.getDate() + delta);
      setDate(toDateStr(d));
    }

    function setDate(ymd) {
      currentDate = ymd;
      syncDateUI();
      loadEvents();
    }

    function syncDateUI() {
      const input = document.getElementById('cl-date-input');
      const label = document.getElementById('cl-date-label');
      if (input) input.value = currentDate;
      if (label) {
        const d = new Date(currentDate + 'T00:00:00');
        const isToday = currentDate === todayStr();
        label.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (isToday ? window.t('tenant_dashboard.changelog.today_suffix') : '');
      }
    }

    // ─── List rendering ──────────────────────────────────────────────
    async function loadEvents() {
      const list = document.getElementById('cl-list');
      if (!list || !tenantId || !currentDate) return;
      list.innerHTML = `<div class="loading-container"><div class="loading-spinner"></div>${esc(window.t('common.loading'))}</div>`;

      try {
        const res = await fetch(`/api/change-events/?tenant_id=${encodeURIComponent(tenantId)}&date=${encodeURIComponent(currentDate)}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderList(data.events || []);
      } catch (e) {
        list.innerHTML = `<div class="panel-error">${esc(window.t('tenant_dashboard.changelog.load_failed', { message: e.message }))}</div>`;
      }
    }

    function renderList(events) {
      const list = document.getElementById('cl-list');
      if (!list) return;
      if (events.length === 0) {
        list.innerHTML = `<div class="cl-empty">
          ${esc(window.t('tenant_dashboard.changelog.empty_title'))}<br>
          <span style="font-size:0.85rem; color:var(--p-text-secondary);">${window.t('tenant_dashboard.changelog.empty_help')}</span>
        </div>`;
        return;
      }
      list.innerHTML = events.map(renderRow).join('');
      list.querySelectorAll('.cl-row').forEach(row => {
        row.addEventListener('click', () => openFormEdit(parseInt(row.dataset.id, 10)));
      });
    }

    function renderRow(ev) {
      const time = new Date(ev.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endTime = ev.ended_at ? ' → ' + new Date(ev.ended_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
      const surfaces = (ev.affected_surface || []).map(s =>
        `<span class="cl-surface-chip">${esc(surfaceLabel(s))}</span>`
      ).join('');
      // Manual events lock 60 minutes after creation — badge tooltip reflects this
      // so operators aren't surprised when clicking a stale row opens a read-only view.
      const srcBadge = ev.source === 'panoptica'
        ? `<span class="cl-source-badge cl-src-panoptica" title="${esc(window.t('tenant_dashboard.changelog.badge.tooltip_panoptica'))}">${esc(window.t('tenant_dashboard.changelog.badge.auto'))}</span>`
        : ev.locked
          ? `<span class="cl-source-badge cl-src-manual" title="${esc(window.t('tenant_dashboard.changelog.badge.tooltip_operator_locked'))}">${esc(window.t('tenant_dashboard.changelog.badge.manual'))}</span>`
          : `<span class="cl-source-badge cl-src-manual" title="${esc(window.t('tenant_dashboard.changelog.badge.tooltip_operator_editable'))}">${esc(window.t('tenant_dashboard.changelog.badge.manual'))}</span>`;
      return `
        <div class="cl-row cl-impact-${esc(ev.impact)}" data-id="${ev.id}">
          <div class="cl-row-time">${esc(time)}${esc(endTime)}</div>
          <div class="cl-row-main">
            <div class="cl-row-cat">
              <span class="cl-impact-dot cl-impact-${esc(ev.impact)}"></span>
              <strong>${esc(categoryLabel(ev.category))}</strong>
              ${srcBadge}
            </div>
            <div class="cl-row-surfaces">${surfaces}</div>
            ${ev.description ? `<div class="cl-row-desc">${esc(ev.description)}</div>` : ''}
            <div class="cl-row-meta">${esc(ev.created_by || window.t('tenant_dashboard.changelog.unknown_author'))}</div>
          </div>
        </div>`;
    }

    // ─── Form open / close ───────────────────────────────────────────
    function openFormNew() {
      // If user hit the header button from another view, flip to Change Log first
      if (currentView !== 'change-log') {
        // re-route through the view toggle so currentView stays in sync
        document.querySelector('#td-view-toggle .td-view-btn[data-view="change-log"]')?.click();
      }
      resetForm();
      document.getElementById('cl-form-title').textContent = window.t('tenant_dashboard.changelog.form_title.log');
      document.getElementById('cl-form-delete').style.display = 'none';
      document.getElementById('cl-form-started').value = toLocalInput(new Date());
      showForm();
    }

    async function openFormEdit(id) {
      try {
        const res = await fetch(`/api/change-events/${id}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const ev = data.event;

        // Panoptica-initiated events get a dedicated read-only panel — not the
        // edit form with disabled inputs. Two paths, zero shared UI beyond the
        // slide-out shell.
        //
        // Locked manual events (past the 60-min edit window) go through the same
        // read-only panel. The audit journal is immutable past the window; the
        // UI reflects that rather than showing an edit form that would fail
        // server-side with EDIT_WINDOW_EXPIRED.
        if (ev.source === 'panoptica' || ev.locked) {
          renderReadonly(ev);
          showReadonly();
          return;
        }

        // Manual event → edit form
        resetForm();
        document.getElementById('cl-form-id').value = ev.id;
        document.getElementById('cl-form-category').value = ev.category;
        (ev.affected_surface || []).forEach(s => {
          const cb = document.querySelector(`#cl-form-surfaces input[value="${s}"]`);
          if (cb) cb.checked = true;
        });
        document.getElementById('cl-form-started').value = toLocalInput(new Date(ev.started_at));
        if (ev.ended_at) document.getElementById('cl-form-ended').value = toLocalInput(new Date(ev.ended_at));
        const impactRadio = document.querySelector(`input[name="cl-impact"][value="${ev.impact}"]`);
        if (impactRadio) impactRadio.checked = true;
        document.getElementById('cl-form-description').value = ev.description || '';
        document.getElementById('cl-form-desc-count').textContent = (ev.description || '').length;

        document.getElementById('cl-form-title').textContent = window.t('tenant_dashboard.changelog.form_title.edit');
        document.getElementById('cl-form-submit').style.display = '';
        document.getElementById('cl-form-delete').style.display = '';

        showForm();
      } catch (e) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_load_event_failed', { message: e.message }), 'error');
      }
    }

    // ─── Read-only renderer (Panoptica-initiated events) ────────────────
    function renderReadonly(ev) {
      // Category heading — past-tense, verbose
      document.getElementById('cl-ro-category').textContent = categoryLabelVerbose(ev.category);

      // Timestamp — long-form local
      const startedAt = new Date(ev.started_at);
      const whenStr = startedAt.toLocaleString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      let whenHtml = esc(whenStr);
      if (ev.ended_at) {
        const endedAt = new Date(ev.ended_at);
        const endStr = endedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        const durMs = endedAt - startedAt;
        const durMin = Math.max(1, Math.round(durMs / 60000));
        const durStr = durMin < 60
          ? `${durMin} min`
          : `${Math.floor(durMin / 60)}h ${durMin % 60}m`;
        whenHtml += ` <span style="color:var(--p-text-secondary);">→ ${esc(endStr)} (${esc(durStr)})</span>`;
      } else {
        whenHtml += ` <span style="color:var(--p-text-secondary); font-size:0.85em;">${esc(window.t('tenant_dashboard.changelog.point_in_time'))}</span>`;
      }
      document.getElementById('cl-ro-when').innerHTML = whenHtml;

      // Impact pill — coloured (translated value already in upper case via locale)
      const impactEl = document.getElementById('cl-ro-impact');
      const impactKey = ev.impact || 'low';
      impactEl.textContent = window.t('tenant_dashboard.changelog.impact.' + impactKey);
      impactEl.className = 'cl-ro-impact-pill cl-ro-impact-' + esc(impactKey);

      // Surfaces — static chips
      const surfaces = ev.affected_surface || [];
      const surfacesEl = document.getElementById('cl-ro-surfaces');
      surfacesEl.innerHTML = surfaces.length === 0
        ? '<span style="color:var(--p-text-secondary);">—</span>'
        : surfaces.map(s => `<span class="cl-ro-surface-chip">${esc(surfaceLabel(s))}</span>`).join('');

      // Author / source
      document.getElementById('cl-ro-author').textContent = ev.created_by || window.t('tenant_dashboard.changelog.unknown_author');

      // Source badge label — three states:
      //   panoptica        → auto-logged by the app
      //   manual + locked  → operator-logged and past the edit window (immutable)
      //   manual + open    → should not reach this renderer (would go to edit form)
      const sourceLabelEl = document.getElementById('cl-ro-source-label');
      if (ev.source === 'panoptica') {
        sourceLabelEl.textContent = window.t('tenant_dashboard.changelog.source.panoptica');
      } else if (ev.locked) {
        sourceLabelEl.textContent = window.t('tenant_dashboard.changelog.source.operator_locked');
      } else {
        sourceLabelEl.textContent = window.t('tenant_dashboard.changelog.source.operator');
      }

      // Governance notice — swap copy by source so it doesn't misrepresent
      // an operator entry as "recorded automatically when Panoptica mutated…".
      const noticeEl = document.getElementById('cl-ro-notice');
      if (noticeEl) {
        if (ev.source === 'panoptica') {
          noticeEl.textContent = window.t('tenant_dashboard.changelog.notice.panoptica');
        } else {
          noticeEl.textContent = window.t('tenant_dashboard.changelog.notice.operator');
        }
      }

      // Description (preserve line breaks; escape HTML)
      const desc = ev.description || '';
      document.getElementById('cl-ro-description').innerHTML = desc
        ? esc(desc).replace(/\n/g, '<br>')
        : `<span style="color:var(--p-text-secondary);">${esc(window.t('tenant_dashboard.changelog.no_description'))}</span>`;

      // Correlation tag — hidden if null (manual events don't have one)
      const ctagSection = document.getElementById('cl-ro-ctag-section');
      if (ev.correlation_tag) {
        document.getElementById('cl-ro-ctag').textContent = ev.correlation_tag;
        ctagSection.style.display = '';
      } else {
        ctagSection.style.display = 'none';
      }
    }

    function resetForm() {
      document.getElementById('cl-form-id').value = '';
      document.getElementById('cl-form-category').value = '';
      document.querySelectorAll('#cl-form-surfaces input').forEach(cb => cb.checked = false);
      document.getElementById('cl-form-started').value = '';
      document.getElementById('cl-form-ended').value = '';
      document.querySelectorAll('input[name="cl-impact"]').forEach(r => { r.checked = false; });
      document.getElementById('cl-form-description').value = '';
      document.getElementById('cl-form-desc-count').textContent = '0';
      document.getElementById('cl-form-submit').style.display = '';
      // No more disabled-input read-only mode — inputs always stay enabled in the edit form.
    }

    function showForm() {
      // Ensure edit form visible, readonly panel hidden.
      const form = document.getElementById('cl-form');
      const ro   = document.getElementById('cl-readonly');
      if (form) form.style.display = '';
      if (ro)   ro.style.display   = 'none';
      document.getElementById('cl-form-overlay').classList.add('active');
      document.getElementById('cl-form-slideout').classList.add('active');
    }

    function showReadonly() {
      // Swap in the readonly panel; hide the edit form so its labels/help text
      // don't bleed through on Panoptica-initiated events.
      document.getElementById('cl-form-title').textContent = window.t('tenant_dashboard.changelog.form_title.readonly');
      const form = document.getElementById('cl-form');
      const ro   = document.getElementById('cl-readonly');
      if (form) form.style.display = 'none';
      if (ro)   ro.style.display   = '';
      document.getElementById('cl-form-overlay').classList.add('active');
      document.getElementById('cl-form-slideout').classList.add('active');
    }

    function closeForm() {
      document.getElementById('cl-form-overlay').classList.remove('active');
      document.getElementById('cl-form-slideout').classList.remove('active');
    }

    // ─── Submit / delete ─────────────────────────────────────────────
    async function submitForm() {
      const id = document.getElementById('cl-form-id').value;
      const category = document.getElementById('cl-form-category').value;
      const surfaces = Array.from(document.querySelectorAll('#cl-form-surfaces input:checked')).map(i => i.value);
      const startedRaw = document.getElementById('cl-form-started').value;
      const endedRaw = document.getElementById('cl-form-ended').value;
      const impact = document.querySelector('input[name="cl-impact"]:checked')?.value || null;
      const description = document.getElementById('cl-form-description').value.trim();

      if (!category) return Panoptica.showToast(window.t('tenant_dashboard.toast_category_required'), 'error');
      if (surfaces.length === 0) return Panoptica.showToast(window.t('tenant_dashboard.toast_surface_required'), 'error');
      if (!startedRaw) return Panoptica.showToast(window.t('tenant_dashboard.toast_started_required'), 'error');
      if (!impact) return Panoptica.showToast(window.t('tenant_dashboard.toast_impact_required'), 'error');

      const body = {
        tenant_id: tenantId,
        category,
        affected_surface: surfaces,
        started_at: new Date(startedRaw).toISOString(),
        ended_at: endedRaw ? new Date(endedRaw).toISOString() : null,
        impact,
        description: description || null,
      };

      const submitBtn = document.getElementById('cl-form-submit');
      submitBtn.disabled = true;
      try {
        const url = id ? `/api/change-events/${id}` : '/api/change-events/';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + res.status);
        }
        Panoptica.showToast(window.t(id ? 'tenant_dashboard.toast_event_updated' : 'tenant_dashboard.toast_event_logged'), 'success');
        closeForm();
        // If the saved event is on a different day, jump to that day.
        const savedDay = body.started_at.substring(0, 10);
        if (savedDay !== currentDate) setDate(savedDay);
        else loadEvents();
      } catch (e) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_event_save_failed', { message: e.message }), 'error');
      } finally {
        submitBtn.disabled = false;
      }
    }

    async function deleteEvent() {
      const id = document.getElementById('cl-form-id').value;
      if (!id) return;
      if (!confirm(window.t('tenant_dashboard.confirm_delete_event'))) return;
      try {
        const res = await fetch(`/api/change-events/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + res.status);
        }
        Panoptica.showToast(window.t('tenant_dashboard.toast_event_deleted'), 'success');
        closeForm();
        loadEvents();
      } catch (e) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_event_delete_failed', { message: e.message }), 'error');
      }
    }

    // ─── Helpers ─────────────────────────────────────────────────────
    function todayStr() { return toDateStr(new Date()); }
    function toDateStr(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    function toLocalInput(d) {
      // Format Date object as datetime-local string (YYYY-MM-DDTHH:MM)
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }
    function categoryLabel(c) {
      // Map raw event categories to i18n key slugs. Two legacy aliases
      // (exemption_apply / exemption_revoke) are normalized to the slug names.
      const slugMap = {
        ca_deploy: 'ca_deploy', ca_retire: 'ca_retire', ca_edit: 'ca_edit',
        intune_push: 'intune_push', intune_retire: 'intune_retire', intune_edit: 'intune_edit',
        named_location: 'named_location',
        exemption: 'exemption',               // legacy, kept for backward-compat
        exemption_apply: 'exemption_applied',
        exemption_revoke: 'exemption_revoked',
        remediation: 'remediation',
        manual_cleanup: 'manual_cleanup', incident_response: 'incident_response',
        migration: 'migration', other: 'other',
      };
      const slug = slugMap[c];
      return slug ? window.t('tenant_dashboard.changelog.category.' + slug) : c;
    }
    // Verbose labels for the read-only panel heading (past-tense, commercial-grade)
    function categoryLabelVerbose(c) {
      const slugMap = {
        ca_deploy: 'ca_deploy', ca_retire: 'ca_retire', ca_edit: 'ca_edit',
        intune_push: 'intune_push', intune_retire: 'intune_retire', intune_edit: 'intune_edit',
        named_location: 'named_location',
        exemption: 'exemption',
        exemption_apply: 'exemption_applied',
        exemption_revoke: 'exemption_revoked',
        remediation: 'remediation',
        manual_cleanup: 'manual_cleanup',
        incident_response: 'incident_response',
        migration: 'migration',
        other: 'other',
      };
      const slug = slugMap[c];
      return slug ? window.t('tenant_dashboard.changelog.category_verbose.' + slug) : categoryLabel(c);
    }
    function surfaceLabel(s) {
      const slugMap = {
        ca: 'ca', intune: 'intune', identity: 'identity', mfa: 'mfa',
        named_locations: 'named_loc', sharepoint: 'sharepoint',
        exchange: 'exchange', devices: 'devices', other: 'other',
      };
      const slug = slugMap[s];
      return slug ? window.t('tenant_dashboard.changelog.surface.' + slug) : s;
    }

    /**
     * Open a specific change event by id. Used by the per-alert breadcrumb
     * navigation from the global Alerts page (Apr 28, 2026). Fetches the
     * event metadata first to resolve its date, switches to the change-log
     * view, sets currentDate to the event's day, then opens the readonly
     * panel via the standard openFormEdit path.
     */
    async function openById(id) {
      try {
        const res = await fetch(`/api/change-events/${id}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const ev = data.event;
        if (!ev) throw new Error('Event payload missing');

        // Switch to the change-log view if not already.
        if (currentView !== 'change-log') {
          document.querySelector('#td-view-toggle .td-view-btn[data-view="change-log"]')?.click();
        }
        // Snap currentDate to the event's day so the surrounding list reflects context.
        const eventDay = ev.started_at ? toDateStr(new Date(ev.started_at)) : todayStr();
        setDate(eventDay);
        // openFormEdit re-fetches but that's fine — keeps the path uniform.
        openFormEdit(id);
      } catch (e) {
        Panoptica.showToast(window.t('tenant_dashboard.toast_open_event_failed', { message: e.message }), 'error');
      }
    }

    return { wire, show, openById };
  })();

  window.PanopticaPage = {
    init, destroy,
    checkDrift, checkAllDrift, remediate, autoMatch, removeAssignment,
    showAssignModal: showAssignModal,
    hideAssignModal,
    assignTemplate,
    loadIntuneDeployments,
    showIntuneAddModal,
    hideIntuneAddModal,
  };
})();
