/**
 * Unit tests for EXO-06 (Preset Security Policy) "MDO half not initialized"
 * detection + the matches() semantics behind it. Run:
 *   node --test test/exo06-mdo-half.test.js
 *
 * Jun 22, 2026 — regression coverage for the post-licence-upgrade case. A tenant
 * had the Standard preset turned on while EOP-only (e.g. Business Standard); the
 * customer later moved up to Business Premium, which makes Defender for Office
 * 365 (the ATP half — Safe Links / Safe Attachments / impersonation) available.
 * Microsoft does NOT back-fill the ATP preset rules on a licence change and has
 * no API to create them, so:
 *   - mdo_available flips false→true, and matches() now demands the ATP rule,
 *     which doesn't exist → the preset reads as drift.
 *   - the drifted state maps to NO documented option → Accept dead-ends with
 *     "does not correspond to any documented option".
 *   - Apply can only ENABLE an existing ATP rule, so it silently no-ops.
 * The fix detects this exact shape (isMdoHalfUninitialized) and routes the
 * operator to the one-time Defender portal wizard re-run, after which Panoptica
 * Match/Accept/Apply work normally.
 *
 * Per house rule these offline tests are NOT the ship gate (live Graph +
 * real-tenant drift is), but they pin the detector + comparator so a refactor
 * can't silently reintroduce the dead-end or perpetually drift EOP-only tenants.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const registry = require('../src/lib/security-settings/registry');
const { isMdoHalfUninitialized } = require('../src/lib/security-settings/pwsh-readers');

const W = registry.byId('EXO-06').writer;

// The baseline an operator captured while the tenant was EOP-only: tier
// 'standard' with empty impersonation lists (no MDO, so no lists to populate).
const EOP_ONLY_BASELINE = {
  tier: 'standard',
  standard_lists: { targeted_users: [], targeted_domains: [], excluded_domains: [] },
};

// Build an EXO-06 current_value with sane defaults for every field matches() reads.
function presetState({
  eopStd = false, atpStd = false, eopStrict = false, atpStrict = false,
  mdo = true, lists = {},
} = {}) {
  return {
    eop_standard_enabled: eopStd,
    atp_standard_enabled: atpStd,
    eop_strict_enabled:   eopStrict,
    atp_strict_enabled:   atpStrict,
    mdo_available:        mdo,
    standard_targeted_users:   lists.std_users    || [],
    standard_targeted_domains: lists.std_domains  || [],
    standard_excluded_domains: lists.std_excluded || [],
    strict_targeted_users:     lists.strict_users    || [],
    strict_targeted_domains:   lists.strict_domains  || [],
    strict_excluded_domains:   lists.strict_excluded || [],
  };
}

// Mirror of api-security.js deriveChosenFromCurrent — which documented option,
// if any, does the live state map to? null/undefined ⇒ Accept dead-ends.
function deriveChosen(current) {
  return W.options.find(o => W.matches(o.value, current))?.value ?? null;
}

// ─── isMdoHalfUninitialized truth table ─────────────────────────────
test('detector: true only when MDO available, EOP rules exist, ATP rules absent', () => {
  // The upgrade case: EOP standard rule live, Defender now available, no ATP rule.
  assert.strictEqual(isMdoHalfUninitialized({ mdoAvailable: true, eopRuleCount: 1, atpRuleCount: 0 }), true);
  // Standard + Strict EOP rules, still no ATP half.
  assert.strictEqual(isMdoHalfUninitialized({ mdoAvailable: true, eopRuleCount: 2, atpRuleCount: 0 }), true);
});

test('detector: false for EOP-only tenant (not upgraded yet)', () => {
  assert.strictEqual(isMdoHalfUninitialized({ mdoAvailable: false, eopRuleCount: 1, atpRuleCount: 0 }), false);
});

test('detector: false when fully provisioned (ATP rule present)', () => {
  assert.strictEqual(isMdoHalfUninitialized({ mdoAvailable: true, eopRuleCount: 1, atpRuleCount: 1 }), false);
});

test('detector: false for never_initialized (no rules at all)', () => {
  // This is the existing never_initialized state — handled by its own flag, not ours.
  assert.strictEqual(isMdoHalfUninitialized({ mdoAvailable: true, eopRuleCount: 0, atpRuleCount: 0 }), false);
});

// ─── matches()/Accept semantics that make the feature necessary ──────
test('pre-upgrade: EOP-only standard baseline does NOT drift (non-regression)', () => {
  const eopOnly = presetState({ eopStd: true, mdo: false });
  assert.strictEqual(W.matches(EOP_ONLY_BASELINE, eopOnly), true);
});

test('post-upgrade with ATP half missing: drift fires AND Accept dead-ends', () => {
  const upgraded = presetState({ eopStd: true, atpStd: false, mdo: true });
  // Drift: baseline no longer matches once MDO is available but ATP is off.
  assert.strictEqual(W.matches(EOP_ONLY_BASELINE, upgraded), false);
  // Accept dead-end: the live state maps to no documented option — exactly the
  // condition the new guided path replaces.
  assert.strictEqual(deriveChosen(upgraded), null);
});

test('after wizard re-run: ATP half live ⇒ state maps to "standard" (Match/Accept work again)', () => {
  // Operator re-ran the Defender portal wizard: ATP standard rule now enabled,
  // and Microsoft populated the Standard preset's impersonation domain list.
  const fixed = presetState({ eopStd: true, atpStd: true, mdo: true, lists: { std_domains: ['contoso.com'] } });
  assert.strictEqual(deriveChosen(fixed), 'standard');
});

test('after wizard re-run with Strict too ⇒ maps to "standard_strict"', () => {
  const both = presetState({ eopStd: true, atpStd: true, eopStrict: true, atpStrict: true, mdo: true });
  assert.strictEqual(deriveChosen(both), 'standard_strict');
});
