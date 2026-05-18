#!/usr/bin/env node
/**
 * Reset consecutive_failures on ual_subscriptions so the worker resumes
 * pulling immediately instead of waiting out FAILURE_BACKOFF_HOURS.
 *
 * Usage:
 *   node scripts/reset-ual-subscription-failures.js              # all tenants, all content types
 *   node scripts/reset-ual-subscription-failures.js Dienamex     # one tenant
 *   node scripts/reset-ual-subscription-failures.js Dienamex Audit.Exchange   # one tenant + one content type
 *
 * Run this AFTER deploying a fix that addresses whatever caused the
 * failures, so the next worker cycle picks up the work without an hour
 * of dead air.
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const args = process.argv.slice(2);
  const tenantFilter = args[0] || null;
  const contentTypeFilter = args[1] || null;
  const db = require('../src/db/database');

  let sql = `
    UPDATE ual_subscriptions us
       JOIN tenants t ON t.id = us.tenant_id
       SET us.consecutive_failures = 0,
           us.last_error = NULL,
           us.last_error_at = NULL
     WHERE us.consecutive_failures > 0
  `;
  const params = [];
  if (tenantFilter) {
    sql += ` AND t.display_name LIKE ?`;
    params.push(`%${tenantFilter}%`);
  }
  if (contentTypeFilter) {
    sql += ` AND us.content_type = ?`;
    params.push(contentTypeFilter);
  }

  const affectedRows = await db.execute(sql, params);
  console.log(`Reset ${affectedRows} subscription(s).`);
  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
