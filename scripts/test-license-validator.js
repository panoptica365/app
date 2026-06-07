#!/usr/bin/env node
/**
 * Panoptica365 — License validator smoke test
 *
 * Standalone test runner for src/lib/license/{validator,store}.js.
 * Designed to be run on Panoptica365-Prod (or any install) BEFORE flipping
 * the live boot path, so we know the validator behaves correctly without
 * a risky pm2 restart.
 *
 * Usage:
 *
 *   On Panoptica365-Prod:
 *     cd /opt/panoptica
 *     npm install                    # ensures `jose` is present
 *     node scripts/test-license-validator.js
 *
 * Reads LICENSE_TOKEN and PANOPTICA_INSTALL_FINGERPRINT from .env. Exits 0
 * on all-pass, 1 on any failure. Does NOT modify .env, does NOT write to
 * the cache sidecar, does NOT start the app.
 *
 * Exercises:
 *   1. Valid token + matching fingerprint  → expect OK
 *   2. Valid token + wrong fingerprint     → expect FINGERPRINT_MISMATCH
 *   3. Malformed token                     → expect TOKEN_MALFORMED
 *   4. Tampered signature                  → expect SIGNATURE_INVALID
 *   5. Empty token                         → expect TOKEN_MISSING
 *   6. getOrCreateFingerprint stability    → second call returns same UUID
 */

'use strict';

const path = require('path');

// Load .env from the project root, same as src/server.js does.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const validator = require('../src/lib/license/validator');
const store = require('../src/lib/license/store');

const SEP = '─'.repeat(74);

let passed = 0;
let failed = 0;

function pass(label) {
  passed++;
  console.log(`  ✓  ${label}`);
}
function fail(label, detail) {
  failed++;
  console.log(`  ✗  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

async function expectSuccess(label, tokenFn, fingerprint) {
  // Reset module-scope caches so each test is clean.
  validator._resetForTests();
  try {
    const token = typeof tokenFn === 'function' ? tokenFn() : tokenFn;
    const { claims, stale } = await validator.loadAndVerifyLicenseToken(token, fingerprint);
    if (!claims || typeof claims !== 'object') {
      fail(label, 'returned empty claims');
      return;
    }
    pass(`${label}  (msp=${claims.msp_name}, billing=${claims.billing_mode}, stale=${stale})`);
  } catch (e) {
    fail(label, `${e.code || 'NO_CODE'}: ${e.message}`);
  }
}

async function expectFailure(label, tokenFn, fingerprint, expectedCode) {
  validator._resetForTests();
  try {
    const token = typeof tokenFn === 'function' ? tokenFn() : tokenFn;
    await validator.loadAndVerifyLicenseToken(token, fingerprint);
    fail(label, `expected ${expectedCode}, got SUCCESS`);
  } catch (e) {
    if (e.code === expectedCode) {
      pass(`${label}  (got ${expectedCode} as expected)`);
    } else {
      fail(label, `expected ${expectedCode}, got ${e.code || 'NO_CODE'}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('');
  console.log(SEP);
  console.log('  Panoptica365 — License Validator Smoke Test');
  console.log(SEP);
  console.log('');

  const token = process.env.LICENSE_TOKEN;
  const fingerprint = process.env.PANOPTICA_INSTALL_FINGERPRINT;

  if (!token) {
    console.log('  LICENSE_TOKEN is not set in .env.');
    console.log('');
    console.log('  Either:');
    console.log('    - Drop the JWT from /api/v1/activate into .env as LICENSE_TOKEN');
    console.log('    - Or run with explicit env:');
    console.log('        LICENSE_TOKEN="..." PANOPTICA_INSTALL_FINGERPRINT="..." \\');
    console.log('          node scripts/test-license-validator.js');
    console.log('');
    process.exit(2);
  }
  if (!fingerprint) {
    console.log('  PANOPTICA_INSTALL_FINGERPRINT is not set in .env.');
    console.log('  Drop the UUID generated during activation into .env first.');
    console.log('');
    process.exit(2);
  }

  console.log(`  Token (first 24 chars): ${token.slice(0, 24)}...`);
  console.log(`  Fingerprint:            ${fingerprint}`);
  console.log('');
  console.log(SEP);
  console.log('  Test cases');
  console.log(SEP);

  // ─── 1. Valid token + matching fingerprint ─────────────────────────
  await expectSuccess(
    '1. Valid token + matching fingerprint',
    token,
    fingerprint,
  );

  // ─── 2. Valid token + WRONG fingerprint ────────────────────────────
  await expectFailure(
    '2. Valid token + wrong fingerprint',
    token,
    'wrong-fingerprint-value-that-doesnt-match',
    'FINGERPRINT_MISMATCH',
  );

  // ─── 3. Malformed token ────────────────────────────────────────────
  await expectFailure(
    '3. Malformed token',
    'not-a-jwt-at-all-just-a-random-string',
    fingerprint,
    'TOKEN_MALFORMED',
  );

  // ─── 4. Tampered signature ─────────────────────────────────────────
  // Flip the last character of the JWT (which is part of the signature segment).
  // Cipher chosen so the result is still valid base64url but the signature
  // bytes are different.
  const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
  await expectFailure(
    '4. Tampered signature',
    tampered,
    fingerprint,
    'SIGNATURE_INVALID',
  );

  // ─── 5. Empty token ────────────────────────────────────────────────
  await expectFailure(
    '5. Empty token',
    '',
    fingerprint,
    'TOKEN_MISSING',
  );

  // ─── 6. getOrCreateFingerprint stability ───────────────────────────
  // Calling twice should return the same value — the fingerprint is meant
  // to be generated ONCE and persisted. We rely on process.env being
  // populated (either by dotenv from .env, or by the first call).
  try {
    const fp1 = store.getOrCreateFingerprint();
    const fp2 = store.getOrCreateFingerprint();
    if (fp1 === fp2 && fp1 === fingerprint) {
      pass(`6. getOrCreateFingerprint stable across calls  (returned ${fp1})`);
    } else {
      fail(
        '6. getOrCreateFingerprint stable across calls',
        `got fp1=${fp1}, fp2=${fp2}, expected env=${fingerprint}`,
      );
    }
  } catch (e) {
    fail('6. getOrCreateFingerprint stable across calls', e.message);
  }

  console.log('');
  console.log(SEP);
  console.log(`  Result: ${passed} passed, ${failed} failed`);
  console.log(SEP);
  console.log('');

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
