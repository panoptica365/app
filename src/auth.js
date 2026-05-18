/**
 * Panoptica — MSAL Authentication Module
 * Handles:
 *  1. User login to Panoptica UI (Entra group-based access control)
 *  2. Admin consent flow for onboarding customer tenants
 *  3. Client credential token acquisition for Graph API calls per tenant
 */

const msal = require('@azure/msal-node');
const config = require('../config/default');

// msp-audit is loaded lazily so requireAdmin / requireMemberOrAdmin can write
// an audit row on every 403. msp-audit only imports `./db/database`; no risk
// of a circular dep back to auth.
const mspAudit = require('./msp-audit');

// ─── MSAL Confidential Client (single-tenant — Trilogiam users login) ───
const msalConfig = {
  auth: {
    clientId: config.entra.clientId,
    authority: config.entra.authority,
    clientSecret: config.entra.clientSecret,
  },
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// ─── Token cache for client credential flows (per customer tenant) ───
// MSAL handles its own in-memory cache, but we track CCAs per tenant
const tenantCCAs = new Map();

/**
 * Get or create a CCA for a specific customer tenant (client credentials flow).
 * Used for Graph API calls to customer tenants.
 */
function getTenantCCA(tenantId) {
  if (!tenantCCAs.has(tenantId)) {
    const tenantCCA = new msal.ConfidentialClientApplication({
      auth: {
        clientId: config.entra.clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret: config.entra.clientSecret,
      },
    });
    tenantCCAs.set(tenantId, tenantCCA);
  }
  return tenantCCAs.get(tenantId);
}

/**
 * Generate the authorization URL for user login (Panoptica UI access).
 */
async function getAuthUrl(state) {
  return cca.getAuthCodeUrl({
    scopes: ['openid', 'profile', 'email', 'User.Read', 'GroupMember.Read.All'],
    redirectUri: config.entra.redirectUri,
    state: state || '',
    prompt: 'select_account',
  });
}

/**
 * Exchange authorization code for tokens (user login callback).
 */
async function acquireTokenByCode(code) {
  return cca.acquireTokenByCode({
    code,
    scopes: ['openid', 'profile', 'email', 'User.Read', 'GroupMember.Read.All'],
    redirectUri: config.entra.redirectUri,
  });
}

/**
 * Acquire a client credentials token for a specific customer tenant.
 * Used for all Graph API data calls.
 */
async function acquireTokenForTenant(tenantId) {
  const tenantCCA = getTenantCCA(tenantId);
  const result = await tenantCCA.acquireTokenByClientCredential({
    scopes: config.graph.scopes,
  });
  return result.accessToken;
}

/**
 * Acquire an app-only token for the Office 365 Management Activity API.
 * Different resource than Graph (manage.office.com vs graph.microsoft.com),
 * so it requires its own /token call against the same tenant authority.
 *
 * Per memory feedback_aadsts28000_token_endpoint_single_resource.md, the v2
 * /token endpoint accepts only single-resource scopes per call — that's why
 * Graph and Management get separate calls here even though they share the
 * same client credentials and tenant authority.
 *
 * Used by src/lib/management-api.js for UAL ingestion (Phase 2b, May 2026).
 */
async function acquireManagementTokenForTenant(tenantId) {
  const tenantCCA = getTenantCCA(tenantId);
  const result = await tenantCCA.acquireTokenByClientCredential({
    scopes: ['https://manage.office.com/.default'],
  });
  return result.accessToken;
}

/**
 * Generate the admin consent URL for onboarding a new customer tenant.
 * Jacques clicks this → Microsoft login → approves permissions → callback.
 */
function getAdminConsentUrl(state) {
  const params = new URLSearchParams({
    client_id: config.entra.clientId,
    redirect_uri: config.entra.adminConsentRedirectUri,
    state: state || '',
    // May 3, 2026 — multi-resource scope so newly-onboarded customer
    // tenants get BOTH Microsoft Graph permissions AND the Skype-Teams
    // Tenant Admin API permissions consented in one /adminconsent click.
    // Without the second scope, the operator hits AADSTS65001 the first
    // time TEA-* Apply runs against the new tenant — verified May 3 on
    // CAE customer tenant.
    //
    // The Skype-Teams API resource ID 48ac35b8-9aa8-4d74-927d-1f4a14a0b239
    // is Microsoft's well-known app id for that API. Constants kept here
    // (rather than imported from oauth-delegated.js) to avoid a circular
    // require — auth.js loads early in the boot sequence.
    scope: 'https://graph.microsoft.com/.default 48ac35b8-9aa8-4d74-927d-1f4a14a0b239/.default',
    // NOTE: prompt=consent does NOT work on /adminconsent (Microsoft
    // ignores it on this specific endpoint). Tested Apr 25 2026. When a
    // tenant has prior consent for an OLDER version of the app's
    // permission set, /adminconsent skips silently and new permissions
    // never propagate to the customer SP. The reliable fix for picking up
    // newly-added permissions on already-consented tenants is the
    // Partner Center New-PartnerCustomerApplicationConsent API (GDAP-
    // gated bulk consent), which is the Phase D migration deliverable.
    // For one-off cases the customer admin has to click "Grant admin
    // consent" in their Enterprise applications page, OR navigate to a
    // tenant-specific /{tenantId}/adminconsent URL with the same scope.
  });
  return `https://login.microsoftonline.com/common/adminconsent?${params.toString()}`;
}

/**
 * Check if a user is a member of any configured authorized Entra group.
 * Used after login to gate access to Panoptica UI.
 *
 * A3 fix (May 10, 2026): pre-A3, this only checked the single legacy
 * `authorizedGroupId` (the Admin group). That broke the moment Jacques
 * moved his account from PanopticaAdmins to PanopticaUsers to test the
 * Operator tier — the login gate rejected him before `resolveUserRole`
 * ran to figure out his tier.
 *
 * Now admits any user who is a member of admin OR operator (member) OR
 * viewer groups. Falls back to the legacy `authorizedGroupId` when no
 * tier groups are configured (preserves single-operator dev setup).
 * If NOTHING is configured at all, admits everyone authenticated — same
 * as pre-A3 behavior.
 */
async function checkGroupMembership(accessToken) {
  // Mirror the lookup order in resolveUserRole so the two functions agree
  // on which groups gate access.
  const adminId  = process.env.ENTRA_ADMIN_GROUP_ID
    || process.env.ENTRA_AUTHORIZED_GROUP_ID
    || config.entra.adminGroupId
    || config.entra.authorizedGroupId
    || '';
  const memberId = process.env.ENTRA_MEMBER_GROUP_ID || config.entra.memberGroupId || '';
  const viewerId = process.env.ENTRA_VIEWER_GROUP_ID || config.entra.viewerGroupId || '';

  const configuredGroupIds = [adminId, memberId, viewerId].filter(Boolean);

  // Nothing configured anywhere — admit all authenticated users (legacy dev path).
  if (configuredGroupIds.length === 0) {
    console.log('[Auth] checkGroupMembership: no groups configured, admitting all authenticated users');
    return true;
  }

  // Mirror the resolveUserRole pattern — pull all direct memberships once,
  // filter client-side. Server-side $filter with OR clauses works in
  // principle but has been flaky in practice (URL-encoding of single-quote
  // OData literals, Graph's tolerance of multiple `id eq` predicates).
  // Client-side is more diagnostic-friendly and matches what tier resolution
  // does anyway.
  try {
    const response = await fetch(
      `${config.graph.baseUrl}/me/memberOf?$select=id&$top=999`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[Auth] checkGroupMembership: Graph /me/memberOf returned ${response.status}: ${body.slice(0, 200)}`);
      return false;
    }
    const data = await response.json();
    const ids = new Set((data.value || []).map(g => g.id).filter(Boolean));
    const matched = configuredGroupIds.find(id => ids.has(id));
    if (matched) {
      console.log(`[Auth] checkGroupMembership: admitted user (matched group ${matched})`);
      return true;
    }
    console.warn(`[Auth] checkGroupMembership: denied — user is in ${ids.size} groups, none match configured admin/member/viewer (${configuredGroupIds.join(', ')})`);
    return false;
  } catch (err) {
    console.error('[Auth] checkGroupMembership failed:', err.message);
    return false;
  }
}

/**
 * Resolve a logged-in user's Panoptica role from their Entra group memberships.
 *
 * Priority: admin > member > viewer. The first match wins.
 * If no role-specific group is configured OR the user isn't in any of them,
 * fall back to 'viewer' (authenticated but read-only).
 *
 * Returns 'admin' | 'member' | 'viewer'. Never throws — Graph errors
 * degrade to 'viewer' so a transient API failure doesn't grant Admin.
 *
 * Login-gate coordination: `checkGroupMembership` admits users who are
 * in any of the same three configured groups, so by the time this
 * function runs the user is guaranteed to qualify for at least one tier.
 * The 'viewer' fallback below covers (a) the bootstrap dev case with no
 * groups configured (returns 'admin' as a special case) and (b) the
 * edge case where Graph returns success but with no group rows.
 */
async function resolveUserRole(accessToken) {
  // Pick up the latest group IDs from env/config. These are loaded by
  // src/routes/api-settings.js::reloadAccessControlConfig() which is called
  // on module load and after every PUT /access-control.
  const adminId  = process.env.ENTRA_ADMIN_GROUP_ID
    || process.env.ENTRA_AUTHORIZED_GROUP_ID
    || config.entra.adminGroupId
    || '';
  const memberId = process.env.ENTRA_MEMBER_GROUP_ID || config.entra.memberGroupId || '';
  const viewerId = process.env.ENTRA_VIEWER_GROUP_ID || config.entra.viewerGroupId || '';

  // If no group-tier IDs are configured at all, fall back to 'admin' —
  // this preserves the single-operator dev setup where Jacques is the only
  // user and there's no Entra group for role splitting yet. This fallback
  // applies ONLY when none of the three tier group IDs are configured.
  // Once any tier ID is set, unknown users correctly drop to 'viewer'.
  if (!adminId && !memberId && !viewerId) {
    return 'admin';
  }

  // Query all direct group memberships once; filter client-side.
  // $top=999 is the Graph max per page — plenty for typical MSP headcount.
  let membershipIds = new Set();
  try {
    const response = await fetch(
      `${config.graph.baseUrl}/me/memberOf?$select=id&$top=999`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      console.warn(`[Auth] resolveUserRole: memberOf returned ${response.status}; defaulting to viewer`);
      return 'viewer';
    }
    const data = await response.json();
    for (const g of (data.value || [])) {
      if (g.id) membershipIds.add(g.id);
    }
  } catch (err) {
    console.error('[Auth] resolveUserRole failed:', err.message);
    return 'viewer';
  }

  if (adminId  && membershipIds.has(adminId))  return 'admin';
  if (memberId && membershipIds.has(memberId)) return 'member';
  if (viewerId && membershipIds.has(viewerId)) return 'viewer';

  // User passed checkGroupMembership (legacy authorizedGroupId) but isn't
  // in any of the tiered groups. Default to lowest privilege.
  return 'viewer';
}

/**
 * Express middleware — require authenticated session.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/auth/login');
}

/**
 * Fire-and-forget audit log of a 403 denial. Captures who tried what.
 * The response is not blocked on the DB write — we await `Promise.resolve()`
 * to escape the current microtask, then write asynchronously. Errors are
 * swallowed (logging shouldn't fail the request handler).
 *
 * Added May 9, 2026 (A3 Step 3). Combined with the middlewares below so the
 * forensic trail is automatic — no route handler has to remember to log
 * its own denials.
 */
function logAccessDenied(req, requiredRole) {
  // setImmediate so the audit write happens after the response is queued.
  // Doing it inline would double the latency of every 403 for no benefit.
  setImmediate(() => {
    const role = req?.session?.user?.role || 'unauthenticated';
    const method = (req?.method || 'GET').toUpperCase();
    // Trim very long paths defensively — actor-controlled input.
    const path = String(req?.originalUrl || req?.url || '').slice(0, 400);
    const description = `Denied ${method} ${path} (required: ${requiredRole}, actual: ${role})`;
    mspAudit.logMspAudit({
      category: 'access_denied',
      action: `access_denied.${requiredRole}`,
      description,
      templateKey: 'msp_audit.access_denied',
      templateParams: { method, path, required: requiredRole, actual: role },
      success: false,
      targetType: 'route',
      targetId: `${method} ${path}`.slice(0, 64),
      req,
    }).catch(e => {
      console.warn('[Auth] access_denied audit write failed (non-fatal):', e.message);
    });
  });
}

/**
 * Express middleware — require role === 'admin'.
 *
 * MUST be stacked AFTER requireAuth. Returns:
 *  - 403 JSON for API/XHR callers
 *  - 403 HTML redirect-to-/ for partial/page callers
 * Never silently allows; an absent role is treated as non-admin.
 *
 * Why a separate middleware (not a role= option on requireAuth): keeping them
 * split makes it trivial to grep `requireAdmin` and see every privileged
 * surface at a glance. Audit tooling and security reviews need that.
 *
 * Every denial writes one row to msp_audit_events with category 'access_denied'.
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/auth/login');
  }
  const role = req.session.user.role;
  if (role !== 'admin') {
    logAccessDenied(req, 'admin');
    const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/');
    if (wantsJson) {
      return res.status(403).json({ error: 'Admin role required', role: role || null });
    }
    // For partial requests, return 403 with a minimal HTML body — the SPA
    // router surfaces this to the user as "access denied" without wiping
    // their session.
    return res.status(403).send('<div class="panel-error">Admin role required.</div>');
  }
  return next();
}

/**
 * Express middleware — require role === 'admin' or 'member' (operator).
 *
 * MUST be stacked AFTER requireAuth. Viewers get a 403. Same response shape
 * as requireAdmin (JSON for XHR/API, minimal HTML for partials).
 *
 * Use on every mutate endpoint that an operator should be able to invoke:
 *  - alert ack/clear/notes
 *  - CA template DEPLOY (not create/edit — that's admin-only)
 *  - Intune template DEPLOY (same)
 *  - Security Settings Apply / Match Current / Accept
 *  - Exemptions accept/revoke (delegates here from existing canMemberOrAdmin
 *    inline checks — those should migrate to use this middleware over time)
 *  - Reports generate
 *  - SharePoint refresh
 *  - Per-tenant manual refresh
 *  - Tenant edit (language, display name, PSA name) — NOT add/remove/mode
 *
 * Admin-only routes stay on `requireAdmin`. The split keeps "tenant-wide
 * config" gated to admin and "per-tenant operations" available to operators.
 *
 * Every denial writes one row to msp_audit_events with category 'access_denied'.
 *
 * Added May 9, 2026 (A3 Step 1).
 */
function requireMemberOrAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/auth/login');
  }
  const role = req.session.user.role;
  if (role !== 'admin' && role !== 'member') {
    logAccessDenied(req, 'member');
    const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/');
    if (wantsJson) {
      return res.status(403).json({ error: 'Operator role required', role: role || null });
    }
    return res.status(403).send('<div class="panel-error">Operator role required.</div>');
  }
  return next();
}

/**
 * Boolean role check — returns true for admin or member, false otherwise.
 * Use inside a route handler when the 403 message needs to be tailored
 * (e.g., "Admin or Member role required to accept exemption").
 *
 * Single source of truth for the "operator can mutate persistent
 * acceptance/exemption state" gate. Wrappers in api-ca.js and api-intune.js
 * delegate here so future role-policy changes happen in one place.
 *
 * Fails closed: if session/user/role is missing, returns false.
 *
 * Note: for new code prefer the `requireMemberOrAdmin` middleware — it
 * handles the 403 response shape and audit logging consistently. This
 * boolean is retained for in-handler branching (e.g., conditional shape
 * of a response body based on role).
 */
function canMemberOrAdmin(req) {
  const role = req?.session?.user?.role;
  return role === 'admin' || role === 'member';
}

module.exports = {
  cca,
  getAuthUrl,
  acquireTokenByCode,
  acquireTokenForTenant,
  acquireManagementTokenForTenant,
  getAdminConsentUrl,
  checkGroupMembership,
  resolveUserRole,
  requireAuth,
  requireAdmin,
  requireMemberOrAdmin,
  canMemberOrAdmin,
};
