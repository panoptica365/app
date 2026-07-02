/**
 * Panoptica365 — Reusable "Filter by Tenant Group" dropdown
 * (Tenant Groups Phase 1 rider, 2026-07-01)
 *
 * ONE component wired into both the Heatmap and the global Trends page (and
 * available to future surfaces — reporting, briefings). Do not fork this per
 * surface.
 *
 * Usage (inside a page module's init):
 *   PanopticaGroupFilter.mount(containerEl, {
 *     value: currentGroupIdOrNull,
 *     onChange: (groupId) => { ...refetch... },   // groupId: number|null
 *   });
 *
 * Renders a label + <select> listing every tenant group with its live member
 * count (from GET /api/org/groups — counts come from the server-side
 * resolver). Read-only: available to all roles. Fails soft — if the group
 * list can't load (or there are no groups yet), the container stays empty so
 * the host page renders exactly as before this feature existed.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function t(key, params) {
    try { return window.t ? window.t(key, params) : key; } catch (_) { return key; }
  }

  async function mount(container, opts = {}) {
    if (!container) return;
    container.innerHTML = '';

    let groups = [];
    try {
      const res = await window.Panoptica.api('/api/org/groups');
      groups = Array.isArray(res) ? res : [];
    } catch (err) {
      // Fail soft: filtering is a convenience — never break the host page.
      console.warn('[GroupFilter] group list load failed:', err.message);
      return;
    }
    if (!groups.length) return; // nothing to filter by yet — stay invisible

    const current = opts.value == null ? '' : String(opts.value);
    const label = document.createElement('label');
    label.textContent = t('group_filter.label');
    label.style.cssText = 'font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--p-text-muted); margin-right:8px;';

    const select = document.createElement('select');
    select.className = 'form-control';
    select.style.cssText = 'min-width:200px; max-width:280px; padding:6px 10px; font-size:.85rem;';
    select.innerHTML =
      `<option value=""${current === '' ? ' selected' : ''}>${esc(t('group_filter.all'))}</option>` +
      groups.map(g =>
        `<option value="${Number(g.id)}"${current === String(g.id) ? ' selected' : ''}>${esc(g.name)} (${Number(g.member_count) || 0})</option>`
      ).join('');

    select.addEventListener('change', () => {
      const v = select.value ? parseInt(select.value, 10) : null;
      if (typeof opts.onChange === 'function') opts.onChange(Number.isInteger(v) ? v : null);
    });

    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.appendChild(label);
    container.appendChild(select);
  }

  window.PanopticaGroupFilter = { mount };
})();
