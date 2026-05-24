/**
 * Panoptica365 — License Degrade Middleware
 *
 * Three-phase degrade gate for paid licenses past expiry. Mounted in
 * src/server.js AFTER static + /auth (always allowed) and BEFORE the
 * gated /api/* routes.
 *
 * Phases (LOCKED — do NOT relitigate, this matches the May 23 handoff
 * Locked Rule #6):
 *
 *   | Phase    | Days past JWT exp | Behavior                              |
 *   |----------|-------------------|---------------------------------------|
 *   | ok       | exp not yet passed| Pass through everything.              |
 *   | warning  | 1-14 days         | Pass through. Frontend shows banner.  |
 *   | soft     | 15-21 days        | Block specific creates (tenant +      |
 *   |          |                   | Intune template + CA template).       |
 *   |          |                   | Polling continues. Other writes pass. |
 *   | hard     | 22+ days          | Read-only. Reject all non-GET except  |
 *   |          |                   | login/logout/healthz/license routes.  |
 *   |          |                   | Polling stops (Stage C TODO).         |
 *
 * NFR licenses (`billing_mode === 'nfr'`) SKIP ALL PHASES — they're
 * perpetual by definition. A stale NFR token is purely a refresh-cycle
 * concern; the refresh client retries urgently and the install keeps
 * operating normally meanwhile.
 *
 * Boot-time validation guarantees billing_mode is one of 'paid' | 'nfr'
 * (license server enforces the ENUM); we still handle unknown billing
 * modes defensively (fail-open to 'ok' — better to let a malformed
 * license run than to break a customer for an enum typo).
 *
 * Polling-stops-on-hard-phase is intentionally NOT wired in this
 * middleware — it's a polling-engine concern (src/polling.js needs a
 * check at cycle start). Tracked as Stage C follow-up below; for the
 * initial v0.1.8 ship, hard-phase only blocks HTTP writes. Polling
 * continues even in hard phase, which is operationally consistent with
 * "the install still produces signal, the operator just can't act on
 * it via the UI". If we ship Stage C without the polling stop, the
 * worst that happens is a paid+hard tenant burns Microsoft API quota
 * for data nobody can see — a backlog item, not a security issue.
 */

'use strict';

const validator = require('./validator');
const setupState = require('../setup/state');

// Phase boundaries — measured in DAYS past exp. Inclusive lower bound.
const WARNING_FROM_DAYS = 1;   // days 1-14
const SOFT_FROM_DAYS = 15;     // days 15-21
const HARD_FROM_DAYS = 22;     // days 22+

// Routes that always pass, regardless of degrade phase. These are read-only
// or auth-flow routes that customers MUST be able to hit to recover.
//
// Matching is "request URL startsWith X" — keep the patterns prefix-shaped.
const ALWAYS_ALLOWED_PREFIXES = [
  '/auth',                  // login, OAuth callbacks, logout
  '/healthz',               // container orchestration
  '/api/health',            // operator health diagnostics
  '/api/license',           // status endpoint + manual refresh
  '/api/meta',              // version, what's-new, i18n strings — for the banner
  '/api/i18n',              // localized strings — for the banner
  '/partials/login',        // login partial (in case SPA navigates to it)
  '/css',                   // static assets
  '/js',
  '/img',
  '/fonts',
  '/favicon',
];

// Routes specifically blocked in SOFT phase. POST/PUT only — GETs pass.
// Matches "URL startsWith X AND method in [POST, PUT]".
//
// The handoff calls out three creation surfaces:
//   - tenants:          POST /api/tenants
//   - Intune templates: POST /api/intune/templates
//   - CA templates:     POST /api/ca/templates
//
// We don't block UPDATEs (PUT /api/tenants/:id, PATCH /api/ca/templates/:id)
// because operators may need to edit existing config during the grace period
// (renaming a tenant, fixing a typo in a template). New-resource creation is
// the dimension the license actually limits.
const SOFT_BLOCKED_CREATES = [
  // POST-only blocks:
  { method: 'POST', pathExact: '/api/tenants' },
  { method: 'POST', pathExact: '/api/intune/templates' },
  { method: 'POST', pathExact: '/api/ca/templates' },
  // Bulk-add lands new deployments in the tenant — equivalent to "creating
  // new managed resources" so it's blocked too.
  { method: 'POST', pathExact: '/api/intune/templates/bulk' },
];

/**
 * Compute the current phase from claims + the validator's stale flag.
 * Pure function, easy to unit-test.
 *
 * Returns one of: 'ok' | 'warning' | 'soft' | 'hard'
 *
 * If claims is missing/malformed, returns 'ok' (fail-open). Boot validation
 * has already exit'd if claims couldn't be obtained at all; if they were
 * obtained but something is weird, don't punish the customer.
 */
