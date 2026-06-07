/**
 * Panoptica — Tenant Management Page Module
 * List, add (admin consent), edit, enable/disable tenants.
 */

(function () {
  'use strict';

  let tenants = [];

  async function init(params = {}) {
    // Check for consent callback messages. The SPA router (app.js) strips
    // query params from the URL via history.replaceState BEFORE it calls
    // module.init, then passes them through as the `params` argument. We
    // MUST read them from `params`, not from window.location.search —
    // window.location.search is already empty by the time we run, which
    // is why every consent toast on this page silently failed to fire
    // until 2026-04-29.
    const consentSuccess = params.consent_success || null;
    const consentError = params.consent_error || null;
    if (consentSuccess) showConsentMessage(window.t('tenants.consent_success'), 'success');
    if (consentError) showConsentMessage(window.t('tenants.consent_failed_with_msg', { message: consentError }), 'error');
    // AADSTS650051 — a leftover service principal blocks the fresh consent.
    // Show an actionable cleanup modal with a pre-filled PowerShell purge script
    // instead of a raw error (operator hit this after remove + re-add).
    if (params.consent_error_code === '650051') {
      openLeftoverSpModal(params.consent_error_tenant || '', params.consent_error_appid || '');
    }

    // Wire up Add Tenant button
    document.getElementById('btn-add-tenant')?.addEventListener('click', startAdminConsent);

    await loadTenants();
  }

  function destroy() {
    tenants = [];
  }

  function showConsentMessage(text, type) {
    const el = document.getElementById('consent-message');
    if (!el) return;
    el.style.display = 'block';
    el.className = `toast ${type}`;
    el.style.position = 'static';
    el.style.minWidth = 'auto';
    // Errors must be sticky — operator NEEDS to read the message (today's
    // AADSTS650051 was missed because the toast auto-dismissed in 8s and the
    // operator only realised something was wrong when the tenant didn't show
    // up in the list). Render error as a banner with an explicit dismiss
    // button. Success toasts can still auto-dismiss — they're informational.
    if (type === 'error') {
      el.innerHTML = '';
      const msg = document.createElement('span');
      msg.style.flex = '1';
      msg.textContent = text;
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '✕';
      close.setAttribute('aria-label', window.t('tenants.dismiss'));
      close.style.cssText = 'background:transparent;border:0;color:inherit;font-size:18px;cursor:pointer;margin-left:12px;padding:0 4px;line-height:1;';
      close.addEventListener('click', () => { el.style.display = 'none'; });
      el.style.display = 'flex';
      el.style.alignItems = 'flex-start';
      el.appendChild(msg);
      el.appendChild(close);
    } else {
      el.textContent = text;
      setTimeout(() => { el.style.display = 'none'; }, 8000);
    }
  }

  async function loadTenants() {
    try {
      tenants = await Panoptica.api('/api/tenants');
      renderTable();
    } catch (err) {
      document.getElementById('tenants-table-body').innerHTML =
        `<div class="panel-error">${window.t('tenants.panel_load_failed')}</div>`;
    }
  }

  function renderTable() {
    const body = document.getElementById('tenants-table-body');
    const countEl = document.getElementById('tenants-count');
    if (!body) return;

    if (countEl) countEl.textContent = window.t('tenants.tenants_registered', { count: tenants.length });

    if (tenants.length === 0) {
      body.innerHTML = `<div style="color:var(--p-text-muted); padding:24px; font-family:Inter,sans-serif;">${escHtml(window.t('tenants.empty_state'))}</div>`;
      return;
    }

    // Locale-aware date formatting — Canadian variants in fr/en pick the
    // right month names, AM/PM, etc. Also future-proofs for Spanish and
    // any other locale dropped in later. Falls back to en-CA if unknown.
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');

    let html = `<table class="tenant-list-table">
      <thead><tr>
        <th>${escHtml(window.t('tenants.col_display_name'))}</th>
        <th>${escHtml(window.t('tenants.col_psa_name'))}</th>
        <th>${escHtml(window.t('tenants.col_mode'))}</th>
        <th>${escHtml(window.t('tenants.col_language'))}</th>
        <th>${escHtml(window.t('tenants.col_polling'))}</th>
        <th>${escHtml(window.t('tenants.col_status'))}</th>
        <th>${escHtml(window.t('tenants.col_consented'))}</th>
        <th>${escHtml(window.t('tenants.col_actions'))}</th>
      </tr></thead><tbody>`;

    for (const t of tenants) {
      const statusClass = t.enabled ? 'status-enabled' : 'status-disabled';
      const statusText = t.enabled ? window.t('tenants.enabled') : window.t('tenants.disabled');
      const consentDate = t.consented_at ? new Date(t.consented_at).toLocaleDateString(dateLocale) : '—';

      // Mode badge — AUDIT for audit_only with days-remaining countdown,
      // otherwise blank (managed is the default and doesn't need to shout).
      let modeCell = '';
      if (t.mode === 'audit_only') {
        let daysLeft = '';
        if (t.audit_expires_at) {
          const expiresMs = new Date(t.audit_expires_at + 'Z').getTime();
          const days = Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000));
          daysLeft = days > 0
            ? window.t('tenants.mode_audit_days_left', { days })
            : window.t('tenants.mode_audit_expired');
        }
        modeCell = `<span class="mode-badge mode-audit" title="${escAttr(window.t('tenants.mode_audit_title'))}">${escHtml(window.t('tenants.mode_audit'))}${escHtml(daysLeft)}</span>`;
      } else {
        modeCell = `<span class="mode-badge mode-managed">${escHtml(window.t('tenants.mode_managed'))}</span>`;
      }

      html += `<tr>
        <td class="tenant-name">${escHtml(t.display_name)}</td>
        <td>${escHtml(t.psa_name || '—')}</td>
        <td>${modeCell}</td>
        <td>${(t.language || 'en').toUpperCase()}</td>
        <td>${t.polling_interval}</td>
        <td><span class="status-badge ${statusClass}">${escHtml(statusText)}</span></td>
        <td class="mono">${consentDate}</td>
        <td>
          <button class="btn-secondary btn-edit" data-role-required="member" data-id="${t.id}" style="margin-right:4px;">${escHtml(window.t('tenants.btn_edit'))}</button>
          <button class="btn-secondary btn-toggle" data-role-required="admin" data-id="${t.id}" data-enabled="${t.enabled}">
            ${escHtml(t.enabled ? window.t('tenants.btn_disable') : window.t('tenants.btn_enable'))}
          </button>
        </td>
      </tr>`;
    }

    html += '</tbody></table>';
    body.innerHTML = html;

    // Wire action buttons
    body.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
    });
    body.querySelectorAll('.btn-toggle').forEach(btn => {
      btn.addEventListener('click', () => toggleTenant(parseInt(btn.dataset.id)));
    });
  }

  function startAdminConsent() {
    // Open mode picker modal — user must choose Managed or Audit-only BEFORE
    // the consent flow, because the chosen mode is applied to the tenant row
    // when it's INSERTed in /auth/adminconsent/callback. Asking after consent
    // is awkward (the callback flow has no natural pause point) and would
    // also leave a brief window where the tenant exists in the wrong mode.
    const bodyHtml = `
      <div class="mode-picker">
        <div class="mode-picker-title">${escHtml(window.t('tenants.modal_add_mode_title'))}</div>
        <div class="mode-picker-help">${window.t('tenants.modal_add_help_html')}</div>
        <label class="mode-card mode-card-managed">
          <input type="radio" name="add-tenant-mode" value="managed" checked>
          <div class="mode-card-body">
            <div class="mode-card-title">${escHtml(window.t('tenants.modal_card_managed_title'))}</div>
            <div class="mode-card-desc">${escHtml(window.t('tenants.modal_card_managed_desc'))}</div>
          </div>
        </label>
        <label class="mode-card mode-card-audit">
          <input type="radio" name="add-tenant-mode" value="audit_only">
          <div class="mode-card-body">
            <div class="mode-card-title">${escHtml(window.t('tenants.modal_card_audit_title'))}</div>
            <div class="mode-card-desc">${window.t('tenants.modal_card_audit_desc_html')}</div>
          </div>
        </label>
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="btn-proceed-consent" data-role-required="admin">${escHtml(window.t('tenants.btn_continue_consent'))}</button>
    `;

    Panoptica.openModal(window.t('tenants.modal_add_title'), bodyHtml, footerHtml);

    document.getElementById('btn-proceed-consent')?.addEventListener('click', () => {
      const mode = document.querySelector('input[name="add-tenant-mode"]:checked')?.value || 'managed';
      window.location.href = '/auth/adminconsent?mode=' + encodeURIComponent(mode);
    });
  }

  // AADSTS650051 cleanup helper. A previous connection left a service principal
  // (active and/or soft-deleted) for our app in the customer tenant, which
  // blocks a fresh admin consent from creating its SP. We can't purge it from
  // here (no creds into the customer tenant for directory writes), so we hand
  // the operator a ready-to-run PowerShell script, pre-filled with the real
  // tenant id + app id, that fully clears it. Mirrors the proven manual fix.
  function buildLeftoverSpScript(tenantGuid, appId) {
    const t = tenantGuid || '<customer-tenant-id>';
    const a = appId || '<application-client-id>';
    return [
      '# Run in PowerShell as an admin of the CUSTOMER tenant.',
      '# Requires the Microsoft.Graph PowerShell SDK (Install-Module Microsoft.Graph).',
      '',
      'Connect-MgGraph -Scopes "Application.ReadWrite.All" -TenantId "' + t + '"',
      '',
      '$appId = "' + a + '"',
      '',
      '# 1. Delete any ACTIVE service principal for the app (this soft-deletes it).',
      '$active = (Invoke-MgGraphRequest -Method GET `',
      '  -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq ' + "'" + '$appId' + "'" + '").value',
      'foreach ($sp in $active) {',
      '  Invoke-MgGraphRequest -Method DELETE -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($sp.id)"',
      '  Write-Host "Deleted active SP $($sp.id)"',
      '}',
      '',
      '# 2. Purge ALL soft-deleted service principals for the app.',
      'Start-Sleep -Seconds 10',
      '$deleted = (Invoke-MgGraphRequest -Method GET `',
      '  -Uri "https://graph.microsoft.com/v1.0/directory/deletedItems/microsoft.graph.servicePrincipal?`$filter=appId eq ' + "'" + '$appId' + "'" + '").value',
      'foreach ($sp in $deleted) {',
      '  Invoke-MgGraphRequest -Method DELETE -Uri "https://graph.microsoft.com/v1.0/directory/deletedItems/$($sp.id)"',
      '  Write-Host "Purged soft-deleted SP $($sp.id)"',
      '}',
      '',
      '# 3. Verify BOTH counts are 0, then re-add the tenant in Panoptica365.',
      'Write-Host "Active:" (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq ' + "'" + '$appId' + "'" + '").value.Count',
      'Write-Host "Soft-deleted:" (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/directory/deletedItems/microsoft.graph.servicePrincipal?`$filter=appId eq ' + "'" + '$appId' + "'" + '").value.Count',
    ].join('\n');
  }

  function openLeftoverSpModal(tenantGuid, appId) {
    const script = buildLeftoverSpScript(tenantGuid, appId);
    // Retry-first: AADSTS650051 is MOST OFTEN a transient first-attempt quirk
    // of Microsoft's /common/adminconsent (it creates the SP but reports the
    // error anyway) — a second consent attempt usually just works. So we lead
    // with "Try again" and tuck the full cleanup script behind a details
    // disclosure for the rarer case of a genuinely stuck leftover registration.
    const bodyHtml =
      '<div class="form-group">' +
        '<p style="margin:0 0 10px;">' + escHtml(window.t('tenants.leftover_sp_intro')) + '</p>' +
        '<p style="margin:0 0 12px;">' + escHtml(window.t('tenants.leftover_sp_retry_first')) + '</p>' +
        '<details style="margin-top:6px;">' +
          '<summary style="cursor:pointer; color:var(--p-text-muted); font-size:0.88rem;">' + escHtml(window.t('tenants.leftover_sp_still_failing')) + '</summary>' +
          '<p style="margin:10px 0; color:var(--p-text-muted); font-size:0.88rem;">' + escHtml(window.t('tenants.leftover_sp_explain')) + '</p>' +
          '<pre id="leftover-sp-script" style="background:var(--p-surface-sunken, #0d1b2a); color:var(--p-text, #e6edf3); padding:12px; border-radius:6px; font-size:0.78rem; line-height:1.45; overflow:auto; max-height:260px; white-space:pre; margin:0;">' + escHtml(script) + '</pre>' +
          '<button class="btn-secondary" id="btn-leftover-copy" style="margin-top:10px;">' + escHtml(window.t('tenants.leftover_sp_copy')) + '</button>' +
        '</details>' +
      '</div>';
    const footerHtml =
      '<button class="btn-secondary" id="btn-leftover-close">' + escHtml(window.t('modals.close')) + '</button>' +
      '<button class="btn-primary" id="btn-leftover-retry">' + escHtml(window.t('tenants.leftover_sp_try_again')) + '</button>';
    Panoptica.openModal(window.t('tenants.leftover_sp_title'), bodyHtml, footerHtml);
    document.getElementById('btn-leftover-retry')?.addEventListener('click', () => { Panoptica.closeModal(); startAdminConsent(); });
    document.getElementById('btn-leftover-copy')?.addEventListener('click', () => {
      const b = document.getElementById('btn-leftover-copy');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(script).then(() => {
          if (b) b.textContent = window.t('tenants.leftover_sp_copied');
        }).catch(() => {});
      }
    });
    document.getElementById('btn-leftover-close')?.addEventListener('click', () => Panoptica.closeModal());
  }

  function openEditModal(tenantId) {
    const t = tenants.find(x => x.id === tenantId);
    if (!t) return;

    // Locale-aware date for the audit-expires warning. Same dateLocale pattern
    // as renderTable() — fr/es/en-CA.
    const lang = (window.PanopticaI18n && window.PanopticaI18n.currentLang()) || 'en';
    const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');

    const bodyHtml = `
      <div class="form-group">
        <label>${escHtml(window.t('tenants.col_display_name'))}</label>
        <input type="text" id="edit-display-name" value="${escAttr(t.display_name)}">
      </div>
      <div class="form-group">
        <label>${escHtml(window.t('tenants.col_psa_name'))}</label>
        <input type="text" id="edit-psa-name" value="${escAttr(t.psa_name || '')}" placeholder="${escAttr(window.t('tenants.modal_edit_psa_placeholder'))}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${escHtml(window.t('tenants.col_language'))}</label>
          <select id="edit-language">
            <option value="en" ${t.language === 'en' ? 'selected' : ''}>English</option>
            <option value="fr" ${t.language === 'fr' ? 'selected' : ''}>Français</option>
            <option value="es" ${t.language === 'es' ? 'selected' : ''}>Español</option>
          </select>
        </div>
        <div class="form-group">
          <label>${escHtml(window.t('tenants.polling_interval'))}</label>
          <input type="number" id="edit-polling" value="${t.polling_interval}" min="1" max="60">
        </div>
      </div>
      <div class="form-group">
        <label>${escHtml(window.t('tenants.col_mode'))}</label>
        <div class="form-helper" style="font-size:0.78rem; color:var(--p-text-muted); margin-bottom:6px;">
          ${window.t('tenants.modal_mode_helper_html')}
          ${t.mode === 'audit_only' ? '<br><em>' + escHtml(window.t('tenants.modal_audit_to_managed_note')) + '</em>' : ''}
        </div>
        <select id="edit-mode">
          <option value="managed" ${(!t.mode || t.mode === 'managed') ? 'selected' : ''}>${escHtml(window.t('tenants.mode_managed'))}</option>
          ${t.mode === 'audit_only' ? `<option value="audit_only" selected>${escHtml(window.t('tenants.modal_card_audit_title'))}</option>` : ''}
        </select>
        ${t.mode === 'audit_only' && t.audit_expires_at ? `
          <div class="form-helper" style="font-size:0.78rem; color:var(--p-warning, #E65100); margin-top:6px;">
            ${escHtml(window.t('tenants.modal_audit_expires_warning', { date: new Date(t.audit_expires_at + 'Z').toLocaleString(dateLocale) }))}
          </div>
        ` : ''}
      </div>
      <div class="form-group">
        <label>${escHtml(window.t('tenants.modal_label_tenant_id'))}</label>
        <input type="text" value="${escAttr(t.tenant_id)}" disabled style="opacity:0.5;">
      </div>
    `;

    const footerHtml = `
      <button class="btn-danger" id="btn-delete-tenant" data-role-required="admin" data-id="${t.id}" style="margin-right:auto;">${escHtml(window.t('tenants.modal_delete_button'))}</button>
      <button class="btn-secondary" id="btn-assign-roles" data-role-required="admin" data-id="${t.id}">${escHtml(window.t('tenants.modal_assign_roles_button'))}</button>
      <button class="btn-secondary" onclick="Panoptica.closeModal()">${escHtml(window.t('modals.cancel'))}</button>
      <button class="btn-primary" id="btn-save-tenant" data-role-required="member" data-id="${t.id}">${escHtml(window.t('modals.save'))}</button>
    `;

    Panoptica.openModal(window.t('tenants.modal_edit_title'), bodyHtml, footerHtml);
    if (window.PanopticaI18n) window.PanopticaI18n.applyTo(document.getElementById('modal-overlay'));

    // Wire save
    document.getElementById('btn-save-tenant')?.addEventListener('click', async () => {
      await saveTenant(t.id);
    });
    // Wire delete (admin-only) — opens an irreversible-confirm modal.
    document.getElementById('btn-delete-tenant')?.addEventListener('click', () => {
      openDeleteConfirm(t);
    });
    // Re-run EXO/Compliance role assignment (admin-only). Idempotent — safe to
    // click if the automatic onboarding assignment missed (SP propagation lag).
    document.getElementById('btn-assign-roles')?.addEventListener('click', async () => {
      const b = document.getElementById('btn-assign-roles');
      if (b) { b.setAttribute('disabled','disabled'); b.textContent = window.t('tenants.modal_delete_deleting'); }
      try {
        const r = await Panoptica.api(`/api/tenants/${t.id}/assign-exo-roles`, { method: 'POST' });
        if (r && r.ok) {
          Panoptica.showToast(window.t('tenants.toast_roles_assigned', { name: t.display_name }), 'success');
        } else {
          Panoptica.showToast(window.t('tenants.toast_roles_partial', { name: t.display_name }), 'warning');
        }
      } catch (err) {
        Panoptica.showToast((err && err.message) || window.t('tenants.toast_roles_failed'), 'error');
      } finally {
        if (b) { b.removeAttribute('disabled'); b.textContent = window.t('tenants.modal_assign_roles_button'); }
      }
    });
  }

  // Irreversible delete confirmation. "No" returns to the edit modal; "Yes"
  // cascade-deletes the tenant and all related data via DELETE /api/tenants/:id.
  function openDeleteConfirm(t) {
    const bodyHtml = `
      <div class="form-group">
        <p style="margin:0 0 10px;">${escHtml(window.t('tenants.modal_delete_warning', { name: t.display_name }))}</p>
        <p style="margin:0; color:var(--p-danger); font-weight:600;">${escHtml(window.t('tenants.modal_delete_irreversible'))}</p>
      </div>
    `;
    const footerHtml = `
      <button class="btn-secondary" id="btn-delete-no">${escHtml(window.t('tenants.modal_delete_no'))}</button>
      <button class="btn-danger" id="btn-delete-yes" data-id="${t.id}">${escHtml(window.t('tenants.modal_delete_yes'))}</button>
    `;
    Panoptica.openModal(window.t('tenants.modal_delete_title'), bodyHtml, footerHtml);
    document.getElementById('btn-delete-no')?.addEventListener('click', () => openEditModal(t.id));
    document.getElementById('btn-delete-yes')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-delete-yes');
      if (btn) { btn.setAttribute('disabled', 'disabled'); btn.textContent = window.t('tenants.modal_delete_deleting'); }
      try {
        await Panoptica.api(`/api/tenants/${t.id}`, { method: 'DELETE' });
        Panoptica.closeModal();
        Panoptica.showToast(window.t('tenants.toast_tenant_deleted', { name: t.display_name }), 'success');
        await loadTenants();
      } catch (err) {
        Panoptica.showToast((err && err.message) || window.t('tenants.toast_tenant_delete_failed'), 'error');
        if (btn) { btn.removeAttribute('disabled'); btn.textContent = window.t('tenants.modal_delete_yes'); }
      }
    });
  }

  async function saveTenant(id) {
    const payload = {
      display_name: document.getElementById('edit-display-name')?.value?.trim(),
      psa_name: document.getElementById('edit-psa-name')?.value?.trim() || null,
      language: document.getElementById('edit-language')?.value,
      mode: document.getElementById('edit-mode')?.value,
      polling_interval: parseInt(document.getElementById('edit-polling')?.value, 10),
    };

    if (!payload.display_name) {
      Panoptica.showToast(window.t('tenants.toast_display_name_required'), 'error');
      return;
    }

    try {
      await Panoptica.api(`/api/tenants/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      Panoptica.closeModal();
      Panoptica.showToast(window.t('tenants.toast_tenant_updated'), 'success');
      await loadTenants();
    } catch (err) {
      Panoptica.showToast(window.t('tenants.toast_save_failed', { message: err.message }), 'error');
    }
  }

  async function toggleTenant(id) {
    const t = tenants.find(x => x.id === id);
    if (!t) return;

    if (t.enabled) {
      // Confirm disable
      const proceed = confirm(window.t('tenants.confirm_disable', { name: t.display_name }));
      if (!proceed) return;
    }

    try {
      const result = await Panoptica.api(`/api/tenants/${id}/toggle`, { method: 'PATCH' });
      Panoptica.showToast(
        window.t(result.enabled ? 'tenants.toast_enabled' : 'tenants.toast_disabled', { name: t.display_name }),
        result.enabled ? 'success' : 'warning'
      );
      await loadTenants();
    } catch (err) {
      Panoptica.showToast(window.t('tenants.toast_toggle_failed', { message: err.message }), 'error');
    }
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Register module
  window.PanopticaPage = { init, destroy };
})();
