/**
 * Unit tests for the pure logic behind Adopt-in-Place (tenant-sourced CA &
 * Intune cards): canonicalization + structural diff (src/lib/canonical-json.js),
 * baseline/drift math (src/lib/adopt-store.js), and the §5.5 read-error
 * classifier + managed-label hint (src/lib/adopt-graph.js).
 *
 * Run: node --test test/adopt-drift.test.js
 *
 * Per house rule these offline tests are NOT the ship gate — live Graph
 * writes (CA PATCH/delete, Intune assignment-strip/delete) + a real discovery
 * alert are — but they pin the as-found baseline + drift semantics so a refactor
 * can't silently change them.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cj = require('../src/lib/canonical-json');
const store = require('../src/lib/adopt-store');

// ─── canonical-json ───

test('canonicalHash is key-order independent', () => {
  const a = { b: 1, a: { y: 2, x: 3 }, arr: [1, 2] };
  const b = { a: { x: 3, y: 2 }, arr: [1, 2], b: 1 };
  assert.strictEqual(cj.canonicalHash(a), cj.canonicalHash(b));
});

test('canonicalHash is array-order SENSITIVE (order matters for config arrays)', () => {
  assert.notStrictEqual(cj.canonicalHash({ a: [1, 2] }), cj.canonicalHash({ a: [2, 1] }));
});

test('normalizeForBaseline strips volatile + @odata keys', () => {
  const norm = cj.normalizeForBaseline({
    id: 'x', '@odata.type': 't', displayName: 'P', state: 'enabled',
    lastModifiedDateTime: 'now', createdDateTime: 'then', version: 4,
  });
  assert.deepStrictEqual(norm, { displayName: 'P', state: 'enabled' });
});

test('normalizeForBaseline strips PROPERTY-scoped @odata annotations (phantom-drift regression)', () => {
  // Graph emits annotations for a property `foo` as a sibling key
  // `foo@odata.context` / `foo@odata.type`. These are NOT authored config. The
  // former startsWith('@') filter missed them, so a live policy carrying
  // `authenticationStrength@odata.context` read as drift against a template that
  // didn't ("grantControls.authenticationStrength@odata.context: empty→empty").
  const norm = cj.normalizeForBaseline({
    grantControls: {
      'authenticationStrength@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#...',
      builtInControls: ['mfa'],
    },
  });
  assert.deepStrictEqual(norm, { grantControls: { builtInControls: ['mfa'] } });

  // End-to-end: a live policy differing from the template ONLY by a
  // property-scoped annotation must produce ZERO structural diffs.
  const template = { grantControls: { builtInControls: ['mfa'] } };
  const live = {
    grantControls: {
      builtInControls: ['mfa'],
      'authenticationStrength@odata.context': 'https://graph.microsoft.com/...',
    },
  };
  const diffs = cj.structuralDiff(cj.normalizeForBaseline(template), cj.normalizeForBaseline(live));
  assert.deepStrictEqual(diffs, [], 'annotation-only difference must not be drift');

  // ...but a REAL change on the same object must still surface.
  const live2 = { grantControls: { builtInControls: ['mfa', 'compliantDevice'] } };
  const realDiffs = cj.structuralDiff(cj.normalizeForBaseline(template), cj.normalizeForBaseline(live2));
  assert.ok(realDiffs.length > 0, 'a real control change must still be detected');
});

test('structuralDiff reports leaf-level changes with paths', () => {
  const d = cj.structuralDiff(
    { state: 'enabled', grant: { controls: ['mfa'] } },
    { state: 'disabled', grant: { controls: ['mfa', 'compliantDevice'] } }
  );
  assert.ok(d.some(x => x.path === 'state' && x.change === 'modified' && x.from === 'enabled' && x.to === 'disabled'));
  assert.ok(d.some(x => x.path === 'grant.controls[1]' && x.change === 'added' && x.to === 'compliantDevice'));
});

test('deepEqual handles nested objects + arrays', () => {
  assert.ok(cj.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!cj.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }));
});

// ─── adopt-store baseline + drift ───

test('volatile-only change does NOT drift', () => {
  const cfg = { id: 'abc', displayName: 'Block legacy', state: 'enabled', conditions: { users: { includeUsers: ['All'] } } };
  const norm = store.normalizeObject(cfg, null);
  const row = { baseline_config: JSON.stringify(norm.config), baseline_assignments: null, baseline_hash: store.baselineHash(norm) };
  const result = store.computeDrift(row, {
    id: 'abc-2', displayName: 'Block legacy', state: 'enabled',
    conditions: { users: { includeUsers: ['All'] } }, lastModifiedDateTime: 'changed', version: 9,
  });
  assert.strictEqual(result.drifted, false);
});

test('meaningful change DOES drift, with the changed path surfaced', () => {
  const cfg = { id: 'abc', displayName: 'Block legacy', state: 'enabled' };
  const norm = store.normalizeObject(cfg, null);
  const row = { baseline_config: JSON.stringify(norm.config), baseline_assignments: null, baseline_hash: store.baselineHash(norm) };
  const result = store.computeDrift(row, { id: 'abc', displayName: 'Block legacy', state: 'disabled' });
  assert.strictEqual(result.drifted, true);
  assert.ok(result.configDiffs.some(d => d.path === 'state'));
});

test('Intune assignment baseline is id-order independent (target is the identity)', () => {
  const i1 = store.normalizeObject({ displayName: 'C' }, [
    { id: '1', target: { '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget' } },
    { id: '2', target: { groupId: 'g1' } },
  ]);
  const i2 = store.normalizeObject({ displayName: 'C' }, [
    { id: '99', target: { groupId: 'g1' } },
    { id: '77', target: { '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget' } },
  ]);
  assert.strictEqual(store.baselineHash(i1), store.baselineHash(i2));
});

test('removing an Intune assignment IS drift (deactivate / external change is detectable)', () => {
  const base = store.normalizeObject({ displayName: 'C' }, [{ id: '1', target: { groupId: 'g1' } }]);
  const row = { baseline_config: JSON.stringify(base.config), baseline_assignments: JSON.stringify(base.assignments), baseline_hash: store.baselineHash(base) };
  const result = store.computeDrift(row, { displayName: 'C' }, []); // assignments stripped
  assert.strictEqual(result.drifted, true);
});

// ─── adopt-graph classifier + managed hint ───

test('read-error classifier: 403 → unlicensed, everything else → transient (§5.5)', () => {
  const g = require('../src/lib/adopt-graph');
  assert.strictEqual(g.classifyReadError(Object.assign(new Error('not licensed'), { statusCode: 403 })).reason, 'unlicensed');
  assert.strictEqual(g.classifyReadError(Object.assign(new Error('token'), { statusCode: 401 })).reason, 'transient');
  assert.strictEqual(g.classifyReadError(Object.assign(new Error('throttle'), { statusCode: 429 })).reason, 'transient');
  assert.strictEqual(g.classifyReadError(Object.assign(new Error('net'), { statusCode: 0 })).reason, 'transient');
});

test('looksMicrosoftManaged is a name hint only (behaviour is shape-driven elsewhere)', () => {
  const g = require('../src/lib/adopt-graph');
  assert.strictEqual(g.looksMicrosoftManaged({ displayName: 'Microsoft-managed: MFA for admins' }), true);
  assert.strictEqual(g.looksMicrosoftManaged({ displayName: 'Block legacy auth' }), false);
});
