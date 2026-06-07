#!/usr/bin/env node
/**
 * Logic smoke-test for the morning-briefing partition (May 13, 2026).
 *
 * Mocks db.queryRows with synthetic alerts that mirror the May 13 morning
 * briefing observed by Jacques:
 *   - 2 Tatum foreign-login alerts auto-resolved by exemption rule
 *   - 5 Cuisi-N-Art lockout recurrences auto-resolved by exemption rule
 *   - 4 Trilogiam spam-blocked alerts (info severity)
 *   - 1 Dienamex Defender medium-severity incident
 *   - 3 Calogy external-user invites (medium severity)
 *
 * Asserts that:
 *   1. With min_severity='info' (default): exemption-resolved suppressed; rest surface.
 *   2. With min_severity='medium': info-level spam-blocked also suppressed.
 *   3. Filter counts and tenant lists populate correctly.
 *
 * Run with: node scripts/test-briefing-filters.js
 * No DB or network access needed.
 */

'use strict';

// Stub Module._load BEFORE morning-briefing is require()'d so its
// `require('./db/database')` returns our mock.
const Module = require('module');
const realLoad = Module._load;

const mockAlerts = [
  // Tatum — exemption-resolved foreign-login from US (2 rows)
  { id: 101, tenant_id: 5, severity: 'medium', message: 'Foreign login (non-compliant device): alexandre@tatumbio.com from US', status: 'resolved', category: 'identity', ai_analysis: null, triggered_at: '2026-05-13 02:15:00', policy_id: 9, recurrence_count: 1, resolution_reason: 'exemption_rule', tenant_name: 'Tatum' },
  { id: 102, tenant_id: 5, severity: 'medium', message: 'Foreign login (non-compliant device): veronique@tatumbio.com from US', status: 'resolved', category: 'identity', ai_analysis: null, triggered_at: '2026-05-13 03:42:00', policy_id: 9, recurrence_count: 1, resolution_reason: 'exemption_rule', tenant_name: 'Tatum' },
  // Cuisi-N-Art — exemption-resolved lockout (5 recurrences = 5 separate rows for this test)
  { id: 103, tenant_id: 7, severity: 'medium', message: 'Intruder lockout: comptabilite@cuisi-n-art.com', status: 'resolved', category: 'identity', ai_analysis: null, triggered_at: '2026-05-13 04:01:00', policy_id: 12, recurrence_count: 5, resolution_reason: 'exemption_rule', tenant_name: 'Cuisi-N-Art' },
  // Trilogiam — spam-blocked (info severity, NOT exempt) — gets caught by severity filter only
  ...Array.from({ length: 4 }, (_, i) => ({
    id: 200 + i, tenant_id: 1, severity: 'info', message: `Spam quarantined: phishing-attempt-${i}@bad.example`, status: 'new', category: 'email', ai_analysis: null, triggered_at: `2026-05-13 0${i}:30:00`, policy_id: 22, recurrence_count: 1, resolution_reason: null, tenant_name: 'Trilogiam'
  })),
  // Dienamex — medium-severity Entra Connect Sync tampering (should always surface)
  { id: 301, tenant_id: 8, severity: 'medium', message: 'Potential Entra Connect Sync tampering', status: 'resolved', category: 'identity', ai_analysis: 'Sync service hash changed; verify operator action', triggered_at: '2026-05-13 01:55:00', policy_id: 18, recurrence_count: 1, resolution_reason: null, tenant_name: 'Dienamex' },
  // Calogy — external user invites (medium) + inbox rule (low)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: 400 + i, tenant_id: 4, severity: 'medium', message: `External user invited: invitee${i}@external.example`, status: 'new', category: 'identity', ai_analysis: null, triggered_at: `2026-05-13 05:0${i}:00`, policy_id: 27, recurrence_count: 1, resolution_reason: null, tenant_name: 'Calogy Solutions'
  })),
  { id: 410, tenant_id: 4, severity: 'low', message: 'Inbox rule created: "Notifications EmployeurD"', status: 'new', category: 'exchange', ai_analysis: null, triggered_at: '2026-05-13 05:45:00', policy_id: 31, recurrence_count: 1, resolution_reason: null, tenant_name: 'Calogy Solutions' },
];

const mockTenants = [
  { id: 1, tenant_id: 'guid-1', display_name: 'Trilogiam', enabled: 1, last_polled_at: '2026-05-13 06:00:00', poll_count: 100 },
  { id: 4, tenant_id: 'guid-4', display_name: 'Calogy Solutions', enabled: 1, last_polled_at: '2026-05-13 06:00:00', poll_count: 100 },
  { id: 5, tenant_id: 'guid-5', display_name: 'Tatum', enabled: 1, last_polled_at: '2026-05-13 06:00:00', poll_count: 100 },
  { id: 7, tenant_id: 'guid-7', display_name: 'Cuisi-N-Art', enabled: 1, last_polled_at: '2026-05-13 06:00:00', poll_count: 100 },
  { id: 8, tenant_id: 'guid-8', display_name: 'Dienamex', enabled: 1, last_polled_at: '2026-05-13 06:00:00', poll_count: 100 },
];

