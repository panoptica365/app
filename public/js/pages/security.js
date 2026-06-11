/**
 * Panoptica365 — Security Settings (standalone route wrapper)
 *
 * The Security settings UI is implemented as a shared, mountable controller
 * (window.Panoptica.SecurityPanel, loaded from index.html) so the per-tenant
 * dashboard can host the same panel in its Security tab. This page module is
 * the thin standalone-route adapter: it mounts the controller with the tenant
 * picker visible, and tears it down on navigation away.
 *
 * Heatmap drill-in historically deep-linked here with ?tenant&setting&category;
 * that path now targets the dashboard Security tab (see heatmap.js gotoSecurity),
 * but the params are still honored here for any old bookmarks.
 */
(function () {
  'use strict';

  window.PanopticaPage = {
    init: (params = {}) => {
      if (!window.Panoptica || !window.Panoptica.SecurityPanel) {
        console.error('[Security] SecurityPanel controller not loaded (check index.html script order)');
        return;
      }
      return window.Panoptica.SecurityPanel.mount({
        root: document.getElementById('sec-panel-body'),
        tenantId: params.tenant != null ? params.tenant : null,
        showPicker: true,
        openSettingId: params.setting || null,
        category: params.category || null,
      });
    },
    destroy: () => {
      if (window.Panoptica && window.Panoptica.SecurityPanel) {
        window.Panoptica.SecurityPanel.unmount();
      }
    },
  };
})();
