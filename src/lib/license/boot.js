/**
 * Panoptica365 — License Boot Orchestrator
 *
 * One function exported: validateLicenseAtBoot(). Called from src/server.js
 * BEFORE db.ping() so a license failure stops the install before any DB
 * connection / scheduler / route is wired up.
 *
 * Flow (locked May 24, 2026):
 *
 *   1. Resolve/generate the install fingerprint. If PANOPTICA_INSTALL_FINGERPRINT
 *      is missing from process.env, generate a UUID v4 and persist to .env.
 *      Print it to console so the operator sees the value they'll need
 *      for /api/v1/activate.
 *
 *   2. Resolve the license token. Order:
 *        a. process.env.LICENSE_TOKEN (canonical)
 *        b. data/state/license-cache.json (sidecar fallback)
 *        c. Neither → boot-refuse with the activation instructions.
 *
 *   3. Validate. If the env token is present but invalid (signature,
 *      fingerprint, paid expiry), boot-refuse — do NOT fall back to cache.
 *      An invalid env token suggests tamper/corruption and deserves a loud
 *      failure. The cache is only the fallback for MISSING env, not for
 *      INVALID env.
 *
 *   4. On success, mirror the verified token to the cache (so a future
 *      .env wipe survives), log a one-line summary, and return the claims
 *      to the caller. The caller passes them into the degrade middleware
 *      (Stage C) and the refresh client (Stage B).
 *
 *   5. On any failure, print a clearly-framed multi-line error block to
 *      stderr explaining what went wrong and how to fix it, then
 *      process.exit(1). Boot validation is the only hard-refuse point in
 *      the v0.1.8 design — Stage C's degrade middleware handles softer
 *      "license is expiring" UX after boot.
 *
 * Returns: the verified claims object (caller stashes for downstream use).
 * Never returns on failure — process.exit(1).
 */

const validator = require('./validator');
const store = require('./store');
const setupState = require('../setup/state');

function box(lines) {
  // Visual delimiter for the boot error block. Matches the style of the
  // existing console.log box in src/server.js's startup banner.
  const sep = '═'.repeat(74);
  return [sep, ...lines, sep].join('\n');
}

function printActivationInstructions({ fingerprint, reason }) {
  const block = box([
    '',
    '  Panoptica365 — License Required',
    '',
    `  Reason: ${reason}`,
    '',
    '  To activate this installation:',
    '',
    '    1. Get your 24-char activation key from your Panoptica365',
    '       license email (or contact license@panoptica365.com).',
    '',
    '    2. Exchange the key for a license token:',
    '',
    '         curl -X POST https://license.panoptica365.com/api/v1/activate \\',
    '           -H "Content-Type: application/json" \\',
    '           -d \'{"activation_key":"YOUR-KEY-HERE","fingerprint":"' + fingerprint + '"}\'',
    '',
    '       Your install fingerprint is:',
    `         ${fingerprint}`,
    '',
    '    3. Copy the `token` field from the response and set',
    '       LICENSE_TOKEN in your .env to that value.',
    '',
    '    4. Restart Panoptica365.',
    '',
    '  Once Stage 4 ships, the installer handles steps 2-4 automatically.',
    '',
  ]);
  process.stderr.write('\n' + block + '\n\n');
}

function printValidationFailure({ code, message, fingerprint }) {
  const block = box([
    '',
    '  Panoptica365 — License Validation FAILED',
    '',
    `  Error code: ${code}`,
    `  Detail:     ${message}`,
    '',
    `  Install fingerprint: ${fingerprint}`,
    `  Public key:          ${validator.PUBLIC_KEY_PATH}`,
    `  Cache file:          ${store.CACHE_PATH}`,
    '',
    '  Common causes by code:',
    '',
    '    TOKEN_MALFORMED       — .env LICENSE_TOKEN is not a valid JWT.',
    '                            Check for line-wrap / paste truncation.',
    '',
    '    SIGNATURE_INVALID     — Token signed by a different keypair, or',
    '                            keys/license-server-public-key.pem in this',
    '                            install is stale. Redeploy a clean GHCR image.',
    '',
    '    FINGERPRINT_MISMATCH  — Token was issued for a different install.',
    '                            Re-run /api/v1/activate with THIS install\'s',
    '                            fingerprint (printed above), then update',
    '                            LICENSE_TOKEN.',
    '',
    '    TOKEN_EXPIRED         — Paid license has expired. Renew via your',
    '                            MSP / license@panoptica365.com. NFR licenses',
    '                            should NEVER hit this — if you see it on NFR,',
    '                            report a bug.',
    '',
    '    WRONG_ISSUER          — Token issued by some other service. Verify',
    '                            you copied the right value into LICENSE_TOKEN.',
    '',
    '    PUBLIC_KEY_MISSING    — Image is broken. Redeploy from GHCR.',
    '',
  ]);
  process.stderr.write('\n' + block + '\n\n');
}

/**
 * Resolves and validates the install's license at boot.
 *
 * @returns {Promise<{claims: object, stale: boolean, source: 'env'|'cache', fingerprint: string}>}
 *
 * Never returns on failure — calls process.exit(1).
 */
