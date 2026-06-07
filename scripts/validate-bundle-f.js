#!/usr/bin/env node
/**
 * Bundle F synthetic-fixture validation (May 6, 2026 evening)
 *
 * Defender Incidents via Graph Security API. Different surface than UAL —
 * but same Module._load stubbing pattern as Bundle C/D/E so the validator
 * runs offline (no MySQL, no Graph).
 *
 * Coverage:
 *   - Severity ladder: Microsoft Informational/Low/Medium/High → Panoptica
 *   - classifyIncidentChange: new / severity_escalated / alerts_joined / unchanged
 *   - Severity rank ordering for escalation detection
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

const _origLoad = Module._load;
const STUB_MODULES = {
  './db/database': {
    queryOne: async () => null,
    queryRows: async () => [],
    insert: async () => 0,
    execute: async () => ({ affectedRows: 0 }),
  },
  '../db/database': {
    queryOne: async () => null,
    queryRows: async () => [],
    insert: async () => 0,
    execute: async () => ({ affectedRows: 0 }),
  },
  './alert-engine': {
    createOrUpdateAlert: async () => ({ isNew: false }),
    deriveAllowedCountriesFromCa: async () => new Set(),
  },
  './lib/tenant-mode': { shouldProcessTenant: async () => true },
  './lib/ca-compliance-correlation': {
    correlate: async () => ({ matchedSignIn: null }),
    shouldSuppressGeoAlert: () => ({ suppress: false }),
  },
  '../graph': {
    callGraph: async () => ({ value: [] }),
    callGraphPaged: async () => [],
  },
};
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename) {
    const fn = parent.filename;
    if (fn.endsWith('ual-evaluators.js') || fn.endsWith('defender-incidents.js')) {
      if (STUB_MODULES[request]) return STUB_MODULES[request];
    }
  }
  return _origLoad.call(this, request, parent, ...rest);
};

const ev = require(path.join('..', 'src', 'ual-evaluators'));

let pass = 0, fail = 0;
const failures = [];
const FIX_NS = 'BUNDLE-F';

function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`); }
  catch (err) {
    fail += 1; failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
  }
}
function section(title) { console.log(`\n[${FIX_NS}] ${title}`); }

// ──────────────────────────────────────────────────────────────────────
// F: Defender Incidents
// ──────────────────────────────────────────────────────────────────────

section('F: Severity ladder (Microsoft → Panoptica)');

check('Informational → info', () => {
  assert.strictEqual(ev.DEFENDER_INCIDENT_SEVERITY_MAP['informational'], 'info');
});
check('Low → low', () => {
  assert.strictEqual(ev.DEFENDER_INCIDENT_SEVERITY_MAP['low'], 'low');
});
check('Medium → medium', () => {
  assert.strictEqual(ev.DEFENDER_INCIDENT_SEVERITY_MAP['medium'], 'medium');
});
check('High → high (NOT auto-escalated to severe)', () => {
  assert.strictEqual(ev.DEFENDER_INCIDENT_SEVERITY_MAP['high'], 'high');
});

section('F: Severity rank ordering');

check('Severity rank: low < medium < high', () => {
  assert.ok(ev.DEFENDER_INCIDENT_SEVERITY_RANK['low'] < ev.DEFENDER_INCIDENT_SEVERITY_RANK['medium']);
  assert.ok(ev.DEFENDER_INCIDENT_SEVERITY_RANK['medium'] < ev.DEFENDER_INCIDENT_SEVERITY_RANK['high']);
});

check('Severity rank: informational rated lowest', () => {
  assert.ok(ev.DEFENDER_INCIDENT_SEVERITY_RANK['informational'] < ev.DEFENDER_INCIDENT_SEVERITY_RANK['low']);
});

section('F: classifyIncidentChange — new incident');

check('Never-evaluated incident → fire with reason "new"', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: null,
    severity: 'medium',
    alerts_count: 3,
    evaluated_at_alerts_count: null,
  });
  assert.strictEqual(decision.fire, true);
  assert.strictEqual(decision.reason, 'new');
});

section('F: classifyIncidentChange — severity escalation');

check('Low → High → fire with reason "severity_escalated"', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'low',
    severity: 'high',
    alerts_count: 3,
    evaluated_at_alerts_count: 3,
  });
  assert.strictEqual(decision.fire, true);
  assert.strictEqual(decision.reason, 'severity_escalated');
});

check('Medium → High → fire', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'medium',
    severity: 'high',
    alerts_count: 5,
    evaluated_at_alerts_count: 5,
  });
  assert.strictEqual(decision.fire, true);
});

check('Same severity, same alert count → no fire', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'medium',
    severity: 'medium',
    alerts_count: 3,
    evaluated_at_alerts_count: 3,
  });
  assert.strictEqual(decision.fire, false);
  assert.strictEqual(decision.reason, 'unchanged');
});

check('De-escalation (high → low) → no fire (good news, not alert)', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'high',
    severity: 'low',
    alerts_count: 3,
    evaluated_at_alerts_count: 3,
  });
  assert.strictEqual(decision.fire, false);
});

section('F: classifyIncidentChange — alerts joined');

check('Same severity, alerts_count grew → fire with reason "alerts_joined"', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'medium',
    severity: 'medium',
    alerts_count: 5,
    evaluated_at_alerts_count: 3,
  });
  assert.strictEqual(decision.fire, true);
  assert.strictEqual(decision.reason, 'alerts_joined');
});

check('Same severity, alerts_count shrank → no fire (Microsoft removed an alert)', () => {
  const decision = ev._classifyIncidentChange({
    evaluated_at_severity: 'medium',
    severity: 'medium',
    alerts_count: 2,
    evaluated_at_alerts_count: 5,
  });
  assert.strictEqual(decision.fire, false);
});

section('F: Cross-cutting');

check('POLICY_DEFENDER_INCIDENT constant exported', () => {
  assert.strictEqual(typeof ev.POLICY_DEFENDER_INCIDENT, 'string');
  assert.ok(ev.POLICY_DEFENDER_INCIDENT.includes('Defender'));
});

console.log(`\n${'='.repeat(60)}`);
console.log(`Bundle F synthetic-fixture validation: ${pass} passed, ${fail} failed`);
console.log('='.repeat(60));

if (fail > 0) {
  console.log('\nFailure detail:');
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    ${f.err.stack || f.err.message}`);
  }
  process.exit(1);
}
process.exit(0);
