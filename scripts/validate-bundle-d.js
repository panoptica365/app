#!/usr/bin/env node
/**
 * Bundle D synthetic-fixture validation (May 6, 2026 late)
 *
 * Same pattern as scripts/validate-bundle-c.js — Module._load stubbing for
 * offline run, Node's built-in `assert` for assertions, exit 0 on full pass.
 *
 * Covers the five Bundle D evaluators:
 *   D-1 Defender alert ingestion (severity mapping + IncidentId capture)
 *   D-2 Site collection administrator added
 *   D-3 Outbound connector created/modified/removed
 *   D-4 Mailbox disabled/removed (data destruction)
 *   D-5 Org-wide Exchange config tampering (security-relevant prop filter)
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
  './alert-engine': {
    createOrUpdateAlert: async () => ({ isNew: false }),
    deriveAllowedCountriesFromCa: async () => new Set(),
  },
  './lib/tenant-mode': {
    shouldProcessTenant: async () => true,
  },
  './lib/ca-compliance-correlation': {
    correlate: async () => ({ matchedSignIn: null }),
    shouldSuppressGeoAlert: () => ({ suppress: false }),
  },
};
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.endsWith('ual-evaluators.js')) {
    if (STUB_MODULES[request]) return STUB_MODULES[request];
  }
  return _origLoad.call(this, request, parent, ...rest);
};

const ev = require(path.join('..', 'src', 'ual-evaluators'));

let pass = 0, fail = 0;
const failures = [];
const FIX_NS = 'BUNDLE-D';

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
// D-1: Microsoft Defender alert ingestion
// ──────────────────────────────────────────────────────────────────────

section('D-1: Defender alert ingestion');

check('AlertEntityGenerated → parses with full Microsoft fields', () => {
  const rec = {
    Operation: 'AlertEntityGenerated',
    AlertId: 'alert-guid-abc-123',
    AlertType: 'Suspicious mailbox manipulation',
    Severity: 'High',
    Status: 'New',
    AffectedUser: 'jane@contoso.com',
    Source: 'Microsoft Defender for Office 365',
    Category: 'InitialAccess',
    IncidentId: 'incident-guid-xyz-789',
    Description: 'Multiple inbox rules created in rapid succession',
  };
  const parsed = ev._parseDefenderAlertRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.alertId, 'alert-guid-abc-123');
  assert.strictEqual(parsed.alertType, 'Suspicious mailbox manipulation');
  assert.strictEqual(parsed.msSeverity, 'high');
  assert.strictEqual(parsed.affectedUser, 'jane@contoso.com');
  assert.strictEqual(parsed.incidentId, 'incident-guid-xyz-789');
});

check('Severity mapping: Microsoft Informational → info', () => {
  assert.strictEqual(ev.DEFENDER_SEVERITY_MAP['informational'], 'info');
});
check('Severity mapping: Low → low', () => {
  assert.strictEqual(ev.DEFENDER_SEVERITY_MAP['low'], 'low');
});
check('Severity mapping: Medium → medium', () => {
  assert.strictEqual(ev.DEFENDER_SEVERITY_MAP['medium'], 'medium');
});
check('Severity mapping: High → high (NOT severe)', () => {
  assert.strictEqual(ev.DEFENDER_SEVERITY_MAP['high'], 'high');
});

check('Missing AlertId → null (can\'t dedupe)', () => {
  const rec = {
    Operation: 'AlertEntityGenerated',
    AlertType: 'something',
    Severity: 'Medium',
  };
  assert.strictEqual(ev._parseDefenderAlertRecord(rec), null);
});

check('camelCase variant fields handled (alertId, severity, etc.)', () => {
  const rec = {
    Operation: 'AlertEntityGenerated',
    alertId: 'alt-id-camel',
    AlertType: 'TestAlert',
    Severity: 'Low',
  };
  const parsed = ev._parseDefenderAlertRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.alertId, 'alt-id-camel');
});

check('Unrelated operation → null', () => {
  assert.strictEqual(
    ev._parseDefenderAlertRecord({ Operation: 'FileAccessed', AlertId: 'x' }),
    null
  );
});

check('No IncidentId → null incidentId (alert not part of incident — common)', () => {
  const rec = {
    Operation: 'AlertEntityGenerated',
    AlertId: 'standalone-alert-1',
    AlertType: 'Single fire',
    Severity: 'Low',
  };
  const parsed = ev._parseDefenderAlertRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.incidentId, null);
});

// ──────────────────────────────────────────────────────────────────────
// D-2: Site collection administrator added
// ──────────────────────────────────────────────────────────────────────

section('D-2: Site collection administrator');

check('Added site collection admin → parses with target user + site URL', () => {
  const rec = {
    Operation: 'Added site collection admin',
    UserId: 'admin@contoso.com',
    TargetUserOrGroupName: 'evil@contoso.com',
    SiteUrl: 'https://contoso.sharepoint.com/sites/finance',
    ClientIP: '203.0.113.20',
  };
  const parsed = ev._parseSiteCollectionAdminRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operator, 'admin@contoso.com');
  assert.strictEqual(parsed.targetUser, 'evil@contoso.com');
  assert.strictEqual(parsed.siteUrl, 'https://contoso.sharepoint.com/sites/finance');
});

check('Unrelated SharePoint op → null', () => {
  assert.strictEqual(
    ev._parseSiteCollectionAdminRecord({ Operation: 'FileAccessed', UserId: 'a@b.com' }),
    null
  );
});

check('Missing UserId → null', () => {
  assert.strictEqual(
    ev._parseSiteCollectionAdminRecord({
      Operation: 'Added site collection admin',
      TargetUserOrGroupName: 'x',
      SiteUrl: 'y',
    }),
    null
  );
});

// ──────────────────────────────────────────────────────────────────────
// D-3: Outbound connector
// ──────────────────────────────────────────────────────────────────────

section('D-3: Outbound connector');

check('OUTBOUND_CONNECTOR_OPS contains all 3 op variants', () => {
  assert.ok(ev.OUTBOUND_CONNECTOR_OPS.has('New-OutboundConnector'));
  assert.ok(ev.OUTBOUND_CONNECTOR_OPS.has('Set-OutboundConnector'));
  assert.ok(ev.OUTBOUND_CONNECTOR_OPS.has('Remove-OutboundConnector'));
});

check('New-OutboundConnector with SmartHosts → parses', () => {
  const rec = {
    Operation: 'New-OutboundConnector',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Name',       Value: 'Outbound to Partner X' },
      { Name: 'SmartHosts', Value: 'mail.attacker.example' },
      { Name: 'Enabled',    Value: 'True' },
    ],
  };
  const parsed = ev._parseOutboundConnectorRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.connectorName, 'Outbound to Partner X');
  assert.strictEqual(parsed.smartHosts, 'mail.attacker.example');
  assert.strictEqual(parsed.enabled, 'True');
});

check('Remove-OutboundConnector → parses (no smart hosts)', () => {
  const rec = {
    Operation: 'Remove-OutboundConnector',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'Legacy Hybrid Connector' }],
  };
  const parsed = ev._parseOutboundConnectorRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operation, 'Remove-OutboundConnector');
  assert.strictEqual(parsed.connectorName, 'Legacy Hybrid Connector');
});

check('Unrelated cmdlet → null', () => {
  assert.strictEqual(
    ev._parseOutboundConnectorRecord({ Operation: 'Set-Mailbox', UserId: 'a@b.com' }),
    null
  );
});

// ──────────────────────────────────────────────────────────────────────
// D-4: Mailbox destruction
// ──────────────────────────────────────────────────────────────────────

section('D-4: Mailbox destruction');

check('MAILBOX_DESTRUCTION_OPS contains both operations', () => {
  assert.ok(ev.MAILBOX_DESTRUCTION_OPS.has('Disable-Mailbox'));
  assert.ok(ev.MAILBOX_DESTRUCTION_OPS.has('Remove-Mailbox'));
});

check('Disable-Mailbox → parses with Identity from Parameters', () => {
  const rec = {
    Operation: 'Disable-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'departing@contoso.com' }],
    ClientIP: '198.51.100.30',
  };
  const parsed = ev._parseMailboxDestructionRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operation, 'Disable-Mailbox');
  assert.strictEqual(parsed.mailbox, 'departing@contoso.com');
  assert.strictEqual(parsed.operator, 'admin@contoso.com');
});

check('Remove-Mailbox → parses', () => {
  const rec = {
    Operation: 'Remove-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'old-shared@contoso.com' }],
  };
  const parsed = ev._parseMailboxDestructionRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operation, 'Remove-Mailbox');
});

check('Unrelated cmdlet → null', () => {
  assert.strictEqual(
    ev._parseMailboxDestructionRecord({ Operation: 'Set-Mailbox', UserId: 'a@b.com' }),
    null
  );
});

// ──────────────────────────────────────────────────────────────────────
// D-5: Org config tamper
// ──────────────────────────────────────────────────────────────────────

section('D-5: Org config tamper');

check('SECURITY_RELEVANT_ORG_PROPS includes the apex-tamper props', () => {
  assert.ok(ev.SECURITY_RELEVANT_ORG_PROPS.has('AutoForwardingEnabled'));
  assert.ok(ev.SECURITY_RELEVANT_ORG_PROPS.has('ModernAuthEnabled'));
  assert.ok(ev.SECURITY_RELEVANT_ORG_PROPS.has('OAuth2ClientProfileEnabled'));
  assert.ok(ev.SECURITY_RELEVANT_ORG_PROPS.has('AdminAuditLogEnabled'));
});

check('Set-OrganizationConfig with ModernAuthEnabled=False → parses + escalates to severe', () => {
  const rec = {
    Operation: 'Set-OrganizationConfig',
    UserId: 'admin@contoso.com',
    ModifiedProperties: [
      { Name: 'ModernAuthEnabled', OldValue: 'True', NewValue: 'False' },
    ],
  };
  const parsed = ev._parseOrgConfigTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.propDeltas.length, 1);
  assert.strictEqual(parsed.propDeltas[0].prop, 'ModernAuthEnabled');
  const sev = ev._classifyOrgConfigTamper(parsed);
  assert.strictEqual(sev, 'severe', 'ModernAuth=False should escalate to severe (MFA bypass)');
});

check('Set-OrganizationConfig with AutoForwardingEnabled=True → severe', () => {
  const rec = {
    Operation: 'Set-OrganizationConfig',
    UserId: 'admin@contoso.com',
    ModifiedProperties: [
      { Name: 'AutoForwardingEnabled', OldValue: 'False', NewValue: 'True' },
    ],
  };
  const parsed = ev._parseOrgConfigTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(ev._classifyOrgConfigTamper(parsed), 'severe');
});

check('Set-OrganizationConfig with non-security prop → null (cosmetic)', () => {
  const rec = {
    Operation: 'Set-OrganizationConfig',
    UserId: 'admin@contoso.com',
    ModifiedProperties: [
      { Name: 'DefaultPublicFolderAgeLimit', OldValue: '90', NewValue: '180' },
    ],
  };
  assert.strictEqual(ev._parseOrgConfigTamperRecord(rec), null);
});

check('Set-OrganizationConfig with mixed props → only security-relevant deltas captured', () => {
  const rec = {
    Operation: 'Set-OrganizationConfig',
    UserId: 'admin@contoso.com',
    ModifiedProperties: [
      { Name: 'OAuth2ClientProfileEnabled',     OldValue: 'True', NewValue: 'False' },
      { Name: 'DefaultPublicFolderAgeLimit',     OldValue: '90',   NewValue: '180' },
      { Name: 'AdminAuditLogEnabled',            OldValue: 'True', NewValue: 'False' },
    ],
  };
  const parsed = ev._parseOrgConfigTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.propDeltas.length, 2, 'cosmetic prop filtered out');
  const props = parsed.propDeltas.map(d => d.prop).sort();
  assert.deepStrictEqual(props, ['AdminAuditLogEnabled', 'OAuth2ClientProfileEnabled']);
  assert.strictEqual(ev._classifyOrgConfigTamper(parsed), 'severe', 'AdminAuditLogEnabled=False should also be severe');
});

check('Set-OrganizationConfig with non-apex security prop → high (not severe)', () => {
  const rec = {
    Operation: 'Set-OrganizationConfig',
    UserId: 'admin@contoso.com',
    ModifiedProperties: [
      { Name: 'ConnectorsEnabled', OldValue: 'False', NewValue: 'True' },
    ],
  };
  const parsed = ev._parseOrgConfigTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(ev._classifyOrgConfigTamper(parsed), 'high', 'non-apex security prop stays at high');
});

// ──────────────────────────────────────────────────────────────────────
// Cross-cutting: Bundle D policy constants
// ──────────────────────────────────────────────────────────────────────

section('Cross-cutting: Bundle D policy constants');

check('All 5 Bundle D policy constants exported', () => {
  assert.strictEqual(typeof ev.POLICY_DEFENDER_ALERT, 'string');
  assert.strictEqual(typeof ev.POLICY_SITE_COLLECTION_ADMIN, 'string');
  assert.strictEqual(typeof ev.POLICY_OUTBOUND_CONNECTOR, 'string');
  assert.strictEqual(typeof ev.POLICY_MAILBOX_DESTRUCTION, 'string');
  assert.strictEqual(typeof ev.POLICY_ORG_CONFIG_TAMPER, 'string');
});

// ──────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Bundle D synthetic-fixture validation: ${pass} passed, ${fail} failed`);
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
