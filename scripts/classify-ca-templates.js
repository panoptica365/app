#!/usr/bin/env node
/**
 * Classify CA templates — Node-side backfill for ca_templates.control_dimensions
 * and alert_policies.depends_on_controls.
 *
 * Replaces the name-LIKE heuristics in migrate-ca-exemptions.sql and
 * migrate-mfa-exemption-awareness.sql. Behavior derives from policy JSON
 * structure via the ca-policy-classifier; policy names are NEVER consulted.
 *
 * What this does:
 *   1. For every row in ca_templates, parse policy_json → classify → derive
 *      control_dimensions. Preserves any existing dimensions the classifier
 *      didn't re-emit (human-tagged dims never get dropped).
 *   2. Migrates the stale `block_non_canadian_geo` dimension identifier
 *      (both SQL migrations used this name) to `block_geographic_access`.
 *      Applies to:
 *        - ca_templates.control_dimensions (JSON array)
 *        - alert_policies.detection_logic.depends_on_controls (JSON)
 *        - alerts_suppressed.control_dimension (scalar column)
 *
 * Flags:
 *   --dry-run    Print what would change, write nothing.
 *   --force      Overwrite existing non-empty control_dimensions with the
 *                classifier output (default: merge, never drop existing).
 *
 * Idempotent — safe to run repeatedly.
 *
 * Usage:
 *   node scripts/classify-ca-templates.js            # live run, merge mode
 *   node scripts/classify-ca-templates.js --dry-run  # preview
 *   node scripts/classify-ca-templates.js --force    # overwrite manual tags
 */

'use strict';

