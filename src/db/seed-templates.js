/**
 * Panoptica — Starter Template Seeder (Component B of the "Bundled Starter
 * Templates" build, 2026-06-07).
 *
 * Fresh MSP installs cold-start with ZERO CA / Intune templates because nothing
 * ever seeded them — the curated "Panoptica365 - …" library only existed as DB
 * rows on the operator's own instance. The seed files under
 * src/db/seed-templates/{intune,ca}/*.json (produced by
 * scripts/export-seed-templates.js, committed to the repo, shipped inside the
 * image) are loaded here at boot.
 *
 * Contract — robust by construction:
 *   - EMPTY-TABLE-ONLY. Seed intune_templates only if it has zero rows; same,
 *     independently, for ca_templates. Existing installs (prod included) are
 *     untouched. There is no seed-version tracking — shipping template revisions
 *     to existing installs is explicitly out of scope (v1).
 *   - Idempotent. The empty-check makes re-runs (every boot, container restart)
 *     no-ops once a table has rows.
 *   - Per-file isolation. One malformed seed file is logged and skipped; it
 *     never aborts boot or the remaining seeds.
 *   - CA control_dimensions are the classifier's to decide, never the export's:
 *     re-derived from policy_json (union with whatever shipped, never dropping a
 *     human-added tag) — see src/lib/ca-policy-classifier.js.
 *   - source_tenant / source_tenant_id stay NULL — a fresh install has no source
 *     tenant. Deploy-time placeholder resolution handles NULL gracefully (it
 *     resolves __PANOPTICA_LOCATION_*__ against the TARGET tenant; the source
 *     GUID-hint path is undefined-safe — see resolveNamedLocationPlaceholders in
 *     api-ca.js).
 *
 * Called from the server bootstrap (src/server.js start()) AFTER both route
 * modules' schema-ensure promises resolve, so the tables + their late-added
 * columns (control_dimensions, source_tenant_id) exist before we INSERT.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { classifyCaPolicy, toControlDimensionsList } = require('../lib/ca-policy-classifier');

// Envelope schema version. Must match SEED_FORMAT in scripts/export-seed-templates.js.
const SEED_FORMAT = 1;

// Mirrors the default in api-ca.js POST /templates so seeded CA templates that
// somehow lack monitored_fields behave identically to operator-imported ones.
const DEFAULT_CA_MONITORED = [
  'state',
  'grantControls.builtInControls',
  'conditions.users.includeUsers',
  'conditions.users.includeGroups',
  'conditions.applications.includeApplications',
  'conditions.users.excludeUsers',
  'conditions.users.excludeGroups',
];

const VALID_ASSIGNMENT_TARGETS = ['none', 'all_users', 'all_devices'];
const VALID_ALERT_ROUTING = ['support', 'personal', 'both', 'none'];

// ─────────────────────────────────────────────────────────────
// Pure helpers (exported for tests — no DB, no fs)
// ─────────────────────────────────────────────────────────────

function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw; // mysql2 may auto-parse JSON columns
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function uniqueKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/**
 * Validate a seed envelope before trusting it. Returns { ok, reason }.
 */
function validateEnvelope(env, expectedKind) {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'not a JSON object' };
  if (env.seedFormat !== SEED_FORMAT) return { ok: false, reason: `unsupported seedFormat ${env.seedFormat}` };
  if (env.kind !== expectedKind) return { ok: false, reason: `kind "${env.kind}" does not match directory "${expectedKind}"` };
  const t = env.template;
  if (!t || typeof t !== 'object') return { ok: false, reason: 'missing template object' };
  if (!t.name || typeof t.name !== 'string') return { ok: false, reason: 'template.name missing' };
  const policy = safeParse(t.policy_json);
  if (!policy || typeof policy !== 'object') return { ok: false, reason: 'template.policy_json missing or unparseable' };
  return { ok: true };
}

/**
 * Re-derive CA control_dimensions from policy_json, UNIONed with whatever the
 * seed file shipped (classifier first, then any extra human-tagged dims). The
 * classifier is the source of truth; the union just guarantees we never drop a
 * dimension a human added that the classifier doesn't (yet) emit.
 */
function recomputeCaDimensions(policyJson, exportedDims) {
  let classifiedDims = [];
  try {
    classifiedDims = toControlDimensionsList(classifyCaPolicy(policyJson));
  } catch {
    classifiedDims = []; // non-fatal — fall back to whatever shipped
  }
  const shipped = Array.isArray(exportedDims) ? exportedDims : (safeParse(exportedDims) || []);
  return uniqueKeepOrder([...classifiedDims, ...(Array.isArray(shipped) ? shipped : [])]);
}

/**
 * Build the parameter array for the intune_templates INSERT (column order must
 * match the SQL in insertIntune below — identical to api-intune.js POST).
 */
function intuneInsertParams(t) {
  const assignTarget = VALID_ASSIGNMENT_TARGETS.includes(t.assignment_target) ? t.assignment_target : 'none';
  const routing = VALID_ALERT_ROUTING.includes(t.alert_routing) ? t.alert_routing : 'both';
  const policyStr = typeof t.policy_json === 'string' ? t.policy_json : JSON.stringify(t.policy_json);
  return [
    t.name,
    t.description || null,
    t.category || 'other',
    t.policy_type || 'configurationPolicies',
    t.platform || 'windows10',
    t.template_family || null,
    policyStr,
    null, // source_tenant — fresh install has none
    t.tags || null,
    assignTarget,
    routing,
  ];
}

