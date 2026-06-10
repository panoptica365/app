/**
 * Unit tests for ENT-01 (SSPR) per-method baseline logic in
 * src/lib/security-settings/registry.js. Run:
 *   node --test test/sspr-per-method.test.js
 *
 * Jun 10, 2026 — regression coverage for the per-method rework. The old model
 * bundled Authenticator+SMS+Email into an atomic "standard" preset, so a
 * partial trio (e.g. dropping SMS — the Microsoft-recommended hardening) could
 * NOT be represented, captured (Accept dead-ended with "does not correspond to
 * any documented option"), or re-applied. The fix models the baseline as the
 * explicit set of enabled methods.
 *
 * Per house rule these offline tests are NOT the ship gate (live Graph +
 * real-tenant drift is), but they pin the comparator so a refactor can't
 * silently change baseline semantics or reintroduce the SMS dead-end.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const registry = require('../src/lib/security-settings/registry');

const W = registry.byId('ENT-01').writer;

// helper: build an all_methods map from a list of enabled-for-all-users ids
function methodsMap(enabledIds, extra = {}) {
  const ALL = [
    'MicrosoftAuthenticator', 'Sms', 'Email', 'Fido2', 'TemporaryAccessPass',
    'Voice', 'SoftwareOath', 'HardwareOath', 'X509Certificate', 'QRCodePin',
    'VerifiableCredentials', 'FederatedIdentityCredential',
  ];
  const all = {};
  for (const id of ALL) {
    const on = enabledIds.includes(id);
    all[id] = { present: true, state: on ? 'enabled' : 'disabled', all_users: on };
  }
  return { all_methods: { ...all, ...extra } };
}

// The exact current_value Trilogiam reported after the operator dropped SMS.
const NO_SMS_CURRENT = methodsMap(
  ['MicrosoftAuthenticator', 'Email', 'Fido2', 'SoftwareOath', 'TemporaryAccessPass'],
  // FederatedIdentityCredential is read-only noise; reader surfaces it disabled.
  { FederatedIdentityCredential: { present: true, state: 'disabled', all_users: true } }
);

const LEGACY_STANDARD = { option: 'standard', additional: ['Fido2', 'SoftwareOath', 'TemporaryAccessPass'] };

test('legacy {option:standard,additional} flags a dropped-SMS tenant as drift', () => {
  // This is the bug report: the live state no longer matches the stored baseline.
  assert.strictEqual(W.matches(LEGACY_STANDARD, NO_SMS_CURRENT), false);
});

test('captureCurrentBaseline adopts the live method set (SMS + read-only methods excluded)', () => {
  const cap = W.captureCurrentBaseline(NO_SMS_CURRENT);
  assert.deepStrictEqual(
    [...cap.methods].sort(),
    ['Email', 'Fido2', 'MicrosoftAuthenticator', 'SoftwareOath', 'TemporaryAccessPass']
  );
  assert.ok(!cap.methods.includes('Sms'), 'SMS must not be captured');
  assert.ok(!cap.methods.includes('FederatedIdentityCredential'), 'read-only method must not be captured');
});

test('captured baseline matches its own current state — no re-drift loop after Accept', () => {
  const cap = W.captureCurrentBaseline(NO_SMS_CURRENT);
  assert.strictEqual(W.matches(cap, NO_SMS_CURRENT), true);
});

test('drift still fires when a captured method is re-enabled externally', () => {
  const cap = W.captureCurrentBaseline(NO_SMS_CURRENT);
  const smsBack = methodsMap(
    ['MicrosoftAuthenticator', 'Email', 'Fido2', 'SoftwareOath', 'TemporaryAccessPass', 'Sms']
  );
  assert.strictEqual(W.matches(cap, smsBack), false, 'SMS coming back must read as drift');
});

test('Apply syncs the COMPLETE set: every managed method gets an explicit PATCH', () => {
  const cap = W.captureCurrentBaseline(NO_SMS_CURRENT);
  const calls = W.prepareGraphCalls(cap);
  assert.strictEqual(calls.length, 11, 'all 11 managed methods PATCHed (FederatedIdentityCredential excluded)');
  const stateOf = (id) => calls.find(c => c.path.endsWith('/' + id)).body.state;
  assert.strictEqual(stateOf('Sms'), 'disabled');
  assert.strictEqual(stateOf('Email'), 'enabled');
  assert.strictEqual(stateOf('MicrosoftAuthenticator'), 'enabled');
  assert.strictEqual(stateOf('Voice'), 'disabled');
  // enabled methods target all_users; disabled methods clear targets
  const sms = calls.find(c => c.path.endsWith('/Sms'));
  assert.deepStrictEqual(sms.body.includeTargets, []);
  const email = calls.find(c => c.path.endsWith('/Email'));
  assert.strictEqual(email.body.includeTargets[0].id, 'all_users');
});

test('new {methods} canonical shape round-trips through matches', () => {
  const baseline = { methods: ['MicrosoftAuthenticator', 'Email'] };
  assert.strictEqual(W.matches(baseline, methodsMap(['MicrosoftAuthenticator', 'Email'])), true);
  // an extra enabled method not in the set = drift (we own the full surface)
  assert.strictEqual(W.matches(baseline, methodsMap(['MicrosoftAuthenticator', 'Email', 'Fido2'])), false);
  // a missing method from the set = drift
  assert.strictEqual(W.matches(baseline, methodsMap(['MicrosoftAuthenticator'])), false);
});

test('BACKWARD COMPAT: legacy baselines keep their original meaning (no silent migration)', () => {
  const fullTrioPlus = methodsMap(['MicrosoftAuthenticator', 'Sms', 'Email', 'Fido2', 'SoftwareOath', 'TemporaryAccessPass']);
  // {option:standard,additional} on a correctly-configured tenant must NOT false-drift
  assert.strictEqual(W.matches(LEGACY_STANDARD, fullTrioPlus), true);
  // legacy primitive 'standard' = trio-only check (advanced ignored for pre-v2 rows)
  assert.strictEqual(W.matches('standard', methodsMap(['MicrosoftAuthenticator', 'Sms', 'Email', 'Fido2'])), true);
  assert.strictEqual(W.matches('disabled', methodsMap(['MicrosoftAuthenticator'])), false);
  assert.strictEqual(W.matches('disabled', methodsMap([])), true);
});

test('matches rejects a non-object current value', () => {
  assert.strictEqual(W.matches({ methods: [] }, null), false);
  assert.strictEqual(W.matches({ methods: [] }, undefined), false);
});

test('secondary_section is per-method, always-open, and lists the core trio first', () => {
  const ss = W.secondary_section;
  assert.strictEqual(ss.per_method, true);
  assert.strictEqual(ss.always_open, true);
  const ids = ss.options.map(o => o.id);
  assert.deepStrictEqual(ids.slice(0, 3), ['MicrosoftAuthenticator', 'Sms', 'Email']);
  assert.ok(!ids.includes('FederatedIdentityCredential'), 'read-only method not offered as a toggle');
  // pre-population returns the full enabled set (trio included), not just advanced
  assert.deepStrictEqual(
    [...ss.extractCurrentAdditionals(NO_SMS_CURRENT)].sort(),
    ['Email', 'Fido2', 'MicrosoftAuthenticator', 'SoftwareOath', 'TemporaryAccessPass']
  );
});
