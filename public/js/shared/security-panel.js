/**
 * Panoptica365 — Security Settings Controller (shared, mountable)
 *
 * The per-tenant Security settings UI, extracted into a controller both
 * surfaces share: the standalone Security route (via the thin
 * pages/security.js wrapper) and the per-tenant dashboard's Security tab.
 * Loaded once from index.html and exposed as window.Panoptica.SecurityPanel.
 *
 * Public API:
 *   Panoptica.SecurityPanel.mount({ root, tenantId, showPicker, openSettingId, category })
 *   Panoptica.SecurityPanel.unmount()
 *
 * mount() injects the shared body markup (/partials/security-body.html) into
 * the host element, wires handlers, scopes to a tenant (picker on the
 * standalone route, fixed tenantId in the dashboard tab), and re-runs RBAC
 * visibility on the subtree. unmount() clears the refresh-status poll, the
 * busy ticker and the async-apply poll so no timer leaks across a tab switch,
 * tenant switch, or page leave.
 *
 * No-auto-remediation policy stands: Apply / Match / Remediate / Accept and
 * the delegated-auth (Teams) flow are preserved exactly — this controller only
 * changed WHERE the page mounts, never WHAT it does.
 */
(function () {
  'use strict';

  let tenants = [];
  let currentTenantId = null;
  let currentSettings = [];
  let filters = { category: 'all', priority: 'all' };

  // Apr 30, 2026 — i18n Phase 6: server may return current_value_interpreted
  // as either a legacy English string OR a structured {template_key, params}
  // object. This helper normalizes both into a translated string for the
  // current locale. Migrated settings (writer.interpret() in registry.js)
  // produce the structured shape; unmigrated ones still return strings.
  // Once all 17 readers are migrated, the string branch can be removed.
  function renderInterpreted(interpreted, fallback) {
    if (interpreted == null) return fallback || '—';
    if (typeof interpreted === 'string') return interpreted;
    if (typeof interpreted === 'object' && interpreted.template_key) {
      return window.t(interpreted.template_key, interpreted.params || {});
    }
    return fallback || '—';
  }
  // Phase B — currently-open setting detail (so the Configure tab can submit).
  // Mirrors the data shape returned by GET /tenants/:tid/settings/:sid.
  let openDetail = null;
  let configureSelectedValue = undefined;
  let activeTab = 'overview';
  // Apr 28, 2026 — delegated-auth state for Teams writers (TEA-01, TEA-02).
  // Cached after each fetch, refreshed when popup completes or manually.
  let delegatedAuthState = null;
  // Set when an Apply hits 401 DELEGATED_AUTH_REQUIRED — popup is opened,
  // and once the postMessage arrives we re-invoke the queued function.
  let pendingDelegatedApply = null;
  // In-flight refresh status-polling interval. Cleared on completion,
  // tenant change, or page destroy. We poll every 5s to balance UX
  // responsiveness against polling cost.
  let refreshPollInterval = null;
  let refreshPollStartedAt = null;

  // ─── Shared body markup (fetched once, cached) ───
  //
  // The summary bar, filter chips, settings table, detail modal and preset
  // guide modal live in /partials/security-body.html so both surfaces — the
  // standalone Security route and the per-tenant dashboard's Security tab —
  // render identical markup from a single source. mount() injects it into the
  // host element; the standalone partial supplies only the tenant-picker
  // header (which is meaningless inside the dashboard, where the tenant is
  // already fixed).
  let bodyHtmlCache = null;
  let mounted = false;
  let mountRoot = null;

  async function loadBodyMarkup(root) {
    if (bodyHtmlCache == null) {
      // no-store matches the SPA's partial-fetch convention; the in-memory
      // cache means repeated mounts (tab/tenant switches) never re-fetch.
      const res = await fetch('/partials/security-body', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bodyHtmlCache = await res.text();
    }
    root.innerHTML = bodyHtmlCache;
    // Translate the just-injected markup + render any Lucide icons it carries.
    if (window.PanopticaI18n) window.PanopticaI18n.applyTo(root);
    if (window.Panoptica && typeof window.Panoptica.refreshIcons === 'function') {
      window.Panoptica.refreshIcons(root);
    }
  }

  // Wire all body-scoped handlers (filter chips, modal tabs, configure /
  // remediate / preset-guide actions, delegated-auth buttons). These bind to
  // the sec-* IDs in the just-injected body markup. The tenant picker +
  // Refresh button live in the standalone header, so they're wired separately
  // in mount() only when showPicker === true.
  function wireBodyHandlers() {
    // Refresh button now lives in the shared body (so the dashboard Security
    // tab has it too), so it's wired here for both surfaces. It starts disabled
    // until a tenant is in scope: onTenantChanged enables it on the standalone
    // route; mount() enables it directly in the dashboard tab.
    const refreshBtn = document.getElementById('sec-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', onRefreshClick);

    document.getElementById('sec-detail-close-btn').addEventListener('click', hideDetailModal);

    // Close modal on overlay click
    const overlay = document.getElementById('sec-detail-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target.id === 'sec-detail-overlay') hideDetailModal();
    });

    // Filter chip handlers (event delegation — covers both category and priority groups)
    document.querySelectorAll('#sec-category-chips, #sec-priority-chips').forEach(group => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.sec-chip');
        if (!btn) return;
        const key = btn.dataset.filter;
        const val = btn.dataset.value;
        filters[key] = val;
        // Toggle .active within the same group only
        group.querySelectorAll('.sec-chip').forEach(b => b.classList.toggle('active', b === btn));
        renderTable();
      });
    });

    // Modal tabs
    document.getElementById('sec-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.sec-tab');
      if (!btn || btn.disabled) return;
      switchTab(btn.dataset.tab);
    });

    // Configure tab actions
    document.getElementById('sec-cfg-apply-btn').addEventListener('click', onApplyClick);
    document.getElementById('sec-cfg-match-btn').addEventListener('click', onMatchClick);
    document.getElementById('sec-cfg-confirm-yes').addEventListener('click', onConfirmYes);
    document.getElementById('sec-cfg-confirm-cancel').addEventListener('click', onConfirmCancel);
    // Audit-only Match handler (CMP-02 DLP) — separate button so the audit-only
    // panel can show its own busy state and status.
    document.getElementById('sec-cfg-audit-match-btn').addEventListener('click', onAuditMatchClick);

    // Delegated-auth UI handlers (TEA-01, TEA-02). Sign-in opens a popup to
    // /auth/teams-delegated/login; popup posts back when done (see
    // onTeamsDelegatedMessage, registered as a window listener in mount()).
    document.getElementById('sec-cfg-delegated-auth-signin').addEventListener('click', onDelegatedSignInClick);
    document.getElementById('sec-cfg-delegated-auth-signout').addEventListener('click', onDelegatedSignOutClick);

    // Remediate tab actions
    document.getElementById('sec-rem-restore-btn').addEventListener('click', onRemediateRestore);
    document.getElementById('sec-rem-accept-btn').addEventListener('click', onRemediateAccept);

    // EXO-06 preset first-time-setup guide modal
    document.getElementById('sec-rem-guide-btn').addEventListener('click', openPresetGuide);
    document.getElementById('sec-preset-guide-close-btn').addEventListener('click', closePresetGuide);
    document.getElementById('sec-preset-guide-refresh-btn').addEventListener('click', () => {
      closePresetGuide();
      hideDetailModal();
      onRefreshClick();
    });
    const guideOverlay = document.getElementById('sec-preset-guide-overlay');
    guideOverlay.addEventListener('click', (e) => {
      if (e.target.id === 'sec-preset-guide-overlay') closePresetGuide();
    });
  }

  // Teams delegated-auth popup callback (TEA-01/02). Extracted to a named
  // handler so mount/unmount can add/remove EXACTLY ONE window listener —
  // re-mounting across tab/tenant switches must never stack duplicates.
  // Defensive: validate by re-fetching status (don't trust the popup payload).
  function onTeamsDelegatedMessage(ev) {
    const data = ev.data;
    if (!data || data.type !== 'panoptica.teams-delegated.callback') return;
    refreshDelegatedAuthBanner();
    if (data.ok) {
      // Mark successful-auth time so the Apply circuit breaker can detect
      // "we just authenticated and Apply still 401s" and avoid looping the
      // popup. Window-attached so it survives module-reload edge cases.
      window.__panopticaTeamsDelegatedAuthAtMs = Date.now();
      // If an Apply was queued waiting for auth, retry it now.
      if (pendingDelegatedApply) {
        const { fn } = pendingDelegatedApply;
        pendingDelegatedApply = null;
        fn();
      }
    }
  }

  // Pre-select a category filter chip (heatmap drill-in passes a category).
  function applyCategoryFilter(category) {
    const validCats = ['exchange', 'identity', 'sharepoint', 'teams', 'defender', 'compliance'];
    if (!validCats.includes(category)) return;
    filters.category = category;
    document.querySelectorAll('#sec-category-chips .sec-chip').forEach(b =>
      b.classList.toggle('active', b.dataset.value === category));
  }

  // ─── Public: mount / unmount ──────────────────────────────
  //
  // mount({ root, tenantId, showPicker, openSettingId, category })
  //   root          host element to inject the body markup into
  //   tenantId      DB tenant id to scope to (used when showPicker === false)
  //   showPicker    true on the standalone route (tenant-picker header present);
  //                 false in the dashboard tab (the tenant is already fixed)
  //   openSettingId optional setting id to auto-open (heatmap drill-in)
  //   category      optional category to pre-filter (heatmap drill-in)
  //
  // mount is idempotent: a stray re-mount fully resets module state + DOM
  // rather than stacking listeners or timers.
  async function mount(opts = {}) {
    const { root, tenantId, showPicker = true, openSettingId = null, category = null } = opts;
    const host = root || document.getElementById('sec-panel-body') || document.body;
    if (mounted) unmount();
    mountRoot = host;
    await loadBodyMarkup(host);
    mounted = true;

    wireBodyHandlers();
    // Exactly one delegated-auth listener while mounted (remove-then-add is
    // idempotent; unmount removes it).
    window.removeEventListener('message', onTeamsDelegatedMessage);
    window.addEventListener('message', onTeamsDelegatedMessage);

    if (category) applyCategoryFilter(category);

    if (showPicker) {
      // Refresh button is wired in wireBodyHandlers() (shared body). Here we
      // only wire the standalone-only tenant picker, then populate it.
      const picker = document.getElementById('sec-tenant-picker');
      if (picker) picker.addEventListener('change', onTenantChanged);
      await loadTenantsForPicker();
    }

    // RBAC parity: hide/disable Apply/Match/Remediate for under-privileged
    // tiers on the freshly-injected subtree (mirrors the standalone page's
    // per-page applyRoleVisibility pass). Run after the picker fetch so the
    // header's Refresh button is gated too.
    if (window.Panoptica && typeof window.Panoptica.applyRoleVisibility === 'function') {
      window.Panoptica.applyRoleVisibility();
    }

    if (showPicker && tenantId != null) {
      // Standalone deep-link (legacy bookmarks): preselect the picker, load
      // that tenant's settings, then optionally open a setting's detail modal.
      const picker = document.getElementById('sec-tenant-picker');
      if (picker) {
        picker.value = String(tenantId);
        await onTenantChanged({ target: picker });
        if (openSettingId) {
          try { await openDetailModal(String(openSettingId).toUpperCase()); } catch (_e) { /* non-fatal */ }
        }
      }
    } else if (!showPicker) {
      // Dashboard tab: tenant is fixed; no picker. Enable Refresh (the picker's
      // onTenantChanged would normally do this) and load straight away.
      currentTenantId = parseInt(tenantId, 10) || null;
      const refreshBtn = document.getElementById('sec-refresh-btn');
      if (refreshBtn) refreshBtn.disabled = !currentTenantId;
      if (currentTenantId) {
        await loadSettings();
        if (openSettingId) {
          try { await openDetailModal(String(openSettingId).toUpperCase()); } catch (_e) { /* non-fatal */ }
        }
      }
    }
  }

  // unmount clears EVERY timer this controller can start so none leak when the
  // operator switches tabs, switches tenant, or leaves the page; removes the
  // window listener; resets all module state so a re-mount for a different
  // tenant starts clean; and clears the injected DOM so stale sec-* IDs don't
  // linger after the tab is left.
  function unmount() {
    clearRefreshPolling();
    if (busyTickHandle) { clearInterval(busyTickHandle); busyTickHandle = null; }
    stopActivePoll();
    window.removeEventListener('message', onTeamsDelegatedMessage);

    currentTenantId = null;
    currentSettings = [];
    filters = { category: 'all', priority: 'all' };
    openDetail = null;
    configureSelectedValue = undefined;
    activeTab = 'overview';
    delegatedAuthState = null;
    pendingDelegatedApply = null;
    secondaryUserEdited = false;
    secondarySelected = new Set();
    textInputUserEdited = false;
    busyStartedAt = null;

    if (mountRoot) mountRoot.innerHTML = '';
    mountRoot = null;
    mounted = false;
  }

  async function loadTenantsForPicker() {
    try {
      const res = await fetch('/api/tenants');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      tenants = Array.isArray(data) ? data : (data.tenants || []);
      const sel = document.getElementById('sec-tenant-picker');
      tenants
        .filter(t => t.enabled !== false)
        .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
        .forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.display_name || t.tenant_id;
          sel.appendChild(opt);
        });
    } catch (e) {
      console.error('[Security] tenant list load failed', e);
    }
  }

  async function onTenantChanged(e) {
    // Switching tenants — abandon any in-flight refresh-status polling
    // for the previous tenant. The background job on the server still
    // completes; we just stop watching it from this page.
    clearRefreshPolling();
    document.getElementById('sec-refresh-status').textContent = '';

    const tid = parseInt(e.target.value, 10) || null;
    currentTenantId = tid;
    document.getElementById('sec-refresh-btn').disabled = !tid;
    if (!tid) {
      document.getElementById('sec-empty-state').style.display = 'block';
      document.getElementById('sec-empty-state').textContent = 'Select a tenant to load its security settings.';
      document.getElementById('sec-settings-table').style.display = 'none';
      document.getElementById('sec-summary-bar').style.display = 'none';
      document.getElementById('sec-filter-bar').style.display = 'none';
      return;
    }
    await loadSettings();
  }

  async function loadSettings() {
    if (!currentTenantId) return;
    const empty = document.getElementById('sec-empty-state');
    empty.textContent = 'Loading…';
    empty.style.display = 'block';
    document.getElementById('sec-settings-table').style.display = 'none';

    try {
      const res = await fetch(`/api/security/tenants/${currentTenantId}/settings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentSettings = data.settings || [];
      renderSummary(data.summary);
      document.getElementById('sec-filter-bar').style.display = 'flex';
      renderTable();
    } catch (e) {
      console.error('[Security] load failed', e);
      empty.textContent = `Failed to load: ${e.message}`;
    }
  }

  function renderSummary(sum) {
    const bar = document.getElementById('sec-summary-bar');
    if (!sum) { bar.style.display = 'none'; return; }
    document.getElementById('sec-sum-critical').textContent = sum.critical_total || 0;
    document.getElementById('sec-sum-drift').textContent = sum.critical_drift || 0;
    document.getElementById('sec-sum-monitored').textContent = sum.monitored_total || 0;
    // #26 — repurposed tile: now the actionable "off recommended — review" count.
    document.getElementById('sec-sum-not-applied').textContent = sum.off_recommended_total || 0;
    document.getElementById('sec-sum-errors').textContent = sum.poll_error_total || 0;
    document.getElementById('sec-sum-unavailable').textContent = sum.unavailable_total || 0;
    bar.style.display = 'flex';
  }

  function renderTable() {
    const tbody = document.getElementById('sec-settings-tbody');
    const empty = document.getElementById('sec-empty-state');
    tbody.innerHTML = '';

    const rows = currentSettings.filter(s =>
      (filters.category === 'all' || s.category === filters.category) &&
      (filters.priority === 'all' || s.priority === filters.priority)
    );
    if (rows.length === 0) {
      empty.textContent = window.t('security_page.no_settings_match');
      empty.style.display = 'block';
      document.getElementById('sec-settings-table').style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    document.getElementById('sec-settings-table').style.display = 'table';

    rows.forEach(s => tbody.appendChild(buildRow(s)));
  }

  function buildRow(s) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openDetailModal(s._internal_id));

    // LED cell
    const ledTd = document.createElement('td');
    const led = document.createElement('span');
    led.className = `sec-led sec-led-${ledColourFor(s.status)}`;
    led.title = tooltipFor(s);
    ledTd.appendChild(led);
    tr.appendChild(ledTd);

    // Name — slug-keyed by setting_id, fall back to canonical English from
    // the registry so a setting added without a translation entry still
    // displays cleanly. Same pattern applies to security_impact / user_impact /
    // admin_notes in renderDetailModal().
    const nameTd = document.createElement('td');
    nameTd.textContent = window.PanopticaI18n.tOrFallback(
      'security_settings.' + s._internal_id + '.name', s.name);
    nameTd.style.fontWeight = '500';
    tr.appendChild(nameTd);

    // Category — chip filter labels (security_page.cat_*) double as cell labels.
    const catTd = document.createElement('td');
    catTd.textContent = window.PanopticaI18n.tOrFallback(
      'security_page.cat_' + s.category, capitalise(s.category));
    catTd.style.color = 'var(--p-text-muted)';
    tr.appendChild(catTd);

    // Priority — chip filter labels (security_page.pri_*) double as pill labels.
    const prioTd = document.createElement('td');
    const prio = document.createElement('span');
    prio.className = `sec-pill sec-pill-priority sec-prio-${s.priority}`;
    prio.textContent = window.PanopticaI18n.tOrFallback(
      'security_page.pri_' + s.priority, capitalise(s.priority));
    prioTd.appendChild(prio);
    tr.appendChild(prioTd);

    // Current value
    const valTd = document.createElement('td');
    const interpretedText = renderInterpreted(s.current_value_interpreted);
    valTd.textContent = interpretedText;
    valTd.style.color = (interpretedText && interpretedText !== '—') ? 'inherit' : 'var(--p-text-muted)';
    tr.appendChild(valTd);

    // Last checked
    const checkedTd = document.createElement('td');
    checkedTd.textContent = s.last_checked_at ? formatWhen(s.last_checked_at) : window.t('security_page.never');
    checkedTd.style.color = 'var(--p-text-muted)';
    checkedTd.style.fontSize = '0.85rem';
    tr.appendChild(checkedTd);

    return tr;
  }

  function ledColourFor(status) {
    switch (status) {
      case 'monitored':       return 'green';
      case 'drift':           return 'red';
      case 'off_recommended': return 'orange';  // #26 — review flag, off-recommended
      case 'pending':         return 'blue';
      case 'poll_error':      return 'amber';
      case 'unavailable':     return 'lock';
      case 'not_configured':  // #26 — no readable value, nothing to monitor
      case 'not_applied':
      case 'not_polled':
      default:                return 'grey';
    }
  }

  function tooltipFor(s) {
    if (s.status === 'poll_error') {
      return window.t('security_page.tooltip_poll_error', {
        message: s.last_check_error || window.t('security_page.tooltip_unknown'),
      });
    }
    if (s.status === 'unavailable') return window.t('security_page.tooltip_unavailable');
    if (s.status === 'off_recommended') return window.t('security_page.tooltip_off_recommended');
    if (s.status === 'not_configured') return window.t('security_page.tooltip_not_configured');
    if (s.last_checked_at) {
      return window.t('security_page.tooltip_last_checked', { when: formatWhen(s.last_checked_at) });
    }
    return window.t('security_page.tooltip_not_polled');
  }

  function capitalise(str) {
    return String(str || '').charAt(0).toUpperCase() + String(str || '').slice(1);
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso.replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return iso;
      // Locale-aware date formatting. Falls back to en-CA if the i18n module
      // isn't loaded (defensive — i18n.js loads before this page module).
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
      return d.toLocaleString(dateLocale);
    } catch { return iso; }
  }

  // Async Refresh: POST returns 202 immediately, then we poll the status
  // endpoint every 5s until the background job completes. Avoids the 60s
  // Nginx proxy timeout that synchronous polling was hitting.
  async function onRefreshClick() {
    if (!currentTenantId) return;
    const btn = document.getElementById('sec-refresh-btn');
    const status = document.getElementById('sec-refresh-status');
    btn.disabled = true;
    status.textContent = 'Starting refresh…';

    try {
      const res = await fetch(`/api/security/tenants/${currentTenantId}/refresh`, { method: 'POST' });
      // 202 = freshly started, 409 = already in flight (someone else hit
      // Refresh in another tab, or a previous click is still running).
      // Either way we attach to the in-flight job and poll for completion.
      if (res.status === 202 || res.status === 409) {
        const data = await res.json().catch(() => ({}));
        refreshPollStartedAt = data.startedAt || new Date().toISOString();
        const banner = window.t(res.status === 409
          ? 'security_page.refresh_in_progress'
          : 'security_page.refresh_polling_tenant');
        status.textContent = `${banner} ${window.t('security_page.refresh_takes_minutes')}`;
        startRefreshStatusPolling();
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      status.textContent = window.t('security_page.refresh_failed_format', { message: e.message });
      btn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 8000);
    }
  }

  // Poll /refresh-status every 5 seconds until completion. Update the
  // status text with elapsed time so the operator has feedback that
  // something is actually happening.
  function startRefreshStatusPolling() {
    clearRefreshPolling();
    refreshPollInterval = setInterval(async () => {
      if (!currentTenantId) {
        clearRefreshPolling();
        return;
      }
      try {
        const res = await fetch(`/api/security/tenants/${currentTenantId}/refresh-status`);
        if (!res.ok) {
          // Transient — don't kill the loop on a single failed status fetch.
          console.warn('[Security] refresh-status returned', res.status);
          return;
        }
        const data = await res.json();
        if (!data.inFlight && data.hasRun) {
          // Done.
          clearRefreshPolling();
          const btn = document.getElementById('sec-refresh-btn');
          const status = document.getElementById('sec-refresh-status');
          btn.disabled = false;
          if (data.error) {
            status.textContent = window.t('security_page.refresh_failed_format', { message: data.error });
          } else {
            status.textContent = window.t('security_page.refresh_done_format', {
              pollsRun: data.pollsRun || 0,
              errors: data.errors || 0,
              unavailable: data.unavailable || 0
            });
          }
          await loadSettings();
          setTimeout(() => { status.textContent = ''; }, 8000);
        } else if (data.inFlight) {
          // Update elapsed time so the operator sees progress.
          const elapsedSec = Math.round(
            (Date.now() - new Date(data.startedAt || refreshPollStartedAt).getTime()) / 1000
          );
          document.getElementById('sec-refresh-status').textContent =
            window.t('security_page.refresh_polling_with_elapsed', { seconds: elapsedSec });
        }
      } catch (e) {
        console.warn('[Security] refresh-status poll error', e);
      }
    }, 5000);
  }

  function clearRefreshPolling() {
    if (refreshPollInterval) {
      clearInterval(refreshPollInterval);
      refreshPollInterval = null;
    }
    refreshPollStartedAt = null;
  }

  async function openDetailModal(settingId) {
    if (!currentTenantId || !settingId) return;
    try {
      const res = await fetch(`/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(settingId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderDetailModal(data);
      document.getElementById('sec-detail-overlay').style.display = 'flex';
    } catch (e) {
      console.error('[Security] detail load failed', e);
      Panoptica.showToast(`Failed to load setting detail: ${e.message}`, 'error');
    }
  }

  function renderDetailModal(data) {
    openDetail = data;
    const s = data.setting;
    const st = data.state;
    // Title + category + priority — slug-keyed by setting_id with registry fallback.
    document.getElementById('sec-detail-title').textContent = window.PanopticaI18n.tOrFallback(
      'security_settings.' + s._internal_id + '.name', s.name);
    document.getElementById('sec-detail-category').textContent = window.PanopticaI18n.tOrFallback(
      'security_page.cat_' + s.category, capitalise(s.category));
    const prio = document.getElementById('sec-detail-priority');
    prio.textContent = window.PanopticaI18n.tOrFallback(
      'security_page.pri_' + s.priority, capitalise(s.priority));
    prio.className = `sec-pill sec-pill-priority sec-prio-${s.priority}`;

    const licencePill = document.getElementById('sec-detail-licence');
    if (s.licence_required) {
      licencePill.textContent = window.t('security_page.requires_label', { licence: s.licence_required });
      licencePill.style.display = 'inline-block';
    } else {
      licencePill.style.display = 'none';
    }

    // State box
    const led = document.getElementById('sec-detail-led');
    led.className = `sec-led sec-led-${ledColourFor(st.status)}`;
    document.getElementById('sec-detail-status').textContent = statusLabel(st.status);
    document.getElementById('sec-detail-current').textContent = window.t('security_page.current_value_format', {
      value: renderInterpreted(st.current_value_interpreted),
    });
    document.getElementById('sec-detail-last-checked').textContent =
      st.last_checked_at ? window.t('security_page.last_checked_format', { when: formatWhen(st.last_checked_at) })
                         : (st.last_check_error
                            ? window.t('security_page.last_check_error_format', { message: st.last_check_error })
                            : window.t('security_page.not_yet_polled'));

    // Body paragraphs — slug-keyed registry fallback. If a setting has a key
    // in en.json/fr.json under security_settings.<id>.security_impact (etc.)
    // we use it; otherwise the canonical English from the registry shows.
    document.getElementById('sec-detail-security-impact').textContent = window.PanopticaI18n.tOrFallback(
      'security_settings.' + s._internal_id + '.security_impact', s.security_impact);
    document.getElementById('sec-detail-user-impact').textContent = window.PanopticaI18n.tOrFallback(
      'security_settings.' + s._internal_id + '.user_impact', s.user_impact);
    document.getElementById('sec-detail-admin-notes').textContent = window.PanopticaI18n.tOrFallback(
      'security_settings.' + s._internal_id + '.admin_notes', s.admin_notes);

    // Phase B — tab availability
    const cfgTab = document.getElementById('sec-tab-configure');
    const remTab = document.getElementById('sec-tab-remediate');
    // Apr 27 — Configure tab is enabled if writer has options (standard) OR
    // is audit_only (CMP-02 DLP — Match-only flow). Otherwise disabled.
    const hasOptions = !!(s.writer && s.writer.options && s.writer.options.length);
    const isAuditOnly = !!(s.writer && s.writer.audit_only);
    const hasWriter = hasOptions || isAuditOnly;
    cfgTab.disabled = !hasWriter;
    cfgTab.title = hasWriter
      ? window.t(isAuditOnly ? 'security_page.tab_configure_audit_title' : 'security_page.tab_configure_normal_title')
      : window.t('security_page.tab_configure_disabled_title');

    // Remediate tab shows on drift, OR when the EXO-06 preset has never been
    // initialized (no baseline drift yet, but we still need to surface the
    // one-time turn-on guidance there).
    const neverInit = !!(st.current_value && st.current_value.never_initialized);
    // Jun 22, 2026 — EXO-06 post-licence-upgrade state (ATP/MDO half not
    // provisioned). Like never_initialized, it needs the guided turn-on surfaced
    // in Remediate even though Restore/Accept/Apply can't resolve it.
    const mdoHalf = !!(st.current_value && st.current_value.mdo_half_uninitialized);
    // #26 — the Remediate tab also hosts the Accept action for off_recommended
    // (ORANGE), so make it available there too. It is NOT auto-opened for orange
    // (orange is a calm review flag, not urgent) — only drift/preset states jump.
    if (st.status === 'drift' || st.status === 'off_recommended' || neverInit || mdoHalf) {
      remTab.style.display = '';
    } else {
      remTab.style.display = 'none';
    }

    // Default tab — start on Overview every open. If status=drift or the preset
    // needs first-time setup (or its MDO half after a licence upgrade), jump to
    // Remediate so the operator's eye lands on what needs attention. off_recommended
    // does NOT auto-jump — the orange dot + Overview label are signal enough.
    switchTab((st.status === 'drift' || neverInit || mdoHalf) ? 'remediate' : 'overview');

    // Pre-render the Configure tab even if not selected, so switching is instant.
    renderConfigureTab();
    renderRemediateTab();
  }

  // ─── Tab switching ────────────────────────────────────────
  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('#sec-tabs .sec-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    const map = {
      overview: 'sec-panel-overview',
      configure: 'sec-panel-configure',
      history: 'sec-panel-history',
      remediate: 'sec-panel-remediate',
    };
    Object.entries(map).forEach(([tab, panelId]) => {
      const el = document.getElementById(panelId);
      if (el) el.style.display = tab === name ? '' : 'none';
    });
    if (name === 'history') loadHistoryTab();
  }

  // ─── Configure tab ────────────────────────────────────────
  function renderConfigureTab() {
    const setting = openDetail?.setting;
    const state = openDetail?.state;
    const writer = setting?.writer;
    const noWriterEl = document.getElementById('sec-cfg-no-writer');
    const auditEl = document.getElementById('sec-cfg-audit-only');
    const formEl = document.getElementById('sec-cfg-form');
    const status = document.getElementById('sec-cfg-status');
    status.textContent = '';
    document.getElementById('sec-cfg-confirm').style.display = 'none';
    document.getElementById('sec-cfg-actions').style.display = '';

    // Apr 27 — three render paths:
    //   1. audit_only writer (CMP-02 DLP) → audit panel with bold warning + Match button
    //   2. standard writer (options[]) → form path below
    //   3. no writer / no options → "No write surface" notice
    const isAuditOnly = !!(writer && writer.audit_only);
    if (isAuditOnly) {
      noWriterEl.style.display = 'none';
      formEl.style.display = 'none';
      auditEl.style.display = '';
      renderAuditOnlyPanel(setting, state);
      return;
    }
    auditEl.style.display = 'none';

    if (!writer || !Array.isArray(writer.options) || writer.options.length === 0) {
      noWriterEl.style.display = '';
      formEl.style.display = 'none';
      return;
    }
    noWriterEl.style.display = 'none';
    formEl.style.display = '';

    // Apr 28, 2026 — show or hide the delegated-auth banner based on writer
    // strategy. Hidden for everything except delegated_teams.
    const delegatedWrapper = document.getElementById('sec-cfg-delegated-auth-wrapper');
    if (writer.strategy === 'delegated_teams') {
      delegatedWrapper.style.display = '';
      // Refresh status from server (cheap; reads session). Banner shows
      // "checking..." while in flight, then resolves to signed-in or signed-out.
      refreshDelegatedAuthBanner();
    } else {
      delegatedWrapper.style.display = 'none';
    }

    // Writer recommendation paragraph — slug-keyed by setting_id with registry
    // English fallback. Same pattern as the three Overview paragraphs.
    document.getElementById('sec-cfg-recommended').textContent = writer.recommended_label
      ? window.PanopticaI18n.tOrFallback(
          'security_settings.' + setting._internal_id + '.writer_recommended_label',
          writer.recommended_label)
      : '';

    // Default selection: prefer current_matches_option (if any), else the recommended.
    // Per-method settings (ENT-01 SSPR): the radio is a PRESET shortcut, not the
    // baseline itself — the checklist below carries the real per-method state. So
    // we only highlight a preset when the live config exactly equals it; on a
    // drifted tenant (the common case) none is highlighted and the checklist shows
    // reality. Leaving it null avoids implying "Standard" when, say, SMS is off.
    const recommended = writer.options.find(o => o.recommended);
    const perMethod = !!(writer.secondary_section && writer.secondary_section.per_method);
    const defaultValue = state?.current_matches_option != null
      ? state.current_matches_option
      : (perMethod ? null : (recommended ? recommended.value : writer.options[0].value));
    configureSelectedValue = defaultValue;

    // Render the option list (works for select_one, toggle, and multi_toggle UI types).
    // Equality on option values uses JSON.stringify because option values
    // can be primitives (string GUID, boolean) OR arrays/objects (ENT-07 is
    // an array of policy IDs). Strict === would falsely fail to mark selected.
    const inputContainer = document.getElementById('sec-cfg-input');
    inputContainer.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'sec-opt-list';
    const selectedJson = JSON.stringify(configureSelectedValue);
    writer.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sec-opt';
      if (JSON.stringify(opt.value) === selectedJson) btn.classList.add('selected');
      btn.dataset.value = JSON.stringify(opt.value);

      const radio = document.createElement('span');
      radio.className = 'sec-opt-radio';
      btn.appendChild(radio);

      const label = document.createElement('span');
      label.className = 'sec-opt-label';
      // Option label — slug-keyed under writer_options.<slug>. Slug is derived
      // from the canonical English label so en.json/fr.json keys stay readable
      // (e.g. "all_mailtips_enabled_threshold_25_recommended"). Registry English
      // is the fallback so a freshly added option still displays cleanly.
      const optKey = 'security_settings.' + setting._internal_id +
                     '.writer_options.' + window.PanopticaI18n.slugify(opt.label);
      label.textContent = window.PanopticaI18n.tOrFallback(optKey, opt.label);
      btn.appendChild(label);

      if (opt.recommended) {
        const tag = document.createElement('span');
        tag.className = 'sec-opt-tag recommended';
        tag.textContent = window.t('security_page.option_pill_recommended');
        btn.appendChild(tag);
      } else if (opt.danger) {
        const tag = document.createElement('span');
        tag.className = 'sec-opt-tag danger';
        tag.textContent = window.t('security_page.option_pill_danger');
        btn.appendChild(tag);
      }

      btn.addEventListener('click', () => {
        configureSelectedValue = opt.value;
        list.querySelectorAll('.sec-opt').forEach(o => o.classList.remove('selected'));
        btn.classList.add('selected');
        textInputUserEdited = false;  // reset; new option may pre-populate fresh
        renderTextInputForOption(opt);
        // Per-method (ENT-01 SSPR): the radio is a PRESET that mutates the
        // method checklist. "Standard" checks the recommended trio (without
        // disturbing any advanced methods already chosen); "Disabled" clears
        // everything. The checklist remains the source of truth for Apply.
        if (perMethod) {
          applyPerMethodPreset(opt.value);
          renderSecondarySection();
        }
        updateApplyMatchButtons();
      });

      list.appendChild(btn);
    });
    inputContainer.appendChild(list);

    // Render text input for the initially selected option (if it has input)
    const initialOptDef = writer.options.find(o => JSON.stringify(o.value) === selectedJson);
    textInputUserEdited = false;
    renderTextInputForOption(initialOptDef);

    // Track whether user has typed in the text input (controls re-population)
    const textInput = document.getElementById('sec-cfg-text-input');
    if (textInput) {
      textInput.oninput = () => { textInputUserEdited = true; };
    }

    // Render the secondary section (additional auth methods checklist for ENT-01)
    renderSecondarySection();

    updateApplyMatchButtons();
  }

  // ─── Secondary section (expandable checklist) ────────────
  // Used by ENT-01 to expose advanced auth methods beyond the SSPR baseline.
  // Master checkbox toggles visibility; per-method checkboxes inside.
  // Pre-populates from writer.secondary_section.current_additionals on first
  // open, preserves operator edits on re-renders.
  let secondaryUserEdited = false;
  let secondarySelected = new Set();

  // Core SSPR trio for the per-method radio preset (ENT-01). Mirrors SSPR_TRIO
  // in src/lib/security-settings/registry.js — keep in sync. This is a UI
  // convenience only; the authoritative baseline is the full method set sent
  // to /apply by packageChosenForApply().
  const SSPR_PRESET_TRIO = ['MicrosoftAuthenticator', 'Sms', 'Email'];
  function applyPerMethodPreset(presetValue) {
    secondaryUserEdited = true;
    if (presetValue === 'disabled') {
      secondarySelected.clear();
    } else {
      // 'standard' (or any non-disabled preset) → ensure the recommended trio
      // is enabled, without disturbing advanced methods already selected.
      SSPR_PRESET_TRIO.forEach(id => secondarySelected.add(id));
    }
  }

  function renderSecondarySection() {
    const writer = openDetail?.setting?.writer;
    const wrapper = document.getElementById('sec-cfg-secondary-wrapper');
    if (!writer || !writer.secondary_section) {
      wrapper.style.display = 'none';
      return;
    }
    const ss = writer.secondary_section;
    wrapper.style.display = '';
    // Slug-keyed under security_settings.<id>.secondary_section.{toggle_label,help}
    // with the registry English as fallback.
    const settingId = openDetail?.setting?._internal_id;
    const ssBase = 'security_settings.' + settingId + '.secondary_section';
    document.getElementById('sec-cfg-secondary-toggle-label').textContent =
      window.PanopticaI18n.tOrFallback(ssBase + '.toggle_label', ss.toggle_label);
    document.getElementById('sec-cfg-secondary-help').textContent =
      window.PanopticaI18n.tOrFallback(ssBase + '.help', ss.help || '');

    // Build the checklist DOM
    const list = document.getElementById('sec-cfg-secondary-checklist');
    list.innerHTML = '';

    // Initialize selection from current_additionals on first render only.
    // Operator edits to the checkboxes are preserved across re-renders.
    if (!secondaryUserEdited) {
      secondarySelected = new Set(Array.isArray(ss.current_additionals) ? ss.current_additionals : []);
    }

    // always_open (ENT-01 per-method): there's nothing to "expand" — every
    // method matters — so hide the master toggle and keep the list visible.
    // Otherwise the master toggle reflects whether ANY method is selected and
    // gates the list's visibility (legacy advanced-only checklist behaviour).
    const masterToggle = document.getElementById('sec-cfg-secondary-toggle');
    const masterLabel = masterToggle.closest('label');
    if (ss.always_open) {
      if (masterLabel) masterLabel.style.display = 'none';
      list.style.display = '';
    } else {
      if (masterLabel) masterLabel.style.display = '';
      masterToggle.checked = secondarySelected.size > 0;
      list.style.display = masterToggle.checked ? '' : 'none';
    }

    // Render per-method checkboxes. Method labels are keyed under
    // security_settings.<id>.secondary_section.options.<opt.id> (using the
    // stable registry id like 'Fido2', not a slug-of-label) with the registry
    // English as fallback.
    ss.options.forEach(opt => {
      const row = document.createElement('label');
      row.className = 'sec-secondary-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = opt.id;
      cb.checked = secondarySelected.has(opt.id);
      cb.addEventListener('change', () => {
        secondaryUserEdited = true;
        if (cb.checked) secondarySelected.add(opt.id);
        else secondarySelected.delete(opt.id);
        // Per-method: a manual toggle means the set may no longer equal a
        // preset, so drop the radio highlight rather than imply otherwise.
        if (ss.per_method) {
          configureSelectedValue = null;
          document.querySelectorAll('#sec-cfg-input .sec-opt').forEach(o => o.classList.remove('selected'));
          updateApplyMatchButtons();
        }
      });
      const label = document.createElement('span');
      label.className = 'sec-secondary-item-label';
      label.textContent = window.PanopticaI18n.tOrFallback(
        ssBase + '.options.' + opt.id, opt.label
      );
      row.appendChild(cb);
      row.appendChild(label);
      list.appendChild(row);
    });

    // Master toggle handler — show/hide the checklist. Unchecking the
    // master DOES NOT clear individual selections (operator can quickly
    // hide the section without losing their picks).
    masterToggle.onchange = () => {
      secondaryUserEdited = true;
      list.style.display = masterToggle.checked ? '' : 'none';
      // If unchecking the master, also clear all selections — Apply syncs
      // the complete set, so "no additionals desired" must mean "disable
      // every advanced method." Operator preserving picks across hide/show
      // would mislead the diff display in Confirm.
      if (!masterToggle.checked) {
        secondarySelected.clear();
        list.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
      }
    };
  }

  // Decide Apply vs Match button visibility based on whether the SELECTED
  // value already equals the current state.
  function updateApplyMatchButtons() {
    const state = openDetail?.state;
    const applyBtn = document.getElementById('sec-cfg-apply-btn');
    const matchBtn = document.getElementById('sec-cfg-match-btn');

    // If the operator's selection equals current_matches_option AND no
    // applied_value is set yet → show Match (no write needed; just adopt baseline).
    const sameAsCurrent = state && state.current_matches_option != null &&
      JSON.stringify(state.current_matches_option) === JSON.stringify(configureSelectedValue);
    const noBaseline = state && state.applied_value == null;

    if (sameAsCurrent && noBaseline) {
      // Match is the primary CTA, Apply is hidden (writing would be a no-op).
      applyBtn.style.display = 'none';
      matchBtn.style.display = '';
      matchBtn.textContent = window.t('security_page.btn_match_current');
    } else {
      applyBtn.style.display = '';
      // Match-current secondary still useful when current matches an option but
      // operator wants to keep current rather than apply recommended.
      matchBtn.style.display = sameAsCurrent ? '' : 'none';
      matchBtn.textContent = window.t('security_page.btn_match_current_instead');
    }
  }

  // ─── Text input rendering for option-with-input ──────────
  //
  // When the operator selects an option whose registry definition includes
  // an `input` block (TEA-02 partner allowlist, EXO-05 notify recipients,
  // ENT-06 banned words), render a text area below the option list.
  // Pre-populate with the current tenant's value (passed by the API as
  // setting.writer.current_input) the first time the operator picks an
  // option-with-input. Subsequent option switches preserve operator edits
  // unless they switch back to a no-input option.
  let textInputUserEdited = false;

  function renderTextInputForOption(opt) {
    const wrapper = document.getElementById('sec-cfg-text-input-wrapper');
    const helpEl = document.getElementById('sec-cfg-text-input-help');
    const input = document.getElementById('sec-cfg-text-input');
    const validation = document.getElementById('sec-cfg-text-input-validation');

    if (!opt || !opt.input) {
      wrapper.style.display = 'none';
      validation.style.display = 'none';
      input.classList.remove('invalid');
      return;
    }

    wrapper.style.display = '';
    // Input help is keyed under security_settings.<id>.writer_input_help.<value>
    // (using the option's value, e.g. 'global_plus_custom') with the registry
    // English as fallback.
    const settingId = openDetail?.setting?._internal_id;
    const helpKey = 'security_settings.' + settingId + '.writer_input_help.' + String(configureSelectedValue);
    helpEl.textContent = window.PanopticaI18n.tOrFallback(helpKey, opt.input.help || '');
    input.placeholder = opt.input.placeholder || '';
    input.rows = opt.input.multiline ? 6 : 1;

    // Pre-populate from current_input ONLY on first render (or when option
    // switches and user hasn't typed in the new context). If the operator
    // already edited the field, preserve their text.
    const writer = openDetail?.setting?.writer;
    const currentInput = writer?.current_input;
    if (!textInputUserEdited && currentInput != null) {
      input.value = currentInput;
    }

    validation.style.display = 'none';
    input.classList.remove('invalid');
  }

  // Called from Apply path to package up the chosen value with attached
  // operator-typed data. Returns one of:
  //   primitive                                    — option without input or secondary
  //   {option, input}                              — option with text-input attached
  //   {option, additional}                         — option with secondary checklist (ENT-01)
  //   {option, input, additional}                  — both (no current setting uses this, but supported)
  function packageChosenForApply() {
    const writer = openDetail?.setting?.writer;
    // Per-method (ENT-01 SSPR): the baseline IS the explicit set of methods to
    // enable for all users. Send {methods:[…]}; the radio is just a preset and
    // there's no text input. Sorted for canonical, diff-stable JSON.
    if (writer?.secondary_section?.per_method) {
      return { methods: [...secondarySelected].sort() };
    }
    const optDef = (writer?.options || []).find(o =>
      JSON.stringify(o.value) === JSON.stringify(configureSelectedValue)
    );
    const hasInput = !!(optDef && optDef.input);
    const hasSecondary = !!(writer?.secondary_section);

    if (!hasInput && !hasSecondary) {
      return configureSelectedValue;
    }

    const result = { option: configureSelectedValue };
    if (hasInput) {
      const inputEl = document.getElementById('sec-cfg-text-input');
      result.input = inputEl ? inputEl.value : '';
    }
    if (hasSecondary) {
      // Stable order so applied_value JSON is canonical (avoid spurious diffs)
      result.additional = [...secondarySelected].sort();
    }
    return result;
  }

  // Validate the text input contents per option's line_kind. Returns
  // { ok: true } or { ok: false, message }.
  function validateTextInput(opt) {
    const inputEl = document.getElementById('sec-cfg-text-input');
    const text = inputEl ? inputEl.value : '';
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);

    if (!opt.input.empty_ok && lines.length === 0) {
      return { ok: false, message: window.t('security_page.validation_at_least_one') };
    }

    const kind = opt.input.line_kind;
    const validators = {
      email: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
      domain: /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      word: /^[\w\-]{2,64}$/,  // alphanumeric + dash + underscore, 2-64 chars
    };
    const re = validators[kind];
    if (re) {
      const bad = lines.find(l => !re.test(l));
      if (bad) return { ok: false, message: window.t('security_page.validation_invalid', { kind, value: bad }) };
    }

    // May 3, 2026 — per-input length constraints. Microsoft Entra Password
    // Protection requires each banned word to be 4-16 chars (ENT-06). Other
    // settings can specify their own bounds via input.min_length/max_length.
    // Without this, operators only discover the constraint when Microsoft
    // rejects the Apply with a Graph 400.
    const minLen = (typeof opt.input.min_length === 'number') ? opt.input.min_length : null;
    const maxLen = (typeof opt.input.max_length === 'number') ? opt.input.max_length : null;
    if (minLen !== null) {
      const tooShort = lines.find(l => l.length < minLen);
      if (tooShort) return { ok: false, message: window.t('security_page.validation_too_short', { value: tooShort, min: minLen }) };
    }
    if (maxLen !== null) {
      const tooLong = lines.find(l => l.length > maxLen);
      if (tooLong) return { ok: false, message: window.t('security_page.validation_too_long', { value: tooLong, max: maxLen }) };
    }
    return { ok: true };
  }

  // Diff display for the Confirm banner. For multiline lists shows added (+)
  // and removed (-) lines. For single values shows "from X to Y".
  function buildDiffSummary() {
    const writer = openDetail?.setting?.writer;
    const optDef = (writer?.options || []).find(o =>
      JSON.stringify(o.value) === JSON.stringify(configureSelectedValue)
    );
    if (!optDef || !optDef.input) return null;

    const currentText = String(writer?.current_input || '');
    const newText = String(document.getElementById('sec-cfg-text-input')?.value || '');
    const currentLines = currentText.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0).sort();
    const newLines     = newText.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0).sort();

    const added = newLines.filter(l => !currentLines.includes(l));
    const removed = currentLines.filter(l => !newLines.includes(l));

    if (optDef.input.multiline) {
      const parts = [];
      if (added.length) {
        parts.push(`<div class="sec-diff-section"><strong>${escapeHtml(window.t('security_page.diff_will_add'))}</strong></div>`);
        added.forEach(l => parts.push(`<div class="sec-diff-add">+ ${escapeHtml(l)}</div>`));
      }
      if (removed.length) {
        parts.push(`<div class="sec-diff-section"><strong>${escapeHtml(window.t('security_page.diff_will_remove'))}</strong></div>`);
        removed.forEach(l => parts.push(`<div class="sec-diff-remove">- ${escapeHtml(l)}</div>`));
      }
      if (added.length === 0 && removed.length === 0) {
        return `<div class="sec-diff-section" style="color:var(--p-text-muted);">${escapeHtml(window.t('security_page.diff_no_changes'))}</div>`;
      }
      return parts.join('');
    }
    // single-line: from/to
    const emptyLabel = window.t('security_page.diff_empty');
    return `<div class="sec-diff-from-to">${escapeHtml(window.t('security_page.diff_from_to', {
      from: currentText || emptyLabel,
      to: newText || emptyLabel,
    }))}</div>`;
  }

  // Diff display for the secondary-section (additional methods checklist).
  // Shows which methods will be newly enabled and which will be disabled,
  // using the friendly labels rather than raw IDs so the operator can read
  // "FIDO2 Security Keys" not "Fido2". Returns null if no secondary section
  // OR no changes (in which case nothing extra shows in the Confirm banner).
  function buildSecondaryDiffSummary() {
    const writer = openDetail?.setting?.writer;
    const ss = writer?.secondary_section;
    if (!ss) return null;

    const currentEnabled = new Set(Array.isArray(ss.current_additionals) ? ss.current_additionals : []);
    const targetEnabled  = new Set(secondarySelected);

    const willEnable  = [...targetEnabled].filter(id => !currentEnabled.has(id)).sort();
    const willDisable = [...currentEnabled].filter(id => !targetEnabled.has(id)).sort();

    if (willEnable.length === 0 && willDisable.length === 0) return null;

    // Localize method labels via security_settings.<id>.secondary_section.options.<opt.id>
    const settingId = openDetail?.setting?._internal_id;
    const ssBase = 'security_settings.' + settingId + '.secondary_section';
    const labelFor = (id) => {
      const fallback = (ss.options.find(o => o.id === id) || {}).label || id;
      return window.PanopticaI18n.tOrFallback(ssBase + '.options.' + id, fallback);
    };
    const enableWord  = window.t('security_page.diff_enable');
    const disableWord = window.t('security_page.diff_disable');
    const parts = [`<div class="sec-diff-section" style="margin-top:12px;"><strong>${escapeHtml(window.t('security_page.diff_additional_method_changes'))}</strong></div>`];
    willEnable.forEach(id => {
      parts.push(`<div class="sec-diff-add">+ ${escapeHtml(enableWord)}: ${escapeHtml(labelFor(id))}</div>`);
    });
    willDisable.forEach(id => {
      parts.push(`<div class="sec-diff-remove">− ${escapeHtml(disableWord)}: ${escapeHtml(labelFor(id))}</div>`);
    });
    return parts.join('');
  }

  // ─── Apply / Match / Confirm flow ─────────────────────────
  function onApplyClick() {
    const setting = openDetail?.setting;
    const state = openDetail?.state;
    if (!setting || !setting.writer) return;

    const perMethod = !!(setting.writer.secondary_section && setting.writer.secondary_section.per_method);
    const optDef = setting.writer.options.find(
      o => JSON.stringify(o.value) === JSON.stringify(configureSelectedValue)
    );
    const chosenLabelRaw = optDef?.label || String(configureSelectedValue);
    // Slug-translate the option label (matches the writer_options.<slug> pattern
    // used in the Configure tab so the Confirm banner stays consistent).
    const settingId = setting._internal_id;
    let chosenLabel;
    if (perMethod) {
      // No single "option" — summarize the resulting method count. The precise
      // per-method enable/disable changes are shown by the secondary diff below.
      chosenLabel = window.t('security_page.confirm_new_methods_count', { count: secondarySelected.size });
    } else if (optDef?.label) {
      chosenLabel = window.PanopticaI18n.tOrFallback(
        'security_settings.' + settingId + '.writer_options.' + window.PanopticaI18n.slugify(optDef.label),
        chosenLabelRaw
      );
    } else {
      chosenLabel = chosenLabelRaw;
    }
    // Slug-translate the setting name too (already-keyed under .name).
    const settingName = window.PanopticaI18n.tOrFallback(
      'security_settings.' + settingId + '.name', setting.name
    );

    // Validate text input before showing confirm
    if (optDef?.input) {
      const v = validateTextInput(optDef);
      if (!v.ok) {
        const validationEl = document.getElementById('sec-cfg-text-input-validation');
        validationEl.textContent = v.message;
        validationEl.style.display = '';
        document.getElementById('sec-cfg-text-input').classList.add('invalid');
        document.getElementById('sec-cfg-status').textContent = '';
        return;
      }
    }

    // Build confirmation summary HTML — includes a diff for input-bearing
    // options (text-area lists / single values) AND for secondary-section
    // checklists (additional methods). The latter is critical for safety:
    // operator sees which methods will be DISABLED if they uncheck them,
    // so accidental disables (e.g. unchecking HardwareOath that real users
    // depend on) are caught before the write fires.
    const summaryParts = [
      `<div><strong>${escapeHtml(window.t('security_page.confirm_apply_on', { tenant: openDetail.tenant.display_name }))}</strong> ${escapeHtml(settingName)}</div>`,
      `<div style="margin-top:6px;">${escapeHtml(window.t('security_page.confirm_current'))} ${escapeHtml(renderInterpreted(state.current_value_interpreted))}</div>`,
      `<div style="margin-top:2px;">${escapeHtml(window.t('security_page.confirm_new'))} <strong>${escapeHtml(chosenLabel)}</strong></div>`,
    ];
    if (optDef?.input) {
      const diffHtml = buildDiffSummary();
      if (diffHtml) summaryParts.push(diffHtml);
    }
    const secondaryDiff = buildSecondaryDiffSummary();
    if (secondaryDiff) summaryParts.push(secondaryDiff);

    document.getElementById('sec-cfg-confirm-summary').innerHTML = summaryParts.join('');
    document.getElementById('sec-cfg-actions').style.display = 'none';
    document.getElementById('sec-cfg-confirm').style.display = '';
  }

  function onConfirmCancel() {
    document.getElementById('sec-cfg-confirm').style.display = 'none';
    document.getElementById('sec-cfg-actions').style.display = '';
  }

  // ─── In-flight busy panel ────────────────────────────────
  // Pwsh-backed writes take 5-15 seconds (cold-connect to EXO/Teams +
  // Set-* + verification poll). A tiny status-text update wasn't visible
  // enough — operators read the silence as "broken." This generic helper
  // hides the actions row and shows a centered spinner + elapsed-time
  // counter for the duration of any write operation.
  //
  // Two parallel UIs: 'configure' (Apply/Match) and 'remediate'
  // (Restore/Accept). Same panel structure, different element IDs.
  let busyTickHandle = null;
  let busyStartedAt = null;

  function setBusy(panel, on, opts = {}) {
    const ids = panel === 'configure'
      ? { actions: 'sec-cfg-actions', busy: 'sec-cfg-busy', title: 'sec-cfg-busy-title', elapsed: 'sec-cfg-busy-elapsed' }
      : { actions: 'sec-rem-actions', busy: 'sec-rem-busy', title: 'sec-rem-busy-title', elapsed: 'sec-rem-busy-elapsed' };
    const actionsEl = document.getElementById(ids.actions);
    const busyEl    = document.getElementById(ids.busy);
    const titleEl   = document.getElementById(ids.title);
    const elapsedEl = document.getElementById(ids.elapsed);

    if (busyTickHandle) { clearInterval(busyTickHandle); busyTickHandle = null; }

    if (on) {
      // May 6 2026 — clear any leftover progress text from a prior busy
      // session. Without this, switching from EXO-09 Apply (which emits
      // "10 / 10 mailboxes — Updating AuditOwner action lists" markers) to
      // a different setting's Match leaks the EXO-09 progress text into
      // the new busy panel, even when the new operation has no per-item
      // progress at all. Reset on every busy-on transition so each flow
      // starts clean. Only the configure panel currently has a progress
      // div; remediate doesn't, but a defensive null check covers it.
      const cfgProgressEl = document.getElementById('sec-cfg-busy-progress');
      if (cfgProgressEl) { cfgProgressEl.textContent = ''; cfgProgressEl.style.display = 'none'; }

      if (titleEl && opts.title) titleEl.textContent = opts.title;
      if (actionsEl) actionsEl.style.display = 'none';
      if (busyEl) busyEl.style.display = '';
      busyStartedAt = Date.now();
      if (elapsedEl) elapsedEl.textContent = window.t('security_page.elapsed_zero');
      // Tick every second so the operator sees something is happening.
      busyTickHandle = setInterval(() => {
        if (!elapsedEl) return;
        const sec = Math.floor((Date.now() - busyStartedAt) / 1000);
        elapsedEl.textContent = window.t('security_page.elapsed_format', { seconds: sec });
      }, 1000);
    } else {
      if (busyEl) busyEl.style.display = 'none';
      if (actionsEl) actionsEl.style.display = '';
      busyStartedAt = null;
    }
  }

  // May 6, 2026 — pwsh strategies route through the async /apply-async
  // endpoint because their PowerShell can take 60-90s on big tenants and
  // would otherwise blow past HTTP gateway timeouts. Graph + delegated_teams
  // stay on the existing sync /apply endpoint (graph is fast; delegated_teams
  // requires the operator's req.session which the async worker can't access).
  function isAsyncEligibleStrategy(strategy) {
    return strategy === 'powershell_exo'
        || strategy === 'powershell_ipps'
        || strategy === 'powershell_teams'
        || strategy === 'powershell_spo';
  }

  async function onConfirmYes() {
    const setting = openDetail?.setting;
    if (!setting) return;
    const status = document.getElementById('sec-cfg-status');
    // Hide the confirm panel; setBusy hides actions + shows the spinner panel.
    document.getElementById('sec-cfg-confirm').style.display = 'none';
    setBusy('configure', true, { title: window.t('security_page.applying_setting') });
    status.textContent = '';
    // Reset the progress row — async path will populate; sync path leaves hidden.
    const progressEl = document.getElementById('sec-cfg-busy-progress');
    if (progressEl) { progressEl.style.display = 'none'; progressEl.textContent = ''; }

    const useAsync = isAsyncEligibleStrategy(setting.writer && setting.writer.strategy);
    if (useAsync) {
      return runAsyncApply(setting, status);
    }

    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // packageChosenForApply returns either a primitive (option without input)
          // or {option, input} (option with operator-typed text). Same /apply
          // endpoint handles both — server-side writers detect via runtime check.
          body: JSON.stringify({ value: packageChosenForApply() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      // Apr 28, 2026 — delegated_teams writers return 401 with auth_url when
      // the operator hasn't signed in (or token expired). Open the sign-in
      // popup and queue this same Apply for retry once auth completes.
      // May 3, 2026 — circuit breaker: if Apply returns 401 IMMEDIATELY after
      // a successful sign-in, the issue is downstream (per-tenant token
      // acquisition or Microsoft policy), not missing auth. Re-prompting the
      // operator would loop forever. Show the actual error instead.
      if (res.status === 401 && data.code === 'DELEGATED_AUTH_REQUIRED') {
        const justAuthenticatedMs = window.__panopticaTeamsDelegatedAuthAtMs || 0;
        const elapsedSinceAuth = Date.now() - justAuthenticatedMs;
        if (justAuthenticatedMs > 0 && elapsedSinceAuth < 60000) {
          // Less than a minute since successful sign-in — Apply still 401s.
          // Don't loop. Surface the underlying error.
          setBusy('configure', false);
          status.innerHTML = `<strong>Apply failed despite valid sign-in.</strong> ` +
            `Microsoft rejected the per-tenant token acquisition. ` +
            `<br>Detail: ${escapeHtml(data.detail || 'Unknown error')}` +
            `<br><br>Most likely causes: (a) Microsoft Teams admin REST API doesn't honor GDAP-elevated delegated tokens for write operations on customer tenants, (b) scope format issue. Check pm2 logs for the AADSTS code.`;
          // Reset auth-just-happened so a real future re-auth still works.
          window.__panopticaTeamsDelegatedAuthAtMs = 0;
          return;
        }
        setBusy('configure', false);
        status.textContent = 'Sign in to push Teams settings — opening popup…';
        // Stash the retry: when the popup completes successfully, we'll
        // re-invoke onConfirmYes (which will retry the Apply, now with
        // valid session tokens).
        pendingDelegatedApply = { fn: () => onConfirmYes() };
        openDelegatedAuthPopup(data.auth_url || '/auth/teams-delegated/login');
        return;
      }
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      // Refresh the modal + the list view BEFORE clearing busy so the new
      // state is visible the moment the spinner hides.
      await refreshOpenDetail(setting._internal_id);
      await loadSettings();
      setBusy('configure', false);
      // Friendlier wording: the immediate verification poll often catches
      // Microsoft mid-propagation. Don't say "value mismatch" — that reads
      // as an error to most operators. The status will resolve to monitored
      // automatically once Microsoft propagates (next slow-tier poll).
      if (data.verification === 'confirmed') {
        status.textContent = 'Applied and verified.';
      } else if (data.verification && data.verification.startsWith('pending')) {
        status.textContent = 'Applied — Microsoft is still propagating the change. Status will go green automatically within a few minutes.';
      } else {
        status.textContent = `Applied — ${data.verification || 'verification pending'}`;
      }
    } catch (e) {
      setBusy('configure', false);
      status.textContent = `Apply failed: ${e.message}`;
    } finally {
      document.getElementById('sec-cfg-confirm-yes').disabled = false;
      document.getElementById('sec-cfg-confirm-cancel').disabled = false;
    }
  }

  // ─── Async Apply runner (May 6, 2026) ───────────────────────────────
  //
  // For pwsh-strategy settings, we POST to /apply-async (returns 202 + jobId
  // immediately), then poll /jobs/:jid every 2s until terminal status. The
  // existing busy-panel elapsed counter keeps ticking in parallel; we add
  // a progress line ("X of Y mailboxes processed") under it when the worker
  // emits per-item progress markers.
  let activePollHandle = null;

  function stopActivePoll() {
    if (activePollHandle) {
      clearInterval(activePollHandle);
      activePollHandle = null;
    }
  }

  function inferItemLabel(setting) {
    // Best-effort label for the X/Y count. Most pwsh writers iterate
    // mailboxes; future settings could iterate users/policies. Hardcode
    // mailboxes for now and revisit when the second class of setting ships.
    return window.t('security_page.item_label_mailboxes');
  }

  function renderProgressLine(progress, setting) {
    const progressEl = document.getElementById('sec-cfg-busy-progress');
    if (!progressEl) return;
    const c = progress?.current || 0;
    const t = progress?.total || 0;
    if (t > 0) {
      const itemLabel = inferItemLabel(setting);
      progressEl.textContent = `${c} / ${t} ${itemLabel}` + (progress.message ? ` — ${progress.message}` : '');
      progressEl.style.display = '';
    } else if (progress?.message) {
      progressEl.textContent = progress.message;
      progressEl.style.display = '';
    } else {
      progressEl.style.display = 'none';
    }
  }

  async function runAsyncApply(setting, status) {
    let jobId = null;
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/apply-async`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: packageChosenForApply() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === 'ALREADY_QUEUED') {
        // A previous Apply is still in flight. Resume polling that job
        // instead of trying to enqueue a duplicate.
        jobId = data.existingJobId;
        status.textContent = window.t('security_page.apply_status_already_running', { elapsed: 0 });
      } else if (res.status === 202 && data.jobId) {
        jobId = data.jobId;
      } else {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setBusy('configure', false);
      status.textContent = `Apply failed: ${e.message}`;
      document.getElementById('sec-cfg-confirm-yes').disabled = false;
      document.getElementById('sec-cfg-confirm-cancel').disabled = false;
      return;
    }

    // Polling loop. Bounded by the 30-min server-side cap; if the page is
    // closed, the worker continues — we resume polling on next page open
    // via the active-job lookup at modal-open time.
    stopActivePoll();
    let pollFailures = 0;
    activePollHandle = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/security/tenants/${currentTenantId}/jobs/${jobId}`,
          { headers: { 'Accept': 'application/json' } }
        );
        if (!r.ok) {
          pollFailures += 1;
          if (pollFailures > 5) {
            stopActivePoll();
            setBusy('configure', false);
            status.textContent = `Apply status unavailable (HTTP ${r.status}). Job ${jobId} may still be running on the server — refresh in a moment to see final state.`;
          }
          return;
        }
        pollFailures = 0;
        const job = await r.json();
        renderProgressLine(job.progress, setting);

        if (job.status === 'queued') {
          // Worker hasn't picked it up yet (rare; <2s typically). Show a
          // "queued" indicator so operator knows we're waiting on the worker.
          const elapsedEl = document.getElementById('sec-cfg-busy-elapsed');
          if (elapsedEl && (job.elapsedSeconds || 0) === 0) {
            elapsedEl.textContent = window.t('security_page.apply_status_queued');
          }
          return;
        }

        if (job.status === 'running') {
          // Progress UI is already updated by renderProgressLine + setBusy's
          // ticking elapsed counter. Nothing else to do — keep polling.
          return;
        }

        // Terminal state — stop polling and show result.
        stopActivePoll();
        if (job.status === 'completed') {
          await refreshOpenDetail(setting._internal_id);
          await loadSettings();
          setBusy('configure', false);
          // Best-effort parse of the output to detect propagation lag.
          const isPending = String(job.output || '').includes('status=pending');
          status.textContent = isPending
            ? window.t('security_page.apply_status_completed_pending')
            : window.t('security_page.apply_status_completed_monitored');
        } else if (job.status === 'timeout') {
          setBusy('configure', false);
          status.textContent = window.t('security_page.apply_status_timeout');
        } else { // failed, canceled
          setBusy('configure', false);
          status.textContent = window.t('security_page.apply_status_failed', { error: job.error || 'unknown' });
        }
        document.getElementById('sec-cfg-confirm-yes').disabled = false;
        document.getElementById('sec-cfg-confirm-cancel').disabled = false;
      } catch (e) {
        pollFailures += 1;
        if (pollFailures > 5) {
          stopActivePoll();
          setBusy('configure', false);
          status.textContent = `Apply status check failed: ${e.message}`;
        }
      }
    }, 2000);
  }

  // ─── Delegated-auth banner (Teams writers — TEA-01, TEA-02) ─────────
  //
  // Renders state-dependent UI in #sec-cfg-delegated-auth-wrapper based on
  // whether the operator has a valid Teams admin session token. Three states:
  //   - loading  → "Checking auth…"
  //   - signed in → green check + account name + "Sign out" + token expiry
  //   - signed out → amber warning + "Sign in to push Teams settings" button

  async function refreshDelegatedAuthBanner() {
    renderDelegatedAuthBanner({ loading: true });
    try {
      const res = await fetch('/auth/teams-delegated/status');
      const data = await res.json();
      delegatedAuthState = data;
      renderDelegatedAuthBanner({ data });
    } catch (e) {
      renderDelegatedAuthBanner({ error: e.message });
    }
  }

  function renderDelegatedAuthBanner({ loading, data, error }) {
    const wrapper = document.getElementById('sec-cfg-delegated-auth-wrapper');
    const icon = document.getElementById('sec-cfg-delegated-auth-icon');
    const title = document.getElementById('sec-cfg-delegated-auth-title');
    const detail = document.getElementById('sec-cfg-delegated-auth-detail');
    const signinBtn = document.getElementById('sec-cfg-delegated-auth-signin');
    const signoutBtn = document.getElementById('sec-cfg-delegated-auth-signout');
    if (!wrapper) return;

    if (loading) {
      wrapper.style.borderColor = 'var(--p-border)';
      wrapper.style.background = 'transparent';
      icon.textContent = '…';
      title.textContent = window.t('security_page.delegated_auth_checking');
      detail.textContent = '';
      signinBtn.style.display = 'none';
      signoutBtn.style.display = 'none';
      return;
    }
    if (error || !data) {
      wrapper.style.borderColor = '#ef4444';
      wrapper.style.background = 'rgba(239, 68, 68, 0.06)';
      icon.textContent = '✗';
      title.textContent = window.t('security_page.delegated_auth_failed_title');
      detail.textContent = error || window.t('security_page.delegated_auth_unknown_error');
      signinBtn.style.display = '';
      signoutBtn.style.display = 'none';
      return;
    }
    if (data.authenticated) {
      wrapper.style.borderColor = '#22c55e';
      wrapper.style.background = 'rgba(34, 197, 94, 0.06)';
      icon.textContent = '✓';
      const acct = data.account || {};
      const userLabel = acct.username || acct.name || window.t('security_page.delegated_auth_default_admin_label');
      title.textContent = window.t('security_page.delegated_auth_signed_in_title', { user: userLabel });
      // Locale-aware date format. fr-CA / es / en-CA all preserve YYYY-MM-DD;
      // toLocaleDateString defaults are fine here.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
      if (data.refreshTokenExpiresAtMs) {
        const dateStr = new Date(data.refreshTokenExpiresAtMs).toLocaleDateString(dateLocale);
        detail.textContent = window.t('security_page.delegated_auth_signed_in_detail_with_expiry', { date: dateStr });
      } else {
        detail.textContent = window.t('security_page.delegated_auth_signed_in_detail_no_expiry');
      }
      signinBtn.style.display = 'none';
      signoutBtn.style.display = '';
    } else {
      wrapper.style.borderColor = 'var(--p-warm, #f59e0b)';
      wrapper.style.background = 'rgba(245, 158, 11, 0.06)';
      icon.textContent = '!';
      title.textContent = window.t('security_page.delegated_auth_required_title');
      detail.textContent = window.t('security_page.delegated_auth_required_detail');
      signinBtn.style.display = '';
      signoutBtn.style.display = 'none';
    }
  }

  function openDelegatedAuthPopup(url) {
    const w = 600, h = 720;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    const popup = window.open(
      url,
      'panoptica-teams-delegated-auth',
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,location=yes,status=no,menubar=no,scrollbars=yes,resizable=yes`
    );
    if (!popup) {
      // Popup blocked — fall back to inline navigation.
      Panoptica.showToast(window.t('security_page.delegated_auth_popup_blocked', { url }), 'warning');
    }
    // The popup posts back via postMessage when complete. Listener registered
    // in init().
  }

  function onDelegatedSignInClick() {
    openDelegatedAuthPopup('/auth/teams-delegated/login');
  }

  async function onDelegatedSignOutClick() {
    if (!(await Panoptica.confirmModal(window.t('security_page.delegated_auth_signout_confirm')))) return;
    try {
      await fetch('/auth/teams-delegated/logout', { method: 'POST' });
    } catch { /* swallow */ }
    refreshDelegatedAuthBanner();
  }

  async function onMatchClick() {
    const setting = openDetail?.setting;
    if (!setting) return;
    const status = document.getElementById('sec-cfg-status');
    setBusy('configure', true, { title: window.t('security_page.matching_current_value') });
    status.textContent = '';
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/match`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      await refreshOpenDetail(setting._internal_id);
      await loadSettings();
      setBusy('configure', false);
      status.textContent = 'Matched — current value is now the baseline. Drift detection is active.';
    } catch (e) {
      setBusy('configure', false);
      status.textContent = `Match failed: ${e.message}`;
    }
  }

  // ─── Audit-only panel (CMP-02 DLP) ─────────────────────────
  // Renders the bold warning banner + empty-state note + Match button.
  // Empty-state heuristic uses current_value.total_policies (DLP reader field).
  // For future audit-only settings, this could be generalized, but for now CMP-02
  // is the only one and total_policies is the right signal.
  function renderAuditOnlyPanel(setting, state) {
    const writer = setting.writer;
    // Slug-keyed under security_settings.<id>.{warning_banner,empty_state_note}
    // with the registry English as fallback.
    const baseKey = 'security_settings.' + setting._internal_id;
    const warningTextEl = document.getElementById('sec-cfg-audit-warning-text');
    if (warningTextEl) {
      warningTextEl.textContent = window.PanopticaI18n.tOrFallback(
        baseKey + '.warning_banner', writer.warning_banner || ''
      );
    }

    const emptyNoteEl = document.getElementById('sec-cfg-audit-empty-note');
    const isEmpty = state && state.current_value && state.current_value.total_policies === 0;
    if (emptyNoteEl) {
      if (isEmpty && writer.empty_state_note) {
        emptyNoteEl.textContent = window.PanopticaI18n.tOrFallback(
          baseKey + '.empty_state_note', writer.empty_state_note
        );
        emptyNoteEl.style.display = '';
      } else {
        emptyNoteEl.style.display = 'none';
      }
    }

    // Reset transient state (status text, busy spinner if a previous Match
    // was still mid-flight when the operator switched tabs).
    const auditStatus = document.getElementById('sec-cfg-audit-status');
    if (auditStatus) auditStatus.textContent = '';
    const auditBusy = document.getElementById('sec-cfg-audit-busy');
    const auditActions = document.getElementById('sec-cfg-audit-actions');
    if (auditBusy) auditBusy.style.display = 'none';
    if (auditActions) auditActions.style.display = '';
  }

  async function onAuditMatchClick() {
    const setting = openDetail?.setting;
    if (!setting) return;
    const status = document.getElementById('sec-cfg-audit-status');
    const busyEl = document.getElementById('sec-cfg-audit-busy');
    const elapsedEl = document.getElementById('sec-cfg-audit-busy-elapsed');
    const actionsEl = document.getElementById('sec-cfg-audit-actions');
    if (status) status.textContent = '';
    if (busyEl) busyEl.style.display = '';
    if (actionsEl) actionsEl.style.display = 'none';
    const t0 = Date.now();
    if (elapsedEl) elapsedEl.textContent = window.t('security_page.elapsed_zero');
    const tick = setInterval(() => {
      if (elapsedEl) elapsedEl.textContent = window.t('security_page.elapsed_format', { seconds: Math.floor((Date.now() - t0) / 1000) });
    }, 1000);
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/match`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      await refreshOpenDetail(setting._internal_id);
      await loadSettings();
      clearInterval(tick);
      if (busyEl) busyEl.style.display = 'none';
      if (actionsEl) actionsEl.style.display = '';
      if (status) status.textContent = window.t('security_page.audit_baseline_captured');
    } catch (e) {
      clearInterval(tick);
      if (busyEl) busyEl.style.display = 'none';
      if (actionsEl) actionsEl.style.display = '';
      if (status) status.textContent = `Match failed: ${e.message}`;
    }
  }

  // Set an element's text + data-i18n key together, so the immediate render and
  // any later PanopticaI18n.applyTo() pass agree. Used to swap the guided-panel
  // copy between the "never turned on" and "MDO half missing" states.
  function setGuideText(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('data-i18n', key);
    el.textContent = window.t(key);
  }

  // ─── Remediate tab ────────────────────────────────────────
  function renderRemediateTab() {
    const setting = openDetail?.setting;
    const state = openDetail?.state;
    if (!setting || !state) return;

    // EXO-06 first-time setup: preset never turned on. Panoptica can't create
    // it programmatically, so show the guided walkthrough instead of the normal
    // Restore/Accept buttons (which would be no-ops here).
    const cv = state.current_value || {};
    const neverInit = !!cv.never_initialized;
    // Jun 22, 2026 — MDO half not provisioned after a licence upgrade. Same
    // guided panel as never_initialized (Restore/Accept/Apply all dead-end), but
    // different copy: the preset IS on, only the Defender-for-O365 half is
    // missing. The "Show me how" button opens the same walkthrough — openDetail's
    // mdo_available is true here, so it shows the full MDO (Safe Links / Safe
    // Attachments / impersonation) variant, which is exactly the wizard re-run.
    const mdoHalf = !!cv.mdo_half_uninitialized;
    const showGuide = neverInit || mdoHalf;
    const noinitPanel = document.getElementById('sec-rem-noinit');
    const driftWrap = document.getElementById('sec-rem-drift-wrap');
    if (noinitPanel) noinitPanel.style.display = showGuide ? '' : 'none';
    if (driftWrap) driftWrap.style.display = showGuide ? 'none' : '';
    if (showGuide) {
      setGuideText('sec-rem-noinit-title', mdoHalf ? 'security_page.preset_guide.mdohalf_title' : 'security_page.preset_guide.noinit_title');
      setGuideText('sec-rem-noinit-body',  mdoHalf ? 'security_page.preset_guide.mdohalf_body'  : 'security_page.preset_guide.noinit_body');
      setGuideText('sec-rem-guide-btn',    mdoHalf ? 'security_page.preset_guide.mdohalf_open_btn' : 'security_page.preset_guide.open_btn');
      return;
    }

    // #26 — the Remediate tab now also serves off_recommended (ORANGE). Anything
    // else (monitored/grey/pending) has nothing to remediate.
    const isOff = state.status === 'off_recommended';
    if (state.status !== 'drift' && !isOff) return;

    const writer = setting.writer;
    const isAuditOnly = !!(writer && writer.audit_only);

    // Swap the box from RED (drift) to ORANGE (off_recommended), and the heading
    // + help copy to match. The Accept CTA is shared.
    const box = document.getElementById('sec-rem-drift-box');
    const heading = document.getElementById('sec-rem-drift-heading');
    const help = document.getElementById('sec-rem-help');
    if (box) {
      box.style.border = isOff ? '1px solid #f97316' : '1px solid #ef4444';
      box.style.background = isOff ? 'rgba(249, 115, 22, 0.06)' : 'rgba(239, 68, 68, 0.06)';
    }
    if (heading) heading.textContent = window.t(isOff ? 'security_page.off_recommended_heading' : 'security_page.drift_detected');
    if (help) help.textContent = window.t(isOff ? 'security_page.off_recommended_help' : 'security_page.remediate_help');

    // Restore button: hidden for audit-only (can't write) AND for off_recommended
    // (no baseline to restore to — the only paths are Apply the recommended value
    // via the Configure tab, or Accept the current value here).
    const restoreBtn = document.getElementById('sec-rem-restore-btn');
    if (restoreBtn) restoreBtn.style.display = (isAuditOnly || isOff) ? 'none' : '';

    if (isOff) {
      // ORANGE: show the recommended value vs the current value. The recommended
      // option's label is the human-readable target; current is the interpreted live value.
      const rec = writer && Array.isArray(writer.options) ? writer.options.find(o => o.recommended) : null;
      const recLabel = rec ? rec.label : '—';
      document.getElementById('sec-rem-summary').innerHTML =
        `<div><strong>${escapeHtml(window.t('security_page.recommended_label_short'))}</strong> ${escapeHtml(recLabel)}</div>` +
        `<div><strong>${escapeHtml(window.t('security_page.current_label_short'))}</strong> ${escapeHtml(renderInterpreted(state.current_value_interpreted, JSON.stringify(state.current_value)))}</div>`;
      document.getElementById('sec-rem-status').textContent = '';
      return;
    }

    let appliedLabel;
    if (isAuditOnly) {
      // Audit-only baseline is a snapshot. Render it as a short summary
      // (policy count + named policies). Drift diff is NOT inline yet —
      // operator clicks Accept to adopt new state. Future enhancement: render
      // structured diff (added/removed/modified policies).
      const baseline = state.applied_value;
      const policyCount = baseline?.policies?.length || 0;
      const policyNames = (baseline?.policies || []).map(p => p.name).join(', ') || '(empty)';
      appliedLabel = `${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} captured: ${policyNames}`;
    } else {
      appliedLabel = writer
        ? (writer.options.find(o => JSON.stringify(o.value) === JSON.stringify(state.applied_value))?.label
           || JSON.stringify(state.applied_value))
        : JSON.stringify(state.applied_value);
    }

    document.getElementById('sec-rem-summary').innerHTML =
      `<div><strong>Baseline (applied):</strong> ${escapeHtml(appliedLabel)}</div>` +
      `<div><strong>Current:</strong> ${escapeHtml(renderInterpreted(state.current_value_interpreted, JSON.stringify(state.current_value)))}</div>`;
    document.getElementById('sec-rem-status').textContent = '';
  }

  async function onRemediateRestore() {
    const setting = openDetail?.setting;
    if (!setting) return;
    if (!(await Panoptica.confirmModal(window.t('security_page.confirm_restore')))) return;
    const status = document.getElementById('sec-rem-status');
    setBusy('remediate', true, { title: window.t('security_page.restoring_baseline') });
    status.textContent = '';
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/remediate`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      await refreshOpenDetail(setting._internal_id);
      await loadSettings();
      setBusy('remediate', false);
      status.textContent = 'Restored.';
    } catch (e) {
      setBusy('remediate', false);
      status.textContent = `Restore failed: ${e.message}`;
    }
  }

  async function onRemediateAccept() {
    const setting = openDetail?.setting;
    if (!setting) return;
    if (!(await Panoptica.confirmModal(window.t('security_page.confirm_accept')))) return;
    const status = document.getElementById('sec-rem-status');
    setBusy('remediate', true, { title: window.t('security_page.accepting_drift') });
    status.textContent = '';
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/accept`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      await refreshOpenDetail(setting._internal_id);
      await loadSettings();
      setBusy('remediate', false);
      status.textContent = 'Accepted — new baseline recorded.';
    } catch (e) {
      setBusy('remediate', false);
      status.textContent = `Accept failed: ${e.message}`;
    }
  }

  // ─── EXO-06 preset first-time-setup guide ────────────────
  function openPresetGuide() {
    const overlay = document.getElementById('sec-preset-guide-overlay');
    if (!overlay) return;
    // Pick the walkthrough variant by licence. mdo_available === false means the
    // tenant has no Defender for Office 365 (e.g. Business Standard) → show the
    // shorter EOP-only flow (no Safe Links/Attachments, no impersonation steps).
    // Default to the full MDO variant when the flag is absent.
    const cv = openDetail?.state?.current_value;
    const eopOnly = !!(cv && cv.mdo_available === false);
    const mdoBody = document.getElementById('sec-guide-body-mdo');
    const eopBody = document.getElementById('sec-guide-body-eop');
    if (mdoBody) mdoBody.style.display = eopOnly ? 'none' : '';
    if (eopBody) eopBody.style.display = eopOnly ? '' : 'none';
    // Within the MDO body, swap the lead-in paragraph: the default "never turned
    // on" wording is inaccurate after a licence upgrade (the preset IS on; only
    // the Defender half is missing). The steps themselves are identical.
    const mdoHalf = !!(cv && cv.mdo_half_uninitialized);
    const whyP1 = document.getElementById('sec-guide-why-p1');
    const mdohalfIntro = document.getElementById('sec-guide-mdohalf-intro');
    if (whyP1) whyP1.style.display = mdoHalf ? 'none' : '';
    if (mdohalfIntro) mdohalfIntro.style.display = mdoHalf ? '' : 'none';
    overlay.style.display = 'flex';
  }
  function closePresetGuide() {
    const overlay = document.getElementById('sec-preset-guide-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ─── History tab ──────────────────────────────────────────
  async function loadHistoryTab() {
    const setting = openDetail?.setting;
    if (!setting) return;
    const loading = document.getElementById('sec-hist-loading');
    const table = document.getElementById('sec-hist-table');
    const empty = document.getElementById('sec-hist-empty');
    const tbody = document.getElementById('sec-hist-tbody');
    loading.style.display = '';
    table.style.display = 'none';
    empty.style.display = 'none';
    tbody.innerHTML = '';
    try {
      const res = await fetch(
        `/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(setting._internal_id)}/history`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      loading.style.display = 'none';
      const events = data.events || [];
      if (events.length === 0) { empty.style.display = ''; return; }
      events.forEach(ev => {
        const tr = document.createElement('tr');
        tr.appendChild(td(formatWhen(ev.created_at)));
        const evtTd = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = `sec-hist-event-pill sec-hist-evt-${ev.event_type}`;
        // Localized event label (CSS uppercases via text-transform). Fallback to
        // the raw event_type with underscores stripped so a future event type
        // we haven't keyed yet still renders something readable.
        const evtKey = 'security_page.history_event.' + ev.event_type;
        pill.textContent = window.PanopticaI18n.tOrFallback(evtKey, ev.event_type.replace(/_/g, ' '));
        evtTd.appendChild(pill);
        tr.appendChild(evtTd);
        const actorText = ev.operator_email
          || (ev.source === 'panoptica' ? window.t('security_page.history_actor_system') : '—');
        tr.appendChild(td(actorText));
        tr.appendChild(td(formatChange(ev.previous_value, ev.new_value)));
        tbody.appendChild(tr);
      });
      table.style.display = '';
    } catch (e) {
      loading.textContent = window.t('security_page.history_load_failed', { message: e.message });
    }
  }

  function td(text) {
    const el = document.createElement('td');
    el.textContent = text == null ? '—' : String(text);
    return el;
  }

  function formatChange(prev, next) {
    if (prev == null && next == null) return '—';
    if (prev == null) return `→ ${shortJson(next)}`;
    if (next == null) return `${shortJson(prev)} →`;
    return `${shortJson(prev)} → ${shortJson(next)}`;
  }

  function shortJson(v) {
    if (v == null) return '—';
    if (typeof v === 'object') {
      try {
        const s = JSON.stringify(v);
        return s.length > 60 ? s.slice(0, 57) + '…' : s;
      } catch { return '[unserializable]'; }
    }
    return String(v);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // After an Apply/Match/Remediate/Accept, re-fetch the detail so the modal
  // reflects the new state without a full close/reopen.
  async function refreshOpenDetail(settingId) {
    try {
      const res = await fetch(`/api/security/tenants/${currentTenantId}/settings/${encodeURIComponent(settingId)}`);
      if (!res.ok) return;
      const data = await res.json();
      renderDetailModal(data);
    } catch { /* swallow — list reload below will surface state */ }
  }

  function statusLabel(status) {
    const keyByStatus = {
      monitored:       'security_page.status_monitored',
      drift:           'security_page.status_drift',
      off_recommended: 'security_page.status_off_recommended',  // #26
      not_configured:  'security_page.status_not_configured',   // #26
      pending:         'security_page.status_pending',
      poll_error:      'security_page.status_poll_error',
      unavailable:     'security_page.status_unavailable',
      not_applied:     'security_page.status_not_applied',
      not_polled:      'security_page.status_not_polled',
    };
    return window.t(keyByStatus[status] || 'security_page.status_not_polled');
  }

  function hideDetailModal() {
    document.getElementById('sec-detail-overlay').style.display = 'none';
    // Clear the busy-tick interval if a write was in flight when the modal
    // was closed (e.g. operator hit Close mid-Apply). The fetch itself still
    // resolves on the server; we just stop ticking elapsed-time into a hidden
    // DOM node.
    if (busyTickHandle) { clearInterval(busyTickHandle); busyTickHandle = null; }
    busyStartedAt = null;
    openDetail = null;
    configureSelectedValue = undefined;
    activeTab = 'overview';
    // Reset the secondary-section state so next open re-pre-populates from
    // the freshly-fetched current state (avoids stale operator edits leaking
    // across modal opens for different settings or different tenants).
    secondaryUserEdited = false;
    secondarySelected = new Set();
    textInputUserEdited = false;
  }

  // Shared mountable controller. Loaded once from index.html (after app.js so
  // window.Panoptica exists) and shared by two surfaces: the standalone
  // Security route (via the thin pages/security.js wrapper) and the per-tenant
  // dashboard's Security tab. It deliberately does NOT register
  // window.PanopticaPage — it is a controller, not a route page module.
  window.Panoptica = window.Panoptica || {};
  window.Panoptica.SecurityPanel = { mount, unmount };
})();
