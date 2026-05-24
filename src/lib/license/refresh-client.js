/**
 * Panoptica365 — License Refresh Client
 *
 * Weekly heartbeat to the license server. POSTs the current JWT +
 * fingerprint + current_seats to /api/v1/refresh, gets a fresh JWT back,
 * verifies it locally, and persists to .env + cache.
 *
 * Design notes (locked May 24, 2026):
 *
 *   - Cadence: 7 days after each successful refresh. On failure, retry
 *     in 24h. The retry interval bumps the next attempt up to weekly
 *     timing if the failure was transient — no exponential backoff,
 *     because the license server is a single low-traffic instance and
 *     a daily retry won't overwhelm it even at 1000+ MSPs.
 *
 *   - Boot scheduling: read claims.iat to compute the time-since-last-
 *     refresh. If overdue → refresh after a small jitter (0-30s) so a
 *     fleet deploying simultaneously doesn't stampede the license
 *     server. If due in the future → schedule a timer for that future
 *     point. Never schedule past JWT exp - 1h, because once exp passes
 *     a refresh attempt is the only way to recover (especially for NFR
 *     stale-acceptance).
 *
 *   - Seats reporting: sum of `user_summary.licensed` across all enabled,
 *     non-audit-only tenants. Read from metric_snapshots_latest (the
 *     cheap denormalized table from May 16). Audit-only tenants don't
 *     count — per the locked May 23 decision they're trial-mode and
 *     auto-expire after 14 days. Failure to compute seats is non-fatal:
 *     we send `current_seats=null` and the license server treats that
 *     as "no update" (existing value retained).
 *
 *   - Token + fingerprint sources: token from .env (canonical) or cache
 *     sidecar (fallback if .env was wiped between boot and first refresh).
 *     Fingerprint from process.env (always persisted on first boot by the
 *     storage layer). Boot validation already verified both at startup,
 *     so the refresh can assume sane values.
 *
 *   - Persistence on success: writes the new token to BOTH .env and the
 *     cache sidecar via store.persistRotatedToken(). The validator's
 *     in-memory claims cache is also refreshed because
 *     loadAndVerifyLicenseToken() updates _lastVerifiedClaims as a side
 *     effect. Downstream consumers (Stage C degrade middleware, Stage D
 *     banner) automatically see the new claims on their next call.
 *
 *   - NFR-aware behavior: when current claims are NFR and stale-recovery
 *     succeeded at boot, the refresh client refreshes urgently regardless
 *     of cadence (treats stale=true as "next attempt now"). The license
 *     server's /refresh endpoint will reject the stale JWT (jwtVerify
 *     enforces exp on the server side too), so this is currently a
 *     known gap: an NFR install whose JWT has expired cannot self-recover
 *     via refresh until license-server v0.1.1 adds a /reactivate-style
 *     endpoint or extends /refresh to accept stale NFR tokens.
 *     Documented in the v0.1.9 backlog (Task #12).
 *
 *   - Module exports `start()` + `stop()` consumed by server.js
 *     lifecycle (start in the post-listen callback, stop in SIGINT/
 *     SIGTERM handlers). `refreshNow()` is exposed for future manual-
 *     trigger UI or admin actions.
 */

'use strict';

const validator = require('./validator');
const store = require('./store');
const db = require('../../db/database');

// ─── Constants ───────────────────────────────────────────────────────

// 7 days between successful refreshes.
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// 24 hours between failed-then-retry attempts.
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Don't schedule a refresh attempt closer than 1 hour before JWT exp —
// past that, the JWT is so close to expiring that we should attempt sooner.
const EXP_GUARD_SEC = 3600;

// Random 0-30s jitter on overdue or boot-immediate refreshes, so a fleet
// of installs that all just rebooted doesn't hammer the license server.
const BOOT_JITTER_MAX_MS = 30 * 1000;

// Refresh endpoint URL. Hardcoded production default; overridable via env for
// dev / test scenarios. Production deploys never set this; dev points it at
// http://192.168.60.75:8080/api/v1/refresh against License-DEV.
const REFRESH_URL = process.env.LICENSE_REFRESH_URL
  || 'https://license.panoptica365.com/api/v1/refresh';

// Fetch timeout — license server is normally <500ms; 15s is generous.
const REFRESH_TIMEOUT_MS = 15 * 1000;

// ─── State ──────────────────────────────────────────────────────────

let _timer = null;
let _stopping = false;
let _lastResult = null; // { ok: bool, at: Date, error?: string, exp?: Date }

