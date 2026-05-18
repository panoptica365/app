#!/usr/bin/env node
/**
 * Panoptica365 — Rename Script
 *
 * Renames all "Panoptica" prefixed names to "Panoptica365" in:
 *   1. DB: ca_templates (name + policy_json.displayName)
 *   2. DB: intune_templates (name + policy_json name/displayName)
 *   3. Graph: CA policies per tenant (displayName)
 *   4. Graph: Intune policies per tenant (name or displayName, depending on type)
 *
 * Usage:
 *   node scripts/rename-panoptica365.js              # dry-run (default)
 *   node scripts/rename-panoptica365.js --execute    # actually make changes
 */

'use strict';

const path = require('path');

// Resolve app modules relative to project root
const ROOT = path.resolve(__dirname, '..');

// Load .env before anything else — auth.js initializes MSAL at require-time
require('dotenv').config({ path: path.join(ROOT, '.env') });

const db = require(path.join(ROOT, 'src', 'db', 'database'));
const graph = require(path.join(ROOT, 'src', 'graph'));

const EXECUTE = process.argv.includes('--execute');
const PATTERN = /Panoptica(?!365)/g; // Match "Panoptica" not followed by "365"

function rename(str) {
  return str.replace(PATTERN, 'Panoptica365');
}

function needsRename(str) {
  return PATTERN.test(str);
}

// Reset regex lastIndex after .test() since it's global
function checkRename(str) {
  PATTERN.lastIndex = 0;
  const needs = PATTERN.test(str);
  PATTERN.lastIndex = 0;
  return needs;
}

// ═══════════════════════════════════════════
// PHASE 1 — DATABASE
// ═══════════════════════════════════════════

async function renameDbTemplates() {
  const section = [];

  // ─── CA Templates ───
  const caTemplates = await db.queryRows(
    "SELECT id, name, policy_json FROM ca_templates WHERE name LIKE 'Panoptica%' AND name NOT LIKE 'Panoptica365%'"
  );

  for (const t of caTemplates) {
    const newName = rename(t.name);
    let newJson = t.policy_json;
    let jsonChanged = false;

    // Update displayName inside policy_json
    try {
      const parsed = typeof t.policy_json === 'object' ? t.policy_json : JSON.parse(t.policy_json);
      if (parsed.displayName && checkRename(parsed.displayName)) {
        parsed.displayName = rename(parsed.displayName);
        newJson = JSON.stringify(parsed);
        jsonChanged = true;
      }
    } catch (e) {
      // If JSON parse fails, try string replace as fallback
      if (typeof t.policy_json === 'string' && checkRename(t.policy_json)) {
        newJson = rename(t.policy_json);
        jsonChanged = true;
      }
    }

    section.push({
      source: 'ca_templates',
      id: t.id,
      oldName: t.name,
      newName,
      jsonChanged,
    });

    if (EXECUTE) {
      await db.execute(
        'UPDATE ca_templates SET name = ?, policy_json = ? WHERE id = ?',
        [newName, newJson, t.id]
      );
    }
  }

  // ─── Intune Templates ───
  const intuneTemplates = await db.queryRows(
    "SELECT id, name, policy_json, policy_type FROM intune_templates WHERE name LIKE 'Panoptica%' AND name NOT LIKE 'Panoptica365%'"
  );

  for (const t of intuneTemplates) {
    const newName = rename(t.name);
    let newJson = t.policy_json;
    let jsonChanged = false;

    try {
      const parsed = typeof t.policy_json === 'object' ? t.policy_json : JSON.parse(t.policy_json);
      let changed = false;

      // configurationPolicies use "name", others use "displayName"
      if (parsed.name && checkRename(parsed.name)) {
        parsed.name = rename(parsed.name);
        changed = true;
      }
      if (parsed.displayName && checkRename(parsed.displayName)) {
        parsed.displayName = rename(parsed.displayName);
        changed = true;
      }

      if (changed) {
        newJson = JSON.stringify(parsed);
        jsonChanged = true;
      }
    } catch (e) {
      if (typeof t.policy_json === 'string' && checkRename(t.policy_json)) {
        newJson = rename(t.policy_json);
        jsonChanged = true;
      }
    }

    section.push({
      source: 'intune_templates',
      id: t.id,
      oldName: t.name,
      newName,
      policyType: t.policy_type,
      jsonChanged,
    });

    if (EXECUTE) {
      await db.execute(
        'UPDATE intune_templates SET name = ?, policy_json = ? WHERE id = ?',
        [newName, newJson, t.id]
      );
    }
  }

  return section;
}

// ═══════════════════════════════════════════
// PHASE 2 — LIVE TENANT POLICIES VIA GRAPH
// ═══════════════════════════════════════════

