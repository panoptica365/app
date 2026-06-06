/**
 * Panoptica365 — Legal / EULA API
 *
 * Mounted at /api/legal (server.js), BEFORE the license-degrade middleware so
 * the agreement gate is reachable during the first-boot wizard (pre-auth,
 * pre-license) and is never blocked by a degraded license.
 *
 *   GET  /api/legal/eula?lang=<locale>   — current EULA + acceptance state
 *   POST /api/legal/eula/accept          — record a typed-name acceptance
 *
 * Auth model (spec §5.1 / §5.2):
 *   - While the install is still in first-boot setup, both endpoints are
 *     reachable WITHOUT auth (the operator isn't logged in yet — the wizard
 *     itself is the context). The setup middleware allowlist (/api/legal) lets
 *     them through; setup mode IS the gate.
 *   - Once setup completes, both endpoints require Admin (consistent with the
 *     admin-only Settings tile). The unauthenticated path then 403s — a live
 *     install never exposes these anonymously.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const legal = require('../legal');
const setupState = require('../lib/setup/state');
const mspAudit = require('../msp-audit');

const router = express.Router();
router.use(express.json());

// While setup is incomplete, allow anonymous access (wizard context). Once
// setup is complete, fall through to requireAdmin (401 if not logged in,
// 403 if logged in but not admin).
function eulaAccess(req, res, next) {
  if (setupState.isInSetupMode()) return next();
  return auth.requireAdmin(req, res, next);
}

// ─── GET /api/legal/eula ───────────────────────────────────────────────────
router.get('/eula', eulaAccess, async (req, res) => {
  try {
    const requested = req.query.lang || req.session?.user?.language || legal.DEFAULT_LOCALE;
    const version = legal.getCurrentVersion();
    const { content, localeServed } = legal.readEulaContent(version, requested);
    const state = await legal.getAcceptanceState();
    res.json({
      version,
      locale: localeServed,
      content,
      accepted: state.accepted,
      acceptance: state.acceptance,
      history: state.history,
    });
  } catch (err) {
    console.error('[Legal] GET /eula failed:', err.message);
    res.status(500).json({ error: 'Failed to load EULA' });
  }
});

// ─── POST /api/legal/eula/accept ───────────────────────────────────────────
router.post('/eula/accept', eulaAccess, async (req, res) => {
  try {
    const rawName = (req.body && req.body.typed_name) || '';
    const typedName = String(rawName).trim();
    // The typed name IS the signature — validate length only, don't be clever
    // about "realness".
    if (typedName.length < 2 || typedName.length > 255) {
      return res.status(400).json({
        error: 'invalid_name',
        detail: 'typed_name must be 2–255 non-whitespace characters.',
      });
    }

    const locale = legal.resolveLocale(req.body && req.body.locale);
    // Context is derived from install state, never trusted from the client.
    const inSetup = setupState.isInSetupMode();
    const context = inSetup ? 'install' : 'reaccept';

    // Capture the authenticated identity when present (post-setup re-accept).
    // Null during the pre-auth fresh-install acceptance.
    const sessionUser = req.session?.user || {};
    const entraObjectId = sessionUser.oid || null;
    const userEmail = sessionUser.email || null;

    const result = await legal.recordAcceptance({
      typedName,
      locale,
      context,
      entraObjectId,
      userEmail,
    });

    if (result.alreadyAccepted) {
      // Idempotent: another acceptance for this version already exists
      // (double-click, or a second admin beat this one). Not an error.
      return res.json({ ok: true, already_accepted: true, version: result.version });
    }

    // Audit every successful acceptance (template-key pattern — Phase 11).
    // Fire-and-forget: an audit gap must never fail the acceptance.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'eula.accept',
      description: `${typedName} accepted the End User License Agreement (version ${result.version})`,
      templateKey: 'eula_accepted',
      templateParams: { typedName, eulaVersion: result.version, context },
      targetType: 'setting',
      targetName: `EULA v${result.version}`,
      metadata: { context, locale_viewed: result.localeViewed },
      req,
    }).catch(() => {});

    res.json({
      ok: true,
      already_accepted: false,
      version: result.version,
      locale_viewed: result.localeViewed,
    });
  } catch (err) {
    console.error('[Legal] POST /eula/accept failed:', err.message);
    res.status(500).json({ error: 'Failed to record acceptance' });
  }
});

module.exports = router;