function computePhase(claims) {
  if (!claims || typeof claims !== 'object') return 'ok';

  // NFR licenses NEVER degrade. Perpetual by design.
  if (claims.billing_mode === 'nfr') return 'ok';

  // Unknown billing_mode → fail-open. Lets us add new modes later without
  // breaking existing installs that haven't gotten the upgrade.
  if (claims.billing_mode !== 'paid') return 'ok';

  // Paid — check days past exp. JWT exp is in unix seconds.
  if (!Number.isFinite(claims.exp)) return 'ok';
  const nowSec = Math.floor(Date.now() / 1000);
  const secPastExp = nowSec - claims.exp;
  if (secPastExp <= 0) return 'ok';

  const daysPastExp = Math.floor(secPastExp / 86400);
  if (daysPastExp >= HARD_FROM_DAYS) return 'hard';
  if (daysPastExp >= SOFT_FROM_DAYS) return 'soft';
  if (daysPastExp >= WARNING_FROM_DAYS) return 'warning';
  return 'ok';
}

/**
 * Compute days past expiry. Returns 0 for non-expired or NFR. Useful for
 * the status endpoint response and banner copy.
 */
function daysPastExpiry(claims) {
  if (!claims || claims.billing_mode === 'nfr' || !Number.isFinite(claims.exp)) {
    return 0;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const sec = nowSec - claims.exp;
  return sec > 0 ? Math.floor(sec / 86400) : 0;
}

/**
 * Check if a request matches an entry in the soft-phase block list.
 */
function isSoftBlocked(req) {
  for (const rule of SOFT_BLOCKED_CREATES) {
    if (req.method === rule.method && req.path === rule.pathExact) return true;
  }
  return false;
}

/**
 * Check if a request is always allowed regardless of phase.
 */
function isAlwaysAllowed(req) {
  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (req.path === prefix || req.path.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * The middleware itself. Reads the validator's cached claims (refreshed on
 * every successful refresh, valid for the process lifetime after boot
 * validation succeeded). Computes phase. Returns 402 on block, passes
 * through otherwise.
 *
 * 402 = Payment Required — semantically correct for "your license has
 * expired, please renew". Most API clients (including our frontend) will
 * see a 402 and route to a "license issue" UX flow instead of generic
 * error handling.
 */
function degradeMiddleware(req, res, next) {
  // ─── Setup-mode bypass (v0.1.10+) ──────────────────────────────────
  // Fresh installs running the first-boot wizard don't yet have a
  // license at all. The setup middleware (mounted earlier) gates most
  // routes, but the wizard's own /api/setup/* endpoints would otherwise
  // hit this degrade middleware — which would try to read claims (null
  // in setup mode, returns 'ok' anyway) and pass through, but better to
  // short-circuit cleanly than rely on the fail-open branch.
  if (setupState.isInSetupMode()) return next();

  // GETs always pass — read access is preserved in all phases.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Always-allowed prefixes pass regardless of method (login, logout, etc.).
  if (isAlwaysAllowed(req)) return next();

  const claims = validator.getLicenseClaims();
  const phase = computePhase(claims);

  if (phase === 'ok' || phase === 'warning') {
    // Warning phase: banner-only, no functional restrictions.
    return next();
  }

  if (phase === 'soft') {
    if (isSoftBlocked(req)) {
      return res.status(402).json({
        error: 'license_degraded_soft',
        phase: 'soft',
        days_past_expiry: daysPastExpiry(claims),
        detail:
          'License has expired. New tenant / Intune template / CA template ' +
          'creation is disabled. Existing data, alerts, and edits still work. ' +
          'Renew via your MSP or license@panoptica365.com.',
      });
    }
    return next();
  }

  // HARD: only GETs and always-allowed prefixes pass (already handled above).
  // Anything else is rejected.
  return res.status(402).json({
    error: 'license_degraded_hard',
    phase: 'hard',
    days_past_expiry: daysPastExpiry(claims),
    detail:
      'License has expired and grace period has lapsed. The install is in ' +
      'read-only mode until renewal. Existing data is viewable; new actions ' +
      'are blocked. Renew via your MSP or license@panoptica365.com.',
  });
}

module.exports = {
  degradeMiddleware,
  // Pure helpers — exposed for the status endpoint + unit tests.
  computePhase,
  daysPastExpiry,
  isAlwaysAllowed,
  isSoftBlocked,
  // Constants for tests / status endpoint:
  WARNING_FROM_DAYS,
  SOFT_FROM_DAYS,
  HARD_FROM_DAYS,
  ALWAYS_ALLOWED_PREFIXES,
  SOFT_BLOCKED_CREATES,
};
