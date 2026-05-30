/**
 * Panoptica — Alert Dashboard Page (Phase 3)
 * Global alert view with filters, bulk select, slide-out detail panel with Quill notes.
 */
(function () {
  'use strict';

  let currentAlerts = [];
  let selectedIds = new Set();
  let currentPage = 1;
  let totalMatching = 0;
  let tenantFilterMode = null; // null = global, number = pre-filtered tenant id
  let autoRefreshInterval = null;
  let filterBar = null; // Panoptica.AlertFilterBar instance

  const LIMIT = 50;
  const AUTO_REFRESH_MS = 60 * 1000; // 60 seconds

  // ─── Init / Destroy ───

  async function init(params) {
    tenantFilterMode = params?.tenant_id ? parseInt(params.tenant_id, 10) : null;

    // Mount the shared filter bar (hides tenant selector when pre-filtered).
    filterBar = await Panoptica.AlertFilterBar.mount(
      el('alert-filter-bar-container'),
      {
        showTenantSelector: !tenantFilterMode,
        onChange: () => loadAlerts(1),
      }
    );

    wireEvents();
    await loadAlerts();

    // Auto-refresh every 60 seconds (skip if detail panel is open)
    autoRefreshInterval = setInterval(() => {
      if (!Panoptica.AlertSlideout?.isOpen()) loadAlerts(currentPage);
    }, AUTO_REFRESH_MS);
  }

  function destroy() {
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
    // Close any open slideout so the page teardown is clean
    Panoptica.AlertSlideout?.close();
    selectedIds.clear();
    filterBar = null;
  }

  // ─── Filters ───
  // Layer tenantFilterMode on top of the shared bar's filters when the caller
  // pre-filtered by tenant (bar returns tenant_id:'' in that case).

  function getFilters() {
    const f = filterBar ? filterBar.getFilters() : { tenant_id: '', severity: '', status: '', category: '', show_resolved: '' };
    if (tenantFilterMode) f.tenant_id = tenantFilterMode;
    return f;
  }

  // ─── Load Alerts ───

  async function loadAlerts(page) {
    currentPage = page || 1;
    const filters = getFilters();
    const params = new URLSearchParams({
      ...filters,
      page: currentPage,
      limit: LIMIT,
    });

    // Remove empty params
    for (const [k, v] of [...params.entries()]) {
      if (!v) params.delete(k);
    }

    try {
      const data = await Panoptica.api(`/api/alerts?${params}`);
      currentAlerts = data.alerts || [];
      totalMatching = data.pagination?.total || 0;
      selectedIds.clear();
      renderTable();
      renderPagination(data.pagination);
      updateBulkBar();
    } catch (e) {
      console.error('[Alerts] Load failed:', e);
      el('alert-tbody').innerHTML = '';
      el('alert-no-data').style.display = 'block';
    }
  }

  // ─── Render Table ───

  function renderTable() {
    const tbody = el('alert-tbody');
    const noData = el('alert-no-data');

    if (currentAlerts.length === 0) {
      tbody.innerHTML = '';
      noData.style.display = 'block';
      return;
    }
    noData.style.display = 'none';

    tbody.innerHTML = currentAlerts.map(a => `
      <tr class="alert-row" data-id="${a.id}">
        <td class="alert-td-check"><input type="checkbox" class="alert-check" data-id="${a.id}" ${selectedIds.has(a.id) ? 'checked' : ''}></td>
        <td><span class="alert-severity-badge sev-${a.severity}">${esc(window.t('alerts.' + a.severity))}</span></td>
        <td class="alert-td-tenant">${a.alert_scope === 'msp' ? esc(window.t('alerts.msp_wide_scope')) : esc(a.tenant_name)}</td>
        <td class="alert-td-message">${esc(renderAlertMessage(a))}${attributionChip(a)}</td>
        <td class="alert-td-category">${formatCategory(a.category)}</td>
        <td class="alert-td-time">${formatTime(a.triggered_at)}</td>
        <td class="alert-td-recurrence">${a.recurrence_count > 1 ? a.recurrence_count + '×' : ''}</td>
        <td><span class="alert-status-pill status-${a.status}">${esc(window.t('alerts.' + a.status))}</span></td>
      </tr>
    `).join('');

    // Row click → open detail panel
    tbody.querySelectorAll('.alert-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return; // Don't open panel on checkbox click
        openDetail(parseInt(row.dataset.id, 10));
      });
    });

    // Checkbox change
    tbody.querySelectorAll('.alert-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id, 10);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        updateBulkBar();
      });
    });

    // Update header checkbox
    el('alert-check-all').checked = false;
  }

  function renderPagination(pg) {
    const container = el('alert-pagination');
    if (!pg || pg.pages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= pg.pages; i++) {
      html += `<button class="alert-page-btn ${i === pg.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    html += `<span class="alert-page-info">${pg.total} alerts</span>`;
    container.innerHTML = html;

    container.querySelectorAll('.alert-page-btn').forEach(btn => {
      btn.addEventListener('click', () => loadAlerts(parseInt(btn.dataset.page, 10)));
    });
  }

  // ─── Bulk Actions ───

  function updateBulkBar() {
    const bar = el('alert-bulk-bar');
    if (selectedIds.size > 0) {
      bar.style.display = 'flex';
      el('alert-bulk-count').textContent = `${selectedIds.size} selected`;

      // Show "select all matching" link if header checkbox is checked and there are more alerts
      const allLink = el('alert-bulk-all-link');
      if (el('alert-check-all').checked && totalMatching > currentAlerts.length) {
        allLink.innerHTML = `<a href="#" id="alert-select-all-matching">Select all ${totalMatching} matching alerts</a>`;
        allLink.style.display = 'inline';
        el('alert-select-all-matching').addEventListener('click', (e) => {
          e.preventDefault();
          selectedIds = new Set(['__ALL_FILTERED__']);
          el('alert-bulk-count').textContent = `All ${totalMatching} selected`;
          allLink.style.display = 'none';
        });
      } else {
        allLink.style.display = 'none';
      }
    } else {
      bar.style.display = 'none';
    }
  }

  async function bulkAction(newStatus) {
    try {
      if (selectedIds.has('__ALL_FILTERED__')) {
        // Bulk update all matching alerts via filter
        await Panoptica.api('/api/alerts/bulk-status-filtered', {
          method: 'POST',
          body: JSON.stringify({ filters: getFilters(), new_status: newStatus }),
        });
      } else {
        // Bulk update selected IDs
        await Panoptica.api('/api/alerts/bulk-status', {
          method: 'POST',
          body: JSON.stringify({ alert_ids: [...selectedIds], status: newStatus }),
        });
      }
      Panoptica.showToast(window.t('alerts.toast_marked_as', { status: newStatus }), 'success');
      selectedIds.clear();
      // Refresh global badges immediately — bulk resolves drop the open count
      // by N, don't make the user wait for the 60s poll.
      Panoptica.refreshAlertSignals?.();
      await loadAlerts(currentPage);
    } catch (e) {
      Panoptica.showToast(window.t('alerts.toast_update_failed', { message: e.message }), 'error');
    }
  }

  // ─── Slide-out Detail Panel ───
  // All rendering / Quill / status-change logic lives in the shared module
  // /js/shared/alert-slideout.js — this page just opens it and hands it a
  // refresh callback so our table reflects any status change.

  function openDetail(alertId) {
    Panoptica.AlertSlideout.open(alertId, {
      onStatusChanged: () => loadAlerts(currentPage),
    });
  }

  // ─── Wire Events ───

  function wireEvents() {
    // Filter change events are wired inside the shared AlertFilterBar module
    // (see filterBar.onChange in init()).

    // Header checkbox
    el('alert-check-all')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      selectedIds.clear();
      if (checked) {
        currentAlerts.forEach(a => selectedIds.add(a.id));
      }
      document.querySelectorAll('.alert-check').forEach(cb => { cb.checked = checked; });
      updateBulkBar();
    });

    // Bulk action buttons
    document.querySelectorAll('.alert-bulk-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action && selectedIds.size > 0) bulkAction(action);
      });
    });

    // Slide-out close is wired inside the shared module (Panoptica.AlertSlideout).
  }

  // ─── Helpers ───

  function el(id) { return document.getElementById(id); }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    return d.toLocaleString(dateLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatCategory(cat) {
    if (!cat) return '—';
    const key = 'alerts.category.' + cat;
    const translated = window.t(key);
    // Defensive: if the key is missing, t() returns the key itself — fall back to raw token.
    return translated === key ? cat : translated;
  }

  // ─── Localized alert message ───
  // Apr 30, 2026 — i18n Phase 6. When the alerts list endpoint surfaces
  // message_template_key + message_template_params (extracted from raw_data
  // via JSON_EXTRACT, so wire payload stays small), re-render the message
  // in the operator's locale at display time. Settings without a structured
  // template fall back to the stored English `message` column unchanged.
  //
  // Resolve *Key/*Fallback pairs into final translated strings, and merge
  // them with the rest of the params so they can all be passed straight to
  // window.t() for {placeholder} interpolation. Backward-compat with the
  // security_drift shape: (settingNameKey, settingNameFallback) →
  // {settingName}, (interpretedKey, interpretedParams) → {interpretedText}.
  // For Phase 9b per-alert-type templates, accepts arbitrary <base>NameKey
  // + <base>NameFallback pairs (e.g. policyNameKey + policyNameFallback →
  // {policyName}). Plain values pass through unchanged.
  function resolveTemplateParams(params) {
    const out = {};
    // Pass-through scalar params first so the per-pair logic below can
    // overwrite same-named computed values without the original being lost.
    for (const k of Object.keys(params)) {
      const v = params[k];
      // Skip the metadata pairs themselves; they get resolved into their
      // synthetic siblings below.
      if (k.endsWith('Key') || k.endsWith('Fallback') || k === 'interpretedParams') continue;
      out[k] = v;
    }
    // Resolution pass 1 — <base>NameKey + <base>NameFallback → {<base>Name}.
    // Used for policy/setting names that have stable canonical English
    // strings backed by alert_policy_names.<slug> / security_settings.*.name.
    // Pattern: "policyNameKey" → out.policyName, "settingNameKey" → out.settingName.
    for (const k of Object.keys(params)) {
      if (!k.endsWith('NameKey')) continue;
      const base = k.substring(0, k.length - 'NameKey'.length); // "policy", "setting"
      const fallback = params[base + 'NameFallback'] || '';
      const translated = params[k]
        ? window.PanopticaI18n.tOrFallback(params[k], fallback)
        : fallback;
      out[base + 'Name'] = translated;
    }
    // Resolution pass 2 — generic <var>Key + <var>Fallback → {<var>}. Used for
    // sub-template fragments that have multiple branches (e.g. inbox rule
    // forwarding notes: external / internal / none). Skip <base>NameKey/Fallback
    // pairs already resolved above.
    for (const k of Object.keys(params)) {
      if (!k.endsWith('Key')) continue;
      if (k.endsWith('NameKey')) continue;        // handled above
      if (k === 'interpretedKey') continue;       // handled below
      const base = k.substring(0, k.length - 'Key'.length);
      const fallback = params[base + 'Fallback'] || '';
      const translated = params[k]
        ? window.PanopticaI18n.tOrFallback(params[k], fallback, params)
        : fallback;
      out[base] = translated;
    }
    // security_drift legacy: interpretedKey + interpretedParams → {interpretedText}
    if (params.interpretedKey) {
      out.interpretedText = window.t(params.interpretedKey, params.interpretedParams || {});
    }
    return out;
  }

  function renderAlertMessage(a) {
    // Path 1: structured payload (security_drift Phase 6 + per-alert-type Phase 9b).
    // Supports two payload shapes:
    //   (a) security_drift legacy: { settingNameKey, settingNameFallback,
    //       interpretedKey, interpretedParams } → resolves {settingName} +
    //       {interpretedText} for the parent template.
    //   (b) generic per-alert-type (Phase 9b, May 2 2026): a flat dict whose
    //       keys map directly to {placeholders} in the template, plus optional
    //       *Key/*Fallback pairs. Each "<base>NameKey" (or "<base>Key") +
    //       "<base>NameFallback" (or "<base>Fallback") pair is resolved via
    //       tOrFallback and exposed under "<base>" / "<base>Name" — so a
    //       template can reference {policyName} when the payload carries
    //       policyNameKey + policyNameFallback. All other keys pass through
    //       verbatim, so {user} / {count} / {windowMinutes} interpolate as-is.
    if (a.message_template_key && a.message_template_params) {
      let params;
      try {
        params = typeof a.message_template_params === 'string'
          ? JSON.parse(a.message_template_params)
          : a.message_template_params;
      } catch {
        return a.message;
      }
      if (params && typeof params === 'object') {
        try {
          const resolved = resolveTemplateParams(params);
          // UAL evaluators (Bundle A–F) historically stored bare keys like
          // `ual_defender_incident`, while alert-engine.js stores fully-
          // qualified paths like `alerts.message_format.count_per_user`.
          // All locale entries live under `alerts.message_format.*`, so on
          // a miss with a bare key we transparently retry with the prefix.
          // Without this fallback the bare-key UAL alerts surface as raw
          // keys in the dashboard. (Discovered May 12 2026 via Bundle F.)
          let rendered = window.t(a.message_template_key, resolved);
          if (rendered === a.message_template_key && !a.message_template_key.includes('.')) {
            const prefixed = 'alerts.message_format.' + a.message_template_key;
            const retried = window.t(prefixed, resolved);
            if (retried !== prefixed) rendered = retried;
          }
          return rendered;
        } catch (e) {
          console.warn('[alerts] renderAlertMessage failed:', e.message);
        }
      }
    }
    // Path 2: legacy general-alert message — replace the English policy-name
    // prefix with the translated version. The alert-engine constructs messages
    // as `${policy.name}: <detail>`. We slug the policy_name (which is the
    // English DB value joined onto the alert row) and look up its translation.
    // The detail part stays English (May 2, 2026) — that's a per-alert-type
    // refactor for a later phase.
    if (a.policy_name && a.message && typeof a.message === 'string') {
      const prefix = a.policy_name + ':';
      if (a.message.startsWith(prefix)) {
        const slug = window.PanopticaI18n.slugify(a.policy_name);
        const translated = window.PanopticaI18n.tOrFallback('alert_policy_names.' + slug, a.policy_name);
        if (translated !== a.policy_name) {
          return translated + a.message.substring(a.policy_name.length);
        }
      }
    }
    // Path 3: known custom prefixes that don't match policy_name (CA + Intune
    // drift messages use literal English prefixes server-side, distinct from
    // their parent alert_policies.name). Match against the alert_message_prefix
    // namespace and substitute the translated form.
    if (a.message && typeof a.message === 'string') {
      const customPrefixes = [
        'CA exemption list changed',
        'CA drift auto-remediated',
        'CA policy drift detected',
        'Intune policy drift',
      ];
      for (const englishPrefix of customPrefixes) {
        if (a.message.startsWith(englishPrefix + ':')) {
          const slug = window.PanopticaI18n.slugify(englishPrefix);
          const translated = window.PanopticaI18n.tOrFallback('alert_message_prefix.' + slug, englishPrefix);
          if (translated !== englishPrefix) {
            return translated + a.message.substring(englishPrefix.length);
          }
          break;
        }
      }
    }
    return a.message;
  }

  // ─── Attribution chip ───
  // Renders an "Operator change logged" pill alongside the alert message
  // when alerts.auto_attributed_change_id was set by the 60-min surface
  // match attributor (server-side, see src/change-log.js::findAttributingChange).
  // Tooltip-only here — full detail + navigation lives in the slideout.
  function attributionChip(a) {
    if (!a.auto_attributed_change_id) return '';
    const desc = a.attributed_change_description || 'Logged change';
    const actor = a.attributed_change_actor ? ` by ${a.attributed_change_actor}` : '';
    const when = a.attributed_change_started_at ? ` at ${formatTime(a.attributed_change_started_at)}` : '';
    const tooltip = `${desc}${actor}${when}`;
    return ` <span class="alert-attribution-chip" title="${esc(tooltip)}">Operator change logged</span>`;
  }

  window.PanopticaPage = { init, destroy };
})();