const dbMock = {
  queryRows: async (sql) => {
    // Tenants query
    if (/FROM tenants WHERE enabled = TRUE AND mode = 'managed'/.test(sql) && /ORDER BY display_name/.test(sql)) {
      return mockTenants;
    }
    // Stale tenants query
    if (/FROM tenants/.test(sql) && /last_polled_at < DATE_SUB/.test(sql)) {
      return [];
    }
    // Alerts query
    if (/FROM alerts a/.test(sql)) {
      return mockAlerts;
    }
    return [];
  },
  queryOne: async () => null,
  execute: async () => ({ affectedRows: 0 }),
  insert: async () => 1,
};

Module._load = function (request, parent) {
  if (request === './db/database' || request === '../db/database') return dbMock;
  return realLoad.call(this, request, parent);
};

// Now require under the mock
const config = require('../config/default');
config.briefing = config.briefing || {};

(async function run() {
  let failed = 0;
  const cases = [
    { label: 'default (info)', minSeverity: 'info' },
    { label: 'medium+',       minSeverity: 'medium' },
    { label: 'high+',         minSeverity: 'high' },
  ];

  for (const c of cases) {
    config.briefing.minSeverity = c.minSeverity;
    // Clear require cache so SEVERITY_RANK closes over fresh config
    delete require.cache[require.resolve('../src/morning-briefing')];
    // Re-mock after cache clear
    Module._load = function (request, parent) {
      if (request === './db/database' || request === '../db/database') return dbMock;
      return realLoad.call(this, request, parent);
    };
    const briefing = require('../src/morning-briefing');

    // generateAndSend would send email — call the lower function instead
    // by re-running gatherBriefingData. It's not exported directly, so we
    // simulate by running the module's behaviour through generateSummary's
    // call path: but the simplest is to import the function. Let's grab it.
    // Workaround: re-evaluate the file content and inspect gatherBriefingData.
    // Easier: rely on the cached briefing being driven by the cron — but we
    // want to inspect. Quick path: re-read the file and eval gatherBriefingData
    // in this context. Simpler still: monkey-patch briefing to expose it.

    // The cleanest test is to call generateAndSend WITHOUT email creds set,
    // since the SMTP branch short-circuits with a warning. The summary
    // generation will go through fallback (no AI client). The cached
    // briefing data is what we want to inspect.
    delete process.env.SMTP_USER;
    config.smtp = config.smtp || {}; config.smtp.auth = config.smtp.auth || {}; config.smtp.auth.user = '';
    config.ai = config.ai || {}; config.ai.apiKey = ''; // force fallback summary

    const result = await briefing.generateAndSend();
    const data = result.data;

    const surfaced = data.totalAlerts;
    const exempt  = data.filter.suppressedByExemption;
    const belowSev = data.filter.suppressedBySeverity;
    const exemptTenants = data.filter.suppressedByExemptionTenantCount;

    console.log(`\n--- min_severity='${c.minSeverity}' ---`);
    console.log(`  surfaced=${surfaced}, suppressedByExemption=${exempt}, suppressedBySeverity=${belowSev}, exemptTenants=${exemptTenants}`);
    console.log(`  exempt tenant names: ${data.filter.suppressedByExemptionTenantNames.join(', ')}`);

    // Expected values
    const expectedExempt = 3; // 2 Tatum + 1 Cuisi-N-Art (5 recurrences collapsed into one alert row)
    if (exempt !== expectedExempt) { console.error(`  ✗ expected suppressedByExemption=${expectedExempt}, got ${exempt}`); failed++; }
    if (exemptTenants !== 2) { console.error(`  ✗ expected exemptTenants=2 (Tatum, Cuisi-N-Art), got ${exemptTenants}`); failed++; }

    if (c.minSeverity === 'info') {
      // Below-threshold filter inactive at info → 0 sev-suppressed
      if (belowSev !== 0) { console.error(`  ✗ expected suppressedBySeverity=0 at info, got ${belowSev}`); failed++; }
      // Surfaced: 4 info (Trilogiam spam) + 1 Dienamex + 3 Calogy invites + 1 Calogy inbox = 9
      if (surfaced !== 9) { console.error(`  ✗ expected surfaced=9 at info, got ${surfaced}`); failed++; }
    }
    if (c.minSeverity === 'medium') {
      // Below medium: 4 info + 1 low (Calogy inbox rule) = 5
      if (belowSev !== 5) { console.error(`  ✗ expected suppressedBySeverity=5 at medium, got ${belowSev}`); failed++; }
      // Surfaced: 1 Dienamex + 3 Calogy invites = 4
      if (surfaced !== 4) { console.error(`  ✗ expected surfaced=4 at medium, got ${surfaced}`); failed++; }
    }
    if (c.minSeverity === 'high') {
      // Below high: 4 info + 1 low + 4 medium (Dienamex + 3 Calogy invites) = 9
      if (belowSev !== 9) { console.error(`  ✗ expected suppressedBySeverity=9 at high, got ${belowSev}`); failed++; }
      // Surfaced: 0 (nothing in our fixture is high/severe and not-exempt)
      if (surfaced !== 0) { console.error(`  ✗ expected surfaced=0 at high, got ${surfaced}`); failed++; }
    }
  }

  if (failed === 0) {
    console.log('\n✓ All partition cases pass.');
    process.exit(0);
  } else {
    console.error(`\n✗ ${failed} assertion(s) failed.`);
    process.exit(1);
  }
})();
