#!/usr/bin/env node
/**
 * Remove a per-rule ASR exclusion from intune_templates.policy_json.
 *
 * Context (2026-06-07): "Panoptica365 - ASR Rules Standard" carries a
 * tenant-specific per-rule exclusion (wazuh-agent.exe on the LSASS
 * credential-stealing rule) that was residue from the original export.
 * This script strips the exclusion from the TEMPLATE ONLY — deployed
 * tenant policies are untouched, so live Wazuh agents keep working.
 *
 * Behavior:
 *   - Scans ALL intune_templates rows for settings-catalog nodes whose
 *     settingDefinitionId ends in `_perruleexclusions` and whose
 *     simpleSettingCollectionValue contains the target value.
 *   - Removes the matching value(s); if the exclusion list becomes empty,
 *     removes the whole perruleexclusions node (matches how Intune
 *     represents "no exclusions": the node is absent, not empty).
 *   - Structure-driven — never matches on template/policy display names.
 *
 * Consequences to expect after --apply:
 *   - Existing deployments of the template will flag drift on the next
 *     drift check (live policy still has the exclusion, template no
 *     longer does). One-time accept per tenant.
 *   - Future deploys of the template will NOT carry the exclusion — if
 *     the target tenant runs Wazuh, the LSASS rule will block
 *     wazuh-agent.exe until an exclusion is added tenant-side.
 *
 * Flags:
 *   (none)            Dry run — report what would change, write nothing.
 *   --apply           Write the cleaned JSON back.
 *   --value=<name>    Exclusion value to remove (default: wazuh-agent.exe).
 *
 * Usage:
 *   node scripts/remove-asr-perrule-exclusion.js           # preview
 *   node scripts/remove-asr-perrule-exclusion.js --apply   # live
 *
 * Idempotent — a second run finds nothing to remove.
 */

'use strict';

const APPLY = process.argv.includes('--apply');
const valueArg = process.argv.find((a) => a.startsWith('--value='));
const TARGET = (valueArg ? valueArg.slice('--value='.length) : 'wazuh-agent.exe').toLowerCase();

// ─────────────────────────────────────────────────────────────
// Pure tree-cleaning logic (exported for testing)
// ─────────────────────────────────────────────────────────────

function isPerRuleExclusionNode(node) {
  return (
    node &&
    typeof node === 'object' &&
    typeof node.settingDefinitionId === 'string' &&
    node.settingDefinitionId.toLowerCase().endsWith('_perruleexclusions') &&
    Array.isArray(node.simpleSettingCollectionValue)
  );
}

/**
 * Recursively remove `target` (lowercased) from every per-rule exclusion
 * node in the tree. Drops a node entirely when its collection empties.
 * Returns an array of { settingDefinitionId, removed, remaining }.
 */
function cleanTree(node, target, report = []) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const child = node[i];
      if (isPerRuleExclusionNode(child)) {
        const before = child.simpleSettingCollectionValue.length;
        const kept = child.simpleSettingCollectionValue.filter(
          (v) => String(v && v.value).toLowerCase() !== target
        );
        const removed = before - kept.length;
        if (removed > 0) {
          report.push({
            settingDefinitionId: child.settingDefinitionId,
            removed,
            remaining: kept.length,
          });
          if (kept.length === 0) {
            node.splice(i, 1); // drop the whole exclusion node
          } else {
            child.simpleSettingCollectionValue = kept;
          }
        }
        continue;
      }
      cleanTree(child, target, report);
    }
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) cleanTree(value, target, report);
  }
  return report;
}

function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw; // mysql2 may auto-parse JSON columns
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { cleanTree, isPerRuleExclusionNode, safeParse };

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const db = require(path.join(ROOT, 'src', 'db', 'database'));

  (async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Remove ASR per-rule exclusion from Intune templates');
    console.log(`  Target value: ${TARGET}`);
    console.log(`  Mode: ${APPLY ? 'LIVE (--apply)' : 'DRY RUN (no writes)'}`);
    console.log('═══════════════════════════════════════════════════════════');

    try {
      const rows = await db.queryRows(
        'SELECT id, name, policy_type, policy_json FROM intune_templates'
      );
      console.log(`\nScanning ${rows.length} template(s)…`);

      let touched = 0;
      for (const row of rows) {
        const parsed = safeParse(row.policy_json);
        if (!parsed) {
          console.warn(`  [skip] #${row.id} "${row.name}" — policy_json unparseable`);
          continue;
        }

        const report = cleanTree(parsed, TARGET);
        if (report.length === 0) continue;

        touched++;
        console.log(`\n  Template #${row.id} — "${row.name}" (${row.policy_type})`);
        for (const r of report) {
          console.log(
            `    - ${r.settingDefinitionId}\n      removed ${r.removed} value(s), ` +
            (r.remaining === 0
              ? 'exclusion node dropped (list empty)'
              : `${r.remaining} other value(s) kept`)
          );
        }

        if (APPLY) {
          await db.execute(
            'UPDATE intune_templates SET policy_json = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [JSON.stringify(parsed, null, 2), row.id]
          );
          console.log('    ✓ written');
        }
      }

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log(`  ${touched} template(s) ${APPLY ? 'updated' : 'would be updated'}`);
      if (!APPLY && touched > 0) {
        console.log('  Re-run with --apply to write.');
      }
      if (APPLY && touched > 0) {
        console.log('  Note: deployed tenants will flag drift on next check');
        console.log('  (live policy still carries the exclusion). Accept per tenant.');
      }
      console.log('═══════════════════════════════════════════════════════════');
    } catch (err) {
      console.error('\n[FATAL]', err.message);
      console.error(err.stack);
      process.exitCode = 1;
    } finally {
      await db.close().catch(() => {});
    }
  })();
}
