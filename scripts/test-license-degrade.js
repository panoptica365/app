#!/usr/bin/env node
/**
 * Panoptica365 — Degrade-middleware logic smoke test
 *
 * Pure-function tests for src/lib/license/degrade-middleware.js. No
 * server, no DB, no network — just exercises computePhase / daysPastExpiry
 * / isSoftBlocked / isAlwaysAllowed against fixture claims and req objects.
 *
 * Usage (on Panoptica365-Prod):
 *   cd /opt/panoptica
 *   node scripts/test-license-degrade.js
 *
 * Exits 0 on all-pass, 1 on any failure.
 */

'use strict';

const degrade = require('../src/lib/license/degrade-middleware');

const SEP = '─'.repeat(74);
let passed = 0;
let failed = 0;

function pass(label) { passed++; console.log(`  ✓  ${label}`); }
function fail(label, detail) {
  failed++; console.log(`  ✗  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function expect(label, actual, expected) {
  if (actual === expected) pass(`${label}  (=${actual})`);
  else fail(label, `expected ${expected}, got ${actual}`);
}

// Helper to build a claims object with exp = now + offsetDays * 86400.
function claimsWithExpOffset(billingMode, offsetDays) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    billing_mode: billingMode,
    iat: nowSec - 86400,
    exp: nowSec + offsetDays * 86400,
    msp_name: 'Test MSP',
    tier: 'standard',
    max_seats: 100,
    license_id: 1,
    fingerprint: 'test-fp',
  };
}

console.log('');
console.log(SEP);
console.log('  Panoptica365 — Degrade Middleware Logic Tests');
console.log(SEP);
console.log('');

// ─── computePhase ──────────────────────────────────────────────────
console.log('  computePhase()');
expect('  NFR + future exp                        →', degrade.computePhase(claimsWithExpOffset('nfr', 30)), 'ok');
expect('  NFR + past exp (would-be soft if paid)  →', degrade.computePhase(claimsWithExpOffset('nfr', -17)), 'ok');
expect('  NFR + ancient exp                       →', degrade.computePhase(claimsWithExpOffset('nfr', -365)), 'ok');
expect('  Paid + future exp                       →', degrade.computePhase(claimsWithExpOffset('paid', 7)), 'ok');
expect('  Paid + exactly at exp                   →', degrade.computePhase(claimsWithExpOffset('paid', 0)), 'ok');
expect('  Paid + 1 day past exp (warning lo)      →', degrade.computePhase(claimsWithExpOffset('paid', -1)), 'warning');
expect('  Paid + 14 days past (warning hi)        →', degrade.computePhase(claimsWithExpOffset('paid', -14)), 'warning');
expect('  Paid + 15 days past (soft lo)           →', degrade.computePhase(claimsWithExpOffset('paid', -15)), 'soft');
expect('  Paid + 21 days past (soft hi)           →', degrade.computePhase(claimsWithExpOffset('paid', -21)), 'soft');
expect('  Paid + 22 days past (hard lo)           →', degrade.computePhase(claimsWithExpOffset('paid', -22)), 'hard');
expect('  Paid + 365 days past (hard, ancient)    →', degrade.computePhase(claimsWithExpOffset('paid', -365)), 'hard');
expect('  Unknown billing_mode (fail-open)        →', degrade.computePhase({ billing_mode: 'enterprise', exp: 0 }), 'ok');
expect('  Empty claims (fail-open)                →', degrade.computePhase(null), 'ok');
expect('  Missing exp (fail-open)                 →', degrade.computePhase({ billing_mode: 'paid' }), 'ok');
console.log('');

// ─── daysPastExpiry ────────────────────────────────────────────────
console.log('  daysPastExpiry()');
expect('  NFR always 0                            →', degrade.daysPastExpiry(claimsWithExpOffset('nfr', -50)), 0);
expect('  Paid + future exp = 0                   →', degrade.daysPastExpiry(claimsWithExpOffset('paid', 7)), 0);
expect('  Paid + 1 day past = 1                   →', degrade.daysPastExpiry(claimsWithExpOffset('paid', -1)), 1);
expect('  Paid + 17 days past = 17                →', degrade.daysPastExpiry(claimsWithExpOffset('paid', -17)), 17);
console.log('');

// ─── isAlwaysAllowed ───────────────────────────────────────────────
console.log('  isAlwaysAllowed()');
expect('  /auth/login              →', degrade.isAlwaysAllowed({ path: '/auth/login', method: 'GET' }), true);
expect('  /auth/callback           →', degrade.isAlwaysAllowed({ path: '/auth/callback', method: 'POST' }), true);
expect('  /healthz                 →', degrade.isAlwaysAllowed({ path: '/healthz', method: 'GET' }), true);
expect('  /api/license/status      →', degrade.isAlwaysAllowed({ path: '/api/license/status', method: 'GET' }), true);
expect('  /api/meta/whats-new      →', degrade.isAlwaysAllowed({ path: '/api/meta/whats-new', method: 'GET' }), true);
expect('  /api/i18n/en             →', degrade.isAlwaysAllowed({ path: '/api/i18n/en', method: 'GET' }), true);
expect('  /css/style.css           →', degrade.isAlwaysAllowed({ path: '/css/style.css', method: 'GET' }), true);
expect('  /api/tenants (NOT)       →', degrade.isAlwaysAllowed({ path: '/api/tenants', method: 'POST' }), false);
expect('  /api/alerts (NOT)        →', degrade.isAlwaysAllowed({ path: '/api/alerts', method: 'GET' }), false);
console.log('');

// ─── isSoftBlocked ─────────────────────────────────────────────────
console.log('  isSoftBlocked() (only POST/PUT on specific creates)');
expect('  POST /api/tenants                       →', degrade.isSoftBlocked({ path: '/api/tenants', method: 'POST' }), true);
expect('  POST /api/intune/templates              →', degrade.isSoftBlocked({ path: '/api/intune/templates', method: 'POST' }), true);
expect('  POST /api/ca/templates                  →', degrade.isSoftBlocked({ path: '/api/ca/templates', method: 'POST' }), true);
expect('  POST /api/intune/templates/bulk         →', degrade.isSoftBlocked({ path: '/api/intune/templates/bulk', method: 'POST' }), true);
expect('  PUT /api/tenants/1 (edit OK in soft)    →', degrade.isSoftBlocked({ path: '/api/tenants/1', method: 'PUT' }), false);
expect('  PATCH /api/ca/templates/1 (edit OK)     →', degrade.isSoftBlocked({ path: '/api/ca/templates/1', method: 'PATCH' }), false);
expect('  GET /api/tenants (read OK)              →', degrade.isSoftBlocked({ path: '/api/tenants', method: 'GET' }), false);
expect('  POST /api/alerts/clear (not blocked)    →', degrade.isSoftBlocked({ path: '/api/alerts/clear', method: 'POST' }), false);
console.log('');

// ─── Summary ───────────────────────────────────────────────────────
console.log(SEP);
console.log(`  Result: ${passed} passed, ${failed} failed`);
console.log(SEP);
console.log('');

process.exit(failed === 0 ? 0 : 1);
