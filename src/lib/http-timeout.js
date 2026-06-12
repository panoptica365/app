/**
 * Panoptica365 — Central outbound-HTTP timeout helper (Reliability P0, 2026-06-12).
 *
 * Every outbound fetch in src/ goes through fetchWithTimeout(). Before this
 * module, a TCP stall (no response, no error — black-holed IP, dead NAT entry,
 * half-open connection) hung the await forever; combined with the workers'
 * skip-if-running overlap guards, one hung fetch silently killed a worker loop
 * until process restart (the guard's `finally` never runs if the await never
 * settles).
 *
 * Semantics: the timeout is a TOTAL deadline from request start, covering both
 * time-to-response-headers AND the body read. The AbortController stays armed
 * after headers arrive, so a stall mid-body (`response.text()` in the caller)
 * also rejects within the deadline instead of hanging — that is what makes
 * "no outbound call can hang forever" true by construction. The armed timer is
 * unref'd and aborting an already-consumed response is a no-op, so the happy
 * path is unaffected.
 *
 * On timeout, the thrown error says timeout + the URL HOST only — never the
 * full URL, because query strings can carry tokens (SAS-signed blob URLs).
 *
 * Callers classify with isTimeoutError(): a timeout is a TRANSIENT network
 * error (retry like a 5xx), never a capability gate or an auth failure.
 */

'use strict';

const config = require('../../config/default');

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return String(url).slice(0, 60); }
}

/**
 * fetch() with a total deadline. `timeoutMs` overrides config.http.timeoutMs
 * (env HTTP_TIMEOUT_MS, default 120000). If `options.signal` is provided it
 * is replaced by the deadline signal — no current call site passes one.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : config.http.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer.unref) timer.unref();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      const e = new Error(`HTTP timeout after ${ms}ms (host: ${hostOf(url)})`);
      e.code = 'ETIMEDOUT';
      e.isTimeout = true;
      throw e;
    }
    throw err;
  }
  // No clearTimeout on success — the armed (unref'd) timer is what bounds the
  // caller's body read. It fires once, aborts a stream that is either already
  // consumed (no-op) or stalled (rejects the read), then is garbage.
}

/**
 * True when `err` came from a fetchWithTimeout deadline — either the nice
 * pre-headers error thrown above, or the raw AbortError a caller sees when
 * the deadline fires mid-body-read.
 */
function isTimeoutError(err) {
  return !!(err && (err.isTimeout === true || err.code === 'ETIMEDOUT' || err.name === 'AbortError'));
}

module.exports = { fetchWithTimeout, isTimeoutError };
