/**
 * Panoptica365 — Setup-Mode Middleware
 *
 * When the install hasn't completed first-boot setup, this middleware
 * funnels EVERY request to the wizard. Allowed paths are an explicit
 * allowlist (the wizard itself, the setup-API, static assets, healthz).
 * Everything else gets a 503 (or a redirect for browser requests) until
 * setup completes.
 *
 * Once setup-completed-once.flag exists, this middleware is a no-op pass-
 * through. So in production steady state it costs one fs.existsSync per
 * boot (cached after — see below), then nothing per request.
 *
 * The setup-mode flag is cached in module scope and refreshed only when
 * the cache TTL elapses (5s). Two reasons:
 *   - Avoid an fs.existsSync on every single request (cheap, but pointless
 *     waste once the install is up and serving normal traffic).
 *   - Allow the wizard's final step (markSetupComplete) to immediately
 *     flip the gate without restarting the server — the next request
 *     after the 5s window sees the flag and stops gating. (Operator
 *     sees the wizard's "redirecting to dashboard" page during that
 *     5s; entirely fine.)
 *
 * Mount order matters. In src/server.js this should be mounted AFTER:
 *   - express.json() / urlencoded() (so POST bodies parse)
 *   - /healthz (always allowed regardless)
 *   - express.static (CSS/JS/images for the wizard itself need to load)
 * And BEFORE:
 *   - Session middleware (sessions are pointless in setup mode — no auth)
 *   - All /api/* routes except /api/setup/* (which it lets through)
 *   - The main SPA route (`GET /`)
 */

'use strict';

const setupState = require('./state');

// Paths that always pass, even in setup mode. Matching is
// "request path startsWith prefix" — keep these prefix-shaped.
const SETUP_ALLOWED_PREFIXES = [
  '/setup',         // the wizard HTML page itself
  '/api/setup',     // the wizard's own API endpoints
  '/api/i18n',      // localized strings — wizard needs them
  '/api/meta',      // version info (in case wizard wants to show "Panoptica365 v0.1.10")
  '/healthz',       // container orchestration
  '/css',           // static assets the wizard pulls
  '/js',
  '/img',
  '/fonts',
  '/favicon',
];

// Cache the setup-mode flag for 5 seconds. Production-steady-state installs
// will have setup-completed-once.flag — cache hit, no fs call per request.
// Fresh installs in setup mode also benefit: 5s cache means thousands of
// wizard asset loads (JS, CSS, fetch calls) only trigger one fs.existsSync.
let _cachedSetupMode = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 5_000;

function isSetupModeCached() {
  const now = Date.now();
  if (_cachedSetupMode !== null && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedSetupMode;
  }
  _cachedSetupMode = setupState.isInSetupMode();
  _cachedAt = now;
  return _cachedSetupMode;
}

/**
 * Force the cache to expire. Used immediately after the wizard's
 * /api/setup/complete endpoint so the very next request sees normal mode.
 */
function invalidateSetupModeCache() {
  _cachedSetupMode = null;
  _cachedAt = 0;
}

/**
 * Path-allowlist check. Same shape as the license degrade middleware's
 * isAlwaysAllowed.
 */
function isAllowedInSetupMode(req) {
  for (const prefix of SETUP_ALLOWED_PREFIXES) {
    if (req.path === prefix || req.path.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * The middleware. Pass-through if not in setup mode OR if the path is
 * on the allowlist. Otherwise: browser requests (Accept: text/html) get
 * a 302 redirect to /setup; API requests get a 503.
 */
function setupMiddleware(req, res, next) {
  if (!isSetupModeCached()) return next();
  if (isAllowedInSetupMode(req)) return next();

  // Distinguish browser navigation from API/XHR. Browser HTML loads should
  // redirect (lets the operator land on the wizard naturally). API calls
  // get a structured 503 so frontend code can detect "setup required" and
  // handle it without parsing HTML.
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return res.redirect(302, '/setup');
  }
  return res.status(503).json({
    error: 'setup_required',
    detail: 'Panoptica365 install is in first-boot setup. Open /setup to complete.',
    setup_url: '/setup',
  });
}

module.exports = {
  setupMiddleware,
  invalidateSetupModeCache,
  // Constants exposed for tests + diagnostic
  SETUP_ALLOWED_PREFIXES,
  CACHE_TTL_MS,
};
