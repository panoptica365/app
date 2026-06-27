/**
 * Panoptica — Shared Alert Slide-out Detail Panel
 *
 * Single source of truth for the alert detail slideout. Loaded once from
 * index.html and exposed as `Panoptica.AlertSlideout`. Both the global Alert
 * Dashboard (alerts.js) and the per-tenant Alerts view (tenant-dashboard.js)
 * call into this module so the two views can never drift apart again.
 *
 * Public API:
 *   Panoptica.AlertSlideout.open(alertId, { onStatusChanged, onClose })
 *   Panoptica.AlertSlideout.close()
 *   Panoptica.AlertSlideout.isOpen()
 *
 * Callbacks:
 *   onStatusChanged()  fires after a successful PATCH /api/alerts/:id/status
 *                      — callers typically refresh their table.
 *   onClose()          fires when the slideout is dismissed.
 */
(function () {
  'use strict';

  let quillNotes = null;
  let currentAlertId = null;
  let callbacks = {};
  let handlersWired = false;

  const SLIDEOUT_HTML = `
    <div class="alert-overlay" id="alert-overlay"></div>
    <div class="alert-slideout" id="alert-slideout">
      <div class="alert-slideout-header">
        <button class="alert-slideout-close" id="alert-slideout-close">&times;</button>
        <div id="alert-detail-header"></div>
      </div>
      <div class="alert-slideout-body" id="alert-slideout-body"></div>
    </div>
  `;

  // ─── Mount (once) ───
  //
  // The slideout DOM normally ships pre-mounted in index.html. We lazily
  // create it only if missing (defensive — e.g. if a future index.html edit
  // drops it). Handler wiring is tracked separately so the × and overlay
  // click still get wired when the DOM was already present. This is the bug
  // the first rev had: a single `if (DOM exists) return` skipped the wiring.

  function mount() {
    if (!document.getElementById('alert-slideout')) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = SLIDEOUT_HTML.trim();
      while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);
    }

    if (!handlersWired) {
      const closeBtn = document.getElementById('alert-slideout-close');
      const overlay = document.getElementById('alert-overlay');
      if (closeBtn) closeBtn.addEventListener('click', close);
      if (overlay) overlay.addEventListener('click', close);
      handlersWired = !!(closeBtn && overlay);
    }
  }

  // ─── Public: open / close / isOpen ───

  async function open(alertId, opts) {
    mount();
    callbacks = opts || {};
    currentAlertId = alertId;

    try {
      // Phase 9a (May 2, 2026): pass the operator's current UI language so
      // the server can pick the matching ai_analysis_<lang> column. Older
      // alert rows (pre-cutover) have NULL fr/es columns and the server
      // falls back to English automatically.
      const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
      const alert = await Panoptica.api(`/api/alerts/${alertId}?lang=${encodeURIComponent(lang)}`);
      renderDetail(alert);
      document.getElementById('alert-overlay').classList.add('active');
      document.getElementById('alert-slideout').classList.add('active');
    } catch (e) {
      Panoptica.showToast(window.t('alerts.toast.load_failed'), 'error');
      currentAlertId = null;
    }
  }

  function close() {
    const overlay = document.getElementById('alert-overlay');
    const slideout = document.getElementById('alert-slideout');
    if (overlay) overlay.classList.remove('active');
    if (slideout) slideout.classList.remove('active');
    const wasOpen = currentAlertId !== null;
    currentAlertId = null;
    quillNotes = null;
    if (wasOpen && typeof callbacks.onClose === 'function') {
      try { callbacks.onClose(); } catch (_) {}
    }
    callbacks = {};
  }

  function isOpen() {
    return currentAlertId !== null;
  }

  // ─── Render ───

  function renderDetail(alert) {
    // AI severity adjustment badge — only shown when Haiku downgraded severity.
    // rule_severity preserves the rule verdict; severity holds the current (AI-
    // adjusted) value. When they differ, show an inline note + restore button.
    const aiAdjusted = alert.rule_severity && alert.rule_severity !== alert.severity;
    const adjustedBadgeHtml = aiAdjusted
      ? `<span class="alert-ai-adjusted-badge"
             title="${esc(alert.ai_severity_reason || window.t('alerts.severity_adjust.ai_adjusted_title'))}"
             style="font-family:Inter,sans-serif;font-size:0.75rem;color:var(--p-text-muted);background:var(--p-surface-2);border:1px dashed var(--p-border);border-radius:4px;padding:2px 8px;">
           ${window.t('alerts.severity_adjust.ai_adjusted_from', { severity: window.t('alerts.' + alert.rule_severity).toUpperCase() })}
         </span>
         <button id="alert-restore-severity" class="alert-filter-select" data-role-required="member"
             style="font-family:Inter,sans-serif;font-size:0.75rem;padding:4px 10px;cursor:pointer;"
             title="${esc(window.t('alerts.severity_adjust.restore_btn_title'))}">
           ${esc(window.t('alerts.severity_adjust.restore_btn'))}
         </button>`
      : '';

    // Apr 30, 2026 — "Create exemption" button. Operator-defined alert
    // exemption rules suppress future matching alerts via auto-resolve.
    // See src/db/migrate-alert-exemption-rules.sql.
    //
    // Show button only when:
    //   - The alert is not already resolved (status 'new' or 'investigating')
    //   - The alert hasn't been auto-resolved by an existing rule
    //   - We can extract a usable signal (UPN) from raw_data
    //   - The alert category is one we support (start narrow with
    //     risky_signins; broaden later as we add more matchers)
    const exemptionSignal = extractAlertSignal(alert);
    const isResolvedAlready = alert.status === 'resolved' || alert.status === 'false_positive';
    const wasAutoResolved = alert.resolution_reason === 'exemption_rule';
    const policySupportsExemption = alert.category === 'risky_signins';
    const canCreateExemption = !isResolvedAlready
      && !wasAutoResolved
      && policySupportsExemption
      && !!(exemptionSignal && exemptionSignal.upn);
    // Phase 9 fix (May 2, 2026): rendered via window.t() inline rather than
    // data-i18n attributes — the slideout sets innerHTML then never calls
    // PanopticaI18n.applyTo() to walk attributes, so the previous data-i18n
    // approach left these strings stuck in English.
    const createExemptionBtnHtml = canCreateExemption
      ? `<button id="alert-create-exemption" class="alert-filter-select" data-role-required="member"
             style="font-family:Inter,sans-serif;font-size:0.75rem;padding:4px 10px;cursor:pointer;"
             title="${esc(window.t('alert_exemption.btn_title'))}">
           ${esc(window.t('alert_exemption.btn_label'))}
         </button>`
      : '';

    // Jun 26-27, 2026 (#7/#23) — "Create exception" for noisy Microsoft-already-
    // handled alerts, scoped to this tenant or fleet-wide. Two kinds, one button:
    //   - 'policy'        : EOP email-threat alerts (Inbound spam/malware/phish
    //                       blocked). Each class is its OWN policy, so exempting
    //                       the whole policy = "this category entirely" and is
    //                       safe — outbound spam / malware are different policies.
    //   - 'defender_type' : the generic Defender XDR evaluator, where ONE policy
    //                       carries mixed alert types, so we exempt by the alert
    //                       TYPE string instead (outbound is a different type).
    // The email-threat path is what Microfix's "Inbound spam blocked" alerts hit
    // (they carry no defender_alert_type — that's why the button was missing).
    const defenderAlertType = extractDefenderAlertType(alert);
    const isEmailThreat = isEmailThreatAlert(alert);
    let exceptionKind = null;
    if (defenderAlertType) exceptionKind = 'defender_type';
    else if (isEmailThreat) exceptionKind = 'policy';
    const canCreateException = !isResolvedAlready && !wasAutoResolved && !!exceptionKind;
    const createDefenderExceptionBtnHtml = canCreateException
      ? `<button id="alert-create-defender-exception" class="alert-filter-select" data-role-required="member"
             data-exception-kind="${esc(exceptionKind)}"
             style="font-family:Inter,sans-serif;font-size:0.75rem;padding:4px 10px;cursor:pointer;"
             title="${esc(window.t('defender_exception.btn_title'))}">
           ${esc(window.t('defender_exception.btn_label'))}
         </button>`
      : '';

    // Identity-timeline chip (May 30, 2026) — read-only triage pivot to the
    // identity timeline drawer. Shown for ANY alert that resolves a UPN,
    // regardless of category/status (unlike the exemption button, which is a
    // write action gated to risky_signins). One chip per distinct UPN; the
    // common case is exactly one. When multiple, append the UPN to the label
    // so the operator can tell them apart. data-i18n carries the base label
    // (translated via PanopticaI18n.applyTo if available) on the single case.
    const timelineUpns = extractAlertUpns(alert);
    const identityTimelineBtnHtml = timelineUpns.length > 0
      ? timelineUpns.map(upn => {
          const baseLabel = esc(window.t('alerts.identity_timeline.open'));
          const label = timelineUpns.length > 1
            ? `${baseLabel} — ${esc(upn)}`
            : baseLabel;
          const i18nAttr = timelineUpns.length > 1
            ? ''
            : ' data-i18n="alerts.identity_timeline.open"';
          // Accent-filled + leading icon so this read-only triage pivot stands
          // out from the neutral status/exemption controls beside it.
          return `<button class="alert-identity-timeline-btn" data-upn="${esc(upn)}" data-tenant-id="${esc(String(alert.tenant_id))}" data-alert-id="${esc(String(alert.id))}"${i18nAttr} style="display:inline-flex;align-items:center;gap:6px;font-family:Inter,sans-serif;font-size:0.75rem;font-weight:600;padding:5px 12px;cursor:pointer;color:#fff;background:var(--p-accent,#2563eb);border:1px solid var(--p-accent,#2563eb);border-radius:6px;box-shadow:0 1px 3px rgba(37,99,235,0.3);"><span aria-hidden="true">🔍</span>${label}</button>`;
        }).join('')
      : '';

    // Auto-resolved provenance pill — when an alert was auto-resolved by an
    // active exemption rule, surface that fact in the header so operators
    // know why the row is in 'resolved' state without manual action.
    const autoResolvedPillHtml = wasAutoResolved
      ? `<span class="alert-auto-resolved-pill"
             title="${esc(window.t('alert_exemption.auto_resolved_tooltip', { ruleId: alert.resolution_rule_id || '?' }))}"
             style="font-family:Inter,sans-serif;font-size:0.75rem;color:var(--p-text-muted);background:var(--p-surface-2);border:1px solid var(--p-border-subtle);border-radius:4px;padding:2px 8px;">
           ${esc(window.t('alert_exemption.auto_resolved_pill'))}${alert.resolution_rule_id ? ` #${alert.resolution_rule_id}` : ''}
         </span>`
      : '';

    el('alert-detail-header').innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
        <span class="alert-severity-badge sev-${alert.severity}" style="font-size:0.9rem;">${esc(window.t('alerts.' + alert.severity).toUpperCase())}</span>
        <select id="alert-detail-status" class="alert-filter-select" data-role-required="member" style="width:auto;">
          ${['new','investigating','resolved','false_positive'].map(s =>
            `<option value="${s}" ${s === alert.status ? 'selected' : ''}>${esc(window.t('alerts.status_label.' + s))}</option>`
          ).join('')}
        </select>
        ${adjustedBadgeHtml}
        ${autoResolvedPillHtml}
        ${createExemptionBtnHtml}
        ${createDefenderExceptionBtnHtml}
        ${identityTimelineBtnHtml}
        <span id="alert-psa-chip"></span>
      </div>
      <div style="font-family:Inter,sans-serif;font-size:1.3rem;color:var(--p-text);margin-bottom:4px;">${esc(renderAlertMessage(alert))}</div>
      <div style="font-family:Inter,sans-serif;font-size:0.85rem;color:var(--p-text-muted);">
        ${alert.alert_scope === 'msp' ? esc(window.t('alerts.msp_wide_scope')) : esc(alert.tenant_name)} &bull; ${formatTime(alert.triggered_at)}
        ${alert.recurrence_count > 1 ? ` &bull; ${esc(window.t('alerts.header.detected_n_times', { count: alert.recurrence_count }))}` : ''}
      </div>
      ${aiAdjusted && alert.ai_severity_reason
        ? `<div style="font-family:Inter,sans-serif;font-size:0.8rem;color:var(--p-text-muted);margin-top:6px;font-style:italic;">
             ${esc(window.t('alerts.severity_adjust.ai_reason_label'))} ${esc(alert.ai_severity_reason)}
           </div>`
        : ''}
    `;

    // PSA ticket chip (Feature 8.3) — populated async; no-op when PSA is off or
    // the alert has no linked ticket. Also drives the resolve modal below.
    let priorStatus = alert.status;
    (async () => {
      try {
        const link = await Panoptica.api(`/api/alerts/${alert.id}/psa-link`);
        const chip = el('alert-psa-chip');
        if (chip && link && link.linked) {
          const stateLabel = link.state === 'closed'
            ? window.t('psa.chip.closed') : window.t('psa.chip.open');
          const color = link.state === 'closed' ? 'var(--p-text-muted)' : '#4488ff';
          const label = (link.ticket_number || ('#' + link.ticket_id));
          const inner = `🎫 ${esc(label)} · ${esc(stateLabel)}`;
          chip.innerHTML = link.web_url
            ? `<a href="${esc(link.web_url)}" target="_blank" rel="noopener" title="${esc(window.t('psa.chip.view_in_autotask'))}"
                  style="border:1px solid ${color};color:${color};border-radius:12px;padding:2px 10px;font-size:0.75rem;text-decoration:none;">${inner}</a>`
            : `<span style="border:1px solid ${color};color:${color};border-radius:12px;padding:2px 10px;font-size:0.75rem;">${inner}</span>`;
        }
      } catch (_) { /* PSA off / lookup failed — no chip */ }
    })();

    // Status change handler
    setTimeout(() => {
      const statusSelect = el('alert-detail-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', async () => {
          const newStatus = statusSelect.value;
          try {
            // Resolve modal (decision 5): if resolving an alert with an open
            // linked ticket, ask whether to also close the ticket.
            let closeTicket = false;
            if (newStatus === 'resolved' || newStatus === 'false_positive') {
              const choice = await Panoptica.PsaResolveModal.maybeConfirm({ alertIds: [alert.id] });
              if (!choice.proceed) {
                statusSelect.value = priorStatus; // operator cancelled — revert
                return;
              }
              closeTicket = choice.closeTicket;
            }
            await Panoptica.api(`/api/alerts/${alert.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: newStatus, closeTicket }),
            });
            priorStatus = newStatus;
            Panoptica.showToast(window.t('alerts.toast.status_changed', { status: newStatus }), 'success');
            // Refresh global badges (bell, sidebar, status bar) so the count
            // reflects the new open-alert total immediately rather than on
            // the next 60s poll.
            Panoptica.refreshAlertSignals?.();
            if (typeof callbacks.onStatusChanged === 'function') {
              try { callbacks.onStatusChanged(newStatus); } catch (_) {}
            }
          } catch (e) {
            Panoptica.showToast(window.t('alerts.toast.status_update_failed'), 'error');
          }
        });
      }

      // Create exemption handler — opens the modal pre-filled from the alert.
      const createExBtn = el('alert-create-exemption');
      if (createExBtn) {
        createExBtn.addEventListener('click', () => {
          openCreateExemptionModal(alert);
        });
      }

      // Create exception handler (#7/#23) — policy-level (email threats) or
      // alert-type (generic Defender XDR), per the button's data-exception-kind.
      const createDefExBtn = el('alert-create-defender-exception');
      if (createDefExBtn) {
        createDefExBtn.addEventListener('click', () => {
          openCreateDefenderExceptionModal(alert, createDefExBtn.dataset.exceptionKind || 'defender_type');
        });
      }

      // Identity-timeline chip handler(s) — open the read-only timeline drawer
      // for the chip's UPN. Strings from data attributes are fine; the drawer
      // / API coerce them.
      const header = el('alert-detail-header');
      if (header) {
        header.querySelectorAll('.alert-identity-timeline-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            if (window.Panoptica && window.Panoptica.IdentityTimeline) {
              window.Panoptica.IdentityTimeline.open({
                tenantId: btn.dataset.tenantId,
                upn: btn.dataset.upn,
                anchorAlertId: btn.dataset.alertId,
              });
            }
          });
        });
      }

      // Restore rule severity handler — reverts AI adjustment.
      // Re-fetches the alert and re-renders so the badge disappears and the
      // severity chip updates without requiring a full page reload.
      const restoreBtn = el('alert-restore-severity');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
          try {
            const resp = await Panoptica.api(`/api/alerts/${alert.id}/revert-ai-severity`, {
              method: 'POST',
            });
            if (resp?.reverted) {
              Panoptica.showToast(window.t('alerts.toast.severity_restored', { severity: resp.severity }), 'success');
            } else {
              Panoptica.showToast(window.t('alerts.toast.nothing_to_restore'), 'info');
            }
            const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
            const fresh = await Panoptica.api(`/api/alerts/${alert.id}?lang=${encodeURIComponent(lang)}`);
            renderDetail(fresh);
            Panoptica.refreshAlertSignals?.();
            if (typeof callbacks.onStatusChanged === 'function') {
              try { callbacks.onStatusChanged(fresh.status); } catch (_) {}
            }
          } catch (e) {
            Panoptica.showToast(window.t('alerts.toast.severity_restore_failed'), 'error');
          }
        });
      }
    }, 0);

    // Body: details + AI/roll-up + raw/drift + notes + timeline
    //
    // Alert Merge (2026-06-05): a roll-up parent renders the merged child list
    // in place of AI analysis (it has no Haiku output), and we suppress the
    // raw-data JSON dump (the child list already shows the meaningful content).
    const rollupRaw = (alert.raw_data && typeof alert.raw_data === 'object') ? alert.raw_data : {};
    const isRollup = !!alert.is_rollup || rollupRaw.rollup === true;

    let rawDataHtml = '';
    if (alert.raw_data && !isRollup) {
      // Phase 9b: if this is an Intune drift alert, render the structured drift
      // list instead of dumping raw JSON. Falls back to JSON for everything else.
      let parsed = null;
      try {
        parsed = typeof alert.raw_data === 'string' ? JSON.parse(alert.raw_data) : alert.raw_data;
      } catch (_) { parsed = null; }

      if (parsed && Array.isArray(parsed.drifts) && parsed.drifts.length > 0) {
        const unsetLabel = window.t('alerts.drift.unset_value');
        const expectedLabel = window.t('alerts.drift.expected_label');
        const actualLabel = window.t('alerts.drift.actual_label');
        const modifiedLabel = window.t('alerts.drift.change_modified');
        const rows = parsed.drifts.map(d => {
          const path = esc(d.path || d.field || '');
          const change = esc(d.change || modifiedLabel);
          const changeClass = d.change === 'added' ? 'drift-change-added'
            : d.change === 'removed' ? 'drift-change-removed'
            : 'drift-change-modified';
          let detail = '';
          if (Array.isArray(d.added) && d.added.length) {
            detail += `<div class="drift-detail-add">+ ${d.added.map(v => esc(String(v))).join('<br>+ ')}</div>`;
          }
          if (Array.isArray(d.removed) && d.removed.length) {
            detail += `<div class="drift-detail-rem">− ${d.removed.map(v => esc(String(v))).join('<br>− ')}</div>`;
          }
          if (!detail) {
            const exp = esc(String(d.expected ?? unsetLabel));
            const act = esc(String(d.actual ?? unsetLabel));
            detail = `<div class="drift-detail-cmp"><span class="drift-cmp-exp">${esc(expectedLabel)}</span> ${exp}<br><span class="drift-cmp-act">${esc(actualLabel)}</span> ${act}</div>`;
          }
          return `
            <tr>
              <td class="drift-row-path">${path}</td>
              <td class="drift-row-change"><span class="drift-change-badge ${changeClass}">${change}</span></td>
              <td class="drift-row-detail">${detail}</td>
            </tr>`;
        }).join('');
        const templateName = parsed.template_name ? `<div style="margin-bottom:8px;color:var(--p-text-secondary);font-size:0.85rem;">${esc(window.t('alerts.drift.template_label'))} <strong>${esc(parsed.template_name)}</strong></div>` : '';
        rawDataHtml = `
          <div class="alert-detail-section">
            <div class="alert-detail-label">${esc(window.t('alerts.section.drift_details', { count: parsed.drifts.length }))}</div>
            ${templateName}
            <table class="drift-detail-table">
              <thead><tr><th>${esc(window.t('alerts.drift.col_setting'))}</th><th>${esc(window.t('alerts.drift.col_change'))}</th><th>${esc(window.t('alerts.drift.col_detail'))}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      } else {
        const raw = typeof alert.raw_data === 'string' ? alert.raw_data : JSON.stringify(alert.raw_data, null, 2);
        rawDataHtml = `
          <div class="alert-detail-section">
            <div class="alert-detail-label">${esc(window.t('alerts.section.raw_data'))}</div>
            <pre class="alert-detail-raw">${esc(raw).substring(0, 2000)}</pre>
          </div>`;
      }
    }

    let aiHtml = '';
    if (alert.ai_analysis) {
      aiHtml = `
        <div class="alert-detail-section">
          <div class="alert-detail-label">${esc(window.t('alerts.section.ai_analysis'))} <span style="color:var(--p-text-muted);font-size:0.7rem;">${esc(window.t('alerts.section.ai_analysis_provider'))}</span></div>
          <div class="alert-detail-ai">${esc(alert.ai_analysis).replace(/\n/g, '<br>')}</div>
        </div>`;
    }

    // Roll-up parent: merged child list (replaces the AI section). Each row is
    // a clickable severity chip + title that opens the original alert.
    let rollupChildrenHtml = '';
    if (isRollup) {
      const children = Array.isArray(rollupRaw.children) ? rollupRaw.children : [];
      const rows = children.map(c => `
        <div class="alert-rollup-child" data-child-id="${esc(String(c.id))}" role="button" tabindex="0">
          <span class="alert-severity-badge sev-${esc(c.severity || 'info')}" style="font-size:0.72rem;">${esc(window.t('alerts.' + (c.severity || 'info')).toUpperCase())}</span>
          <span class="alert-rollup-child-title">${esc(c.message || ('#' + c.id))}</span>
        </div>`).join('');
      rollupChildrenHtml = `
        <div class="alert-detail-section">
          <div class="alert-detail-label">${esc(window.t('alerts.rollup_children_header', { count: children.length }))}</div>
          <div class="alert-rollup-no-ai">${esc(window.t('alerts.rollup_no_ai'))}</div>
          ${rows}
        </div>`;
    }

    // Child of a roll-up: "Rolled up into → <parent title>" banner, parent
    // title a clickable link back to the parent. We render the localized
    // sentence escaped, then splice in the (separately escaped) link so the
    // surrounding copy stays injection-safe regardless of locale.
    let rolledUpBannerHtml = '';
    if (alert.rollup_parent_id) {
      const parentTitle = alert.rollup_parent_message || ('#' + alert.rollup_parent_id);
      const linkHtml = `<a href="#" id="alert-rollup-parent-link" data-parent-id="${esc(String(alert.rollup_parent_id))}">${esc(parentTitle)}</a>`;
      const sentence = window.t('alerts.rolled_up_into', { title: '%%TITLE%%' });
      const inner = esc(sentence).replace('%%TITLE%%', linkHtml);
      rolledUpBannerHtml = `<div class="alert-detail-section alert-rolled-up-banner">${inner}</div>`;
    }

    let timelineHtml = '';
    if (alert.recurrence_count > 1 && alert.last_seen_at) {
      timelineHtml = `
        <div class="alert-detail-section">
          <div class="alert-detail-label">${esc(window.t('alerts.section.timeline'))}</div>
          <div style="font-family:Inter,sans-serif;color:var(--p-text-secondary);font-size:0.9rem;">
            ${esc(window.t('alerts.timeline.first_detected'))} ${formatTime(alert.triggered_at)}<br>
            ${esc(window.t('alerts.timeline.last_seen'))} ${formatTime(alert.last_seen_at)}<br>
            ${esc(window.t('alerts.timeline.total_detections'))} ${alert.recurrence_count}
          </div>
        </div>`;
    }

    // Attribution block — present only when the 60-min surface-match
    // attributor linked this alert to a Panoptica-initiated change event.
    // Server populates auto_attributed_change_id at alert-create time; UI
    // surfaces it here so operators understand "this drift was expected".
    let attributionHtml = '';
    if (alert.auto_attributed_change_id) {
      const desc = alert.attributed_change_description || window.t('alerts.attribution.no_description');
      const actor = alert.attributed_change_actor || window.t('alerts.attribution.system_actor');
      const when = alert.attributed_change_started_at ? formatTime(alert.attributed_change_started_at) : '—';
      attributionHtml = `
        <div class="alert-detail-section alert-detail-attribution">
          <div class="alert-detail-label">
            <span class="alert-attribution-chip" style="background:var(--p-info-bg,rgba(80,140,180,0.12));border-color:var(--p-info,rgba(80,140,180,0.5));">
              ${esc(window.t('alerts.attribution.chip_label'))}
            </span>
            ${esc(window.t('alerts.section.linked_operator_change'))}
          </div>
          <table class="alert-detail-table">
            <tr><td>${esc(window.t('alerts.attribution.description'))}</td><td>${esc(desc)}</td></tr>
            <tr><td>${esc(window.t('alerts.attribution.actor'))}</td><td>${esc(actor)}</td></tr>
            <tr><td>${esc(window.t('alerts.attribution.when'))}</td><td>${when}</td></tr>
            <tr><td>${esc(window.t('alerts.attribution.change_id'))}</td><td>#${alert.auto_attributed_change_id}</td></tr>
          </table>
          <button id="alert-view-change-${alert.id}" class="alert-attribution-view-btn"
                  data-tenant-id="${alert.tenant_id}" data-change-id="${alert.auto_attributed_change_id}">
            ${esc(window.t('alerts.attribution.view_change_btn'))}
          </button>
        </div>`;
    }

    // Build the policy-name cell with the inline ⓘ explainer trigger so an
    // operator can pull up "what is this alert / why does it matter / what
    // do I do" right from the slideout, without bouncing to the Alert
    // Policies admin page. The icon is wired below the innerHTML assignment.
    const policyDisplay = alert.policy_name
      ? window.PanopticaI18n.tOrFallback('alert_policy_names.' + window.PanopticaI18n.slugify(alert.policy_name), alert.policy_name)
      : '—';
    const explainerIcon = (alert.policy_name && window.Panoptica && window.Panoptica.AlertExplainer)
      ? window.Panoptica.AlertExplainer.iconHtml({ policyName: alert.policy_name })
      : '';

    // Feature 8.8 — MSP-level (Message Center) alerts render an "Affected
    // tenants" list instead of attributing the alert to the source tenant.
    const isMspScope = alert.alert_scope === 'msp';
    const rawForDetail = (alert.raw_data && typeof alert.raw_data === 'object') ? alert.raw_data : {};
    const mspAffectedNames = Array.isArray(rawForDetail.affectedTenantNames) ? rawForDetail.affectedTenantNames : [];
    const mspLearnMoreUrl = rawForDetail.ms_web_url || rawForDetail.learn_more_url || null;

    // Feature 2 (2026-06-11) — make the single (tenant-scoped) tenant name a
    // link straight to that tenant's dashboard, so the operator doesn't have
    // to close → main console → scroll → click. MSP-scoped alerts span many
    // tenants (no single target), so that branch stays plain text. Guard on a
    // working SPA navigator + a tenant id; otherwise fall back to plain text.
    const canLinkTenant = !isMspScope && alert.tenant_id != null &&
      window.Panoptica && typeof window.Panoptica.navigateTo === 'function';
    const tenantCellHtml = canLinkTenant
      ? `<a href="#" id="alert-tenant-link-${alert.id}" data-tenant-id="${esc(String(alert.tenant_id))}" title="${esc(window.t('alerts.details.open_tenant_dashboard'))}" style="color:var(--p-accent);">${esc(alert.tenant_name)}</a>`
      : esc(alert.tenant_name);
    const tenantRowHtml = isMspScope
      ? `<tr><td>${esc(window.t('alerts.details.affected_tenants'))}</td><td>${mspAffectedNames.length ? esc(mspAffectedNames.join(', ')) : '—'}</td></tr>`
      : `<tr><td>${esc(window.t('alerts.details.tenant'))}</td><td>${tenantCellHtml}</td></tr>`;
    const mspLearnMoreRowHtml = (isMspScope && mspLearnMoreUrl)
      ? `<tr><td>${esc(window.t('alerts.details.learn_more'))}</td><td><a href="${esc(mspLearnMoreUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--p-accent);">${esc(window.t('alerts.details.learn_more_link'))}</a></td></tr>`
      : '';

    // Feature 1 (2026-06-11) — Defender-incident alerts carry an
    // incident_web_url in raw_data (a security.microsoft.com/incident2/<n>/…
    // link). Surface it as a clickable row so operators don't copy it out of
    // the raw JSON. Read is narrowed to incident_web_url so non-Defender (and
    // older) alerts render no row. Opening it needs a GDAP-elevated Microsoft
    // session, hence the muted note that pre-empts "why did this 404 for me".
    const defenderUrl = rawForDetail.incident_web_url || null;
    const defenderRowHtml = defenderUrl
      ? `<tr><td>${esc(window.t('alerts.details.learn_more'))}</td><td>` +
          `<a href="${esc(defenderUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--p-accent);">${esc(window.t('alerts.details.open_in_defender'))} ↗</a>` +
          `<div style="color:var(--p-text-muted);font-size:0.8rem;margin-top:2px;">${esc(window.t('alerts.details.gdap_required_note'))}</div>` +
        `</td></tr>`
      : '';

    el('alert-slideout-body').innerHTML = `
      ${rolledUpBannerHtml}
      <div class="alert-detail-section">
        <div class="alert-detail-label">${esc(window.t('alerts.section.details'))}</div>
        <table class="alert-detail-table">
          <tr><td>${esc(window.t('alerts.details.category'))}</td><td>${formatCategory(alert.category)}</td></tr>
          <tr><td>${esc(window.t('alerts.details.policy'))}</td><td><span style="display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;">${esc(policyDisplay)}${explainerIcon}</span></td></tr>
          ${tenantRowHtml}
          ${mspLearnMoreRowHtml}
          <tr><td>${esc(window.t('alerts.details.alert_id'))}</td><td>#${alert.id}</td></tr>
          <tr><td>${esc(window.t('alerts.details.email_sent'))}</td><td>${alert.email_sent ? esc(window.t('alerts.common.yes')) : esc(window.t('alerts.common.no'))}</td></tr>
          ${defenderRowHtml}
        </table>
      </div>
      ${attributionHtml}
      ${aiHtml}
      ${rollupChildrenHtml}
      ${rawDataHtml}
      <div class="alert-detail-section">
        <div class="alert-detail-label">${esc(window.t('alerts.section.notes'))}</div>
        <div id="alert-quill-editor"></div>
        <button class="alert-notes-save" id="alert-notes-save" data-role-required="member">${esc(window.t('alerts.notes_panel.save_btn'))}</button>
      </div>
      ${timelineHtml}
    `;

    // Init Quill editor for notes
    setTimeout(() => { initQuillNotes(alert); }, 50);

    // Wire the explainer trigger in the Policy row + render its Lucide icon.
    // Scoped to the slideout body so we don't accidentally re-bind icons that
    // live elsewhere on the page (e.g., on the Alert Policies admin view,
    // which wires its own). refreshIcons() converts the <i data-lucide>
    // placeholder into an SVG; without this call the icon stays invisible.
    setTimeout(() => {
      const body = document.getElementById('alert-slideout-body');
      if (!body) return;
      if (window.Panoptica && typeof window.Panoptica.refreshIcons === 'function') {
        window.Panoptica.refreshIcons(body);
      }
      body.querySelectorAll('.ax-icon-btn[data-ax-policy]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const name = btn.getAttribute('data-ax-policy');
          if (name && window.Panoptica && window.Panoptica.AlertExplainer) {
            window.Panoptica.AlertExplainer.open(name);
          }
        });
      });
    }, 0);

    // Roll-up cross-links (Alert Merge, 2026-06-05). Parent → child rows and
    // child → parent banner both just re-open the slideout on the target id,
    // preserving the current callbacks so the page table still refreshes on
    // any later status change.
    setTimeout(() => {
      const body = document.getElementById('alert-slideout-body');
      if (!body) return;
      body.querySelectorAll('.alert-rollup-child[data-child-id]').forEach(row => {
        const go = () => {
          const childId = parseInt(row.getAttribute('data-child-id'), 10);
          if (childId) open(childId, callbacks);
        };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
      });
      const parentLink = document.getElementById('alert-rollup-parent-link');
      if (parentLink) {
        parentLink.addEventListener('click', (e) => {
          e.preventDefault();
          const parentId = parseInt(parentLink.getAttribute('data-parent-id'), 10);
          if (parentId) open(parentId, callbacks);
        });
      }
    }, 0);

    // Wire the attribution "view change" button — closes the slideout,
    // then navigates to the tenant dashboard with the change pre-opened.
    if (alert.auto_attributed_change_id) {
      setTimeout(() => {
        const btn = el(`alert-view-change-${alert.id}`);
        if (btn && window.Panoptica && typeof window.Panoptica.navigateTo === 'function') {
          btn.addEventListener('click', () => {
            const tenantId = btn.dataset.tenantId;
            const changeId = btn.dataset.changeId;
            close();
            // tenant-dashboard reads params.id (legacy name); change_id is new (Apr 28).
            window.Panoptica.navigateTo('tenant-dashboard', { id: tenantId, change_id: changeId });
          });
        }
      }, 0);
    }

    // Feature 2 (2026-06-11) — wire the tenant-name link: close the slideout,
    // then navigate to that tenant's dashboard. Mirrors the attribution
    // "view change" button wiring above (close → navigateTo with params.id).
    if (canLinkTenant) {
      setTimeout(() => {
        const link = el(`alert-tenant-link-${alert.id}`);
        if (link) {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const tid = link.dataset.tenantId;
            close();
            window.Panoptica.navigateTo('tenant-dashboard', { id: tid });
          });
        }
      }, 0);
    }
  }

  function initQuillNotes(alert) {
    const container = el('alert-quill-editor');
    if (!container || typeof Quill === 'undefined') return;

    quillNotes = new Quill(container, {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['clean'],
        ],
      },
      placeholder: window.t('alerts.notes_panel.placeholder'),
    });

    // Load existing notes
    if (alert.notes) {
      quillNotes.root.innerHTML = alert.notes;
    }

    // Save button
    const saveBtn = el('alert-notes-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const html = quillNotes.root.innerHTML;
        try {
          await Panoptica.api(`/api/alerts/${alert.id}/notes`, {
            method: 'PATCH',
            body: JSON.stringify({ notes: html === '<p><br></p>' ? null : html }),
          });
          Panoptica.showToast(window.t('alerts.toast.notes_saved'), 'success');
        } catch (e) {
          Panoptica.showToast(window.t('alerts.toast.notes_save_failed'), 'error');
        }
      });
    }
  }

  // ─── Create-exemption modal (Apr 30, 2026) ───
  //
  // Operator-defined alert exemption rules. See:
  //   src/lib/alert-exemption-matcher.js
  //   src/routes/api-alert-exemptions.js
  //   src/db/migrate-alert-exemption-rules.sql
  //
  // The modal layers on top of the existing slideout overlay. When the
  // operator submits, we POST to /api/alert-exemptions with source_alert_id
  // so the current alert is auto-resolved server-side; then we refresh the
  // slideout view and notify the parent of the status change.

  function extractAlertSignal(alert) {
    if (!alert || !alert.raw_data) return { upn: null, country: null, ip: null };
    let raw = alert.raw_data;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { return { upn: null, country: null, ip: null }; }
    }
    const upn = raw.userPrincipalName || raw.upn || raw.user
      || (raw.signIn && raw.signIn.userPrincipalName) || null;
    const country = (raw.location && raw.location.countryOrRegion)
      || raw.countryOrRegion || raw.country || null;
    const ip = raw.ipAddress || raw.ip
      || (raw.signIn && raw.signIn.ipAddress) || null;
    return {
      upn: upn ? String(upn).toLowerCase() : null,
      country: country ? String(country).toUpperCase() : null,
      ip: ip ? String(ip) : null,
    };
  }

  // Identity-timeline (May 30, 2026) — collect every distinct UPN an alert
  // references so the operator can pivot to the read-only identity timeline
  // drawer. Unlike extractAlertSignal (single signal for exemption matching)
  // this returns an array: Defender "security alert" rows can implicate
  // multiple accounts via raw.accounts. Mirrors extractAlertSignal's parse
  // of raw_data when it arrives as a JSON string.
  function extractAlertUpns(alert) {
    if (!alert || !alert.raw_data) return [];
    let raw = alert.raw_data;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { return []; }
    }
    const upns = [];
    if (Array.isArray(raw.accounts)) {
      for (const a of raw.accounts) {
        if (a && typeof a === 'string' && a.includes('@')) {
          upns.push(a.toLowerCase());
        }
      }
    }
    let single = raw.userPrincipalName || raw.upn;
    if (!single && raw.user) {
      single = (typeof raw.user === 'object') ? raw.user.upn : raw.user;
    }
    if (!single && raw.signIn && raw.signIn.userPrincipalName) {
      single = raw.signIn.userPrincipalName;
    }
    if (single) upns.push(String(single).toLowerCase());
    // Dedupe, preserving order.
    return Array.from(new Set(upns));
  }

  // #7/#23 — pull the Microsoft Defender alert type/name out of raw_data. This
  // is the key a Defender exception rule matches on. Mirrors extractAlertSignal's
  // tolerance of raw_data arriving as a JSON string.
  function extractDefenderAlertType(alert) {
    if (!alert || !alert.raw_data) return null;
    let raw = alert.raw_data;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { return null; }
    }
    const t = raw.defender_alert_type;
    return (t && typeof t === 'string' && t.trim()) ? t.trim() : null;
  }

  // #7/#23 — is this an EOP email-threat alert (Inbound spam/malware/phish
  // blocked, etc.)? These come from per-class policies, so the exception is
  // created at the POLICY level ("this category entirely"). Detected by the
  // email-threat raw_data shape (emailDirection / threatTypes / deliveryAction).
  function isEmailThreatAlert(alert) {
    if (!alert || !alert.raw_data) return false;
    let raw = alert.raw_data;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { return false; }
    }
    return !!(raw.emailDirection || raw.threatTypes || raw.deliveryAction);
  }

  function t(key, fallback) {
    // Helper — fall back to English literal if i18n hasn't loaded the key yet
    if (window.Panoptica && typeof window.Panoptica.t === 'function') {
      const v = window.Panoptica.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function openCreateExemptionModal(alert) {
    const signal = extractAlertSignal(alert);
    if (!signal.upn) {
      Panoptica.showToast(t('alert_exemption.toast_missing_upn',
        'Cannot create exemption — no user principal name in alert data'), 'error');
      return;
    }

    // Tear down any existing modal (defensive)
    closeCreateExemptionModal();

    const overlay = document.createElement('div');
    overlay.id = 'alert-exemption-overlay';
    overlay.className = 'alert-exemption-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.55)', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const modal = document.createElement('div');
    modal.id = 'alert-exemption-modal';
    modal.className = 'alert-exemption-modal';
    Object.assign(modal.style, {
      background: 'var(--p-surface)', color: 'var(--p-text)',
      border: '1px solid var(--p-border)',
      borderRadius: '6px',
      width: 'min(560px, 92vw)',
      maxHeight: '88vh', overflowY: 'auto',
      padding: '20px 22px',
      fontFamily: 'Inter, sans-serif',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    });

    const country = signal.country || '';
    const tenantName = alert.tenant_name || '';
    // Phase 9 fix (May 2, 2026): translate the policy name via the slug-keyed
    // lookup that the slideout's main view also uses. Without this the modal
    // showed "Account lockouts" in English while the slideout showed
    // "Verrouillages de compte" — same data, two different code paths.
    const policyNameRaw = alert.policy_name || '';
    const policyName = policyNameRaw && window.PanopticaI18n
      ? window.PanopticaI18n.tOrFallback('alert_policy_names.' + window.PanopticaI18n.slugify(policyNameRaw), policyNameRaw)
      : policyNameRaw;

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
        <div>
          <h3 style="margin:0 0 4px 0;font-size:1.1rem;color:var(--p-text);">
            <span data-i18n="alert_exemption.modal_title">Create alert exemption</span>
          </h3>
          <div style="font-size:0.82rem;color:var(--p-text-muted);">
            <span data-i18n="alert_exemption.modal_subtitle">Auto-resolve future alerts matching this pattern</span>
          </div>
        </div>
        <button id="aex-close" type="button"
                style="background:transparent;border:none;color:var(--p-text-muted);font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>
      </div>

      <table class="alert-detail-table" style="width:100%;margin-bottom:14px;font-size:0.85rem;">
        <tr><td style="opacity:0.7;width:120px;" data-i18n="alert_exemption.field_tenant">Tenant</td><td>${esc(tenantName)}</td></tr>
        <tr><td style="opacity:0.7;" data-i18n="alert_exemption.field_policy">Policy</td><td>${esc(policyName)}</td></tr>
        <tr><td style="opacity:0.7;" data-i18n="alert_exemption.field_user">User</td><td><code>${esc(signal.upn)}</code></td></tr>
      </table>

      <div style="margin-bottom:14px;">
        <div style="font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;">
          <span data-i18n="alert_exemption.label_country">Country scope</span>
        </div>
        <div class="aex-pill-group" style="display:flex;gap:6px;flex-wrap:wrap;">
          ${country
            ? `<label class="aex-pill"><input type="radio" name="aex-country-mode" value="match" checked>
                  <span><span data-i18n="alert_exemption.country_match">Only this country</span> (${esc(country)})</span>
               </label>`
            : ''}
          <label class="aex-pill"><input type="radio" name="aex-country-mode" value="any" ${!country ? 'checked' : ''}>
            <span data-i18n="alert_exemption.country_any">Any country</span>
          </label>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;"
               data-i18n="alert_exemption.label_ip_optional">IP / CIDR (optional)</label>
        <input type="text" id="aex-ip" class="form-control"
               placeholder="${esc(signal.ip || '203.0.113.0/24')}"
               style="width:100%;padding:6px 8px;background:var(--p-surface-sunken);border:1px solid var(--p-border-subtle);border-radius:4px;color:var(--p-text);">
        <div style="font-size:0.72rem;color:var(--p-text-muted);margin-top:4px;"
             data-i18n="alert_exemption.ip_help">Leave blank to match any IP. Accepts a single IP or a CIDR (e.g. 2a05:6e02::/32).</div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;">
          <span data-i18n="alert_exemption.label_duration">Duration</span> <span style="color:var(--p-danger,#c44);">*</span>
        </div>
        <div class="aex-pill-group" style="display:flex;gap:6px;flex-wrap:wrap;">
          <label class="aex-pill"><input type="radio" name="aex-duration" value="30"><span>30 <span data-i18n="alert_exemption.days">days</span></span></label>
          <label class="aex-pill"><input type="radio" name="aex-duration" value="90"><span>90 <span data-i18n="alert_exemption.days">days</span></span></label>
          <label class="aex-pill"><input type="radio" name="aex-duration" value="180"><span>180 <span data-i18n="alert_exemption.days">days</span></span></label>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;">
          <span data-i18n="alert_exemption.label_reason">Justification</span> <span style="color:var(--p-danger,#c44);">*</span>
        </label>
        <textarea id="aex-reason" class="form-control" rows="3"
                  placeholder="${esc(t('alert_exemption.reason_placeholder', 'e.g. Sub-contractor based in France; carve-out also exists in CA policy'))}"
                  style="width:100%;padding:6px 8px;background:var(--p-surface-sunken);border:1px solid var(--p-border-subtle);border-radius:4px;color:var(--p-text);font-family:inherit;"></textarea>
      </div>

      <div id="aex-broad-warning"
           style="display:none;background:rgba(220,140,0,0.08);border:1px solid rgba(220,140,0,0.35);border-radius:4px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;color:var(--p-text);">
        <strong data-i18n="alert_exemption.warning_label">Heads up.</strong>
        <span data-i18n="alert_exemption.warning_body">Without IP/CIDR scoping, this exemption will suppress any successful sign-in for this user from the matched country, including from unknown devices or networks. Add IP/CIDR to tighten.</span>
      </div>

      <div id="aex-error" style="display:none;color:var(--p-danger,#c44);font-size:0.82rem;margin-bottom:10px;"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--p-border-subtle);padding-top:14px;">
        <button id="aex-cancel" type="button" class="btn-secondary"
                style="padding:6px 14px;cursor:pointer;background:transparent;border:1px solid var(--p-border);border-radius:4px;color:var(--p-text);"
                data-i18n="alert_exemption.btn_cancel">Cancel</button>
        <button id="aex-submit" type="button" class="btn-primary" data-role-required="member"
                style="padding:6px 14px;cursor:pointer;background:var(--p-accent);border:1px solid var(--p-accent);border-radius:4px;color:var(--p-on-accent,#fff);"
                data-i18n="alert_exemption.btn_submit">Create exemption</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Pill-style toggling for radio groups inside the modal
    const styleId = 'aex-pill-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .aex-pill { display:inline-flex; align-items:center; gap:6px;
          padding:6px 12px; border:1px solid var(--p-border-subtle);
          border-radius:999px; cursor:pointer; font-size:0.82rem;
          background:var(--p-surface-sunken); color:var(--p-text);
          user-select:none; transition:background 0.12s, border-color 0.12s, color 0.12s; }
        .aex-pill:hover { border-color:var(--p-accent, #4a90d9); }
        .aex-pill input { display:none; }
        .aex-pill:has(input:checked) { background:var(--p-accent, #4a90d9);
          border-color:var(--p-accent, #4a90d9); color:var(--p-on-accent, #fff);
          font-weight:600; }
      `;
      document.head.appendChild(styleEl);
    }

    // Translate labels (Phase 9 fix May 2, 2026: was calling the wrong API —
    // window.Panoptica.applyI18n doesn't exist; the real function is
    // window.PanopticaI18n.applyTo. Without this fix the data-i18n attributes
    // sat unwalked and the entire modal stayed English).
    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      try { window.PanopticaI18n.applyTo(modal); } catch (_) {}
    }

    // Wire close handlers
    const closeFn = closeCreateExemptionModal;
    el('aex-close').addEventListener('click', closeFn);
    el('aex-cancel').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFn();
    });

    // Show / hide broad-match warning when IP field empties / fills
    const ipInput = el('aex-ip');
    const broadWarn = el('aex-broad-warning');
    function refreshBroadWarning() {
      const hasIp = ipInput.value.trim().length > 0;
      broadWarn.style.display = hasIp ? 'none' : 'block';
    }
    ipInput.addEventListener('input', refreshBroadWarning);
    refreshBroadWarning(); // initial state — no IP → warning visible

    // Submit handler
    el('aex-submit').addEventListener('click', async () => {
      const errEl = el('aex-error');
      errEl.style.display = 'none';

      const countryMode = (modal.querySelector('input[name="aex-country-mode"]:checked') || {}).value;
      const durationRadio = modal.querySelector('input[name="aex-duration"]:checked');
      const duration = durationRadio ? parseInt(durationRadio.value, 10) : null;
      const ip = ipInput.value.trim();
      const reasonStr = (el('aex-reason').value || '').trim();

      if (!duration) {
        errEl.textContent = t('alert_exemption.err_duration', 'Please pick a duration.');
        errEl.style.display = 'block';
        return;
      }
      if (reasonStr.length === 0) {
        errEl.textContent = t('alert_exemption.err_reason', 'Justification is required.');
        errEl.style.display = 'block';
        return;
      }

      const body = {
        tenant_id: alert.tenant_id,
        policy_id: alert.policy_id,
        match_upn: signal.upn,
        match_country: countryMode === 'match' ? country : null,
        match_ip_cidr: ip || null,
        reason: reasonStr,
        duration_days: duration,
        source_alert_id: alert.id,
      };

      const submitBtn = el('aex-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        const resp = await Panoptica.api('/api/alert-exemptions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        Panoptica.showToast(
          t('alert_exemption.toast_created', `Exemption created — alert auto-resolved`),
          'success'
        );
        closeCreateExemptionModal();
        // Refresh slideout view + global alert badges so the operator
        // sees the alert flip to 'resolved' immediately.
        try {
          const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
          const fresh = await Panoptica.api(`/api/alerts/${alert.id}?lang=${encodeURIComponent(lang)}`);
          renderDetail(fresh);
        } catch (_) {}
        Panoptica.refreshAlertSignals?.();
        if (typeof callbacks.onStatusChanged === 'function') {
          try { callbacks.onStatusChanged('resolved'); } catch (_) {}
        }
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        errEl.textContent = t('alert_exemption.err_save', 'Failed to create exemption: ') + msg;
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = t('alert_exemption.btn_submit', 'Create exemption');
      }
    });
  }

  function closeCreateExemptionModal() {
    const overlay = document.getElementById('alert-exemption-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  // ─── Create Defender alert-type exception modal (#7/#23) ───
  // Operator silences a noisy Microsoft-already-handled Defender alert TYPE.
  // Scope is this-tenant or all-managed-tenants; reason required; permanent
  // until revoked. Reuses the .aex-* pill styling injected by the exemption
  // modal (or injects it if this modal opens first).
  function openCreateDefenderExceptionModal(alert, kind) {
    kind = kind || 'defender_type';
    const alertType = extractDefenderAlertType(alert);

    // Resolve the subject being exempted + the POST body, per kind.
    //   'policy'        → exempt the whole policy (email-threat "category");
    //   'defender_type' → exempt the Defender XDR alert type string.
    let subjectLabel, subjectValue, noteText, buildBody;
    if (kind === 'policy') {
      if (!alert.policy_id) {
        Panoptica.showToast(t('defender_exception.toast_missing_policy',
          'Cannot create exception — alert has no policy'), 'error');
        return;
      }
      const rawName = alert.policy_name || '';
      subjectValue = (rawName && window.PanopticaI18n)
        ? window.PanopticaI18n.tOrFallback('alert_policy_names.' + window.PanopticaI18n.slugify(rawName), rawName)
        : rawName;
      subjectLabel = t('defender_exception.field_policy', 'Policy');
      noteText = t('defender_exception.note_body_policy',
        'This silences this entire policy for the chosen scope and sends matching alerts to history. Other policies keep firing. The exception is permanent until you revoke it on the Exemptions page.');
      buildBody = (scope, reasonStr) => ({
        policy_exemption: true,
        tenant_id: alert.tenant_id,
        policy_id: alert.policy_id,
        all_tenants: scope === 'all',
        reason: reasonStr,
        source_alert_id: alert.id,
      });
    } else {
      if (!alertType) {
        Panoptica.showToast(t('defender_exception.toast_missing_type',
          'Cannot create exception — no Defender alert type in alert data'), 'error');
        return;
      }
      subjectValue = alertType;
      subjectLabel = t('defender_exception.field_type', 'Alert type');
      noteText = t('defender_exception.note_body',
        'This silences only this exact Defender alert type. Other Defender alerts — including outbound spam from a compromised account — keep firing. The exception is permanent until you revoke it on the Exemptions page.');
      buildBody = (scope, reasonStr) => ({
        tenant_id: alert.tenant_id,
        policy_id: alert.policy_id,
        match_alert_type: alertType,
        all_tenants: scope === 'all',
        reason: reasonStr,
        source_alert_id: alert.id,
      });
    }

    closeCreateExemptionModal();
    closeCreateDefenderExceptionModal();

    const overlay = document.createElement('div');
    overlay.id = 'defex-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.55)', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const modal = document.createElement('div');
    modal.id = 'defex-modal';
    Object.assign(modal.style, {
      background: 'var(--p-surface)', color: 'var(--p-text)',
      border: '1px solid var(--p-border)', borderRadius: '6px',
      width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto',
      padding: '20px 22px', fontFamily: 'Inter, sans-serif',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    });

    const tenantName = alert.tenant_name || '';

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
        <div>
          <h3 style="margin:0 0 4px 0;font-size:1.1rem;color:var(--p-text);">
            <span data-i18n="defender_exception.modal_title">Create Defender alert exception</span>
          </h3>
          <div style="font-size:0.82rem;color:var(--p-text-muted);">
            <span data-i18n="defender_exception.modal_subtitle">Auto-resolve alerts of this Microsoft Defender type and send them to history</span>
          </div>
        </div>
        <button id="defex-close" type="button"
                style="background:transparent;border:none;color:var(--p-text-muted);font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>
      </div>

      <table class="alert-detail-table" style="width:100%;margin-bottom:14px;font-size:0.85rem;">
        <tr><td style="opacity:0.7;width:120px;">${esc(subjectLabel)}</td><td><code>${esc(subjectValue)}</code></td></tr>
      </table>

      <div style="margin-bottom:14px;">
        <div style="font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;">
          <span data-i18n="defender_exception.label_scope">Apply to</span> <span style="color:var(--p-danger,#c44);">*</span>
        </div>
        <div class="aex-pill-group" style="display:flex;gap:6px;flex-wrap:wrap;">
          <label class="aex-pill"><input type="radio" name="defex-scope" value="tenant" checked>
            <span><span data-i18n="defender_exception.scope_tenant">This tenant only</span>${tenantName ? ` (${esc(tenantName)})` : ''}</span>
          </label>
          <label class="aex-pill"><input type="radio" name="defex-scope" value="all">
            <span data-i18n="defender_exception.scope_all">All managed tenants</span>
          </label>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:0.78rem;color:var(--p-text-muted);margin-bottom:6px;">
          <span data-i18n="defender_exception.label_reason">Justification</span> <span style="color:var(--p-danger,#c44);">*</span>
        </label>
        <textarea id="defex-reason" class="form-control" rows="3"
                  placeholder="${esc(t('defender_exception.reason_placeholder', 'e.g. Microsoft already blocks/remediates this inbound class; not actionable for us'))}"
                  style="width:100%;padding:6px 8px;background:var(--p-surface-sunken);border:1px solid var(--p-border-subtle);border-radius:4px;color:var(--p-text);font-family:inherit;"></textarea>
      </div>

      <div style="background:rgba(220,140,0,0.08);border:1px solid rgba(220,140,0,0.35);border-radius:4px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;color:var(--p-text);">
        <strong data-i18n="defender_exception.note_label">Note.</strong>
        <span>${esc(noteText)}</span>
      </div>

      <div id="defex-error" style="display:none;color:var(--p-danger,#c44);font-size:0.82rem;margin-bottom:10px;"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--p-border-subtle);padding-top:14px;">
        <button id="defex-cancel" type="button" class="btn-secondary"
                style="padding:6px 14px;cursor:pointer;background:transparent;border:1px solid var(--p-border);border-radius:4px;color:var(--p-text);"
                data-i18n="defender_exception.btn_cancel">Cancel</button>
        <button id="defex-submit" type="button" class="btn-primary" data-role-required="member"
                style="padding:6px 14px;cursor:pointer;background:var(--p-accent);border:1px solid var(--p-accent);border-radius:4px;color:var(--p-on-accent,#fff);"
                data-i18n="defender_exception.btn_submit">Create exception</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Reuse the exemption modal's pill styling; inject if not already present.
    const styleId = 'aex-pill-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .aex-pill { display:inline-flex; align-items:center; gap:6px;
          padding:6px 12px; border:1px solid var(--p-border-subtle);
          border-radius:999px; cursor:pointer; font-size:0.82rem;
          background:var(--p-surface-sunken); color:var(--p-text);
          user-select:none; transition:background 0.12s, border-color 0.12s, color 0.12s; }
        .aex-pill:hover { border-color:var(--p-accent, #4a90d9); }
        .aex-pill input { display:none; }
        .aex-pill:has(input:checked) { background:var(--p-accent, #4a90d9);
          border-color:var(--p-accent, #4a90d9); color:var(--p-on-accent, #fff);
          font-weight:600; }
      `;
      document.head.appendChild(styleEl);
    }

    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      try { window.PanopticaI18n.applyTo(modal); } catch (_) {}
    }

    const closeFn = closeCreateDefenderExceptionModal;
    el('defex-close').addEventListener('click', closeFn);
    el('defex-cancel').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });

    el('defex-submit').addEventListener('click', async () => {
      const errEl = el('defex-error');
      errEl.style.display = 'none';

      const scope = (modal.querySelector('input[name="defex-scope"]:checked') || {}).value;
      const reasonStr = (el('defex-reason').value || '').trim();
      if (reasonStr.length === 0) {
        errEl.textContent = t('defender_exception.err_reason', 'Justification is required.');
        errEl.style.display = 'block';
        return;
      }

      const body = buildBody(scope, reasonStr);

      const submitBtn = el('defex-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        const resp = await Panoptica.api('/api/alert-exemptions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        const n = (resp && typeof resp.resolved_count === 'number') ? resp.resolved_count : 0;
        Panoptica.showToast(
          t('defender_exception.toast_created', 'Exception created — matching alerts sent to history')
            + (n > 0 ? ` (${n})` : ''),
          'success'
        );
        closeCreateDefenderExceptionModal();
        try {
          const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
          const fresh = await Panoptica.api(`/api/alerts/${alert.id}?lang=${encodeURIComponent(lang)}`);
          renderDetail(fresh);
        } catch (_) {}
        Panoptica.refreshAlertSignals?.();
        if (typeof callbacks.onStatusChanged === 'function') {
          try { callbacks.onStatusChanged('resolved'); } catch (_) {}
        }
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        errEl.textContent = t('defender_exception.err_save', 'Failed to create exception: ') + msg;
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = t('defender_exception.btn_submit', 'Create exception');
      }
    });
  }

  function closeCreateDefenderExceptionModal() {
    const overlay = document.getElementById('defex-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  // ─── Helpers ───

  function el(id) { return document.getElementById(id); }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Apr 30, 2026 — i18n Phase 6. Re-render alert title in operator's locale
  // when the alert was fired with a structured message template. The detail
  // endpoint returns full raw_data (parsed), so we look there first; fall
  // back to the flat fields the list endpoint surfaces (alerts.js path).
  // Falls back to the stored English `message` column for unmigrated alerts.
  // Resolve *Key/*Fallback pairs into final translated strings (mirror of
  // the helper in pages/alerts.js — kept duplicated to avoid coupling the
  // slideout module to the page module's internal scope). Phase 9b adds
  // pass-through of arbitrary scalar params so per-alert-type templates
  // can interpolate {user}, {count}, {windowMinutes}, etc.
  function resolveTemplateParams(params) {
    const out = {};
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (k.endsWith('Key') || k.endsWith('Fallback') || k === 'interpretedParams') continue;
      out[k] = v;
    }
    // Pass 1 — <base>NameKey + <base>NameFallback → {<base>Name}
    for (const k of Object.keys(params)) {
      if (!k.endsWith('NameKey')) continue;
      const base = k.substring(0, k.length - 'NameKey'.length);
      const fallback = params[base + 'NameFallback'] || '';
      const translated = params[k]
        ? window.PanopticaI18n.tOrFallback(params[k], fallback)
        : fallback;
      out[base + 'Name'] = translated;
    }
    // Pass 2 — generic <var>Key + <var>Fallback → {<var>}
    for (const k of Object.keys(params)) {
      if (!k.endsWith('Key')) continue;
      if (k.endsWith('NameKey')) continue;
      if (k === 'interpretedKey') continue;
      const base = k.substring(0, k.length - 'Key'.length);
      const fallback = params[base + 'Fallback'] || '';
      const translated = params[k]
        ? window.PanopticaI18n.tOrFallback(params[k], fallback, params)
        : fallback;
      out[base] = translated;
    }
    if (params.interpretedKey) {
      out.interpretedText = window.t(params.interpretedKey, params.interpretedParams || {});
    }
    return out;
  }

  function renderAlertMessage(alert) {
    // Path 1: structured payload (Phase 6 security_drift + Phase 9b per-alert-type).
    const raw = alert.raw_data || {};
    const tplKey = alert.message_template_key || raw.message_template_key;
    let tplParams = alert.message_template_params || raw.message_template_params;
    if (tplKey && tplParams) {
      if (typeof tplParams === 'string') {
        try { tplParams = JSON.parse(tplParams); } catch { tplParams = null; }
      }
      if (tplParams && typeof tplParams === 'object') {
        try {
          const resolved = resolveTemplateParams(tplParams);
          // UAL evaluators (Bundle A–F) historically store bare keys like
          // `ual_defender_incident` while alert-engine.js stores fully-
          // qualified paths like `alerts.message_format.count_per_user`.
          // The locale dictionary has all of them under
          // `alerts.message_format.<bare>`, so when a bare key fails to
          // resolve we transparently retry with the prefix. window.t()
          // returns the key itself on miss, so equality with `tplKey`
          // detects the miss without needing a separate hasKey API.
          let rendered = window.t(tplKey, resolved);
          if (rendered === tplKey && !tplKey.includes('.')) {
            const prefixed = 'alerts.message_format.' + tplKey;
            const retried = window.t(prefixed, resolved);
            if (retried !== prefixed) rendered = retried;
          }
          return rendered;
        } catch (e) {
          console.warn('[alert-slideout] renderAlertMessage failed:', e.message);
        }
      }
    }
    // Path 2: legacy general-alert message — replace the English policy-name
    // prefix with the translated version. Mirror of the helper in alerts.js.
    // The detail part stays English (May 2, 2026 — per-alert-type templating
    // is a later phase). Slug the policy_name and look up its translation.
    if (alert.policy_name && alert.message && typeof alert.message === 'string') {
      const prefix = alert.policy_name + ':';
      if (alert.message.startsWith(prefix)) {
        const slug = window.PanopticaI18n.slugify(alert.policy_name);
        const translated = window.PanopticaI18n.tOrFallback('alert_policy_names.' + slug, alert.policy_name);
        if (translated !== alert.policy_name) {
          return translated + alert.message.substring(alert.policy_name.length);
        }
      }
    }
    // Path 3: known custom prefixes (CA + Intune drift messages use literal
    // English prefixes server-side, distinct from their parent policy.name).
    if (alert.message && typeof alert.message === 'string') {
      const customPrefixes = [
        'CA exemption list changed',
        'CA drift auto-remediated',
        'CA policy drift detected',
        'Intune policy drift',
      ];
      for (const englishPrefix of customPrefixes) {
        if (alert.message.startsWith(englishPrefix + ':')) {
          const slug = window.PanopticaI18n.slugify(englishPrefix);
          const translated = window.PanopticaI18n.tOrFallback('alert_message_prefix.' + slug, englishPrefix);
          if (translated !== englishPrefix) {
            return translated + alert.message.substring(englishPrefix.length);
          }
          break;
        }
      }
    }
    return alert.message;
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
    // Defensive: if the key wasn't found (i18n returns the key itself), fall back to raw token.
    if (translated && translated !== key) return esc(translated);
    return esc(cat);
  }

  // ─── Expose on Panoptica namespace ───
  // app.js sets `window.Panoptica = { ... }`; this script is loaded AFTER app.js
  // so the namespace exists. We attach (vs. assign) to be safe if load order
  // ever changes.
  window.Panoptica = window.Panoptica || {};
  window.Panoptica.AlertSlideout = { open, close, isOpen };
})();
