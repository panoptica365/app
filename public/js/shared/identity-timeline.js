/**
 * Panoptica365 — Feature 8.7: Identity Threat Correlation Panel (ITDR)
 *
 * A read-only, right-side slide-over drawer that opens OVER the alert slideout.
 * It shows one user's events for [anchor.triggered_at − 24h, now] (widen to 7d)
 * stitched across sign-ins, the Unified Audit Log, Defender incidents, and
 * other Panoptica alerts, with a short Haiku correlation story at the top.
 *
 * Read-only: no control here mutates a tenant. Deep-links (Learn Hub, Entra
 * sign-in logs, Defender incident) navigate only.
 *
 * Public API (window.Panoptica.IdentityTimeline):
 *   open({ tenantId, upn, anchorAlertId })
 *   close()
 */
(function () {
  'use strict';

  const t = (key, fallback) => {
    if (window.PanopticaI18n && typeof window.PanopticaI18n.t === 'function') {
      const v = window.PanopticaI18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback != null ? fallback : key;
  };

  function curLang() {
    return (window.PanopticaI18n && window.PanopticaI18n.currentLang && window.PanopticaI18n.currentLang()) || 'en';
  }

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function fmt(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(curLang(), {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return String(ts); }
  }

  let overlayEl = null;
  let state = null; // { tenantId, upn, anchorAlertId, windowKey }

  // -------------------------------------------------------------------------
  // Styles (self-contained, mirrors alert-explainer.js ensureStyles pattern).
  // -------------------------------------------------------------------------
  function ensureStyles() {
    if (document.getElementById('identity-timeline-styles')) return;
    const style = document.createElement('style');
    style.id = 'identity-timeline-styles';
    style.textContent = `
      .itl-overlay {
        position: fixed; inset: 0; z-index: 10002;
        background: rgba(15, 23, 42, 0.45);
        display: flex; justify-content: flex-end;
        backdrop-filter: blur(2px);
      }
      .itl-drawer {
        background: var(--p-surface, #fff); color: var(--p-text, #0f172a);
        width: 620px; max-width: 94vw; height: 100%;
        display: flex; flex-direction: column;
        box-shadow: -12px 0 40px rgba(0,0,0,0.28);
        border-left: 1px solid var(--p-border, #e2e8f0);
        animation: itl-slide-in 0.18s ease-out;
      }
      @keyframes itl-slide-in { from { transform: translateX(24px); opacity: 0.6; } to { transform: none; opacity: 1; } }
      .itl-header {
        padding: 16px 20px; border-bottom: 1px solid var(--p-border, #e2e8f0);
        position: sticky; top: 0; background: var(--p-surface, #fff); z-index: 1;
      }
      .itl-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .itl-title { font-size: 1.05rem; font-weight: 650; margin: 0; word-break: break-all; }
      .itl-subtitle { font-size: 0.78rem; color: var(--p-text-secondary, #64748b); margin-top: 3px; }
      .itl-close { background: transparent; border: none; cursor: pointer; color: var(--p-text-secondary, #64748b); padding: 4px; border-radius: 6px; display: flex; }
      .itl-close:hover { background: var(--p-hover, #f1f5f9); }
      .itl-controls { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      .itl-winbtn, .itl-reanalyze {
        font-family: inherit; font-size: 0.75rem; padding: 4px 11px; cursor: pointer;
        border: 1px solid var(--p-border, #cbd5e1); border-radius: 7px;
        background: var(--p-surface, #fff); color: var(--p-text, #0f172a);
      }
      .itl-winbtn.active { background: var(--p-accent, #2563eb); color: #fff; border-color: var(--p-accent, #2563eb); }
      .itl-reanalyze { margin-left: auto; }
      .itl-reanalyze:disabled { opacity: 0.5; cursor: default; }
      .itl-body { padding: 16px 20px 28px; overflow-y: auto; flex: 1; }

      .itl-story { border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; border: 1px solid var(--p-border, #e2e8f0); background: var(--p-bg-subtle, #f8fafc); }
      .itl-class-badge { display: inline-block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 9px; border-radius: 999px; margin-bottom: 8px; }
      .itl-class-possible_compromise { background: #fee2e2; color: #b91c1c; }
      .itl-class-brute_force, .itl-class-password_spray { background: #fef3c7; color: #92400e; }
      .itl-class-failed_auth_only { background: #dcfce7; color: #166534; }
      .itl-class-inconclusive { background: #e2e8f0; color: #475569; }
      .itl-story-text { font-size: 0.9rem; line-height: 1.6; margin: 0 0 8px; }
      .itl-next-check { font-size: 0.85rem; margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed var(--p-border, #e2e8f0); }
      .itl-next-check b { color: var(--p-accent, #2563eb); }
      .itl-reasons { margin: 6px 0 0; padding-left: 18px; font-size: 0.82rem; color: var(--p-text-secondary, #475569); }
      .itl-reasons li { margin: 2px 0; }
      .itl-story-meta { font-size: 0.7rem; color: var(--p-text-secondary, #94a3b8); margin-top: 8px; }
      .itl-story-empty { color: var(--p-text-secondary, #64748b); font-size: 0.85rem; font-style: italic; }
      .itl-stale-flag { color: #b45309; font-weight: 600; }

      .itl-section-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--p-text-secondary, #94a3b8); margin: 4px 0 10px; }

      .itl-event { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--p-border, #f1f5f9); }
      .itl-marker { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 50%; margin-top: 4px; border: 2px solid transparent; }
      .itl-mk-success { background: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.18); }
      .itl-mk-failure { background: #dc2626; }
      .itl-mk-ual { background: var(--p-surface,#fff); border-color: #6366f1; }
      .itl-mk-ual.sensitive { background: #6366f1; }
      .itl-mk-defender { background: #f59e0b; }
      .itl-mk-alert { background: var(--p-surface,#fff); border-color: #94a3b8; }
      .itl-mk-alert.anchor { background: #2563eb; border-color: #2563eb; }
      .itl-ev-main { flex: 1; min-width: 0; }
      .itl-ev-title { font-size: 0.86rem; font-weight: 600; }
      .itl-ev-title.success { color: #166534; }
      .itl-ev-title.failure { color: #b91c1c; }
      .itl-ev-sub { font-size: 0.76rem; color: var(--p-text-secondary, #64748b); margin-top: 2px; word-break: break-word; }
      .itl-ev-time { flex: 0 0 auto; font-size: 0.72rem; color: var(--p-text-secondary, #94a3b8); white-space: nowrap; }
      .itl-badge { display: inline-block; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border-radius: 5px; margin-left: 6px; vertical-align: middle; }
      .itl-badge-source { background: #eef2ff; color: #4338ca; }
      .itl-badge-sensitive { background: #fef3c7; color: #92400e; }
      .itl-badge-anchor { background: #dbeafe; color: #1d4ed8; }
      .itl-badge-sev-high, .itl-badge-sev-severe { background: #fee2e2; color: #b91c1c; }
      .itl-badge-sev-medium { background: #fef3c7; color: #92400e; }
      .itl-ev-link { font-size: 0.76rem; color: var(--p-accent, #2563eb); text-decoration: none; }
      .itl-ev-link:hover { text-decoration: underline; }

      .itl-empty { text-align: center; color: var(--p-text-secondary, #64748b); padding: 26px 0; font-size: 0.86rem; }
      .itl-footer { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--p-border, #e2e8f0); display: flex; flex-wrap: wrap; gap: 8px; }
      .itl-deeplink { font-size: 0.78rem; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--p-border, #cbd5e1); background: var(--p-surface, #fff); color: var(--p-text, #0f172a); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
      .itl-deeplink:hover { background: var(--p-hover, #f1f5f9); }
      .itl-deeplink i { width: 14px; height: 14px; }
      .itl-loading, .itl-error { padding: 40px 20px; text-align: center; color: var(--p-text-secondary, #64748b); }
      .itl-loading { display: flex; flex-direction: column; align-items: center; gap: 16px; padding-top: 70px; }
      .itl-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--p-border, #e2e8f0); border-top-color: var(--p-accent, #2563eb); animation: itl-spin 0.8s linear infinite; }
      @keyframes itl-spin { to { transform: rotate(360deg); } }
      .itl-progress-msg { font-size: 0.9rem; color: var(--p-text-secondary, #475569); transition: opacity 0.2s; }

      .itl-ip { white-space: nowrap; }
      .itl-ip-tag { display: inline-block; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.02em; color: var(--p-text-secondary, #64748b); background: var(--p-bg-subtle, #f1f5f9); border: 1px solid var(--p-border, #e2e8f0); border-radius: 4px; padding: 0 4px; margin-right: 4px; vertical-align: middle; }
      .itl-badge-count { background: #e0e7ff; color: #3730a3; }
      .itl-ev-time-end { color: var(--p-text-secondary, #94a3b8); font-size: 0.66rem; }
    `;
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Event rendering helpers.
  // -------------------------------------------------------------------------
  function errorLabel(code) {
    if (code === 0 || code == null) return t('alerts.identity_timeline.signin_success', 'Successful sign-in');
    const v = t(`alerts.identity_timeline.error_code.${code}`, '');
    if (v) return v;
    return `${t('alerts.identity_timeline.signin_failed', 'Sign-in failed')} (${code})`;
  }

  function sevBadge(sev) {
    const s = String(sev || '').toLowerCase();
    if (s === 'high' || s === 'severe' || s === 'medium') {
      return `<span class="itl-badge itl-badge-sev-${s}">${esc(s)}</span>`;
    }
    return '';
  }

  // Label a raw address so a level-1 operator knows what the long string is.
  function ipChip(ip) {
    if (!ip) return '';
    const kind = String(ip).includes(':') ? 'IPv6' : 'IPv4';
    return `<span class="itl-ip"><span class="itl-ip-tag">${kind}</span>${esc(ip)}</span>`;
  }

  // "×N" badge for collapsed bursts of identical events.
  function countBadge(count) {
    if (!count || count < 2) return '';
    return `<span class="itl-badge itl-badge-count">×${count}</span>`;
  }

  function renderEvent(e) {
    let markerCls = 'itl-mk-alert';
    let titleCls = '';
    let title = '';
    let subParts = [];
    let badges = '';
    let linkHtml = '';

    if (e.source === 'signin') {
      const success = e.outcome === 'success';
      markerCls = success ? 'itl-mk-success' : 'itl-mk-failure';
      titleCls = success ? 'success' : 'failure';
      title = success ? t('alerts.identity_timeline.signin_success', 'Successful sign-in') : errorLabel(e.meta.error_code);
      if (e.meta.app_display_name) subParts.push(esc(e.meta.app_display_name));
      const geo = [e.country, e.city].filter(Boolean).join(', ');
      if (geo) subParts.push(esc(geo));
      if (e.ip) subParts.push(ipChip(e.ip));
      if (e.meta.risk_during && e.meta.risk_during !== 'none') {
        badges += `<span class="itl-badge itl-badge-sev-medium">${esc(t('alerts.identity_timeline.risk', 'risk'))}: ${esc(e.meta.risk_during)}</span>`;
      }
    } else if (e.source === 'ual') {
      markerCls = 'itl-mk-ual' + (e.sensitive ? ' sensitive' : '');
      title = e.meta.operation ? esc(e.meta.operation) : t('alerts.identity_timeline.audit_event', 'Audit event');
      badges += `<span class="itl-badge itl-badge-source">${esc(t('alerts.identity_timeline.source.ual', 'Audit log'))}</span>`;
      if (e.sensitive) badges += `<span class="itl-badge itl-badge-sensitive">${esc(t('alerts.identity_timeline.sensitive', 'sensitive'))}</span>`;
      if (e.meta.target_name) subParts.push(esc(e.meta.target_name));
      if (e.ip) subParts.push(ipChip(e.ip));
    } else if (e.source === 'defender') {
      markerCls = 'itl-mk-defender';
      title = e.meta.display_name ? esc(e.meta.display_name) : t('alerts.identity_timeline.defender_incident', 'Defender incident');
      badges += `<span class="itl-badge itl-badge-source">${esc(t('alerts.identity_timeline.source.defender', 'Defender'))}</span>` + sevBadge(e.severity);
      if (e.meta.status) subParts.push(esc(e.meta.status));
      if (e.link) {
        linkHtml = `<a class="itl-ev-link" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(t('alerts.identity_timeline.open_incident', 'Open incident'))} ↗</a>`;
      }
    } else if (e.source === 'alert') {
      markerCls = 'itl-mk-alert' + (e.is_anchor ? ' anchor' : '');
      title = e.meta.message ? esc(e.meta.message) : t('alerts.identity_timeline.alert', 'Alert');
      if (e.is_anchor) badges += `<span class="itl-badge itl-badge-anchor">${esc(t('alerts.identity_timeline.anchor', 'this alert'))}</span>`;
      badges += sevBadge(e.severity);
      if (e.meta.status) subParts.push(esc(e.meta.status));
    }

    const subLine = subParts.length
      ? `<div class="itl-ev-sub">${subParts.join(' · ')}${linkHtml ? ' · ' + linkHtml : ''}</div>`
      : (linkHtml ? `<div class="itl-ev-sub">${linkHtml}</div>` : '');

    // When a burst was collapsed, show the span end under the start time.
    const timeHtml = (e.count && e.count > 1 && e.last_ts && e.last_ts !== e.ts)
      ? `${esc(fmt(e.ts))}<br><span class="itl-ev-time-end">→ ${esc(fmt(e.last_ts))}</span>`
      : esc(fmt(e.ts));

    return `
      <div class="itl-event">
        <span class="itl-marker ${markerCls}"></span>
        <div class="itl-ev-main">
          <div class="itl-ev-title ${titleCls}">${title}${countBadge(e.count)}${badges}</div>
          ${subLine}
        </div>
        <div class="itl-ev-time">${timeHtml}</div>
      </div>
    `;
  }

  function renderStory(analysis, canGenerate) {
    if (!analysis) {
      const msg = canGenerate
        ? t('alerts.identity_timeline.story_generating', 'Generating AI summary…')
        : t('alerts.identity_timeline.story_none', 'AI summary not generated.');
      return `<div class="itl-story"><div class="itl-story-empty">${esc(msg)}</div></div>`;
    }
    const cls = analysis.classification || 'inconclusive';
    const classLabel = t(`alerts.identity_timeline.classification.${cls}`, cls);
    const reasons = (analysis.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('');
    const staleFlag = analysis.stale
      ? ` <span class="itl-stale-flag">(${esc(t('alerts.identity_timeline.stale', 'may be out of date'))})</span>`
      : '';
    return `
      <div class="itl-story">
        <span class="itl-class-badge itl-class-${esc(cls)}">${esc(classLabel)}</span>
        <p class="itl-story-text">${esc(analysis.story)}</p>
        ${analysis.next_check ? `<p class="itl-next-check"><b>${esc(t('alerts.identity_timeline.next_check', 'What to check next'))}:</b> ${esc(analysis.next_check)}</p>` : ''}
        ${reasons ? `<ul class="itl-reasons">${reasons}</ul>` : ''}
        <div class="itl-story-meta">${esc(t('alerts.identity_timeline.ai_generated', 'AI-generated summary'))}${analysis.generated_at ? ' · ' + esc(fmt(analysis.generated_at)) : ''}${staleFlag}</div>
      </div>
    `;
  }

  function learnSlug(classification) {
    if (classification === 'possible_compromise') return 'business-email-compromise';
    return 'credential-stuffing-and-password-spray';
  }

  function renderFooter(data) {
    const cls = data.analysis && data.analysis.classification;
    const slug = learnSlug(cls);
    const defender = (data.events || []).find((e) => e.source === 'defender' && e.link);
    let html = `<button class="itl-deeplink" data-learn="${esc(slug)}"><i data-lucide="graduation-cap"></i>${esc(t('alerts.identity_timeline.learn_link', 'Learn: account compromise & spray'))}</button>`;
    // Entra user link is built server-side with the tenant GUID (and the user's
    // object id when resolvable), so it actually lands on the right directory.
    const entraUser = data.links && data.links.entra_user;
    if (entraUser) {
      html += `<a class="itl-deeplink" href="${esc(entraUser)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i>${esc(t('alerts.identity_timeline.entra_link', 'Open user in Entra'))}</a>`;
    }
    if (defender) {
      html += `<a class="itl-deeplink" href="${esc(defender.link)}" target="_blank" rel="noopener"><i data-lucide="shield"></i>${esc(t('alerts.identity_timeline.defender_link', 'Defender incident'))}</a>`;
    }
    return `<div class="itl-footer">${html}</div>`;
  }

  // -------------------------------------------------------------------------
  // Render + wiring.
  // -------------------------------------------------------------------------
  function render(data) {
    const drawer = overlayEl && overlayEl.querySelector('.itl-drawer');
    if (!drawer) return;

    const win = data.window || {};
    const winLabel = `${fmt(win.start)} – ${fmt(win.end)}`;
    const events = data.events || [];

    const timelineHtml = events.length
      ? events.map(renderEvent).join('')
      : `<div class="itl-empty">${esc(t('alerts.identity_timeline.no_events', 'No activity found for this user in the selected window.'))}</div>`;

    drawer.innerHTML = `
      <div class="itl-header">
        <div class="itl-header-top">
          <div>
            <h2 class="itl-title">${esc(state.upn)}</h2>
            <div class="itl-subtitle">${esc(winLabel)}</div>
          </div>
          <button class="itl-close" aria-label="${esc(t('common.close', 'Close'))}"><i data-lucide="x"></i></button>
        </div>
        <div class="itl-controls">
          <button class="itl-winbtn ${state.windowKey === '24h' ? 'active' : ''}" data-window="24h">${esc(t('alerts.identity_timeline.window_24h', 'Last 24h'))}</button>
          <button class="itl-winbtn ${state.windowKey === '7d' ? 'active' : ''}" data-window="7d">${esc(t('alerts.identity_timeline.window_7d', 'Last 7 days'))}</button>
          <button class="itl-reanalyze" data-role-required="member" ${data.can_generate ? '' : 'disabled'}>${esc(t('alerts.identity_timeline.reanalyze', 'Re-analyze'))}</button>
        </div>
      </div>
      <div class="itl-body">
        ${renderStory(data.analysis, data.can_generate)}
        <div class="itl-section-label">${esc(t('alerts.identity_timeline.timeline', 'Timeline'))}</div>
        ${timelineHtml}
        ${renderFooter(data)}
      </div>
    `;

    const closeBtn = drawer.querySelector('.itl-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    drawer.querySelectorAll('.itl-winbtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.dataset.window;
        if (w && w !== state.windowKey) { state.windowKey = w; load(); }
      });
    });

    const reBtn = drawer.querySelector('.itl-reanalyze');
    if (reBtn) reBtn.addEventListener('click', reanalyze);

    const learnBtn = drawer.querySelector('[data-learn]');
    if (learnBtn) learnBtn.addEventListener('click', () => openLearn(learnBtn.dataset.learn));

    if (window.PanopticaI18n && window.PanopticaI18n.applyTo) window.PanopticaI18n.applyTo(drawer);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    if (window.Panoptica && window.Panoptica.applyRoleVisibility) window.Panoptica.applyRoleVisibility();
  }

  function openLearn(slug) {
    const topic = 'identity-threats-and-attack-patterns';
    close();
    if (window.Panoptica && window.Panoptica.AlertSlideout && window.Panoptica.AlertSlideout.close) {
      window.Panoptica.AlertSlideout.close();
    }
    window.location.hash = '#learn';
    let tries = 0;
    const tryOpen = () => {
      tries++;
      const lp = window.Panoptica && window.Panoptica.LearnPage;
      if (lp && lp.openLesson && document.getElementById('learn-lesson-modal')) {
        lp.openLesson(topic, slug);
      } else if (tries < 30) {
        setTimeout(tryOpen, 120);
      }
    };
    setTimeout(tryOpen, 200);
  }

  function setBusy(busy) {
    const drawer = overlayEl && overlayEl.querySelector('.itl-drawer');
    if (!drawer) return;
    const reBtn = drawer.querySelector('.itl-reanalyze');
    if (reBtn) {
      reBtn.disabled = busy;
      reBtn.textContent = busy
        ? t('alerts.identity_timeline.analyzing', 'Analyzing…')
        : t('alerts.identity_timeline.reanalyze', 'Re-analyze');
    }
  }

  function qs() {
    return `tenantId=${encodeURIComponent(state.tenantId)}`
      + `&upn=${encodeURIComponent(state.upn)}`
      + `&anchorAlertId=${encodeURIComponent(state.anchorAlertId)}`
      + `&window=${encodeURIComponent(state.windowKey)}`
      + `&lang=${encodeURIComponent(curLang())}`;
  }

  // Staged loading: the GET builds the timeline AND runs Haiku inline, which
  // takes a few seconds. We can't see server-side progress, so we narrate the
  // expected phases on a timer so the operator knows work is happening.
  let progressTimer = null;
  function startProgress(drawer) {
    const steps = [
      t('alerts.identity_timeline.progress_collect', 'Collecting sign-ins & audit logs…'),
      t('alerts.identity_timeline.progress_correlate', 'Correlating events across sources…'),
      t('alerts.identity_timeline.progress_analyze', 'Asking Haiku to assess the activity…'),
      t('alerts.identity_timeline.progress_finish', 'Almost there…'),
    ];
    let i = 0;
    const paint = () => {
      drawer.innerHTML = `
        <div class="itl-loading">
          <div class="itl-spinner" aria-hidden="true"></div>
          <div class="itl-progress-msg">${esc(steps[i])}</div>
        </div>`;
    };
    paint();
    progressTimer = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      paint();
      if (i === steps.length - 1) { clearInterval(progressTimer); progressTimer = null; }
    }, 1600);
  }
  function stopProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  async function load() {
    const drawer = overlayEl && overlayEl.querySelector('.itl-drawer');
    if (!drawer) return;
    startProgress(drawer);
    try {
      const res = await fetch(`/api/identity-timeline?${qs()}`);
      if (!res.ok) throw new Error('timeline fetch failed');
      const data = await res.json();
      stopProgress();
      render(data);
    } catch (err) {
      stopProgress();
      console.error('[IdentityTimeline] load error:', err);
      drawer.innerHTML = `<div class="itl-error">${esc(t('alerts.identity_timeline.load_error', 'Failed to load the identity timeline.'))}</div>`;
    }
  }

  async function reanalyze() {
    setBusy(true);
    try {
      const res = await fetch('/api/identity-timeline/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: state.tenantId, upn: state.upn,
          anchorAlertId: state.anchorAlertId, window: state.windowKey, lang: curLang(),
        }),
      });
      if (!res.ok) throw new Error('analyze failed');
      const data = await res.json();
      render(data);
    } catch (err) {
      console.error('[IdentityTimeline] reanalyze error:', err);
      setBusy(false);
    }
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(opts) {
    opts = opts || {};
    if (!opts.tenantId || !opts.upn || !opts.anchorAlertId) {
      console.warn('[IdentityTimeline] open() requires { tenantId, upn, anchorAlertId }');
      return;
    }
    ensureStyles();
    close();
    state = {
      tenantId: opts.tenantId,
      upn: String(opts.upn).trim().toLowerCase(),
      anchorAlertId: opts.anchorAlertId,
      windowKey: '24h',
    };
    overlayEl = document.createElement('div');
    overlayEl.className = 'itl-overlay';
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
    overlayEl.innerHTML = `<div class="itl-drawer" role="dialog" aria-modal="true"><div class="itl-loading">${esc(t('common.loading', 'Loading…'))}</div></div>`;
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', onKey);
    load();
  }

  function close() {
    stopProgress();
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    document.removeEventListener('keydown', onKey);
  }

  window.Panoptica = window.Panoptica || {};
  window.Panoptica.IdentityTimeline = { open, close };
})();
