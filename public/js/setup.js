/**
 * Panoptica365 — First-Boot Setup Wizard
 * (v0.1.10+, Stage 4 Part B)
 *
 * Standalone SPA-ish wizard that walks the operator through the 6
 * required + 1 optional setup steps. Backed by /api/setup/* endpoints
 * implemented in src/routes/api-setup.js. Once the operator finishes,
 * the wizard POSTs /api/setup/complete and redirects to / (the main
 * dashboard).
 *
 * Architecture: single IIFE, no framework. State machine in module
 * scope (currentStep, setupStateCache). Step renderers each produce
 * HTML into #setup-content + wire up their own form-submit handler.
 *
 * i18n: all copy comes from window.t() / locale files (setup.* namespace).
 * Language picker in the header lets the operator switch at any step.
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────

  // 7 wizard steps. Maps display index → step key (matches state.js
  // REQUIRED_STEPS + OPTIONAL_STEPS naming).
  const WIZARD_STEPS = [
    { key: 'language',     i18nKey: 'setup.step.welcome',      renderer: renderWelcomeStep },
    { key: 'hostname',     i18nKey: 'setup.step.hostname',     renderer: renderHostnameStep },
    { key: 'entra',        i18nKey: 'setup.step.entra',        renderer: renderEntraStep },
    { key: 'smtp',         i18nKey: 'setup.step.smtp',         renderer: renderSmtpStep },
    { key: 'anthropic',    i18nKey: 'setup.step.anthropic',    renderer: renderAnthropicStep },
    { key: 'license',      i18nKey: 'setup.step.license',      renderer: renderLicenseStep },
    { key: 'first_tenant', i18nKey: 'setup.step.first_tenant', renderer: renderFirstTenantStep },
  ];

  let currentStepIdx = 0;     // 0-indexed into WIZARD_STEPS
  let setupStateCache = null; // cached server state

  // Per-step form values cached in module scope so the Back button can
  // restore everything the operator typed (including long GUIDs + secrets).
  // Browser-memory only — wiped on page reload. Not a new secret-exposure
  // vector because anyone with DevTools could already inspect the form
  // submission. Shape: { hostname: {hostname, letsencrypt_email}, entra:
  // {tenant_id, ...}, smtp: {...}, anthropic: {...}, license: {...} }.
  // v0.1.11 — fix for Back-button-wipes-form-values reported during P365-Test.
  const stepValues = {};

  // Read a previously-entered value for prefill. Returns '' if not cached.
  function valueFor(stepKey, fieldName) {
    return (stepValues[stepKey] && stepValues[stepKey][fieldName]) || '';
  }

  // ─── DOM helpers ───────────────────────────────────────────────────

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // i18n shim: fall back to literal if i18n hasn't loaded yet.
  function t(key, params) {
    if (window.t) return window.t(key, params);
    return key; // visibly broken fallback so missing keys are obvious
  }

  function applyI18n(root) {
    if (window.PanopticaI18n && typeof window.PanopticaI18n.applyTo === 'function') {
      window.PanopticaI18n.applyTo(root || document);
    }
  }

  // ─── Toast ─────────────────────────────────────────────────────────

  let _toastTimer = null;
  function showToast(message, type) {
    const el = $('#setup-toast');
    if (!el) return;
    el.className = 'setup-toast' + (type ? ' ' + type : '');
    el.textContent = message;
    el.hidden = false;
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ─── API ───────────────────────────────────────────────────────────

  async function apiGet(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* */ }
      const err = new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      err.body = body;
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      let respBody = null;
      try { respBody = await res.json(); } catch { /* */ }
      const err = new Error(respBody?.detail || respBody?.error || `HTTP ${res.status}`);
      err.body = respBody;
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ─── Language picker ───────────────────────────────────────────────

  const SUPPORTED_LANGS = ['en', 'fr', 'es'];

  function detectInitialLanguage() {
    // URL ?lang= wins (link sharing)
    const urlLang = new URLSearchParams(location.search).get('lang');
    if (SUPPORTED_LANGS.includes(urlLang)) return urlLang;
    // localStorage (carried across reloads within session)
    const stored = localStorage.getItem('panoptica365-setup-lang');
    if (SUPPORTED_LANGS.includes(stored)) return stored;
    // Browser preference
    const nav = (navigator.language || 'en').toLowerCase().split('-')[0];
    if (SUPPORTED_LANGS.includes(nav)) return nav;
    return 'en';
  }

  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    localStorage.setItem('panoptica365-setup-lang', lang);
    document.documentElement.lang = lang;
    if (window.PanopticaI18n && typeof window.PanopticaI18n.setLang === 'function') {
      await window.PanopticaI18n.setLang(lang);
    }
    paintLangPicker(lang);
    // Re-render the current step in the new language
    renderCurrentStep();
  }

  function paintLangPicker(activeLang) {
    const el = $('#setup-lang-picker');
    if (!el) return;
    el.innerHTML = SUPPORTED_LANGS.map(l =>
      `<button type="button" data-lang="${l}" class="${l === activeLang ? 'active' : ''}">${l.toUpperCase()}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });
  }

  // ─── Stepper ───────────────────────────────────────────────────────

  function paintStepper() {
    const el = $('#setup-stepper');
    if (!el) return;
    el.innerHTML = WIZARD_STEPS.map((step, idx) => {
      let cls = 'setup-step-dot';
      if (idx === currentStepIdx) cls += ' current';
      else if (idx < currentStepIdx) cls += ' completed';
      return `
        <div class="${cls}" aria-current="${idx === currentStepIdx ? 'step' : 'false'}">
          <span class="num">${idx + 1}</span>
          <span class="label" data-i18n="${step.i18nKey}">${esc(step.key)}</span>
        </div>
      `;
    }).join('');
    applyI18n(el);
  }

  // ─── Step navigation ───────────────────────────────────────────────

  function advance() {
    if (currentStepIdx < WIZARD_STEPS.length - 1) {
      currentStepIdx++;
      renderCurrentStep();
    }
  }

  function goBack() {
    if (currentStepIdx > 0) {
      currentStepIdx--;
      renderCurrentStep();
    }
  }

  function renderCurrentStep() {
    paintStepper();
    const container = $('#setup-content');
    if (!container) return;
    const step = WIZARD_STEPS[currentStepIdx];
    container.innerHTML = '';
    step.renderer(container, setupStateCache, currentStepIdx);
    applyI18n(container);
    // Scroll the new step to top in case the previous one was tall
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Standard footer (Back/Skip/Next) builder ──────────────────────

  function renderFooter(opts) {
    // opts: { backDisabled, skipKey, primaryKey, primaryAction, secondaryButtons }
    // Returns HTML for the footer + wires up handlers via a setup function
    const showBack = currentStepIdx > 0;
    const html = `
      <div class="setup-actions">
        <div class="setup-actions-left">
          ${showBack && !opts.backDisabled
            ? `<button type="button" class="setup-btn setup-btn-secondary" data-action="back" data-i18n="setup.button.back">Back</button>`
            : '<span></span>'}
        </div>
        <div class="setup-actions-right">
          ${(opts.secondaryButtons || []).map(b =>
            `<button type="button" class="setup-btn" data-action="${esc(b.action)}" data-i18n="${esc(b.i18nKey)}">${esc(b.label || b.action)}</button>`
          ).join('')}
          ${opts.skipKey
            ? `<button type="button" class="setup-btn setup-btn-secondary" data-action="skip" data-i18n="${esc(opts.skipKey)}">Skip</button>`
            : ''}
          <button type="button" class="setup-btn setup-btn-primary" data-action="primary" data-i18n="${esc(opts.primaryKey || 'setup.button.next')}">Save & Continue</button>
        </div>
      </div>
    `;
    return html;
  }

  function wireFooter(container, opts) {
    const back = container.querySelector('[data-action="back"]');
    if (back) back.addEventListener('click', goBack);
    const primary = container.querySelector('[data-action="primary"]');
    if (primary && opts.primaryAction) {
      primary.addEventListener('click', async (e) => {
        e.preventDefault();
        primary.disabled = true;
        const oldText = primary.textContent;
        primary.textContent = t('common.loading') || 'Loading…';
        try {
          await opts.primaryAction();
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          primary.disabled = false;
          primary.textContent = oldText;
        }
      });
    }
    const skip = container.querySelector('[data-action="skip"]');
    if (skip && opts.skipAction) {
      skip.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await opts.skipAction(); } catch (err) { showToast(err.message, 'error'); }
      });
    }
    if (opts.secondaryActions) {
      for (const [action, fn] of Object.entries(opts.secondaryActions)) {
        const btn = container.querySelector(`[data-action="${action}"]`);
        if (btn) {
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            const oldText = btn.textContent;
            btn.textContent = t('common.loading') || 'Loading…';
            try { await fn(); }
            catch (err) { showToast(err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = oldText; }
          });
        }
      }
    }
  }

  // ─── STEP RENDERERS ────────────────────────────────────────────────

  // Step 1: Welcome + language confirmation
  function renderWelcomeStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.welcome.title">Welcome to Panoptica365</h2>
        <p class="setup-step-subtitle" data-i18n="setup.welcome.subtitle">Let's get your install configured.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n="setup.welcome.body">This wizard walks you through 7 steps to configure your Panoptica365 install. You will need your hostname, Entra (Azure AD) app registration credentials, SMTP details, an Anthropic API key, and your Panoptica365 license activation key. Estimated time: 10-15 minutes.</p>
        <p data-i18n="setup.welcome.lang_note">Use the language picker in the top-right to change the wizard's language at any time. Your selection will be saved as your operator preference after setup completes.</p>
      </div>
      ${renderFooter({ primaryKey: 'setup.button.get_started' })}
    `;
    wireFooter(container, {
      primaryAction: async () => {
        const lang = localStorage.getItem('panoptica365-setup-lang') || 'en';
        await apiPost('/api/setup/language', { language: lang });
        advance();
      },
    });
  }

  // Step 2: Hostname + Let's Encrypt email
  function renderHostnameStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.hostname.title">Hostname &amp; TLS</h2>
        <p class="setup-step-subtitle" data-i18n="setup.hostname.subtitle">The public hostname where Panoptica365 will be reachable.</p>
      </header>
      <div class="setup-step-body">
        <div class="setup-field">
          <label for="setup-hostname" data-i18n="setup.hostname.label_hostname">Hostname</label>
          <p class="hint" data-i18n-html="setup.hostname.hint_hostname">The fully qualified domain name pointing at this server (e.g. <code>panoptica.your-msp.com</code>). Caddy will auto-provision a Let's Encrypt TLS certificate.</p>
          <input type="text" id="setup-hostname" name="hostname" required placeholder="panoptica.your-msp.com" value="${esc(valueFor('hostname', 'hostname'))}">
        </div>
        <div class="setup-field">
          <label for="setup-letsencrypt-email" data-i18n="setup.hostname.label_email">Let's Encrypt contact email</label>
          <p class="hint" data-i18n="setup.hostname.hint_email">Used by Let's Encrypt for certificate-expiry warnings (rare, but important).</p>
          <input type="email" id="setup-letsencrypt-email" name="letsencrypt_email" required placeholder="admin@your-msp.com" value="${esc(valueFor('hostname', 'letsencrypt_email'))}">
        </div>
      </div>
      ${renderFooter({})}
    `;
    wireFooter(container, {
      primaryAction: async () => {
        const hostname = container.querySelector('#setup-hostname').value.trim();
        const email = container.querySelector('#setup-letsencrypt-email').value.trim();
        if (!hostname || !email) {
          showToast(t('setup.error.required_fields') || 'Please fill both fields.', 'error');
          return;
        }
        stepValues.hostname = { hostname, letsencrypt_email: email };
        await apiPost('/api/setup/hostname', { hostname, letsencrypt_email: email });
        advance();
      },
    });
  }

  // Step 3: Entra app registration
  function renderEntraStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.entra.title">Microsoft Entra (Azure AD)</h2>
        <p class="setup-step-subtitle" data-i18n="setup.entra.subtitle">Operator login + customer-tenant access.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n-html="setup.entra.intro">Panoptica365 needs an Entra app registration in your MSP's own tenant. Create one at <a href="https://entra.microsoft.com" target="_blank" rel="noopener">entra.microsoft.com</a> as a multi-tenant app with redirect URI <code>https://&lt;your hostname&gt;/auth/callback</code>. Paste the values below.</p>
        <div class="setup-field">
          <label for="setup-entra-tenant" data-i18n="setup.entra.label_tenant">Tenant ID (GUID)</label>
          <input type="text" id="setup-entra-tenant" name="tenant_id" required placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'tenant_id'))}">
        </div>
        <div class="setup-field">
          <label for="setup-entra-client" data-i18n="setup.entra.label_client">Client ID (GUID)</label>
          <input type="text" id="setup-entra-client" name="client_id" required placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'client_id'))}">
        </div>
        <div class="setup-field">
          <label for="setup-entra-secret" data-i18n="setup.entra.label_secret">Client Secret</label>
          <p class="hint" data-i18n="setup.entra.hint_secret">The secret value (not the secret ID). Visible only at creation time in the Entra portal.</p>
          <input type="password" id="setup-entra-secret" name="client_secret" required value="${esc(valueFor('entra', 'client_secret'))}">
        </div>
        <div class="setup-field">
          <label for="setup-entra-admin-group" data-i18n="setup.entra.label_admin_group">Admin group Object ID (optional)</label>
          <p class="hint" data-i18n="setup.entra.hint_admin_group">Members of this Entra group get admin role in Panoptica365. Leave blank to allow all authenticated users (single-operator setup).</p>
          <input type="text" id="setup-entra-admin-group" name="admin_group_id" placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'admin_group_id'))}">
        </div>
      </div>
      ${renderFooter({})}
    `;
    wireFooter(container, {
      primaryAction: async () => {
        const body = {
          tenant_id: container.querySelector('#setup-entra-tenant').value.trim(),
          client_id: container.querySelector('#setup-entra-client').value.trim(),
          client_secret: container.querySelector('#setup-entra-secret').value.trim(),
        };
        const adminGroup = container.querySelector('#setup-entra-admin-group').value.trim();
        if (adminGroup) body.admin_group_id = adminGroup;
        stepValues.entra = { ...body, admin_group_id: adminGroup };
        await apiPost('/api/setup/entra', body);
        advance();
      },
    });
  }

  // Step 4: SMTP + test
  function renderSmtpStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.smtp.title">Email (SMTP)</h2>
        <p class="setup-step-subtitle" data-i18n="setup.smtp.subtitle">Used for alert notifications + daily summary.</p>
      </header>
      <div class="setup-step-body">
        <div class="setup-field">
          <label for="setup-smtp-host" data-i18n="setup.smtp.label_host">SMTP host</label>
          <input type="text" id="setup-smtp-host" name="host" required placeholder="mail.smtp2go.com" value="${esc(valueFor('smtp', 'host'))}">
        </div>
        <div class="setup-field-row">
          <div class="setup-field">
            <label for="setup-smtp-port" data-i18n="setup.smtp.label_port">Port</label>
            <input type="number" id="setup-smtp-port" name="port" required value="${esc(valueFor('smtp', 'port') || '2525')}" min="1" max="65535">
          </div>
          <div class="setup-field">
            <label for="setup-smtp-from" data-i18n="setup.smtp.label_from">From address</label>
            <input type="email" id="setup-smtp-from" name="from" required placeholder="alerts@your-msp.com" value="${esc(valueFor('smtp', 'from'))}">
          </div>
        </div>
        <div class="setup-field">
          <label for="setup-smtp-user" data-i18n="setup.smtp.label_user">SMTP username</label>
          <input type="text" id="setup-smtp-user" name="user" required value="${esc(valueFor('smtp', 'user'))}">
        </div>
        <div class="setup-field">
          <label for="setup-smtp-pass" data-i18n="setup.smtp.label_pass">SMTP password</label>
          <input type="password" id="setup-smtp-pass" name="password" required value="${esc(valueFor('smtp', 'password'))}">
        </div>
        <div class="setup-field">
          <label for="setup-smtp-test-to" data-i18n="setup.smtp.label_test_to">Send test email to (optional but recommended)</label>
          <input type="email" id="setup-smtp-test-to" name="test_to" placeholder="your-email@your-msp.com" value="${esc(valueFor('smtp', 'test_to'))}">
        </div>
        <div id="setup-smtp-status"></div>
      </div>
      ${renderFooter({
        secondaryButtons: [{ action: 'save-and-test', i18nKey: 'setup.button.save_and_test' }],
        primaryKey: 'setup.button.save_and_continue',
      })}
    `;
    const status = container.querySelector('#setup-smtp-status');

    async function saveSmtp() {
      const body = {
        host: container.querySelector('#setup-smtp-host').value.trim(),
        port: container.querySelector('#setup-smtp-port').value.trim(),
        user: container.querySelector('#setup-smtp-user').value.trim(),
        password: container.querySelector('#setup-smtp-pass').value,
        from: container.querySelector('#setup-smtp-from').value.trim(),
      };
      const testTo = container.querySelector('#setup-smtp-test-to').value.trim();
      stepValues.smtp = { ...body, test_to: testTo };
      await apiPost('/api/setup/smtp', body);
    }

    wireFooter(container, {
      primaryAction: async () => {
        await saveSmtp();
        advance();
      },
      secondaryActions: {
        'save-and-test': async () => {
          await saveSmtp();
          const testTo = container.querySelector('#setup-smtp-test-to').value.trim();
          if (!testTo) {
            status.innerHTML = `<div class="setup-status-line error">${esc(t('setup.smtp.test_no_to') || 'Enter a destination email address first.')}</div>`;
            return;
          }
          try {
            const res = await apiPost('/api/setup/smtp/test', { to_email: testTo });
            status.innerHTML = `<div class="setup-status-line success">${esc(t('setup.smtp.test_ok', { to: res.sent_to }) || `Test email sent to ${res.sent_to}. Check your inbox.`)}</div>`;
          } catch (e) {
            status.innerHTML = `<div class="setup-status-line error">${esc(t('setup.smtp.test_failed', { detail: e.message }) || `Test failed: ${e.message}`)}</div>`;
          }
        },
      },
    });
  }

  // Step 5: Anthropic + test
  function renderAnthropicStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.anthropic.title">Anthropic (Claude AI)</h2>
        <p class="setup-step-subtitle" data-i18n="setup.anthropic.subtitle">Powers alert analysis + daily summary + the Ask Claude widget.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n-html="setup.anthropic.intro">Get an API key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. Estimated monthly cost across ~15 tenants: $5-15.</p>
        <div class="setup-field">
          <label for="setup-anthropic-key" data-i18n-html="setup.anthropic.label_key">API key (starts with <code>sk-ant-</code>)</label>
          <input type="password" id="setup-anthropic-key" name="api_key" required placeholder="sk-ant-..." value="${esc(valueFor('anthropic', 'api_key'))}">
        </div>
        <div id="setup-anthropic-status"></div>
      </div>
      ${renderFooter({
        secondaryButtons: [{ action: 'save-and-test', i18nKey: 'setup.button.save_and_test' }],
        primaryKey: 'setup.button.save_and_continue',
      })}
    `;
    const status = container.querySelector('#setup-anthropic-status');

    async function saveAnthropic() {
      const key = container.querySelector('#setup-anthropic-key').value.trim();
      stepValues.anthropic = { api_key: key };
      await apiPost('/api/setup/anthropic', { api_key: key });
    }

    wireFooter(container, {
      primaryAction: async () => {
        await saveAnthropic();
        advance();
      },
      secondaryActions: {
        'save-and-test': async () => {
          await saveAnthropic();
          try {
            await apiPost('/api/setup/anthropic/test', {});
            status.innerHTML = `<div class="setup-status-line success">${esc(t('setup.anthropic.test_ok') || 'Anthropic API key works. Test call succeeded.')}</div>`;
          } catch (e) {
            status.innerHTML = `<div class="setup-status-line error">${esc(t('setup.anthropic.test_failed', { detail: e.message }) || `Test failed: ${e.message}`)}</div>`;
          }
        },
      },
    });
  }

  // Step 6: License activation
  function renderLicenseStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.license.title">License Activation</h2>
        <p class="setup-step-subtitle" data-i18n="setup.license.subtitle">Activate this install against the Panoptica365 license server.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n-html="setup.license.intro">Paste the 24-character activation key from your Panoptica365 license email (format: <code>PNX-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF</code> or just the raw 24 chars). The wizard will exchange it for a license token and persist it to <code>.env</code>.</p>
        <div class="setup-field">
          <label for="setup-license-key" data-i18n="setup.license.label_key">Activation key</label>
          <input type="text" id="setup-license-key" name="activation_key" required placeholder="PNX-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF" value="${esc(valueFor('license', 'activation_key'))}">
        </div>
        <div id="setup-license-status"></div>
      </div>
      ${renderFooter({})}
    `;
    const status = container.querySelector('#setup-license-status');

    wireFooter(container, {
      primaryAction: async () => {
        const key = container.querySelector('#setup-license-key').value.trim();
        if (!key) {
          showToast(t('setup.error.required_fields') || 'Activation key is required.', 'error');
          return;
        }
        stepValues.license = { activation_key: key };
        status.innerHTML = `<div class="setup-status-line info">${esc(t('setup.license.activating') || 'Contacting license server…')}</div>`;
        try {
          const res = await apiPost('/api/setup/license', { activation_key: key });
          status.innerHTML = `<div class="setup-status-line success">${esc(
            t('setup.license.activated', { msp: res.msp_name, mode: res.billing_mode, seats: res.max_seats })
              || `Activated for ${res.msp_name} — ${res.billing_mode} license, ${res.max_seats} seats.`
          )}</div>`;
          // Give the operator a beat to see the success line, then advance.
          setTimeout(advance, 1200);
        } catch (e) {
          status.innerHTML = `<div class="setup-status-line error">${esc(
            t('setup.license.failed', { detail: e.message })
              || `Activation failed: ${e.message}`
          )}</div>`;
        }
      },
    });
  }

  // Step 7: First tenant (optional) → wizard complete
  function renderFirstTenantStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.first_tenant.title">Add Your First Customer Tenant</h2>
        <p class="setup-step-subtitle" data-i18n="setup.first_tenant.subtitle">Optional — you can do this after setup completes.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n="setup.first_tenant.intro">Panoptica365 monitors your customers' Microsoft 365 tenants. To start, you can grant admin consent to your first customer tenant now (you will be redirected to Microsoft, then back to the Panoptica365 dashboard), or skip this step and add tenants later from the Tenants page.</p>
        <p data-i18n="setup.first_tenant.complete_note">When you click either button below, the wizard will mark setup complete. Subsequent boots will go straight to the dashboard.</p>
      </div>
      ${renderFooter({
        skipKey: 'setup.button.skip_and_finish',
        primaryKey: 'setup.button.add_tenant_and_finish',
      })}
    `;
    wireFooter(container, {
      primaryAction: async () => {
        // Mark setup complete server-side, then redirect to admin consent flow.
        await apiPost('/api/setup/complete', {});
        showToast(t('setup.toast.setup_complete') || 'Setup complete. Redirecting to admin consent…', 'success');
        setTimeout(() => { window.location.href = '/auth/adminconsent'; }, 800);
      },
      skipAction: async () => {
        await apiPost('/api/setup/skip/first_tenant', {});
        await apiPost('/api/setup/complete', {});
        showToast(t('setup.toast.setup_complete_redirect') || 'Setup complete. Redirecting to dashboard…', 'success');
        setTimeout(() => { window.location.href = '/'; }, 800);
      },
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────

  async function boot() {
    // 1. Language: detect + apply
    const initialLang = detectInitialLanguage();
    document.documentElement.lang = initialLang;
    paintLangPicker(initialLang);
    if (window.PanopticaI18n && typeof window.PanopticaI18n.setLang === 'function') {
      try { await window.PanopticaI18n.setLang(initialLang); } catch { /* fall back to en */ }
    }
    // Otherwise wait for the i18n ready promise if exposed
    if (window.PanopticaI18n && window.PanopticaI18n.ready) {
      try { await window.PanopticaI18n.ready; } catch { /* */ }
    }

    // 2. Fetch current setup state — server tells us which step to resume at
    try {
      const data = await apiGet('/api/setup/state');
      setupStateCache = data.state;
      // Compute resume index — first incomplete required step
      let resumeIdx = 0;
      for (let i = 0; i < WIZARD_STEPS.length; i++) {
        const stepKey = WIZARD_STEPS[i].key;
        const stepData = data.state.steps[stepKey];
        if (!stepData || (!stepData.complete && !stepData.skipped)) {
          resumeIdx = i;
          break;
        }
        // All steps complete? Land on last step (first_tenant) for finish.
        if (i === WIZARD_STEPS.length - 1) resumeIdx = i;
      }
      currentStepIdx = resumeIdx;
    } catch (e) {
      // 403 means setup is already complete; redirect to dashboard.
      if (e.status === 403) {
        window.location.href = '/';
        return;
      }
      showToast(t('setup.error.boot') || `Setup failed to load: ${e.message}`, 'error');
      return;
    }

    // 3. Render current step
    renderCurrentStep();
  }

  // Kick it off after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
