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

    // Status change handler
    setTimeout(() => {
      const statusSelect = el('alert-detail-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', async () => {
          try {
            await Panoptica.api(`/api/alerts/${alert.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: statusSelect.value }),
            });
            Panoptica.showToast(window.t('alerts.toast.status_changed', { status: statusSelect.value }), 'success');
            // Refresh global badges (bell, sidebar, status bar) so the count
            // reflects the new open-alert total immediately rather than on
            // the next 60s poll.
            Panoptica.refreshAlertSignals?.();
            if (typeof callbacks.onStatusChanged === 'function') {
              try { callbacks.onStatusChanged(statusSelect.value); } catch (_) {}
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

    // Body: details + AI + raw/drift + notes + timeline
    let rawDataHtml = '';
    if (alert.raw_data) {
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
    const tenantRowHtml = isMspScope
      ? `<tr><td>${esc(window.t('alerts.details.affected_tenants'))}</td><td>${mspAffectedNames.length ? esc(mspAffectedNames.join(', ')) : '—'}</td></tr>`
      : `<tr><td>${esc(window.t('alerts.details.tenant'))}</td><td>${esc(alert.tenant_name)}</td></tr>`;
    const mspLearnMoreRowHtml = (isMspScope && mspLearnMoreUrl)
      ? `<tr><td>${esc(window.t('alerts.details.learn_more'))}</td><td><a href="${esc(mspLearnMoreUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--p-accent);">${esc(window.t('alerts.details.learn_more_link'))}</a></td></tr>`
      : '';

    el('alert-slideout-body').innerHTML = `
      <div class="alert-detail-section">
        <div class="alert-detail-label">${esc(window.t('alerts.section.details'))}</div>
        <table class="alert-detail-table">
          <tr><td>${esc(window.t('alerts.details.category'))}</td><td>${formatCategory(alert.category)}</td></tr>
          <tr><td>${esc(window.t('alerts.details.policy'))}</td><td><span style="display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;">${esc(policyDisplay)}${explainerIcon}</span></td></tr>
          ${tenantRowHtml}
          ${mspLearnMoreRowHtml}
          <tr><td>${esc(window.t('alerts.details.alert_id'))}</td><td>#${alert.id}</td></tr>
          <tr><td>${esc(window.t('alerts.details.email_sent'))}</td><td>${alert.email_sent ? esc(window.t('alerts.common.yes')) : esc(window.t('alerts.common.no'))}</td></tr>
        </table>
      </div>
      ${attributionHtml}
      ${aiHtml}
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
          user-select:none; }
        .aex-pill input { display:none; }
        .aex-pill:has(input:checked) { background:var(--p-accent-subtle, rgba(120,160,200,0.18));
          border-color:var(--p-accent, #5a8); color:var(--p-text); }
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