async function validateLicenseAtBoot() {
  // ─── 0a. Legacy-install migration (v0.1.10+) ───────────────────────
  // Installs that pre-date v0.1.10 went through the manual setup
  // workflow and don't have data/state/setup-completed-once.flag.
  // Without migration they'd enter setup mode on next boot and the
  // setup middleware would gate the entire app behind /setup. Detection
  // is "valid-shaped LICENSE_TOKEN exists" — strong signal of a working
  // pre-existing install. See src/lib/setup/state.js for the design.
  try {
    const migration = setupState.migrateLegacyInstall();
    if (migration.migrated) {
      // Already logged by the migrator itself.
    }
  } catch (e) {
    console.warn(`[License] Legacy-install migration failed: ${e.message}`);
  }

  // ─── 0b. Setup-mode bypass (v0.1.10+) ──────────────────────────────
  // First-boot wizard: fresh install with no completed setup MUST be able
  // to boot so the operator can run the wizard. License validation would
  // otherwise process.exit because LICENSE_TOKEN is empty. The wizard's
  // license step (Step 6 of 8) calls /api/v1/activate and persists the
  // resulting token; from the NEXT boot onward setup mode is false and
  // this bypass no-ops, restoring strict license enforcement.
  //
  // Safety: setupState.isInSetupMode() returns false the moment
  // setup-completed-once.flag exists, even if setup.json is later deleted.
  // See src/lib/setup/state.js for the load-bearing logic.
  if (setupState.isInSetupMode()) {
    console.log(
      '[License] Boot validation SKIPPED — install is in first-boot setup mode. ' +
      'Open /setup in a browser to complete the wizard.',
    );
    // Still generate + persist the fingerprint so the wizard's license
    // step has a stable value to pass to /api/v1/activate. The fingerprint
    // generator is idempotent — won't overwrite an existing value.
    try {
      store.getOrCreateFingerprint();
    } catch (e) {
      console.warn(`[License] Setup-mode fingerprint generation failed: ${e.message}`);
    }
    return { claims: null, stale: false, source: 'setup-mode-bypass', fingerprint: null };
  }

  // ─── 1. Fingerprint ─────────────────────────────────────────────────
  let fingerprint;
  try {
    fingerprint = store.getOrCreateFingerprint();
  } catch (e) {
    process.stderr.write(
      '\n' + box([
        '',
        '  Panoptica365 — Fingerprint generation FAILED',
        '',
        `  Detail: ${e.message}`,
        '',
        '  This is almost always a filesystem permission problem. The app',
        '  needs to read AND write .env at the project root.',
        '',
      ]) + '\n\n',
    );
    process.exit(1);
  }

  // ─── 2. Token resolution ───────────────────────────────────────────
  const envToken = store.getEnvToken();
  let token = envToken;
  let source = 'env';

  if (!token) {
    const cached = store.getCachedToken();
    if (cached) {
      token = cached;
      source = 'cache';
      console.warn(
        '[License] LICENSE_TOKEN missing from .env — falling back to ' +
        'data/state/license-cache.json. This is the safety net for an ' +
        'accidental .env wipe. Restore LICENSE_TOKEN in .env to silence ' +
        'this warning.',
      );
    }
  }

  if (!token) {
    // No env token AND no cache — first-boot-pre-activation, OR clean wipe.
    printActivationInstructions({
      fingerprint,
      reason: 'No LICENSE_TOKEN in .env and no cached token in data/state/.',
    });
    process.exit(1);
  }

  // ─── 3. Validation ─────────────────────────────────────────────────
  let result;
  try {
    result = await validator.loadAndVerifyLicenseToken(token, fingerprint);
  } catch (e) {
    // LicenseError carries a structured `.code`; surface it to the operator.
    const code = e?.code || 'UNKNOWN';
    const message = e?.message || String(e);
    printValidationFailure({ code, message, fingerprint });
    process.exit(1);
  }

  // ─── 4. Mirror to cache, log, return ───────────────────────────────
  try {
    store.writeCachedToken(token, result.claims);
  } catch (e) {
    // Non-fatal — boot continues. Operator just loses the .env-wipe safety
    // net until the next refresh writes a fresh cache.
    console.warn(`[License] Could not write license cache: ${e.message}`);
  }

  const c = result.claims;
  const expISO = c.exp ? new Date(c.exp * 1000).toISOString() : 'never';
  let stalePart = '';
  if (result.stale) {
    // Stale message differs by billing mode so the operator knows whether
    // this is "no big deal, refresh client will fix" or "you owe us money".
    if (c.billing_mode === 'nfr') {
      stalePart = ' (STALE — JWT exp passed but NFR is perpetual; refresh urgent, no customer impact)';
    } else {
      const daysPast = Math.floor((Date.now() / 1000 - c.exp) / 86400);
      stalePart = ` (STALE — paid license ${daysPast}d past exp; degrade middleware will engage)`;
    }
  }
  console.log(
    `[License] OK — ${c.msp_name} / ${c.billing_mode} / ${c.max_seats} seats / ` +
    `license_id=${c.license_id} / source=${source} / exp=${expISO}${stalePart}`,
  );

  return {
    claims: c,
    stale: result.stale,
    source,
    fingerprint,
  };
}

module.exports = {
  validateLicenseAtBoot,
};
