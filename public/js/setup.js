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

  // 8 wizard steps. Maps display index → step key (matches state.js
  // REQUIRED_STEPS + OPTIONAL_STEPS naming).
  // v0.1.13 — added 'app_reg' between hostname and entra. The app_reg
  // step is the modal-driven Entra app registration instructions.
  const WIZARD_STEPS = [
    { key: 'language',     i18nKey: 'setup.step.welcome',      renderer: renderWelcomeStep },
    { key: 'hostname',     i18nKey: 'setup.step.hostname',     renderer: renderHostnameStep },
    { key: 'app_reg',      i18nKey: 'setup.step.app_reg',      renderer: renderAppRegStep },
    { key: 'entra',        i18nKey: 'setup.step.entra',        renderer: renderEntraStep },
    { key: 'smtp',         i18nKey: 'setup.step.smtp',         renderer: renderSmtpStep },
    { key: 'anthropic',    i18nKey: 'setup.step.anthropic',    renderer: renderAnthropicStep },
    { key: 'license',      i18nKey: 'setup.step.license',      renderer: renderLicenseStep },
    { key: 'first_tenant', i18nKey: 'setup.step.first_tenant', renderer: renderFirstTenantStep },
  ];

  // ─── Permission catalog (v0.1.13) ──────────────────────────────────
  // Canonical list of Entra app-registration permissions Panoptica365
  // requires. Ordered to match the Entra portal's "Add permission" UI:
  // grouped by API, alphabetical within each. Source-of-truth: the
  // production Trilogiam app reg as of 2026-05-24 (53 + 1 + 2 + 2 = 58).
  // If a new feature adds a permission, add it here AND grant on Trilogiam.
  const PERMISSION_CATALOG = [
    {
      api: 'Microsoft Graph',
      application: [
        'Application.Read.All',
        'AuditLog.Read.All',
        'Device.Read.All',
        'DeviceManagementConfiguration.Read.All',
        'DeviceManagementConfiguration.ReadWrite.All',
        'DeviceManagementManagedDevices.Read.All',
        'DeviceManagementManagedDevices.ReadWrite.All',
        'Directory.Read.All',
        'Directory.ReadWrite.All',
        'Domain.Read.All',
        'Group.Read.All',
        'Group.ReadWrite.All',
        'HealthMonitoringAlert.Read.All',
        'IdentityProvider.Read.All',
        'IdentityRiskEvent.Read.All',
        'IdentityRiskyUser.Read.All',
        'InformationProtectionPolicy.Read.All',
        'LicenseAssignment.Read.All',
        'Mail.Read',
        'MailboxItem.Read.All',
        'MailboxSettings.Read',
        'Organization.Read.All',
        'Policy.Read.All',
        'Policy.Read.AuthenticationMethod',
        'Policy.Read.ConditionalAccess',
        'Policy.Read.DeviceConfiguration',
        'Policy.ReadWrite.AuthenticationMethod',
        'Policy.ReadWrite.Authorization',
        'Policy.ReadWrite.ConditionalAccess',
        'Policy.ReadWrite.DeviceConfiguration',
        'Policy.ReadWrite.SecurityDefaults',
        'Reports.Read.All',
        'RoleManagement.ReadWrite.Directory',
        'SecurityAlert.Read.All',
        'SecurityAnalyzedMessage.Read.All',
        'SecurityEvents.Read.All',
        'SecurityIncident.Read.All',
        'SharePointTenantSettings.Read.All',
        'SharePointTenantSettings.ReadWrite.All',
        'Sites.Read.All',
        'ThreatAssessment.Read.All',
        'ThreatHunting.Read.All',
        'ThreatIndicators.Read.All',
        'ThreatIntelligence.Read.All',
        'User.Read.All',
        'User.ReadWrite.All',
        'UserAuthenticationMethod.Read.All',
      ],
      delegated: [
        'email',
        'GroupMember.Read.All',
        'offline_access',
        'openid',
        'profile',
        'User.Read',
      ],
    },
    {
      api: 'Office 365 Exchange Online',
      application: ['Exchange.ManageAsApp'],
      delegated: [],
    },
    {
      api: 'Office 365 Management APIs',
      application: ['ActivityFeed.Read', 'ActivityFeed.ReadDlp'],
      delegated: [],
    },
    {
      api: 'Skype and Teams Tenant Admin API',
      application: ['application_access'],
      delegated: ['user_impersonation'],
    },
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

  // ─── Copy-to-clipboard helper (v0.1.13) ──────────────────────────────
  // Used by the app-reg modal for hostname, redirect URI, every permission
  // name, the three suggested group names, etc. Each `.setup-copy` element
  // has data-copy="value-to-copy" — we read that and write to clipboard.
  // Visual feedback: button briefly turns green via .copied class.
  async function copyToClipboard(value, btn) {
    try {
      await navigator.clipboard.writeText(value);
      if (btn) {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1200);
      }
      return true;
    } catch (e) {
      console.warn('[setup] clipboard write failed:', e.message);
      // Fallback: select the text so operator can Ctrl+C manually
      if (btn) {
        const range = document.createRange();
        range.selectNodeContents(btn);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return false;
    }
  }

  // Wire clipboard handlers for all .setup-copy elements within a container.
  function wireCopyButtons(container) {
    if (!container) return;
    container.querySelectorAll('.setup-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.copy;
        if (val) copyToClipboard(val, btn);
      });
    });
    container.querySelectorAll('.setup-copy-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.copy;
        if (val) copyToClipboard(val, btn);
      });
    });
  }

  // ─── App-Registration modal (v0.1.13) ────────────────────────────────
  // Big modal containing detailed Entra app-reg instructions. Triggered
  // from renderAppRegStep's "Open detailed instructions" button.
  function openAppRegModal() {
    const overlay = $('#setup-modal-overlay');
    const titleEl = $('#setup-modal-title');
    const bodyEl  = $('#setup-modal-body');
    if (!overlay || !bodyEl) return;

    titleEl.textContent = t('setup.app_reg.modal_title') || 'Entra App Registration — detailed instructions';

    // Read hostname from cache so the redirect URI is concrete
    const hostname = valueFor('hostname', 'hostname') || '<your-hostname>';
    const redirectUri = `https://${hostname}/auth/callback`;

    bodyEl.innerHTML = renderAppRegModalBody(redirectUri);
    applyI18n(bodyEl);
    wireCopyButtons(bodyEl);
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Scroll body to top in case it was previously scrolled
    bodyEl.scrollTop = 0;
  }

  function closeAppRegModal() {
    const overlay = $('#setup-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Wire one-time global modal handlers (close button + done button + ESC).
  // Called once from boot().
  function wireModalGlobals() {
    const overlay = $('#setup-modal-overlay');
    const closeBtn = $('#setup-modal-close');
    const doneBtn = $('#setup-modal-done');
    if (closeBtn) closeBtn.addEventListener('click', closeAppRegModal);
    if (doneBtn) {
      doneBtn.addEventListener('click', async () => {
        try {
          await apiPost('/api/setup/app-reg', {});
          closeAppRegModal();
          advance();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAppRegModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
        closeAppRegModal();
      }
    });
  }

  // Render a copy-button for a value. `value` is what gets put on clipboard;
  // `display` is the text shown in the button (defaults to value).
  function copyBtn(value, display) {
    const d = display == null ? value : display;
    return `<button type="button" class="setup-copy" data-copy="${esc(value)}" title="${esc(t('setup.app_reg.copy_tooltip') || 'Copy to clipboard')}"><span class="setup-copy-text">${esc(d)}</span> <span class="setup-copy-icon" aria-hidden="true">⧉</span></button>`;
  }

  // Build the modal body HTML. All copy is via t() so it's localized;
  // structural markup stays in JS so we don't have to maintain an HTML
  // template + a translation map. Tradeoff: longer JS file, simpler i18n.
  function renderAppRegModalBody(redirectUri) {
    let html = '';

    // ─── Intro ─────────────────────────────────────────────────────
    html += `<p data-i18n="setup.app_reg.intro">This is the longest step. Plan ~10-15 minutes. You'll need Global Admin access to your MSP's Entra tenant.</p>`;

    html += `<div class="setup-callout warn">
      <span class="setup-callout-icon">⚠</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.warn_global_admin"><strong>Sign in as a Global Administrator</strong> of your MSP's own Entra tenant. Anything less and several steps will fail with permission errors.</div>
    </div>`;

    // ─── Step 1: Create the app reg ────────────────────────────────
    html += `<h3>1. <span data-i18n="setup.app_reg.h_create">Create the App Registration</span></h3>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.create_1">Go to <a href="https://entra.microsoft.com" target="_blank" rel="noopener">entra.microsoft.com</a> → <strong>Applications</strong> → <strong>App registrations</strong> → <strong>New registration</strong>.</li>
      <li data-i18n-html="setup.app_reg.create_2"><strong>Name</strong>: <code>Panoptica365</code> (or whatever you want; the name is operator-only and doesn't affect anything).</li>
      <li data-i18n-html="setup.app_reg.create_3"><strong>Supported account types</strong>: <em>Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)</em>. This MUST be multi-tenant — your customers' tenants will grant consent against this app.</li>
      <li><span data-i18n-html="setup.app_reg.create_4"><strong>Redirect URI</strong>: pick <strong>Web</strong>, paste this exact value:</span> ${copyBtn(redirectUri)}</li>
      <li data-i18n="setup.app_reg.create_5">Click <strong>Register</strong>.</li>
    </ol>`;

    html += `<div class="setup-callout danger">
      <span class="setup-callout-icon">🛑</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.danger_single_tenant"><strong>Do NOT pick single-tenant.</strong> A single-tenant app reg cannot accept admin consent from customer tenants. If you picked the wrong type, delete the app reg and start over.</div>
    </div>`;

    // ─── Step 2: Grab IDs ──────────────────────────────────────────
    html += `<h3>2. <span data-i18n="setup.app_reg.h_grab_ids">Copy the Tenant ID and Application ID</span></h3>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.ids_1">On the new app's <strong>Overview</strong> page, find <strong>Directory (tenant) ID</strong> and <strong>Application (client) ID</strong>.</li>
      <li data-i18n="setup.app_reg.ids_2">Save them somewhere temporary (Notepad, 1Password, etc.) — you'll paste them into the next wizard step.</li>
    </ol>`;

    // ─── Step 3: Client secret ─────────────────────────────────────
    html += `<h3>3. <span data-i18n="setup.app_reg.h_secret">Create a Client Secret</span></h3>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.secret_1">In the left sidebar of your app, click <strong>Certificates &amp; secrets</strong> → <strong>Client secrets</strong> → <strong>New client secret</strong>.</li>
      <li data-i18n-html="setup.app_reg.secret_2"><strong>Description</strong>: <code>Panoptica365 setup</code>. <strong>Expires</strong>: pick whatever your security policy requires (24 months is typical).</li>
      <li data-i18n="setup.app_reg.secret_3">Click <strong>Add</strong>.</li>
      <li data-i18n="setup.app_reg.secret_4">Immediately copy the secret's <strong>Value</strong> column and save it. You'll paste it into the next wizard step.</li>
    </ol>`;

    html += `<div class="setup-callout danger">
      <span class="setup-callout-icon">🛑</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.danger_value_vs_id"><strong>Copy the VALUE, not the Secret ID.</strong> The "Value" column shows the actual secret <em>only once</em> at creation time — if you leave the page without copying it, you'll have to delete and re-create the secret. The "Secret ID" is a different field that looks similar but will NOT work.</div>
    </div>`;

    // ─── Step 4: API permissions ───────────────────────────────────
    html += `<h3>4. <span data-i18n="setup.app_reg.h_perms">Add API Permissions</span> <span style="color: var(--p-text-muted); font-weight: 400; font-size: 0.85em;">(58 total)</span></h3>`;
    html += `<p data-i18n-html="setup.app_reg.perms_intro">In your app's left sidebar, click <strong>API permissions</strong> → <strong>Add a permission</strong>. You'll add permissions from <strong>four different APIs</strong>. Within each API, Entra groups permissions alphabetically by category — the lists below follow that order so you can scroll down without searching.</p>`;

    html += `<div class="setup-callout warn">
      <span class="setup-callout-icon">⚠</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.warn_app_vs_delegated">For each API, you'll switch between the <strong>Application permissions</strong> tab and the <strong>Delegated permissions</strong> tab. Don't mix them up — the wrong tab gives you a perm with the same name but different semantics.</div>
    </div>`;

    // Render each API's permission lists
    for (const apiBlock of PERMISSION_CATALOG) {
      html += `<h4>${esc(apiBlock.api)}</h4>`;

      if (apiBlock.application && apiBlock.application.length > 0) {
        const all = apiBlock.application.join(', ');
        html += `<p style="margin-bottom: 4px;"><strong>${esc(t('setup.app_reg.perms_app_tab') || 'Application permissions')}</strong> (${apiBlock.application.length}):</p>`;
        html += `<button type="button" class="setup-copy-all" data-copy="${esc(all)}"><span>${esc(t('setup.app_reg.copy_all_perms', { count: apiBlock.application.length }) || `Copy all ${apiBlock.application.length}`)}</span> <span aria-hidden="true">⧉</span></button>`;
        html += `<div class="setup-perm-list">`;
        for (const p of apiBlock.application) {
          html += `<div class="setup-perm-row"><span class="setup-perm-name">${esc(p)}</span> ${copyBtn(p, '⧉')}</div>`;
        }
        html += `</div>`;
      }

      if (apiBlock.delegated && apiBlock.delegated.length > 0) {
        const all = apiBlock.delegated.join(', ');
        html += `<p style="margin-bottom: 4px;"><strong>${esc(t('setup.app_reg.perms_del_tab') || 'Delegated permissions')}</strong> (${apiBlock.delegated.length}):</p>`;
        html += `<button type="button" class="setup-copy-all" data-copy="${esc(all)}"><span>${esc(t('setup.app_reg.copy_all_perms', { count: apiBlock.delegated.length }) || `Copy all ${apiBlock.delegated.length}`)}</span> <span aria-hidden="true">⧉</span></button>`;
        html += `<div class="setup-perm-list">`;
        for (const p of apiBlock.delegated) {
          html += `<div class="setup-perm-row"><span class="setup-perm-name">${esc(p)}</span> ${copyBtn(p, '⧉')}</div>`;
        }
        html += `</div>`;
      }
    }

    // ─── Step 5: Grant admin consent ───────────────────────────────
    html += `<h3>5. <span data-i18n="setup.app_reg.h_consent">Grant Admin Consent</span></h3>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.consent_1">After adding all 58 permissions, click the <strong>Grant admin consent for &lt;your tenant&gt;</strong> button at the top of the API permissions table.</li>
      <li data-i18n="setup.app_reg.consent_2">Confirm in the popup. Wait a few seconds for Microsoft to process.</li>
      <li data-i18n-html="setup.app_reg.consent_3">Every permission row should now show a green checkmark in the <strong>Status</strong> column. If any are still amber/red, scroll down and click <strong>Grant admin consent</strong> again.</li>
    </ol>`;

    html += `<div class="setup-callout ok">
      <span class="setup-callout-icon">✅</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.ok_consent_check">When done, ALL 58 permissions should show <strong style="color: var(--p-ok);">green checkmarks</strong>. If any are missing, the Test Connection button on the next wizard step will tell you exactly which ones.</div>
    </div>`;

    // ─── Step 6: RBAC roles ────────────────────────────────────────
    html += `<h3>6. <span data-i18n="setup.app_reg.h_roles">Assign Entra Roles to the App's Service Principal</span></h3>`;
    html += `<p data-i18n-html="setup.app_reg.roles_intro">Panoptica365 uses PowerShell modules (Exchange Online + Compliance Center) for several security settings. These modules require Entra <strong>directory roles</strong> on top of the Graph permissions.</p>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.roles_1">In the Entra portal sidebar, go to <strong>Identity</strong> → <strong>Roles &amp; admins</strong> → <strong>Roles &amp; administrators</strong>.</li>
      <li data-i18n-html="setup.app_reg.roles_2">Search for <strong>Exchange Administrator</strong>. Click into the role.</li>
      <li data-i18n-html="setup.app_reg.roles_3">Click <strong>Add assignments</strong>. Search for <code>Panoptica365</code> (the name of your app reg) — it should appear as an enterprise application / service principal. Select it and click <strong>Add</strong>.</li>
      <li data-i18n-html="setup.app_reg.roles_4">Repeat for <strong>Compliance Administrator</strong>: search the role list, add assignment, search Panoptica365, add.</li>
    </ol>`;

    html += `<div class="setup-callout danger">
      <span class="setup-callout-icon">🛑</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.danger_role_names"><strong>Pick the EXACT role names</strong> — there are similar-sounding roles that will NOT work: <em>Exchange Recipient Administrator</em> (lesser scope), <em>Compliance Data Administrator</em> (lesser scope). Verify the name matches exactly <strong>Exchange Administrator</strong> and <strong>Compliance Administrator</strong>.</div>
    </div>`;

    // ─── Step 7: Three RBAC groups ─────────────────────────────────
    html += `<h3>7. <span data-i18n="setup.app_reg.h_groups">Create the Three RBAC Groups</span> <span style="color: var(--p-text-muted); font-weight: 400; font-size: 0.85em;">(optional but recommended)</span></h3>`;
    html += `<p data-i18n-html="setup.app_reg.groups_intro">Panoptica365 has three operator roles (admin / operator / viewer). Map each role to an Entra security group. Members of those groups get the corresponding role inside Panoptica365.</p>`;
    html += `<ol>
      <li data-i18n-html="setup.app_reg.groups_1">In the Entra portal sidebar, go to <strong>Identity</strong> → <strong>Groups</strong> → <strong>All groups</strong> → <strong>New group</strong>.</li>
      <li data-i18n-html="setup.app_reg.groups_2"><strong>Group type</strong>: Security. Create three groups with these suggested names:</li>
    </ol>`;
    html += `<ul style="margin-left: 16px;">
      <li>${copyBtn('Panoptica365 Admins')} — ${t('setup.app_reg.group_admin_desc') || 'full access to everything, including system + audit log'}</li>
      <li>${copyBtn('Panoptica365 Operators')} — ${t('setup.app_reg.group_operator_desc') || 'day-to-day work — alerts, deploys, settings (no destructive ops)'}</li>
      <li>${copyBtn('Panoptica365 Viewers')} — ${t('setup.app_reg.group_viewer_desc') || 'read-only access'}</li>
    </ul>`;
    html += `<p data-i18n="setup.app_reg.groups_naming_note">You can name them anything you want — the wizard will ask you for each group's Object ID, not its name.</p>`;
    html += `<ol start="3">
      <li data-i18n-html="setup.app_reg.groups_3">For each group, after creation, copy the <strong>Object Id</strong> from the group's Overview page. You'll paste them into the next wizard step (admin is recommended; operator + viewer are optional).</li>
      <li data-i18n="setup.app_reg.groups_4">Add yourself (and any colleagues) to the appropriate group(s).</li>
    </ol>`;

    html += `<div class="setup-callout warn">
      <span class="setup-callout-icon">⚠</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.warn_skip_groups">If you skip group creation entirely and leave all three Object ID fields blank in the next step, <strong>any</strong> authenticated user from your MSP tenant gets full Admin access in Panoptica365. That's fine for single-operator installs — risky for multi-person MSPs.</div>
    </div>`;

    // ─── Step 8: Recap ─────────────────────────────────────────────
    html += `<h3>8. <span data-i18n="setup.app_reg.h_recap">Recap — What You Should Have</span></h3>`;
    html += `<p data-i18n="setup.app_reg.recap_intro">Before closing this modal and continuing the wizard, make sure you have all of these:</p>`;
    html += `<ul>
      <li data-i18n-html="setup.app_reg.recap_1"><strong>Directory (tenant) ID</strong> — GUID from the app's Overview page</li>
      <li data-i18n-html="setup.app_reg.recap_2"><strong>Application (client) ID</strong> — GUID from the app's Overview page</li>
      <li data-i18n-html="setup.app_reg.recap_3"><strong>Client Secret Value</strong> — the long random string from "Certificates &amp; secrets" (NOT the Secret ID)</li>
      <li data-i18n-html="setup.app_reg.recap_4"><strong>Admin group Object ID</strong> (recommended) — GUID from the "Panoptica365 Admins" group's Overview</li>
      <li data-i18n-html="setup.app_reg.recap_5"><strong>Operator group Object ID</strong> (optional) — GUID from "Panoptica365 Operators"</li>
      <li data-i18n-html="setup.app_reg.recap_6"><strong>Viewer group Object ID</strong> (optional) — GUID from "Panoptica365 Viewers"</li>
    </ul>`;

    html += `<div class="setup-callout ok">
      <span class="setup-callout-icon">✅</span>
      <div class="setup-callout-body" data-i18n-html="setup.app_reg.ok_close_modal">When you have those values, click <strong>I've completed the steps above</strong> at the bottom of this modal. The next wizard step is where you'll paste them, and a <strong>Test Connection</strong> button there will validate every permission was granted correctly.</div>
    </div>`;

    return html;
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

  // Step 3 (v0.1.13+): App Registration — small card with a "Open
  // detailed instructions" button. The actual instructions live in the
  // large modal (openAppRegModal). Two ways out of this step:
  //   - Click "Open detailed instructions" → modal → walk through → click
  //     "I've completed the steps above" in modal footer → modal POSTs
  //     /api/setup/app-reg + advances.
  //   - Click "I already have an app reg — skip" → POST /api/setup/app-reg
  //     immediately + advance. For operators who provisioned the app reg
  //     via a script or are reinstalling.
  function renderAppRegStep(container) {
    container.innerHTML = `
      <header class="setup-step-header">
        <h2 class="setup-step-title" data-i18n="setup.app_reg.title">Entra App Registration</h2>
        <p class="setup-step-subtitle" data-i18n="setup.app_reg.subtitle">The longest step — ~10-15 minutes of Entra portal work.</p>
      </header>
      <div class="setup-step-body">
        <p data-i18n="setup.app_reg.summary">Before you can paste credentials in the next step, you need an Entra app registration in your MSP's own tenant. The detailed instructions walk you through every click, with copy-to-clipboard buttons for every value and warnings around the easy-to-miss steps.</p>
        <div style="display: flex; flex-direction: column; gap: 10px; align-items: stretch; margin-top: 8px;">
          <button type="button" class="setup-btn setup-btn-primary" data-action="open-modal" data-i18n="setup.app_reg.open_modal_btn">Open detailed instructions</button>
          <button type="button" class="setup-btn setup-btn-secondary" data-action="skip-app-reg" data-i18n="setup.app_reg.skip_btn">I already have an app reg — skip to credentials</button>
        </div>
      </div>
      ${renderFooter({ backDisabled: false, primaryAction: null })}
    `;
    // Hide the default primary "Save & Continue" — this step has its
    // own two custom buttons (Open modal / Skip). Operator advances via
    // the modal's "Done" button OR the Skip button.
    const primary = container.querySelector('[data-action="primary"]');
    if (primary) primary.style.display = 'none';

    wireFooter(container, {});  // wires Back only

    container.querySelector('[data-action="open-modal"]').addEventListener('click', () => {
      openAppRegModal();
    });
    container.querySelector('[data-action="skip-app-reg"]').addEventListener('click', async () => {
      try {
        await apiPost('/api/setup/app-reg', {});
        advance();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  // Step 4: Entra credentials paste
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
          <label for="setup-entra-admin-group" data-i18n="setup.entra.label_admin_group">Panoptica365 Admins group — Object ID (recommended)</label>
          <p class="hint" data-i18n-html="setup.entra.hint_admin_group">Members of this Entra group get the <strong>Admin</strong> role in Panoptica365. Leave blank to allow all authenticated users (single-operator setup).</p>
          <input type="text" id="setup-entra-admin-group" name="admin_group_id" placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'admin_group_id'))}">
        </div>
        <div class="setup-field">
          <label for="setup-entra-member-group" data-i18n="setup.entra.label_member_group">Panoptica365 Operators group — Object ID (optional)</label>
          <p class="hint" data-i18n-html="setup.entra.hint_member_group">Members get the <strong>Operator</strong> role — can clear alerts, deploy templates, generate reports. Leave blank to skip the Operator tier.</p>
          <input type="text" id="setup-entra-member-group" name="member_group_id" placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'member_group_id'))}">
        </div>
        <div class="setup-field">
          <label for="setup-entra-viewer-group" data-i18n="setup.entra.label_viewer_group">Panoptica365 Viewers group — Object ID (optional)</label>
          <p class="hint" data-i18n-html="setup.entra.hint_viewer_group">Members get the <strong>Viewer</strong> role — read-only access. Leave blank to skip the Viewer tier.</p>
          <input type="text" id="setup-entra-viewer-group" name="viewer_group_id" placeholder="00000000-0000-0000-0000-000000000000" value="${esc(valueFor('entra', 'viewer_group_id'))}">
        </div>
        <p class="hint" style="margin-top: 4px;"><a href="#" id="setup-entra-reopen-modal" data-i18n="setup.entra.reopen_modal_link">→ Reopen the App Registration instructions modal</a></p>
        <div id="setup-entra-status"></div>
      </div>
      ${renderFooter({
        secondaryButtons: [{ action: 'test-connection', i18nKey: 'setup.entra.test_connection_btn' }],
        primaryKey: 'setup.button.save_and_continue',
      })}
    `;
    const status = container.querySelector('#setup-entra-status');

    function readEntraForm() {
      const body = {
        tenant_id: container.querySelector('#setup-entra-tenant').value.trim(),
        client_id: container.querySelector('#setup-entra-client').value.trim(),
        client_secret: container.querySelector('#setup-entra-secret').value.trim(),
      };
      const adminGroup = container.querySelector('#setup-entra-admin-group').value.trim();
      const memberGroup = container.querySelector('#setup-entra-member-group').value.trim();
      const viewerGroup = container.querySelector('#setup-entra-viewer-group').value.trim();
      if (adminGroup)  body.admin_group_id = adminGroup;
      if (memberGroup) body.member_group_id = memberGroup;
      if (viewerGroup) body.viewer_group_id = viewerGroup;
      return body;
    }

    async function saveEntra() {
      const body = readEntraForm();
      stepValues.entra = {
        ...body,
        admin_group_id: container.querySelector('#setup-entra-admin-group').value.trim(),
        member_group_id: container.querySelector('#setup-entra-member-group').value.trim(),
        viewer_group_id: container.querySelector('#setup-entra-viewer-group').value.trim(),
      };
      await apiPost('/api/setup/entra', body);
    }

    // "Reopen instructions" link — bring back the big modal in case the
    // operator forgot a step. Doesn't trigger app-reg ack (already done
    // when they got to this step).
    container.querySelector('#setup-entra-reopen-modal').addEventListener('click', (e) => {
      e.preventDefault();
      openAppRegModal();
      // Hide the modal's "Done" button while reopening — they've already
      // ack'd the step. Just let them re-read + close via X or ESC.
      const doneBtn = $('#setup-modal-done');
      if (doneBtn) doneBtn.style.display = 'none';
      // Restore on next close
      const overlay = $('#setup-modal-overlay');
      const restore = () => {
        if (doneBtn) doneBtn.style.display = '';
        overlay.removeEventListener('transitionend', restore);
      };
      overlay.addEventListener('transitionend', restore);
    });

    wireFooter(container, {
      primaryAction: async () => {
        await saveEntra();
        advance();
      },
      secondaryActions: {
        'test-connection': async () => {
          await saveEntra();
          status.innerHTML = `<div class="setup-status-line info">${esc(t('setup.entra.testing') || 'Testing credentials + permissions…')}</div>`;
          try {
            const res = await apiPost('/api/setup/entra/test', {});
            if (res.ok) {
              status.innerHTML = `<div class="setup-status-line success">✅ ${esc(res.message || t('setup.entra.test_ok') || 'All permissions OK.')}</div>`;
            } else {
              const list = (res.failed_permissions || []).map(p => `<li><code>${esc(p)}</code></li>`).join('');
              status.innerHTML = `<div class="setup-status-line error">
                <div>
                  <strong>${esc(t('setup.entra.test_partial', { failed: res.checks_failed, total: res.checks_performed }) || `${res.checks_failed} of ${res.checks_performed} permission checks failed`)}</strong>
                  <ul style="margin: 8px 0 4px 18px;">${list}</ul>
                  <p style="margin: 4px 0 0 0; font-size: 0.85rem;">${esc(res.hint || '')}</p>
                </div>
              </div>`;
            }
          } catch (e) {
            // Token-acquisition failures land here (401 from MS) with a structured body
            const hint = e.body?.hint || '';
            const code = e.body?.ms_error_code ? ` (${e.body.ms_error_code})` : '';
            status.innerHTML = `<div class="setup-status-line error">
              <div>
                <strong>${esc(t('setup.entra.test_cred_fail') || 'Credential test failed')}${esc(code)}</strong><br>
                <span style="font-size: 0.9rem;">${esc(e.message)}</span><br>
                ${hint ? `<p style="margin: 4px 0 0 0; font-size: 0.85rem;">${esc(hint)}</p>` : ''}
              </div>
            </div>`;
          }
        },
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

    // 3. Wire global modal handlers (close button + done button + ESC + overlay click).
    // One-time setup; modal stays in DOM permanently, opens/closes via .open class.
    wireModalGlobals();

    // 4. Render current step
    renderCurrentStep();
  }

  // Kick it off after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