async function renameTenantPolicies() {
  const tenants = await db.queryRows(
    'SELECT id, tenant_id, display_name FROM tenants WHERE enabled = TRUE'
  );

  const section = [];

  for (const tenant of tenants) {
    const azId = tenant.tenant_id;
    const tenantLabel = `${tenant.display_name} (${azId})`;

    // ─── CA Policies ───
    try {
      const caPolicies = await graph.callGraphPaged(azId, '/identity/conditionalAccess/policies', {
        version: 'v1.0', maxPages: 20,
      });

      for (const p of caPolicies) {
        if (!p.displayName || !checkRename(p.displayName)) continue;

        const newName = rename(p.displayName);
        section.push({
          source: 'graph_ca',
          tenant: tenantLabel,
          policyId: p.id,
          oldName: p.displayName,
          newName,
        });

        if (EXECUTE) {
          await graph.callGraph(azId, `/identity/conditionalAccess/policies/${p.id}`, {
            version: 'v1.0',
            method: 'PATCH',
            body: { displayName: newName },
          });
        }
      }
    } catch (err) {
      section.push({
        source: 'graph_ca',
        tenant: tenantLabel,
        error: `Failed to list CA policies: ${err.message}`,
      });
    }

    // ─── Intune Policies ───
    const intuneTypes = [
      {
        key: 'configurationPolicies',
        label: 'Settings Catalog',
        endpoint: '/deviceManagement/configurationPolicies',
        patchEndpoint: id => `/deviceManagement/configurationPolicies('${id}')`,
        nameField: 'name',
      },
      {
        key: 'deviceConfigurations',
        label: 'Device Configurations',
        endpoint: '/deviceManagement/deviceConfigurations',
        patchEndpoint: id => `/deviceManagement/deviceConfigurations('${id}')`,
        nameField: 'displayName',
      },
      {
        key: 'deviceCompliancePolicies',
        label: 'Compliance Policies',
        endpoint: '/deviceManagement/deviceCompliancePolicies',
        patchEndpoint: id => `/deviceManagement/deviceCompliancePolicies('${id}')`,
        nameField: 'displayName',
      },
      {
        key: 'groupPolicyConfigurations',
        label: 'Admin Templates',
        endpoint: '/deviceManagement/groupPolicyConfigurations',
        patchEndpoint: id => `/deviceManagement/groupPolicyConfigurations('${id}')`,
        nameField: 'displayName',
      },
    ];

    for (const iType of intuneTypes) {
      try {
        const policies = await graph.callGraphPaged(azId, iType.endpoint, {
          version: 'beta', maxPages: 20,
        });

        for (const p of policies) {
          const currentName = p[iType.nameField];
          if (!currentName || !checkRename(currentName)) continue;

          const newName = rename(currentName);
          section.push({
            source: `graph_intune_${iType.key}`,
            tenant: tenantLabel,
            policyType: iType.label,
            policyId: p.id,
            oldName: currentName,
            newName,
          });

          if (EXECUTE) {
            await graph.callGraph(azId, iType.patchEndpoint(p.id), {
              version: 'beta',
              method: 'PATCH',
              body: { [iType.nameField]: newName },
            });
          }
        }
      } catch (err) {
        section.push({
          source: `graph_intune_${iType.key}`,
          tenant: tenantLabel,
          policyType: iType.label,
          error: `Failed to list: ${err.message}`,
        });
      }
    }
  }

  return section;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Panoptica → Panoptica365 Rename Script                  ║');
  console.log(`║  Mode: ${EXECUTE ? 'EXECUTE (changes WILL be applied)' : 'DRY RUN  (no changes made)     '}          ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Phase 1 — Database
  console.log('── Phase 1: Database Templates ──────────────────────────────');
  const dbResults = await renameDbTemplates();

  if (dbResults.length === 0) {
    console.log('  No templates need renaming.');
  } else {
    for (const r of dbResults) {
      if (r.error) {
        console.log(`  ✗ [${r.source}] Error: ${r.error}`);
      } else {
        const jsonNote = r.jsonChanged ? ' (+ policy_json updated)' : '';
        console.log(`  ${EXECUTE ? '✓' : '○'} [${r.source} #${r.id}] "${r.oldName}" → "${r.newName}"${jsonNote}`);
      }
    }
    console.log(`  Total: ${dbResults.filter(r => !r.error).length} template(s)`);
  }

  console.log('');

  // Phase 2 — Live Tenant Policies
  console.log('── Phase 2: Live Tenant Policies (Graph API) ────────────────');
  const graphResults = await renameTenantPolicies();

  if (graphResults.length === 0) {
    console.log('  No live policies need renaming.');
  } else {
    let lastTenant = '';
    for (const r of graphResults) {
      if (r.tenant && r.tenant !== lastTenant) {
        lastTenant = r.tenant;
        console.log(`\n  ┌─ ${r.tenant}`);
      }
      if (r.error) {
        console.log(`  │ ✗ [${r.policyType || r.source}] ${r.error}`);
      } else {
        const typeLabel = r.policyType ? `[${r.policyType}] ` : '[CA] ';
        console.log(`  │ ${EXECUTE ? '✓' : '○'} ${typeLabel}"${r.oldName}" → "${r.newName}"`);
      }
    }
    const renamed = graphResults.filter(r => !r.error).length;
    const errors = graphResults.filter(r => r.error).length;
    console.log(`\n  Total: ${renamed} policy/policies${errors > 0 ? `, ${errors} error(s)` : ''}`);
  }

  // Summary
  console.log('');
  console.log('── Summary ─────────────────────────────────────────────────');
  const totalDb = dbResults.filter(r => !r.error).length;
  const totalGraph = graphResults.filter(r => !r.error).length;
  const totalErrors = dbResults.filter(r => r.error).length + graphResults.filter(r => r.error).length;

  if (EXECUTE) {
    console.log(`  ✓ ${totalDb} DB template(s) renamed`);
    console.log(`  ✓ ${totalGraph} live policy/policies renamed`);
    if (totalErrors > 0) console.log(`  ✗ ${totalErrors} error(s) encountered`);
    console.log('  Done.');
  } else {
    console.log(`  ○ ${totalDb} DB template(s) would be renamed`);
    console.log(`  ○ ${totalGraph} live policy/policies would be renamed`);
    if (totalErrors > 0) console.log(`  ✗ ${totalErrors} error(s) encountered`);
    console.log('');
    console.log('  This was a DRY RUN. To apply changes, run:');
    console.log('    node scripts/rename-panoptica365.js --execute');
  }

  console.log('');
}

main()
  .catch(err => {
    console.error('\nFATAL:', err.message);
    process.exit(1);
  })
  .finally(() => {
    db.close().catch(() => {});
    // Give time for cleanup
    setTimeout(() => process.exit(0), 500);
  });
