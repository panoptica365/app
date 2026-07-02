/**
 * Heatmap — multi-tenant security posture, flattened across customers.
 *
 * Read-only operator view (CONSOLE §04). Rolls up the EXISTING per-control
 * verdicts from the per-tenant Security page (single source of truth) into a
 * fleet grid + campaign/regression insights. Issues NO mutations and writes NO
 * audit-log rows — it only GETs /api/heatmap and deep-links into Security.
 *
 * Registered through the SPA lifecycle as window.PanopticaPage = { init, destroy }.
 */
(function () {
  'use strict';

  let state = null;          // last /api/heatmap payload
  const expanded = new Set(); // category keys currently expanded into per-control columns
  let listenersBound = false;

  const DOT_CAP = 8;         // overflow cap per collapsed category cell (§7)

  // ── i18n helper: locale value when present, else the supplied English fallback.
  // Tolerant of whichever i18n surface is available so a missing helper never
  // blanks the UI.
  function tt(key, fallback, params) {
    try {
      const i = window.PanopticaI18n;
      if (i && typeof i.tOrFallback === 'function') {
        const v = i.tOrFallback(key, fallback, params);
        return (v == null || v === key) ? fallback : v;
      }
      if (typeof window.t === 'function') {
        const v = window.t(key, params);
        return (v == null || v === key) ? fallback : v;
      }
    } catch (_e) { /* fall through */ }
    return fallback;
  }

  function applyI18n(root) {
    try {
      if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
        window.PanopticaI18n.applyTo(root);
      }
    } catch (_e) { /* non-fatal */ }
  }

  const CATEGORY_FALLBACK = {
    identity: 'Identity',
    exchange: 'Email & Exchange',
    sharepoint: 'SharePoint & Sharing',
    teams: 'Teams',
    defender: 'Defender',
    compliance: 'Compliance & Data',
  };
  function catLabel(key) {
    return tt('heatmap.category.' + key, CATEGORY_FALLBACK[key] || key);
  }
  function controlName(id, apiName) {
    return tt('security_settings.' + id + '.name', apiName || id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── Deep-link into a tenant's Security settings (single source of truth).
  // Jun 11, 2026: Security settings moved into the per-tenant dashboard's
  // Security tab, so the drill-in now lands there (giving the operator the full
  // per-tenant context) rather than the standalone Security route. The
  // tenant-dashboard reads params.id; view=security selects the tab; the
  // setting (+ optional category) are honored when SecurityPanel mounts.
  // Prefers the in-app SPA navigator; falls back to a URL the SPA reads on
  // load. Never mutates anything.
  function gotoSecurity(tenantId, settingId, category) {
    const params = { id: String(tenantId), view: 'security' };
    if (settingId) params.setting = settingId;
    if (category) params.category = category;
    try {
      if (window.Panoptica && typeof window.Panoptica.navigateTo === 'function') {
        return window.Panoptica.navigateTo('tenant-dashboard', params);
      }
      if (typeof window.navigateTo === 'function') {
        return window.navigateTo('tenant-dashboard', params);
      }
    } catch (_e) { /* fall through to URL */ }
    const qs = new URLSearchParams(Object.assign({ page: 'tenant-dashboard' }, params)).toString();
    window.location.href = '/?' + qs;
  }

  // ════════════════════════════════════════════════════════════════
  // Rendering
  // ════════════════════════════════════════════════════════════════

  function render() {
    const root = document.getElementById('hm-content');
    if (!root || !state) return;

    if (!state.managed_count) {
      root.innerHTML = `<div class="hm-loading">${esc(tt('heatmap.empty', 'No managed tenants to display yet.'))}</div>`;
      return;
    }

    root.innerHTML = renderFleet() + renderStrip() + renderGrid() + renderLegend();
    ensureCampaignDom();
    applyI18n(root);
  }

  function renderFleet() {
    const fleet = state.fleet_score_pct;
    const scoreTxt = (fleet == null) ? '—' : String(fleet);
    return `
      <div class="hm-fleet">
        <div class="hm-fleet-score" title="${esc(tt('heatmap.fleet_score_help', 'Share of all recommended controls that are set up and healthy, across all managed tenants.'))}">
          <span class="hm-bignum">${esc(scoreTxt)}</span><span class="hm-bignum-suffix">%</span>
        </div>
        <div class="hm-fleet-stats">
          ${stat(state.managed_count, tt('heatmap.stat_managed', 'Managed tenants'))}
          ${stat(state.stale_tenant_count, tt('heatmap.stat_stale', 'Stale data'))}
          ${stat(state.active_exemptions, tt('heatmap.stat_exemptions', 'Active exemptions'))}
        </div>
      </div>`;
  }
  function stat(num, label) {
    return `<div class="hm-stat"><span class="hm-stat-num">${esc(num)}</span><span class="hm-stat-lbl">${esc(label)}</span></div>`;
  }

  function renderStrip() {
    return `<div class="hm-strip">${renderMovers()}${renderWeak()}</div>`;
  }

  function renderMovers() {
    const m = state.movers || { state: 'collecting', items: [] };
    let body;
    if (m.state === 'collecting') {
      body = `<div class="hm-collecting">${esc(tt('heatmap.movers_collecting',
        'Collecting baseline — 7-day trends become available once a week of history has accrued.'))}
        <br><small>${esc(tt('heatmap.movers_days', 'Days recorded so far'))}: ${esc(m.days_collected || 0)}</small></div>`;
    } else if (!m.items || m.items.length === 0) {
      body = `<div class="hm-collecting">${esc(tt('heatmap.movers_none', 'No posture changes over the last 7 days.'))}</div>`;
    } else {
      body = m.items.slice(0, 8).map(it => {
        const sign = it.delta_pct > 0 ? '+' : '';
        return `<div class="hm-mover-row">
          <span class="hm-weak-name">${esc(it.display_name)}</span>
          <span class="hm-mover-delta ${esc(it.direction)}">${sign}${esc(it.delta_pct)} pts</span>
        </div>`;
      }).join('');
    }
    return `<div class="hm-card">
      <h3>${esc(tt('heatmap.movers_title', 'Movers — biggest 7-day changes'))}</h3>
      <p class="hm-card-sub">${esc(tt('heatmap.movers_sub', 'Which tenant regressed (or improved) most recently.'))}</p>
      ${body}
    </div>`;
  }

  function renderWeak() {
    const weak = state.universally_weak || [];
    let body;
    if (weak.length === 0) {
      body = `<div class="hm-collecting">${esc(tt('heatmap.weak_none', 'No widely-weak controls — nice.'))}</div>`;
    } else {
      body = weak.slice(0, 8).map(w => {
        const parts = [];
        if (w.drifted_count) parts.push(`<span class="hm-pill hm-pill-drift">${esc(w.drifted_count)} ${esc(tt('heatmap.weak_drifted', 'drifted'))}</span>`);
        if (w.not_set_count) parts.push(`<span class="hm-pill hm-pill-notset">${esc(w.not_set_count)} ${esc(tt('heatmap.weak_notset', 'not set up'))}</span>`);
        return `<div class="hm-weak-row" data-weak="${esc(w.control_id)}" role="button" tabindex="0">
          <span class="hm-weak-name">${esc(controlName(w.control_id, w.name))}</span>
          ${parts.join(' ')}
          <span class="hm-weak-count">${esc(w.weak_count)}</span>
        </div>`;
      }).join('');
    }
    return `<div class="hm-card">
      <h3>${esc(tt('heatmap.weak_title', 'Universally weak — campaign candidates'))}</h3>
      <p class="hm-card-sub">${esc(tt('heatmap.weak_sub', 'Controls red or unconfigured at the most tenants. Click to work it everywhere.'))}</p>
      ${body}
    </div>`;
  }

  // Build the flat column layout (category column when collapsed, per-control
  // columns when expanded) so header and body cells always align.
  function buildColumns() {
    const cols = [];
    for (const cat of state.categories) {
      if (expanded.has(cat.key) && cat.controls.length) {
        cat.controls.forEach((ctrl, i) => cols.push({ type: 'ctrl', cat, ctrl, first: i === 0 }));
      } else {
        cols.push({ type: 'cat', cat });
      }
    }
    return cols;
  }

  function renderGrid() {
    const cols = buildColumns();
    const head = cols.map(col => {
      if (col.type === 'cat') {
        return `<th class="hm-cat-th" data-expand="${esc(col.cat.key)}" title="${esc(tt('heatmap.expand_help', 'Click to expand into individual controls'))}">${esc(catLabel(col.cat.key))}<span class="hm-caret">▸</span></th>`;
      }
      // First control column of an expanded group carries the collapse control
      // (so the operator always knows which category these columns belong to,
      // even when scrolled) plus the group-start accent border.
      const groupCls = col.first ? ' hm-group-start' : '';
      const collapse = col.first
        ? `<div class="hm-collapse" data-collapse="${esc(col.cat.key)}" role="button" tabindex="0">▾ ${esc(catLabel(col.cat.key))}</div>`
        : '';
      return `<th class="hm-ctrl-th${groupCls}">${collapse}${esc(controlName(col.ctrl.id, col.ctrl.name))}</th>`;
    }).join('');

    const rows = state.tenants.map(t => {
      const tname = `<td class="hm-tenant-cell" data-tenant="${esc(t.id)}">
        <div class="hm-tenant-name">${esc(t.display_name)}</div>
        ${renderScore(t)}
      </td>`;
      const cells = cols.map(col => {
        const cell = t.cells[col.cat.key];
        if (col.type === 'cat') return renderCatCell(t, col.cat, cell);
        return renderCtrlCell(t, col.cat, col.ctrl, cell, col.first);
      }).join('');
      return `<tr class="${t.is_stale ? 'hm-stale' : ''}">${tname}${cells}</tr>`;
    }).join('');

    return `<div class="hm-gridwrap"><table class="hm-grid">
      <thead><tr><th class="hm-tenant-th">${esc(tt('heatmap.col_tenant', 'Tenant'))}</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  // Score line under the tenant name. Shows the percentage colored by band
  // plus the raw "healthy / counted" fraction so "100%" is self-explanatory
  // (it's a share of the controls that apply to that tenant, not all 25).
  function renderScore(t) {
    if (t.score_pct == null) {
      return `<div class="hm-tenant-score hm-score-na">${esc(tt('heatmap.score_na', 'No applicable controls'))}</div>`;
    }
    const band = t.score_pct >= 90 ? 'good' : (t.score_pct >= 70 ? 'warn' : 'bad');
    const frac = (typeof t.compliant === 'number' && typeof t.applicable === 'number')
      ? `<span class="hm-score-frac">(${t.compliant}/${t.applicable})</span>` : '';
    return `<div class="hm-tenant-score hm-score-${band}">${esc(t.score_pct)}%${frac}</div>`;
  }

  function renderCatCell(t, cat, cell) {
    if (!cell || !cell.dots.length) {
      return `<td class="hm-cat-cell hm-na-cell"><span class="hm-dash">—</span></td>`;
    }
    if (cell.na) {
      return `<td class="hm-cat-cell hm-na-cell" title="${esc(tt('heatmap.na_help', 'Not applicable / no readable data for this category.'))}">${esc(tt('heatmap.na', 'N/A'))}</td>`;
    }
    const edge = cell.worst_severity ? ` edge-${esc(cell.worst_severity)}` : '';
    const shown = cell.dots.slice(0, DOT_CAP);
    const overflow = cell.dots.length - shown.length;
    const dots = shown.map(d =>
      `<span class="hm-dot ${esc(d.state)}" data-tenant="${esc(t.id)}" data-setting="${esc(d.control_id)}" title="${esc(controlName(d.control_id, d.name))} — ${esc(stateLabel(d.state))}"></span>`
    ).join('');
    const more = overflow > 0 ? `<span class="hm-overflow">+${overflow}</span>` : '';
    return `<td class="hm-cat-cell${edge}" data-tenant="${esc(t.id)}" data-category="${esc(cat.key)}">
      <div class="hm-dots">${dots}${more}</div>
    </td>`;
  }

  function renderCtrlCell(t, cat, ctrl, cell, first) {
    const groupCls = first ? ' hm-group-start' : '';
    const dot = cell && cell.dots.find(d => d.control_id === ctrl.id);
    if (!dot) return `<td class="hm-ctrl-cell${groupCls}"><span class="hm-dash">—</span></td>`;
    return `<td class="hm-ctrl-cell${groupCls}">
      <span class="hm-dot ${esc(dot.state)}" data-tenant="${esc(t.id)}" data-setting="${esc(ctrl.id)}" title="${esc(controlName(ctrl.id, ctrl.name))} — ${esc(stateLabel(dot.state))}"></span>
    </td>`;
  }

  function stateLabel(s) {
    const map = {
      compliant: tt('heatmap.state_compliant', 'Healthy'),
      drifted: tt('heatmap.state_drifted', 'Drifted'),
      not_set: tt('heatmap.state_not_set', 'Not set up'),
      na: tt('heatmap.state_na', 'Not available on this tenant'),
      stale: tt('heatmap.state_stale', 'No data'),
    };
    return map[s] || s;
  }

  function renderLegend() {
    const items = [
      ['compliant', stateLabel('compliant')],
      ['drifted', stateLabel('drifted')],
      ['not_set', stateLabel('not_set')],
      ['na', stateLabel('na')],
      ['stale', stateLabel('stale')],
    ];
    return `<div class="hm-legend">${items.map(([s, l]) =>
      `<span><span class="hm-dot ${s}"></span>${esc(l)}</span>`).join('')}</div>`;
  }

  // ════════════════════════════════════════════════════════════════
  // Campaign slideout (universally-weak → affected tenants + explainer)
  // ════════════════════════════════════════════════════════════════

  function ensureCampaignDom() {
    if (document.getElementById('hm-campaign')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'hm-campaign-backdrop';
    backdrop.id = 'hm-campaign-backdrop';
    const panel = document.createElement('div');
    panel.className = 'hm-campaign';
    panel.id = 'hm-campaign';
    panel.innerHTML = `
      <div class="hm-campaign-head">
        <h2 id="hm-campaign-title"></h2>
        <button class="hm-campaign-close" id="hm-campaign-close" aria-label="Close">×</button>
      </div>
      <div class="hm-campaign-body" id="hm-campaign-body"></div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    backdrop.addEventListener('click', closeCampaign);
    panel.querySelector('#hm-campaign-close').addEventListener('click', closeCampaign);
  }

  function closeCampaign() {
    const p = document.getElementById('hm-campaign');
    const b = document.getElementById('hm-campaign-backdrop');
    if (p) p.classList.remove('open');
    if (b) b.classList.remove('open');
  }

  async function openCampaign(controlId) {
    const w = (state.universally_weak || []).find(x => x.control_id === controlId);
    if (!w) return;
    ensureCampaignDom();
    const title = document.getElementById('hm-campaign-title');
    const body = document.getElementById('hm-campaign-body');
    title.textContent = controlName(w.control_id, w.name);

    const affectedHtml = (w.affected || []).map(a => {
      const tag = a.state === 'drifted'
        ? `<span class="hm-pill hm-pill-drift">${esc(stateLabel('drifted'))}</span>`
        : `<span class="hm-pill hm-pill-notset">${esc(stateLabel('not_set'))}</span>`;
      return `<li>
        <a data-goto-tenant="${esc(a.tenant_id)}" data-goto-setting="${esc(w.control_id)}">${esc(a.display_name)}</a>
        ${tag}
      </li>`;
    }).join('');

    body.innerHTML = `
      <h4>${esc(tt('heatmap.campaign_affected', 'Affected tenants'))} (${esc(w.affected.length)})</h4>
      <ul class="hm-affected">${affectedHtml}</ul>
      <div id="hm-campaign-explain"><p style="opacity:.6">${esc(tt('heatmap.campaign_loading', 'Loading control details…'))}</p></div>`;

    document.getElementById('hm-campaign').classList.add('open');
    document.getElementById('hm-campaign-backdrop').classList.add('open');

    // Pull the EXISTING per-control explainer copy from the Security detail
    // endpoint (no new explainer copy). Use the first affected tenant.
    const first = (w.affected && w.affected[0]) ? w.affected[0].tenant_id : null;
    const explain = document.getElementById('hm-campaign-explain');
    if (!first) { explain.innerHTML = ''; return; }
    try {
      const res = await fetch(`/api/security/tenants/${first}/settings/${encodeURIComponent(w.control_id)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const s = data.setting || {};
      const section = (labelKey, labelFb, text) => text
        ? `<h4>${esc(tt(labelKey, labelFb))}</h4><p>${esc(text)}</p>` : '';
      explain.innerHTML =
        section('heatmap.campaign_what', 'What this is', s.description) +
        section('heatmap.campaign_why', 'Why it matters', s.security_impact) +
        section('heatmap.campaign_users', 'User impact', s.user_impact) +
        section('heatmap.campaign_notes', 'Operator notes', s.admin_notes);
      if (!explain.innerHTML) explain.innerHTML = '';
    } catch (e) {
      explain.innerHTML = `<p style="opacity:.6">${esc(tt('heatmap.campaign_explain_failed', 'Control details unavailable.'))}</p>`;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Events
  // ════════════════════════════════════════════════════════════════

  function onClick(e) {
    // Dot → specific control deep-link
    const dot = e.target.closest('.hm-dot[data-setting]');
    if (dot && document.getElementById('hm-content').contains(dot)) {
      e.stopPropagation();
      gotoSecurity(dot.getAttribute('data-tenant'), dot.getAttribute('data-setting'));
      return;
    }
    // Expand / collapse category
    const exp = e.target.closest('[data-expand]');
    if (exp) { expanded.add(exp.getAttribute('data-expand')); render(); return; }
    const col = e.target.closest('[data-collapse]');
    if (col) { expanded.delete(col.getAttribute('data-collapse')); render(); return; }
    // Universally-weak row → campaign
    const weak = e.target.closest('[data-weak]');
    if (weak) { openCampaign(weak.getAttribute('data-weak')); return; }
    // Campaign affected link → deep-link
    const goto = e.target.closest('[data-goto-tenant]');
    if (goto) { gotoSecurity(goto.getAttribute('data-goto-tenant'), goto.getAttribute('data-goto-setting')); return; }
    // Category body cell → tenant/category deep-link
    const catCell = e.target.closest('td.hm-cat-cell[data-tenant]');
    if (catCell) { gotoSecurity(catCell.getAttribute('data-tenant'), null, catCell.getAttribute('data-category')); return; }
    // Per-control body cell (already handled by dot, but cell padding clicks)
    const ctrlCell = e.target.closest('td.hm-ctrl-cell');
    if (ctrlCell) {
      const d = ctrlCell.querySelector('.hm-dot[data-setting]');
      if (d) gotoSecurity(d.getAttribute('data-tenant'), d.getAttribute('data-setting'));
      return;
    }
    // Tenant name cell → tenant security page
    const tcell = e.target.closest('td.hm-tenant-cell[data-tenant]');
    if (tcell) { gotoSecurity(tcell.getAttribute('data-tenant')); return; }
  }

  function onKey(e) {
    if (e.key === 'Escape') closeCampaign();
    if ((e.key === 'Enter' || e.key === ' ')) {
      const weak = e.target.closest && e.target.closest('[data-weak]');
      if (weak) { e.preventDefault(); openCampaign(weak.getAttribute('data-weak')); }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════

  // Tenant-group filter (Phase 1 rider): null = whole fleet.
  let currentGroup = null;
  let loadSeq = 0; // guards out-of-order responses when the filter is flipped quickly

  async function load() {
    const seq = ++loadSeq;
    const root = document.getElementById('hm-content');
    if (root) root.innerHTML = `<div class="hm-loading">${esc(tt('heatmap.loading', 'Building heatmap…'))}</div>`;
    try {
      const url = '/api/heatmap' + (currentGroup ? `?group=${encodeURIComponent(currentGroup)}` : '');
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (seq !== loadSeq) return; // a newer load superseded this one
      state = data;
    } catch (e) {
      if (seq !== loadSeq) return;
      state = null;
      if (root) root.innerHTML = `<div class="hm-error">${esc(tt('heatmap.load_failed', 'Could not load the heatmap.'))} (${esc(e.message)})</div>`;
      return;
    }
    render();
  }

  async function init(params) {
    state = null;
    expanded.clear();
    currentGroup = null;

    // Mount the shared group-filter dropdown (fail-soft — absent until a
    // group exists; a load failure leaves the page exactly as before).
    const filterHost = document.getElementById('hm-group-filter');
    if (filterHost && window.PanopticaGroupFilter) {
      window.PanopticaGroupFilter.mount(filterHost, {
        value: null,
        onChange: (groupId) => { currentGroup = groupId; load(); },
      });
    }

    await load();

    if (!listenersBound) {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      listenersBound = true;
    }
  }

  function destroy() {
    if (listenersBound) {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      listenersBound = false;
    }
    closeCampaign();
    const p = document.getElementById('hm-campaign');
    const b = document.getElementById('hm-campaign-backdrop');
    if (p) p.remove();
    if (b) b.remove();
    state = null;
    expanded.clear();
  }

  window.PanopticaPage = { init, destroy };
})();
