#!/usr/bin/env node
/**
 * Panoptica — Remediate-mode wipe-risk audit
 *
 * Generalizes the Apr 18, 2026 Tatum incident pattern: a remediate-mode CA
 * assignment monitored a field whose template value was empty, and the live
 * tenant value was non-empty. On the next remediation cycle, the empty
 * template value would have wiped the live state.
 *
 * Mitigation in place: NON_REMEDIABLE_FIELDS denylist in api-ca.js shields
 * conditions.users.excludeUsers and conditions.users.excludeGroups. This
 * audit checks whether ANY OTHER monitored field carries the same shape:
 *   (a) live tenant value is non-empty, AND
 *   (b) template value is empty/absent, AND
 *   (c) field is NOT in NON_REMEDIABLE_FIELDS.
 *
 * If any rows are reported, escalate before adding the offending field to
 * monitored_fields on a remediate-mode assignment.
 *
 * Scope: CA only. Intune deployments are monitor-only (intune-drift-scheduler.js
 * comment: "Monitor-only — fires alerts but does NOT auto-remediate").
 *
 * Usage:
 *   node scripts/audit-remediate-wipe-risk.js
 *   node scripts/audit-remediate-wipe-risk.js --json   # JSON output for piping
 *   node scripts/audit-remediate-wipe-risk.js --tenant=<dbId>   # one tenant only
 *
 * Read-only — fetches live policies via Graph but writes nothing. Safe to run
 * during business hours.
 */

const path = require('path');

// Resolve module paths from project root rather than scripts/
process.chdir(path.resolve(__dirname, '..'));
const db = require(path.resolve('./src/db/database'));
const graph = require(path.resolve('./src/graph'));

// Mirrors NON_REMEDIABLE_FIELDS in api-ca.js. Kept in sync manually — if the
// production set grows, update here too. Diverging is benign: this audit
// would just over-report (false-positive risk), which is the safer side.
const NON_REMEDIABLE_FIELDS = new Set([
  'conditions.users.excludeUsers',
  'conditions.users.excludeGroups',
]);

