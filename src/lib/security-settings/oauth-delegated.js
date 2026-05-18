/**
 * Panoptica365 — Delegated OAuth Flow for Microsoft Teams Admin Writers
 *
 * Why this exists: Microsoft Teams admin write cmdlets (Set-CsTeamsMeetingPolicy,
 * Set-CsTenantFederationConfiguration, etc.) don't reliably honor cert-based
 * app-only SP authentication on customer tenants accessed via GDAP. Reads
 * work; writes return Forbidden regardless of API permissions or directory
 * roles. Microsoft's documented workaround is delegated auth — the operator
 * authenticates interactively, and their delegated token is used for the
 * cmdlet call.
 *
 * Verified May 2, 2026: Jacques' user via GDAP delegated auth runs
 * Set-CsTeamsMeetingPolicy successfully on CAE; Panoptica's SP via
 * cert-based app-only auth gets Forbidden on the same cmdlet on the same
 * tenant.
 *
 * Flow:
 *   1. Operator clicks Apply on a delegated_teams writer in the UI.
 *   2. Frontend detects no delegated session token; opens a popup to
 *      /auth/teams-delegated/login → redirects to Microsoft /authorize.
 *   3. Operator signs in (their account has GDAP elevation to the customer
 *      tenant they want to push to).
 *   4. Microsoft redirects back to /auth/teams-delegated/callback with code.
 *   5. We exchange code → access + refresh tokens (multi-tenant via /common).
 *   6. Refresh token stored in operator's Express session.
 *   7. For each customer tenant Apply: use refresh token to acquire two
 *      access tokens for that tenant (Graph + Teams admin API), pass them
 *      to Connect-MicrosoftTeams -AccessTokens, run the cmdlet.
 *   8. Tokens cached briefly per tenant; refresh transparently when expired.
 *
 * Token lifetimes (Microsoft defaults):
 *   - Access tokens: ~60-90 minutes
 *   - Refresh tokens: 90 days (rolling — each refresh extends)
 *
 * Storage model: refresh token in Express session (express-mysql-session).
 * Sessions persist across server restart but expire when operator logs out
 * or session-cookie TTL elapses. Acknowledge: session DB storage isn't
 * encrypted-at-rest. For tighter security in a future iteration, encrypt
 * the refresh token before storing.
 */

'use strict';

const config = require('../../../config/default');

// Microsoft API resource IDs.
// 48ac35b8-9aa8-4d74-927d-1f4a14a0b239 = Skype and Teams Tenant Admin API.
// This is the resource that Connect-MicrosoftTeams' Set-Cs* cmdlets ultimately
// authenticate against. The /user_impersonation scope is the standard
// delegated permission name on this API.
const TEAMS_ADMIN_API_RESOURCE = '48ac35b8-9aa8-4d74-927d-1f4a14a0b239';
const TEAMS_ADMIN_DELEGATED_SCOPE = `${TEAMS_ADMIN_API_RESOURCE}/user_impersonation`;
const GRAPH_USER_READ_SCOPE = 'https://graph.microsoft.com/User.Read';

// Scopes requested at /authorize. Microsoft v2.0 ACCEPTS multi-resource
// scopes here (so the user sees the consent screen for both Graph and the
// Skype-Teams Tenant Admin API in one prompt). offline_access is required
// to receive a refresh token; without it the operator would re-auth hourly.
const CONSENT_SCOPES = [
  'offline_access',
  GRAPH_USER_READ_SCOPE,
  TEAMS_ADMIN_DELEGATED_SCOPE,
];

// Scopes for the INITIAL /token exchange — Microsoft v2.0 requires
// single-resource scopes here (AADSTS28000 if multi-resource). We acquire
// a Graph access token + refresh token in this initial call. The refresh
// token is multi-resource-capable (covers all consented scopes), so we
// later acquire Teams admin tokens per-customer-tenant via the refresh
// flow without prompting the operator again.
const INITIAL_TOKEN_SCOPES = [
  'offline_access',
  GRAPH_USER_READ_SCOPE,
];

// Backward-compat export (was named INITIAL_AUTH_SCOPES; kept so any
// external module still importing it doesn't break).
const INITIAL_AUTH_SCOPES = CONSENT_SCOPES;

// Where Microsoft redirects after the operator signs in. Must exactly match
// the Web platform redirect URI registered in the Panoptica app registration.
// Pulled from config so it can be overridden via ENV without code change.
function buildRedirectUri() {
  return config.entra.teamsDelegatedRedirectUri;
}

/**
 * Build the Microsoft authorization URL the operator's browser is redirected
 * to. Multi-tenant flow (/common) so the operator can authenticate against
 * any tenant they have access to. The state parameter is used for CSRF
 * protection and round-tripped through Microsoft's redirect.
 */
function getDelegatedAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.entra.clientId,
    response_type: 'code',
    redirect_uri: buildRedirectUri(),
    response_mode: 'query',
    // /authorize accepts multi-resource scopes (consent screen shows all).
    scope: CONSENT_SCOPES.join(' '),
    state,
    // 'select_account' lets the operator pick which Microsoft account to use
    // (vs forcing whichever was last cached in the browser). Important for
    // MSPs whose operators have multiple accounts (personal + work + customer).
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

/**
 * Exchange an authorization code (from the callback redirect) for the
 * initial token set. Returns the raw Microsoft response containing
 * access_token, refresh_token, expires_in, etc.
 *
 * Authenticates this app against Microsoft using the SAME client_secret
 * already configured for the cert-less code paths in src/auth.js (the SP
 * has BOTH a cert AND a secret; either works for the OAuth token endpoint).
 */
