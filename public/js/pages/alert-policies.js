/**
 * Panoptica365 — Alert Policies Page
 * Full-page view of all alert policy configurations.
 */
(function () {
  'use strict';

  let policies = [];

  // Category display order — drives section ordering. Mirrors the relative
  // urgency operators care about (threats first, governance last). Anything
  // returned from the API that doesn't match these keys lands at the bottom
  // under the "Other" section so a new ENUM value never disappears silently.
  const CATEGORY_ORDER = [
    'risky_signins',
    'threat_mgmt',
    'permissions',
    'config_changes',
    'external_sharing',
    'info_governance',
  ];

  // localStorage key for per-category collapsed state. Stored as JSON object
  // { <categorySlug>: true|false }. Default = collapsed (true) so first-load
  // operators see the system structure, not 34 rows of detail.
  const COLLAPSE_KEY = 'panoptica:alert_policies:collapsed_v1';

  function loadCollapseState() {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveCollapseState(state) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch { /* swallow */ }
  }

  async function init() {
    try {
      policies = await Panoptica.api('/api/alerts/policies/list');
      renderPolicies();
      wireSearch();
    } catch (e) {
      Panoptica.showToast(window.t('alert_policies.toast_load_failed', { message: e.message }), 'error');
    }
  }

  function destroy() {
    policies = [];
  }

  // ─── Render helpers ───

  function catLabel(slug) {
    return window.PanopticaI18n.tOrFallback('alert_policies.cat_' + slug, slug);
  }
  function sevLabel(slug) {
    return window.PanopticaI18n.tOrFallback('alert_policies.sev_' + slug, slug);
  }
  function routeLabel(slug) {
    return window.PanopticaI18n.tOrFallback('alert_policies.route_' + slug, slug);
  }
  // Policy name + description: derived from canonical English in the DB.
  // Slug pattern matches what would be authored in en.json/fr.json under
  // alert_policy_names / alert_policy_descriptions. Falls back to the DB
  // English string if no key exists for this policy.
  function policyName(p) {
    const slug = window.PanopticaI18n.slugify(p.name);
    return window.PanopticaI18n.tOrFallback('alert_policy_names.' + slug, p.name);
  }
  function policyDesc(p) {
    const slug = window.PanopticaI18n.slugify(p.name);
    return window.PanopticaI18n.tOrFallback('alert_policy_descriptions.' + slug, p.description || '');
  }
  function policyCountLabel(count) {
    // Plural-aware count badge. Uses the {one, other} pattern consistent with
    // the rest of Panoptica's i18n.
    return window.t('alert_policies.section_count', { count });
  }

  function renderPolicies() {
    const wrap = el('ap-sections-wrap');
    if (!wrap) return;

    // Group by category, preserving server-side ORDER BY name within each group.
    const byCat = {};
    for (const p of policies) {
      const c = p.category || 'other';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(p);
    }

    // Build ordered category list: known categories first (per CATEGORY_ORDER),
    // then any unrecognized categories in alphabetical order. Defends against
    // future ENUM additions silently disappearing from the UI.
    const seen = new Set();
    const orderedCats = [];
    for (const c of CATEGORY_ORDER) {
      if (byCat[c] && byCat[c].length > 0) {
        orderedCats.push(c);
        seen.add(c);
      }
    }
    for (const c of Object.keys(byCat).sort()) {
      if (!seen.has(c)) orderedCats.push(c);
    }

    const collapseState = loadCollapseState();
    const onLabel = window.t('alert_policies.toggle_on');
    const offLabel = window.t('alert_policies.toggle_off');
    const editLabel = window.t('alert_policies.btn_edit');

    wrap.innerHTML = orderedCats.map(cat => {
      const list = byCat[cat] || [];
      // Default: collapsed. localStorage value of `false` means operator
      // explicitly expanded this section — honor it.
      const isCollapsed = collapseState[cat] !== false;
      const explainerIconHtml = (window.Panoptica && window.Panoptica.AlertExplainer)
        ? (p) => window.Panoptica.AlertExplainer.iconHtml({ policyName: p.name })
        : () => '';
      const rowsHtml = list.map(p => `
        <tr class="policy-row" data-id="${p.id}" data-name-l="${esc((policyName(p) || '').toLowerCase())}" data-desc-l="${esc((policyDesc(p) || '').toLowerCase())}">
          <td>
            <div style="font-weight:600;color:var(--p-text);display:flex;align-items:center;gap:2px;flex-wrap:wrap;">
              <span>${esc(policyName(p))}</span>${explainerIconHtml(p)}
            </div>
            <div style="font-size:0.8rem;color:var(--p-text-muted);margin-top:2px;">${esc(policyDesc(p))}</div>
          </td>
          <td>
            <select class="ap-sev-select alert-filter-select" data-role-readonly="admin" data-id="${p.id}" data-field="severity" style="width:auto;">
              ${['info','low','medium','high','severe'].map(s =>
                `<option value="${s}" ${s === p.severity ? 'selected' : ''}>${esc(sevLabel(s))}</option>`
              ).join('')}
            </select>
          </td>
          <td>
            <select class="ap-route-select alert-filter-select" data-role-readonly="admin" data-id="${p.id}" data-field="notification_target" style="width:auto;">
              ${['none','personal','support','both'].map(r =>
                `<option value="${r}" ${r === p.notification_target ? 'selected' : ''}>${esc(routeLabel(r))}</option>`
              ).join('')}
            </select>
          </td>
          <td>
            <label class="alert-toggle-label" style="margin:0;">
              <input type="checkbox" class="ap-toggle" data-role-required="admin" data-id="${p.id}" ${p.enabled ? 'checked' : ''}>
              <span>${p.enabled ? esc(onLabel) : esc(offLabel)}</span>
            </label>
          </td>
          <td>
            <button class="ap-edit-btn td-poll-btn" data-role-required="admin" data-id="${p.id}">${esc(editLabel)}</button>
          </td>
        </tr>
      `).join('');

      return `
        <div class="ap-section ${isCollapsed ? 'ap-collapsed' : ''}" data-cat="${esc(cat)}">
          <button type="button" class="ap-section-head" data-cat-toggle="${esc(cat)}" aria-expanded="${!isCollapsed}">
            <span class="ap-section-chevron">▾</span>
            <span class="ap-section-title">${esc(catLabel(cat))}</span>
            <span class="ap-section-count" data-section-count>${esc(policyCountLabel(list.length))}</span>
          </button>
          <div class="ap-section-body">
            <table class="alert-table">
              <thead>
                <tr>
                  <th data-i18n="alert_policies.col_policy_name">Policy Name</th>
                  <th data-i18n="alert_policies.col_severity">Severity</th>
                  <th data-i18n="alert_policies.col_routing">Routing</th>
                  <th data-i18n="alert_policies.col_enabled">Enabled</th>
                  <th data-i18n="alert_policies.col_actions">Actions</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    // Re-translate any data-i18n attributes inside the freshly rendered markup
    // so the per-section <thead> column labels localize correctly.
    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      window.PanopticaI18n.applyTo(wrap);
    }

    // Render Lucide icons inside the freshly-injected markup (the explainer
    // graduation-cap icon on each policy row needs Lucide to swap the
    // <i data-lucide> placeholder for an SVG).
    if (window.Panoptica && typeof window.Panoptica.refreshIcons === 'function') {
      window.Panoptica.refreshIcons(wrap);
    }

    // Wire section toggles
    wrap.querySelectorAll('.ap-section-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.catToggle;
        const section = btn.closest('.ap-section');
        const willCollapse = !section.classList.contains('ap-collapsed');
        section.classList.toggle('ap-collapsed', willCollapse);
        btn.setAttribute('aria-expanded', String(!willCollapse));
        const state = loadCollapseState();
        state[cat] = willCollapse;
        saveCollapseState(state);
      });
    });

    // Wire inline severity/routing changes
    wrap.querySelectorAll('.ap-sev-select, .ap-route-select').forEach(select => {
      select.addEventListener('change', async () => {
        const id = select.dataset.id;
        const field = select.dataset.field;
        try {
          await Panoptica.api(`/api/alerts/policies/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ [field]: select.value }),
          });
          Panoptica.showToast(window.t('alert_policies.toast_policy_updated'), 'success');
        } catch (e) {
          Panoptica.showToast(window.t('alert_policies.toast_policy_update_failed'), 'error');
        }
      });
    });

    // Toggle handlers
    wrap.querySelectorAll('.ap-toggle').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.id;
        try {
          const result = await Panoptica.api(`/api/alerts/policies/${id}/toggle`, { method: 'PATCH' });
          const label = cb.parentElement.querySelector('span');
          if (label) label.textContent = window.t(result.enabled ? 'alert_policies.toggle_on' : 'alert_policies.toggle_off');
          Panoptica.showToast(window.t(result.enabled ? 'alert_policies.toast_policy_enabled' : 'alert_policies.toast_policy_disabled'), 'success');
        } catch (e) {
          Panoptica.showToast(window.t('alert_policies.toast_policy_toggle_failed'), 'error');
          cb.checked = !cb.checked;
        }
      });
    });

    // Edit button → modal with detection_logic JSON editor
    wrap.querySelectorAll('.ap-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const policy = policies.find(p => p.id === id);
        if (policy) openPolicyEditor(policy);
      });
    });

    // ⓘ explainer icon → opens the shared educational modal for this policy.
    // Reads the canonical English policy name from data-ax-policy (set by
    // AlertExplainer.iconHtml) so we don't need to round-trip through the
    // numeric id; the explainer slugifies the name itself.
    wrap.querySelectorAll('.ax-icon-btn[data-ax-policy]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.getAttribute('data-ax-policy');
        if (name && window.Panoptica && window.Panoptica.AlertExplainer) {
          window.Panoptica.AlertExplainer.open(name);
        }
      });
    });
  }

  // ─── Search filter ───
  //
  // Filters policy rows by case-insensitive substring match against name +
  // description (pre-lowercased into data attrs at render time so we don't
  // walk the DOM text on every keystroke).
  // Behavior:
  //   - Non-matching rows hidden via .ap-row-hidden
  //   - Sections containing 0 matches gain .ap-section-empty (CSS hides them)
  //   - Sections containing >0 matches are force-expanded so the operator
  //     can see what they searched for without manually opening sections
  //   - Empty query restores the user's saved collapsed state and shows all rows

  function wireSearch() {
    const input = el('ap-search-input');
    const clear = el('ap-search-clear');
    if (!input) return;

    let savedState = null; // snapshot of collapse state before the user started searching

    function applyFilter(qRaw) {
      const wrap = el('ap-sections-wrap');
      if (!wrap) return;
      const q = (qRaw || '').trim().toLowerCase();
      const isFiltering = q.length > 0;

      // Snapshot pre-search collapse state on first non-empty query so we can
      // restore after clearing. Don't re-snapshot mid-search.
      if (isFiltering && savedState === null) savedState = loadCollapseState();

      wrap.querySelectorAll('.ap-section').forEach(section => {
        let matchCount = 0;
        const rows = section.querySelectorAll('.policy-row');
        rows.forEach(row => {
          if (!isFiltering) {
            row.classList.remove('ap-row-hidden');
            matchCount++;
            return;
          }
          const n = row.dataset.nameL || '';
          const d = row.dataset.descL || '';
          const hit = n.includes(q) || d.includes(q);
          row.classList.toggle('ap-row-hidden', !hit);
          if (hit) matchCount++;
        });

        const head = section.querySelector('.ap-section-head');
        const countEl = section.querySelector('[data-section-count]');
        if (countEl) {
          if (isFiltering) {
            countEl.textContent = `${matchCount} / ${rows.length}`;
          } else {
            countEl.textContent = policyCountLabel(rows.length);
          }
        }

        if (isFiltering) {
          section.classList.toggle('ap-section-empty', matchCount === 0);
          // Force-expand sections that contain matches; hide empty ones.
          if (matchCount > 0) {
            section.classList.remove('ap-collapsed');
            if (head) head.setAttribute('aria-expanded', 'true');
          }
        } else {
          section.classList.remove('ap-section-empty');
          // Restore saved collapsed state.
          const cat = section.dataset.cat;
          const wasCollapsed = savedState ? savedState[cat] !== false : true;
          section.classList.toggle('ap-collapsed', wasCollapsed);
          if (head) head.setAttribute('aria-expanded', String(!wasCollapsed));
        }
      });

      if (clear) clear.style.display = isFiltering ? 'inline-flex' : 'none';
      if (!isFiltering) savedState = null; // ready for next search session
    }

    input.addEventListener('input', () => applyFilter(input.value));
    if (clear) {
      clear.addEventListener('click', () => {
        input.value = '';
        applyFilter('');
        input.focus();
      });
    }
    // Esc clears the filter when search has focus
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        applyFilter('');
      }
    });
  }

  function openPolicyEditor(policy) {
    const logic = typeof policy.detection_logic === 'string'
      ? JSON.parse(policy.detection_logic)
      : policy.detection_logic;

    // Translate the policy name + description via the same slug pattern as
    // the table render — operator sees the localized name in the modal too.
    const slug = window.PanopticaI18n.slugify(policy.name);
    const localizedName = window.PanopticaI18n.tOrFallback('alert_policy_names.' + slug, policy.name);
    const localizedDesc = window.PanopticaI18n.tOrFallback('alert_policy_descriptions.' + slug, policy.description || '');

    const body = `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;color:var(--p-text);margin-bottom:4px;">${esc(localizedName)}</div>
        <div style="font-size:0.85rem;color:var(--p-text-muted);">${esc(localizedDesc)}</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.8rem;color:var(--p-text-muted);text-transform:uppercase;letter-spacing:0.1em;">${esc(window.t('alert_policies.modal_label_notif_limit'))}</label>
        <input type="number" id="ap-edit-limit" value="${policy.notification_limit || 24}"
          style="width:80px;background:var(--p-bg);border:1px solid var(--p-border);color:var(--p-text);padding:6px 10px;border-radius:4px;font-family:Inter,sans-serif;">
      </div>
      <div>
        <label style="font-size:0.8rem;color:var(--p-text-muted);text-transform:uppercase;letter-spacing:0.1em;">${esc(window.t('alert_policies.modal_label_detection_logic'))}</label>
        <textarea id="ap-edit-logic" rows="12"
          style="width:100%;background:var(--p-bg);border:1px solid var(--p-border);color:var(--p-text);padding:10px;border-radius:4px;font-family:monospace;font-size:0.85rem;resize:vertical;"
        >${JSON.stringify(logic, null, 2)}</textarea>
      </div>
    `;

    const footer = `
      <button class="td-poll-btn" id="ap-edit-save" data-role-required="admin" style="background:var(--p-accent);color:#fff;">${esc(window.t('alert_policies.modal_btn_save'))}</button>
      <button class="td-poll-btn" onclick="Panoptica.closeModal()">${esc(window.t('alert_policies.modal_btn_cancel'))}</button>
    `;

    Panoptica.openModal(window.t('alert_policies.modal_title_edit'), body, footer);

    setTimeout(() => {
      document.getElementById('ap-edit-save')?.addEventListener('click', async () => {
        try {
          const logicText = document.getElementById('ap-edit-logic').value;
          const parsedLogic = JSON.parse(logicText);
          const limit = parseInt(document.getElementById('ap-edit-limit').value, 10);

          await Panoptica.api(`/api/alerts/policies/${policy.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              detection_logic: parsedLogic,
              notification_limit: limit,
            }),
          });

          Panoptica.closeModal();
          Panoptica.showToast(window.t('alert_policies.toast_policy_saved'), 'success');
          // Refresh the list
          policies = await Panoptica.api('/api/alerts/policies/list');
          renderPolicies();
        } catch (e) {
          Panoptica.showToast(window.t('alert_policies.toast_error', { message: e.message }), 'error');
        }
      });
    }, 0);
  }

  // ─── Helpers ───

  function el(id) { return document.getElementById(id); }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  window.PanopticaPage = { init, destroy };
})();
