/**
 * Panoptica365 — License Status API
 *
 * Read-only status endpoint consumed by the Stage D frontend banner +
 * (later) the operator settings page. Also exposes an admin-only manual
 * refresh trigger so operators can force-rotate without SSH'ing to the
 * VM to run scripts/refresh-license-now.js.
 *
 *   GET  /api/license/status          (auth required)
 *   POST /api/license/refresh-now     (admin only)
 *
 * Mounted in src/server.js BEFORE the degrade middleware so it's reachable
 * in all phases — operators need to see "your license is in hard phase"
 * specifically when they're locked out of everything else. The middleware's
 * ALWAYS_ALLOWED_PREFIXES also explicitly includes '/api/license' as
 * belt-and-suspenders.
 *
 * Response shape (status):
 *
 *   {
 *     "phase": "ok" | "warning" | "soft" | "hard",
 *     "billing_mode": "paid" | "nfr",
 *     "msp_name": "<string>",
 *     "tier": "standard",
 *     "max_seats": <int>,
 *     "license_id": <int>,
 *     "issued_at": "<ISO>",       (claims.iat as ISO)
 *     "expires_at": "<ISO>",      (claims.exp as ISO — JWT exp = license exp for paid)
 *     "days_past_expiry": <int>,  (0 if not expired, or NFR)
 *     "stale": <bool>,            (true if the cached token is past JWT exp)
 *     "current_seats_reported": <int>|null,
 *     "last_refresh": {
 *       "ok": <bool>,
 *       "at": "<ISO>"|null,
 *       "error": "<string>"|null,
 *       "next_attempt_eta_sec": <int>|null
 *     }
 *   }
 *
 * Stage D frontend reads `phase` + `days_past_expiry` to pick banner copy.
 * Operator settings UI (v0.1.9 backlog) would also surface last_refresh
 * for debugging.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const validator = require('../lib/license/validator');
const degrade = require('../lib/license/degrade-middleware');
const refreshClient = require('../lib/license/refresh-client');

const router = express.Router();

// All license status reads require authentication. The frontend banner
// shows after login; pre-login surfaces don't need license context.
router.use(auth.requireAuth);

router.get('/status', (req, res) => {
  const claims = validator.getLicenseClaims();
  if (!claims) {
    // Boot validation would have process.exit'd if claims couldn't be
    // obtained. If we get here with no claims, something pathological
    // happened mid-process — surface as 500 rather than fabricating a
    // misleading "ok" response.
    return res.status(500).json({
      error: 'license_claims_unavailable',
      detail: 'License claims not available — the install may be in an inconsistent state. Restart Panoptica365.',
    });
  }

  const phase = degrade.computePhase(claims);
  const last = refreshClient.getLastResult();

  res.json({
    phase,
    billing_mode: claims.billing_mode,
    msp_name: claims.msp_name,
    tier: claims.tier,
    max_seats: claims.max_seats,
    license_id: claims.license_id,
    issued_at: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
    expires_at: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    days_past_expiry: degrade.daysPastExpiry(claims),
    stale: !!claims._stale,
    current_seats_reported: last?.ok ? (last.seats ?? null) : null,
    last_refresh: {
      ok: last?.ok ?? null,
      at: last?.at ? last.at.toISOString() : null,
      error: last?.error || null,
    },
  });
});

// Admin-only manual refresh trigger. Returns the refresh result; frontend
// can render an "OK"/"failed" toast.
router.post('/refresh-now', auth.requireAdmin, async (req, res) => {
  try {
    const result = await refreshClient.refreshNow();
    if (result?.ok) {
      return res.json({
        ok: true,
        new_expires_at: result.exp ? result.exp.toISOString() : null,
        seats_reported: result.seats ?? null,
        at: result.at.toISOString(),
      });
    } else {
      // Failed but the refresh-client already handled state — just relay.
      return res.status(502).json({
        ok: false,
        error: result?.error || 'unknown_refresh_error',
        at: result?.at ? result.at.toISOString() : null,
      });
    }
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

module.exports = router;
