#!/usr/bin/env node
/**
 * Bundle E synthetic-fixture validation (May 6, 2026 latest)
 *
 * Same Module._load stubbing pattern as validate-bundle-c.js / -d.js — runs
 * fully offline (no MySQL, no Graph). Coverage:
 *   E-1 MFA method tamper (self-change suppression, admin-on-behalf-of, removal severity)
 *   E-2 Exchange role group membership (sensitive-group escalation)
 *   E-3 Per-mailbox audit tamper (Parameters + ModifiedProperties paths)
 *   E-4 Admin password reset (operator==target suppression)
 *   E-5 Legacy protocol re-enable (single vs multi-protocol severity)
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
  './lib/tenant-mode': { shouldProcessTenant: async () => true },
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
const FIX_NS = 'BUNDLE-E';

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
// E-1: MFA method tamper
// ──────────────────────────────────────────────────────────────────────

section('E-1: MFA method tamper');

check('Admin deleted security info → parses (admin-on-behalf-of)', () => {
  const rec = {
    Operation: 'Admin deleted security info',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 5, ID: 'jane@contoso.com' }],
    ObjectId: 'jane@contoso.com',
  };
  const parsed = ev._parseMfaMethodTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operator, 'admin@contoso.com');
  assert.strictEqual(parsed.targetUser, 'jane@contoso.com');
  assert.strictEqual(parsed.changeType, 'removal');
});

check('Admin registered security info → parses with addition changeType', () => {
  const rec = {
    Operation: 'Admin registered security info',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 5, ID: 'jane@contoso.com' }],
    ObjectId: 'jane@contoso.com',
  };
  const parsed = ev._parseMfaMethodTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.changeType, 'addition');
});

check('Self-change (operator==target) → classifier suppresses', () => {
  const decision = ev._classifyMfaMethodTamper({
    operator: 'jane@contoso.com',
    targetUser: 'jane@contoso.com',
    changeType: 'addition',
  });
  assert.strictEqual(decision.alert, false);
});

check('Cross-user removal → classifier returns severe', () => {
  const decision = ev._classifyMfaMethodTamper({
    operator: 'admin@contoso.com',
    targetUser: 'jane@contoso.com',
    changeType: 'removal',
  });
  assert.strictEqual(decision.alert, true);
  assert.strictEqual(decision.severity, 'severe');
});

check('Cross-user addition → classifier returns high', () => {
  const decision = ev._classifyMfaMethodTamper({
    operator: 'admin@contoso.com',
    targetUser: 'jane@contoso.com',
    changeType: 'addition',
  });
  assert.strictEqual(decision.alert, true);
  assert.strictEqual(decision.severity, 'high');
});

check('Update user with StrongAuthenticationRequirements delta → parses', () => {
  const rec = {
    Operation: 'Update user',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 5, ID: 'jane@contoso.com' }],
    ObjectId: 'jane@contoso.com',
    ModifiedProperties: [
      { Name: 'StrongAuthenticationRequirements', OldValue: '[]', NewValue: '[{Enforced}]' },
    ],
  };
  const parsed = ev._parseMfaMethodTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.changeType, 'modification');
});

check('Update user with cosmetic property → null (cosmetic edit)', () => {
  const rec = {
    Operation: 'Update user',
    UserId: 'admin@contoso.com',
    ObjectId: 'jane@contoso.com',
    ModifiedProperties: [
      { Name: 'DisplayName', OldValue: 'Jane', NewValue: 'Jane Smith' },
    ],
  };
  assert.strictEqual(ev._parseMfaMethodTamperRecord(rec), null);
});

// ──────────────────────────────────────────────────────────────────────
// E-2: Exchange role group
// ──────────────────────────────────────────────────────────────────────

section('E-2: Exchange role group');

check('Add-RoleGroupMember to Organization Management → severe', () => {
  const rec = {
    Operation: 'Add-RoleGroupMember',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity', Value: 'Organization Management' },
      { Name: 'Member',   Value: 'attacker@contoso.com' },
    ],
  };
  const parsed = ev._parseExchangeRoleGroupRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(ev._classifyExchangeRoleGroup(parsed), 'severe');
});

check('Add-RoleGroupMember to Discovery Management → severe', () => {
  const rec = {
    Operation: 'Add-RoleGroupMember',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity', Value: 'Discovery Management' },
      { Name: 'Member',   Value: 'attacker@contoso.com' },
    ],
  };
  const parsed = ev._parseExchangeRoleGroupRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(ev._classifyExchangeRoleGroup(parsed), 'severe');
});

check('Add-RoleGroupMember to non-sensitive group → high', () => {
  const rec = {
    Operation: 'Add-RoleGroupMember',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity', Value: 'Help Desk' },
      { Name: 'Member',   Value: 'newhelpdesk@contoso.com' },
    ],
  };
  const parsed = ev._parseExchangeRoleGroupRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(ev._classifyExchangeRoleGroup(parsed), 'high');
});

check('Unrelated cmdlet → null', () => {
  assert.strictEqual(
    ev._parseExchangeRoleGroupRecord({ Operation: 'Set-Mailbox', UserId: 'a@b.com' }),
    null
  );
});

check('EXCHANGE_RBAC_OPS contains all 7 operation variants', () => {
  for (const op of ['Add-RoleGroupMember', 'Remove-RoleGroupMember', 'New-RoleGroup',
                    'Set-RoleGroup', 'Remove-RoleGroup', 'New-ManagementRoleAssignment',
                    'Remove-ManagementRoleAssignment']) {
    assert.ok(ev.EXCHANGE_RBAC_OPS.has(op), `missing op: ${op}`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// E-3: Per-mailbox audit tamper
// ──────────────────────────────────────────────────────────────────────

section('E-3: Per-mailbox audit tamper');

check('Set-Mailbox with AuditEnabled=False (Parameters form) → parses', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',     Value: 'jane@contoso.com' },
      { Name: 'AuditEnabled', Value: 'False' },
    ],
  };
  const parsed = ev._parsePerMailboxAuditTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.auditEnabledFlip, 'False');
  assert.strictEqual(parsed.mailbox, 'jane@contoso.com');
});

check('Set-Mailbox with AuditEnabled=False (ModifiedProperties form) → parses', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'jane@contoso.com' }],
    ModifiedProperties: [
      { Name: 'AuditEnabled', OldValue: 'True', NewValue: 'False' },
    ],
  };
  const parsed = ev._parsePerMailboxAuditTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.auditEnabledFlip, 'False');
});

check('Set-Mailbox with AuditBypassEnabled=True → parses', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',           Value: 'jane@contoso.com' },
      { Name: 'AuditBypassEnabled', Value: 'True' },
    ],
  };
  const parsed = ev._parsePerMailboxAuditTamperRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.auditBypassFlip, 'True');
});

check('Set-Mailbox WITHOUT audit-tamper → null (cosmetic edit)', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',          Value: 'jane@contoso.com' },
      { Name: 'EmailAddressPolicyEnabled', Value: 'True' },
    ],
  };
  assert.strictEqual(ev._parsePerMailboxAuditTamperRecord(rec), null);
});

check('Unrelated cmdlet → null', () => {
  assert.strictEqual(
    ev._parsePerMailboxAuditTamperRecord({ Operation: 'Get-Mailbox', UserId: 'a@b.com' }),
    null
  );
});

// ──────────────────────────────────────────────────────────────────────
// E-4: Admin password reset
// ──────────────────────────────────────────────────────────────────────

section('E-4: Admin password reset');

check('Reset user password (admin → other) → parses', () => {
  const rec = {
    Operation: 'Reset user password',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 5, ID: 'jane@contoso.com' }],
    ObjectId: 'jane@contoso.com',
  };
  const parsed = ev._parseAdminPasswordResetRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operator, 'admin@contoso.com');
  assert.strictEqual(parsed.targetUser, 'jane@contoso.com');
});

check('Self password change (operator==target) → null (suppressed)', () => {
  const rec = {
    Operation: 'Change user password',
    UserId: 'jane@contoso.com',
    Target: [{ Type: 5, ID: 'jane@contoso.com' }],
    ObjectId: 'jane@contoso.com',
  };
  assert.strictEqual(ev._parseAdminPasswordResetRecord(rec), null);
});

check('Unrelated op → null', () => {
  assert.strictEqual(
    ev._parseAdminPasswordResetRecord({ Operation: 'Update user', UserId: 'a@b.com' }),
    null
  );
});

check('ADMIN_PWD_RESET_OPS contains expected ops', () => {
  assert.ok(ev.ADMIN_PWD_RESET_OPS.has('Reset user password'));
  assert.ok(ev.ADMIN_PWD_RESET_OPS.has('Change user password'));
});

// ──────────────────────────────────────────────────────────────────────
// E-5: Legacy protocol re-enable
// ──────────────────────────────────────────────────────────────────────

section('E-5: Legacy protocol re-enable');

check('Set-CASMailbox with ImapEnabled=True → high severity (single protocol)', () => {
  const rec = {
    Operation: 'Set-CASMailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',    Value: 'jane@contoso.com' },
      { Name: 'ImapEnabled', Value: 'True' },
    ],
  };
  const parsed = ev._parseLegacyProtocolReEnableRecord(rec);
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.protocols, ['ImapEnabled']);
  assert.strictEqual(ev._classifyLegacyProtocolReEnable(parsed), 'high');
});

check('Set-CASMailbox with 2+ protocols → severe', () => {
  const rec = {
    Operation: 'Set-CASMailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',          Value: 'jane@contoso.com' },
      { Name: 'ImapEnabled',       Value: 'True' },
      { Name: 'PopEnabled',        Value: 'True' },
      { Name: 'ActiveSyncEnabled', Value: 'True' },
    ],
  };
  const parsed = ev._parseLegacyProtocolReEnableRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.protocols.length, 3);
  assert.strictEqual(ev._classifyLegacyProtocolReEnable(parsed), 'severe');
});

check('Set-CASMailbox with ImapEnabled=False → null (disabling, not enabling)', () => {
  const rec = {
    Operation: 'Set-CASMailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',    Value: 'jane@contoso.com' },
      { Name: 'ImapEnabled', Value: 'False' },
    ],
  };
  assert.strictEqual(ev._parseLegacyProtocolReEnableRecord(rec), null);
});

check('Set-CASMailbox via ModifiedProperties → parses', () => {
  const rec = {
    Operation: 'Set-CASMailbox',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'jane@contoso.com' }],
    ModifiedProperties: [
      { Name: 'EwsEnabled', OldValue: 'False', NewValue: 'True' },
    ],
  };
  const parsed = ev._parseLegacyProtocolReEnableRecord(rec);
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.protocols, ['EwsEnabled']);
});

check('LEGACY_PROTOCOL_PROPS contains the 5 watched protocols', () => {
  assert.deepStrictEqual(
    ev.LEGACY_PROTOCOL_PROPS.sort(),
    ['ActiveSyncEnabled', 'EwsEnabled', 'ImapEnabled', 'MAPIEnabled', 'PopEnabled'].sort()
  );
});

// ──────────────────────────────────────────────────────────────────────
// Cross-cutting
// ──────────────────────────────────────────────────────────────────────

section('Cross-cutting: Bundle E policy constants');

check('All 5 Bundle E policy constants exported', () => {
  assert.strictEqual(typeof ev.POLICY_MFA_METHOD_TAMPER, 'string');
  assert.strictEqual(typeof ev.POLICY_EXCHANGE_ROLE_GROUP, 'string');
  assert.strictEqual(typeof ev.POLICY_PER_MAILBOX_AUDIT_TAMPER, 'string');
  assert.strictEqual(typeof ev.POLICY_ADMIN_PASSWORD_RESET, 'string');
  assert.strictEqual(typeof ev.POLICY_LEGACY_PROTOCOL_REENABLED, 'string');
});

// ──────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Bundle E synthetic-fixture validation: ${pass} passed, ${fail} failed`);
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
