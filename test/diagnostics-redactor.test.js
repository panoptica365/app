/**
 * Unit tests for src/diagnostics-redactor.js (Part 3, 2026-06-03 build §3.5).
 * Run: node --test test/diagnostics-redactor.test.js
 *
 * Per house rule these offline tests are NOT the ship gate — one real
 * end-to-end capture on the dev box, grepped for the actual secret values, is
 * (build spec §4.3). But they pin each redaction pattern so a refactor can't
 * silently stop scrubbing.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const redactor = require('../src/diagnostics-redactor');

// A fixed fake env so value-redaction is deterministic and offline.
const ENV = {
  DB_PASS: 'sup3r-secret-db-pw',
  ANTHROPIC_API_KEY: 'sk-ant-abc123def456ghi789',
  SESSION_SECRET: 'x', // too short (<6) — must NOT produce a rule
};

function redact(text) {
  return redactor.redactText(text, redactor.buildRules(ENV));
}

test('known secret VALUE is redacted wherever it appears', () => {
  const { text, counts } = redact('connecting with DB_PASS sup3r-secret-db-pw now');
  assert.ok(text.includes('[REDACTED:DB_PASS]'), 'value replaced');
  assert.ok(!text.includes('sup3r-secret-db-pw'), 'raw value gone');
  assert.strictEqual(counts.DB_PASS, 1);
});

test('secret value appears mid-JSON (the §3.5 explicit case)', () => {
  const json = JSON.stringify({ db: { host: 'x', password: 'sup3r-secret-db-pw' }, key: 'sk-ant-abc123def456ghi789' });
  const { text } = redact(json);
  assert.ok(!text.includes('sup3r-secret-db-pw'));
  assert.ok(!text.includes('sk-ant-abc123def456ghi789'));
  assert.ok(text.includes('[REDACTED:DB_PASS]'));
  assert.ok(text.includes('[REDACTED:ANTHROPIC_API_KEY]'));
  // Still valid-ish JSON structurally (the surrounding braces survive).
  assert.ok(text.startsWith('{') && text.endsWith('}'));
});

test('too-short secret value does not create a rule (no false redactions)', () => {
  const { text } = redact('the letter x should survive on its own');
  assert.ok(text.includes('x should survive'), 'a 1-char secret must not nuke every x');
});

test('Bearer token pattern', () => {
  const { text, counts } = redact('Authorization: Bearer abcDEF0123456789ghijklmnop._~+/=-');
  assert.ok(text.includes('Bearer [REDACTED:TOKEN]'));
  assert.ok(!text.includes('abcDEF0123456789'));
  assert.strictEqual(counts.BEARER, 1);
});

test('standalone JWT pattern', () => {
  const jwt = 'eyJhbGciOiJIUzI1Ni) '.replace(') ', '') + 'X.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const { text, counts } = redact(`token=${jwt}`);
  assert.ok(text.includes('[REDACTED:JWT]'), 'jwt replaced');
  assert.ok(!text.includes('dozjgNryP4J3'), 'jwt body gone');
  assert.ok(counts.JWT >= 1);
});

test('key=value secret assignment pattern keeps the key, drops the value', () => {
  const { text } = redact('client_secret=AbCdEf12345 and api_key: zzz999yyy and password = hunter2xyz');
  assert.ok(text.includes('client_secret=[REDACTED]'));
  assert.ok(text.includes('api_key: [REDACTED]') || text.includes('api_key:[REDACTED]'));
  assert.ok(text.includes('password = [REDACTED]') || text.includes('password =[REDACTED]'));
  assert.ok(!text.includes('AbCdEf12345'));
  assert.ok(!text.includes('hunter2xyz'));
});

test('tenant names / GUIDs / UPNs are NOT redacted (explicit §3.5.4)', () => {
  const text = 'tenant Contoso Ltd (11111111-2222-3333-4444-555555555555) user admin@contoso.com domain contoso.onmicrosoft.com';
  const { text: out, counts } = redact(text);
  assert.strictEqual(out, text, 'identifiers must pass through untouched');
  assert.strictEqual(Object.keys(counts).length, 0);
});

test('SECRET_KEYS includes the documented keys', () => {
  for (const k of ['DB_PASS', 'MYSQL_ROOT_PASSWORD', 'ENTRA_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'SMTP_PASS', 'SESSION_SECRET', 'LICENSE_TOKEN', 'PANOPTICA_INSTALL_FINGERPRINT']) {
    assert.ok(redactor.SECRET_KEYS.includes(k), `missing ${k}`);
  }
});
