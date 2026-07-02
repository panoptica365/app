/**
 * Hermetic tests for the Graph retry/paging invariants (src/graph.js) and the
 * partial-enumeration guard in adopt reads (src/lib/adopt-graph.js).
 *
 * Pins the 2026-07-02 incident class: a throttled (429) or malformed Graph
 * read must SURFACE AS AN ERROR — never resolve to undefined / an empty
 * collection — because callers diff enumerations against full baselines and
 * an empty result reads as "everything was deleted" (mass false alerts).
 *
 * Run: node --test test/graph-retry.test.js
 *
 * Stubs config/auth/db/http-timeout via require.cache BEFORE loading
 * src/graph.js, so no DB or network is touched.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ─── module stubs (must be installed before src/graph.js loads) ───

const SRC = path.join(__dirname, '..', 'src');

function stubModule(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule(path.join(SRC, '..', 'config', 'default.js'), {
  graph: {
    retryAttempts: 3,
    retryDelayMs: 1,
    baseUrl: 'https://graph.test/v1.0',
    betaUrl: 'https://graph.test/beta',
  },
});
stubModule(path.join(SRC, 'auth.js'), {
  acquireTokenForTenant: async () => 'test-token',
});
stubModule(path.join(SRC, 'db', 'database.js'), {
  query: async () => [[]],
});

// Mutable fetch implementation the tests swap per-case.
let fetchImpl = async () => { throw new Error('fetchImpl not set by test'); };
stubModule(path.join(SRC, 'lib', 'http-timeout.js'), {
  fetchWithTimeout: (...args) => fetchImpl(...args),
});

const graph = require('../src/graph');

/** Build a minimal fetch Response double. */
function res({ status = 200, body = '', contentType = 'application/json', headers = {} } = {}) {
  return {
    status,
    headers: {
      get: (k) => {
        if (k in headers) return headers[k];
        if (k.toLowerCase() === 'content-type') return contentType;
        return null;
      },
    },
    text: async () => body,
  };
}

const THROTTLED = () => res({ status: 429, headers: { 'Retry-After': '0' } });

// ─── callGraph: 429 exhaustion must THROW, never resolve undefined ───

test('callGraph throws GraphError(429) when every retry attempt is throttled', async () => {
  let calls = 0;
  fetchImpl = async () => { calls += 1; return THROTTLED(); };
  await assert.rejects(
    graph.callGraph('tid', '/deviceManagement/configurationPolicies'),
    (e) => e instanceof graph.GraphError && e.statusCode === 429
  );
  assert.strictEqual(calls, 3); // used every configured attempt before giving up
});

test('callGraph still recovers when throttling clears before the last attempt', async () => {
  let calls = 0;
  fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return THROTTLED();
    return res({ body: JSON.stringify({ value: [{ id: 'a' }] }) });
  };
  const data = await graph.callGraph('tid', '/x');
  assert.deepStrictEqual(data.value, [{ id: 'a' }]);
});

// ─── callGraphPaged: a page without value[] is an error, not an empty list ───

test('callGraphPaged throws on a JSON page with no value[] array', async () => {
  fetchImpl = async () => res({ body: '{}' });
  await assert.rejects(
    graph.callGraphPaged('tid', '/x'),
    (e) => e instanceof graph.GraphError && /value\[\]/.test(e.message)
  );
});

test('callGraphPaged throws on a non-JSON (raw fallback) page', async () => {
  fetchImpl = async () => res({ body: '<html>gateway error</html>' });
  await assert.rejects(graph.callGraphPaged('tid', '/x'), (e) => e instanceof graph.GraphError);
});

test('callGraphPaged concatenates pages and accepts a genuinely empty collection', async () => {
  let calls = 0;
  fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? res({ body: JSON.stringify({ value: [1, 2], '@odata.nextLink': 'https://graph.test/v1.0/x?p=2' }) })
      : res({ body: JSON.stringify({ value: [3] }) });
  };
  assert.deepStrictEqual(await graph.callGraphPaged('tid', '/x'), [1, 2, 3]);

  fetchImpl = async () => res({ body: JSON.stringify({ value: [] }) });
  assert.deepStrictEqual(await graph.callGraphPaged('tid', '/x'), []);
});

// ─── readIntuneObjects: partial reads must never look like deletions ───

const adoptGraph = require('../src/lib/adopt-graph');

/** URL-driven fetch: per-endpoint behavior for the five Intune type lists. */
function intuneFetch({ deny403 = [], throttle = [] } = {}) {
  return async (url) => {
    if (deny403.some((frag) => url.includes(frag))) return res({ status: 403, body: 'Forbidden' });
    if (throttle.some((frag) => url.includes(frag))) return THROTTLED();
    return res({ body: JSON.stringify({ value: [] }) });
  };
}

test('readIntuneObjects reports enumeratedTypes and omits a 403-gated type from it', async () => {
  fetchImpl = intuneFetch({ deny403: ['/deviceManagement/configurationPolicies'] });
  const read = await adoptGraph.readIntuneObjects('azure-tid');
  assert.strictEqual(read.ok, true);
  assert.ok(!read.enumeratedTypes.includes('configurationPolicies'));
  assert.deepStrictEqual(
    read.enumeratedTypes.sort(),
    ['deviceCompliancePolicies', 'deviceConfigurations', 'groupPolicyConfigurations', 'intents']
  );
});

test('readIntuneObjects classifies exhausted throttling as transient (whole surface aborts)', async () => {
  fetchImpl = intuneFetch({ throttle: ['/deviceManagement/configurationPolicies'] });
  const read = await adoptGraph.readIntuneObjects('azure-tid');
  assert.strictEqual(read.ok, false);
  assert.strictEqual(read.reason, 'transient');
});

test('readIntuneObjects classifies all-types-403 as unlicensed', async () => {
  fetchImpl = intuneFetch({ deny403: ['/deviceManagement/'] });
  const read = await adoptGraph.readIntuneObjects('azure-tid');
  assert.strictEqual(read.ok, false);
  assert.strictEqual(read.reason, 'unlicensed');
});