async function exchangeCodeForTokens(authCode) {
  const params = new URLSearchParams({
    client_id: config.entra.clientId,
    client_secret: config.entra.clientSecret,
    grant_type: 'authorization_code',
    code: authCode,
    redirect_uri: buildRedirectUri(),
    // CRITICAL: Microsoft v2.0 /token rejects multi-resource scope here
    // with AADSTS28000. Use single-resource scopes; the refresh token
    // returned is multi-resource-capable for all CONSENT_SCOPES the user
    // approved at /authorize.
    scope: INITIAL_TOKEN_SCOPES.join(' '),
  });

  const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Initial token exchange failed (${resp.status}): ${errText.slice(0, 500)}`);
  }
  const tokens = await resp.json();
  if (!tokens.refresh_token) {
    throw new Error('Microsoft returned no refresh_token — offline_access scope may not be granted to the app reg');
  }
  return tokens;
}

/**
 * Acquire a tenant-specific access token using a multi-tenant refresh token.
 *
 * Microsoft's refresh tokens issued via /common are multi-tenant-aware: they
 * can be exchanged for access tokens at ANY tenant the user has access to,
 * by calling the tenant-specific token endpoint. This is how multi-tenant
 * apps acquire per-customer-tenant tokens without re-prompting the operator.
 *
 * Returns the raw Microsoft response. Critically, includes a possibly-rotated
 * refresh_token — Microsoft sometimes issues a new refresh_token in the
 * response; callers should persist whichever is returned (or retain the
 * original if Microsoft didn't rotate).
 */
async function acquireTokenForTenantViaRefresh(refreshToken, customerTenantId, scopes) {
  if (!refreshToken) throw new Error('refreshToken is required');
  if (!customerTenantId) throw new Error('customerTenantId is required');
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('scopes must be a non-empty array');
  }

  const params = new URLSearchParams({
    client_id: config.entra.clientId,
    client_secret: config.entra.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${customerTenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(
      `Tenant token acquisition failed (${resp.status}) for tenant ${customerTenantId}: ${errText.slice(0, 500)}`
    );
  }
  return resp.json();
}

/**
 * Acquire BOTH tokens Connect-MicrosoftTeams -AccessTokens needs for a given
 * customer tenant: a Graph token (User.Read) and a Teams admin API token
 * (user_impersonation on the Skype and Teams Tenant Admin API).
 *
 * Order matters when passing to Connect-MicrosoftTeams: Graph first,
 * Teams second, per Microsoft's documented expectation. The returned object
 * carries both tokens, the (possibly rotated) refresh token, and the access
 * token expiry timestamp so callers can cache + refresh appropriately.
 */
async function getTeamsAccessTokensForTenant(refreshToken, customerTenantId) {
  // Acquire Graph token first
  const graphTokens = await acquireTokenForTenantViaRefresh(
    refreshToken, customerTenantId, [GRAPH_USER_READ_SCOPE]
  );
  // Use the (possibly rotated) refresh token from the first call when
  // making the second call — Microsoft sometimes invalidates the original
  // after rotation.
  const nextRefreshToken = graphTokens.refresh_token || refreshToken;

  // Then Teams admin token
  const teamsTokens = await acquireTokenForTenantViaRefresh(
    nextRefreshToken, customerTenantId, [TEAMS_ADMIN_DELEGATED_SCOPE]
  );

  return {
    graphAccessToken: graphTokens.access_token,
    teamsAccessToken: teamsTokens.access_token,
    // Use whichever refresh token was returned most recently — Microsoft's
    // rotation behavior is not fully deterministic; preserving the freshest
    // one minimizes the chance of using a stale token next time.
    refreshToken: teamsTokens.refresh_token || graphTokens.refresh_token || refreshToken,
    // expires_in is in seconds. Compute an absolute expiry time so the
    // caller can decide whether to reuse a cached token vs refresh.
    accessTokenExpiresAtMs: Date.now() + (Math.min(graphTokens.expires_in, teamsTokens.expires_in) - 60) * 1000,
    // Useful for diagnostics / status display
    scopes: teamsTokens.scope || '',
  };
}

/**
 * Cheap probe: do we have a usable refresh token for this operator? Used by
 * the frontend's auth-status check and by the Apply handler to decide
 * whether to attempt the cmdlet vs prompt for sign-in.
 *
 * Returns shape:
 *   { authenticated: false }                                    — no token
 *   { authenticated: true, account: { username, ... }, ... }   — has token
 */
function getDelegatedAuthStatus(req) {
  const tok = req.session?.teamsDelegated;
  if (!tok || !tok.refreshToken) return { authenticated: false };
  return {
    authenticated: true,
    account: {
      username: tok.account?.username || null,
      name: tok.account?.name || null,
      tenantId: tok.account?.tenantId || null,
    },
    acquiredAtMs: tok.acquiredAtMs || null,
    // 90 days from acquisition; Microsoft's default refresh-token sliding
    // window. Surface to UI so the operator sees when they'll need to
    // re-authenticate.
    refreshTokenExpiresAtMs: tok.acquiredAtMs
      ? tok.acquiredAtMs + 90 * 24 * 60 * 60 * 1000
      : null,
  };
}

module.exports = {
  buildRedirectUri,
  getDelegatedAuthUrl,
  exchangeCodeForTokens,
  getTeamsAccessTokensForTenant,
  getDelegatedAuthStatus,
  // Constants exported for testing + diagnostics
  TEAMS_ADMIN_API_RESOURCE,
  CONSENT_SCOPES,
  INITIAL_TOKEN_SCOPES,
  INITIAL_AUTH_SCOPES,  // backward-compat alias for CONSENT_SCOPES
};
