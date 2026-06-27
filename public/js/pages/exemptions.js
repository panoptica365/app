/**
 * Panoptica — Unified Exemptions Page Script
 *
 * Shows all Panoptica-granted exceptions across CA and Intune in one
 * list:
 *   - CA     → per-principal carve-outs (ca_exemptions rows)
 *   - Intune → policy-wide accepted drifts (intune_deployments rows with
 *              drift_status='accepted')
 *
 * Backend: GET /api/exemptions (unified), with source-dispatched revoke:
 *   - CA     → POST /api/ca/exemptions/:id/revoke
 *   - Intune → POST /api/intune/accepted-drift/:id/revoke
 *
 * Revoke forces the next drift cycle to re-raise the drift so the
 * operator is prompted to re-review or re-sync.
 */
(function () {
  'use strict';

  let exemptions = [];
  let tenants = [];
  let tenantFilter = '';
  let sourceFilter = '';       // '', 'ca', 'intune'
  let includeRevoked = false;

  async function init() {
    document.getElementById('exm-tenant-filter')
      .addEventListener('change', (e) => { tenantFilter = e.target.value; reload(); });
    document.getElementById('exm-source-filter')
      .addEventListener('change', (e) => { sourceFilter = e.target.value; reload(); });
    document.getElementById('exm-include-revoked')
      .addEventListener('change', (e) => { includeRevoked = e.target.checked; reload(); });

    await loadTenants();
    populateTenantFilter();
    await loadExemptions();
  }

  function destroy() {
    exemptions = [];
    tenants = [];
    tenantFilter = '';
    sourceFilter = '';
    includeRevoked = false;
  }

  // ─── Data loading ───

  async function loadTenants() {
    try {
      tenants = await Panoptica.api('/api/tenants');
    } catch (err) {
      console.error('[Exemptions] Failed to load tenants:', err);
      tenants = [];
    }
  }

  function populateTenantFilter() {
    const select = document.getElementById('exm-tenant-filter');
    const current = select.value;
    select.innerHTML = `<option value="">${esc(window.t('exemptions.filter_all_tenants'))}</option>` +
      tenants.map(t => `<option value="${t.id}">${esc(t.display_name)}</option>`).join('');
    select.value = current;
  }

  async function loadExemptions() {
    const container = document.getElementById('exm-list-container');
    container.innerHTML = `<div class="loading-container"><div class="loading-spinner"></div>${esc(window.t('exemptions.loading'))}</div>`;
    try {
      const qs = new URLSearchParams();
      if (tenantFilter) qs.set('tenant_id', tenantFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      if (includeRevoked) qs.set('include_revoked', '1');
      const url = '/api/exemptions' + (qs.toString() ? '?' + qs.toString() : '');
      const result = await Panoptica.api(url);
      exemptions = (result && result.exemptions) || [];
      render();
    } catch (err) {
      console.error('[Exemptions] Load failed:', err);
      container.innerHTML = `<div class="panel-error">${esc(window.t('exemptions.panel_load_failed'))}</div>`;
    }
  }

  async function reload() {
    await loadExemptions();
  }

  // ─── Rendering ───

  function render() {
    const container = document.getElementById('exm-list-container');
    const countEl = document.getElementById('exm-count');

    const active = exemptions.filter(e => !e.revoked_at && (e.days_remaining == null || e.days_remaining > 0));
    countEl.textContent = includeRevoked
      ? window.t('exemptions.count_total_with_active', { total: exemptions.length, active: active.length })
      : window.t('exemptions.count_active', { count: exemptions.length });

    if (exemptions.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--p-text-muted);">
          <div style="font-size:1.1rem; margin-bottom:8px;">${esc(window.t('exemptions.empty_title'))}</div>
          <div style="font-size:0.85rem; max-width:560px; margin:0 auto;">${window.t('exemptions.empty_desc_html')}</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="alert-table">
        <thead>
          <tr>
            <th></th>
            <th>${esc(window.t('exemptions.col_source'))}</th>
            <th>${esc(window.t('exemptions.col_tenant'))}</th>
            <th>${esc(window.t('exemptions.col_template'))}</th>
            <th>${esc(window.t('exemptions.col_scope'))}</th>
            <th>${esc(window.t('exemptions.col_reason'))}</th>
            <th>${esc(window.t('exemptions.col_accepted_by'))}</th>
            <th>${esc(window.t('exemptions.col_accepted'))}</th>
            <th>${esc(window.t('exemptions.col_expires'))}</th>
            <th>${esc(window.t('exemptions.col_days_left'))}</th>
            <th style="text-align:right;">${esc(window.t('exemptions.col_actions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${exemptions.map(renderRow).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('button[data-action="revoke"]').forEach(btn => {
      btn.addEventListener('click', () => revoke(btn.dataset.source, parseInt(btn.dataset.id, 10)));
    });
    container.querySelectorAll('button[data-action="toggle-suppressions"]').forEach(btn => {
      btn.addEventListener('click', () => toggleSuppressions(parseInt(btn.dataset.id, 10), btn));
    });
  }

  function renderRow(e) {
    const status = statusOf(e);
    const sourceBadge = renderSourceBadge(e.source);
    const scopeCell = renderScopeCell(e);
    const daysCell = renderDaysCell(e, status);
    const expiresCell = e.expires_at
      ? fmtDate(e.expires_at)
      : `<span style="color:var(--p-text-muted); font-style:italic;">${esc(window.t('exemptions.expires_never'))}</span>`;

    const actions = status === 'active'
      ? `<button class="btn-danger" data-role-required="member" data-action="revoke" data-source="${e.source}" data-id="${e.id}" style="padding:4px 10px; font-size:0.8rem;">${esc(window.t('exemptions.btn_revoke'))}</button>`
      : `<span style="color:var(--p-text-muted); font-size:0.8rem;">&mdash;</span>`;

    const rowStyle = status === 'active' ? '' : 'opacity:0.6;';

    // Suppression chevron — only for CA exemptions, only when count > 0.
    // Apr 28, 2026: surfaces alerts_suppressed audit trail in a row drawer.
    let suppressionToggle = '';
    if (e.source === 'ca' && (e.suppression_count || 0) > 0) {
      suppressionToggle = `
        <button class="exm-suppression-toggle" data-action="toggle-suppressions" data-id="${e.id}"
                title="${esc(window.t('exemptions.view_suppressed_title'))}" aria-expanded="false"
                style="background:none; border:1px solid var(--p-border); color:var(--p-text-muted); padding:2px 6px; border-radius:3px; font-size:0.75rem; cursor:pointer;">
          <span class="exm-chevron">▶</span> ${e.suppression_count}
        </button>`;
    } else if (e.source === 'ca') {
      suppressionToggle = '<span style="color:var(--p-text-muted); font-size:0.75rem;">0</span>';
    } else if (e.source === 'alert_rule') {
      // alert_rule.suppression_count is the rule's match_count — number of
      // alerts auto-resolved. No drawer endpoint yet (Phase 1); the rows
      // are in the alerts table with resolution_rule_id = this rule's id.
      const n = e.suppression_count || 0;
      suppressionToggle = `<span title="${esc(window.t('exemptions.auto_resolved_title'))}" style="color:var(--p-text-muted); font-size:0.75rem;">${n}</span>`;
    } else {
      suppressionToggle = '<span style="color:var(--p-text-muted); font-size:0.75rem;">—</span>';
    }

    return `
      <tr id="exm-row-${e.source}-${e.id}" data-source="${e.source}" data-id="${e.id}" style="${rowStyle}">
        <td style="text-align:center;">${suppressionToggle}</td>
        <td>${sourceBadge}</td>
        <td>${esc(e.tenant_name || '')}</td>
        <td>${esc(e.template_name || '')}</td>
        <td>${scopeCell}</td>
        <td style="max-width:260px;">${esc(e.reason || '')}</td>
        <td>${esc(e.accepted_by || '')}</td>
        <td>${fmtDate(e.accepted_at)}</td>
        <td>${expiresCell}</td>
        <td>${daysCell}</td>
        <td style="text-align:right;">${actions}</td>
      </tr>
    `;
  }

  function renderSourceBadge(source) {
    if (source === 'intune') {
      return `<span style="background:#4a5b7a; color:#e8edf5; padding:2px 8px; border-radius:3px; font-size:0.75rem; font-weight:600;">${esc(window.t('exemptions.badge_intune'))}</span>`;
    }
    if (source === 'alert_rule') {
      return `<span style="background:#7a5a3a; color:#f5ebe0; padding:2px 8px; border-radius:3px; font-size:0.75rem; font-weight:600;">${esc(window.t('exemptions.badge_alert_rule'))}</span>`;
    }
    return `<span style="background:#3a6b5a; color:#e8f5ed; padding:2px 8px; border-radius:3px; font-size:0.75rem; font-weight:600;">${esc(window.t('exemptions.badge_ca'))}</span>`;
  }

  function renderScopeCell(e) {
    if (e.source === 'intune') {
      return `<span style="color:var(--p-text-muted); font-style:italic;">${esc(window.t('exemptions.scope_policy_wide'))}</span>`;
    }
    if (e.source === 'alert_rule') {
      const scopeBadge = e.all_tenants
        ? `<span style="background:var(--p-accent-muted); color:var(--p-accent-light); padding:1px 6px; border-radius:3px; font-size:0.7rem; margin-left:4px;">${esc(window.t('exemptions.alert_scope_all'))}</span>`
        : `<span style="background:var(--p-surface-sunken); color:var(--p-text-muted); padding:1px 6px; border-radius:3px; font-size:0.7rem; margin-left:4px;">${esc(window.t('exemptions.alert_scope_tenant'))}</span>`;
      // Defender alert-type rule (#7/#23): show the alert type + scope badge.
      if (e.match_alert_type) {
        return `<code style="font-size:0.75rem;">${esc(e.match_alert_type)}</code>${scopeBadge}`;
      }
      // Policy-level rule (#7/#23): whole category, no UPN. Show "entire policy".
      if (!e.match_upn) {
        return `<span style="font-style:italic;">${esc(window.t('exemptions.alert_entire_policy'))}</span>${scopeBadge}`;
      }
      // UPN rule: principal_label is composed server-side as "upn / country / cidr"
      const parts = [];
      parts.push(`<code style="font-size:0.78rem;">${esc(e.match_upn || '')}</code>`);
      if (e.match_country) {
        parts.push(`<span style="background:var(--p-surface-sunken); color:var(--p-text-muted); padding:1px 6px; border-radius:3px; font-size:0.7rem;">${esc(e.match_country)}</span>`);
      } else {
        parts.push(`<span style="color:var(--p-text-muted); font-style:italic; font-size:0.75rem;">${esc(window.t('exemptions.alert_any_country'))}</span>`);
      }
      if (e.match_ip_cidr) {
        parts.push(`<code style="font-size:0.72rem; color:var(--p-text-muted);">${esc(e.match_ip_cidr)}</code>`);
      }
      return parts.join(' ');
    }
    const badge = e.principal_type === 'group'
      ? `<span style="background:var(--p-accent-muted); color:var(--p-accent-light); padding:1px 6px; border-radius:3px; font-size:0.7rem; margin-left:4px;">${esc(window.t('exemptions.scope_group'))}</span>`
      : `<span style="background:var(--p-surface-sunken); color:var(--p-text-muted); padding:1px 6px; border-radius:3px; font-size:0.7rem; margin-left:4px;">${esc(window.t('exemptions.scope_user'))}</span>`;
    return `${esc(e.principal_label || e.principal_id || '')}${badge}`;
  }

  function statusOf(e) {
    if (e.revoked_at) return 'revoked';
    if (e.days_remaining != null && e.days_remaining <= 0) return 'expired';
    return 'active';
  }

  function renderDaysCell(e, status) {
    if (status === 'revoked') {
      return `<span style="color:var(--p-text-muted);">${esc(window.t('exemptions.status_revoked_format', { date: fmtDate(e.revoked_at) }))}</span>`;
    }
    if (status === 'expired') {
      return `<span style="color:var(--status-critical, #c44);">${esc(window.t('exemptions.status_expired'))}</span>`;
    }
    const d = e.days_remaining;
    if (d == null) {
      return `<span style="color:var(--p-text-muted); font-style:italic;">${esc(window.t('exemptions.status_no_expiry'))}</span>`;
    }
    if (d <= 7) {
      return `<span style="color:var(--status-warning, #d80); font-weight:bold;">${d}d</span>`;
    }
    if (d <= 30) {
      return `<span style="color:var(--status-warning, #d80);">${d}d</span>`;
    }
    return `<span style="color:var(--p-text);">${d}d</span>`;
  }

  // ─── Suppressions drawer ───
  // Lazy-fetch on click. Drawer row inserted directly after the parent row.
  // Subsequent toggle removes/re-shows the cached drawer. We don't paginate —
  // server caps at 200 rows, which is plenty for an audit drawer.

  const suppressionsCache = new Map(); // key: ca exemption id, val: array of rows

  async function toggleSuppressions(exemptionId, btn) {
    const drawerId = `exm-suppressions-${exemptionId}`;
    const existing = document.getElementById(drawerId);
    const chevron = btn.querySelector('.exm-chevron');

    if (existing) {
      existing.remove();
      btn.setAttribute('aria-expanded', 'false');
      if (chevron) chevron.textContent = '▶';
      return;
    }

    btn.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.textContent = '▼';

    let rows;
    if (suppressionsCache.has(exemptionId)) {
      rows = suppressionsCache.get(exemptionId);
    } else {
      try {
        const resp = await Panoptica.api(`/api/exemptions/ca/${exemptionId}/suppressions`);
        rows = (resp && resp.suppressions) || [];
        suppressionsCache.set(exemptionId, rows);
      } catch (err) {
        Panoptica.showToast(window.t('exemptions.toast_load_suppressions_failed', { message: err.message }), 'error');
        if (chevron) chevron.textContent = '▶';
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
    }

    const parentRow = document.getElementById(`exm-row-ca-${exemptionId}`);
    if (!parentRow) return;
    const colspan = parentRow.cells.length;

    const drawer = document.createElement('tr');
    drawer.id = drawerId;
    drawer.className = 'exm-suppressions-drawer';
    drawer.innerHTML = `
      <td colspan="${colspan}" style="background:var(--p-surface-2); padding:0;">
        ${renderSuppressionsList(rows)}
      </td>
    `;
    parentRow.parentNode.insertBefore(drawer, parentRow.nextSibling);
  }

  function renderSuppressionsList(rows) {
    if (rows.length === 0) {
      return `<div style="padding:12px 18px; color:var(--p-text-muted); font-size:0.85rem; font-style:italic;">No alerts have been suppressed by this exemption yet.</div>`;
    }
    const head = `
      <table class="alert-table" style="background:transparent; margin:0;">
        <thead>
          <tr>
            <th style="width:160px;">Suppressed at</th>
            <th>Policy</th>
            <th>Evaluator</th>
            <th>Control dimension</th>
            <th>UPN / target</th>
            <th>Event preview</th>
          </tr>
        </thead>
        <tbody>`;
    const body = rows.map(r => `
      <tr>
        <td style="white-space:nowrap;">${fmtDateTime(r.suppressed_at)}</td>
        <td>${esc(r.policy_name || '#' + r.policy_id)}</td>
        <td><code style="font-size:0.78rem;">${esc(r.evaluator)}</code></td>
        <td>${esc(r.control_dimension || '')}</td>
        <td>${esc(r.upn || '')}</td>
        <td style="max-width:380px; font-size:0.75rem; color:var(--p-text-muted); font-family:var(--font-mono, monospace);">${esc(truncate(r.event_snippet || '', 220))}</td>
      </tr>
    `).join('');
    return head + body + '</tbody></table>';
  }

  function fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length <= n ? s : s.substring(0, n - 1) + '…';
  }

  // ─── Revoke ───

  async function revoke(source, id) {
    const e = exemptions.find(x => x.source === source && x.id === id);
    if (!e) return;

    let who;
    if (source === 'intune') who = `"${e.template_name}" at ${e.tenant_name}`;
    else if (source === 'alert_rule') {
      who = `${e.match_upn}${e.match_country ? ' / ' + e.match_country : ''} on "${e.template_name}"`;
    }
    else who = (e.principal_label || e.principal_id);
    const consequenceKey = source === 'intune'
      ? 'exemptions.consequence_intune'
      : (source === 'alert_rule'
        ? 'exemptions.consequence_alert_rule'
        : 'exemptions.consequence_ca');
    const consequence = window.t(consequenceKey);

    if (!(await Panoptica.confirmModal(window.t('exemptions.confirm_revoke', { who, consequence }), { danger: true }))) return;

    let url;
    let method = 'POST';
    if (source === 'intune') {
      url = `/api/intune/accepted-drift/${id}/revoke`;
    } else if (source === 'alert_rule') {
      url = `/api/alert-exemptions/${id}?reason=manual`;
      method = 'DELETE';
    } else {
      url = `/api/ca/exemptions/${id}/revoke`;
    }

    try {
      const result = await Panoptica.api(url, { method });
      if (result && result.ok) {
        Panoptica.showToast(window.t('exemptions.toast_revoked'), 'success');
        await reload();
      } else {
        Panoptica.showToast(window.t('exemptions.toast_revoke_failed', { message: (result && result.error) ? result.error : 'Unknown error' }), 'error');
      }
    } catch (err) {
      Panoptica.showToast(window.t('exemptions.toast_revoke_failed', { message: err.message }), 'error');
    }
  }

  // ─── Helpers ───

  function esc(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA');
  }

  // ─── Expose ───
  window.PanopticaPage = { init, destroy };
})();
