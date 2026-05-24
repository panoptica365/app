#!/usr/bin/env node
/**
 * Panoptica365 — Manual License Refresh Trigger
 *
 * Forces a single license refresh attempt without waiting for the weekly
 * cycle. Useful for:
 *
 *   - Stage B verification: confirm end-to-end refresh works on real
 *     deployments before relying on the 7-day automatic cycle.
 *
 *   - Operational triage: rotate a token immediately after activation
 *     changes (extending expiry, NFR ↔ paid conversion) so the install
 *     picks up the new claims without waiting up to a week.
 *
 *   - Failure recovery: if refresh has been failing for days (network
 *     issue at the install site, license server cert renewal hiccup,
 *     etc.), this lets the operator manually retry once the underlying
 *     issue is fixed instead of waiting for the next 24h retry.
 *
 * Usage (on Panoptica365-Prod):
 *
 *   cd /opt/panoptica
 *   node scripts/refresh-license-now.js
 *
 * Reads LICENSE_TOKEN + PANOPTICA_INSTALL_FINGERPRINT from .env (same as
 * the running app). On success, writes the new token to BOTH .env and
 * data/state/license-cache.json. On failure, leaves both untouched.
 *
 * IMPORTANT: This script does NOT coordinate with the running pm2 app
 * process. If the running app refreshes around the same time, you may
 * see one "token rotated" message in pm2 logs that surprises you. That's
 * fine — both sides converge on the latest token via the .env write.
 * The validator's in-memory cache in the pm2 process won't update until
 * the next refresh or pm2 restart (which is a Stage A safety property:
 * the boot path re-reads everything).
 *
 * Exit 0 on success, 1 on any failure.
 */

'use strict';

const path = require('path');

// Load .env from the project root, same as src/server.js does.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const validator = require('../src/lib/license/validator');
const store = require('../src/lib/license/store');
const refreshClient = require('../src/lib/license/refresh-client');

const SEP = '─'.repeat(74);

async function main() {
  console.log('');
  console.log(SEP);
  console.log('  Panoptica365 — Manual License Refresh');
  console.log(SEP);
  console.log('');

  // Step 1 — load + validate the current token. This populates the validator's
  // in-memory claims cache, which refreshClient.refreshNow() reads to pick up
  // the fingerprint. Without this step, refreshNow would fall back to
  // process.env.PANOPTICA_INSTALL_FINGERPRINT (still works), but doing it
  // properly mirrors what the boot path does.
  const token = process.env.LICENSE_TOKEN;
  const fingerprint = process.env.PANOPTICA_INSTALL_FINGERPRINT;

  if (!token) {
    console.error('  ERROR: LICENSE_TOKEN is not set in .env. Activate the install first.');
    console.log('');
    process.exit(1);
  }
  if (!fingerprint) {
    console.error('  ERROR: PANOPTICA_INSTALL_FINGERPRINT is not set in .env.');
    console.log('');
    process.exit(1);
  }

  console.log('  Validating current token before refresh…');
  let beforeClaims;
  try {
    const result = await validator.loadAndVerifyLicenseToken(token, fingerprint);
    beforeClaims = result.claims;
    console.log(`    OK — ${beforeClaims.msp_name} / ${beforeClaims.billing_mode} / license_id=${beforeClaims.license_id}`);
    console.log(`    Current JWT iat=${new Date(beforeClaims.iat * 1000).toISOString()}`);
    console.log(`    Current JWT exp=${new Date(beforeClaims.exp * 1000).toISOString()}`);
    if (result.stale) {
      console.warn('    WARN — current token is STALE (NFR-recovered at boot). Refresh is urgent.');
    }
  } catch (e) {
    console.error(`    Validation FAILED before refresh: ${e.code || 'UNKNOWN'}: ${e.message}`);
    console.error(`    Cannot refresh — fix the underlying token problem first.`);
    process.exit(1);
  }

  console.log('');
  console.log('  Calling /api/v1/refresh on the license server…');
  const result = await refreshClient.refreshNow();
  console.log('');

  if (result?.ok) {
    console.log('  ✓ Refresh SUCCESS');
    console.log(`    New JWT exp:    ${result.exp?.toISOString() || '(unknown)'}`);
    console.log(`    Seats reported: ${result.seats !== null && result.seats !== undefined ? result.seats : '(none — counting was unavailable)'}`);
    console.log(`    Persisted to:   .env  +  data/state/license-cache.json`);
    console.log('');
    console.log('  Verify with:');
    console.log('    grep ^LICENSE_TOKEN= .env | cut -c1-50');
    console.log('    cat data/state/license-cache.json | python3 -m json.tool');
    console.log('');
    // db connection from the validator import may keep the process alive.
    // Force-exit so the script returns control to the shell cleanly.
    process.exit(0);
  } else {
    console.error('  ✗ Refresh FAILED');
    console.error(`    Error: ${result?.error || '(no error message)'}`);
    console.error(`    At:    ${result?.at?.toISOString() || '(unknown)'}`);
    console.log('');
    console.log('  Existing .env and cache files are unchanged. Diagnostic checklist:');
    console.log('    1. curl https://license.panoptica365.com/health   (server up?)');
    console.log('    2. Check if license_id=1 has been revoked on the license server');
    console.log('    3. Check NSG / firewall rules outbound from this host to Azure-VM');
    console.log('');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('');
  console.error('FATAL:', e.stack || e.message || e);
  console.error('');
  process.exit(1);
});
