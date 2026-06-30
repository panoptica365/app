/**
 * Unit tests for the pure OAuth-consent evaluator logic in src/ual-evaluators.js
 * (OAuth Consent Evaluator Fixes, 2026-06-29). Run:
 *   node --test test/oauth-consent-evaluator.test.js
 *
 * Covers the three field-reported defects: appName must never be the resource
 * SPN salad; the dedup key must be stable per (user, app, risk-profile) yet
 * distinct on escalation; user+safe consent must classify low (not medium).
 * These are I/O-free helpers — per house rule the live replay is the ship gate,
 * but these pin the labeling/dedup/severity contract against regressions.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ev = require('../src/ual-evaluators');

// The real Magog Technopole raw_data shape that motivated the fix: appName field
// carries Microsoft Graph's SPN URI list (the RESOURCE), not the client app.
const magogRecord = {
  Operation: 'Consent to application.',
  UserId: 'user_5db7d19ce49b471c98918cfd38a8d031@groupeti.ca',
  ClientIP: '20.1.2.3',
  Target: [
    { Type: 2, ID: 'ServicePrincipal_b634571f-0528-42e8-aab0-4c7902464a08' },
  ],
  ModifiedProperties: [
    { Name: 'TargetId.ServicePrincipalNames', NewValue: '00000003-0000-0000-c000-000000000000;https://graph.microsoft.com;https://graph.microsoft.com/' },
    { Name: 'ConsentContext.IsAdminConsent', NewValue: 'False' },
  ],
};

test('parseConsentRecord: appName is NOT the resource SPN salad', () => {
  const parsed = ev._parseConsentRecord(magogRecord);
  assert.ok(parsed, 'record should parse');
  // appName left null when no display name is present — finalized downstream.
  assert.strictEqual(parsed.appName, null);
  // The Graph SPN list must NOT have leaked into appName.
  assert.ok(!String(parsed.appName || '').includes('graph.microsoft.com'));
  // appId preserved verbatim (bless flow depends on it).
  assert.strictEqual(parsed.appId, 'ServicePrincipal_b634571f-0528-42e8-aab0-4c7902464a08');
});

test('normalizeResource collapses Graph SPN list to "Microsoft Graph"', () => {
  const parsed = ev._parseConsentRecord(magogRecord);
  assert.strictEqual(parsed.resource, 'Microsoft Graph');
});

test('normalizeResource: URL host fallback + null on empty', () => {
  assert.strictEqual(ev._normalizeResource('https://contoso.example.com/api;abc'), 'contoso.example.com');
  assert.strictEqual(ev._normalizeResource(''), null);
  assert.strictEqual(ev._normalizeResource(null), null);
});

test('stripSpPrefix strips ServicePrincipal_/Application_ prefixes', () => {
  assert.strictEqual(ev._stripSpPrefix('ServicePrincipal_abc'), 'abc');
  assert.strictEqual(ev._stripSpPrefix('Application_def'), 'def');
  assert.strictEqual(ev._stripSpPrefix('plain'), 'plain');
});

test('resolveConsentAppName: inventory (by objectId) wins, then well-known map', () => {
  const inv = new Map([['b634571f-0528-42e8-aab0-4c7902464a08', 'Acme Mail Connector']]);
  assert.strictEqual(
    ev._resolveConsentAppName('ServicePrincipal_b634571f-0528-42e8-aab0-4c7902464a08', inv),
    'Acme Mail Connector'
  );
  // Well-known first-party appId (Azure CLI) with no inventory hit.
  assert.strictEqual(
    ev._resolveConsentAppName('04b07795-8ddb-461a-bbee-02f9e1bf7b46', new Map()),
    'Microsoft Azure CLI'
  );
  // Unknown → null (caller applies cleaned-id fallback).
  assert.strictEqual(ev._resolveConsentAppName('ServicePrincipal_unknown-guid', new Map()), null);
});

test('oauthConsentDedupKey is stable per (tenant,user,app,risk) and escalates', () => {
  const base = { operator: 'u@x.ca', appId: 'ServicePrincipal_abc', isAdminConsent: false, highRiskScopes: false };
  const k1 = ev._oauthConsentDedupKey(6, base);
  const k2 = ev._oauthConsentDedupKey(6, { ...base });
  assert.strictEqual(k1, k2, 'same consent → same key (recurrence, not flood)');
  assert.strictEqual(k1, 'ual_oauth_consent:6:u@x.ca:ServicePrincipal_abc:us');
  // Bless flow depends on the prefix.
  assert.ok(k1.startsWith('ual_oauth_consent:'));
  // Escalation → distinct keys (must NOT be masked by a benign open alert).
  const admin = ev._oauthConsentDedupKey(6, { ...base, isAdminConsent: true });
  const highRisk = ev._oauthConsentDedupKey(6, { ...base, highRiskScopes: true });
  assert.notStrictEqual(k1, admin);
  assert.notStrictEqual(k1, highRisk);
  assert.notStrictEqual(admin, highRisk);
});

test('classifyConsent: user+safe is LOW, escalations stay high/severe', () => {
  const user = (a, h) => ev._classifyConsent({ operator: 'u', appName: 'App', resource: 'Microsoft Graph', scopes: '', isAdminConsent: a, highRiskScopes: h });
  assert.strictEqual(user(false, false).severity, 'low');    // benign — the fix
  assert.strictEqual(user(false, true).severity, 'high');    // user + high-risk
  assert.strictEqual(user(true, false).severity, 'high');    // admin + safe
  assert.strictEqual(user(true, true).severity, 'severe');   // apex phish
});

test('classifyConsent reason mentions app + resource, never the SPN salad', () => {
  const d = ev._classifyConsent({ operator: 'u@x.ca', appName: 'Acme Connector', resource: 'Microsoft Graph', scopes: '', isAdminConsent: false, highRiskScopes: false });
  assert.ok(d.reason.includes('Acme Connector'));
  assert.ok(d.reason.includes('Microsoft Graph'));
  assert.ok(!d.reason.includes('graph.microsoft.com'));
});
