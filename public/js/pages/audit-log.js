/**
 * Panoptica365 — SYSTEM > Audit Log (Admin-only)
 *
 * Thin read-only UI over /api/msp-audit. No mutation. Rows are append-only.
 *
 * RBAC: the partial route (/partials/audit-log) and the API (/api/msp-audit)
 * both enforce requireAdmin server-side. This JS assumes it's only ever
 * loaded for an admin — if a non-admin navigates here directly, the partial
 * fetch will 403 and the SPA router should render the error. We do NOT rely
 * on this JS for security; defense-in-depth only.
 */
(function () {
  'use strict';

  // Two views share this page: 'msp' is the original MSP-only audit timeline;
  // 'unified' interleaves tenant_change_events with msp_audit_events for a
  // cross-surface admin timeline. The tenant-only per-tenant Change Log stays
  // on each tenant's dashboard (operator/reader access); unified is additive
  // for admins.
  const state = {
    currentView: 'msp', // 'msp' | 'unified'
    filters: {
      category: '',
      actor: '',
      q: '',
      from: '',
      to: '',
      success: '',
    },
    unifiedFilters: {
      source: 'all',
      tenant_id: '',
      q: '',
      from: '',
      to: '',
    },
    unifiedTenantOptions: [], // cached {id, display_name} list for the picker
    page: 0,
    pageSize: 100,
    total: 0,
  };

  // ─── Utilities ───

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
    } catch { return String(iso); }
  }

  function categoryLabel(c) {
    return {
      // msp_audit_events categories
      auth:                 'Auth',
      template_crud:        'Template CRUD',
      rbac_change:          'RBAC',
      settings_change:      'Settings',
      tenant_lifecycle_msp: 'Tenant',
      export:               'Export',
      other:                'Other',
      // tenant_change_events categories (surfaced via unified view)
      ca_deploy:            'CA deploy',
      ca_retire:            'CA retire',
      ca_edit:              'CA edit',
      intune_push:          'Intune push',
      intune_retire:        'Intune retire',
      intune_edit:          'Intune edit',
      named_location:       'Named location',
      exemption:            'Exemption',
      exemption_apply:      'Exemption apply',
      exemption_revoke:     'Exemption revoke',
      remediation:          'Remediation',
      manual_cleanup:       'Manual cleanup',
      incident_response:    'Incident response',
      migration:            'Migration',
    }[c] || c;
  }

  function categoryColor(c) {
    // Token-aligned with panoptica-dark theme. Keep muted — this is a dense table.
    return {
      // msp
      auth:                 '#6fa8dc',
      template_crud:        '#93c47d',
      rbac_change:          '#e06666',
      settings_change:      '#ffd966',
      tenant_lifecycle_msp: '#c27ba0',
      export:               '#76a5af',
      other:                '#999999',
      // tenant_change_events — reuse the palette (CA = green, Intune = purple,
      // location/exemption/remediation = warm, incident = red) so colors
      // convey rough domain intuition without needing a legend.
      ca_deploy:            '#93c47d',
      ca_retire:            '#93c47d',
      ca_edit:              '#93c47d',
      intune_push:          '#c27ba0',
      intune_retire:        '#c27ba0',
      intune_edit:          '#c27ba0',
      named_location:       '#ffd966',
      exemption:            '#ffd966',
      exemption_apply:      '#ffd966',
      exemption_revoke:     '#ffd966',
      remediation:          '#76a5af',
      incident_response:    '#e06666',
      manual_cleanup:       '#999999',
      migration:            '#999999',
    }[c] || '#999';
  }

  // ─── API ───

  async function fetchSummary() {
    try {
      const r = await fetch('/api/msp-audit/summary?days=30', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`Summary ${r.status}`);
      return await r.json();
    } catch (err) {
      console.warn('[AuditLog] summary fetch failed:', err.message);
      return null;
    }
  }

  async function fetchEvents() {
    // Dispatch by current view — each view hits its own endpoint with its
    // own filter shape, but pagination + the renderRows surface are shared.
    if (state.currentView === 'unified') {
      return fetchUnifiedEvents();
    }
    return fetchMspEvents();
  }

  // Filter-only param builders (no limit/offset) — shared by the paged fetch
  // and the export fetch-all loop so the two can never drift apart.
  function mspFilterParams() {
    const params = new URLSearchParams();
    const f = state.filters;
    if (f.category)    params.set('category', f.category);
    if (f.actor)       params.set('actor', f.actor);
    if (f.q)           params.set('q', f.q);
    if (f.from)        params.set('from', new Date(f.from).toISOString());
    if (f.to)          params.set('to', new Date(f.to).toISOString());
    if (f.success)     params.set('success', f.success);
    return params;
  }

  function unifiedFilterParams() {
    const params = new URLSearchParams();
    const f = state.unifiedFilters;
    if (f.source && f.source !== 'all') params.set('source', f.source);
    if (f.tenant_id) params.set('tenant_id', f.tenant_id);
    if (f.q)         params.set('q', f.q);
    if (f.from)      params.set('from', new Date(f.from).toISOString());
    if (f.to)        params.set('to', new Date(f.to).toISOString());
    return params;
  }

  async function fetchMspEvents() {
    const params = mspFilterParams();
    params.set('limit', String(state.pageSize));
    params.set('offset', String(state.page * state.pageSize));

    const r = await fetch(`/api/msp-audit/events?${params.toString()}`, { credentials: 'same-origin' });
    if (r.status === 403) {
      throw new Error('Admin role required to view the audit log.');
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  async function fetchUnifiedEvents() {
    const params = unifiedFilterParams();
    params.set('limit', String(state.pageSize));
    params.set('offset', String(state.page * state.pageSize));

    const r = await fetch(`/api/msp-audit/unified?${params.toString()}`, { credentials: 'same-origin' });
    if (r.status === 403) {
      throw new Error('Admin role required to view the audit log.');
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  async function fetchTenantList() {
    try {
      const r = await fetch('/api/tenants', { credentials: 'same-origin' });
      if (!r.ok) return [];
      const list = await r.json();
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  // ─── Export (all rows matching the active filters, across pages) ───

  const EXPORT_PAGE = 500;
  const EXPORT_CAP = 50000;

  function sourceLabel(src) {
    return src === 'msp' ? window.t('audit_log.detail_source_msp')
      : src === 'tenant-auto' ? window.t('audit_log.detail_source_tenant_auto')
      : src === 'tenant-manual' ? window.t('audit_log.detail_source_tenant_manual')
      : (src || window.t('audit_log.detail_source_unknown'));
  }

  // Page through the active view's endpoint until a short page comes back,
  // accumulating every row. Capped at EXPORT_CAP (caller surfaces if hit) so a
  // pathological log volume can't lock up the browser.
  async function fetchAllAuditRows() {
    const isUnified = state.currentView === 'unified';
    const base = isUnified ? '/api/msp-audit/unified' : '/api/msp-audit/events';
    const filters = isUnified ? unifiedFilterParams() : mspFilterParams();
    const all = [];
    let offset = 0;
    let capped = false;
    for (;;) {
      const params = new URLSearchParams(filters);
      params.set('limit', String(EXPORT_PAGE));
      params.set('offset', String(offset));
      const r = await fetch(`${base}?${params.toString()}`, { credentials: 'same-origin' });
      if (r.status === 403) throw new Error('Admin role required to view the audit log.');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const rows = data.rows || [];
      all.push(...rows);
      if (rows.length < EXPORT_PAGE) break;
      offset += EXPORT_PAGE;
      if (all.length >= EXPORT_CAP) { capped = true; break; }
    }
    return { rows: all, capped };
  }

  async function exportCsv() {
    if (!window.Panoptica || !window.Panoptica.downloadCsv) return;
    const btn = document.getElementById('audit-export');
    const isUnified = state.currentView === 'unified';
    const toast = (msg, type) => { if (window.Panoptica.showToast) window.Panoptica.showToast(msg, type); };
    if (btn) btn.disabled = true;
    try {
      const { rows, capped } = await fetchAllAuditRows();
      if (rows.length === 0) { toast(window.t('audit_log.export_empty'), 'info'); return; }
      const outcome = (success) => success ? window.t('audit_log.outcome_success') : window.t('audit_log.outcome_failure');
      let csvRows;
      if (isUnified) {
        csvRows = [[
          window.t('audit_log.col_when'), window.t('audit_log.col_source'),
          window.t('audit_log.col_category'), window.t('audit_log.col_actor_tenant'),
          window.t('audit_log.col_description'), window.t('audit_log.col_outcome'),
        ]];
        rows.forEach(r => {
          const actorOrTenant = r.source === 'msp'
            ? (r.actor || '')
            : (r.tenant_name || (r.tenant_id ? `(tenant #${r.tenant_id})` : ''));
          csvRows.push([
            formatWhen(r.timestamp), sourceLabel(r.source), categoryLabel(r.category),
            actorOrTenant, r.description || '', r.source === 'msp' ? outcome(r.success) : '',
          ]);
        });
      } else {
        csvRows = [[
          window.t('audit_log.col_when'), window.t('audit_log.col_category'),
          window.t('audit_log.col_action'), window.t('audit_log.col_actor'),
          window.t('audit_log.col_description'), window.t('audit_log.col_outcome'),
        ]];
        rows.forEach(r => {
          csvRows.push([
            formatWhen(r.created_at), categoryLabel(r.category), r.action || '',
            r.actor_email || '', r.description || '', outcome(r.success),
          ]);
        });
      }
      const view = isUnified ? 'unified' : 'msp';
      window.Panoptica.downloadCsv(csvRows, `audit_${view}_${new Date().toISOString().slice(0, 10)}.csv`);
      if (capped) toast(window.t('audit_log.export_capped', { count: EXPORT_CAP }), 'error');
    } catch (err) {
      toast(window.t('audit_log.export_failed', { message: err.message }), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─── Rendering ───

  function renderSummary(summary) {
    const el = document.getElementById('audit-summary');
    if (!el) return;

    if (!summary) {
      el.innerHTML = '';
      return;
    }

    const cards = [];
    cards.push(`
      <div class="audit-summary-card" style="padding:10px 12px;border:1px solid var(--p-border);border-radius:6px;background:var(--p-panel-bg);">
        <div style="font-size:0.7rem;color:var(--p-text-muted);text-transform:uppercase;letter-spacing:1px;">Events · 30d</div>
        <div style="font-size:1.4rem;font-weight:600;margin-top:2px;">${esc(summary.total)}</div>
      </div>
    `);
    cards.push(`
      <div class="audit-summary-card" style="padding:10px 12px;border:1px solid var(--p-border);border-radius:6px;background:var(--p-panel-bg);">
        <div style="font-size:0.7rem;color:var(--p-text-muted);text-transform:uppercase;letter-spacing:1px;">Failures · 30d</div>
        <div style="font-size:1.4rem;font-weight:600;margin-top:2px;color:${summary.failures > 0 ? '#e06666' : 'inherit'};">${esc(summary.failures)}</div>
      </div>
    `);
    for (const bc of (summary.by_category || []).slice(0, 5)) {
      cards.push(`
        <div class="audit-summary-card" style="padding:10px 12px;border:1px solid var(--p-border);border-radius:6px;background:var(--p-panel-bg);">
          <div style="font-size:0.7rem;color:var(--p-text-muted);text-transform:uppercase;letter-spacing:1px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${categoryColor(bc.category)};margin-right:4px;vertical-align:middle;"></span>
            ${esc(categoryLabel(bc.category))}
          </div>
          <div style="font-size:1.4rem;font-weight:600;margin-top:2px;">${esc(bc.count)}</div>
        </div>
      `);
    }
    el.innerHTML = cards.join('');
  }

  function renderRows(data) {
    const tbody = document.getElementById('audit-rows');
    const countLabel = document.getElementById('audit-count-label');
    const prevBtn = document.getElementById('audit-prev');
    const nextBtn = document.getElementById('audit-next');

    state.total = data.total || 0;
    const start = state.page * state.pageSize;
    const end = Math.min(start + (data.rows?.length || 0), state.total);

    if (countLabel) {
      countLabel.textContent = state.total === 0
        ? 'No events match the current filters.'
        : `Showing ${start + 1}–${end} of ${state.total}`;
    }

    if (prevBtn) prevBtn.disabled = state.page === 0;
    if (nextBtn) nextBtn.disabled = end >= state.total;

    if (!tbody) return;
    if (state.currentView === 'unified') {
      renderUnifiedRows(tbody, data);
    } else {
      renderMspRows(tbody, data);
    }
  }

  function renderMspRows(tbody, data) {
    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--p-text-muted);">No events.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.rows.map(r => `
      <tr data-event-id="${esc(r.id)}" style="cursor:pointer;border-top:1px solid var(--p-border);${r.success ? '' : 'background:rgba(224,102,102,0.06);'}">
        <td style="padding:8px 12px;font-size:0.82rem;white-space:nowrap;color:var(--p-text-muted);">${esc(formatWhen(r.created_at))}</td>
        <td style="padding:8px 12px;font-size:0.82rem;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${categoryColor(r.category)};margin-right:6px;vertical-align:middle;"></span>
          ${esc(categoryLabel(r.category))}
        </td>
        <td style="padding:8px 12px;font-size:0.82rem;font-family:var(--p-font-mono, monospace);">${esc(r.action)}</td>
        <td style="padding:8px 12px;font-size:0.82rem;">
          ${esc(r.actor_email || '—')}
          ${r.actor_role ? `<span style="font-size:0.7rem;color:var(--p-text-muted);margin-left:4px;">[${esc(r.actor_role)}]</span>` : ''}
        </td>
        <td style="padding:8px 12px;font-size:0.82rem;">${esc(r.description)}</td>
        <td style="padding:8px 12px;font-size:0.82rem;">
          ${r.success
            ? '<span style="color:#93c47d;">✓</span>'
            : '<span style="color:#e06666;">✗ Failed</span>'}
        </td>
      </tr>
    `).join('');

    // Row click → detail panel
    tbody.querySelectorAll('tr[data-event-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-event-id');
        const row = data.rows.find(r => String(r.id) === String(id));
        if (row) openDetail(row);
      });
    });
  }

  function sourceBadge(src) {
    // Compact colored badge so admins can tell at a glance whether a row
    // came from MSP audit, automated Panoptica change logging, or manual
    // operator change-log entries.
    if (src === 'msp') {
      return `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:0.68rem;letter-spacing:0.05em;background:rgba(111,168,220,0.18);color:#6fa8dc;border:1px solid rgba(111,168,220,0.4);">MSP</span>`;
    }
    if (src === 'tenant-auto') {
      return `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:0.68rem;letter-spacing:0.05em;background:rgba(147,196,125,0.18);color:#93c47d;border:1px solid rgba(147,196,125,0.4);">TENANT · AUTO</span>`;
    }
    if (src === 'tenant-manual') {
      return `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:0.68rem;letter-spacing:0.05em;background:rgba(194,123,160,0.18);color:#c27ba0;border:1px solid rgba(194,123,160,0.4);">TENANT · MANUAL</span>`;
    }
    return `<span style="color:var(--p-text-muted);">${esc(src || '?')}</span>`;
  }

  function renderUnifiedRows(tbody, data) {
    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--p-text-muted);">No events.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.rows.map((r, idx) => {
      // Unique DOM key: source kind + source-table row id. Needed because
      // msp_audit_events.id and tenant_change_events.id can collide.
      const domKey = `${r.detail.kind}-${r.detail.id}`;
      const actorOrTenant = r.source === 'msp'
        ? (r.actor || '—')
        : (r.tenant_name || `(tenant #${r.tenant_id || '?'})`);
      const outcomeCell = r.source === 'msp'
        ? (r.success
            ? '<span style="color:#93c47d;">✓</span>'
            : '<span style="color:#e06666;">✗ Failed</span>')
        : '—';
      const rowBg = r.source === 'msp' && !r.success ? 'background:rgba(224,102,102,0.06);' : '';
      return `
        <tr data-unified-key="${esc(domKey)}" data-row-idx="${idx}" style="cursor:pointer;border-top:1px solid var(--p-border);${rowBg}">
          <td style="padding:8px 12px;font-size:0.82rem;white-space:nowrap;color:var(--p-text-muted);">${esc(formatWhen(r.timestamp))}</td>
          <td style="padding:8px 12px;font-size:0.82rem;">${sourceBadge(r.source)}</td>
          <td style="padding:8px 12px;font-size:0.82rem;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${categoryColor(r.category)};margin-right:6px;vertical-align:middle;"></span>
            ${esc(categoryLabel(r.category))}
          </td>
          <td style="padding:8px 12px;font-size:0.82rem;">${esc(actorOrTenant)}</td>
          <td style="padding:8px 12px;font-size:0.82rem;">${esc(r.description || '—')}</td>
          <td style="padding:8px 12px;font-size:0.82rem;text-align:center;">${outcomeCell}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-unified-key]').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = parseInt(tr.getAttribute('data-row-idx'), 10);
        const row = data.rows[idx];
        if (row) openUnifiedDetail(row);
      });
    });
  }

  function openDetail(row) {
    const panel = document.getElementById('audit-detail-panel');
    const overlay = document.getElementById('audit-detail-overlay');
    const title = document.getElementById('audit-detail-title');
    const body = document.getElementById('audit-detail-body');
    if (!panel || !body) return;

    title.textContent = `${categoryLabel(row.category)} · ${row.action}`;

    const metaPretty = row.metadata
      ? (typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata, null, 2))
      : '(none)';

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 14px;font-size:0.85rem;">
        <div style="color:var(--p-text-muted);">When</div>   <div>${esc(formatWhen(row.created_at))}</div>
        <div style="color:var(--p-text-muted);">Category</div> <div>${esc(categoryLabel(row.category))}</div>
        <div style="color:var(--p-text-muted);">Action</div> <div style="font-family:var(--p-font-mono, monospace);">${esc(row.action)}</div>
        <div style="color:var(--p-text-muted);">Outcome</div> <div>${row.success ? '<span style="color:#93c47d;">✓ Success</span>' : '<span style="color:#e06666;">✗ Failure</span>'}</div>

        <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Actor</div>
        <div style="color:var(--p-text-muted);">Email</div> <div>${esc(row.actor_email || '—')}</div>
        <div style="color:var(--p-text-muted);">Role</div>  <div>${esc(row.actor_role || '—')}</div>
        <div style="color:var(--p-text-muted);">Entra OID</div> <div style="font-family:var(--p-font-mono, monospace);font-size:0.78rem;">${esc(row.actor_oid || '—')}</div>
        <div style="color:var(--p-text-muted);">IP</div>    <div>${esc(row.actor_ip || '—')}</div>
        <div style="color:var(--p-text-muted);">User-Agent</div> <div style="font-size:0.78rem;word-break:break-all;">${esc(row.actor_user_agent || '—')}</div>
        <div style="color:var(--p-text-muted);">Session</div> <div style="font-family:var(--p-font-mono, monospace);font-size:0.78rem;">${esc(row.actor_session_id || '—')}</div>

        ${row.target_type || row.target_id || row.target_name ? `
          <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Target</div>
          <div style="color:var(--p-text-muted);">Type</div> <div>${esc(row.target_type || '—')}</div>
          <div style="color:var(--p-text-muted);">ID</div>   <div style="font-family:var(--p-font-mono, monospace);">${esc(row.target_id || '—')}</div>
          <div style="color:var(--p-text-muted);">Name</div> <div>${esc(row.target_name || '—')}</div>
        ` : ''}

        <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Description</div>
        <div style="grid-column:1/-1;">${esc(row.description)}</div>

        ${row.error_message ? `
          <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;color:#e06666;">Error</div>
          <div style="grid-column:1/-1;color:#e06666;">${esc(row.error_message)}</div>
        ` : ''}

        <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Metadata</div>
        <pre style="grid-column:1/-1;background:var(--p-panel-bg);border:1px solid var(--p-border);border-radius:4px;padding:10px;overflow:auto;font-size:0.78rem;margin:0;">${esc(metaPretty)}</pre>
      </div>
    `;

    // Use .active toggles so the CSS transition animates the right-edge slide.
    // Clearing the inline display:none we put in the markup is necessary on
    // first open because without it the element stays display:none even when
    // .active flips position. After first open, inline style is already gone.
    overlay.style.display = '';
    panel.style.display = '';
    overlay.classList.add('active');
    panel.classList.add('active');
  }

  function closeDetail() {
    const panel = document.getElementById('audit-detail-panel');
    const overlay = document.getElementById('audit-detail-overlay');
    if (panel) panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
  }

  function openUnifiedDetail(row) {
    // Shared slide-out panel. Content shape varies by source so we don't
    // fabricate fields that the underlying row doesn't have — e.g. tenant
    // rows have no actor_ip / session_id; MSP rows have no impact / surfaces.
    const panel = document.getElementById('audit-detail-panel');
    const overlay = document.getElementById('audit-detail-overlay');
    const title = document.getElementById('audit-detail-title');
    const body = document.getElementById('audit-detail-body');
    if (!panel || !body) return;

    const sourceLabel = row.source === 'msp' ? window.t('audit_log.detail_source_msp')
      : row.source === 'tenant-auto' ? window.t('audit_log.detail_source_tenant_auto')
      : row.source === 'tenant-manual' ? window.t('audit_log.detail_source_tenant_manual')
      : (row.source || window.t('audit_log.detail_source_unknown'));

    if (title) title.textContent = `${sourceLabel} · ${categoryLabel(row.category)}`;

    const bits = [];
    bits.push(`
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 14px;font-size:0.85rem;">
        <div style="color:var(--p-text-muted);">Source</div>   <div>${sourceBadge(row.source)}</div>
        <div style="color:var(--p-text-muted);">When</div>     <div>${esc(formatWhen(row.timestamp))}</div>
        <div style="color:var(--p-text-muted);">Category</div> <div>${esc(categoryLabel(row.category))}</div>`);

    if (row.source === 'msp') {
      bits.push(`
        <div style="color:var(--p-text-muted);">Action</div> <div style="font-family:var(--p-font-mono, monospace);">${esc(row.action || '—')}</div>
        <div style="color:var(--p-text-muted);">Outcome</div> <div>${row.success ? '<span style="color:#93c47d;">✓ Success</span>' : '<span style="color:#e06666;">✗ Failure</span>'}</div>

        <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Actor</div>
        <div style="color:var(--p-text-muted);">Email</div> <div>${esc(row.actor || '—')}</div>
        <div style="color:var(--p-text-muted);">Role</div>  <div>${esc(row.actor_role || '—')}</div>

        ${row.target_type || row.target_id || row.target_name ? `
          <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Target</div>
          <div style="color:var(--p-text-muted);">Type</div> <div>${esc(row.target_type || '—')}</div>
          <div style="color:var(--p-text-muted);">ID</div>   <div style="font-family:var(--p-font-mono, monospace);">${esc(row.target_id || '—')}</div>
          <div style="color:var(--p-text-muted);">Name</div> <div>${esc(row.target_name || '—')}</div>
        ` : ''}
      `);
    } else {
      // Tenant event.
      bits.push(`
        <div style="color:var(--p-text-muted);">Tenant</div>  <div>${esc(row.tenant_name || `(id ${row.tenant_id || '?'})`)}</div>
        <div style="color:var(--p-text-muted);">Actor</div>   <div>${esc(row.actor || '—')}</div>
        ${row.impact ? `<div style="color:var(--p-text-muted);">Impact</div> <div>${esc(row.impact)}</div>` : ''}
        ${row.ended_at ? `<div style="color:var(--p-text-muted);">Ended</div> <div>${esc(formatWhen(row.ended_at))}</div>` : ''}
        ${Array.isArray(row.surfaces) && row.surfaces.length > 0 ? `
          <div style="color:var(--p-text-muted);">Surfaces</div>
          <div>${row.surfaces.map(s => `<span style="display:inline-block;padding:1px 7px;margin-right:4px;border-radius:3px;font-size:0.72rem;background:var(--p-panel-bg);border:1px solid var(--p-border);">${esc(s)}</span>`).join('')}</div>
        ` : ''}
        ${row.correlation_tag ? `<div style="color:var(--p-text-muted);">Correlation tag</div> <div style="font-family:var(--p-font-mono, monospace);font-size:0.78rem;">${esc(row.correlation_tag)}</div>` : ''}
      `);
    }

    bits.push(`
        <div style="color:var(--p-text-muted);grid-column:1/-1;margin-top:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:0.7rem;">Description</div>
        <div style="grid-column:1/-1;">${esc(row.description || '—')}</div>
      </div>
    `);

    body.innerHTML = bits.join('');

    overlay.style.display = '';
    panel.style.display = '';
    overlay.classList.add('active');
    panel.classList.add('active');
  }

  // ─── View switching ───

  function setView(view) {
    if (view !== 'msp' && view !== 'unified') return;
    state.currentView = view;
    state.page = 0;

    // Tab button styles.
    const mspBtn = document.getElementById('audit-tab-msp');
    const uniBtn = document.getElementById('audit-tab-unified');
    if (mspBtn && uniBtn) {
      const activeStyle = 'border-bottom:2px solid var(--p-secondary-muted); color:var(--p-text);';
      const inactiveStyle = 'border-bottom:2px solid transparent; color:var(--p-text-muted);';
      mspBtn.style.cssText = mspBtn.style.cssText.replace(/border-bottom:[^;]+;?|color:[^;]+;?/g, '')
        + (view === 'msp' ? activeStyle : inactiveStyle);
      uniBtn.style.cssText = uniBtn.style.cssText.replace(/border-bottom:[^;]+;?|color:[^;]+;?/g, '')
        + (view === 'unified' ? activeStyle : inactiveStyle);
    }

    // Filter bar visibility.
    const mspBar = document.getElementById('audit-filter-bar-msp');
    const uniBar = document.getElementById('audit-filter-bar-unified');
    if (mspBar) mspBar.style.display = view === 'msp' ? 'flex' : 'none';
    if (uniBar) uniBar.style.display = view === 'unified' ? 'flex' : 'none';

    // Summary strip only makes sense for the MSP 30-day summary — hide on unified.
    // Set display:'grid' explicitly (not '') because the inline grid style is
    // what makes the cards render as a horizontal row; an empty string would
    // remove the inline rule and fall back to block layout (stacked cards).
    const summary = document.getElementById('audit-summary');
    if (summary) summary.style.display = view === 'msp' ? 'grid' : 'none';

    // Subtitle reflects which view is active.
    const subtitle = document.getElementById('audit-panel-subtitle');
    if (subtitle) {
      subtitle.textContent = view === 'msp'
        ? 'MSP-level operator actions — append-only, Admin-only'
        : 'Unified timeline — MSP audit + tenant change events, Admin-only';
    }

    // Swap table head columns to match the view.
    const thead = document.querySelector('.audit-table thead tr');
    if (thead) {
      if (view === 'msp') {
        thead.innerHTML = `
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">When</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Category</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Action</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Actor</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Description</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;width:70px;">Outcome</th>`;
      } else {
        thead.innerHTML = `
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">When</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;width:130px;">Source</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Category</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Actor / Tenant</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;">Description</th>
          <th style="text-align:left;padding:8px 12px;font-size:0.75rem;color:var(--p-text-muted);font-weight:600;width:70px;text-align:center;">Outcome</th>`;
      }
    }

    // Reload data for the selected view.
    reload();
  }

  // ─── Filter handling ───

  function applyFilters() {
    state.filters.category = document.getElementById('audit-filter-category')?.value || '';
    state.filters.actor    = document.getElementById('audit-filter-actor')?.value.trim() || '';
    state.filters.q        = document.getElementById('audit-filter-q')?.value.trim() || '';
    state.filters.from     = document.getElementById('audit-filter-from')?.value || '';
    state.filters.to       = document.getElementById('audit-filter-to')?.value || '';
    state.filters.success  = document.getElementById('audit-filter-success')?.value || '';
    state.page = 0;
    reload();
  }

  function resetFilters() {
    for (const id of ['audit-filter-category','audit-filter-actor','audit-filter-q','audit-filter-from','audit-filter-to','audit-filter-success']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    state.filters = { category: '', actor: '', q: '', from: '', to: '', success: '' };
    state.page = 0;
    reload();
  }

  function applyUnifiedFilters() {
    state.unifiedFilters.source    = document.getElementById('unified-filter-source')?.value || 'all';
    state.unifiedFilters.tenant_id = document.getElementById('unified-filter-tenant')?.value || '';
    state.unifiedFilters.q         = document.getElementById('unified-filter-q')?.value.trim() || '';
    state.unifiedFilters.from      = document.getElementById('unified-filter-from')?.value || '';
    state.unifiedFilters.to        = document.getElementById('unified-filter-to')?.value || '';
    state.page = 0;
    reload();
  }

  function resetUnifiedFilters() {
    for (const id of ['unified-filter-q','unified-filter-from','unified-filter-to']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    const srcSel = document.getElementById('unified-filter-source');
    if (srcSel) srcSel.value = 'all';
    const tenSel = document.getElementById('unified-filter-tenant');
    if (tenSel) tenSel.value = '';
    state.unifiedFilters = { source: 'all', tenant_id: '', q: '', from: '', to: '' };
    state.page = 0;
    reload();
  }

  async function populateUnifiedTenantPicker() {
    if (state.unifiedTenantOptions.length === 0) {
      state.unifiedTenantOptions = await fetchTenantList();
    }
    const sel = document.getElementById('unified-filter-tenant');
    if (!sel) return;
    // Preserve current selection if the user had picked one.
    const current = sel.value;
    const opts = ['<option value="">All tenants</option>'];
    for (const t of state.unifiedTenantOptions) {
      opts.push(`<option value="${t.id}">${esc(t.display_name || t.tenant_id)}</option>`);
    }
    sel.innerHTML = opts.join('');
    if (current) sel.value = current;
  }

  async function reload() {
    try {
      const data = await fetchEvents();
      renderRows(data);
    } catch (err) {
      const tbody = document.getElementById('audit-rows');
      const countLabel = document.getElementById('audit-count-label');
      if (countLabel) countLabel.textContent = 'Error: ' + err.message;
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:#e06666;">${err.message}</td></tr>`;
      }
    }
  }

  // ─── Init ───

  async function init() {
    // MSP view controls
    document.getElementById('audit-apply')?.addEventListener('click', applyFilters);
    document.getElementById('audit-reset')?.addEventListener('click', resetFilters);
    document.getElementById('audit-prev')?.addEventListener('click', () => { if (state.page > 0) { state.page--; reload(); } });
    document.getElementById('audit-next')?.addEventListener('click', () => {
      if ((state.page + 1) * state.pageSize < state.total) { state.page++; reload(); }
    });
    document.getElementById('audit-detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('audit-detail-overlay')?.addEventListener('click', closeDetail);

    // Export — adapts to the active view (MSP / Unified), fetches all rows
    // matching the active filters across pages, then downloads one CSV.
    document.getElementById('audit-export')?.addEventListener('click', exportCsv);

    // Unified view controls
    document.getElementById('unified-apply')?.addEventListener('click', applyUnifiedFilters);
    document.getElementById('unified-reset')?.addEventListener('click', resetUnifiedFilters);

    // Tab switches
    document.getElementById('audit-tab-msp')?.addEventListener('click', () => setView('msp'));
    document.getElementById('audit-tab-unified')?.addEventListener('click', async () => {
      // Lazy-load tenant picker options the first time the tab is visited so
      // we don't pay the /api/tenants round-trip for admins who never use it.
      await populateUnifiedTenantPicker();
      setView('unified');
    });

    // Enter on text filters applies (for each view's own text inputs)
    for (const id of ['audit-filter-actor', 'audit-filter-q']) {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyFilters();
      });
    }
    document.getElementById('unified-filter-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyUnifiedFilters();
    });

    // Initial load — MSP view is default. Fetch summary + first page in parallel.
    const [summary] = await Promise.all([fetchSummary(), reload()]);
    renderSummary(summary);
  }

  function destroy() {
    closeDetail();
  }

  window.PanopticaPage = { init, destroy };
})();
