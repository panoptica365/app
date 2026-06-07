#!/usr/bin/env node
/**
 * Export curated starter templates from the reference instance into versioned
 * seed files (Component A of the "Bundled Starter Templates" build).
 *
 * Context (2026-06-07): fresh MSP installs cold-start with ZERO CA / Intune
 * templates because nothing in the repo or the image seeds them — they only
 * ever existed as DB rows on the operator's own instance. This tool snapshots
 * the curated "Panoptica365 - …" library on Jacques's prod into one JSON file
 * per template under src/db/seed-templates/{intune,ca}/, which then ship inside
 * the image (COPY . . in the Dockerfile) and seed automatically on empty DBs
 * via src/db/seed-templates.js.
 *
 * This is a ONE-SHOT, operator-run tool — there is NO automatic prod→repo path.
 * Committing the generated files is a deliberate, reviewed act.
 *
 * Safety by construction:
 *   - Only templates whose name starts with --prefix (default "Panoptica365")
 *     are exported. Operator-private templates can never leak unless deliberately
 *     exported with a different --prefix.
 *   - Instance-specific columns (id, source_tenant, source_tenant_id, created_at,
 *     updated_at) are stripped.
 *   - CA exemption lists (excludeUsers / excludeGroups) are forced to [] — those
 *     are THIS tenant's break-glass / exclusion-group GUIDs and are meaningless,
 *     even dangerous, in another MSP's tenant. Receiving MSPs add their own.
 *   - Every exported policy_json is scanned for GUID-shaped strings. Anything
 *     not on the known-safe allowlist (MS-global template/role ids, well-known
 *     first-party app ids, placeholders) produces a LOUD warning; writing a file
 *     with warnings requires --allow-warnings, and the run exits non-zero if any
 *     warning was suppressed without that flag.
 *
 * Prerequisite (run on prod first):
 *   node scripts/remove-asr-perrule-exclusion.js --apply   # then dry-run shows 0
 *
 * Flags:
 *   (none)            Dry run — report what WOULD be written, write nothing.
 *   --apply           Write the seed files.
 *   --prefix=<name>   Template-name prefix filter (default: Panoptica365).
 *   --out=<dir>       Output root (default: src/db/seed-templates).
 *   --allow-warnings  Write files even when the GUID audit warns.
 *
 * Usage:
 *   node scripts/export-seed-templates.js                  # preview
 *   node scripts/export-seed-templates.js --apply          # write
 *
 * Idempotent — re-running overwrites the same files deterministically.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// Pure logic (exported for testing — no DB, no fs, no network)
// ─────────────────────────────────────────────────────────────

const SEED_FORMAT = 1;

// Columns kept per kind. Instance-specific columns (id, source_tenant,
// source_tenant_id, created_at, updated_at) are intentionally NOT listed and
// therefore dropped. control_dimensions is carried for CA (the seeder re-derives
// it from policy_json but unions with whatever ships, never dropping a human tag).
const KEPT_COLUMNS = {
  intune: [
    'name', 'description', 'category', 'policy_type', 'platform',
    'template_family', 'policy_json', 'tags', 'assignment_target', 'alert_routing',
  ],
  ca: [
    'name', 'description', 'policy_json', 'state', 'grant_controls',
    'target_users', 'target_apps', 'conditions_summary', 'monitored_fields',
    'control_dimensions',
  ],
};

// JSON columns that mysql2 may hand back either as an already-parsed object or
// as a raw string — normalize them to parsed values in the envelope.
const JSON_COLUMNS = {
  intune: ['policy_json'],
  ca: ['policy_json', 'monitored_fields', 'control_dimensions'],
};

// Matches a GUID anywhere inside a string (templateId carries a trailing _N
// suffix, so we don't anchor to the full string).
const GUID_RE_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Well-known Microsoft first-party application IDs that legitimately appear in
// CA conditions.applications.{include,exclude}Applications. Identical across all
// tenants, so safe to ship. Not exhaustive — anything not listed simply warns
// for manual review, which is the intended fail-safe.
const WELL_KNOWN_APP_IDS = new Set([
  '00000002-0000-0ff1-ce00-000000000000', // Office 365 Exchange Online
  '00000003-0000-0ff1-ce00-000000000000', // Office 365 SharePoint Online
  '00000003-0000-0000-c000-000000000000', // Microsoft Graph
  '00000002-0000-0000-c000-000000000000', // Azure Active Directory (legacy Graph)
  '797f4846-ba00-4fd7-ba43-dac1f8f63013', // Windows Azure Service Management API
  'c44b4083-3bb0-49c1-b47d-974e53cbdf3c', // Microsoft Admin Portals
  'd4ebce55-015a-49b5-a083-c84d1797ae8c', // Microsoft Intune Enrollment
  '0000000a-0000-0000-c000-000000000000', // Microsoft Intune
  '74658136-14ec-4630-ad9b-26e160ff0fc6', // Microsoft 365 admin
  'ab9b8c07-8f02-4f72-87fa-80105867a763', // OneDrive SyncEngine
]);

// Built-in Conditional Access authentication-strength policy IDs. These are
// fixed across every tenant, so a CA template referencing one
// (grantControls.authenticationStrength.id) is portable and safe to ship. A
// CUSTOM auth-strength policy has a tenant-specific GUID — correctly NOT listed
// here, so it warns (a template referencing one wouldn't resolve in another tenant).
const WELL_KNOWN_AUTH_STRENGTH_IDS = new Set([
  '00000000-0000-0000-0000-000000000002', // Multifactor authentication
  '00000000-0000-0000-0000-000000000003', // Passwordless MFA
  '00000000-0000-0000-0000-000000000004', // Phishing-resistant MFA
]);

function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw; // mysql2 may auto-parse JSON columns
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * slugify — deterministic, filesystem-safe filename stem from a template name.
 * "Panoptica365 - ASR Rules Standard" → "panoptica365-asr-rules-standard"
 */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'template';
}