/**
 * Build the parameter array for the ca_templates INSERT (column order must match
 * the SQL in insertCa below — identical to api-ca.js POST). control_dimensions
 * are recomputed; source_tenant_id is NULL.
 */
function caInsertParams(t) {
  const policy = safeParse(t.policy_json);
  const dims = recomputeCaDimensions(policy, t.control_dimensions);
  const monitored = Array.isArray(t.monitored_fields)
    ? t.monitored_fields
    : (safeParse(t.monitored_fields) || DEFAULT_CA_MONITORED);
  return [
    t.name,
    t.description || null,
    JSON.stringify(policy),
    t.state || 'enabled',
    t.grant_controls || null,
    t.target_users || null,
    t.target_apps || null,
    t.conditions_summary || null,
    JSON.stringify(monitored),
    JSON.stringify(dims),
    null, // source_tenant_id — fresh install has no source tenant
  ];
}

// ─────────────────────────────────────────────────────────────
// DB-backed seeding
// ─────────────────────────────────────────────────────────────

function listSeedFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Belt-and-suspenders: the server awaits the route modules' schema-ensure
 * promises before calling us, so the table already exists on the happy path
 * and the first probe returns immediately. This bounded wait only matters if
 * that ordering ever changes — it prevents a silent race rather than crashing.
 */
async function waitForTable(database, table, attempts = 20, delayMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await database.queryOne(
      'SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table]
    );
    if (row) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`table ${table} did not appear after ${attempts * delayMs}ms`);
}

async function insertIntune(database, t) {
  await database.insert(
    `INSERT INTO intune_templates
       (name, description, category, policy_type, platform, template_family,
        policy_json, source_tenant, tags, assignment_target, alert_routing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    intuneInsertParams(t)
  );
}

async function insertCa(database, t) {
  await database.insert(
    `INSERT INTO ca_templates
       (name, description, policy_json, state, grant_controls, target_users,
        target_apps, conditions_summary, monitored_fields, control_dimensions,
        source_tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    caInsertParams(t)
  );
}

/**
 * Seed one kind ('intune' | 'ca'). Returns the number of templates inserted
 * (0 if the table was non-empty or no seed files were present).
 */
async function seedKind(database, kind, dir) {
  const table = kind === 'intune' ? 'intune_templates' : 'ca_templates';
  await waitForTable(database, table);

  const countRow = await database.queryOne(`SELECT COUNT(*) AS n FROM ${table}`);
  if (countRow && Number(countRow.n) > 0) {
    console.log(`[Seed:Templates] ${table} not empty (${countRow.n} rows) — skipping (existing install)`);
    return 0;
  }

  const files = listSeedFiles(dir);
  if (files.length === 0) {
    console.log(`[Seed:Templates] no ${kind} seed files present — nothing to seed`);
    return 0;
  }

  let seeded = 0;
  for (const file of files) {
    try {
      const env = JSON.parse(fs.readFileSync(file, 'utf8'));
      const v = validateEnvelope(env, kind);
      if (!v.ok) {
        console.warn(`[Seed:Templates] skipped ${path.basename(file)}: ${v.reason}`);
        continue;
      }
      if (kind === 'intune') await insertIntune(database, env.template);
      else await insertCa(database, env.template);
      seeded += 1;
    } catch (err) {
      console.warn(`[Seed:Templates] skipped ${path.basename(file)}: ${err.message}`);
    }
  }
  return seeded;
}

/**
 * Boot entry point. Seeds intune then ca, each independently empty-gated.
 * Non-fatal: any failure is logged and swallowed so the server still boots.
 *
 * @param {object} [opts]
 * @param {object} [opts.db]      DB module (defaults to ./database). Injectable for tests.
 * @param {string} [opts.baseDir] Seed root (defaults to ./seed-templates).
 */
async function seedStarterTemplates(opts = {}) {
  const database = opts.db || require('./database');
  const baseDir = opts.baseDir || path.join(__dirname, 'seed-templates');

  let intune = 0;
  let ca = 0;
  try {
    intune = await seedKind(database, 'intune', path.join(baseDir, 'intune'));
  } catch (err) {
    console.error('[Seed:Templates] Intune seeding failed (non-fatal):', err.message);
  }
  try {
    ca = await seedKind(database, 'ca', path.join(baseDir, 'ca'));
  } catch (err) {
    console.error('[Seed:Templates] CA seeding failed (non-fatal):', err.message);
  }

  if (intune > 0 || ca > 0) {
    console.log(`[Seed:Templates] Seeded ${intune} Intune + ${ca} CA starter templates (fresh install)`);
  }
  return { intune, ca };
}

module.exports = {
  seedStarterTemplates,
  // Exported for unit tests / advanced callers.
  SEED_FORMAT,
  DEFAULT_CA_MONITORED,
  validateEnvelope,
  recomputeCaDimensions,
  intuneInsertParams,
  caInsertParams,
  safeParse,
};
