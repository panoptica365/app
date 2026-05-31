/**
 * Panoptica365 — Settings Page
 * Cards: SMTP, Notifications, Anthropic API Key, Access Control (Entra groups).
 */
(function () {
  'use strict';

  function init() {
    // Card → sub-view navigation
    document.getElementById('card-smtp')?.addEventListener('click', () => showView('smtp'));
    document.getElementById('card-notifications')?.addEventListener('click', () => showView('notif'));
    document.getElementById('card-anthropic')?.addEventListener('click', () => showView('anthropic'));
    document.getElementById('card-briefing')?.addEventListener('click', () => showView('briefing'));
    document.getElementById('card-message-center')?.addEventListener('click', () => showView('message_center'));
    document.getElementById('card-access')?.addEventListener('click', () => showView('access'));
    document.getElementById('card-branding')?.addEventListener('click', () => showView('branding'));

    // Back buttons
    document.getElementById('smtp-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('notif-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('anthropic-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('briefing-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('message-center-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('access-back')?.addEventListener('click', () => showView('cards'));
    document.getElementById('branding-back')?.addEventListener('click', () => showView('cards'));

    // Daily Summary handlers
    document.getElementById('briefing-save')?.addEventListener('click', saveBriefing);

    // Microsoft Message Feed handlers
    document.getElementById('message-center-save')?.addEventListener('click', saveMessageCenter);

    // SMTP handlers (unchanged)
    document.getElementById('smtp-save')?.addEventListener('click', saveSmtp);
    document.getElementById('smtp-test')?.addEventListener('click', testSmtp);
    document.getElementById('smtp-pass-toggle')?.addEventListener('click', togglePassVisibility);

    // Notification handlers (unchanged)
    document.getElementById('notif-save')?.addEventListener('click', saveNotifications);

    // Anthropic handlers
    document.getElementById('anthropic-test')?.addEventListener('click', testAnthropicKey);
    document.getElementById('anthropic-save')?.addEventListener('click', saveAnthropicKey);
    document.getElementById('anthropic-reveal')?.addEventListener('click', toggleAnthropicReveal);

    // Branding handlers
    document.getElementById('branding-save')?.addEventListener('click', saveBranding);
    document.getElementById('branding-logo-file')?.addEventListener('change', onBrandingLogoPicked);
    document.getElementById('branding-logo-remove')?.addEventListener('click', removeBrandingLogo);

    // Access Control handlers
    document.getElementById('access-save')?.addEventListener('click', saveAccessControl);
    document.querySelectorAll('.access-verify-btn').forEach(btn => {
      btn.addEventListener('click', () => verifyAccessField(btn.dataset.field));
    });
    ['admin', 'member', 'viewer'].forEach(field => {
      const input = document.getElementById(`access-${field}-id`);
      input?.addEventListener('blur', () => {
        if (input.value.trim() && input.value.trim() !== input.dataset.lastVerified) {
          verifyAccessField(field);
        }
      });
      input?.addEventListener('input', () => {
        // Clear previous result styling when the user types
        input.classList.remove('resolved', 'invalid');
        const resultEl = document.getElementById(`access-${field}-result`);
        if (resultEl) { resultEl.textContent = ''; resultEl.className = 'access-result'; }
      });
    });
  }

  function destroy() {}

  function showView(view) {
    const blocks = {
      cards:     document.getElementById('settings-cards'),
      smtp:      document.getElementById('settings-smtp-view'),
      notif:     document.getElementById('settings-notif-view'),
      anthropic: document.getElementById('settings-anthropic-view'),
      briefing:  document.getElementById('settings-briefing-view'),
      message_center: document.getElementById('settings-message-center-view'),
      access:    document.getElementById('settings-access-view'),
      branding:  document.getElementById('settings-branding-view'),
    };
    Object.entries(blocks).forEach(([k, el]) => {
      if (el) el.style.display = (k === view) ? '' : 'none';
    });
    if (view === 'smtp')      loadSmtp();
    if (view === 'notif')     loadNotifications();
    if (view === 'anthropic') loadAnthropicKey();
    if (view === 'briefing')  loadBriefing();
    if (view === 'message_center') loadMessageCenter();
    if (view === 'access')    loadAccessControl();
    if (view === 'branding')  loadBranding();
  }

  // ─── Microsoft Message Feed (Feature 8.8) ───

  async function loadMessageCenter() {
    const sel = document.getElementById('mc-source-tenant');
    if (!sel) return;
    try {
      // Populate the picker from the operator's tenants, then select the
      // currently-configured source tenant (or None). The first <option>
      // (None) is defined in the partial and preserved here.
      const [tenants, current] = await Promise.all([
        Panoptica.api('/api/tenants'),
        Panoptica.api('/api/settings/message-center'),
      ]);
      const list = Array.isArray(tenants) ? tenants : (tenants.tenants || []);
      // Rebuild options: keep the None option, append one per tenant.
      const noneLabel = window.t('settings.message_center.option_none');
      sel.innerHTML = `<option value="">${noneLabel}</option>` +
        list
          .slice()
          .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
          .map(t => `<option value="${t.tenant_id}">${escHtml(t.display_name)}</option>`)
          .join('');
      sel.value = current.source_tenant || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.message_center.toast_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveMessageCenter() {
    const statusEl = document.getElementById('message-center-status');
    const sel = document.getElementById('mc-source-tenant');
    if (!sel) return;
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      await Panoptica.api('/api/settings/message-center', {
        method: 'PUT',
        body: JSON.stringify({ source_tenant: sel.value || null }),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.message_center.toast_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // Minimal HTML escape for option labels (display names are operator-controlled
  // but rendered as HTML here).
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  // ─── Daily Summary ───

  async function loadBriefing() {
    try {
      const data = await Panoptica.api('/api/settings/briefing');
      const sel = document.getElementById('briefing-min-severity');
      if (sel) sel.value = data.min_severity || 'info';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_briefing_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveBriefing() {
    const statusEl = document.getElementById('briefing-status');
    const sel = document.getElementById('briefing-min-severity');
    if (!sel) return;
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      await Panoptica.api('/api/settings/briefing', {
        method: 'PUT',
        body: JSON.stringify({ min_severity: sel.value }),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_briefing_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── SMTP ───

  async function loadSmtp() {
    try {
      const data = await Panoptica.api('/api/settings/smtp');
      document.getElementById('smtp-host').value = data.host || '';
      document.getElementById('smtp-port').value = data.port || '';
      document.getElementById('smtp-user').value = data.user || '';
      document.getElementById('smtp-pass').value = '';
      document.getElementById('smtp-pass').placeholder = data.pass_set ? window.t('settings.smtp.pass_placeholder_unchanged') : window.t('settings.smtp.pass_placeholder_enter');
      document.getElementById('smtp-from').value = data.from || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_smtp_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveSmtp() {
    const statusEl = document.getElementById('smtp-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      host: document.getElementById('smtp-host').value.trim(),
      port: parseInt(document.getElementById('smtp-port').value, 10) || 2525,
      user: document.getElementById('smtp-user').value.trim(),
      from: document.getElementById('smtp-from').value.trim(),
    };
    const pass = document.getElementById('smtp-pass').value;
    if (pass) payload.pass = pass;
    try {
      await Panoptica.api('/api/settings/smtp', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_smtp_saved'), 'success');
      setTimeout(() => loadSmtp(), 500);
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  async function testSmtp() {
    const statusEl = document.getElementById('smtp-status');
    const testTo = (document.getElementById('smtp-test-to')?.value || '').trim();
    if (!testTo) {
      statusEl.textContent = window.t('settings.smtp.test_recipient_required');
      statusEl.style.color = '#e67e22';
      return;
    }
    statusEl.textContent = window.t('settings.smtp.status_sending_test');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const result = await Panoptica.api('/api/settings/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to: testTo }),
      });
      statusEl.textContent = window.t('settings.smtp.status_test_sent_to', { recipient: result.sent_to });
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_test_email_sent', { recipient: result.sent_to }), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.smtp.status_test_failed');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_smtp_test_failed', { message: err.message }), 'error');
    }
  }

  function togglePassVisibility() {
    const input = document.getElementById('smtp-pass');
    const btn = document.getElementById('smtp-pass-toggle');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = window.t('settings.btn_hide'); }
    else { input.type = 'password'; btn.textContent = window.t('settings.btn_show'); }
  }

  // ─── Notifications ───

  async function loadNotifications() {
    try {
      const data = await Panoptica.api('/api/settings/notifications');
      document.getElementById('notif-psa-email').value = data.psa_email || '';
      document.getElementById('notif-psa-attribution').value = data.psa_attribution || '';
      document.getElementById('notif-emails').value = data.notify_emails || '';
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_notif_load_failed', { message: err.message }), 'error');
    }
  }

  async function saveNotifications() {
    const statusEl = document.getElementById('notif-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      psa_email: document.getElementById('notif-psa-email').value.trim(),
      psa_attribution: document.getElementById('notif-psa-attribution').value.trim(),
      notify_emails: document.getElementById('notif-emails').value.trim(),
    };
    try {
      await Panoptica.api('/api/settings/notifications', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_notif_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── Anthropic API Key ───

  async function loadAnthropicKey() {
    const currentEl = document.getElementById('anthropic-current');
    const newEl = document.getElementById('anthropic-new');
    const statusEl = document.getElementById('anthropic-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    if (newEl) newEl.value = '';
    try {
      const data = await Panoptica.api('/api/settings/anthropic-key');
      if (currentEl) currentEl.value = data.key_set ? data.key_preview : window.t('settings.anthropic.no_key_set');
    } catch (err) {
      if (currentEl) currentEl.value = window.t('settings.anthropic.load_failed_inline');
      Panoptica.showToast(window.t('settings.toast_anthropic_load_failed', { message: err.message }), 'error');
    }
  }

  async function testAnthropicKey() {
    const statusEl = document.getElementById('anthropic-status');
    const newKey = (document.getElementById('anthropic-new')?.value || '').trim();
    statusEl.textContent = window.t('settings.anthropic.status_testing');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const payload = newKey ? { key: newKey } : {};
      const result = await Panoptica.api('/api/settings/anthropic-key/test', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      statusEl.textContent = window.t('settings.anthropic.test_ok', { model: result.model });
      statusEl.style.color = '#27ae60';
    } catch (err) {
      statusEl.textContent = window.t('settings.anthropic.test_failed', { message: err.message });
      statusEl.style.color = '#e74c3c';
    }
  }

  async function saveAnthropicKey() {
    const newEl = document.getElementById('anthropic-new');
    const statusEl = document.getElementById('anthropic-status');
    const key = (newEl?.value || '').trim();
    if (!key) {
      statusEl.textContent = window.t('settings.anthropic.paste_first');
      statusEl.style.color = '#e67e22';
      return;
    }
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    try {
      const result = await Panoptica.api('/api/settings/anthropic-key', {
        method: 'PUT',
        body: JSON.stringify({ key }),
      });
      statusEl.textContent = window.t('settings.anthropic.saved_with_preview', { preview: result.key_preview });
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_anthropic_rotated'), 'success');
      setTimeout(loadAnthropicKey, 400);
    } catch (err) {
      statusEl.textContent = window.t('settings.anthropic.test_failed', { message: err.message });
      statusEl.style.color = '#e74c3c';
    }
  }

  function toggleAnthropicReveal() {
    const input = document.getElementById('anthropic-new');
    const btn = document.getElementById('anthropic-reveal');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = window.t('settings.btn_hide'); }
    else { input.type = 'password'; btn.textContent = window.t('settings.btn_show'); }
  }

  // ─── Access Control ───

  async function loadAccessControl() {
    try {
      const data = await Panoptica.api('/api/settings/access-control');
      const setField = (field, id) => {
        const el = document.getElementById(`access-${field}-id`);
        if (el) {
          el.value = id || '';
          el.dataset.lastVerified = '';
          el.classList.remove('resolved', 'invalid');
          const res = document.getElementById(`access-${field}-result`);
          if (res) { res.textContent = ''; res.className = 'access-result'; }
        }
        if (id) verifyAccessField(field); // auto-verify saved values on load
      };
      setField('admin',  data.admin_group_id);
      setField('member', data.member_group_id);
      setField('viewer', data.viewer_group_id);
    } catch (err) {
      Panoptica.showToast(window.t('settings.toast_access_load_failed', { message: err.message }), 'error');
    }
  }

  async function verifyAccessField(field) {
    const input = document.getElementById(`access-${field}-id`);
    const resultEl = document.getElementById(`access-${field}-result`);
    const btn = document.querySelector(`.access-verify-btn[data-field="${field}"]`);
    if (!input || !resultEl) return;
    const id = input.value.trim();
    if (!id) {
      input.classList.remove('resolved', 'invalid');
      resultEl.textContent = '';
      resultEl.className = 'access-result';
      return;
    }
    // Fast-fail client-side GUID check
    const guidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!guidRe.test(id)) {
      input.classList.remove('resolved');
      input.classList.add('invalid');
      resultEl.textContent = window.t('settings.access.invalid_guid');
      resultEl.className = 'access-result err';
      return;
    }

    resultEl.textContent = window.t('settings.access.verifying');
    resultEl.className = 'access-result pending';
    input.classList.remove('resolved', 'invalid');
    btn?.classList.add('busy');

    try {
      const data = await Panoptica.api(`/api/settings/access-control/verify-group/${encodeURIComponent(id)}`);
      input.classList.add('resolved');
      input.dataset.lastVerified = id;
      const name = data.security_enabled === false
        ? data.display_name + window.t('settings.access.mail_enabled_suffix')
        : data.display_name;
      resultEl.textContent = window.t('settings.access.verify_ok', { name });
      resultEl.className = 'access-result ok';
    } catch (err) {
      input.classList.add('invalid');
      resultEl.textContent = window.t('settings.access.verify_failed', { message: err.message || window.t('settings.access.verify_failed_default') });
      resultEl.className = 'access-result err';
    } finally {
      btn?.classList.remove('busy');
    }
  }

  async function saveAccessControl() {
    const statusEl = document.getElementById('access-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      admin_group_id:  document.getElementById('access-admin-id').value.trim(),
      member_group_id: document.getElementById('access-member-id').value.trim(),
      viewer_group_id: document.getElementById('access-viewer-id').value.trim(),
    };
    try {
      await Panoptica.api('/api/settings/access-control', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.toast_access_saved'), 'success');
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  // ─── Report Branding ───

  // Pending logo state, set by the file picker / remove button and consumed by
  // saveBranding(). null data-url = no new upload this session.
  let brandingPendingLogo = null;   // data URL string when a new PNG is staged
  let brandingRemoveLogo = false;   // true when the operator clicked Remove
  const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

  async function loadBranding() {
    brandingPendingLogo = null;
    brandingRemoveLogo = false;
    const fileEl = document.getElementById('branding-logo-file');
    if (fileEl) fileEl.value = '';
    try {
      const data = await Panoptica.api('/api/settings/branding');
      document.getElementById('branding-company-name').value = data.company_name || '';
      setBrandingPreview(data.logo_url || null);
    } catch (err) {
      Panoptica.showToast(window.t('settings.branding.toast_load_failed', { message: err.message }), 'error');
    }
  }

  // src = a URL/data-URL to show, or null to show the "no logo" placeholder.
  function setBrandingPreview(src) {
    const img = document.getElementById('branding-logo-preview');
    const empty = document.getElementById('branding-logo-empty');
    if (!img || !empty) return;
    if (src) {
      img.src = src;
      img.style.display = '';
      empty.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      empty.style.display = '';
    }
  }

  function onBrandingLogoPicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('branding-status');
    if (file.type !== 'image/png') {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_not_png'); statusEl.style.color = '#e67e22'; }
      e.target.value = '';
      return;
    }
    if (file.size > BRANDING_MAX_BYTES) {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_too_large'); statusEl.style.color = '#e67e22'; }
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      brandingPendingLogo = reader.result; // data:image/png;base64,...
      brandingRemoveLogo = false;
      setBrandingPreview(brandingPendingLogo);
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    };
    reader.onerror = () => {
      if (statusEl) { statusEl.textContent = window.t('settings.branding.err_read'); statusEl.style.color = '#e74c3c'; }
    };
    reader.readAsDataURL(file);
  }

  function removeBrandingLogo() {
    brandingPendingLogo = null;
    brandingRemoveLogo = true;
    const fileEl = document.getElementById('branding-logo-file');
    if (fileEl) fileEl.value = '';
    setBrandingPreview(null);
  }

  async function saveBranding() {
    const statusEl = document.getElementById('branding-status');
    statusEl.textContent = window.t('settings.status.saving');
    statusEl.style.color = 'var(--p-text-muted)';
    const payload = {
      company_name: document.getElementById('branding-company-name').value.trim(),
    };
    if (brandingPendingLogo) payload.logo = brandingPendingLogo;
    else if (brandingRemoveLogo) payload.remove_logo = true;
    try {
      await Panoptica.api('/api/settings/branding', { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = window.t('settings.status.saved');
      statusEl.style.color = '#27ae60';
      Panoptica.showToast(window.t('settings.branding.toast_saved'), 'success');
      setTimeout(loadBranding, 500);
    } catch (err) {
      statusEl.textContent = window.t('settings.status.error');
      statusEl.style.color = '#e74c3c';
      Panoptica.showToast(window.t('settings.toast_save_failed', { message: err.message }), 'error');
    }
  }

  window.PanopticaPage = { init, destroy };
})();
