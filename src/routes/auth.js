/**
 * Panoptica — Auth Routes
 * /auth/login, /auth/callback, /auth/logout
 * /auth/adminconsent, /auth/adminconsent/callback
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../auth');
const db = require('../db/database');
const mspAudit = require('../msp-audit');
const usersStore = require('../users-store');
const versionInfo = require('../version');
const updateChecker = require('../lib/update/update-checker');

const router = express.Router();

// ─── User Login (Panoptica UI access) ───

router.get('/login', async (req, res) => {
  try {
    const state = uuidv4();
    req.session.authState = state;
    const authUrl = await auth.getAuthUrl(state);
    res.redirect(authUrl);
  } catch (err) {
    console.error('[Auth] Login redirect failed:', err.message);
    res.status(500).send('Authentication service unavailable');
  }
});

router.get('/callback', async (req, res) => {
  // Pulled out of the try/catch scope so the failure branch can reference
  // whatever identity we managed to extract before the error.
  let attemptedEmail = null;
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error(`[Auth] Callback error: ${error} — ${error_description}`);
      // Entra-side errors — we can't identify the user, but we record the attempt.
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.AUTH,
        action: 'login.failure',
        description: `Login failed at Entra — ${error}`,
        templateKey: 'login.failure',
        templateParams: { error },
        success: false,
        errorMessage: error_description || error,
        req,
      }).catch(() => {});
      return res.redirect('/?auth_error=' + encodeURIComponent(error_description || error));
    }

    // Validate state
    if (state !== req.session.authState) {
      console.error('[Auth] State mismatch');
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.AUTH,
        action: 'login.failure',
        description: 'Login failed — OAuth state mismatch (possible CSRF)',
        templateKey: 'login.failure_state_mismatch',
        templateParams: {},
        success: false,
        errorMessage: 'state_mismatch',
        req,
      }).catch(() => {});
      return res.redirect('/?auth_error=state_mismatch');
    }
    delete req.session.authState;

    // Exchange code for tokens
    const tokenResponse = await auth.acquireTokenByCode(code);
    const account = tokenResponse.account;
    attemptedEmail = account?.username || null;

    // Check group membership (if configured)
    const authorized = await auth.checkGroupMembership(tokenResponse.accessToken);
    if (!authorized) {
      console.warn(`[Auth] User ${account.username} denied — not in authorized group`);
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.AUTH,
        action: 'login.denied',
        description: `Login denied for ${account.username} — not a member of authorized Entra group`,
        templateKey: 'login.denied',
        templateParams: { account: account.username },
        success: false,
        errorMessage: 'not_in_authorized_group',
        actorEmail: account.username || null,
        actorOid: account.localAccountId || null,
        req,
      }).catch(() => {});
      return res.redirect('/?auth_error=unauthorized');
    }

    // Resolve role from Entra group memberships. Defaults to 'viewer' if no
    // tiered group matches. Transient Graph failure also degrades to 'viewer'
    // — never silently grant admin.
    const role = await auth.resolveUserRole(tokenResponse.accessToken);

    // Apr 28, 2026 — fetch the real `mail` field from Graph /me. account.username
    // is the UPN, which for licensed users matches the SMTP, but for unlicensed
    // accounts (e.g., a Microsoft 365 Global Admin without an Exchange license)
    // the UPN exists while `mail` is NULL. The notifier integration filters
    // out NULL emails, so the muted-recipient flow and admin failsafe both
    // need accurate per-user mail vs. UPN.
    let realMail = null;
    let displayName = account.name || null;
    try {
      const meResp = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', {
        headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
      });
      if (meResp.ok) {
        const me = await meResp.json();
        realMail = me.mail || null;
        if (me.displayName) displayName = me.displayName;
      } else {
        console.warn(`[Auth] /me lookup returned ${meResp.status} for ${account.username}; treating as no-email account`);
      }
    } catch (meErr) {
      console.warn(`[Auth] /me lookup failed for ${account.username}: ${meErr.message}; treating as no-email account`);
    }

    // Upsert into the users table — preferences (language/theme) are
    // operator-managed via the prefs modal and are NOT touched here.
    let internalUserId = null;
    try {
      internalUserId = await usersStore.upsertUserOnLogin({
        oid: account.localAccountId,
        upn: account.username,
        email: realMail,
        displayName,
        role,
      });
    } catch (upsertErr) {
      // A failed upsert is logged loudly but doesn't block login. The user
      // can still use Panoptica; their prefs will fall back to defaults.
      console.error(`[Auth] users-table upsert failed for ${account.username}:`, upsertErr.message);
    }

    // Store user in session. internal_user_id is the FK target for prefs +
    // mute lookups; email_for_alerts is the real SMTP (null for unlicensed)
    // and is what the notifier matches against muted-recipients lists.
    req.session.user = {
      name: displayName,
      email: account.username,           // UPN — kept for back-compat with existing logging
      email_for_alerts: realMail,        // real SMTP; null for unlicensed accounts
      oid: account.localAccountId,
      tenantId: account.tenantId,
      role,
      internal_user_id: internalUserId,
    };

    console.log(`[Auth] User ${account.username} logged in (role=${role}, mail=${realMail || 'none'}, internal_id=${internalUserId})`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'login.success',
      description: `${account.username} logged in as ${role}`,
      templateKey: 'login.success',
      templateParams: { account: account.username, role },
      req,
      metadata: { role },
    }).catch(() => {});
    res.redirect('/');
  } catch (err) {
    console.error('[Auth] Callback failed:', err.message);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'login.failure',
      description: `Login callback threw — ${err.message}`,
      templateKey: 'login.failure_callback',
      templateParams: { error: err.message },
      success: false,
      errorMessage: err.message,
      actorEmail: attemptedEmail,
      req,
    }).catch(() => {});
    res.redirect('/?auth_error=callback_failed');
  }
});

router.get('/logout', (req, res) => {
  const user = req.session?.user || null;
  const email = user?.email || 'unknown';
  // Log BEFORE destroying the session so captureOperator can still read identity.
  // Fire-and-forget; we don't block logout on audit success.
  if (user) {
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'logout',
      description: `${email} logged out`,
      templateKey: 'logout',
      templateParams: { email },
      req,
    }).catch(() => {});
  }
  req.session.destroy(() => {
    console.log(`[Auth] User ${email} logged out`);
    res.redirect('/');
  });
});

// ─── Admin Consent Flow (Onboarding Customer Tenants) ───

router.get('/adminconsent', auth.requireAuth, (req, res) => {
  const state = uuidv4();
  req.session.consentState = state;
  // Tenant mode picked in the Add Tenant modal — applied at first INSERT in the
  // Graph-consent callback, ignored for re-consent of existing tenants.
  // Validate strictly; unknown values fall back to 'managed' (safe default).
  const requestedMode = (req.query.mode || '').toString().trim();
  req.session.consentMode = (requestedMode === 'audit_only') ? 'audit_only' : 'managed';
  // Onboarding consent is a two-pass flow (see auth.getGraphConsentUrl):
  // pass 1 = Graph. The callback advances consentStep to 'teams' for pass 2.
  req.session.consentStep = 'graph';
  delete req.session.consentTenantId;
  const consentUrl = auth.getGraphConsentUrl(state);
  // Force-flush the session BEFORE redirecting to Microsoft. Without this
  // express-session writes asynchronously on res.end and the redirect can
  // race the MySQL UPDATE. If the write hasn't landed by the time Microsoft
  // calls /adminconsent/callback, req.session.consentState/consentMode read
  // back as undefined → state_mismatch + the audit_only mode pick gets
  // silently swallowed (defaulting to managed). The human-delay on the
  // Microsoft consent screen is normally enough to mask this, but on a
  // already-warm session-cookie pool it can trigger.
  req.session.save((err) => {
    if (err) {
      console.error('[Auth] Session save before adminconsent failed:', err.message);
      return res.redirect('/?page=tenants&consent_error=session_save_failed');
    }
    res.redirect(consentUrl);
  });
});

router.get('/adminconsent/callback', auth.requireAuth, async (req, res) => {
  // Onboarding consent is a two-pass flow (Graph, then Skype-Teams) that
  // shares this single registered redirect URI; req.session.consentStep
  // says which pass just returned. Default to 'graph' so a consent that was
  // in flight across the upgrade to this flow is still handled correctly.
  if ((req.session.consentStep || 'graph') === 'teams') {
    return handleTeamsConsentCallback(req, res);
  }
  return handleGraphConsentCallback(req, res);
});

// ─── Pass 1: Graph consent — this is what onboards the tenant ───
async function handleGraphConsentCallback(req, res) {
  try {
    const { admin_consent, state, error, error_description } = req.query;
    const tenant = req.query.tenant;

    // Single-resource Graph /adminconsent is reliable — no multi-resource
    // create-SP quirk — so a genuine error here means consent did not
    // happen. Log it and surface it; the operator simply retries.
    if (error) {
      console.error(`[Auth] Graph admin consent error: ${error} — ${error_description || ''}`);
      return res.redirect('/?page=tenants&consent_error=' + encodeURIComponent(error_description || error));
    }

    // Validate state
    if (state !== req.session.consentState) {
      console.error('[Auth] Consent state mismatch');
      return res.redirect('/?page=tenants&consent_error=state_mismatch');
    }
    delete req.session.consentState;

    // Pick up the mode chosen in the Add Tenant modal. Default to 'managed'
    // if missing (e.g., an old client cache or a re-consent from outside the
    // normal flow). Consume + clear so it doesn't bleed into the next add.
    const consentMode = (req.session.consentMode === 'audit_only') ? 'audit_only' : 'managed';
    delete req.session.consentMode;

    if (admin_consent !== 'True') {
      return res.redirect('/?page=tenants&consent_error=consent_denied');
    }

    // Check if tenant already exists
    const existing = await db.queryOne(
      'SELECT id, enabled, mode FROM tenants WHERE tenant_id = ?', [tenant]
    );

    if (existing) {
      // Re-consent of an existing tenant: PRESERVE the existing mode. The
      // mode picker in Add Tenant is only meaningful for NEW tenants —
      // changing mode on an existing tenant goes through the Edit modal
      // (which itself enforces the asymmetric audit_only→managed rule).
      const wasDisabled = existing.enabled === 0 || existing.enabled === false;
      await db.execute(
        'UPDATE tenants SET enabled = TRUE, consented_at = UTC_TIMESTAMP() WHERE id = ?',
        [existing.id]
      );
      console.log(`[Auth] Tenant ${tenant} re-consented (id: ${existing.id}, mode preserved: ${existing.mode})`);
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TENANT_LIFECYCLE_MSP,
        action: wasDisabled ? 'tenant.re_enable_on_consent' : 'tenant.re_consent',
        description: wasDisabled
          ? `Tenant ${tenant} re-enabled on admin consent (was disabled, mode: ${existing.mode})`
          : `Tenant ${tenant} re-consented (admin consent refreshed, mode: ${existing.mode})`,
        templateKey: wasDisabled ? 'tenant.re_enable_on_consent' : 'tenant.re_consent',
        templateParams: { tenantName: tenant, mode: existing.mode },
        targetType: 'tenant',
        targetId: String(existing.id),
        targetName: tenant,
        metadata: { azure_tenant_id: tenant, was_disabled: !!wasDisabled, mode: existing.mode },
        req,
      }).catch(() => {});
    } else {
      // Insert new tenant — display_name will be set by Jacques in tenant edit.
      // Apply the mode chosen in the Add Tenant modal. For audit_only, set the
      // expiry clock to NOW + 14 days (UTC); cascade auto-delete fires 7 days
      // after that via the nightly expiry job (still pending — task #9).
      let id;
      if (consentMode === 'audit_only') {
        id = await db.insert(
          `INSERT INTO tenants (tenant_id, display_name, mode, audit_expires_at, consented_at)
           VALUES (?, ?, 'audit_only', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 14 DAY), UTC_TIMESTAMP())`,
          [tenant, `Tenant ${tenant.substring(0, 8)}...`]
        );
      } else {
        id = await db.insert(
          `INSERT INTO tenants (tenant_id, display_name, mode, consented_at)
           VALUES (?, ?, 'managed', UTC_TIMESTAMP())`,
          [tenant, `Tenant ${tenant.substring(0, 8)}...`]
        );
      }
      console.log(`[Auth] New tenant ${tenant} consented (id: ${id}, mode: ${consentMode})`);
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TENANT_LIFECYCLE_MSP,
        action: 'tenant.onboard',
        description: `New tenant ${tenant} onboarded via admin consent (mode: ${consentMode})`,
        templateKey: 'tenant.onboard',
        templateParams: { tenantName: tenant, mode: consentMode },
        targetType: 'tenant',
        targetId: String(id),
        targetName: tenant,
        metadata: { azure_tenant_id: tenant, mode: consentMode },
        req,
      }).catch(() => {});
    }

    // ─── Graph consent done, tenant onboarded — kick off pass 2 ───
    // Consent the Skype-Teams resource so the cert-based Teams readers
    // (TEA-01/TEA-02) work. Best-effort: the tenant row already exists, so
    // if this pass fails or the operator cancels it, the tenant still
    // functions — only those two settings can't be polled until a
    // re-consent (re-running Add Tenant on the tenant repeats both passes).
    const teamsState = uuidv4();
    req.session.consentState = teamsState;
    req.session.consentStep = 'teams';
    req.session.consentTenantId = tenant;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[Auth] Session save before Teams consent failed:', saveErr.message);
        return res.redirect('/?page=tenants&consent_success=true&teams_consent=skipped');
      }
      res.redirect(auth.getTeamsConsentUrl(teamsState, tenant));
    });
  } catch (err) {
    console.error('[Auth] Admin consent callback failed:', err.message);
    res.redirect('/?page=tenants&consent_error=callback_failed');
  }
}

// ─── Pass 2: Skype-Teams consent — best-effort, tenant already onboarded ───
function handleTeamsConsentCallback(req, res) {
  const { admin_consent, state, error, error_description } = req.query;
  const tenantId = req.session.consentTenantId || '(unknown)';
  const expectedState = req.session.consentState;
  // Clear the consent session state regardless of outcome — the tenant was
  // already inserted by the Graph pass, so this pass never blocks onboarding.
  delete req.session.consentState;
  delete req.session.consentStep;
  delete req.session.consentTenantId;

  if (!expectedState || state !== expectedState) {
    console.warn(`[Auth] Teams consent state mismatch for tenant ${tenantId} — tenant stays onboarded; Teams permissions unconfirmed`);
    return res.redirect('/?page=tenants&consent_success=true&teams_consent=incomplete');
  }
  if (error || admin_consent !== 'True') {
    console.warn(`[Auth] Teams consent for tenant ${tenantId} did not complete (${error || 'admin_consent!=True'}${error_description ? ' — ' + error_description : ''}) — tenant stays onboarded; TEA-01/TEA-02 need a re-consent`);
    return res.redirect('/?page=tenants&consent_success=true&teams_consent=incomplete');
  }
  console.log(`[Auth] Teams resource consented for tenant ${tenantId}`);
  return res.redirect('/?page=tenants&consent_success=true');
}

// ─── Session Status (for frontend) ───

router.get('/status', (req, res) => {
  if (req.session?.user) {
    // Ensure role is always present in the response. Sessions created before
    // the role-resolution phase shipped will have no .role — report it as
    // 'viewer' in that case rather than omitting the field, so the frontend
    // can rely on a string value. Operators with stale sessions will re-resolve
    // their role on next login.
    const user = { ...req.session.user };
    if (!user.role) user.role = 'viewer';
    res.json({ authenticated: true, user, version: versionInfo.asObject(), update: updateChecker.getStatus() });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
