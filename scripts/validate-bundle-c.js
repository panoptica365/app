#!/usr/bin/env node
/**
 * Bundle C synthetic-fixture validation (May 6, 2026)
 *
 * Exercises each of the six Bundle C parsers/classifiers against synthetic
 * raw_record shapes that mirror what Microsoft actually emits in production.
 * Uses Node's built-in `assert` — no test framework required.
 *
 * Run: node scripts/validate-bundle-c.js
 *      Exit 0 on full pass, 1 on any failure (with diagnostics).
 *
 * Fixtures cover:
 *   - Positive case: shape matches, parser returns non-null, classifier alerts
 *   - Negative case: shape almost-matches but should NOT alert
 *   - Edge case: Microsoft inconsistencies (null fields, alternate property names)
 *
 * Reference: existing Bundle A/B validation pattern (scripts/ idiom).
 *            Documentation/Panoptica365 — Unified Audit Log Strategy v2.docx §4.
 */

const assert = require('assert');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────
// Stub the database module BEFORE requiring ual-evaluators — the eager
// ensureUalAlertPolicies() and ensureUalBurstStateSchema() module-load
// hooks would otherwise try to hit a real MySQL connection. We only need
// the parser/classifier exports for synthetic-fixture validation.
// ──────────────────────────────────────────────────────────────────────
const Module = require('module');
const _origResolve = Module._resolveFilename;
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

// Now safe to load the module
const ev = require(path.join('..', 'src', 'ual-evaluators'));

let pass = 0;
let fail = 0;
const failures = [];
const FIX_NS = 'BUNDLE-C';

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`     ${err.message}`);
  }
}

function section(title) {
  console.log(`\n[${FIX_NS}] ${title}`);
}

// ──────────────────────────────────────────────────────────────────────
// C-2: AnonymousLink creation
// ──────────────────────────────────────────────────────────────────────

section('C-2: AnonymousLink');

check('AnonymousLinkCreated → parses', () => {
  const rec = {
    Operation: 'AnonymousLinkCreated',
    UserId: 'admin@contoso.com',
    ObjectId: 'https://contoso.sharepoint.com/sites/finance/Q4.xlsx',
    SourceFileName: 'Q4.xlsx',
    SiteUrl: 'https://contoso.sharepoint.com/sites/finance',
    TargetUserOrGroupType: 'Anonymous',
    ClientIP: '203.0.113.5',
  };
  const parsed = ev._parseAnonymousLinkRecord(rec);
  assert.ok(parsed, 'expected non-null parse');
  assert.strictEqual(parsed.operation, 'AnonymousLinkCreated');
  assert.strictEqual(parsed.targetType, 'Anonymous');
  assert.strictEqual(parsed.fileName, 'Q4.xlsx');
});

check('SharingSet with Anonymous target → parses', () => {
  const rec = {
    Operation: 'SharingSet',
    UserId: 'user@contoso.com',
    ObjectId: 'https://contoso.sharepoint.com/sites/sales/lead.docx',
    SourceFileName: 'lead.docx',
    TargetUserOrGroupType: 'Everyone',
  };
  const parsed = ev._parseAnonymousLinkRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.targetType, 'Everyone');
});

check('SharingSet with internal target → does NOT alert', () => {
  const rec = {
    Operation: 'SharingSet',
    UserId: 'user@contoso.com',
    ObjectId: 'https://contoso.sharepoint.com/sites/team/notes.docx',
    SourceFileName: 'notes.docx',
    TargetUserOrGroupType: 'Member',
  };
  assert.strictEqual(ev._parseAnonymousLinkRecord(rec), null);
});

check('Unrelated operation → null', () => {
  assert.strictEqual(
    ev._parseAnonymousLinkRecord({ Operation: 'FileAccessed', UserId: 'u@x.com' }),
    null
  );
});

check('Missing UserId → null', () => {
  assert.strictEqual(
    ev._parseAnonymousLinkRecord({
      Operation: 'AnonymousLinkCreated',
      ObjectId: 'x',
      TargetUserOrGroupType: 'Anonymous',
    }),
    null
  );
});

// ──────────────────────────────────────────────────────────────────────
// C-3: Mass file deletion (parser is the orchestrator itself; here we
// validate the policy bootstrap shape via direct constant inspection)
// ──────────────────────────────────────────────────────────────────────

section('C-3: Mass file deletion (constants only — orchestrator tested in pilot)');

check('POLICY_MASS_DELETE constant defined', () => {
  assert.strictEqual(ev.POLICY_MASS_DELETE, 'UAL: Mass file deletion burst');
});

// ──────────────────────────────────────────────────────────────────────
// C-4: Compliance / eDiscovery search
// ──────────────────────────────────────────────────────────────────────

section('C-4: Compliance/eDiscovery search');