const GUID_EXACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuidString(v) {
  return typeof v === 'string' && GUID_EXACT_RE.test(v);
}

/**
 * Recursively strip source-instance residue from a parsed policy (in place):
 *   - every OData response annotation EXCEPT the load-bearing `@odata.type`
 *     discriminators. `@odata.context` / `@odata.id` / `@odata.editLink` are
 *     pure metadata whose URLs embed the source policy GUID; Graph never wants
 *     them on create. `settingInstance@odata.type` and friends ARE required to
 *     create Intune settings-catalog policies, so any `…@odata.type` key stays.
 *   - when `stripIdGuids`, any key literally named `id` whose value is a GUID
 *     (an instance identity — e.g. Intune intent/setting ids). NOT used for CA,
 *     where a nested `id` (grantControls.authenticationStrength.id) is a needed
 *     reference, not residue.
 *
 * This mirrors what the live deploy/import paths already delete before writing
 * to Graph (api-ca.js buildDeployBody; api-intune.js import cleaners), so a
 * seeded template equals what would actually be deployed — minus the source
 * tenant's identifiers.
 */
function stripMetadataResidue(node, stripIdGuids) {
  if (Array.isArray(node)) {
    for (const el of node) stripMetadataResidue(el, stripIdGuids);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key.includes('@odata.') && !key.endsWith('@odata.type')) { delete node[key]; continue; }
    if (stripIdGuids && key === 'id' && isGuidString(node[key])) { delete node[key]; continue; }
    stripMetadataResidue(node[key], stripIdGuids);
  }
}

/**
 * Sanitize a CA policy for shipping. Mutates a COPY; returns { policy, cleared }.
 *   - Forces the exemption lists (excludeUsers/excludeGroups) to [] — those are
 *     the source instance's break-glass / exclusion-group GUIDs.
 *   - Strips top-level identity + response metadata (mirrors buildDeployBody in
 *     api-ca.js). Does NOT recurse into `id`: grantControls.authenticationStrength.id
 *     is a needed reference that must survive.
 * conditions_summary / grant_controls / target_* are count/label strings that
 * never embed these GUIDs (see extractPolicyFields in api-ca.js), so they need
 * no adjustment.
 */