function getNestedValue(obj, path) {
  return path.split('.').reduce((cur, key) => (cur && cur[key] !== undefined ? cur[key] : undefined), obj);
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

function shortValue(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (typeof v === 'object') return `{${Object.keys(v).length} key${Object.keys(v).length === 1 ? '' : 's'}}`;
  const s = String(v);
  return s.length <= 60 ? s : s.substring(0, 57) + '…';
}

async function loadAssignments(tenantFilter) {
  const where = ["a.enforcement = 'remediate'", 'tn.enabled = TRUE'];
  const params = [];
  if (tenantFilter) {
    where.push('a.tenant_id = ?');
    params.push(tenantFilter);
  }

  return db.queryRows(
    `SELECT a.id              AS assignment_id,
            a.tenant_id       AS tenant_db_id,
            a.live_policy_id,
            a.template_id,
            a.enforcement,
            t.name            AS template_name,
            t.policy_json,
            t.monitored_fields,
            tn.tenant_id      AS azure_tenant_id,
            tn.display_name   AS tenant_name
       FROM ca_assignments a
       JOIN ca_templates   t  ON t.id = a.template_id
       JOIN tenants        tn ON tn.id = a.tenant_id
      WHERE ${where.join(' AND ')}`,
    params
  );
}

async function fetchLivePolicy(azureTenantId, livePolicyId) {
  if (!livePolicyId) return null;
  try {
    return await graph.callGraph(azureTenantId, `/identity/conditionalAccess/policies/${livePolicyId}`, { version: 'v1.0' });
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function auditOne(assignment) {
  const findings = [];
  const meta = {
    tenant: assignment.tenant_name,
    template: assignment.template_name,
    assignment_id: assignment.assignment_id,
    skipped_reason: null,
  };

  if (!assignment.live_policy_id) {
    meta.skipped_reason = 'no live_policy_id linked';
    return { meta, findings };
  }

  let templatePolicy;
  try {
    templatePolicy = typeof assignment.policy_json === 'string'
      ? JSON.parse(assignment.policy_json)
      : assignment.policy_json;
  } catch (e) {
    meta.skipped_reason = `unparseable policy_json: ${e.message}`;
    return { meta, findings };
  }

  let monitoredFields;
  try {
    monitoredFields = typeof assignment.monitored_fields === 'string'
      ? JSON.parse(assignment.monitored_fields)
      : assignment.monitored_fields || [];
  } catch {
    monitoredFields = [];
  }
  if (!Array.isArray(monitoredFields) || monitoredFields.length === 0) {
    meta.skipped_reason = 'no monitored_fields configured';
    return { meta, findings };
  }

  let livePolicy;
  try {
    livePolicy = await fetchLivePolicy(assignment.azure_tenant_id, assignment.live_policy_id);
  } catch (err) {
    meta.skipped_reason = `Graph fetch failed: ${err.message}`;
    return { meta, findings };
  }
  if (!livePolicy) {
    meta.skipped_reason = 'live policy not found in tenant';
    return { meta, findings };
  }

  for (const field of monitoredFields) {
    if (NON_REMEDIABLE_FIELDS.has(field)) continue;
    const liveVal = getNestedValue(livePolicy, field);
    const tplVal = getNestedValue(templatePolicy, field);
    if (!isEmpty(liveVal) && isEmpty(tplVal)) {
      findings.push({
        field,
        live_value: shortValue(liveVal),
        template_value: shortValue(tplVal),
      });
    }
  }

  return { meta, findings };
}

function renderText(results) {
  const risky = results.filter(r => r.findings.length > 0);
  const skipped = results.filter(r => !r.findings.length && r.meta.skipped_reason);
  const clean = results.filter(r => !r.findings.length && !r.meta.skipped_reason);

  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  Remediate-mode wipe-risk audit');
  lines.push(`  Run at: ${new Date().toISOString()}`);
  lines.push(`  Total remediate-mode assignments scanned: ${results.length}`);
  lines.push(`  Risky:   ${risky.length}`);
  lines.push(`  Clean:   ${clean.length}`);
  lines.push(`  Skipped: ${skipped.length}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  if (risky.length === 0) {
    lines.push('No wipe-risk fields detected. Existing NON_REMEDIABLE_FIELDS denylist');
    lines.push('appears sufficient for current monitored_fields configurations.');
  } else {
    lines.push('RISKY assignments — escalate before next remediate cycle:');
    lines.push('');
    for (const r of risky) {
      lines.push(`▸ ${r.meta.tenant} / "${r.meta.template}" (assignment #${r.meta.assignment_id})`);
      for (const f of r.findings) {
        lines.push(`    field:    ${f.field}`);
        lines.push(`    live:     ${f.live_value}`);
        lines.push(`    template: ${f.template_value}`);
        lines.push('');
      }
    }
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push('Skipped (incomplete data — did NOT audit):');
    for (const r of skipped) {
      lines.push(`  • ${r.meta.tenant} / "${r.meta.template}" (#${r.meta.assignment_id}) — ${r.meta.skipped_reason}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const tenantArg = args.find(a => a.startsWith('--tenant='));
  const tenantFilter = tenantArg ? parseInt(tenantArg.split('=')[1], 10) : null;

  if (!process.stderr.isTTY === false) console.error('[Audit] Loading remediate-mode assignments…');
  const assignments = await loadAssignments(tenantFilter);
  console.error(`[Audit] ${assignments.length} assignment(s) to scan`);

  const results = [];
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    console.error(`[Audit] [${i + 1}/${assignments.length}] ${a.tenant_name} / "${a.template_name}"`);
    const r = await auditOne(a);
    results.push(r);
  }

  if (wantJson) {
    process.stdout.write(JSON.stringify({
      run_at: new Date().toISOString(),
      total_scanned: results.length,
      results,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(results) + '\n');
  }

  await db.close();
  // Exit 2 if any risky finding (so CI / cron can detect)
  process.exit(results.some(r => r.findings.length > 0) ? 2 : 0);
}

main().catch(err => {
  console.error('[Audit] FATAL:', err.stack || err.message);
  process.exit(1);
});
