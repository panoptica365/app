#!/usr/bin/env node
/**
 * Defender-incident ingestion diagnostic.
 *
 * Usage:
 *   node scripts/diagnose-defender-incidents.js                  # all tenants
 *   node scripts/diagnose-defender-incidents.js Dienamex         # filter by display_name substring
 *   node scripts/diagnose-defender-incidents.js --fetch Dienamex # also perform live Graph fetch
 *
 * Outputs per tenant:
 *   - whether the tenant is enabled + managed
 *   - whether defender_incidents has any rows for it
 *   - the most recent row's last_updated_at_utc, severity, evaluated_at_*
 *   - last alert in the alerts table from this evaluator
 *   - if --fetch, a live one-shot Graph /security/incidents call to surface
 *     auth/permission errors immediately rather than waiting for next cycle.
 *
 * Written 2026-05-12 to diagnose the Dienamex "Potential Entra Connect Sync
 * tampering" miss. Defensive: never modifies the database or any production
 * state — read-only against MySQL + a single Graph GET if --fetch is passed.
 */

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

// Load .env BEFORE requiring any module that reads process.env at top level
// (db/database.js does this via config/default.js). Without this the script
// runs with empty DB_PASS and gets "Access denied (using password: NO)".
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  let db, defenderIncidents, tenantMode;
  try {
    db = require('../src/db/database');
    defenderIncidents = require('../src/lib/defender-incidents');
    tenantMode = require('../src/lib/tenant-mode');
  } catch (err) {
    console.error('Failed to load Panoptica modules:', err.message);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const doFetch = args.includes('--fetch');
  const filter = args.filter((a) => a !== '--fetch')[0] || null;

  const tenantRows = await db.queryRows(
    `SELECT id, tenant_id, display_name, enabled
       FROM tenants
      ORDER BY display_name`
  );
  const tenants = filter
    ? tenantRows.filter((t) => (t.display_name || '').toLowerCase().includes(filter.toLowerCase()))
    : tenantRows;

  if (tenants.length === 0) {
    console.log(`No tenants match filter "${filter}".`);
    process.exit(0);
  }

  for (const t of tenants) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`${t.display_name}  (id=${t.id}, tenant_id=${t.tenant_id})`);
    console.log(`  enabled=${t.enabled}`);

    try {
      const managed = await tenantMode.shouldProcessTenant(t.id);
      console.log(`  shouldProcessTenant=${managed} (false → audit-only, evaluators skipped)`);
    } catch (err) {
      console.log(`  shouldProcessTenant: ERROR ${err.message}`);
    }

    const incRows = await db.queryRows(
      `SELECT COUNT(*) AS total,
              MAX(last_updated_at_utc) AS most_recent,
              MIN(last_updated_at_utc) AS oldest,
              SUM(CASE WHEN evaluated_at_severity IS NULL THEN 1 ELSE 0 END) AS unevaluated
         FROM defender_incidents WHERE tenant_id = ?`,
      [t.id]
    );
    const stats = incRows[0] || {};
    console.log(`  defender_incidents rows: ${stats.total || 0}`);
    if (stats.total > 0) {
      console.log(`    oldest: ${stats.oldest}`);
      console.log(`    most recent: ${stats.most_recent}`);
      console.log(`    unevaluated: ${stats.unevaluated || 0}`);

      const latest = await db.queryRows(
        `SELECT incident_id, display_name, severity, status, alerts_count,
                evaluated_at_severity, evaluated_at_alerts_count, last_updated_at_utc
           FROM defender_incidents
          WHERE tenant_id = ?
          ORDER BY last_updated_at_utc DESC
          LIMIT 3`,
        [t.id]
      );
      console.log(`  Latest 3:`);
      for (const row of latest) {
        console.log(`    ${row.last_updated_at_utc} sev=${row.severity} alerts=${row.alerts_count} ` +
          `eval_sev=${row.evaluated_at_severity ?? 'NULL'} eval_alerts=${row.evaluated_at_alerts_count ?? 'NULL'} ` +
          `"${row.display_name || '(no name)'}"`);
      }
    }

    const alertRows = await db.queryRows(
      `SELECT a.id, a.triggered_at, a.severity, ap.name AS policy_name, a.dedup_key
         FROM alerts a
         JOIN alert_policies ap ON ap.id = a.policy_id
        WHERE a.tenant_id = ? AND ap.name = 'UAL: Microsoft Defender incident'
        ORDER BY a.triggered_at DESC
        LIMIT 3`,
      [t.id]
    );
    console.log(`  Defender-incident alerts in alerts table: ${alertRows.length}`);
    for (const a of alertRows) {
      console.log(`    ${a.triggered_at} sev=${a.severity} dedup=${a.dedup_key}`);
    }

    if (doFetch) {
      console.log(`  → Live fetch from Microsoft Graph...`);
      try {
        const res = await defenderIncidents.fetchDefenderIncidents(t);
        console.log(`    result: ${JSON.stringify(res)}`);
      } catch (err) {
        console.log(`    LIVE FETCH FAILED: ${err.message}`);
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
