/**
 * Unit tests for the Bundled Starter Templates seed pack (2026-06-07 build):
 *   - scripts/export-seed-templates.js  (sanitize, GUID audit, slug, envelope)
 *   - src/db/seed-templates.js          (envelope validation, CA dim recompute,
 *                                        INSERT param builders)
 * Run: node --test test/seed-templates.test.js
 *
 * Per house rule these offline tests are NOT the ship gate — the gate is a live
 * fresh-install boot on the test server that renders the full library and
 * deploys one CA + one Intune template end-to-end (build §6.3). These pin the
 * load-bearing invariants so a refactor can't silently regress them:
 *   - exemption GUIDs never ship (the wazuh-class residue bug),
 *   - tenant-specific GUIDs are surfaced, not silently shipped,
 *   - CA control_dimensions come from the classifier, not the export,
 *   - source_tenant / source_tenant_id are always NULL on a seeded row.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const exporter = require('../scripts/export-seed-templates');
const seeder = require('../src/db/seed-templates');

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROLE_GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10'; // MS-global role template
const BREAKGLASS_USER = '11111111-1111-1111-1111-111111111111';
const EXCLUSION_GROUP = '22222222-2222-2222-2222-222222222222';
const RAW_LOCATION = '33333333-3333-3333-3333-333333333333';
const INCLUDE_GROUP = '44444444-4444-4444-4444-444444444444';
const WELL_KNOWN_APP = '00000002-0000-0ff1-ce00-000000000000'; // EXO
const RANDOM_APP = '99999999-9999-9999-9999-999999999999';
const INTUNE_TEMPLATE_ID = '19c8aa67-f3e6-4f60-ab8e-c4f8b8c0e8e0_1';
const POLICY_ID = '59fd63fe-d963-4ab2-a687-8906b95eb1c0';            // source CA policy id (residue)
const SETTING_INSTANCE_ID = '0214e0fc-05f9-4dd1-bc28-115dfbe7007f'; // intent setting id (residue)
const BUILTIN_AUTH_STRENGTH = '00000000-0000-0000-0000-000000000004'; // Phishing-resistant MFA (MS-global)

function caRequireMfaAdmins() {
  return {
    displayName: 'Panoptica365 - Require MFA for Admins',
    state: 'enabled',
    conditions: {
      users: {
        includeRoles: [ROLE_GLOBAL_ADMIN],
        excludeUsers: [BREAKGLASS_USER],
        excludeGroups: [EXCLUSION_GROUP],
      },
      applications: { includeApplications: ['All'] },
    },
    grantControls: { operator: 'OR', builtInControls: ['mfa'] },
  };
}

// ── Export: sanitizeCaPolicy ────────────────────────────────────────────────

test('sanitizeCaPolicy forces excludeUsers/excludeGroups to [] and counts cleared', () => {
  const input = caRequireMfaAdmins();
  const { policy, cleared } = exporter.sanitizeCaPolicy(input);
  assert.deepStrictEqual(policy.conditions.users.excludeUsers, []);
  assert.deepStrictEqual(policy.conditions.users.excludeGroups, []);
  assert.strictEqual(cleared, 2);
  // includeRoles must survive (it's not an exemption list)
  assert.deepStrictEqual(policy.conditions.users.includeRoles, [ROLE_GLOBAL_ADMIN]);
});

test('sanitizeCaPolicy does not mutate the caller object', () => {
  const input = caRequireMfaAdmins();
  exporter.sanitizeCaPolicy(input);
  assert.deepStrictEqual(input.conditions.users.excludeUsers, [BREAKGLASS_USER], 'original untouched');
});

test('sanitizeCaPolicy does not invent exclude keys Graph did not have', () => {
  const { policy } = exporter.sanitizeCaPolicy({ conditions: { users: { includeUsers: ['All'] } } });
  assert.ok(!('excludeUsers' in policy.conditions.users), 'no phantom excludeUsers key');
});

test('sanitizeCaPolicy is crash-safe on a policy with no users block', () => {
  const { policy, cleared } = exporter.sanitizeCaPolicy({ conditions: {} });
  assert.strictEqual(cleared, 0);
  assert.ok(policy);
});

// ── Export: GUID audit ──────────────────────────────────────────────────────

test('audit: a sanitized admin-MFA policy ships clean (role GUID is MS-global)', () => {
  const { policy } = exporter.sanitizeCaPolicy(caRequireMfaAdmins());
  const { warnings, safeCount } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 0, JSON.stringify(warnings));
  assert.strictEqual(safeCount, 1, 'the role template GUID counts as one safe GUID');
});

test('audit: tenant-specific includeGroups GUID is flagged, not shipped silently', () => {
  const policy = {
    conditions: { users: { includeGroups: [INCLUDE_GROUP], excludeUsers: [], excludeGroups: [] } },
    grantControls: { builtInControls: ['mfa'] },
  };
  const { warnings } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].reason, /group GUID/i);
  assert.strictEqual(warnings[0].guid, INCLUDE_GROUP);
});

test('audit: a RAW named-location GUID is flagged (placeholder generalization failed)', () => {
  const policy = { conditions: { locations: { includeLocations: [RAW_LOCATION] } } };
  const { warnings } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].reason, /placeholder/i);
});

test('audit: a __PANOPTICA_LOCATION_*__ placeholder is not a GUID and never warns', () => {
  const policy = { conditions: { locations: { includeLocations: ['__PANOPTICA_LOCATION_CA__'] } } };
  const { warnings, safeCount } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(safeCount, 0);
});

test('audit: well-known first-party app id is safe; an unknown app GUID warns', () => {
  const safe = exporter.auditPolicyGuids({ conditions: { applications: { includeApplications: [WELL_KNOWN_APP] } } });
  assert.strictEqual(safe.warnings.length, 0);
  assert.strictEqual(safe.safeCount, 1);

  const unknown = exporter.auditPolicyGuids({ conditions: { applications: { includeApplications: [RANDOM_APP] } } });
  assert.strictEqual(unknown.warnings.length, 1);
  assert.match(unknown.warnings[0].reason, /well-known/i);
});

test('audit: Intune settings-catalog templateId GUIDs are MS-global and safe', () => {
  const policy = {
    name: 'Panoptica365 - ASR Rules Standard',
    settings: [{
      settingInstance: {
        settingDefinitionId: 'device_vendor_msft_policy_config_defender_attacksurfacereductionrules',
        settingInstanceTemplateReference: { settingInstanceTemplateId: INTUNE_TEMPLATE_ID },
      },
    }],
    templateReference: { templateId: INTUNE_TEMPLATE_ID },
    roleScopeTagIds: ['0'],
  };
  const { warnings } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 0, JSON.stringify(warnings));
});

test('classifyGuid: key-context verdicts', () => {
  assert.strictEqual(exporter.classifyGuid('templateId', INTUNE_TEMPLATE_ID).safe, true);
  assert.strictEqual(exporter.classifyGuid('settingValueTemplateId', INTUNE_TEMPLATE_ID).safe, true);
  assert.strictEqual(exporter.classifyGuid('includeRoles', ROLE_GLOBAL_ADMIN).safe, true);
  assert.strictEqual(exporter.classifyGuid('includeGroups', INCLUDE_GROUP).safe, false);
  assert.strictEqual(exporter.classifyGuid('excludeUsers', BREAKGLASS_USER).safe, false);
  assert.strictEqual(exporter.classifyGuid('includeLocations', RAW_LOCATION).safe, false);
  // application + id are decided per-GUID against the allowlists
  assert.strictEqual(exporter.classifyGuid('includeApplications', WELL_KNOWN_APP).safe, true);
  assert.strictEqual(exporter.classifyGuid('includeApplications', RANDOM_APP).safe, false);
  assert.strictEqual(exporter.classifyGuid('id', BUILTIN_AUTH_STRENGTH).safe, true);
  assert.strictEqual(exporter.classifyGuid('id', POLICY_ID).safe, false);
});

// ── Export: source-instance residue stripping ───────────────────────────────
// These mirror the exact residue the 2026-06-07 prod dry-run surfaced:
// CA policies carrying their own top-level id + an authenticationStrength@odata.context
// annotation, and an endpoint-security "Account Protection" intent whose every
// setting carries a Graph-assigned GUID id.

test('sanitizeCaPolicy strips the source policy id + @odata.context, keeps real grant refs', () => {
  const input = {
    id: POLICY_ID,
    '@odata.context': `https://graph.microsoft.com/v1.0/$metadata#identity/conditionalAccess/policies('${POLICY_ID}')/$entity`,
    createdDateTime: '2025-01-01T00:00:00Z',
    displayName: 'Panoptica365 - Require MFA for all users',
    state: 'enabled',
    conditions: { users: { includeUsers: ['All'], excludeUsers: [BREAKGLASS_USER] }, applications: { includeApplications: ['All'] } },
    grantControls: {
      operator: 'OR',
      builtInControls: [],
      'authenticationStrength@odata.context': `https://graph.microsoft.com/v1.0/$metadata#identity/conditionalAccess/policies('${POLICY_ID}')/grantControls/authenticationStrength/$entity`,
      authenticationStrength: { id: BUILTIN_AUTH_STRENGTH, displayName: 'Phishing-resistant MFA' },
    },
  };
  const { policy } = exporter.sanitizeCaPolicy(input);
  assert.ok(!('id' in policy), 'top-level policy id stripped');
  assert.ok(!('@odata.context' in policy), 'top-level @odata.context stripped');
  assert.ok(!('createdDateTime' in policy), 'createdDateTime stripped');
  assert.ok(!('authenticationStrength@odata.context' in policy.grantControls), 'nested @odata.context stripped');
  // The needed reference and the type discriminator must survive.
  assert.strictEqual(policy.grantControls.authenticationStrength.id, BUILTIN_AUTH_STRENGTH, 'auth-strength reference preserved');
  // And the whole thing now audits clean (built-in auth-strength id is MS-global).
  const { warnings } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 0, JSON.stringify(warnings));
});

test('sanitizeCaPolicy preserves @odata.type discriminators', () => {
  const { policy } = exporter.sanitizeCaPolicy({
    conditions: { locations: { includeLocations: ['__PANOPTICA_LOCATION_CA__'] } },
    grantControls: { authenticationStrength: { '@odata.type': '#microsoft.graph.authenticationStrengthPolicy', id: BUILTIN_AUTH_STRENGTH } },
  });
  assert.strictEqual(policy.grantControls.authenticationStrength['@odata.type'], '#microsoft.graph.authenticationStrengthPolicy');
});

test('sanitizeIntunePolicy strips intent setting ids + metadata, keeps templateId + @odata.type', () => {
  const input = {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    createdDateTime: '2025-01-01T00:00:00Z',
    lastModifiedDateTime: '2025-02-01T00:00:00Z',
    version: 3,
    name: 'Panoptica365 - Account Protection Settings',
    templateReference: { templateId: INTUNE_TEMPLATE_ID },
    settings: [
      { id: SETTING_INSTANCE_ID, definitionId: 'deviceConfiguration--x', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSettingInstance', settingDefinitionId: 'foo' } },
      { id: '4069d06e-d3e3-4e71-b84d-2ae795115c1e', definitionId: 'deviceConfiguration--y' },
    ],
  };
  const { policy } = exporter.sanitizeIntunePolicy(input);
  assert.ok(!('id' in policy), 'top-level id stripped');
  assert.ok(!('version' in policy), 'version stripped');
  assert.ok(!('id' in policy.settings[0]), 'nested setting id stripped');
  assert.ok(!('id' in policy.settings[1]), 'nested setting id stripped');
  // Load-bearing fields survive.
  assert.strictEqual(policy.templateReference.templateId, INTUNE_TEMPLATE_ID, 'MS-global templateId preserved');
  assert.strictEqual(policy.settings[0].settingInstance['@odata.type'], '#microsoft.graph.deviceManagementConfigurationSettingInstance', '@odata.type preserved');
  assert.strictEqual(policy.settings[0].definitionId, 'deviceConfiguration--x', 'definitionId preserved');
  // Audits clean (only the MS-global templateId remains, which is safe).
  const { warnings, safeCount } = exporter.auditPolicyGuids(policy);
  assert.strictEqual(warnings.length, 0, JSON.stringify(warnings));
  assert.strictEqual(safeCount, 1, 'templateId is the one remaining safe GUID');
});

test('stripMetadataResidue does not strip nested id GUIDs when stripIdGuids=false (CA mode)', () => {
  const node = { grantControls: { authenticationStrength: { id: BUILTIN_AUTH_STRENGTH } } };
  exporter.stripMetadataResidue(node, false);
  assert.strictEqual(node.grantControls.authenticationStrength.id, BUILTIN_AUTH_STRENGTH);
});

// ── Export: slug + envelope ─────────────────────────────────────────────────

test('slugify produces deterministic filesystem-safe stems', () => {
  assert.strictEqual(exporter.slugify('Panoptica365 - ASR Rules Standard'), 'panoptica365-asr-rules-standard');
  assert.strictEqual(exporter.slugify('  Weird/Name!! '), 'weird-name');
  assert.strictEqual(exporter.slugify(''), 'template');
});

test('buildEnvelope (intune) keeps only allowed columns and parses policy_json', () => {
  const row = {
    id: 7, source_tenant: 'Trilogiam', source_tenant_id: 3,
    created_at: 'x', updated_at: 'y',
    name: 'Panoptica365 - X', description: 'd', category: 'security',
    policy_type: 'configurationPolicies', platform: 'windows10',
    template_family: 'asr', tags: 't', assignment_target: 'all_devices',
    alert_routing: 'both', policy_json: JSON.stringify({ a: 1 }),
  };
  const env = exporter.buildEnvelope('intune', row);
  assert.strictEqual(env.seedFormat, 1);
  assert.strictEqual(env.kind, 'intune');
  assert.deepStrictEqual(env.template.policy_json, { a: 1 }, 'policy_json parsed to object');
  for (const stripped of ['id', 'source_tenant', 'source_tenant_id', 'created_at', 'updated_at']) {
    assert.ok(!(stripped in env.template), `${stripped} must be stripped`);
  }
});

// ── Seeder: envelope validation ─────────────────────────────────────────────

test('validateEnvelope accepts a well-formed intune envelope', () => {
  const env = { seedFormat: 1, kind: 'intune', template: { name: 'X', policy_json: { a: 1 } } };
  assert.strictEqual(seeder.validateEnvelope(env, 'intune').ok, true);
});

test('validateEnvelope accepts policy_json shipped as a JSON string', () => {
  const env = { seedFormat: 1, kind: 'ca', template: { name: 'X', policy_json: '{"a":1}' } };
  assert.strictEqual(seeder.validateEnvelope(env, 'ca').ok, true);
});

test('validateEnvelope rejects wrong format, kind mismatch, and missing fields', () => {
  assert.strictEqual(seeder.validateEnvelope({ seedFormat: 2, kind: 'ca', template: {} }, 'ca').ok, false);
  assert.strictEqual(seeder.validateEnvelope({ seedFormat: 1, kind: 'intune', template: { name: 'X', policy_json: {} } }, 'ca').ok, false);
  assert.strictEqual(seeder.validateEnvelope({ seedFormat: 1, kind: 'ca', template: { policy_json: {} } }, 'ca').ok, false);
  assert.strictEqual(seeder.validateEnvelope({ seedFormat: 1, kind: 'ca', template: { name: 'X' } }, 'ca').ok, false);
  assert.strictEqual(seeder.validateEnvelope(null, 'ca').ok, false);
});

// ── Seeder: CA control_dimensions recompute ─────────────────────────────────

test('recomputeCaDimensions derives from the policy (classifier is source of truth)', () => {
  const dims = seeder.recomputeCaDimensions(caRequireMfaAdmins(), null);
  assert.ok(dims.includes('require_mfa'), `expected require_mfa, got ${JSON.stringify(dims)}`);
});

test('recomputeCaDimensions unions classifier output with shipped human tags (never drops)', () => {
  const dims = seeder.recomputeCaDimensions(caRequireMfaAdmins(), ['manual_special_tag']);
  assert.ok(dims.includes('require_mfa'));
  assert.ok(dims.includes('manual_special_tag'), 'shipped tag preserved');
  assert.strictEqual(dims[0], 'require_mfa', 'classifier dims come first');
});

test('recomputeCaDimensions accepts shipped dims as a JSON string', () => {
  const dims = seeder.recomputeCaDimensions(caRequireMfaAdmins(), '["manual_special_tag"]');
  assert.ok(dims.includes('manual_special_tag'));
});

// ── Seeder: INSERT param builders ───────────────────────────────────────────

test('intuneInsertParams applies defaults and forces source_tenant NULL', () => {
  const params = seeder.intuneInsertParams({ name: 'X', policy_json: { a: 1 } });
  // [name, description, category, policy_type, platform, template_family,
  //  policy_json, source_tenant, tags, assignment_target, alert_routing]
  assert.strictEqual(params[0], 'X');
  assert.strictEqual(params[2], 'other');
  assert.strictEqual(params[3], 'configurationPolicies');
  assert.strictEqual(params[4], 'windows10');
  assert.strictEqual(params[6], '{"a":1}', 'policy_json stringified');
  assert.strictEqual(params[7], null, 'source_tenant must be NULL on a seeded row');
  assert.strictEqual(params[9], 'none', 'invalid/absent assignment_target → none');
  assert.strictEqual(params[10], 'both', 'invalid/absent alert_routing → both');
});

test('intuneInsertParams rejects out-of-enum values', () => {
  const params = seeder.intuneInsertParams({
    name: 'X', policy_json: {}, assignment_target: 'bogus', alert_routing: 'bogus',
  });
  assert.strictEqual(params[9], 'none');
  assert.strictEqual(params[10], 'both');
});

test('caInsertParams forces source_tenant_id NULL and recomputes dimensions', () => {
  const params = seeder.caInsertParams({
    name: 'X', policy_json: caRequireMfaAdmins(), control_dimensions: ['stale_should_be_unioned'],
  });
  // [name, description, policy_json, state, grant_controls, target_users,
  //  target_apps, conditions_summary, monitored_fields, control_dimensions, source_tenant_id]
  assert.strictEqual(params[0], 'X');
  assert.strictEqual(params[3], 'enabled', 'state default');
  const dims = JSON.parse(params[9]);
  assert.ok(dims.includes('require_mfa'), 'recomputed from policy');
  assert.ok(dims.includes('stale_should_be_unioned'), 'shipped dim unioned, not dropped');
  assert.strictEqual(params[10], null, 'source_tenant_id must be NULL on a seeded row');
});

test('caInsertParams defaults monitored_fields when absent', () => {
  const params = seeder.caInsertParams({ name: 'X', policy_json: caRequireMfaAdmins() });
  const monitored = JSON.parse(params[8]);
  assert.deepStrictEqual(monitored, seeder.DEFAULT_CA_MONITORED);
});