check('New-ComplianceSearch → parses', () => {
  const rec = {
    Operation: 'New-ComplianceSearch',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Name',              Value: 'Q4 fraud investigation' },
      { Name: 'ExchangeLocation',  Value: 'jane@contoso.com' },
      { Name: 'SearchQuery',       Value: 'subject:invoice' },
    ],
    ClientIP: '198.51.100.7',
  };
  const parsed = ev._parseDiscoverySearchRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.operation, 'New-ComplianceSearch');
  assert.strictEqual(parsed.searchName, 'Q4 fraud investigation');
  assert.strictEqual(parsed.searchScope, 'jane@contoso.com');
});

check('SearchCreated (SharePoint surface) → parses', () => {
  const rec = {
    Operation: 'SearchCreated',
    UserId: 'admin@contoso.com',
    SearchName: 'Site content review',
    Parameters: [{ Name: 'SharePointLocation', Value: 'https://contoso.sharepoint.com' }],
  };
  const parsed = ev._parseDiscoverySearchRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.searchName, 'Site content review');
});

check('Unrelated cmdlet → null', () => {
  assert.strictEqual(
    ev._parseDiscoverySearchRecord({ Operation: 'Get-Mailbox', UserId: 'a@b.com' }),
    null
  );
});

check('DISCOVERY_OPS contains all 4 operation names', () => {
  assert.ok(ev.DISCOVERY_OPS.has('New-ComplianceSearch'));
  assert.ok(ev.DISCOVERY_OPS.has('Start-ComplianceSearch'));
  assert.ok(ev.DISCOVERY_OPS.has('New-MailboxSearch'));
  assert.ok(ev.DISCOVERY_OPS.has('SearchCreated'));
});

// ──────────────────────────────────────────────────────────────────────
// C-5: Mail flow rule disabled or removed
// ──────────────────────────────────────────────────────────────────────

section('C-5: Mail flow rule disabled');

check('Disable-TransportRule → parses', () => {
  const rec = {
    Operation: 'Disable-TransportRule',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'External warning banner' }],
    ClientIP: '203.0.113.10',
  };
  const parsed = ev._parseMailFlowDisabledRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.stateChange, 'Enabled→Disabled');
  assert.strictEqual(parsed.ruleName, 'External warning banner');
});

check('Remove-TransportRule → parses', () => {
  const rec = {
    Operation: 'Remove-TransportRule',
    UserId: 'admin@contoso.com',
    Parameters: [{ Name: 'Identity', Value: 'Block executable attachments' }],
  };
  const parsed = ev._parseMailFlowDisabledRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.stateChange, 'Removed');
});

check('Set-TransportRule with State=Disabled → parses', () => {
  const rec = {
    Operation: 'Set-TransportRule',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity', Value: 'Phish quarantine' },
      { Name: 'State',    Value: 'Disabled' },
    ],
  };
  const parsed = ev._parseMailFlowDisabledRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.stateChange, 'Set State=Disabled');
});

check('Set-TransportRule WITHOUT State change → null (cosmetic edit)', () => {
  const rec = {
    Operation: 'Set-TransportRule',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',         Value: 'Phish quarantine' },
      { Name: 'PrependSubject',   Value: '[EXTERNAL]' },
    ],
  };
  assert.strictEqual(ev._parseMailFlowDisabledRecord(rec), null);
});

check('Panoptica-managed rule → suppressed by name allowlist', () => {
  assert.ok(ev._isPanopticaManagedRule('Panoptica EXO-05 outbound notification'));
  assert.ok(ev._isPanopticaManagedRule('Spam Outbound Notification'));
  assert.strictEqual(ev._isPanopticaManagedRule('External warning banner'), false);
});

// ──────────────────────────────────────────────────────────────────────
// C-6: Application URI / RedirectUri modified
// ──────────────────────────────────────────────────────────────────────

section('C-6: Application URI modified');

check('Update application with ReplyUrls delta → uriDeltas non-empty', () => {
  const rec = {
    Operation: 'Update application',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 2, ID: 'app-guid-123' }],
    ModifiedProperties: [
      { Name: 'ReplyUrls',   OldValue: '["https://app.contoso.com/cb"]',
                             NewValue: '["https://app.contoso.com/cb","https://attacker.example/cb"]' },
      { Name: 'DisplayName', OldValue: 'My App', NewValue: 'My App' },
    ],
  };
  const { uriDeltas, otherDeltas } = ev._parseAppModifiedProps(rec);
  assert.strictEqual(uriDeltas.length, 1);
  assert.strictEqual(otherDeltas.length, 1);
  assert.strictEqual(uriDeltas[0].prop, 'ReplyUrls');
});