// ─── Helpers ────────────────────────────────────────────────────────

function jitterMs() {
  return Math.floor(Math.random() * BOOT_JITTER_MAX_MS);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Compute delay until the next refresh attempt, given the current claims.
 *
 * Returns milliseconds. Always positive.
 *
 *   - If the ideal next refresh (claims.iat + 7d) is in the past → jitterMs().
 *   - Otherwise → min(time-until-ideal, time-until-(exp-1h)) ensuring we
 *     never sleep past the exp guard. Both fall back to a small jitter on
 *     edge cases (already-expired etc.).
 */
function computeNextDelayMs(claims) {
  if (!claims) return jitterMs();
  const now = nowSec();
  const iat = claims.iat || now;
  const exp = claims.exp || (now + REFRESH_INTERVAL_MS / 1000);

  const idealNextSec = iat + REFRESH_INTERVAL_MS / 1000;
  let delaySec = idealNextSec - now;

  // Cap so we wake up well before JWT exp.
  const maxBeforeExpSec = (exp - now) - EXP_GUARD_SEC;
  if (maxBeforeExpSec > 0 && delaySec > maxBeforeExpSec) {
    delaySec = maxBeforeExpSec;
  }

  if (delaySec <= 0) return jitterMs();
  return delaySec * 1000;
}

/**
 * Sum `user_summary.licensed` across all enabled non-audit-only tenants.
 * Returns an integer ≥ 0, or null if no usable data (and we should report
 * "no update" to the license server).
 *
 * Reads from metric_snapshots_latest (the denormalized cache from May 16).
 * Cheap — single indexed query, no GROUP BY MAX scan.
 */
async function getCurrentSeats() {
  let rows;
  try {
    rows = await db.queryRows(
      `SELECT msl.metric_value
       FROM metric_snapshots_latest msl
       JOIN tenants t ON t.id = msl.tenant_id
       WHERE msl.service = 'entra'
         AND msl.metric_name = 'user_summary'
         AND t.enabled = 1
         AND (t.mode IS NULL OR t.mode = 'managed')`,
    );
  } catch (e) {
    // Don't block refresh on a seat-count query failure. Log + return null.
    console.warn(`[License] Seat counting query failed: ${e.message}`);
    return null;
  }

  if (!rows || rows.length === 0) return null;

  let total = 0;
  let counted = 0;
  for (const row of rows) {
    let value = row.metric_value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { continue; }
    }
    if (value && typeof value === 'object' && Number.isFinite(value.licensed)) {
      total += value.licensed;
      counted += 1;
    }
  }

  // If we got rows but none had usable shape, treat as "no update".
  if (counted === 0) return null;
  return total;
}

/**
 * POST to /api/v1/refresh with timeout. Returns parsed response object on
 * 200 (shape: { token, issued_at, expires_at, msp_name, tier, billing_mode,
 * max_seats }). Throws Error on any non-200 or network failure.
 */
async function postRefresh(currentJwt, fingerprint, currentSeats) {
  const body = { current_jwt: currentJwt, fingerprint };
  if (currentSeats !== null && Number.isInteger(currentSeats)) {
    body.current_seats = currentSeats;
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Read body once for diagnostic; try JSON first, fall back to text.
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = '(no body)';
      }
    }
    throw new Error(`HTTP ${res.status} from license server: ${detail}`);
  }

  const parsed = await res.json();
  if (!parsed || typeof parsed.token !== 'string' || parsed.token.length < 20) {
    throw new Error(`Refresh response missing token field`);
  }
  return parsed;
}

/**
 * Schedule the next refresh attempt. Cancels any pending timer first so
 * we never leak overlapping refresh windows.
 */
function scheduleNext(delayMs) {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  if (_stopping) return;
  // Node 24 setTimeout caps at ~24.8d (2^31-1 ms). We cap our delays well
  // below that (7d + EXP_GUARD), so no overflow concern.
  _timer = setTimeout(() => {
    _timer = null;
    performRefresh().catch((e) => {
      // performRefresh's own catch handles scheduling — this is a final
      // safety net for any unexpected throw.
      console.error(`[License] Refresh cycle threw unexpectedly: ${e.stack || e.message}`);
      scheduleNext(RETRY_INTERVAL_MS);
    });
  }, delayMs);
  // Don't keep the event loop alive just for the refresh timer — SIGINT
  // should still shut down cleanly even if a 7-day timer is pending.
  if (_timer && typeof _timer.unref === 'function') _timer.unref();

  const eta = new Date(Date.now() + delayMs).toISOString();
  console.log(`[License] Next refresh attempt scheduled for ${eta} (in ${Math.round(delayMs / 1000)}s)`);
}

