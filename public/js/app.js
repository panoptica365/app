/**
 * Panoptica — SPA Engine
 * Handles AJAX navigation, page lifecycle, toasts, modals, and global state.
 */

(function () {
  'use strict';

  // ─── State ───
  let currentPage = null;
  let currentModule = null;  // Reference to active page module (for destroy())
  let i18n = {};
  let userInfo = null;
  // v0.1.7 — current app version + release date from /auth/status; drives
  // the sidebar badge, the "unread release notes" dot, and the one-time
  // update toast (which only fires once per session — guarded below).
  let appVersion = null;
  let appReleasedAt = null;
  let whatsNewToastShown = false;

  // ─── Page Registry ───
  // Each page module is loaded dynamically and expected to export: init(), destroy()
  const pages = {
    'main-console':     { partial: '/partials/main-console',     script: '/js/pages/main-console.js' },
    'daily-activity':   { partial: '/partials/daily-activity',   script: '/js/pages/daily-activity.js' },
    'tenants':          { partial: '/partials/tenants',           script: '/js/pages/tenants.js' },
    'heatmap':          { partial: '/partials/heatmap',           script: '/js/pages/heatmap.js' },
    'alerts':           { partial: '/partials/alerts',            script: '/js/pages/alerts.js' },
    'settings':         { partial: '/partials/settings',          script: '/js/pages/settings.js' },
    'tenant-dashboard': { partial: '/partials/tenant-dashboard',  script: '/js/pages/tenant-dashboard.js' },
    'reports':          { partial: '/partials/reports',           script: '/js/pages/reports.js' },
    'sharepoint':       { partial: '/partials/sharepoint',         script: '/js/pages/sharepoint.js' },
    'learn':            { partial: '/partials/learn',              script: '/js/pages/learn.js' },
    'alert-policies':   { partial: '/partials/alert-policies',   script: '/js/pages/alert-policies.js' },
    'ca-templates':     { partial: '/partials/ca-templates',     script: '/js/pages/ca-templates.js' },
    'intune-templates': { partial: '/partials/intune-templates', script: '/js/pages/intune-templates.js' },
    'security':         { partial: '/partials/security',         script: '/js/pages/security.js' },
    'exemptions':       { partial: '/partials/exemptions',       script: '/js/pages/exemptions.js' },
    // Admin-only. Server-side requireAdmin gates both the /partials/audit-log
    // route and the /api/msp-audit/* endpoints. The sidebar nav item is also
    // hidden for non-admins via applyRoleVisibility() — see init() below. That
    // hide is cosmetic; the real security boundary is the server gates.
    'audit-log':        { partial: '/partials/audit-log',         script: '/js/pages/audit-log.js' },
  };

  // ─── Navigation ───

  async function navigateTo(pageName, params = {}) {
    const pageConfig = pages[pageName];
    if (!pageConfig) {
      console.error(`[SPA] Unknown page: ${pageName}`);
      return;
    }

    // Destroy current page module if it has a destroy()
    if (currentModule && typeof currentModule.destroy === 'function') {
      try { currentModule.destroy(); } catch (e) { console.error('[SPA] Destroy error:', e); }
    }
    currentModule = null;

    // Update active nav item
    document.querySelectorAll('#sidebar-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageName);
    });

    // Show loading
    const content = document.getElementById('content-area');
    const loadingText = window.t ? window.t('common.loading') : 'Loading...';
    content.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div>' + loadingText + '</div>';
    currentPage = pageName;

    try {
      // Fetch HTML partial.
      //
      // cache: 'no-store' forces the browser to always hit the server rather
      // than serving a stale cached partial. Hard-refresh on index.html doesn't
      // cascade to subsequent AJAX fetches, so without this flag edits to
      // partial HTML can appear to "do nothing" after deploy — even though
      // the file on disk is current. Symptom: deploy ships, hard-refresh
      // loads index.html fresh, but the SPA then serves a cached partial.
      const res = await fetch(pageConfig.partial + buildQueryString(params), {
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.href = '/auth/login';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      content.innerHTML = html;
      // Translate any data-i18n / data-i18n-attr-* attributes in the just-
      // injected partial. Defensive null check in case i18n.js failed to
      // load — partials still render with their hardcoded English fallback.
      if (window.PanopticaI18n) window.PanopticaI18n.applyTo(content);
      refreshIcons();

      // Load and init page script
      const module = await loadPageScript(pageConfig.script);
      if (module && typeof module.init === 'function') {
        currentModule = module;
        await module.init(params);
        // Re-walk after page init in case the page module rendered more DOM
        // with data-i18n attributes (e.g., dynamically built tables, modals).
        if (window.PanopticaI18n) window.PanopticaI18n.applyTo(content);
        refreshIcons();  // Page init may have rendered more DOM with data-lucide
      }
    } catch (err) {
      console.error(`[SPA] Navigation to ${pageName} failed:`, err);
      const failMsg = window.t ? window.t('common.page_load_failed') : 'Failed to load page. Please try again.';
      content.innerHTML = '<div class="panel-error">' + failMsg + '</div>';
    }
  }

  async function loadPageScript(src) {
    // Remove previous page script if any
    const existing = document.getElementById('page-script');
    if (existing) existing.remove();

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'page-script';
      script.src = src + '?v=' + Date.now(); // Cache-bust during dev
      script.onload = () => {
        // Page scripts register via window.PanopticaPage
        resolve(window.PanopticaPage || null);
        window.PanopticaPage = null;
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  function buildQueryString(params) {
    const entries = Object.entries(params).filter(([, v]) => v != null);
    if (entries.length === 0) return '';
    return '?' + new URLSearchParams(entries).toString();
  }

  // ─── Navigate to a specific tenant dashboard ───
  function openTenantDashboard(tenantId, tenantName) {
    navigateTo('tenant-dashboard', { id: tenantId });
  }

  // ─── Toasts ───

  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── Modal ───

  // ─── In-App Self-Update (Stage 5 / C2) ───────────────────────────────
  // Banner (all roles) + admin-only modal with a live progress view that
  // tolerates the app restarting underneath it. The update-status file written
  // by the panoptica-updater sidecar is the source of truth; the app process
  // is replaced mid-update, so we poll with a raw fetch and keep retrying
  // through the connection-refused window.
  let appUpdateStatus = null;
  let updateBannerDismissed = false;
  let updatePollTimer = null;
  let updateStartedByUser = false;
  let activeUpdateRequestId = null;

  function ut(key, params) {
    return (window.t && window.t('update.' + key, params)) || key;
  }

  function currentUiLang() {
    return (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
  }

  function renderUpdateBanner() {
    const el = document.getElementById('update-banner');
    if (!el) return;
    const u = appUpdateStatus;
    if (!u || !u.update_available || updateBannerDismissed) {
      el.style.display = 'none';
      return;
    }
    const isAdmin = userInfo && userInfo.role === 'admin';
    const version = u.latest_version || '';
    const msgKey = u.mandatory ? 'banner_mandatory' : 'banner_available';
    const textEl = document.getElementById('update-banner-text');
    if (textEl) textEl.textContent = ut(msgKey, { version });
    const actionBtn = document.getElementById('update-banner-action');
    if (actionBtn) {
      actionBtn.textContent = ut('banner_action');
      actionBtn.style.display = isAdmin ? '' : 'none';
    }
    el.setAttribute('data-mandatory', u.mandatory ? 'true' : 'false');
    el.style.display = '';
  }

  function escForCopy(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
  }

  // Build the "confirm" view inside the modal body.
  function updateConfirmHtml(check) {
    const lang = currentUiLang();
    const notes = check.notes_summary && (check.notes_summary[lang] || check.notes_summary.en);
    const rows = [];
    rows.push(`<div class="update-modal-row"><span class="update-modal-label">${escHtml(ut('current_version'))}</span><span class="update-modal-value">${escHtml(check.running_version || appVersion || '')}</span></div>`);
    rows.push(`<div class="update-modal-row"><span class="update-modal-label">${escHtml(ut('target_version'))}</span><span class="update-modal-value">${escHtml(check.latest_version || '')}</span></div>`);
    if (check.released_at) {
      rows.push(`<div class="update-modal-row"><span class="update-modal-label">${escHtml(ut('released_label'))}</span><span class="update-modal-value">${escHtml(check.released_at)}</span></div>`);
    }
    let html = `<div class="update-modal-rows">${rows.join('')}</div>`;
    if (notes) html += `<p class="update-modal-notes">${escHtml(notes)}</p>`;
    html += `<p class="update-modal-intro">${escHtml(ut('confirm_intro', { version: check.latest_version || '' }))}</p>`;
    if (check.mandatory) html += `<p class="update-modal-mandatory">${escHtml(ut('mandatory_note'))}</p>`;
    if (check.below_min_supported) html += `<p class="update-modal-mandatory">${escHtml(ut('min_supported_note'))}</p>`;
    return html;
  }

  function updateProgressHtml() {
    return `
      <div class="update-progress" id="update-progress">
        <div class="update-progress-spinner" aria-hidden="true"></div>
        <p class="update-progress-phase" id="update-progress-phase">${escHtml(ut('phase_queued'))}</p>
        <p class="update-progress-detail" id="update-progress-detail"></p>
      </div>`;
  }

  const PHASE_KEYS = {
    queued: 'phase_queued',
    snapshotting: 'phase_snapshotting',
    pulling: 'phase_pulling',
    restarting: 'phase_restarting',
    health_check: 'phase_health_check',
  };

  async function rawUpdateStatus() {
    // Raw fetch (not api()) so a 401/connection-refused during the restart
    // window does not redirect us to /auth/login — we just retry.
    try {
      const res = await fetch('/api/update/status', { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null; // app is mid-restart — keep polling
    }
  }

  function setProgress(phaseKey, detail) {
    const p = document.getElementById('update-progress-phase');
    const d = document.getElementById('update-progress-detail');
    if (p) p.textContent = ut(phaseKey);
    if (d) d.textContent = detail || '';
  }

  function stopUpdatePolling() {
    if (updatePollTimer) { clearInterval(updatePollTimer); updatePollTimer = null; }
  }

  function showUpdateResult(result, status) {
    stopUpdatePolling();
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');
    if (!body) return;
    if (result === 'success') {
      body.innerHTML = `<p class="update-modal-intro">${escHtml(ut('result_success'))}</p>`;
      // The browser was just talking to the NEW container; reload so the SPA
      // and the What's New modal reflect the new version.
      setTimeout(() => window.location.reload(), 1500);
      return;
    }
    let msg;
    if (result === 'rolled_back') {
      msg = ut('result_rolled_back', { version: status && status.to_version, previous: (status && status.from_version) || appVersion });
    } else {
      msg = ut('result_failed');
    }
    body.innerHTML = `<p class="update-modal-result update-modal-result-bad">${escHtml(msg)}</p>`;
    if (footer) {
      footer.innerHTML = `<button class="btn-secondary" id="update-copy-details" type="button">${escHtml(ut('copy_details'))}</button><button class="btn-primary" id="update-close-btn" type="button">${escHtml(ut('close'))}</button>`;
      const copyBtn = document.getElementById('update-copy-details');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        const details = escForCopy(status || {});
        if (navigator.clipboard) navigator.clipboard.writeText(details).catch(() => {});
        copyBtn.textContent = ut('copied');
      });
      const closeBtn = document.getElementById('update-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', () => { closeModal(); refreshUpdateState(); });
    }
  }

  function pollUpdateProgress() {
    stopUpdatePolling();
    updatePollTimer = setInterval(async () => {
      const s = await rawUpdateStatus();
      if (!s) { setProgress('phase_reconnecting'); return; }
      const prog = s.progress;
      if (!prog) { setProgress('phase_reconnecting'); return; }
      // Ignore a status file left over from a PREVIOUS run. Until the updater
      // picks up OUR request and overwrites the file, prog.request_id still
      // belongs to the prior attempt — acting on its terminal result here
      // produced a false "update failed" while the real update succeeded
      // underneath (P365-Test 2026-06-01). Treat a mismatch as "not started
      // yet" and keep polling.
      if (activeUpdateRequestId && prog.request_id && prog.request_id !== activeUpdateRequestId) {
        setProgress('phase_queued');
        return;
      }
      const result = prog.result || prog.phase;
      if (result === 'success' || result === 'rolled_back' || result === 'failed') {
        showUpdateResult(result, prog);
        return;
      }
      const key = PHASE_KEYS[prog.phase] || 'phase_reconnecting';
      setProgress(key, prog.message || '');
    }, 3000);
  }

  function enterProgressView() {
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');
    if (body) body.innerHTML = updateProgressHtml();
    if (footer) footer.innerHTML = '';
    pollUpdateProgress();
  }

  async function triggerUpdate() {
    try {
      const res = await fetch('/api/update/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const errKey = data.error === 'update_in_progress' ? 'error_in_progress'
          : data.error === 'no_update_available' ? 'error_no_update'
          : 'trigger_failed';
        if (typeof showToast === 'function') showToast(ut(errKey), 'error');
        return;
      }
      updateStartedByUser = true;
      activeUpdateRequestId = data.request_id || null;
      enterProgressView();
    } catch (e) {
      if (typeof showToast === 'function') showToast(ut('trigger_failed'), 'error');
    }
  }

  async function openUpdateModal() {
    openModal(ut('modal_title'), `<div style="text-align:center; padding:24px 0; color:var(--p-text-muted);">${escHtml(ut('checking'))}</div>`, '');
    let data = null;
    try { data = await api('/api/update/status'); } catch (e) { data = null; }

    // If an update is already running (e.g. another admin started it), jump
    // straight into the progress view.
    if (data && data.in_progress) {
      // Adopt the in-flight run's id so the poll guard tracks IT (not a stale
      // prior status, and without blocking on an id mismatch).
      activeUpdateRequestId = (data.progress && data.progress.request_id) || null;
      enterProgressView();
      return;
    }

    const check = (data && data.check) || appUpdateStatus || {};
    if (!check.update_available) {
      const body = `<p class="update-modal-intro">${escHtml(ut('up_to_date', { version: check.running_version || appVersion || '' }))}</p>`;
      const footer = `<button class="btn-secondary" id="update-check-again" type="button">${escHtml(ut('check_again'))}</button>`;
      openModal(ut('modal_title'), body, footer);
      const again = document.getElementById('update-check-again');
      if (again) again.addEventListener('click', async () => {
        again.textContent = ut('checking');
        again.setAttribute('disabled', 'disabled');
        try { await api('/api/update/check', { method: 'POST' }); } catch (e) {}
        await refreshUpdateState();
        openUpdateModal();
      });
      return;
    }

    const footer = `<button class="btn-secondary" id="update-cancel" type="button">${escHtml(ut('cancel'))}</button><button class="btn-primary" id="update-confirm" type="button">${escHtml(ut('update_now'))}</button>`;
    openModal(ut('modal_title'), updateConfirmHtml(check), footer);
    const cancel = document.getElementById('update-cancel');
    if (cancel) cancel.addEventListener('click', closeModal);
    const confirm = document.getElementById('update-confirm');
    if (confirm) confirm.addEventListener('click', () => {
      confirm.setAttribute('disabled', 'disabled');
      triggerUpdate();
    });
  }

  // Re-pull the cached check result and re-render the banner (used after a
  // manual re-check or after a terminal update result).
  async function refreshUpdateState() {
    try {
      const data = await api('/api/update/status');
      if (data && data.check) {
        appUpdateStatus = data.check;
        renderUpdateBanner();
      }
    } catch (e) { /* non-event */ }
  }

  function openModal(title, bodyHtml, footerHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml || '';
    document.getElementById('modal-overlay').classList.add('active');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // ─── Header dropdown menu + What's New (v0.1.7) ───────────────────────

  function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Numeric compare of dotted version strings. Positive ⇒ a > b. Treats
  // missing components as 0. Robust to "0.1.7" vs "0.1.7-dev" (only the
  // leading numeric segments matter).
  function compareVersions(a, b) {
    const parse = v => String(v || '').split('.').map(p => parseInt(p, 10) || 0);
    const pa = parse(a), pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0, db = pb[i] || 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  // Called from initUserPrefs's loadUserPrefs().then() once the user's
  // last_seen_version is known. Lights up the unread dot (on the pill +
  // the menu item) and fires the one-time update toast.
  function updateWhatsNewIndicators(prefs) {
    const last = prefs && prefs.user ? (prefs.user.last_seen_version || null) : null;
    // Treat NULL last_seen_version (first-ever login) as "seen everything"
    // — we don't want to nag new operators on their first session.
    const unread = !!appVersion && !!last && compareVersions(appVersion, last) > 0;
    const dot = document.getElementById('header-user-dot');
    const menuDot = document.getElementById('header-menu-dot');
    if (dot) dot.style.display = unread ? '' : 'none';
    if (menuDot) menuDot.style.display = unread ? '' : 'none';
    if (unread && !whatsNewToastShown) {
      whatsNewToastShown = true;
      showUpdateToast();
    }
  }

  // Clickable "you've been updated" toast — distinct from the generic
  // showToast so the whole toast is a clickable shortcut to the modal.
  function showUpdateToast() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast info';
    toast.style.cursor = 'pointer';
    const msg = (window.t && window.t('whats_new.toast_message', { version: appVersion })) || `Panoptica365 has been updated to v${appVersion}`;
    const action = (window.t && window.t('whats_new.toast_action')) || 'See what’s new';
    toast.innerHTML = `${escHtml(msg)} &nbsp; <strong style="text-decoration:underline;">${escHtml(action)} →</strong>`;
    toast.addEventListener('click', () => {
      try { openWhatsNewModal(); } catch (e) { /* ignore */ }
      toast.remove();
    });
    container.appendChild(toast);
    // Auto-dismiss after 8s — slightly longer than the standard 4s because
    // there's a call-to-action the user needs time to notice.
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 8000);
  }

  // WHATS-NEW.md is hard-wrapped at ~78 columns in the source (so the file
  // stays readable in an editor). The shared mdToHtml converts EVERY '\n'
  // to a <br>, which renders those soft wraps as visible line breaks
  // mid-sentence. Standard markdown collapses single newlines within a
  // paragraph to a space; only blank lines mark paragraph breaks. This
  // helper applies that scoped to the What's New flow — without touching
  // mdToHtml, which other features (chat, AI analysis) rely on as-is.
  function unwrapSoftLineBreaks(md) {
    if (!md) return '';
    return md
      .split(/\n{2,}/) // split on blank-line paragraph breaks
      .map(block => {
        const first = block.replace(/^\s+/, '');
        // Preserve internal newlines for any block-level markdown so list
        // items, headings, blockquotes, code fences, and horizontal rules
        // stay structured. Plain paragraphs get their soft wraps collapsed.
        if (/^(#{1,6}\s|[-*+]\s|>\s|```|---|\d+\.\s)/.test(first)) {
          return block;
        }
        return block.replace(/\s*\n\s*/g, ' ').trim();
      })
      .join('\n\n');
  }

  async function openWhatsNewModal() {
    const modalTitle = (window.t && window.t('whats_new.modal_title')) || 'What’s New in Panoptica365';
    const loadingTxt = (window.t && window.t('whats_new.loading')) || 'Loading…';
    openModal(modalTitle, `<div style="color:var(--p-text-muted); text-align:center; padding:30px 0;">${escHtml(loadingTxt)}</div>`, '');
    try {
      // Pass the active UI language so we get the localized WHATS-NEW.<lang>.md
      // from the server. Unknown / missing locales fall back to English on the
      // backend, so this is always safe to send.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
      const data = await api('/api/meta/whats-new?lang=' + encodeURIComponent(lang));
      const markdown = unwrapSoftLineBreaks(data.markdown || '');
      // Split the markdown into [intro, latest release, earlier releases].
      // Each release section starts with a localized "Version" header — in
      // English/French that word is "Version", in Spanish it's "Versión". We
      // accept either so a translated file splits cleanly into latest vs
      // earlier the same way the English one does.
      const sectionRe = /^## Versi(?:on|ón) /m;
      const firstIdx = markdown.search(sectionRe);
      let releases = firstIdx >= 0 ? markdown.slice(firstIdx) : markdown;
      let latest = releases;
      let earlier = '';
      // Find the SECOND release header to split latest vs earlier.
      const nextRe = /\n## Versi(?:on|ón) /;
      const m2 = releases.match(nextRe);
      const secondIdx = m2 ? m2.index : -1;
      if (secondIdx > 0) {
        latest = releases.slice(0, secondIdx).replace(/\n+---\s*$/g, '').trimEnd();
        earlier = releases.slice(secondIdx + 1); // strip leading newline
      }

      const releasedLabel = (window.t && window.t('whats_new.released')) || 'Released';
      const earlierLabel = (window.t && window.t('whats_new.earlier_releases')) || 'Earlier releases';

      const headerHtml = `
        <div class="whats-new-meta">
          <span class="wn-version">v${escHtml(data.version || appVersion || '')}</span>
          ${data.releasedAt ? `<span class="wn-released">${escHtml(releasedLabel)}: ${escHtml(data.releasedAt)}</span>` : ''}
        </div>`;
      const latestHtml = `<div class="whats-new-body">${mdToHtml(latest)}</div>`;
      const earlierHtml = earlier
        ? `<details class="whats-new-history">
             <summary>${escHtml(earlierLabel)}</summary>
             <div class="whats-new-body">${mdToHtml(earlier)}</div>
           </details>`
        : '';
      document.getElementById('modal-body').innerHTML = headerHtml + latestHtml + earlierHtml;

      // Mark this version as seen for the current operator — clears the
      // unread dot + ensures the toast won't fire on next login.
      if (data.version) {
        api('/api/user-prefs/whats-new-seen', {
          method: 'POST',
          body: JSON.stringify({ version: data.version }),
        }).catch(() => { /* non-fatal */ });
        const dot = document.getElementById('header-user-dot');
        const menuDot = document.getElementById('header-menu-dot');
        if (dot) dot.style.display = 'none';
        if (menuDot) menuDot.style.display = 'none';
      }
    } catch (err) {
      const failTxt = (window.t && window.t('whats_new.load_failed')) || 'Could not load release notes.';
      document.getElementById('modal-body').innerHTML = `<div style="color:var(--p-text-muted);">${escHtml(failTxt)}</div>`;
    }
  }

  function initHeaderMenu() {
    const trigger = document.getElementById('header-user-block');
    const menu = document.getElementById('header-menu');
    if (!trigger || !menu) return;

    function openMenu() {
      menu.classList.add('active');
      trigger.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
    }
    function closeMenu() {
      menu.classList.remove('active');
      trigger.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    }
    function toggleMenu() {
      if (menu.classList.contains('active')) closeMenu(); else openMenu();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
    });
    // Click anywhere outside the menu closes it.
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('active')) return;
      if (trigger.contains(e.target) || menu.contains(e.target)) return;
      closeMenu();
    });
    // ESC closes.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('active')) closeMenu();
    });

    const prefsBtn = document.getElementById('header-menu-prefs');
    if (prefsBtn) prefsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      if (window.Panoptica && typeof window.Panoptica.openUserPrefs === 'function') {
        window.Panoptica.openUserPrefs();
      }
    });
    const whatsNewBtn = document.getElementById('header-menu-whats-new');
    if (whatsNewBtn) whatsNewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      openWhatsNewModal();
    });
    const updateBtn = document.getElementById('header-menu-update');
    if (updateBtn) updateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      openUpdateModal();
    });
    const bannerAction = document.getElementById('update-banner-action');
    if (bannerAction) bannerAction.addEventListener('click', openUpdateModal);
    const bannerDismiss = document.getElementById('update-banner-dismiss');
    if (bannerDismiss) bannerDismiss.addEventListener('click', () => {
      updateBannerDismissed = true;
      renderUpdateBanner();
    });
    // Log out is a plain <a href="/auth/logout"> — default navigation; just
    // close the menu so it's not left hanging during the redirect.
    const logoutA = document.getElementById('header-menu-logout');
    if (logoutA) logoutA.addEventListener('click', () => closeMenu());
  }

  // ─── Clock ───

  function updateClock() {
    const el = document.getElementById('header-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  }

  // ─── Header chrome (search / bell / avatar) ───

  // Role-based visibility helper. Two attributes, both rank-driven:
  //
  //   [data-role-required="X"] — HIDE for users below rank X.
  //     Add `.role-hidden` class with display:none !important. Use for
  //     buttons / nav items / panels that should disappear entirely
  //     when the user can't act on them.
  //
  //   [data-role-readonly="X"] — DISABLE (but show) for users below rank X.
  //     Set the `disabled` attribute + `.role-readonly` class for visual
  //     greying. Use for form fields where the user should see the
  //     CURRENT VALUE but can't change it (e.g., alert policy Severity /
  //     Routing dropdowns — viewer needs to know what's configured).
  //
  // Hierarchy: admin > member > viewer (higher can see/edit lower).
  // Non-authenticated users (null role) see nothing role-gated.
  //
  // IMPORTANT — uses a class, NOT inline style, for the hide path. Many
  // elements carry their own `style="display:none"` from JS state (e.g.,
  // digest-refresh shows up only after first generation). Setting
  // `el.style.display = ''` to un-hide for a permitted role would
  // incorrectly reveal those elements even when their own state-driven
  // hide is still in effect. The class approach OVERLAYS a hide.
  function applyRoleVisibility(userRole) {
    const RANK = { viewer: 1, member: 2, admin: 3 };
    const userRank = RANK[userRole] || 0;
    document.querySelectorAll('[data-role-required]').forEach(el => {
      const required = el.dataset.roleRequired;
      const requiredRank = RANK[required] || 99;
      el.classList.toggle('role-hidden', userRank < requiredRank);
    });
    document.querySelectorAll('[data-role-readonly]').forEach(el => {
      const required = el.dataset.roleReadonly;
      const requiredRank = RANK[required] || 99;
      const shouldDisable = userRank < requiredRank;
      el.classList.toggle('role-readonly', shouldDisable);
      // Form fields honor the `disabled` attribute; non-form elements
      // get only the class hook so callers can style as needed.
      if ('disabled' in el) {
        el.disabled = shouldDisable;
      }
    });
  }

  /*
   * A3 (May 9, 2026) — MutationObserver that re-applies role visibility
   * whenever new `data-role-required` elements appear in the DOM. Page
   * scripts render mutate buttons dynamically (per-row action buttons in
   * CA assignments, Intune deployments, alert rows, exemption rows, etc.)
   * and the static applyRoleVisibility() call at page-load misses them.
   *
   * Instead of requiring every render function to call applyRoleVisibility
   * after innerHTML, this observer watches the content area and runs the
   * helper whenever new subtrees are added. Cheap — the walk is bounded
   * by the number of [data-role-required] elements (~200 in practice).
   *
   * Set up after the role is known. Re-entry guarded so we don't recurse
   * via our own style mutations.
   */
  let roleObserverActive = false;
  function startRoleVisibilityObserver() {
    if (roleObserverActive) return;
    const content = document.getElementById('content') || document.body;
    if (!content || !window.MutationObserver) return;
    let scheduled = false;
    const observer = new MutationObserver(muts => {
      // Only react to subtree additions that contain role-gated nodes
      // (either hide-driven or readonly-driven).
      const meaningful = muts.some(m =>
        m.type === 'childList' && m.addedNodes.length > 0 &&
        Array.from(m.addedNodes).some(n =>
          n.nodeType === 1 &&
          (n.hasAttribute?.('data-role-required') ||
           n.hasAttribute?.('data-role-readonly') ||
           n.querySelector?.('[data-role-required], [data-role-readonly]'))
        )
      );
      if (!meaningful || scheduled) return;
      scheduled = true;
      // rAF so we run after the render settles, not in the middle of it.
      requestAnimationFrame(() => {
        scheduled = false;
        applyRoleVisibility(userInfo?.role);
      });
    });
    observer.observe(content, { childList: true, subtree: true });
    roleObserverActive = true;
  }

  function computeInitials(user) {
    if (!user) return '··';
    const src = (user.name && user.name.trim()) || user.email || '';
    if (!src) return '··';
    // Split on whitespace, punctuation; take first letter of first two tokens.
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    // Fall back to first two letters of the single token (or email local part).
    const localPart = src.split('@')[0];
    return localPart.slice(0, 2).toUpperCase();
  }

  function paintAvatar() {
    const el = document.getElementById('header-avatar-initials');
    const wrap = document.getElementById('header-avatar');
    if (!el || !userInfo) return;
    el.textContent = computeInitials(userInfo);
    if (wrap) wrap.title = userInfo.name || userInfo.email || '';
  }

  /**
   * Paint the role badge next to the user name in the header chrome.
   * Code uses 'member' as the operator role; UI label is "Operator" so MSP
   * customers see the verb they expect when speaking of their staff.
   *
   * Added May 9, 2026 (A3 Step 4 / Step 5 mix).
   */
  function paintRoleBadge(role) {
    const badge = document.getElementById('header-role-badge');
    if (!badge) return;
    if (!role) {
      badge.style.display = 'none';
      return;
    }
    // Locale-aware label. Falls back to the English label if i18n isn't loaded yet.
    const t = (key, fallback) => {
      try { return window.PanopticaI18n?.t(key) || fallback; }
      catch (_) { return fallback; }
    };
    const labelMap = {
      admin:  t('role.admin',    'Admin'),
      member: t('role.operator', 'Operator'),
      viewer: t('role.viewer',   'Viewer'),
    };
    const label = labelMap[role] || role;
    badge.textContent = label;
    badge.className = 'header-role-badge header-role-badge--' + role;
    badge.style.display = '';
  }

  // ─── User preferences modal (Apr 28, 2026) ───
  // DB-backed (users + operator_mute_periods tables). One-time localStorage
  // → DB migration on first load if legacy localStorage prefs exist.
  // Theme-light is wired but inert until A2 ships the light stylesheet.
  // Mute is end-to-end wired: notifier subtracts active-mute emails from
  // recipient lists; failsafe to admins when all are muted.
  const LEGACY_PREFS_KEYS = {
    language: 'panoptica365-prefs-language',
    theme:    'panoptica365-prefs-theme',
  };

  // Cached snapshot of the last GET /api/user-prefs response — drives the
  // header mute indicator and avoids re-fetching on every modal open.
  let userPrefsCache = null;

  // NOTE: window.Panoptica.getActiveMute / openUserPrefs are EXPORTED from
  // inside initUserPrefs(), NOT here at module level. Reason: the IIFE body
  // contains a `window.Panoptica = { ... }` reassignment near the bottom
  // (the main namespace setup) which would wipe any properties attached
  // before that statement runs. initUserPrefs() runs from init() which is
  // invoked AFTER the namespace setup, so attachments there persist.
  // (Bug fix Apr 28, 2026 — chip never appeared because getActiveMute was
  // attached, then nuked, then read as undefined.)

  async function loadUserPrefs() {
    try {
      userPrefsCache = await api('/api/user-prefs');
      // Sync DB-stored theme to localStorage and apply if different from
      // currently-loaded theme. Handles cross-device case: log into a
      // different browser, see your saved theme apply after a brief flash
      // of the localStorage default.
      if (userPrefsCache?.user?.theme && window.PanopticaTheme?.setByPref) {
        try {
          const dbPref = userPrefsCache.user.theme;
          const currentPref = window.PanopticaTheme.currentPref();
          if (dbPref !== currentPref) {
            window.PanopticaTheme.setByPref(dbPref);
            localStorage.setItem('panoptica365-prefs-theme', dbPref);
          }
        } catch (_) {}
      }
      return userPrefsCache;
    } catch (e) {
      console.warn('[UserPrefs] Failed to load:', e.message);
      userPrefsCache = null;
      return null;
    }
  }

  /**
   * One-time migration: if localStorage has legacy values AND the DB has
   * defaults (en/dark), push localStorage values to the DB and clear them.
   * After successful migration the modal is fully DB-backed.
   */
  async function migrateLegacyLocalStoragePrefs(prefs) {
    if (!prefs || !prefs.user) return;
    let legacyLang = null, legacyTheme = null;
    try {
      legacyLang = localStorage.getItem(LEGACY_PREFS_KEYS.language);
      legacyTheme = localStorage.getItem(LEGACY_PREFS_KEYS.theme);
    } catch (_) { return; }
    if (!legacyLang && !legacyTheme) return;

    // Only migrate if the DB row is at defaults — don't overwrite
    // intentional later changes made directly via the API.
    const dbAtDefaults = (prefs.user.language === 'en' && prefs.user.theme === 'dark');
    if (!dbAtDefaults) {
      // Stale localStorage; clear and move on.
      try {
        localStorage.removeItem(LEGACY_PREFS_KEYS.language);
        localStorage.removeItem(LEGACY_PREFS_KEYS.theme);
      } catch (_) {}
      return;
    }

    const language = (legacyLang === 'en' || legacyLang === 'fr' || legacyLang === 'es') ? legacyLang : 'en';
    const theme    = (legacyTheme === 'light' || legacyTheme === 'dark') ? legacyTheme : 'dark';
    if (language === 'en' && theme === 'dark') {
      // Nothing meaningful to migrate.
      try {
        localStorage.removeItem(LEGACY_PREFS_KEYS.language);
        localStorage.removeItem(LEGACY_PREFS_KEYS.theme);
      } catch (_) {}
      return;
    }

    try {
      await api('/api/user-prefs', { method: 'PUT', body: JSON.stringify({ language, theme }) });
      console.log('[UserPrefs] Migrated localStorage → DB:', { language, theme });
      localStorage.removeItem(LEGACY_PREFS_KEYS.language);
      localStorage.removeItem(LEGACY_PREFS_KEYS.theme);
      // Refresh cache to reflect the migrated values.
      await loadUserPrefs();
    } catch (e) {
      console.warn('[UserPrefs] Legacy migration failed (will retry next load):', e.message);
    }
  }

  function fmtMuteWindow(mute) {
    const from = new Date(mute.starts_at);
    const to = new Date(mute.ends_at);
    const opts = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return window.t('user_prefs.mute_window_format', {
      from: from.toLocaleString(undefined, opts),
      to: to.toLocaleString(undefined, opts),
    });
  }

  function renderMuteSection(prefs) {
    const section = document.getElementById('user-prefs-mute-section');
    const checkbox = document.getElementById('user-prefs-mute-checkbox');
    const emailLabel = document.getElementById('user-prefs-mute-email');
    const activeBlock = document.getElementById('user-prefs-mute-active');
    const statusText = document.getElementById('user-prefs-mute-status-text');
    const formBlock = document.getElementById('user-prefs-mute-form');
    const warningBlock = document.getElementById('user-prefs-mute-warning');
    const fromInput = document.getElementById('user-prefs-mute-from');
    const toInput = document.getElementById('user-prefs-mute-to');
    const reasonInput = document.getElementById('user-prefs-mute-reason');
    const hintBlock = document.getElementById('user-prefs-mute-hint');

    if (!section || !checkbox) return;

    const userEmail = prefs?.user?.email;

    // Hide entire mute section if user has no email — muting is meaningless.
    if (!userEmail) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    if (emailLabel) emailLabel.textContent = `(${userEmail})`;

    // Reset visibility
    activeBlock.style.display = 'none';
    formBlock.style.display = 'none';
    warningBlock.style.display = 'none';
    checkbox.checked = false;

    // 60-day cap on the To picker. Bound max attribute client-side; server
    // re-enforces.
    const maxDays = prefs?.mute_max_days || 60;
    const nowIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const maxIso = new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    fromInput.min = nowIso;
    fromInput.max = maxIso;
    toInput.min = nowIso;
    toInput.max = maxIso;

    // Active mute? Show status + cancel.
    if (prefs?.active_mute) {
      checkbox.checked = true;
      checkbox.disabled = true;
      activeBlock.style.display = '';
      statusText.textContent = fmtMuteWindow(prefs.active_mute);
    } else {
      checkbox.disabled = false;
    }

    // Warn if email isn't on any notification list — mute would no-op.
    if (prefs?.email_in_recipient_list === false) {
      warningBlock.style.display = '';
      // Translation contains its own <strong>/<code> markup; safe to inject as
      // innerHTML because en.json is author-controlled. The {email} placeholder
      // is the user's own email — already escaped before we feed it in.
      warningBlock.innerHTML = window.t('user_prefs.mute_warning_html', { email: escapeHtml(userEmail) });
    }

    // Hint text under the form
    if (hintBlock) {
      hintBlock.textContent = window.t('user_prefs.mute_max_hint', { days: maxDays });
    }

    // Wire checkbox toggle (only meaningful if no active mute).
    checkbox.onchange = () => {
      if (prefs?.active_mute) return; // disabled anyway
      formBlock.style.display = checkbox.checked ? '' : 'none';
      // Pre-fill From=now, To=now+7d as a sensible default when first checked.
      if (checkbox.checked && !fromInput.value) {
        const start = new Date();
        const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        fromInput.value = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        toInput.value = new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
    };

    // Wire cancel-mute button
    const cancelBtn = document.getElementById('user-prefs-mute-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = async () => {
        if (!confirm(window.t('user_prefs.confirm_cancel_mute'))) return;
        try {
          await api('/api/user-prefs/mute', { method: 'DELETE' });
          await loadUserPrefs();
          renderMuteSection(userPrefsCache);
          if (typeof refreshHeaderMuteIndicator === 'function') refreshHeaderMuteIndicator();
          showToast(window.t('user_prefs.toast_mute_cancelled'), 'success');
        } catch (e) {
          showToast(window.t('user_prefs.toast_mute_cancel_failed', { message: e.message }), 'error');
        }
      };
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ─── Header mute indicator chip (Step 6 — Apr 28, 2026) ───
  // Shown only when the current operator has an active mute. Click opens
  // the user-prefs modal. Refresh is driven by the existing 60s alert-
  // signals poll plus immediate refresh after Save / Cancel mute actions.
  function initHeaderMuteIndicator() {
    const chip = document.getElementById('header-mute-chip');
    if (!chip) return;
    chip.addEventListener('click', () => {
      window.Panoptica.openUserPrefs();
    });
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.Panoptica.openUserPrefs();
      }
    });
    refreshHeaderMuteIndicator();
    // Re-check on the same cadence as alert signals — cheap (no fetch,
    // reads cached prefs) but ensures expiring mutes flip the chip off.
    setInterval(refreshHeaderMuteIndicator, 60_000);
  }

  function refreshHeaderMuteIndicator() {
    const chip = document.getElementById('header-mute-chip');
    if (!chip) return;
    const mute = window.Panoptica.getActiveMute?.();
    if (!mute) {
      chip.classList.remove('active');
      chip.title = '';
      return;
    }
    // Mute might be expired in cache — double-check end time.
    const endsAt = new Date(mute.ends_at);
    if (endsAt <= new Date()) {
      chip.classList.remove('active');
      chip.title = '';
      // Async refresh of cache so the next check uses fresh data.
      loadUserPrefs();
      return;
    }
    chip.classList.add('active');
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const text = document.getElementById('header-mute-chip-text');
    if (text) text.textContent = window.t('user_prefs.mute_chip_until', { time: endsAt.toLocaleString(undefined, opts) });
    chip.title = window.t('user_prefs.mute_chip_title', { time: endsAt.toLocaleString() });
  }

  function initUserPrefs() {
    const trigger = document.getElementById('header-user-block');
    const overlay = document.getElementById('user-prefs-overlay');
    const closeBtn = document.getElementById('user-prefs-close');
    const saveBtn = document.getElementById('user-prefs-save');
    const langSel = document.getElementById('user-prefs-language');
    if (!trigger || !overlay || !closeBtn || !saveBtn || !langSel) return;

    // Attach helpers to the Panoptica namespace HERE, not at module level.
    // The IIFE body's `window.Panoptica = { ... }` reassignment (near
    // bottom of file) runs before init() and would otherwise wipe any
    // module-level attachments. By attaching here, after init() runs,
    // these survive.
    window.Panoptica = window.Panoptica || {};
    window.Panoptica.getActiveMute = () => userPrefsCache?.active_mute || null;
    // v0.1.7: expose the full open() (which refreshes prefs first), so the
    // header menu's "Preferences" item shows up-to-date state.
    window.Panoptica.openUserPrefs = () => open();

    // Initial load + legacy migration. Done in background so the trigger
    // is responsive even on first ever click. Also drives the v0.1.7
    // What's-New unread indicators once last_seen_version is loaded.
    loadUserPrefs().then(prefs => {
      if (prefs) migrateLegacyLocalStoragePrefs(prefs);
      if (typeof refreshHeaderMuteIndicator === 'function') refreshHeaderMuteIndicator();
      if (typeof updateWhatsNewIndicators === 'function') updateWhatsNewIndicators(prefs);
    });

    async function open() {
      // Refresh on every open so the modal reflects current state (an
      // admin could have removed the operator from the recipient list, or
      // a mute could have expired between opens).
      const prefs = await loadUserPrefs();
      if (!prefs) {
        showToast(window.t('user_prefs.toast_load_failed'), 'error');
        return;
      }
      langSel.value = prefs.user.language || 'en';
      const themeRadio = document.querySelector(`input[name="user-prefs-theme-radio"][value="${prefs.user.theme || 'dark'}"]`);
      if (themeRadio) themeRadio.checked = true;
      renderMuteSection(prefs);
      overlay.classList.add('active');
    }
    function close() { overlay.classList.remove('active'); }

    // v0.1.7: the user-name pill no longer opens Preferences directly —
    // it now opens the header dropdown menu (initHeaderMenu below). The
    // menu's "Preferences" item calls Panoptica.openUserPrefs() to open
    // this overlay via the full open() above.
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    saveBtn.addEventListener('click', async () => {
      const themeChoice = document.querySelector('input[name="user-prefs-theme-radio"]:checked');
      const language = langSel.value;
      const theme = themeChoice ? themeChoice.value : 'dark';

      // Save language + theme via PUT
      try {
        await api('/api/user-prefs', {
          method: 'PUT',
          body: JSON.stringify({ language, theme }),
        });
      } catch (e) {
        showToast(window.t('user_prefs.toast_save_failed', { message: e.message }), 'error');
        return;
      }

      // Apply theme immediately. Both light and dark stylesheets ship as of
      // Apr 28, 2026; PanopticaTheme.setByPref handles the mapping to file
      // names. Also mirror to localStorage for cross-page consistency and
      // avoiding FOUC on next load.
      if (window.PanopticaTheme?.setByPref) {
        try {
          window.PanopticaTheme.setByPref(theme);
          localStorage.setItem('panoptica365-prefs-theme', theme);
        } catch (_) {}
      }

      // Apply locale immediately — same FOUC-avoidance pattern as theme.
      // i18n.js's setLang() re-fetches the locale, swaps the in-memory
      // dictionary, walks the document via applyTo(), and dispatches
      // 'panoptica:locale-changed'. Also mirror to localStorage so the
      // next page load picks the right language on first paint instead
      // of flashing the previous one before /api/user-prefs returns.
      if (window.PanopticaI18n && typeof window.PanopticaI18n.setLang === 'function') {
        try {
          localStorage.setItem('panoptica365-prefs-lang', language);
          if (language !== window.PanopticaI18n.currentLang()) {
            await window.PanopticaI18n.setLang(language);
          }
        } catch (_) {}
      }

      // Handle mute — only POST if checkbox is checked AND no active mute.
      const muteCheckbox = document.getElementById('user-prefs-mute-checkbox');
      const hasActiveMute = !!userPrefsCache?.active_mute;
      if (muteCheckbox && muteCheckbox.checked && !hasActiveMute) {
        const fromVal = document.getElementById('user-prefs-mute-from')?.value;
        const toVal   = document.getElementById('user-prefs-mute-to')?.value;
        const reason  = document.getElementById('user-prefs-mute-reason')?.value || '';
        if (!fromVal || !toVal) {
          showToast(window.t('user_prefs.toast_set_both_times'), 'error');
          return;
        }
        // Convert datetime-local (no timezone) to ISO with local offset.
        const fromIso = new Date(fromVal).toISOString();
        const toIso   = new Date(toVal).toISOString();
        try {
          await api('/api/user-prefs/mute', {
            method: 'POST',
            body: JSON.stringify({ starts_at: fromIso, ends_at: toIso, reason }),
          });
        } catch (e) {
          showToast(window.t('user_prefs.toast_mute_create_failed', { message: e.message }), 'error');
          return;
        }
      }

      await loadUserPrefs();
      if (typeof refreshHeaderMuteIndicator === 'function') refreshHeaderMuteIndicator();
      close();
      showToast(window.t('user_prefs.toast_saved'), 'success');
    });
  }

  function setNavIndicator(pageName, html) {
    const item = document.querySelector(`#sidebar-nav .nav-item[data-page="${pageName}"] .nav-indicator`);
    if (!item) return;
    item.innerHTML = html;
  }

  async function refreshAlertSignals() {
    // One stats fetch feeds the header bell, the Alerts sidebar badge,
    // and the bottom status bar's "Open Alerts" cell.
    const badge = document.getElementById('header-bell-badge');
    const sbOpen = document.getElementById('sb-open-alerts');
    try {
      const stats = await api('/api/alerts/stats?range=open');
      const counts = stats && stats.bySeverity ? stats.bySeverity : {};
      const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
      const critical = (Number(counts.critical) || 0) + (Number(counts.high) || 0);

      // Bell
      if (badge) {
        if (total > 0) {
          badge.textContent = total > 99 ? '99+' : String(total);
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }

      // Sidebar Alerts count — red if any critical/high, amber if only medium/low
      if (total > 0) {
        const cls = critical > 0 ? 'crit' : 'warn';
        setNavIndicator('alerts', `<span class="nav-count ${cls}">${total}</span>`);
      } else {
        setNavIndicator('alerts', '');
      }

      // Status bar
      if (sbOpen) sbOpen.textContent = String(total);
    } catch (e) {
      console.warn('[SPA] Alert signals refresh failed:', e.message);
    }
  }

  // ─── License banner (v0.1.8 Stage D) ──────────────────────────
  // Polls /api/license/status. Shows top-of-page strip in warning/soft/hard
  // phases for paid licenses past JWT exp. NFR + pre-expiry paid licenses
  // never see the banner. Banner copy is locale-aware via window.t(); a
  // panoptica:locale-changed event re-renders from the cached status without
  // an extra network round-trip. License status is the same in every locale.
  let _licenseStatusCache = null;

  async function refreshLicenseBanner() {
    try {
      _licenseStatusCache = await api('/api/license/status');
    } catch (e) {
      // 500 from server, transient network down — don't fabricate a banner.
      console.warn('[SPA] License status fetch failed:', e.message);
      _licenseStatusCache = null;
    }
    renderLicenseBanner(_licenseStatusCache);
  }

  function renderLicenseBanner(status) {
    const el = document.getElementById('license-banner');
    if (!el) return;

    const phase = status && status.phase;
    if (!phase || phase === 'ok') {
      el.style.display = 'none';
      return;
    }

    const daysPast = Number(status.days_past_expiry) || 0;
    const daysUntilSoft = Math.max(0, 14 - daysPast);
    const daysUntilHard = Math.max(0, 21 - daysPast);

    let titleKey, bodyKey, bodyParams;
    if (phase === 'warning') {
      titleKey = 'license_banner.warning_title';
      bodyKey  = 'license_banner.warning_body';
      bodyParams = { days_until_soft: daysUntilSoft };
    } else if (phase === 'soft') {
      titleKey = 'license_banner.soft_title';
      bodyKey  = 'license_banner.soft_body';
      bodyParams = { days_until_hard: daysUntilHard };
    } else {
      // hard
      titleKey = 'license_banner.hard_title';
      bodyKey  = 'license_banner.hard_body';
      bodyParams = {};
    }

    const titleParams = { days: daysPast };

    const titleEl = document.getElementById('license-banner-title');
    const bodyEl  = document.getElementById('license-banner-body');
    if (titleEl) titleEl.textContent = (window.t && window.t(titleKey, titleParams)) || ('License expired ' + daysPast + ' day(s) ago');
    if (bodyEl)  bodyEl.textContent  = (window.t && window.t(bodyKey, bodyParams)) || '';

    el.setAttribute('data-phase', phase);
    el.style.display = '';

    // Translate the CTA's data-i18n attribute via the i18n helper.
    if (window.PanopticaI18n) window.PanopticaI18n.applyTo(el);
  }

  async function refreshTenantCount() {
    const sbTenants = document.getElementById('sb-tenant-count');
    try {
      const tenants = await api('/api/tenants');
      const n = Array.isArray(tenants) ? tenants.length : 0;
      if (n > 0) {
        setNavIndicator('tenants', `<span class="nav-count muted">${n}</span>`);
      } else {
        setNavIndicator('tenants', '');
      }
      if (sbTenants) sbTenants.textContent = String(n);
    } catch (e) {
      console.warn('[SPA] Tenant count refresh failed:', e.message);
    }
  }

  // Exposed to pages so Main Console can push its computed average secure score
  // (we don't want to re-hit /api/tenants/scores/secure here — that costs 14
  // Graph API calls per tenant list).
  function setStatus(key, value) {
    const id = ({
      tenantCount: 'sb-tenant-count',
      openAlerts: 'sb-open-alerts',
      secureScore: 'sb-secure-score',
      version: 'sb-version',
    })[key];
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? '—' : String(value);
  }

  function initBell() {
    const bell = document.getElementById('header-bell');
    if (!bell) return;
    bell.addEventListener('click', () => navigateTo('alerts'));
  }

  // ─── System Health (status bar indicator + click-through modal) ───

  // Last payload is cached so clicking the status cell doesn't block on a
  // fresh fetch — the modal opens instantly, then refreshes behind the scenes.
  let lastHealthPayload = null;

  // Health state labels — derived via t() so the status bar / health modal
  // agree with the operator's selected language. The status bar's data-i18n
  // attribute on initial paint shows the translated "Checking…"; once a
  // /api/health response lands, refreshHealth() overwrites with one of these.
  function healthStateLabel(state) {
    const keyByState = {
      nominal:  'statusbar.health.all_nominal',
      degraded: 'statusbar.health.degraded',
      critical: 'statusbar.health.critical',
    };
    const key = keyByState[state];
    return key ? window.t(key) : state;
  }
  const HEALTH_STATE_TO_LED = {
    nominal:  'sb-led-ok',
    degraded: 'sb-led-warn',
    critical: 'sb-led-crit',
  };
  const CHECK_STATE_TO_CLASS = { ok: 'state-ok', warn: 'state-warn', crit: 'state-crit' };

  async function refreshHealth() {
    const led = document.getElementById('sb-health-led');
    const label = document.getElementById('sb-health-label');
    const bar = document.getElementById('status-bar');
    if (!led || !label) return;

    try {
      const payload = await api('/api/health?lang=' + (window.PanopticaI18n?.currentLang() || 'en'));
      lastHealthPayload = payload;

      // Update LED class
      led.classList.remove('sb-led-ok', 'sb-led-warn', 'sb-led-crit');
      led.classList.add(HEALTH_STATE_TO_LED[payload.overall] || 'sb-led-ok');

      // Update label + status bar state class (for color-shift)
      label.textContent = payload.overall === 'nominal'
        ? healthStateLabel('nominal')
        : payload.summary || healthStateLabel(payload.overall) || payload.overall;

      if (bar) {
        bar.classList.remove('state-nominal', 'state-degraded', 'state-critical');
        bar.classList.add(`state-${payload.overall}`);
      }

      // Disk-space sentry banner — driven off the same poll (spec 2026-06-04).
      renderDiskBanner((payload.checks || []).find(c => c.id === 'disk'));
    } catch (e) {
      // If /api/health itself is unreachable, that IS a critical signal.
      console.warn('[SPA] Health refresh failed:', e.message);
      led.classList.remove('sb-led-ok', 'sb-led-warn');
      led.classList.add('sb-led-crit');
      label.textContent = window.t('statusbar.health.unreachable');
      if (bar) {
        bar.classList.remove('state-nominal', 'state-degraded');
        bar.classList.add('state-critical');
      }
    }
  }

  // Disk-space sentry banner. Shows app-wide at ≥80% used (amber) / ≥90% (red).
  // Reuses the license-banner styling via the shared data-phase color rules.
  // Body text is the disk check's already-localized summary (carries the live
  // numbers); title is a localized severity headline.
  function renderDiskBanner(check) {
    const el = document.getElementById('disk-banner');
    if (!el) return;
    if (!check || (check.state !== 'warn' && check.state !== 'crit')) {
      el.style.display = 'none';
      return;
    }
    const titleEl = document.getElementById('disk-banner-title');
    const bodyEl = document.getElementById('disk-banner-body');
    el.dataset.phase = check.state === 'crit' ? 'hard' : 'warning';
    if (titleEl) titleEl.textContent = window.t(check.state === 'crit' ? 'disk_banner.crit_title' : 'disk_banner.warn_title');
    if (bodyEl) bodyEl.textContent = check.summary || '';
    el.style.display = '';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderCheckDetail(check) {
    const d = check.detail || {};
    switch (check.id) {
      case 'alert_poller': {
        const rows = [];
        if (d.freshest_minutes != null) {
          rows.push([
            window.t('health.alert_poller.freshest_poll'),
            window.t('health.alert_poller.minutes_ago', { minutes: d.freshest_minutes }),
          ]);
        }
        if (d.stalest_minutes != null) {
          rows.push([
            window.t('health.alert_poller.stalest_poll'),
            window.t('health.alert_poller.minutes_ago', { minutes: d.stalest_minutes }),
          ]);
        }
        let html = rows.map(([k, v]) =>
          `<div class="hc-kv"><span class="k">${escHtml(k)}</span><span class="v">${escHtml(v)}</span></div>`
        ).join('');

        if (Array.isArray(d.stale_tenants) && d.stale_tenants.length > 0) {
          html += `<table class="hc-table"><thead><tr>
            <th>${escHtml(window.t('health.alert_poller.table_tenant'))}</th>
            <th>${escHtml(window.t('health.alert_poller.table_last_polled'))}</th>
            <th>${escHtml(window.t('health.alert_poller.table_overdue_by'))}</th>
          </tr></thead><tbody>`;
          for (const st of d.stale_tenants) {
            const overdue = st.minutes_overdue == null
              ? window.t('health.alert_poller.never_polled')
              : window.t('health.alert_poller.minutes_short', { minutes: Math.max(0, st.minutes_overdue) });
            html += `<tr>
              <td>${escHtml(st.name)}</td>
              <td class="mono">${escHtml(st.last_polled_at || '—')}</td>
              <td>${escHtml(overdue)}</td>
            </tr>`;
          }
          html += '</tbody></table>';
        }
        return html;
      }

      case 'graph_endpoints': {
        let html = '';
        html += `<div class="hc-kv"><span class="k">${escHtml(window.t('health.graph_endpoints.window'))}</span><span class="v">${escHtml(window.t('health.graph_endpoints.last_n_hours', { hours: d.window_hours }))}</span></div>`;
        html += `<div class="hc-kv"><span class="k">${escHtml(window.t('health.graph_endpoints.tenants_affected'))}</span><span class="v">${escHtml(window.t('health.graph_endpoints.x_of_y', { affected: d.failing_tenants, total: d.total_tenants }))}</span></div>`;
        if (Array.isArray(d.records) && d.records.length > 0) {
          html += `<table class="hc-table"><thead><tr>
            <th>${escHtml(window.t('health.graph_endpoints.table_tenant'))}</th>
            <th>${escHtml(window.t('health.graph_endpoints.table_endpoint'))}</th>
            <th>${escHtml(window.t('health.graph_endpoints.table_status'))}</th>
            <th>${escHtml(window.t('health.graph_endpoints.table_fails'))}</th>
            <th>${escHtml(window.t('health.graph_endpoints.table_last_error'))}</th>
          </tr></thead><tbody>`;
          for (const r of d.records) {
            html += `<tr>
              <td>${escHtml(r.tenant)}</td>
              <td class="mono">${escHtml(r.endpoint)}</td>
              <td>${escHtml(r.status)}</td>
              <td>${escHtml(r.failure_count)}</td>
              <td class="mono">${escHtml(r.last_error || '—')}</td>
            </tr>`;
          }
          html += '</tbody></table>';
        }
        return html;
      }

      case 'claude_api': {
        const rows = [
          [window.t('health.claude_api.last_briefing'), d.last_generated_at || '—'],
          [window.t('health.claude_api.hours_since'),   d.hours_since == null ? '—' : `${d.hours_since}h`],
          [window.t('health.claude_api.warn_threshold'), `${d.warn_threshold_hours}h`],
          [window.t('health.claude_api.crit_threshold'), `${d.crit_threshold_hours}h`],
        ];
        return rows.map(([k, v]) =>
          `<div class="hc-kv"><span class="k">${escHtml(k)}</span><span class="v mono">${escHtml(v)}</span></div>`
        ).join('');
      }

      case 'database': {
        const rows = [
          [window.t('health.database.ping'), d.ping_ms != null ? window.t('health.database.ms_unit', { ms: d.ping_ms }) : '—'],
          [window.t('health.database.warn_threshold'), window.t('health.database.ms_unit', { ms: d.warn_threshold_ms })],
          [window.t('health.database.crit_threshold'), window.t('health.database.ms_unit', { ms: d.crit_threshold_ms })],
        ];
        if (d.error) rows.push([window.t('health.database.error'), d.error]);
        return rows.map(([k, v]) =>
          `<div class="hc-kv"><span class="k">${escHtml(k)}</span><span class="v mono">${escHtml(v)}</span></div>`
        ).join('');
      }

      case 'disk': {
        const gb = (b) => (typeof b === 'number' ? (b / (1024 ** 3)).toFixed(1) + ' GB' : '—');
        const rows = [];
        if (d.used_pct != null) rows.push([window.t('health.disk.used'), `${d.used_pct}%`]);
        if (d.free_bytes != null) rows.push([window.t('health.disk.free'), gb(d.free_bytes)]);
        if (d.total_bytes != null) rows.push([window.t('health.disk.total'), gb(d.total_bytes)]);
        if (d.warn_threshold_pct != null) rows.push([window.t('health.disk.warn_threshold'), `${d.warn_threshold_pct}%`]);
        if (d.crit_threshold_pct != null) rows.push([window.t('health.disk.crit_threshold'), `${d.crit_threshold_pct}%`]);
        if (d.error) rows.push([window.t('health.disk.error'), d.error]);
        return rows.map(([k, v]) =>
          `<div class="hc-kv"><span class="k">${escHtml(k)}</span><span class="v mono">${escHtml(v)}</span></div>`
        ).join('');
      }

      default:
        return '';
    }
  }

  function renderHealthModalBody(payload) {
    const summaryClass = payload.overall === 'nominal' ? 'state-ok'
                       : payload.overall === 'degraded' ? 'state-warn' : 'state-crit';
    const overallLabel = healthStateLabel(payload.overall) || payload.overall;

    let html = `<div class="health-summary ${summaryClass}">
      <span class="hm-led"></span>
      <span class="hm-overall">${escHtml(overallLabel)}</span>
      <span class="hm-time">${escHtml(payload.checked_at || '')}</span>
    </div>`;

    html += (payload.checks || []).map(c => {
      const checkClass = CHECK_STATE_TO_CLASS[c.state] || 'state-ok';
      const detailHtml = renderCheckDetail(c);
      const detailBlock = detailHtml
        ? `<details class="hc-detail" ${c.state !== 'ok' ? 'open' : ''}>
             <summary>${window.t('health.modal_details_summary')}</summary>
             ${detailHtml}
           </details>`
        : '';
      return `<div class="health-check ${checkClass}">
        <span class="hc-led"></span>
        <div>
          <div class="hc-title">${escHtml(c.label)}</div>
          <div class="hc-summary">${escHtml(c.summary)}</div>
          ${detailBlock}
        </div>
      </div>`;
    }).join('');

    return html;
  }

  async function openHealthModal() {
    // Open with cached payload immediately (if any) for instant UX,
    // then refetch in the background and rerender.
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('health-modal-open');

    const modalTitle = window.t('statusbar.health.modal_title');
    if (lastHealthPayload) {
      openModal(modalTitle, renderHealthModalBody(lastHealthPayload), '');
    } else {
      openModal(modalTitle,
        '<div class="loading-container" style="height:120px;">' +
        '<div class="loading-spinner"></div>' + window.t('statusbar.health.running_checks') + '</div>', '');
    }

    // Always do a fresh fetch on open. Pass ?lang= so the server returns
    // labels/summaries pre-translated; otherwise the modal flashes English
    // even when the operator's locale is fr/es. (May 1, 2026 fix.)
    try {
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const fresh = await api('/api/health?lang=' + encodeURIComponent(lang));
      lastHealthPayload = fresh;
      // Only rerender if modal is still open
      if (overlay && overlay.classList.contains('active')) {
        document.getElementById('modal-body').innerHTML = renderHealthModalBody(fresh);
      }
      // Also keep the status bar in sync with the fresh data
      refreshHealth();
    } catch (e) {
      if (overlay && overlay.classList.contains('active')) {
        const msg = window.t('statusbar.health.fetch_failed', { message: escHtml(e.message || 'unknown error') });
        document.getElementById('modal-body').innerHTML =
          `<div class="panel-error">${msg}</div>`;
      }
    }
  }

  function initHealthIndicator() {
    const cell = document.getElementById('sb-health-cell');
    if (!cell) return;
    cell.addEventListener('click', openHealthModal);
  }

  // Clear the health-modal-open flag when any modal is closed so a subsequent
  // generic openModal call doesn't inherit the widened size.
  function wireHealthModalCleanup() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    const clear = () => overlay.classList.remove('health-modal-open');
    document.getElementById('modal-close')?.addEventListener('click', clear);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) clear(); });
  }

  // ─── API Helper ───

  async function api(url, options = {}) {
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
    };
    const res = await fetch(url, { ...defaults, ...options });
    if (res.status === 401) {
      window.location.href = '/auth/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ─── Init ───

  async function init() {
    // Load i18n
    try {
      i18n = await api('/api/i18n/en');
    } catch (e) {
      console.warn('[SPA] Failed to load i18n:', e);
    }

    // Load user info
    try {
      const status = await api('/auth/status');
      if (status.authenticated) {
        userInfo = status.user;
        const userEl = document.getElementById('header-user');
        if (userEl) userEl.textContent = userInfo.name || userInfo.email;
        paintAvatar();
        paintRoleBadge(userInfo.role);
        // Stage 5 — capture the cached update-check result and light the banner.
        appUpdateStatus = status.update || null;
        renderUpdateBanner();
        // v0.1.8 — pick up app version. /auth/status is the single fetch
        // that brings this to the SPA on first load; the What's-New modal
        // also embeds it in its header. Version is rendered in the
        // status-bar bottom-right via setStatus (sb-version); the v0.1.7
        // sidebar-version badge was removed for single-source-of-truth.
        if (status.version && status.version.version) {
          appVersion = status.version.version;
          appReleasedAt = status.version.releasedAt || null;
          setStatus('version', 'Panoptica365 v' + appVersion);
        }
      }
    } catch (e) {
      console.warn('[SPA] Failed to load user status');
    }

    // A3 RBAC — UI visibility. Two-layer pattern (see panoptica.css):
    //   Layer 1: body.role-{admin|member|viewer} class + CSS rules hide
    //     anything the current role can't see. Immediate, no flash.
    //   Layer 2: applyRoleVisibility() walks [data-role-required] and
    //     toggles .role-hidden. Mostly redundant with Layer 1 but kept
    //     as a safety net; the MutationObserver below also relies on
    //     this helper for any dynamic content that escapes the CSS rules.
    // Server-side requireAdmin / requireMemberOrAdmin is the real
    // enforcement. UI hiding is just UX polish.
    if (userInfo?.role) {
      document.body.classList.add('role-' + userInfo.role);
    }
    applyRoleVisibility(userInfo?.role);
    // MutationObserver catches buttons that page scripts render dynamically
    // after this initial walk (CA assignment rows, Intune deployment rows,
    // exemption rows, alert slideout actions, etc.).
    startRoleVisibilityObserver();

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Header chrome: bell / avatar / mute indicator
    initBell();
    initUserPrefs();
    initHeaderMenu();
    initHeaderMuteIndicator();

    // Sidebar counts + bell badge, shared refresh loop
    refreshAlertSignals();
    refreshTenantCount();
    // 60s is plenty — both pages have their own live refresh when open.
    setInterval(refreshAlertSignals, 60_000);
    setInterval(refreshTenantCount, 5 * 60_000);

    // License banner (Stage D — v0.1.8). 5-minute cadence matches the
    // health indicator; the status endpoint is server-cheap (reads from
    // the validator's in-memory cache). Re-render on locale change from
    // the cached status — no extra fetch needed since the same status
    // renders identically in every locale.
    refreshLicenseBanner();
    setInterval(refreshLicenseBanner, 5 * 60_000);
    window.addEventListener('panoptica:locale-changed', () => renderLicenseBanner(_licenseStatusCache));

    // System health indicator (status bar, bottom-left).
    // 5-minute cadence per Jacques' spec — catches a missed 15-min poll
    // within roughly one cycle while keeping the check itself near-free
    // (single aggregated endpoint, all signals derived from DB state,
    // no outbound API calls per health fetch).
    initHealthIndicator();
    wireHealthModalCleanup();
    refreshHealth();
    setInterval(refreshHealth, 5 * 60_000);
    // May 1, 2026 — refetch health on language switch so the status bar's
    // server-rendered summary swaps to the new locale instantly. Without
    // this, the previous payload sticks until the next 5-min tick.
    window.addEventListener('panoptica:locale-changed', refreshHealth);

    // Lazy-init Socket.IO so background server events (e.g. SharePoint audit
    // completion) can surface toasts even if the user has navigated away.
    try { getSocket(); } catch (e) { console.warn('[SPA] Socket init failed:', e); }

    // Nav click handlers
    document.querySelectorAll('#sidebar-nav .nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (page && page !== currentPage) {
          navigateTo(page);
        }
      });
    });

    // Check for page param from redirects (e.g., admin consent callback)
    const urlParams = new URLSearchParams(window.location.search);
    const startPage = urlParams.get('page') || 'main-console';

    // Clean URL (remove query params without reload)
    if (urlParams.toString()) {
      // Pass params through to the page module
      const pageParams = {};
      urlParams.forEach((v, k) => { if (k !== 'page') pageParams[k] = v; });
      window.history.replaceState({}, '', '/');
      navigateTo(startPage, pageParams);
    } else {
      navigateTo('main-console');
    }
  }

  // ─── Lightweight Markdown → HTML (for Claude chat output) ───
  function mdToHtml(text) {
    if (!text) return '';
    // Escape HTML first
    let h = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Headers: # → h3, ## → h4 (only at start of line)
    h = h.replace(/^### (.+)$/gm, '<h5 class="chat-h">$1</h5>');
    h = h.replace(/^## (.+)$/gm, '<h4 class="chat-h">$1</h4>');
    h = h.replace(/^# (.+)$/gm, '<h3 class="chat-h">$1</h3>');
    // Bold: **text**
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code: `text`
    h = h.replace(/`([^`]+)`/g, '<code class="chat-code">$1</code>');
    // Horizontal rule: ---
    h = h.replace(/^---$/gm, '<hr class="chat-hr">');
    // Numbered lists: lines starting with "1. ", "2. " etc.
    h = h.replace(/^(\d+)\. (.+)$/gm, '<div class="chat-li"><span class="chat-li-num">$1.</span> $2</div>');
    // Bullet lists: lines starting with "- "
    h = h.replace(/^- (.+)$/gm, '<div class="chat-li"><span class="chat-li-bullet">•</span> $1</div>');
    // Newlines to <br> (but not after block elements)
    h = h.replace(/\n/g, '<br>');
    // Clean up <br> after block elements
    h = h.replace(/(<\/h[345]>|<\/div>|<hr[^>]*>)<br>/g, '$1');
    return h;
  }

  // ─── Socket.IO — global server → client channel ───
  // Connected lazily and shared across pages. Used so features like the
  // SharePoint audit can notify the user even when they've navigated away.
  let socket = null;
  function getSocket() {
    if (socket) return socket;
    if (typeof window.io !== 'function') return null;
    socket = window.io({ path: '/socket.io', reconnection: true });
    socket.on('connect', () => console.log('[WS] Connected'));
    socket.on('disconnect', () => console.log('[WS] Disconnected'));

    // SharePoint audit completion — show toast from anywhere in the SPA
    socket.on('sp:audit:complete', (payload) => {
      try {
        const msg = window.t('sharepoint.toast_audit_complete', {
          drive: payload.driveName,
          folders: payload.foldersScanned,
          explicit: payload.explicitCount,
        });
        showToast(msg, 'success');
      } catch (e) { console.error('[WS] sp:audit:complete handler:', e); }
    });
    socket.on('sp:audit:error', (payload) => {
      showToast(window.t('sharepoint.toast_audit_failed', {
        drive: payload.driveName,
        message: payload.message || 'unknown error',
      }), 'error');
    });
    return socket;
  }

  // ─── Expose global API for page modules ───
  /**
   * Replace all <i data-lucide="..."> elements in the DOM with their SVG.
   * Safe to call anytime; no-op if Lucide is not loaded.
   * Page scripts can call Panoptica.refreshIcons() after injecting new markup.
   */
  function refreshIcons(root) {
    if (typeof window.lucide !== 'undefined' && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons(root ? { nameAttr: 'data-lucide', icons: undefined, attrs: {}, root } : undefined);
      } catch (e) {
        // Fall back to global replace if scoped form isn't supported by this build
        try { window.lucide.createIcons(); } catch { /* ignore */ }
      }
    }
  }

  window.Panoptica = {
    navigateTo,
    openTenantDashboard,
    showToast,
    openModal,
    closeModal,
    api,
    mdToHtml,
    getSocket,
    setStatus,
    // Force an immediate refresh of the bell badge / sidebar count / status-bar
    // open-alerts cell. Call this from any code that changes alert status
    // (slideout, bulk actions, drift acceptance) so users don't wait up to 60s
    // for the counts to catch up with what they just did.
    refreshAlertSignals,
    refreshIcons,
    getI18n: () => i18n,
    getUser: () => userInfo,
    // A3 (May 9, 2026): page scripts that render mutate buttons dynamically
    // (alert rows, CA assignments, Intune deployments, exemption rows, etc.)
    // should call this after innerHTML/createElement so any new buttons
    // tagged data-role-required get hidden for under-privileged users.
    // Without this, JS-rendered buttons appear regardless of role until the
    // next page navigation.
    applyRoleVisibility: () => applyRoleVisibility(userInfo?.role),
    getRole: () => userInfo?.role || null,
    // v0.1.7 — expose for page scripts that may want to surface "what's new"
    // links of their own. The header menu uses this too.
    openWhatsNew: () => openWhatsNewModal(),
    getAppVersion: () => appVersion,
  };

  // Go
  init();
})();