const path = require('path');
const db = require('../src/db/database');
const { classifyCaPolicy, toControlDimensionsList } = require('../src/lib/ca-policy-classifier');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LEGACY_GEO_DIM = 'block_non_canadian_geo';
const NEW_GEO_DIM = 'block_geographic_access';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function parseJsonColumn(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function uniqueKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function renameGeoDim(list) {
  if (!Array.isArray(list)) return list;
  return list.map(d => (d === LEGACY_GEO_DIM ? NEW_GEO_DIM : d));
}

// ─────────────────────────────────────────────────────────────
// Step 1: Classify each template
// ─────────────────────────────────────────────────────────────

async function classifyTemplates() {
  const templates = await db.queryRows(
    'SELECT id, name, policy_json, control_dimensions FROM ca_templates'
  );

  console.log(`\n[Classify] ${templates.length} CA templates to process`);
  let updated = 0;
  let skipped = 0;
  let unclassified = 0;

  for (const tpl of templates) {
    const policy = parseJsonColumn(tpl.policy_json, null);
    const existing = parseJsonColumn(tpl.control_dimensions, []);
    const existingRenamed = renameGeoDim(Array.isArray(existing) ? existing : []);

    if (!policy) {
      console.warn(`  [skip ${tpl.id}] "${tpl.name}" — policy_json invalid or null`);
      skipped += 1;
      continue;
    }

    const classified = classifyCaPolicy(policy);
    const classifiedDims = toControlDimensionsList(classified);

    // Decide the final list:
    //   --force: classifier wins, manual tags are discarded.
    //   default: union(classifier, existing-renamed). This means an operator
    //            can manually add a dimension the classifier doesn't know
    //            about, and re-running the backfill won't drop it.
    const finalDims = FORCE
      ? classifiedDims
      : uniqueKeepOrder([...classifiedDims, ...existingRenamed]);

    // Nothing to write?
    const sameAsExisting = JSON.stringify(finalDims) === JSON.stringify(existingRenamed)
      && JSON.stringify(existingRenamed) === JSON.stringify(existing || []);
    if (sameAsExisting) {
      skipped += 1;
      continue;
    }

    if (classified.unclassified.length > 0) {
      unclassified += 1;
      console.log(`  [note ${tpl.id}] "${tpl.name}" — unclassified: ${classified.unclassified.join('; ')}`);
    }

    console.log(`  [${DRY_RUN ? 'DRY' : 'WRITE'} ${tpl.id}] "${tpl.name}"`);
    console.log(`       was: ${JSON.stringify(existing || [])}`);
    console.log(`       now: ${JSON.stringify(finalDims)}`);

    if (!DRY_RUN) {
      await db.execute(
        'UPDATE ca_templates SET control_dimensions = CAST(? AS JSON) WHERE id = ?',
        [JSON.stringify(finalDims), tpl.id]
      );
    }
    updated += 1;
  }

  console.log(`\n[Classify] Result: ${updated} updated, ${skipped} unchanged, ${unclassified} had unclassified notes`);
  return { updated, skipped, unclassified, total: templates.length };
}

// ─────────────────────────────────────────────────────────────
// Step 2: Migrate alert_policies.depends_on_controls
// ─────────────────────────────────────────────────────────────

async function migrateAlertPolicyDependsOnControls() {
  const policies = await db.queryRows(
    'SELECT id, name, detection_logic FROM alert_policies WHERE detection_logic IS NOT NULL'
  );
  let updated = 0;

  for (const p of policies) {
    const logic = parseJsonColumn(p.detection_logic, null);
    if (!logic || typeof logic !== 'object') continue;
    if (!Array.isArray(logic.depends_on_controls)) continue;

    const before = JSON.stringify(logic.depends_on_controls);
    const renamed = uniqueKeepOrder(renameGeoDim(logic.depends_on_controls));
    if (JSON.stringify(renamed) === before) continue;

    logic.depends_on_controls = renamed;
    console.log(`  [${DRY_RUN ? 'DRY' : 'WRITE'} alert_policy ${p.id}] "${p.name}"`);
    console.log(`       was: ${before}`);
    console.log(`       now: ${JSON.stringify(renamed)}`);

    if (!DRY_RUN) {
      await db.execute(
        'UPDATE alert_policies SET detection_logic = CAST(? AS JSON) WHERE id = ?',
        [JSON.stringify(logic), p.id]
      );
    }
    updated += 1;
  }

  console.log(`\n[AlertPolicies] Renamed depends_on_controls in ${updated} policies`);
  return updated;
}

// ─────────────────────────────────────────────────────────────
// Step 3: Migrate alerts_suppressed.control_dimension scalar
// ─────────────────────────────────────────────────────────────

async function migrateSuppressedControlDimension() {
  // Check table exists first — alerts_suppressed was added by migrate-ca-exemptions.
  const tableExists = await db.queryRows(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts_suppressed'"
  );
  if (tableExists.length === 0) {
    console.log(`\n[AlertsSuppressed] Table does not exist — skipping`);
    return 0;
  }

  const rows = await db.queryRows(
    'SELECT COUNT(*) AS n FROM alerts_suppressed WHERE control_dimension = ?',
    [LEGACY_GEO_DIM]
  );
  const n = rows[0]?.n || 0;
  if (n === 0) {
    console.log(`\n[AlertsSuppressed] No legacy rows to rename`);
    return 0;
  }

  console.log(`\n[AlertsSuppressed] ${DRY_RUN ? 'Would rename' : 'Renaming'} ${n} rows from '${LEGACY_GEO_DIM}' → '${NEW_GEO_DIM}'`);

  if (!DRY_RUN) {
    await db.execute(
      'UPDATE alerts_suppressed SET control_dimension = ? WHERE control_dimension = ?',
      [NEW_GEO_DIM, LEGACY_GEO_DIM]
    );
  }
  return n;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

(async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CA Template Classifier Backfill');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Merge: ${FORCE ? 'FORCE (classifier-wins)' : 'UNION (keep existing manual tags)'}`);
  console.log('═══════════════════════════════════════════════════════════');

  try {
    const tpl = await classifyTemplates();
    const ap = await migrateAlertPolicyDependsOnControls();
    const as = await migrateSuppressedControlDimension();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Summary');
    console.log(`    ca_templates:       ${tpl.updated}/${tpl.total} updated${tpl.unclassified ? `, ${tpl.unclassified} w/ notes` : ''}`);
    console.log(`    alert_policies:     ${ap} renamed`);
    console.log(`    alerts_suppressed:  ${as} rows renamed`);
    console.log('═══════════════════════════════════════════════════════════');
    if (DRY_RUN) console.log('\n[Done — dry run, no changes written]');
  } catch (err) {
    console.error('\n[FATAL]', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
})();
