/**
 * Panoptica365 — Auth routes for delegated Teams admin OAuth flow.
 *
 * Mounted at /auth/teams-delegated. Provides:
 *   GET /auth/teams-delegated/login    — redirect operator to Microsoft auth
 *   GET /auth/teams-delegated/callback — handle Microsoft redirect, store tokens
 *   GET /auth/teams-delegated/status   — JSON: is the operator authenticated for Teams writes?
 *   POST /auth/teams-delegated/logout  — clear delegated session (separate from main logout)
 *
 * This is intentionally a SEPARATE auth flow from /auth/login (Panoptica
 * UI access). The operator may be signed into Panoptica without having
 * authenticated for Teams admin operations; the latter is requested
 * on-demand when the operator clicks Apply on a delegated_teams writer.
 *
 * See src/lib/security-settings/oauth-delegated.js for the full flow rationale.
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../auth');
const oauthDelegated = require('../lib/security-settings/oauth-delegated');
const mspAudit = require('../msp-audit');

const router = express.Router();

// All routes require an existing Panoptica session (operator already logged in
// to the UI). The delegated Teams auth is layered on top — it's specific to
// the operator's session.
router.use(auth.requireAuth);

// ─── GET /auth/teams-delegated/login ────────────────────────────
//
// Operator clicks "Sign in to push Teams settings" in the UI. Frontend
// opens a popup to this route. We generate a fresh CSRF state, stash it
// in the session, and redirect the popup to Microsoft's /authorize.
router.get('/login', async (req, res) => {
  try {
    const state = uuidv4();
    req.session.teamsDelegatedAuthState = state;
    // Force-flush the session BEFORE the redirect — same race-condition
    // pattern the admin-consent flow handles. Without this, the callback
    // can race the MySQL write and read teamsDelegatedAuthState as undefined.
    req.session.save((err) => {
      if (err) {
        console.error('[TeamsDelegated] Session save before /login failed:', err.message);
        return res.status(500).send('Session error — please retry');
      }
      const url = oauthDelegated.getDelegatedAuthUrl(state);
      res.redirect(url);
    });
  } catch (err) {
    console.error('[TeamsDelegated] /login failed:', err.message);
    res.status(500).send('Auth service unavailable');
  }
});

// ─── GET /auth/teams-delegated/callback ──────────────────────────
//
// Microsoft redirects here after the operator signs in. We exchange the
// auth code for tokens, persist the refresh token (and account info) in
// the operator's session, and render a small HTML page that closes the
// popup and tells the parent window the auth succeeded via postMessage.
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Microsoft-side errors (consent denied, etc.)
  if (error) {
    console.warn(`[TeamsDelegated] Callback error: ${error} — ${error_description}`);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'teams_delegated.failure',
      description: `Teams delegated auth failed at Microsoft — ${error}`,
      templateKey: 'teams_delegated.failure',
      templateParams: { error },
      success: false,
      errorMessage: error_description || error,
      req,
    }).catch(() => {});
    return res.send(renderClosePopupHtml({
      ok: false,
      error: error_description || error || 'Authentication failed',
    }));
  }

  // CSRF protection — the state we put into /authorize must match what
  // comes back. Different from the admin-consent flow's state (separate
  // session key) so the two flows can't collide.
  if (!state || state !== req.session.teamsDelegatedAuthState) {
    console.warn('[TeamsDelegated] State mismatch on callback');
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'teams_delegated.failure',
      description: 'Teams delegated auth state mismatch (possible CSRF)',
      templateKey: 'teams_delegated.failure_state_mismatch',
      templateParams: {},
      success: false,
      errorMessage: 'state_mismatch',
      req,
    }).catch(() => {});
    return res.send(renderClosePopupHtml({ ok: false, error: 'State mismatch — please retry sign-in' }));
  }
  delete req.session.teamsDelegatedAuthState;

  if (!code) {
    return res.send(renderClosePopupHtml({ ok: false, error: 'No authorization code received from Microsoft' }));
  }

  try {
    const tokens = await oauthDelegated.exchangeCodeForTokens(code);

    // Decode the id_token's account claims — small and safe; just for
    // displaying "Authenticated as ..." in the UI. We don't validate the
    // signature here because we already trust the source (Microsoft) and
    // the token was just delivered over TLS in the response we initiated.
    let account = null;
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8')
        );
        account = {
          username: payload.preferred_username || payload.upn || payload.email || null,
          name: payload.name || null,
          tenantId: payload.tid || null,
          oid: payload.oid || null,
        };
      } catch (e) {
        console.warn('[TeamsDelegated] id_token parse failed (non-fatal):', e.message);
      }
    }

    // Stash the tokens in the operator's session. Refresh token is
    // long-lived (~90 days, sliding window); access tokens are acquired
    // per-customer-tenant on demand and not stored here.
    req.session.teamsDelegated = {
      refreshToken: tokens.refresh_token,
      account,
      acquiredAtMs: Date.now(),
      // Track scope grant for diagnostic visibility — useful when Microsoft
      // silently downgrades the granted scopes (it sometimes happens).
      grantedScopes: tokens.scope || '',
    };

    req.session.save((err) => {
      if (err) {
        console.error('[TeamsDelegated] Session save after callback failed:', err.message);
        return res.send(renderClosePopupHtml({ ok: false, error: 'Failed to save session' }));
      }
      console.log(`[TeamsDelegated] Operator ${account?.username || 'unknown'} authenticated for Teams admin`);
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.AUTH,
        action: 'teams_delegated.success',
        description: `${account?.username || 'unknown'} authenticated for Teams admin (delegated)`,
        templateKey: 'teams_delegated.success',
        templateParams: { account: account?.username || 'unknown' },
        actorEmail: account?.username || null,
        actorOid: account?.oid || null,
        req,
      }).catch(() => {});
      res.send(renderClosePopupHtml({
        ok: true,
        account: account ? {
          username: account.username,
          name: account.name,
        } : null,
      }));
    });
  } catch (err) {
    console.error('[TeamsDelegated] Token exchange failed:', err.message);
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.AUTH,
      action: 'teams_delegated.failure',
      description: `Teams delegated token exchange failed — ${err.message}`,
      templateKey: 'teams_delegated.failure_token',
      templateParams: { error: err.message },
      success: false,
      errorMessage: err.message,
      req,
    }).catch(() => {});
    res.send(renderClosePopupHtml({ ok: false, error: err.message }));
  }
});

// ─── GET /auth/teams-delegated/status ────────────────────────────
//
// Frontend polls this when opening a TEA-* Configure tab to decide whether
// to show "Sign in to push" vs "Authenticated as ...". Cheap; no Microsoft
// round-trip; just reads the session.
router.get('/status', (req, res) => {
  res.json(oauthDelegated.getDelegatedAuthStatus(req));
});

// ─── POST /auth/teams-delegated/logout ──────────────────────────
//
// Clears the delegated Teams auth WITHOUT touching the main Panoptica
// session. Operator stays logged into Panoptica; just drops the Teams
// admin token. Useful if they want to re-authenticate as a different
// account or revoke a session they no longer need.
router.post('/logout', (req, res) => {
  if (req.session?.teamsDelegated) {
    const username = req.session.teamsDelegated.account?.username || 'unknown';
    delete req.session.teamsDelegated;
    req.session.save(() => {
      console.log(`[TeamsDelegated] Cleared delegated auth for ${username}`);
      mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.AUTH,
        action: 'teams_delegated.logout',
        description: `Cleared Teams admin delegated auth for ${username}`,
        templateKey: 'teams_delegated.logout',
        templateParams: { account: username },
        req,
      }).catch(() => {});
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true, alreadyEmpty: true });
  }
});

/**
 * Tiny HTML response that closes the popup and posts the result to the
 * parent window (the Panoptica tab). The parent listens for this message
 * to refresh its auth-status display.
 *
 * SECURITY: targetOrigin is set to '*' for the postMessage call because
 * the popup needs to work whether Panoptica is served from
 * panoptica.trilogiam.net or any other deployment. The result payload is
 * deliberately minimal — no token material, just status flags. The parent
 * window must validate by RE-FETCHING /auth/teams-delegated/status (which
 * authenticates via session cookie); it must NOT trust the postMessage
 * payload directly.
 */
function renderClosePopupHtml({ ok, error, account }) {
  const payload = JSON.stringify({
    type: 'panoptica.teams-delegated.callback',
    ok: !!ok,
    error: error || null,
    account: account || null,
  });
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Panoptica — Teams Auth ${ok ? 'Success' : 'Failed'}</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; background: #0a0e1a; color: #cbd5e1; text-align: center; }
    .card { max-width: 480px; margin: 40px auto; padding: 24px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; }
    .ok { color: #22c55e; }
    .err { color: #ef4444; }
    .small { font-size: 0.85rem; color: #94a3b8; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    ${ok
      ? `<h2 class="ok">Authenticated</h2><p>You can close this window. Returning to Panoptica…</p>`
      : `<h2 class="err">Authentication failed</h2><p>${escapeHtml(error || 'Unknown error')}</p><p class="small">You can close this window and try again.</p>`
    }
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${payload}, '*');
      }
    } catch (e) { /* ignore */ }
    setTimeout(() => { try { window.close(); } catch(e) {} }, ${ok ? 800 : 4000});
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = router;