/**
 * Perform one refresh attempt. On success: persist new token, re-schedule
 * for +7d. On failure: leave existing token in place, re-schedule for +24h.
 */
async function performRefresh() {
  if (_stopping) return;

  const currentToken = store.getEnvToken() || store.getCachedToken();
  if (!currentToken) {
    console.error(
      `[License] Cannot refresh: no token in .env and no cache file. ` +
      `Boot validation must have skipped — investigate. Retrying in 24h.`,
    );
    _lastResult = { ok: false, at: new Date(), error: 'no_token' };
    scheduleNext(RETRY_INTERVAL_MS);
    return;
  }

  const claims = validator.getLicenseClaims();
  const fingerprint = claims?.fingerprint || process.env.PANOPTICA_INSTALL_FINGERPRINT;
  if (!fingerprint) {
    console.error(`[License] Cannot refresh: no fingerprint available. Retrying in 24h.`);
    _lastResult = { ok: false, at: new Date(), error: 'no_fingerprint' };
    scheduleNext(RETRY_INTERVAL_MS);
    return;
  }

  let currentSeats = null;
  try {
    currentSeats = await getCurrentSeats();
  } catch (e) {
    // Already logged inside getCurrentSeats; not fatal.
    currentSeats = null;
  }

  try {
    const response = await postRefresh(currentToken, fingerprint, currentSeats);

    // Verify the new token locally before trusting it. If the license server
    // returned a malformed or wrong-fingerprint token, fail like any other
    // verification failure — DON'T persist it.
    const { claims: newClaims } = await validator.loadAndVerifyLicenseToken(
      response.token, fingerprint,
    );

    // Persist to .env + cache sidecar.
    const persist = store.persistRotatedToken(response.token, newClaims);

    const expISO = new Date(newClaims.exp * 1000).toISOString();
    const seatsPart = currentSeats !== null ? ` (reported ${currentSeats} seats)` : '';
    const envPart = persist.envWritten ? '' : ' (.env write FAILED — cache only)';
    console.log(`[License] Refresh OK — new exp=${expISO}${seatsPart}${envPart}`);

    _lastResult = {
      ok: true,
      at: new Date(),
      exp: new Date(newClaims.exp * 1000),
      seats: currentSeats,
    };
    scheduleNext(REFRESH_INTERVAL_MS);
  } catch (e) {
    console.error(`[License] Refresh failed: ${e.message}. Retrying in 24h.`);
    _lastResult = { ok: false, at: new Date(), error: e.message };
    scheduleNext(RETRY_INTERVAL_MS);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Start the refresh scheduler. Called from server.js after the server is
 * listening. No-op if already started.
 */
function start() {
  if (_timer) {
    console.warn('[License] Refresh client start() called but timer already pending');
    return;
  }
  _stopping = false;

  const claims = validator.getLicenseClaims();
  if (!claims) {
    // Should never happen — boot validation would have process.exit'd. But
    // if some edge case lets us get here, schedule a retry in 24h so we
    // don't silently never refresh.
    console.error('[License] Refresh client started without verified claims — scheduling 24h retry');
    scheduleNext(RETRY_INTERVAL_MS);
    return;
  }

  const delayMs = computeNextDelayMs(claims);
  scheduleNext(delayMs);
}

/**
 * Stop the refresh scheduler. Called from server.js SIGINT/SIGTERM handlers.
 * Cancels any pending timer.
 */
function stop() {
  _stopping = true;
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  console.log('[License] Refresh client stopped');
}

/**
 * Manually trigger a refresh now. Returns a promise that resolves to the
 * result. Does NOT cancel the regularly-scheduled timer — the manual
 * refresh's completion will replace the existing schedule via performRefresh's
 * own scheduleNext call.
 */
async function refreshNow() {
  await performRefresh();
  return _lastResult;
}

/**
 * Inspect the last refresh attempt's result. Returns null if no attempt has
 * been made yet in this process lifetime.
 */
function getLastResult() {
  return _lastResult;
}

module.exports = {
  start,
  stop,
  refreshNow,
  getLastResult,
  // Internal exports for tests:
  _computeNextDelayMs: computeNextDelayMs,
  _getCurrentSeats: getCurrentSeats,
};
