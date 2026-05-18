#!/usr/bin/env node
/**
 * Find recent UAL alerts for a tenant, regardless of email/AI status.
 *
 * Usage:
 *   node scripts/find-ual-alerts.js Dienamex          # last 48h, that tenant
 *   node scripts/find-ual-alerts.js Dienamex 7        # last 7 days
 *   node scripts/find-ual-alerts.js Dienamex 7 mbx    # filter policy name
 *
 * Shows: id, fired-at, policy, severity, AI/email status, dedup_key, summary.
 * Useful when you want to know "did the evaluator fire?" separately from
 * "did the email/PSA path work?".
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const args = process.argv.slice(2);
  const tenantFilter = args[0];
  const days = parseInt(args[1] || '2', 10);
  const policyFilter = args[2] || null;

  if (!tenantFilter) {
    console.error('Usage: node scripts/find-ual-alerts.js <tenant_substring> [days=2] [policy_substring]');
    process.exit(1);
  }

  const db = require('../src/db/database');

  const rows = await db.queryRows(
    `SELECT a.id, a.triggered_at, a.severity, a.status, a.dedup_key,
            a.ai_analysis_en IS NOT NULL AS has_ai,
            a.email_sent,
            ap.name AS policy_name,
            t.display_name AS tenant_name,
            t.psa_name,
            a.message
       FROM alerts a
       JOIN alert_policies ap ON ap.id = a.policy_id
       JOIN tenants t ON t.id = a.tenant_id
      WHERE t.display_name LIKE ?
        AND ap.name LIKE 'UAL:%'
        AND a.triggered_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        ${policyFilter ? `AND ap.name LIKE ?` : ''}
      ORDER BY a.triggered_at DESC
      LIMIT 100`,
    policyFilter
      ? [`%${tenantFilter}%`, days, `%${policyFilter}%`]
      : [`%${tenantFilter}%`, days]
  );

  if (rows.length === 0) {
    console.log(`No UAL alerts for tenant matching "${tenantFilter}" in last ${days} day(s).`);
    console.log(`If you expected alerts here, the evaluator did NOT fire — either the UAL event hasn't arrived in ual_events yet (5-15 min lag), the evaluator's classifier suppressed it (self-grant, etc.), or the operation doesn't match what any evaluator watches.`);
    await db.close().catch(() => {});
    process.exit(0);
  }

  console.log(`Found ${rows.length} UAL alert(s) for tenant matching "${tenantFilter}" in last ${days} day(s):\n`);
  for (const r of rows) {
    const emailMark = r.email_sent ? 'E' : '-';
    const aiMark = r.has_ai ? 'A' : '-';
    console.log(`#${r.id}  ${r.triggered_at}  [${aiMark}${emailMark}]  ${r.severity.padEnd(6)}  ${r.policy_name}  (${r.tenant_name} / psa=${r.psa_name || 'NULL'})`);
    if (r.message) console.log(`     ${r.message.slice(0, 200)}`);
    console.log(`     dedup: ${r.dedup_key}`);
    console.log('');
  }
  console.log('Legend: [AE] = has AI + email sent. [A-] = AI but no email. [-E] = email but no AI. [--] = neither (pre-May-12 inserts).');

  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