function sanitizeCaPolicy(policyJson) {
  const policy = JSON.parse(JSON.stringify(policyJson || {}));
  let cleared = 0;
  const users = policy?.conditions?.users;
  if (users && typeof users === 'object') {
    for (const field of ['excludeUsers', 'excludeGroups']) {
      if (Array.isArray(users[field]) && users[field].length > 0) {
        cleared += users[field].length;
      }
      // Force to [] only if the field is present — don't introduce keys Graph
      // didn't have (omitting an exclude field is equivalent to []).
      if (field in users) users[field] = [];
    }
  }
  for (const k of ['id', 'createdDateTime', 'modifiedDateTime', 'templateId']) delete policy[k];
  stripMetadataResidue(policy, false);
  return { policy, cleared };
}

/**
 * Sanitize an Intune policy for shipping. Mutates a COPY; returns { policy }.
 * Strips top-level identity/version (mirrors the api-intune.js import cleaners)
 * and, recursively, instance `id` GUIDs (e.g. endpoint-security intent settings
 * carry a Graph-assigned GUID per setting) + non-type OData annotations. The
 * load-bearing `…@odata.type` discriminators and the MS-global template ids
 * (`templateReference.templateId`, `settingInstanceTemplateId`, …) are preserved.
 */
function sanitizeIntunePolicy(policyJson) {
  const policy = JSON.parse(JSON.stringify(policyJson || {}));
  for (const k of ['id', 'createdDateTime', 'lastModifiedDateTime', 'version']) delete policy[k];
  stripMetadataResidue(policy, true);
  return { policy };
}

/**
 * Classify a single discovered GUID as safe-to-ship or not, by the key/array
 * context it appears under (the nearest owning object key; array elements
 * inherit their array's key) plus, where context alone isn't enough, the GUID
 * value itself against the well-known allowlists.
 */
function classifyGuid(key, guid) {
  const k = String(key || '').toLowerCase();
  const g = String(guid || '').toLowerCase();
  if (k.endsWith('templateid')) return { safe: true, reason: 'MS-global setting/template id' };
  if (k === 'includeroles' || k === 'excluderoles') {
    return { safe: true, reason: 'directory role template id (MS-global)' };
  }
  if (k === 'includeapplications' || k === 'excludeapplications') {
    return WELL_KNOWN_APP_IDS.has(g)
      ? { safe: true, reason: 'well-known first-party app id' }
      : { safe: false, reason: 'application GUID not in well-known first-party set — review' };
  }
  if (k === 'includelocations' || k === 'excludelocations') {
    return { safe: false, reason: 'RAW named-location GUID — expected a __PANOPTICA_LOCATION_*__ placeholder (import-time generalization failed)' };
  }
  if (k === 'includeusers' || k === 'excludeusers') {
    return { safe: false, reason: 'raw user GUID residue' };
  }
  if (k === 'includegroups' || k === 'excludegroups') {
    return { safe: false, reason: 'tenant-specific group GUID' };
  }
  if (k === 'id') {
    // The only legitimate `id`-keyed GUID a portable template ships is a built-in
    // authentication-strength reference; everything else is source-instance residue.
    return WELL_KNOWN_AUTH_STRENGTH_IDS.has(g)
      ? { safe: true, reason: 'built-in authentication strength id (MS-global)' }
      : { safe: false, reason: 'stray object id residue' };
  }
  return { safe: false, reason: `unexpected GUID under "${key}"` };
}

/**
 * Walk a parsed policy and collect every GUID-shaped string with its context.
 * Returns [{ guid, key, path }]. Array elements carry their array's owning key.
 */