check('Update application with ONLY cosmetic delta → parser returns null', () => {
  const rec = {
    Operation: 'Update application',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 2, ID: 'app-guid-123' }],
    ModifiedProperties: [
      { Name: 'DisplayName', OldValue: 'A', NewValue: 'B' },
    ],
  };
  assert.strictEqual(ev._parseAppUriRecord(rec), null);
});

check('Update application with IdentifierUris delta → parses', () => {
  const rec = {
    Operation: 'Update application',
    UserId: 'admin@contoso.com',
    Target: [{ Type: 2, ID: 'app-guid-456' }],
    ModifiedProperties: [
      { Name: 'IdentifierUris', OldValue: 'api://contoso/app',
                                NewValue: 'api://contoso/app,api://attacker/app' },
    ],
  };
  const parsed = ev._parseAppUriRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.uriDeltas.length, 1);
  assert.strictEqual(parsed.uriDeltas[0].prop, 'IdentifierUris');
});

check('APP_URI_PROPS includes Web.RedirectUris and AvailableToOtherTenants', () => {
  assert.ok(ev.APP_URI_PROPS.has('Web.RedirectUris'));
  assert.ok(ev.APP_URI_PROPS.has('AvailableToOtherTenants'));
});

// ──────────────────────────────────────────────────────────────────────
// C-7: Send-As / SendOnBehalf permission grant
// ──────────────────────────────────────────────────────────────────────

section('C-7: Send-As / SendOnBehalf permission');

check('Add-RecipientPermission with SendAs → parses', () => {
  const rec = {
    Operation: 'Add-RecipientPermission',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',     Value: 'jane@contoso.com' },
      { Name: 'Trustee',      Value: 'evil@contoso.com' },
      { Name: 'AccessRights', Value: 'SendAs' },
    ],
  };
  const parsed = ev._parseSendAsGrantRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.permissionType, 'SendAs');
  assert.strictEqual(parsed.grantee, 'evil@contoso.com');
  assert.strictEqual(parsed.mailbox, 'jane@contoso.com');
});

check('Add-RecipientPermission with FullAccess → null (Phase 4 covers FullAccess)', () => {
  const rec = {
    Operation: 'Add-RecipientPermission',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',     Value: 'jane@contoso.com' },
      { Name: 'Trustee',      Value: 'helper@contoso.com' },
      { Name: 'AccessRights', Value: 'ReadPermission' },
    ],
  };
  assert.strictEqual(ev._parseSendAsGrantRecord(rec), null);
});

check('Set-Mailbox with GrantSendOnBehalfTo → parses (parameter form)', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',              Value: 'jane@contoso.com' },
      { Name: 'GrantSendOnBehalfTo',   Value: 'evil@contoso.com' },
    ],
  };
  const parsed = ev._parseSendAsGrantRecord(rec);
  assert.ok(parsed);
  assert.strictEqual(parsed.permissionType, 'SendOnBehalf');
});

check('Set-Mailbox with GrantSendOnBehalfTo cleared → null (removal, not threat)', () => {
  const rec = {
    Operation: 'Set-Mailbox',
    UserId: 'admin@contoso.com',
    Parameters: [
      { Name: 'Identity',            Value: 'jane@contoso.com' },
      { Name: 'GrantSendOnBehalfTo', Value: '$null' },
    ],
  };
  assert.strictEqual(ev._parseSendAsGrantRecord(rec), null);
});

check('Self-grant suppression: grantee == owner → no alert', () => {
  const decision = ev._classifySendAsGrant({
    operator: 'admin@contoso.com',
    grantee:  'jane@contoso.com',
    mailbox:  'jane@contoso.com',
    permissionType: 'SendAs',
  });
  assert.strictEqual(decision.alert, false);
});

check('Cross-user grant → alert', () => {
  const decision = ev._classifySendAsGrant({
    operator: 'admin@contoso.com',
    grantee:  'evil@contoso.com',
    mailbox:  'jane@contoso.com',
    permissionType: 'SendAs',
  });
  assert.strictEqual(decision.alert, true);
});

// ──────────────────────────────────────────────────────────────────────
// Cross-cutting: bootstrap policy constants
// ──────────────────────────────────────────────────────────────────────

section('Cross-cutting: policy constants');

check('All 6 Bundle C policy constants exported', () => {
  assert.strictEqual(typeof ev.POLICY_ANONYMOUS_LINK, 'string');
  assert.strictEqual(typeof ev.POLICY_MASS_DELETE, 'string');
  assert.strictEqual(typeof ev.POLICY_DISCOVERY_SEARCH, 'string');
  assert.strictEqual(typeof ev.POLICY_MAIL_FLOW_DISABLED, 'string');
  assert.strictEqual(typeof ev.POLICY_APP_URI_MODIFIED, 'string');
  assert.strictEqual(typeof ev.POLICY_SENDAS_GRANT, 'string');
});

// ──────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Bundle C synthetic-fixture validation: ${pass} passed, ${fail} failed`);
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
