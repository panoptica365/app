#!/usr/bin/env node
/**
 * Backfill Haiku AI analysis + email notification on an existing alert.
 *
 * Usage:
 *   node scripts/backfill-alert-ai.js <alert_id>
 *   node scripts/backfill-alert-ai.js <alert_id> --no-email
 *
 * Loads the alert + its tenant, runs alertEngine.processNewAlert which
 * does AI analysis + email + AI-driven severity adjustment. Same code
 * path that fresh alerts will now run; this script just retro-fires it
 * on rows that were inserted before the May 12 fix.
 *
 * Written May 12, 2026 for the Dienamex Bundle F first-fire alert that
 * inserted without Haiku/email coverage (UAL evaluators skipped the
 * post-create pipeline entirely until now).
 */

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const args = process.argv.slice(2);
  const skipEmail = args.includes('--no-email');
  const idStr = args.filter((a) => !a.startsWith('--'))[0];
  const alertId = parseInt(idStr, 10);
  if (!alertId || alertId < 1) {
    console.error('Usage: node scripts/backfill-alert-ai.js <alert_id> [--no-email]');
    process.exit(1);
  }

  let db, alertEngine, notifierModule;
  try {
    db = require('../src/db/database');
    alertEngine = require('../src/alert-engine');
    notifierModule = require('../src/notifier');
  } catch (err) {
    console.error('Failed to load Panoptica modules:', err.message);
    process.exit(1);
  }

  // Load the alert + tenant row in one shot. Pull all the columns
  // processNewAlert / analyzeAlert / notifier care about so the in-memory
  // object matches the shape evaluator-time alerts have.
  const alert = await db.queryOne(
    `SELECT a.id, a.tenant_id, a.policy_id, a.severity, a.message, a.raw_data,
            a.status, a.dedup_key, a.triggered_at,
            a.ai_analysis_en, a.ai_analysis_fr, a.ai_analysis_es,
            a.rule_severity, a.recurrence_count,
            ap.name AS policy_name, ap.category, ap.notification_target, ap.notification_limit
       FROM alerts a
       JOIN alert_policies ap ON ap.id = a.policy_id
      WHERE a.id = ? LIMIT 1`,
    [alertId]
  );
  if (!alert) {
    console.error(`Alert ${alertId} not found.`);
    process.exit(1);
  }
  const tenant = await db.queryOne(
    // Include psa_name + language so the notifier's PSA attribution tag
    // and per-recipient locale routing both work. Missing psa_name was
    // the May 13 bug — Bundle F's first real alert opened a Trilogiam
    // ticket because the //<PSA_NAME>// marker in the email body was empty.
    `SELECT id, tenant_id, display_name, psa_name, language, mode
       FROM tenants WHERE id = ? LIMIT 1`,
    [alert.tenant_id]
  );
  if (!tenant) {
    console.error(`Tenant ${alert.tenant_id} not found.`);
    process.exit(1);
  }

  // mysql2 returns JSON columns already-parsed for objects, but if the
  // column is a JSON-encoded string it comes back as a string. Normalize.
  if (typeof alert.raw_data === 'string') {
    try { alert.raw_data = JSON.parse(alert.raw_data); } catch { /* keep string */ }
  }

  // Title-cleanup migration: old UAL alerts stored
  // message_template_params.policyName = "UAL: <human name>", so the
  // rendered title leaks the internal "UAL:" namespace. New evaluators
  // use policyNameKey + policyNameFallback so the renderer translates
  // via alert_policy_names.<slug> and drops the prefix. Migrate the
  // existing alert in-place if it matches the old shape.
  const params = alert.raw_data?.message_template_params;
  if (params && typeof params === 'object' && typeof params.policyName === 'string' && params.policyName.startsWith('UAL: ')) {
    const cleaned = params.policyName.substring('UAL: '.length);
    // Slug rule mirrors PanopticaI18n.slugify on the frontend: lowercase,
    // non-alphanumeric → '_'. e.g. "Microsoft Defender incident" → "microsoft_defender_incident".
    // The policy_names namespace prefixes ual_ for UAL-family entries
    // because en.json keys them like `ual_microsoft_defender_incident`.
    const slug = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    params.policyNameKey = `alert_policy_names.ual_${slug}`;
    params.policyNameFallback = cleaned;
    delete params.policyName;
    await db.execute(
      `UPDATE alerts SET raw_data = ? WHERE id = ?`,
      [JSON.stringify(alert.raw_data), alert.id]
    );
    console.log(`  title migrated: "${params.policyNameFallback}" via ${params.policyNameKey}`);
  }

  console.log(`Alert ${alert.id} — ${alert.policy_name} — ${tenant.display_name}`);
  console.log(`  current severity: ${alert.severity}`);
  console.log(`  current ai_analysis_en: ${alert.ai_analysis_en ? `(${alert.ai_analysis_en.length} chars)` : 'NULL'}`);

  if (skipEmail) {
    // Monkey-patch the notifier so the backfill never sends email.
    const original = notifierModule.sendAlertNotification;
    notifierModule.sendAlertNotification = async () => {
      console.log('  [--no-email] notifier suppressed');
    };
    process.on('exit', () => { notifierModule.sendAlertNotification = original; });
  }

  // Mimic the shape createOrUpdateAlert returns so processNewAlert behaves
  // identically to a fresh insert path.
  alert.isNew = true;
  alert.isAutoResolved = false;
  alert.notification_target = alert.notification_target;
  alert.notification_limit = alert.notification_limit;

  try {
    await alertEngine.processNewAlert(alert, tenant);
    console.log(`  done — severity now: ${alert.severity}`);
    console.log(`  ai_analysis_en now: ${alert.ai_analysis_en ? `(${alert.ai_analysis_en.length} chars)` : 'NULL'}`);
  } catch (err) {
    console.error(`  processNewAlert FAILED: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }

  await db.close().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