function collectGuids(node, key, pathStr, out) {
  if (typeof node === 'string') {
    const matches = node.match(GUID_RE_GLOBAL);
    if (matches) {
      for (const g of matches) out.push({ guid: g.toLowerCase(), key, path: pathStr });
    }
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectGuids(v, key, `${pathStr}[${i}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      collectGuids(v, k, pathStr ? `${pathStr}.${k}` : k, out);
    }
  }
  return out;
}

/**
 * Audit a parsed policy for GUIDs that must not ship. Returns
 * { warnings: [{ guid, key, path, reason }], safeCount }.
 */
function auditPolicyGuids(policyJson) {
  const found = collectGuids(policyJson, null, '', []);
  const warnings = [];
  let safeCount = 0;
  for (const entry of found) {
    const verdict = classifyGuid(entry.key, entry.guid);
    if (verdict.safe) safeCount += 1;
    else warnings.push({ guid: entry.guid, key: entry.key, path: entry.path, reason: verdict.reason });
  }
  return { warnings, safeCount };
}

/**
 * Build the envelope written to disk for one row. For CA, the caller passes the
 * already-sanitized policy back in via the row's policy_json.
 */
function buildEnvelope(kind, row) {
  const template = {};
  for (const col of KEPT_COLUMNS[kind]) {
    let value = row[col];
    if (JSON_COLUMNS[kind].includes(col)) value = safeParse(value);
    template[col] = value === undefined ? null : value;
  }
  return { seedFormat: SEED_FORMAT, kind, template };
}

module.exports = {
  SEED_FORMAT,
  KEPT_COLUMNS,
  WELL_KNOWN_APP_IDS,
  safeParse,
  slugify,
  isGuidString,
  stripMetadataResidue,
  sanitizeCaPolicy,
  sanitizeIntunePolicy,
  classifyGuid,
  collectGuids,
  auditPolicyGuids,
  buildEnvelope,
};

// ─────────────────────────────────────────────────────────────
// Main (only when run directly — keeps the module import-safe for tests)
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const db = require(path.join(ROOT, 'src', 'db', 'database'));

  const APPLY = process.argv.includes('--apply');
  const ALLOW_WARNINGS = process.argv.includes('--allow-warnings');
  const prefixArg = process.argv.find((a) => a.startsWith('--prefix='));
  const PREFIX = prefixArg ? prefixArg.slice('--prefix='.length) : 'Panoptica365';
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const OUT_ROOT = path.resolve(ROOT, outArg ? outArg.slice('--out='.length) : 'src/db/seed-templates');

  const KIND_QUERIES = {
    intune: `SELECT ${KEPT_COLUMNS.intune.join(', ')} FROM intune_templates WHERE name LIKE ? ORDER BY name`,
    ca: `SELECT ${KEPT_COLUMNS.ca.join(', ')} FROM ca_templates WHERE name LIKE ? ORDER BY name`,
  };

  async function exportKind(kind) {
    const rows = await db.queryRows(KIND_QUERIES[kind], [`${PREFIX}%`]);
    const outDir = path.join(OUT_ROOT, kind);
    const usedSlugs = new Map();
    const manifest = [];

    for (const row of rows) {
      const warnings = [];
      let parsedPolicy = safeParse(row.policy_json);
      if (!parsedPolicy) {
        manifest.push({ kind, name: row.name, file: '(skipped)', warnings: ['policy_json unparseable'], written: false });
        continue;
      }

      // Sanitize before auditing/writing: zero CA exemption lists, and strip
      // source-instance residue (ids, timestamps, OData metadata) for both kinds.
      let cleared = 0;
      if (kind === 'ca') {
        const sanitized = sanitizeCaPolicy(parsedPolicy);
        parsedPolicy = sanitized.policy;
        cleared = sanitized.cleared;
      } else {
        parsedPolicy = sanitizeIntunePolicy(parsedPolicy).policy;
      }
      // The row written to the envelope carries the parsed (and, for CA,
      // sanitized) policy — never mutate the loop binding.
      const exportRow = { ...row, policy_json: parsedPolicy };

      const audit = auditPolicyGuids(parsedPolicy);
      for (const w of audit.warnings) {
        warnings.push(`${w.reason} — ${w.guid} @ ${w.path || w.key}`);
      }

      // Deterministic, collision-aware filename.
      let slug = slugify(row.name);
      if (usedSlugs.has(slug)) {
        const n = usedSlugs.get(slug) + 1;
        usedSlugs.set(slug, n);
        warnings.push(`slug collision with another template — suffixed -${n}`);
        slug = `${slug}-${n}`;
      } else {
        usedSlugs.set(slug, 1);
      }
      const file = path.join(outDir, `${slug}.json`);
      const relFile = path.relative(ROOT, file);

      const blockedByWarnings = warnings.length > 0 && !ALLOW_WARNINGS;
      const willWrite = APPLY && !blockedByWarnings;

      if (willWrite) {
        fs.mkdirSync(outDir, { recursive: true });
        const envelope = buildEnvelope(kind, exportRow);
        fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
      }

      manifest.push({
        kind,
        name: row.name,
        file: relFile,
        cleared,
        guidsSafe: audit.safeCount,
        warnings,
        blockedByWarnings,
        written: willWrite,
      });
    }

    return manifest;
  }

  (async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Export seed templates (curated starter library)');
    console.log(`  Prefix:  "${PREFIX}"`);
    console.log(`  Out:     ${path.relative(ROOT, OUT_ROOT)}/{intune,ca}/`);
    console.log(`  Mode:    ${APPLY ? 'APPLY (writing files)' : 'DRY RUN (no writes)'}${ALLOW_WARNINGS ? '  +allow-warnings' : ''}`);
    console.log('═══════════════════════════════════════════════════════════');

    let suppressedWarnings = 0;
    try {
      const manifest = [
        ...(await exportKind('intune')),
        ...(await exportKind('ca')),
      ];

      if (manifest.length === 0) {
        console.log(`\n  No templates match "${PREFIX}%". Nothing to export.`);
        return;
      }

      console.log('\n── Manifest ────────────────────────────────────────────────');
      for (const m of manifest) {
        const mark = m.written ? '✓' : (m.blockedByWarnings ? '✗' : '○');
        console.log(`\n  ${mark} [${m.kind}] ${m.name}`);
        console.log(`      → ${m.file}`);
        if (m.kind === 'ca') console.log(`      exemption GUIDs cleared: ${m.cleared}  |  safe GUIDs: ${m.guidsSafe}`);
        else console.log(`      safe GUIDs: ${m.guidsSafe}`);
        if (m.warnings.length > 0) {
          for (const w of m.warnings) console.log(`      ⚠ ${w}`);
          if (m.blockedByWarnings) {
            suppressedWarnings += 1;
            console.log('      ⚠ NOT written — re-run with --allow-warnings to ship after review');
          }
        }
      }

      const written = manifest.filter((m) => m.written).length;
      const withWarn = manifest.filter((m) => m.warnings.length > 0).length;
      console.log('\n── Summary ─────────────────────────────────────────────────');
      console.log(`  templates matched: ${manifest.length}`);
      console.log(`  with warnings:     ${withWarn}`);
      console.log(`  ${APPLY ? 'written' : 'would write'}: ${APPLY ? written : manifest.filter((m) => !m.blockedByWarnings).length}`);

      if (!APPLY) {
        console.log('\n  DRY RUN — re-run with --apply to write the files.');
      }
      if (suppressedWarnings > 0) {
        console.log(`\n  ${suppressedWarnings} file(s) blocked by GUID-audit warnings.`);
        console.log('  Review each warning above. If the GUID is genuinely safe to ship,');
        console.log('  re-run with --allow-warnings. Exiting non-zero.');
        process.exitCode = 2;
      }
    } catch (err) {
      console.error('\n[FATAL]', err.message);
      console.error(err.stack);
      process.exitCode = 1;
    } finally {
      await db.close().catch(() => {});
    }
  })();
}
