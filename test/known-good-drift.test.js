/**
 * Unit tests for the pure drift logic in src/lib/known-good-store.js
 * (Feature 8.9). Run: node --test test/known-good-drift.test.js
 *
 * These cover only the I/O-free helpers (signature derivation, hashing,
 * diff, superset verdict). Per house rule these offline tests are NOT the
 * ship gate — live Graph + Sonnet + drift verification is — but they pin the
 * drift math so a refactor can't silently change baseline semantics.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/lib/known-good-store');

const enterpriseApp = {
  kind: 'enterprise',
  appId: '00000003-0000-0000-c000-000000000000',
  displayName: 'Acme Backup',
  delegatedPermissions: [
    { resourceAppId: 'graph', scope: 'Mail.Read' },
    { resourceAppId: 'graph', scope: 'offline_access' },
  ],
  applicationPermissions: [
    { resourceAppId: 'graph', role: 'Files.Read.All' },
  ],
};

test('appSignature is order-independent and de-duplicated', () => {
  const a = store.appSignature(enterpriseApp);
  const shuffled = {
    ...enterpriseApp,
    delegatedPermissions: [
      { resourceAppId: 'graph', scope: 'offline_access' },
      { resourceAppId: 'graph', scope: 'Mail.Read' },
      { resourceAppId: 'graph', scope: 'Mail.Read' }, // dup
    ],
  };
  const b = store.appSignature(shuffled);
  assert.deepStrictEqual(a, b, 'reordering + dup must not change the signature');
  assert.strictEqual(a.length, 3);
});

test('hashSignature is stable for equal signatures and differs otherwise', () => {
  const h1 = store.hashSignature(store.appSignature(enterpriseApp));
  const h2 = store.hashSignature(store.appSignature({ ...enterpriseApp }));
  assert.strictEqual(h1, h2);

  const more = {
    ...enterpriseApp,
    delegatedPermissions: [...enterpriseApp.delegatedPermissions, { resourceAppId: 'graph', scope: 'Sites.Read.All' }],
  };
  assert.notStrictEqual(h1, store.hashSignature(store.appSignature(more)));
});

test('isDrifted: gaining a permission is drift (superset)', () => {
  const baseline = store.appSignature(enterpriseApp);
  const grown = store.appSignature({
    ...enterpriseApp,
    applicationPermissions: [
      { resourceAppId: 'graph', role: 'Files.Read.All' },
      { resourceAppId: 'graph', role: 'Directory.ReadWrite.All' }, // new
    ],
  });
  assert.strictEqual(store.isDrifted(baseline, grown), true);
  const { added, removed } = store.diffSignatures(baseline, grown);
  assert.deepStrictEqual(added, ['app|graph|Directory.ReadWrite.All']);
  assert.deepStrictEqual(removed, []);
});

test('isDrifted: removing a permission is NOT drift (subset is informational)', () => {
  const baseline = store.appSignature(enterpriseApp);
  const shrunk = store.appSignature({
    ...enterpriseApp,
    applicationPermissions: [], // dropped Files.Read.All
  });
  assert.strictEqual(store.isDrifted(baseline, shrunk), false);
  const { added, removed } = store.diffSignatures(baseline, shrunk);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, ['app|graph|Files.Read.All']);
});

test('isDrifted: identical set is not drift', () => {
  const baseline = store.appSignature(enterpriseApp);
  assert.strictEqual(store.isDrifted(baseline, [...baseline]), false);
});

test('app-registration signature folds credentials + redirect URIs', () => {
  const reg = {
    kind: 'registration',
    appId: 'reg-1',
    displayName: 'Internal HR App',
    requiredResourceAccess: [{ resourceAppId: 'graph', value: 'User.Read' }],
    credentials: [{ keyId: 'key-abc', endDateTime: '2027-01-01T00:00:00Z' }],
    redirectUris: ['https://hr.customer.com/oauth-cb'],
  };
  const sig = store.appSignature(reg);
  assert.ok(sig.includes('req|graph|User.Read'));
  assert.ok(sig.includes('cred|key-abc'));
  assert.ok(sig.includes('uri|https://hr.customer.com/oauth-cb'));

  // Adding a rogue redirect URI is drift (the token-theft setup case)
  const tampered = store.appSignature({
    ...reg,
    redirectUris: [...reg.redirectUris, 'https://hr-customer-login.example.com/oauth-cb'],
  });
  assert.strictEqual(store.isDrifted(sig, tampered), true);
});
