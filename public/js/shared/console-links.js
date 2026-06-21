/**
 * Panoptica — Shared Microsoft Console Deep-Link Builder
 *
 * Single source of truth for the "Management Consoles Launcher" URLs (Tenant
 * Management → Management Consoles tab). Navigation only — Panoptica writes
 * nothing to the customer tenant; these links just hand the operator the
 * fastest path into the right Microsoft admin console, in the correct tenant
 * context, under the operator's own GDAP delegated permissions.
 *
 * Design (build spec §3 — "store the inputs, compute the links"):
 *   We persist each tenant's tenant_id + default_domain + initial_domain and
 *   build the URLs HERE at render time. We do NOT materialize/store full URLs —
 *   when Microsoft changes a portal URL we edit one template in this file, not
 *   every tenant row.
 *
 * Resilience: four consoles (entra, azure, defender, m365) need only the
 * tenant_id, which is always present → they render immediately, even before the
 * domain backfill lands or if it fails for a tenant. The other four depend on a
 * resolved domain → build() reports ready:false (url:null) for them until the
 * domain is resolved, so the UI renders a disabled "Resolving…" state instead of
 * a broken link. No broken icons, ever.
 *
 * Public API:
 *   PanopticaConsoleLinks.build(tenant [, options])
 *     → [{ key, title, short, descKey, tint, icon, requires, ready, url }, …]
 *       in display order. `url` is null when `ready` is false.
 *   PanopticaConsoleLinks.CONSOLES — the static template table (no per-tenant
 *     state), exposed for callers that only need metadata (icons/titles).
 *
 * Blade extensibility (build spec §10 — out of scope now, built to allow it):
 *   options.blades = { entra: '#view/…', defender: '#…', … } appends a per-
 *   console blade/hash suffix to the base URL, so a later change can deep-link
 *   an alert straight to the relevant blade ("suspicious sign-in on Tenant X →
 *   its Entra sign-in logs") by reusing this exact builder.
 */
(function () {
  'use strict';

  // Lucide-style inner-SVG path markup per console. The caller wraps these in a
  // <svg viewBox="0 0 24 24" …> element (matrix cells, focus cards, headers).
  const ICONS = {
    entra:      '<circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    azure:      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    exchange:   '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    m365:       '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    intune:     '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    defender:   '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    sharepoint: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    teams:      '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  };

  // SharePoint admin URL needs the *.onmicrosoft.com prefix, which is the
  // INITIAL domain (not the default/vanity domain): "contoso.onmicrosoft.com"
  // → "contoso-admin.sharepoint.com".
  function spoSlug(initialDomain) {
    return String(initialDomain || '').split('.')[0];
  }

  // The console template table (build spec §3). Display order matches the
  // mock-up (the visual source of truth). Titles + short labels are proper
  // nouns — intentionally NOT translated; descriptions are i18n keys.
  //
  // `requires` names the single stored input each URL needs:
  //   tenant_id      — always present → always ready (renders before backfill)
  //   default_domain — resolved verified domain (delegatedOrg / Intune path)
  //   initial_domain — *.onmicrosoft.com (SharePoint admin slug)
  const CONSOLES = [
    { key: 'entra',      short: 'Entra',      title: 'Entra Admin',         tint: 'mc-t-entra',      requires: 'tenant_id',
      base: t => 'https://entra.microsoft.com/' + t.tenant_id },
    { key: 'azure',      short: 'Azure',      title: 'Azure Portal',        tint: 'mc-t-azure',      requires: 'tenant_id',
      base: t => 'https://portal.azure.com/' + t.tenant_id },
    { key: 'exchange',   short: 'Exchange',   title: 'Exchange Admin',      tint: 'mc-t-exchange',   requires: 'default_domain',
      base: t => 'https://admin.exchange.microsoft.com/?delegatedOrg=' + encodeURIComponent(t.default_domain) },
    { key: 'm365',       short: '365',        title: 'Microsoft 365 Admin', tint: 'mc-t-m365',       requires: 'tenant_id',
      base: t => 'https://admin.microsoft.com/Partner/beginclientsession.aspx?CTID=' + t.tenant_id + '&CSDEST=o365admincenter' },
    { key: 'intune',     short: 'Intune',     title: 'Intune Admin',        tint: 'mc-t-intune',     requires: 'default_domain',
      base: t => 'https://intune.microsoft.com/' + encodeURIComponent(t.default_domain) },
    { key: 'defender',   short: 'Defender',   title: 'Microsoft Defender',  tint: 'mc-t-defender',   requires: 'tenant_id',
      base: t => 'https://security.microsoft.com/?tid=' + t.tenant_id },
    { key: 'sharepoint', short: 'SharePoint', title: 'SharePoint Admin',    tint: 'mc-t-sharepoint', requires: 'initial_domain',
      base: t => 'https://' + spoSlug(t.initial_domain) + '-admin.sharepoint.com' },
    { key: 'teams',      short: 'Teams',      title: 'Teams Admin',         tint: 'mc-t-teams',      requires: 'default_domain',
      base: t => 'https://admin.teams.microsoft.com/?delegatedOrg=' + encodeURIComponent(t.default_domain) },
  ];

  function build(tenant, options) {
    const t = tenant || {};
    const blades = (options && options.blades) || {};
    return CONSOLES.map(c => {
      // `ready` is gated on this console's own required input — independently,
      // so a tenant with (say) a resolved default_domain but no initial_domain
      // still lights up Exchange/Teams/Intune while SharePoint stays disabled.
      const ready = !!t[c.requires];
      const blade = blades[c.key] || '';
      return {
        key: c.key,
        title: c.title,
        short: c.short,
        descKey: 'tenants.consoles.c.' + c.key + '.desc',
        tint: c.tint,
        icon: ICONS[c.key],
        requires: c.requires,
        ready,
        url: ready ? (c.base(t) + blade) : null,
      };
    });
  }

  window.PanopticaConsoleLinks = { build, CONSOLES, ICONS };
})();
