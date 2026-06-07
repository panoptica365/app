#!/usr/bin/env node
/**
 * Diagnose UAL event flow for a tenant. Answers:
 *   1. Is the UAL worker subscribed and pulling for this tenant?
 *   2. What recent events did we ingest?
 *   3. Are there any events that SHOULD have fired an evaluator but didn't?
 *
 * Usage:
 *   node scripts/diagnose-ual-events.js Dienamex           # last 48h
 *   node scripts/diagnose-ual-events.js Dienamex 7         # last 7 days
 *   node scripts/diagnose-ual-events.js Dienamex 7 mailbox # filter operations
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const args = process.argv.slice(2);
  const tenantFilter = args[0];
  const days = parseInt(args[1] || '2', 10);
  const opFilter = args[2] || null;

  if (!tenantFilter) {
    console.error('Usage: node scripts/diagnose-ual-events.js <tenant_substring> [days=2] [op_substring]');
    process.exit(1);
  }

  const db = require('../src/db/database');

  // ─── 1. Tenant lookup ────────────────────────────────────────────
  const tenant = await db.queryOne(
    `SELECT id, tenant_id, display_name, psa_name, enabled, mode, ual_first_seen_at, ual_last_evaluated_at
       FROM tenants WHERE display_name LIKE ? LIMIT 1`,
    [`%${tenantFilter}%`]
  );
  if (!tenant) {
    console.error(`No tenant matching "${tenantFilter}"`);
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Tenant: ${tenant.display_name}  (id=${tenant.id}, mode=${tenant.mode}, enabled=${tenant.enabled})`);
  console.log(`  ual_first_seen_at:    ${tenant.ual_first_seen_at || 'NULL — evaluators will SKIP this tenant'}`);
  console.log(`  ual_last_evaluated_at: ${tenant.ual_last_evaluated_at || 'NULL — fresh ingestion'}`);
  console.log('');

  // ─── 2. UAL subscription health ──────────────────────────────────
  const subs = await db.queryRows(
    `SELECT content_type, status, last_blob_time, consecutive_failures, last_error_at, last_error
       FROM ual_subscriptions WHERE tenant_id = ? ORDER BY content_type`,
    [tenant.id]
  );
  if (subs.length === 0) {
    console.log(`No ual_subscriptions rows. Worker hasn't bootstrapped for this tenant yet, OR worker isn't running.`);
  } else {
    console.log(`UAL subscriptions (${subs.length}):`);
    for (const s of subs) {
      const marker = s.consecutive_failures > 0 ? '⚠' : '✓';
      console.log(`  ${marker} ${s.content_type.padEnd(35)} status=${s.status} last_blob=${s.last_blob_time || 'never'} fails=${s.consecutive_failures}`);
      if (s.last_error) console.log(`     last_error: ${String(s.last_error).slice(0, 200)}`);
    }
  }
  console.log('');

  // ─── 3. Event counts by operation ────────────────────────────────
  const opCounts = await db.queryRows(
    `SELECT operation, COUNT(*) AS n, MAX(creation_time) AS most_recent
       FROM ual_events
      WHERE tenant_id = ?
        AND creation_time > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        ${opFilter ? `AND operation LIKE ?` : ''}
      GROUP BY operation
      ORDER BY n DESC
      LIMIT 50`,
    opFilter ? [tenant.id, days, `%${opFilter}%`] : [tenant.id, days]
  );
  if (opCounts.length === 0) {
    console.log(`No UAL events for this tenant in last ${days} day(s)${opFilter ? ` matching "${opFilter}"` : ''}.`);
    console.log(`That's the strongest signal — Microsoft hasn't sent us anything. UAL latency is 15min–24h depending on workload.`);
  } else {
    console.log(`UAL events in last ${days} day(s)${opFilter ? ` matching "${opFilter}"` : ''}:`);
    for (const r of opCounts) {
      console.log(`  ${String(r.n).padStart(5)}  ${r.most_recent}  ${r.operation}`);
    }
  }
  console.log('');

  // ─── 4. Specifically check for the operations we asked about ─────
  const interestingOps = [
    'Add-MailboxPermission',
    'Remove-MailboxPermission',
    'Add-RecipientPermission',
    'Remove-RecipientPermission',
    'Set-Mailbox',                  // for GrantSendOnBehalfTo / ForwardingSmtpAddress
    'Add-DistributionGroupMember',
    'Remove-DistributionGroupMember',
    'Update group',                 // Entra-side group changes (M365 groups)
  ];
  console.log(`Specific operations of interest (last ${days} days):`);
  const placeholders = interestingOps.map(() => '?').join(',');
  const recent = await db.queryRows(
    // user_upn + user_id are the actual columns. target_resource is JSON {type, id, name, path}.
    // See schema in src/lib/ual-events.js.
    `SELECT id, creation_time, operation, user_upn, user_id, target_resource
       FROM ual_events
      WHERE tenant_id = ?
        AND operation IN (${placeholders})
        AND creation_time > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      ORDER BY creation_time DESC
      LIMIT 50`,
    [tenant.id, ...interestingOps, days]
  );
  if (recent.length === 0) {
    console.log(`  (none — Microsoft hasn't sent these events to UAL yet, OR the operations were against a workload we don't subscribe to, OR the subscription is in error state — see top of report)`);
  } else {
    for (const e of recent) {
      const who = e.user_upn || e.user_id || '?';
      let target = '';
      if (e.target_resource) {
        // mysql2 auto-parses JSON columns to objects; primitive reads still come as strings sometimes.
        const tr = typeof e.target_resource === 'string'
          ? (() => { try { return JSON.parse(e.target_resource); } catch { return null; } })()
          : e.target_resource;
        target = tr?.name || tr?.id || '';
      }
      console.log(`  #${e.id}  ${e.creation_time}  ${e.operation.padEnd(35)} by=${who}  target=${String(target).slice(0, 80)}`);
    }
  }
  console.log('═══════════════════════════════════════════════════════════════════');

  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
