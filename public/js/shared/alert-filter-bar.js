/**
 * Panoptica — Shared Alert Filter Bar
 *
 * Single source of truth for the alert filtering UI (tenant/severity/status/
 * category/show-resolved). Mounted by the global Alerts page and the
 * per-tenant Alerts view so a new filter added here shows up everywhere.
 *
 * Public API:
 *   const bar = await Panoptica.AlertFilterBar.mount(container, {
 *     showTenantSelector: true|false,
 *     initial: { tenant_id, severity, status, category, show_resolved },
 *     onChange: (filters) => { ... },
 *   });
 *
 *   bar.getFilters()          → { tenant_id, severity, status, category, show_resolved }
 *   bar.setFilters(partial)   → update one or more filter values (no onChange fire)
 *
 * Callers that pre-filter by tenant (e.g. tenant dashboard) should pass
 * showTenantSelector:false and apply their own tenant_id after reading
 * getFilters() — the bar always returns tenant_id === '' when the selector
 * is hidden.
 */
(function () {
  'use strict';

  // The data-i18n attributes are walked after innerHTML injection (see mount()).
  // Hardcoded English text is the fallback if i18n.js failed to load — same
  // pattern as the rest of the codebase.
  const BAR_HTML = `
    <div class="alert-filter-bar">
      <select class="alert-filter-select" data-filter-role="tenant">
        <option value="" data-i18n="alerts_filter.all_tenants">All Tenants</option>
      </select>
      <select class="alert-filter-select" data-filter-role="severity">
        <option value="" data-i18n="alerts_filter.all_severities">All Severities</option>
        <option value="severe" data-i18n="alerts.severe">Severe</option>
        <option value="high" data-i18n="alerts.high">High</option>
        <option value="medium" data-i18n="alerts.medium">Medium</option>
        <option value="low" data-i18n="alerts.low">Low</option>
        <option value="info" data-i18n="alerts.info">Info</option>
      </select>
      <select class="alert-filter-select" data-filter-role="status">
        <option value="" data-i18n="alerts_filter.all_active">All Active</option>
        <option value="new" data-i18n="alerts.new">New</option>
        <option value="investigating" data-i18n="alerts.investigating">Investigating</option>
      </select>
      <select class="alert-filter-select" data-filter-role="category">
        <option value="" data-i18n="alerts_filter.all_categories">All Categories</option>
        <option value="risky_signins" data-i18n="alerts_filter.cat_risky_signins">Risky Sign-ins</option>
        <option value="threat_mgmt" data-i18n="alerts_filter.cat_threat_mgmt">Threat Management</option>
        <option value="external_sharing" data-i18n="alerts_filter.cat_external_sharing">External Sharing</option>
        <option value="config_changes" data-i18n="alerts_filter.cat_config_changes">Configuration changes</option>
        <option value="permissions" data-i18n="alerts_filter.cat_permissions">Permissions</option>
        <option value="info_governance" data-i18n="alerts_filter.cat_info_governance">Info Governance</option>
      </select>
      <label class="alert-toggle-label">
        <input type="checkbox" data-filter-role="resolved">
        <span data-i18n="alerts_filter.show_resolved">Show Resolved</span>
      </label>
    </div>
  `;

  async function mount(container, options) {
    if (!container) throw new Error('AlertFilterBar.mount: container is required');
    const opts = options || {};
    container.innerHTML = BAR_HTML.trim();
    // Translate the data-i18n attributes we just injected. Defensive null check
    // so a missing i18n.js doesn't break the filter bar.
    if (window.PanopticaI18n) window.PanopticaI18n.applyTo(container);

    const tenantSel = container.querySelector('[data-filter-role="tenant"]');

    if (!opts.showTenantSelector) {
      if (tenantSel) tenantSel.style.display = 'none';
    } else if (tenantSel) {
      try {
        const tenants = await Panoptica.api('/api/tenants');
        tenants.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.display_name;
          tenantSel.appendChild(opt);
        });
      } catch (e) {
        console.error('[AlertFilterBar] Failed to load tenants:', e);
      }
    }

    // Apply initial values before wiring onChange (prevents a spurious fire)
    if (opts.initial) setFilters(container, opts.initial);

    // Wire change events
    if (typeof opts.onChange === 'function') {
      container.querySelectorAll('[data-filter-role]').forEach(ctl => {
        ctl.addEventListener('change', () => {
          try { opts.onChange(getFilters(container)); } catch (e) {
            console.error('[AlertFilterBar] onChange handler threw:', e);
          }
        });
      });
    }

    return {
      getFilters: () => getFilters(container),
      setFilters: (vals) => setFilters(container, vals),
    };
  }

  function getFilters(container) {
    const tenant = container.querySelector('[data-filter-role="tenant"]');
    const severity = container.querySelector('[data-filter-role="severity"]');
    const status = container.querySelector('[data-filter-role="status"]');
    const category = container.querySelector('[data-filter-role="category"]');
    const resolved = container.querySelector('[data-filter-role="resolved"]');

    // When the tenant selector is hidden the caller is pre-filtering — return
    // '' so they can layer their own tenant_id on top without ambiguity.
    const tenantVisible = tenant && tenant.style.display !== 'none';

    return {
      tenant_id: tenantVisible ? (tenant.value || '') : '',
      severity: severity ? (severity.value || '') : '',
      status: status ? (status.value || '') : '',
      category: category ? (category.value || '') : '',
      show_resolved: resolved && resolved.checked ? 'true' : '',
    };
  }

  function setFilters(container, vals) {
    if (!vals) return;
    const mapping = [
      ['tenant_id', 'tenant', 'value'],
      ['severity', 'severity', 'value'],
      ['status', 'status', 'value'],
      ['category', 'category', 'value'],
      ['show_resolved', 'resolved', 'checked'],
    ];
    mapping.forEach(([key, role, prop]) => {
      if (vals[key] === undefined || vals[key] === null) return;
      const el = container.querySelector(`[data-filter-role="${role}"]`);
      if (!el) return;
      if (prop === 'checked') {
        el.checked = vals[key] === true || vals[key] === 'true';
      } else {
        el.value = String(vals[key]);
      }
    });
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.AlertFilterBar = { mount };
})();
