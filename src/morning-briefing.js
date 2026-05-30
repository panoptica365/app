/**
 * Panoptica — Morning Briefing (Phase 4)
 * Daily 6 AM email powered by Claude Haiku.
 * Aggregates last 24h of alerts + tenant status into a concise summary.
 * Also serves as system heartbeat — if the email doesn't arrive, something's broken.
 */

const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const config = require('../config/default');
const db = require('./db/database');

let client = null;
let transporter = null;
let cronJob = null;
let lastBriefing = null; // Cache for dashboard widget
let systemHealthPolicyId = null; // For self-alerting on failures

// Severity rank — used to filter alerts at briefing assembly time so noisy
// info/low events (e.g. spam-quarantine notices) don't pad the operator's
// 6 AM email. Operator-tunable via Settings → Daily Summary; default 'info'
// preserves prior behavior of including everything. See gatherBriefingData().
const SEVERITY_RANK = { info: 1, low: 2, medium: 3, high: 4, severe: 5 };
function getMinSeverityRank() {
  const name = (config.briefing.minSeverity || 'info').toLowerCase();
  return SEVERITY_RANK[name] || 1;
}

/**
 * Ensure a system health alert policy exists (for internal Panoptica failures).
 */
async function ensureSystemHealthPolicy() {
  try {
    const existing = await db.queryOne(
      "SELECT id FROM alert_policies WHERE name = 'Panoptica System Health' LIMIT 1"
    );
    if (existing) {
      systemHealthPolicyId = existing.id;
    } else {
      systemHealthPolicyId = await db.insert(
        `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
         VALUES ('Panoptica System Health', 'Internal system failures (briefing delivery, SMTP errors, etc.)', 'config_changes', 'high', '{"type":"system_health"}', 'critical', TRUE, 'both')`
      );
      console.log('[Briefing] Created alert policy: Panoptica System Health');
    }
  } catch (err) {
    console.error('[Briefing] Failed to ensure system health policy:', err.message);
  }
}

/**
 * Create an internal alert when something critical fails (e.g., briefing email).
 */
async function createSystemAlert(message) {
  if (!systemHealthPolicyId) return;
  try {
    // May 20, 2026 — MSP-agnostic tenant lookup. Three-layer fallback:
    //   1. If MSP_TENANT_GUID env var is set, look up by that Azure GUID
    //      (the canonical, MSP-agnostic approach for any deployment).
    //   2. Otherwise, fall back to the legacy LIKE-based lookup for the
    //      string "trilogiam" (preserves existing behavior on the original
    //      install where MSP_TENANT_GUID was never set).
    //   3. Last-resort: tenant_id=1 (whatever was first onboarded).
    // Each layer's failure cascades to the next. Worst case we land on
    // tenant_id=1, which has been the safety net since the briefing
    // feature shipped.
    let mspTenant = null;
    const mspTenantGuid = (process.env.MSP_TENANT_GUID || '').trim();
    if (mspTenantGuid) {
      mspTenant = await db.queryOne(
        'SELECT id FROM tenants WHERE tenant_id = ? LIMIT 1',
        [mspTenantGuid]
      );
    }
    if (!mspTenant) {
      mspTenant = await db.queryOne(
        "SELECT id FROM tenants WHERE display_name LIKE '%trilogiam%' OR display_name LIKE '%Trilogiam%' LIMIT 1"
      );
    }
    const tenantId = mspTenant ? mspTenant.id : 1;

    const dedupKey = `system_health_briefing_email`;
    const existing = await db.queryOne(
      `SELECT id, recurrence_count FROM alerts
       WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new', 'investigating') LIMIT 1`,
      [tenantId, dedupKey]
    );

    if (existing) {
      await db.execute(
        'UPDATE alerts SET recurrence_count = ?, last_seen_at = NOW(), message = ? WHERE id = ?',
        [(existing.recurrence_count || 1) + 1, message, existing.id]
      );
      console.log(`[Briefing] System alert ${existing.id} updated (recurrence: ${(existing.recurrence_count || 1) + 1})`);
    } else {
      const id = await db.insert(
        `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key, recurrence_count, last_seen_at, triggered_at)
         VALUES (?, ?, 'high', ?, ?, ?, 1, NOW(), NOW())`,
        [tenantId, systemHealthPolicyId, message, JSON.stringify({ type: 'briefing_email_failure' }), dedupKey]
      );
      console.log(`[Briefing] Created system alert ${id}: ${message}`);
    }
  } catch (err) {
    console.error('[Briefing] Failed to create system alert:', err.message);
  }
}

function getClient() {
  if (!client && config.ai.apiKey) {
    client = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return client;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      },
    });
  }
  return transporter;
}

/**
 * Start the morning briefing cron job.
 */
function start() {
  if (!config.briefing.enabled) {
    console.log('[Briefing] Disabled in config');
    return;
  }

  // Ensure system health alert policy exists (for self-alerting on failures)
  ensureSystemHealthPolicy().catch(err =>
    console.error('[Briefing] System health policy setup failed:', err.message)
  );

  cronJob = cron.schedule(config.briefing.cronSchedule, async () => {
    console.log('[Briefing] Generating morning briefing...');
    try {
      await generateAndSend();
    } catch (err) {
      console.error('[Briefing] Failed:', err.message);
    }
  }, {
    timezone: config.briefing.timezone,
  });

  console.log(`[Briefing] Scheduled: ${config.briefing.cronSchedule} (${config.briefing.timezone})`);
}

function stop() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

/**
 * Generate the morning briefing and send it via email.
 * Also caches the result for the dashboard widget.
 */
async function generateAndSend() {
  const briefingData = await gatherBriefingData();
  const localizedSummary = await generateSummary(briefingData);   // { en, fr, es }

  // Cache for dashboard. `summary` stays the field name for backward compat
  // with consumers that historically read a string; we now expose the locale
  // map via `summaryByLocale` and keep `summary` set to English for any
  // legacy callers that haven't been updated.
  lastBriefing = {
    generatedAt: new Date().toISOString(),
    summary: localizedSummary.en,
    summaryByLocale: localizedSummary,
    data: briefingData,
  };

  // Store in DB for historical reference (all three locales).
  await storeBriefing(lastBriefing);

  // Send email — per-recipient language routing is internal to sendBriefingEmail.
  await sendBriefingEmail(localizedSummary, briefingData);

  console.log('[Briefing] Morning briefing complete');
  return lastBriefing;
}

/**
 * Gather all data needed for the briefing.
 */
async function gatherBriefingData() {
  // Get all active managed tenants. Audit-only tenants are excluded from the
  // morning briefing — they don't generate alerts (no drift, no notifier),
  // and they're meant to be invisible to the operator's daily workflow until
  // the snapshot export is pulled or the auto-expiry fires.
  const tenants = await db.queryRows(
    `SELECT id, tenant_id, display_name, enabled, last_polled_at, poll_count
     FROM tenants WHERE enabled = TRUE AND mode = 'managed' ORDER BY display_name`
  );

  // Get alerts from last 24 hours. We pull EVERYTHING in window, then
  // partition in-process into "surfaced" (goes to the briefing) and
  // "suppressed" (counted in the filter-summary footer but not in the body).
  // resolution_reason is selected so we can identify alerts auto-resolved by
  // an alert-exemption rule (src/lib/alert-exemption-matcher.js writes
  // resolution_reason='exemption_rule' at alert-insert time).
  const allAlerts = await db.queryRows(
    `SELECT a.id, a.tenant_id, a.severity, a.message, ap.category, a.status,
            a.ai_analysis_en AS ai_analysis, a.triggered_at, a.policy_id, a.recurrence_count,
            a.resolution_reason, a.alert_scope, t.display_name AS tenant_name
     FROM alerts a
     JOIN tenants t ON a.tenant_id = t.id
     LEFT JOIN alert_policies ap ON a.policy_id = ap.id
     WHERE a.triggered_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND a.status <> 'false_positive'
     ORDER BY a.triggered_at DESC`
  );

  // Partition: exemption-resolved alerts and below-threshold alerts are
  // suppressed from the briefing body. Their counts surface in the email
  // footer so the operator can see the filter isn't silently swallowing
  // anything. Footer-only is the right place: the AI summary stays clean,
  // and operator audit trail is preserved (the alerts still exist in the
  // alerts table and are visible in the dashboard).
  const minRank = getMinSeverityRank();
  const minSeverityName = (config.briefing.minSeverity || 'info').toLowerCase();
  const alerts = [];
  const suppressedByExemptionTenants = new Map(); // tenant_id → {name, count}
  let suppressedBySeverity = 0;
  let suppressedByExemption = 0;

  for (const a of allAlerts) {
    // 1) Exemption-rule auto-resolved → never surface in the briefing.
    //    Today's noise example: comptabilite@cuisi-n-art.com lockouts and
    //    Tatum non-compliant-device US sign-ins both have active alert-
    //    exemption rules per operator decision (screenshots May 13, 2026).
    if (a.resolution_reason === 'exemption_rule') {
      suppressedByExemption++;
      const key = a.tenant_id;
      if (!suppressedByExemptionTenants.has(key)) {
        suppressedByExemptionTenants.set(key, { tenantName: a.tenant_name, count: 0 });
      }
      suppressedByExemptionTenants.get(key).count++;
      continue;
    }

    // 2) Below operator-selected severity threshold → suppress from body,
    //    surface count in footer. Default threshold 'info' means rank=1
    //    which lets everything through.
    const rank = SEVERITY_RANK[a.severity] || 0;
    if (rank < minRank) {
      suppressedBySeverity++;
      continue;
    }

    alerts.push(a);
  }

  // Get tenants with polling errors (last_polled_at older than 2x their interval).
  // Audit-only tenants are EXCLUDED — they poll once on add and only on operator-
  // manual refresh after that, so their last_polled_at going stale is by design,
  // not a polling issue. Same false-positive pattern that hit System Health and
  // the operator's morning briefing on 2026-05-02.
  const staleThresholdMinutes = 60; // If not polled in 60 min, flag it
  const staleTenants = await db.queryRows(
    `SELECT id, display_name, last_polled_at, polling_interval
     FROM tenants
     WHERE enabled = TRUE
       AND mode = 'managed'
       AND last_polled_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [staleThresholdMinutes]
  );

  // Group alerts by tenant. Feature 8.8 — MSP-level alerts (Message Center)
  // carry alert_scope='msp' and must NOT be attributed to their source
  // tenant; they're bucketed under a single MSP-wide group so the briefing
  // reads as an MSP-wide notice, not as a finding against the source customer.
  const alertsByTenant = {};
  for (const a of alerts) {
    const isMsp = a.alert_scope === 'msp';
    const key = isMsp ? 'msp' : a.tenant_id;
    if (!alertsByTenant[key]) {
      alertsByTenant[key] = {
        tenantName: isMsp ? 'Microsoft Message Center (MSP-wide)' : a.tenant_name,
        alerts: [],
      };
    }
    alertsByTenant[key].alerts.push(a);
  }

  // Severity counts
  const severityCounts = { severe: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const a of alerts) {
    if (severityCounts[a.severity] !== undefined) {
      severityCounts[a.severity]++;
    }
  }

  // Tenant list for footer message ("...across 3 tenants (Cuisi-N-Art, Tatum, Calogy)")
  const exemptionTenantNames = Array.from(suppressedByExemptionTenants.values())
    .map(v => v.tenantName)
    .sort();

  return {
    tenants,
    alerts,
    alertsByTenant,
    severityCounts,
    staleTenants,
    totalAlerts: alerts.length,
    tenantsWithAlerts: Object.keys(alertsByTenant).length,
    quietTenants: tenants.length - Object.keys(alertsByTenant).length,
    // Filter summary — surfaced in the email footer and noted to Haiku.
    filter: {
      minSeverity: minSeverityName,
      suppressedBySeverity,
      suppressedByExemption,
      suppressedByExemptionTenantCount: suppressedByExemptionTenants.size,
      suppressedByExemptionTenantNames: exemptionTenantNames,
      totalIngested: allAlerts.length,
    },
  };
}

/**
 * Generate the AI summary using Claude Haiku in three locales.
 *
 * Phase 8 (May 2, 2026) — returns `{ en, fr, es }` instead of a single string.
 * Haiku is instructed to output structured JSON via buildBriefingPrompt; we
 * parse that JSON and validate all three locales are present. On any failure
 * (API error, malformed JSON, missing locale) we fall back to a synthesized
 * English summary mirrored to fr/es as English — better to send English to
 * everyone than fail to send.
 */
async function generateSummary(data) {
  const anthropic = getClient();
  if (!anthropic) {
    return buildFallbackSummaryAllLocales(data);
  }

  const prompt = buildBriefingPrompt(data);

  try {
    // Phase 8 (May 2, 2026): output is 3 locales of briefing in one JSON,
    // roughly 3x the single-locale token cost. Override the global maxTokens
    // (2048 by default — fine for per-alert analysis but truncates 3-locale
    // briefings) with a generous 6144 limit. Anthropic only charges for
    // actual output, so a higher cap costs nothing if unused.
    const response = await anthropic.messages.create({
      model: config.ai.haikuModel,
      max_tokens: Math.max(config.ai.maxTokens || 0, 6144),
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content?.[0]?.text || '';
    // Token logging for cost visibility (Phase 8 — Jacques wanted to watch
    // the trend; 3-locale output ~3x token cost vs single-locale).
    if (response.usage) {
      console.log(
        `[Briefing] Haiku tokens — input=${response.usage.input_tokens || 0} ` +
        `output=${response.usage.output_tokens || 0} (3-locale)`
      );
    }
    const parsed = parseLocalizedSummary(raw);
    if (parsed) return parsed;
    console.warn('[Briefing] Haiku JSON parse failed — falling back to English-only across all 3 locales');
    return buildFallbackSummaryAllLocales(data);
  } catch (err) {
    console.error('[Briefing] Haiku failed, using fallback:', err.message);
    return buildFallbackSummaryAllLocales(data);
  }
}

/**
 * Parse Haiku's JSON output. Must contain non-empty en, fr, es strings.
 * Tolerant of leading whitespace or stray markdown fences (Haiku occasionally
 * wraps with ```json … ``` despite the prompt asking it not to).
 */
function parseLocalizedSummary(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Strip markdown fences if Haiku ignored the no-fence instruction.
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.en === 'string' && obj.en.length > 0
        && typeof obj.fr === 'string' && obj.fr.length > 0
        && typeof obj.es === 'string' && obj.es.length > 0) {
      return { en: obj.en, fr: obj.fr, es: obj.es };
    }
  } catch (e) {
    console.warn('[Briefing] parseLocalizedSummary: JSON.parse failed:', e.message);
  }
  return null;
}

/**
 * Build the prompt for Haiku to generate the morning briefing.
 */
function buildBriefingPrompt(data) {
  const now = new Date().toLocaleString('en-CA', { timeZone: config.briefing.timezone });

  // Build per-tenant alert summaries — only for tenants with activity
  let tenantDetails = '';
  for (const [tenantDbId, info] of Object.entries(data.alertsByTenant)) {
    const alertLines = info.alerts.map(a => {
      const aiSummary = a.ai_analysis
        ? ` — AI: ${a.ai_analysis.substring(0, 200)}`
        : '';
      return `  - [${a.severity.toUpperCase()}] ${a.message} (${a.status})${aiSummary}`;
    }).join('\n');

    tenantDetails += `\nTENANT: ${info.tenantName} (${info.alerts.length} alert${info.alerts.length !== 1 ? 's' : ''})\n${alertLines}\n`;
  }

  // System health
  let healthNotes = '';
  if (data.staleTenants.length > 0) {
    healthNotes = '\nSYSTEM HEALTH ISSUES:\n' +
      data.staleTenants.map(t =>
        `- ${t.display_name}: Last polled ${t.last_polled_at || 'NEVER'} (interval: ${t.polling_interval} min)`
      ).join('\n');
  }

  const tenantsHaveAlerts = data.tenantsWithAlerts > 0;

  // Pre-filter note for Haiku — see gatherBriefingData() partition logic.
  // The operator has explicitly elected to silence (a) alerts auto-resolved
  // by exemption rules and (b) alerts below a chosen severity threshold.
  // Telling Haiku makes it stop "completing" the data with phrases like
  // "additionally, several low-severity events were logged" — those are
  // exactly the events the operator asked us NOT to mention.
  const f = data.filter || {};
  const filterNote = (f.suppressedByExemption > 0 || f.suppressedBySeverity > 0)
    ? `\nPRE-FILTER NOTE (do not mention these counts in your output):
- ${f.suppressedByExemption} alert(s) auto-resolved by operator-defined exemption rules — EXCLUDED.
- ${f.suppressedBySeverity} alert(s) below the operator-selected '${f.minSeverity}' severity threshold — EXCLUDED.
These events are NOT in the data below. Do not speculate about them, allude to them, or hedge ("aside from minor events…"). Focus only on the alerts shown.`
    : '';

  return `You are the AI analyst for Panoptica365, an MSP's Microsoft 365 monitoring platform managing ${data.tenants.length} tenants.
Generate a concise morning briefing for ${now}.

OVERNIGHT SUMMARY (last 24 hours, post-filter):
- Total alerts surfaced: ${data.totalAlerts}
- Severity breakdown: Severe=${data.severityCounts.severe}, High=${data.severityCounts.high}, Medium=${data.severityCounts.medium}, Low=${data.severityCounts.low}, Info=${data.severityCounts.info}
- Tenants with alerts: ${data.tenantsWithAlerts} of ${data.tenants.length}
- Quiet tenants (no alerts surfaced): ${data.quietTenants}
${filterNote}
${healthNotes}
${tenantDetails || '\nNo alerts in the last 24 hours match the operator\'s briefing criteria. All tenants are quiet at the configured threshold.'}

Write the SAME briefing in three languages: English, Quebec French (fr-CA), and neutral Spanish (es).
The briefing follows this section structure in each language:

EXECUTIVE SUMMARY (or "RÉSUMÉ EXÉCUTIF" / "RESUMEN EJECUTIVO"):
2-3 sentences covering the overall state. Be specific about what happened. If everything is quiet, say so clearly. If there are issues, prioritize by severity.

${tenantsHaveAlerts ? `TENANTS REQUIRING ATTENTION (or "LOCATAIRES NÉCESSITANT DE L'ATTENTION" / "INQUILINOS QUE REQUIEREN ATENCIÓN"):
For each tenant with alerts, provide 1-2 sentences explaining what happened. Mention what (if anything) needs operator verification or action — but state it as part of the sentence, not as a trailing disclaimer. Group related alerts. Reference the AI analysis where available.

This section is read the next day by both the on-call operator (who may have already cleared the alerts overnight) and by supervisors / managers (who will not have seen them). Surface routine but noteworthy events for visibility — auto-resolved Defender incidents, OAuth admin consents, external-user invitations, password resets — but describe them plainly. The reader judges whether action is needed; the briefing reports what happened.

` : ''}SYSTEM STATUS (or "ÉTAT DU SYSTÈME" / "ESTADO DEL SISTEMA"):
1-2 sentences about polling health, any stale tenants, and overall system operation. This serves as a heartbeat confirmation.

OUTPUT REQUIREMENTS — read carefully:
- Output ONLY valid JSON, no preamble, no Markdown fences, no commentary.
- The JSON has exactly three top-level string keys: "en", "fr", "es".
- Each value is the COMPLETE briefing text in that language, including all section headers (translated naturally per language).
- Do NOT cross-reference languages or say "in English" / "en français". Each value is a standalone briefing.
- Tenant names, email addresses, technical identifiers, and proper nouns (SharePoint, OneDrive, Conditional Access, etc.) stay as-is in all three languages.
- Quebec French uses « » guillemets for quoted text. Spanish is neutral (not regional).
- Keep it professional, concise, and actionable. No fluff. If everything is running fine, don't pad the briefing — just confirm it.
- DO NOT append parenthetical disclaimers like "(no action required)", "(filtering is functioning as designed)", "(low risk, resolved)", or "(routine)". They contradict the section header and add nothing. If something is genuinely informational, describe what happened plainly and stop. If an event truly does not warrant inclusion at all, omit it — but the operator-selected severity threshold has already filtered the data you receive, so most of what's left is worth a mention.
- DO NOT add "no action required" or equivalent trailing phrases anywhere. The absence of an action request implies it. Adding the disclaimer makes the section feel padded and undermines the items that DO need attention.

Example output shape:
{"en":"EXECUTIVE SUMMARY:\\n...\\n\\nSYSTEM STATUS:\\n...","fr":"RÉSUMÉ EXÉCUTIF :\\n...\\n\\nÉTAT DU SYSTÈME :\\n...","es":"RESUMEN EJECUTIVO:\\n...\\n\\nESTADO DEL SISTEMA:\\n..."}`;
}

/**
 * Fallback summary across all three locales when Haiku is unavailable.
 * Returns English text in all three slots — better to send English to French
 * and Spanish recipients than to fail to send. Logged warning above tells
 * operator to investigate the upstream API failure.
 */
function buildFallbackSummaryAllLocales(data) {
  const en = buildFallbackSummary(data);
  return { en, fr: en, es: en };
}

/**
 * English-only fallback summary if Haiku is unavailable.
 */
function buildFallbackSummary(data) {
  const lines = [];
  lines.push('EXECUTIVE SUMMARY:');

  if (data.totalAlerts === 0) {
    lines.push(`All ${data.tenants.length} tenants are quiet. No alerts in the last 24 hours.`);
  } else {
    lines.push(`${data.totalAlerts} alert(s) across ${data.tenantsWithAlerts} tenant(s) in the last 24 hours.`);
    if (data.severityCounts.severe > 0 || data.severityCounts.high > 0) {
      lines.push(`Attention needed: ${data.severityCounts.severe} severe, ${data.severityCounts.high} high severity.`);
    }
  }

  if (data.tenantsWithAlerts > 0) {
    lines.push('');
    lines.push('TENANTS REQUIRING ATTENTION:');
    for (const [, info] of Object.entries(data.alertsByTenant)) {
      const counts = {};
      for (const a of info.alerts) {
        counts[a.severity] = (counts[a.severity] || 0) + 1;
      }
      const countStr = Object.entries(counts).map(([s, c]) => `${c} ${s}`).join(', ');
      lines.push(`${info.tenantName}: ${info.alerts.length} alert(s) (${countStr})`);
    }
  }

  lines.push('');
  lines.push('SYSTEM STATUS:');
  if (data.staleTenants.length > 0) {
    lines.push(`WARNING: ${data.staleTenants.length} tenant(s) have stale polling data.`);
  } else {
    lines.push('All tenants polling normally. System operational.');
  }

  return lines.join('\n');
}

/**
 * Store the briefing in the database for historical reference.
 */
async function storeBriefing(briefing) {
  try {
    // Auto-create / migrate table if needed
    await ensureBriefingTable();

    const loc = briefing.summaryByLocale || { en: briefing.summary, fr: null, es: null };
    await db.insert(
      `INSERT INTO morning_briefings (summary_en, summary_fr, summary_es, data_snapshot, generated_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [loc.en, loc.fr, loc.es, JSON.stringify(briefing.data)]
    );
  } catch (err) {
    console.error('[Briefing] Failed to store briefing:', err.message);
  }
}

/**
 * Ensure the morning_briefings table exists.
 */
async function ensureBriefingTable() {
  try {
    const tables = await db.queryRows(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'morning_briefings'"
    );
    if (tables.length === 0) {
      // Phase 8 (May 2, 2026) — multi-locale schema. The original column
      // `summary` becomes `summary_en` (English baseline). New columns
      // `summary_fr` and `summary_es` hold Quebec French and neutral
      // Spanish renditions, populated by the same Haiku call via structured
      // JSON output. NULLABLE so old rows or partial generations don't fail.
      await db.execute(`
        CREATE TABLE morning_briefings (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          summary_en TEXT NOT NULL,
          summary_fr TEXT NULL,
          summary_es TEXT NULL,
          data_snapshot JSON,
          generated_at DATETIME NOT NULL,
          INDEX idx_generated (generated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[Briefing] Created morning_briefings table (multi-locale)');
      return;
    }

    // Idempotent migration: if the legacy `summary` column exists, rename it
    // to `summary_en` and add the fr/es siblings. Safe to run on every boot.
    const cols = await db.queryRows(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'morning_briefings'`
    );
    const colNames = new Set(cols.map(c => c.COLUMN_NAME));

    if (colNames.has('summary') && !colNames.has('summary_en')) {
      console.log('[Briefing] Migrating summary → summary_en');
      await db.execute(`ALTER TABLE morning_briefings CHANGE summary summary_en TEXT NOT NULL`);
    }
    if (!colNames.has('summary_fr')) {
      console.log('[Briefing] Adding summary_fr column');
      await db.execute(`ALTER TABLE morning_briefings ADD COLUMN summary_fr TEXT NULL AFTER summary_en`);
    }
    if (!colNames.has('summary_es')) {
      console.log('[Briefing] Adding summary_es column');
      await db.execute(`ALTER TABLE morning_briefings ADD COLUMN summary_es TEXT NULL AFTER summary_fr`);
    }
  } catch (err) {
    // Table might already exist — ignore
    if (!err.message.includes('already exists')) {
      console.error('[Briefing] ensureBriefingTable error:', err.message);
    }
  }
}

/**
 * Build and send the briefing email — per-recipient language routing.
 *
 * Phase 8 (May 2, 2026): instead of one sendMail() to a comma-separated list,
 * this iterates the recipient list, looks up each recipient in the `users`
 * table by email (case-insensitive), and sends a personalized email in that
 * operator's preferred language. Recipients whose email isn't in the users
 * table — or whose `language` is NULL — get English by default.
 *
 * Each recipient = one sendMail call. SMTP retries apply per-recipient.
 *
 * @param localizedSummary { en, fr, es } — already-translated bodies from Haiku
 * @param data — gathered briefing data (counts, severities, stale tenants)
 */
async function sendBriefingEmail(localizedSummary, data) {
  if (!config.smtp.auth.user) {
    console.warn('[Briefing] No SMTP credentials configured — skipping email');
    return;
  }

  // Resolve recipient list. If empty, fall back to the from address (operator
  // dev/test scenarios) — same behavior as before, just one recipient.
  const notifyEmails = (config.notification?.notifyEmails || '')
    .split(',').map(e => e.trim()).filter(Boolean);
  const recipients = notifyEmails.length > 0 ? notifyEmails : [config.smtp.from];

  // Look up language preferences in one query, then map by lowercased email.
  // Recipients NOT in users table or with NULL language fall back to 'en'.
  let recipientLangs = new Map();
  try {
    const lower = recipients.map(e => e.toLowerCase());
    if (lower.length > 0) {
      const placeholders = lower.map(() => '?').join(',');
      const rows = await db.queryRows(
        `SELECT LOWER(email) AS email, language FROM users WHERE LOWER(email) IN (${placeholders})`,
        lower
      );
      for (const row of rows) {
        if (row.email && row.language && ['en', 'fr', 'es'].includes(row.language)) {
          recipientLangs.set(row.email, row.language);
        }
      }
    }
  } catch (err) {
    console.warn('[Briefing] users table lookup failed; defaulting all recipients to English:', err.message);
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5 * 60 * 1000;

  for (const recipient of recipients) {
    const lang = recipientLangs.get(recipient.toLowerCase()) || 'en';
    const summary = localizedSummary[lang] || localizedSummary.en;

    // Localized date string per recipient.
    const dateLocale = lang === 'fr' ? 'fr-CA' : (lang === 'es' ? 'es' : 'en-CA');
    const dateStr = new Date().toLocaleDateString(dateLocale, {
      timeZone: config.briefing.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subject = buildBriefingSubject(data, dateStr, lang);
    const html = buildBriefingEmailHtml(summary, data, dateStr, lang);

    let delivered = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          transporter = null; // Clear stale SMTP connection
        }
        const t = getTransporter();
        await t.sendMail({
          from: config.smtp.from,
          to: recipient,
          subject,
          html,
        });
        console.log(`[Briefing] Email sent to ${recipient} (${lang}, attempt ${attempt}/${MAX_RETRIES})`);
        delivered = true;
        break;
      } catch (err) {
        console.error(`[Briefing] Email send to ${recipient} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          console.log(`[Briefing] Retrying ${recipient} in ${RETRY_DELAY_MS / 60000} minutes...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    if (!delivered) {
      console.error(`[Briefing] *** ALL RETRY ATTEMPTS EXHAUSTED for ${recipient} ***`);
      await createSystemAlert(`Daily summary email failed after 3 attempts to ${recipient} — SMTP unreachable`);
    }
  }
}

/**
 * Build the subject line in the recipient's locale.
 * en: Panoptica365 Daily Summary — {date} — {N} alert(s) | All Clear
 * fr: Résumé quotidien Panoptica365 — {date} — {N} alerte(s) | Tout est calme
 * es: Resumen diario Panoptica365 — {date} — {N} alerta(s) | Todo en orden
 */
function buildBriefingSubject(data, dateStr, lang) {
  const n = data.totalAlerts || 0;
  if (lang === 'fr') {
    return n === 0
      ? `Résumé quotidien Panoptica365 — ${dateStr} — Tout est calme`
      : `Résumé quotidien Panoptica365 — ${dateStr} — ${n} alerte(s)`;
  }
  if (lang === 'es') {
    return n === 0
      ? `Resumen diario Panoptica365 — ${dateStr} — Todo en orden`
      : `Resumen diario Panoptica365 — ${dateStr} — ${n} alerta(s)`;
  }
  return n === 0
    ? `Panoptica365 Daily Summary — ${dateStr} — All Clear`
    : `Panoptica365 Daily Summary — ${dateStr} — ${n} alert(s)`;
}

/**
 * Build the HTML email body for the briefing in the given locale.
 * Uses <br> tags, NOT white-space: pre-wrap (email clients ignore it).
 *
 * @param summary  AI-generated body text in the target locale
 * @param data     Briefing data (counts, severities, stale tenants)
 * @param dateStr  Formatted date string (already locale-localized by caller)
 * @param lang     'en' | 'fr' | 'es' — drives chrome label translation
 */
function buildBriefingEmailHtml(summary, data, dateStr, lang) {
  // Convert markdown to email-safe HTML (inline styles, no CSS classes)
  const formattedSummary = mdToEmailHtml(summary);
  const L = getEmailChromeLabels(lang || 'en');

  // Severity badge row
  const sc = data.severityCounts;
  const severityRow = `
    <div style="display:flex;gap:12px;margin:12px 0;flex-wrap:wrap">
      ${sc.severe > 0 ? `<span style="background:#e74c3c;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${sc.severe} ${escHtml(L.severe)}</span>` : ''}
      ${sc.high > 0 ? `<span style="background:#e67e22;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${sc.high} ${escHtml(L.high)}</span>` : ''}
      ${sc.medium > 0 ? `<span style="background:#f39c12;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${sc.medium} ${escHtml(L.medium)}</span>` : ''}
      ${sc.low > 0 ? `<span style="background:#3498db;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${sc.low} ${escHtml(L.low)}</span>` : ''}
      ${sc.info > 0 ? `<span style="background:#95a5a6;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${sc.info} ${escHtml(L.info)}</span>` : ''}
      ${data.totalAlerts === 0 ? `<span style="background:#27ae60;color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold">${escHtml(L.allClear)}</span>` : ''}
    </div>`;

  // Stale tenant warnings
  let staleWarning = '';
  if (data.staleTenants.length > 0) {
    const staleLines = data.staleTenants.map(t =>
      `<br>&#x26A0; ${escHtml(t.display_name)} — ${escHtml(L.lastPolled)} ${escHtml(t.last_polled_at || L.never)}`
    ).join('');
    staleWarning = `
      <div style="background:#3a1a1a;border:1px solid #cc4444;border-radius:6px;padding:12px;margin:12px 0">
        <strong style="color:#ff6666">${escHtml(L.pollingIssuesDetected)}</strong>${staleLines}
      </div>`;
  }

  const tenantCount = data.tenants.length;
  const alertCount = data.totalAlerts;
  const subline = L.subline
    .replace('{tenantCount}', tenantCount)
    .replace('{alertCount}', alertCount);

  // Filter summary panel — only rendered if anything was actually suppressed.
  // Two lines max, intentionally muted so it reads as system metadata rather
  // than competing with the AI body. Empty string when no suppression so the
  // common case stays clean.
  let filterSummary = '';
  const f = data.filter || {};
  if (f.suppressedByExemption > 0 || f.suppressedBySeverity > 0) {
    const lines = [];
    if (f.suppressedByExemption > 0) {
      const tenantList = (f.suppressedByExemptionTenantNames || []).join(', ');
      const line = L.suppressedByExemption
        .replace('{n}', f.suppressedByExemption)
        .replace('{m}', f.suppressedByExemptionTenantCount)
        .replace('{tenants}', escHtml(tenantList));
      lines.push(line);
    }
    if (f.suppressedBySeverity > 0) {
      // Localized severity name — e.g. "medium" → "moyenne" in fr
      const sevLabelKey = String(f.minSeverity || 'info').toLowerCase();
      const sevLabel = L[sevLabelKey] || f.minSeverity;
      const line = L.suppressedBySeverity
        .replace('{n}', f.suppressedBySeverity)
        .replace('{threshold}', escHtml(sevLabel));
      lines.push(line);
    }
    filterSummary = `
      <div style="background:#12122a;border:1px solid #334477;border-radius:6px;padding:12px 16px;margin:12px 0;font-size:12px;color:#9999cc">
        <div style="font-size:10px;color:#7777aa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${escHtml(L.filterSummaryLabel)}</div>
        ${lines.map(l => `<div style="margin:3px 0">${l}</div>`).join('')}
      </div>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:Segoe UI,Arial,sans-serif;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto">
    <!-- Header -->
    <div style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);border-radius:8px 8px 0 0;padding:20px;border-bottom:3px solid #9b59b6">
      <div style="font-size:11px;color:#9999cc;text-transform:uppercase;letter-spacing:2px">${escHtml(L.headerTitle)}</div>
      <div style="font-size:20px;font-weight:600;color:#fff;margin-top:8px">${escHtml(dateStr)}</div>
      <div style="font-size:13px;color:#9999cc;margin-top:4px">${escHtml(subline)}</div>
    </div>

    <!-- Severity Summary -->
    <div style="background:#12122a;padding:16px 20px;border:1px solid #334477;border-top:none">
      ${severityRow}
    </div>

    ${staleWarning}

    <!-- AI Briefing -->
    <div style="background:#1a1a2e;border:1px solid #334477;border-radius:6px;padding:20px;margin:12px 0">
      <div style="font-size:11px;color:#9b59b6;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${escHtml(L.aiAnalysisLabel)}</div>
      <div style="color:#e0e0e0;font-size:14px;line-height:1.7">${formattedSummary}</div>
    </div>

    ${filterSummary}

    <!-- Footer -->
    <div style="background:#1a1a2e;border-radius:0 0 8px 8px;padding:16px;border:1px solid #334477;text-align:center">
      ${config.baseUrl ? `<a href="${config.baseUrl}/?page=main-console" style="color:#4488ff;text-decoration:none;font-size:13px">${escHtml(L.openDashboard)}</a>` : ''}
      <div style="font-size:11px;color:#666;margin-top:8px">${escHtml(L.footer)}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Locale labels for the email HTML chrome. Inline rather than via i18n.t()
 * because morning-briefing.js may run before src/i18n.js is loaded in some
 * deployments (cron-only mode), and email chrome is small enough that this
 * is more legible than a JSON round-trip.
 */
function getEmailChromeLabels(lang) {
  const labels = {
    en: {
      headerTitle: 'Panoptica365 Daily Summary',
      subline: '{tenantCount} tenants monitored · {alertCount} alert(s) in last 24h',
      severe: 'Severe', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
      allClear: 'All Clear',
      pollingIssuesDetected: 'Polling Issues Detected',
      lastPolled: 'last polled',
      never: 'NEVER',
      aiAnalysisLabel: 'AI Analysis (Claude Haiku)',
      openDashboard: 'Open Panoptica365 Dashboard →',
      footer: 'Panoptica365 — Multi-Tenant M365 Monitoring · System heartbeat OK',
      filterSummaryLabel: 'Filter summary',
      suppressedByExemption: '<b>{n}</b> alert(s) auto-resolved by active exemption rule(s) across <b>{m}</b> tenant(s) ({tenants}). Visible in the dashboard, omitted from this email.',
      suppressedBySeverity: '<b>{n}</b> alert(s) below the <b>{threshold}</b> severity threshold. Visible in the dashboard, omitted from this email.',
    },
    fr: {
      headerTitle: 'Résumé quotidien Panoptica365',
      subline: '{tenantCount} locataires surveillés · {alertCount} alerte(s) dans les dernières 24 h',
      severe: 'Sévère', high: 'Élevée', medium: 'Moyenne', low: 'Faible', info: 'Info',
      allClear: 'Tout est calme',
      pollingIssuesDetected: 'Problèmes d’interrogation détectés',
      lastPolled: 'dernière interrogation',
      never: 'JAMAIS',
      aiAnalysisLabel: 'Analyse IA (Claude Haiku)',
      openDashboard: 'Ouvrir le tableau de bord Panoptica365 →',
      footer: 'Panoptica365 — Surveillance M365 multi-locataire · Pulsation système OK',
      filterSummaryLabel: 'Sommaire du filtrage',
      suppressedByExemption: '<b>{n}</b> alerte(s) résolue(s) automatiquement par des règles d’exemption actives chez <b>{m}</b> locataire(s) ({tenants}). Visibles dans le tableau de bord, exclues de ce courriel.',
      suppressedBySeverity: '<b>{n}</b> alerte(s) sous le seuil de sévérité <b>{threshold}</b>. Visibles dans le tableau de bord, exclues de ce courriel.',
    },
    es: {
      headerTitle: 'Resumen diario Panoptica365',
      subline: '{tenantCount} inquilinos monitoreados · {alertCount} alerta(s) en las últimas 24 h',
      severe: 'Severa', high: 'Alta', medium: 'Media', low: 'Baja', info: 'Info',
      allClear: 'Todo en orden',
      pollingIssuesDetected: 'Problemas de sondeo detectados',
      lastPolled: 'último sondeo',
      never: 'NUNCA',
      aiAnalysisLabel: 'Análisis de IA (Claude Haiku)',
      openDashboard: 'Abrir el panel Panoptica365 →',
      footer: 'Panoptica365 — Monitoreo M365 multi-inquilino · Pulso del sistema OK',
      filterSummaryLabel: 'Resumen del filtro',
      suppressedByExemption: '<b>{n}</b> alerta(s) auto-resueltas por reglas de exención activas en <b>{m}</b> inquilino(s) ({tenants}). Visibles en el panel, omitidas de este correo.',
      suppressedBySeverity: '<b>{n}</b> alerta(s) por debajo del umbral de severidad <b>{threshold}</b>. Visibles en el panel, omitidas de este correo.',
    },
  };
  return labels[lang] || labels.en;
}

/**
 * Convert markdown text to email-safe HTML with inline styles.
 * Handles: headers, bold, italic, code, lists, horizontal rules.
 * Uses inline styles throughout (email clients ignore <style> blocks and CSS classes).
 */
function mdToEmailHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let inList = false;
  let listType = null; // 'ul' or 'ol'

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      out.push('<hr style="border:none;border-top:1px solid #334477;margin:16px 0">');
      continue;
    }

    // Headers (### → h5, ## → h4, # → h3) — styled as section headers
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      out.push(`<h3 style="color:#9999cc;font-size:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:18px 0 8px 0">${escHtml(h3[1])}</h3>`);
      continue;
    }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      out.push(`<h2 style="color:#bb99dd;font-size:15px;font-weight:600;margin:20px 0 8px 0">${escHtml(h2[1])}</h2>`);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      out.push(`<h1 style="color:#ddb8ff;font-size:17px;font-weight:700;margin:22px 0 10px 0">${escHtml(h1[1])}</h1>`);
      continue;
    }

    // Also handle ALLCAPS section headers (EXECUTIVE SUMMARY:, etc.) that Haiku often produces
    const sectionHeader = line.match(/^(\*\*)?([A-Z][A-Z\s]+:)\1?\s*$/);
    if (sectionHeader) {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      out.push(`<div style="color:#9999cc;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:18px 0 6px 0">${escHtml(sectionHeader[2])}</div>`);
      continue;
    }

    // Bullet list item (- item or * item)
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (bullet) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(listType === 'ol' ? '</ol>' : '</ul>');
        out.push('<ul style="margin:8px 0;padding-left:20px">');
        inList = true; listType = 'ul';
      }
      out.push(`<li style="color:#e0e0e0;margin:4px 0">${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    // Numbered list item (1. item)
    const numbered = line.match(/^\s*\d+\.\s+(.+)/);
    if (numbered) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(listType === 'ol' ? '</ol>' : '</ul>');
        out.push('<ol style="margin:8px 0;padding-left:20px">');
        inList = true; listType = 'ol';
      }
      out.push(`<li style="color:#e0e0e0;margin:4px 0">${inlineMarkdown(numbered[1])}</li>`);
      continue;
    }

    // Close list if we're no longer in one
    if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }

    // Empty line → spacing
    if (line.trim() === '') {
      out.push('<br>');
      continue;
    }

    // Normal paragraph with inline markdown
    out.push(`<div style="margin:4px 0">${inlineMarkdown(line)}</div>`);
  }

  if (inList) out.push(listType === 'ol' ? '</ol>' : '</ul>');
  return out.join('\n');
}

/**
 * Convert inline markdown (bold, italic, code) to HTML with inline styles.
 */
function inlineMarkdown(text) {
  let html = escHtml(text);
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f0c8a0">$1</strong>');
  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, '<em style="color:#c8b0e8">$1</em>');
  // Inline code: `text`
  html = html.replace(/`(.+?)`/g, '<code style="background:#1a1a3a;color:#88aaff;padding:1px 5px;border-radius:3px;font-size:13px">$1</code>');
  return html;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Get the latest briefing (for dashboard widget).
 */
function getLatestBriefing() {
  return lastBriefing;
}

/**
 * Get briefing from DB (if server restarted and cache is empty).
 */
async function getLatestBriefingFromDb() {
  if (lastBriefing) return lastBriefing;

  try {
    await ensureBriefingTable();
    const row = await db.queryOne(
      'SELECT summary_en, summary_fr, summary_es, data_snapshot, generated_at FROM morning_briefings ORDER BY generated_at DESC LIMIT 1'
    );
    if (row) {
      let dataSnapshot = {};
      try {
        dataSnapshot = typeof row.data_snapshot === 'object' && row.data_snapshot !== null
          ? row.data_snapshot
          : JSON.parse(row.data_snapshot || '{}');
      } catch { /* malformed JSON — use empty object */ }
      lastBriefing = {
        generatedAt: row.generated_at,
        summary: row.summary_en,        // legacy field for backward compat
        summaryByLocale: {
          en: row.summary_en,
          fr: row.summary_fr || row.summary_en, // fallback to en if pre-Phase-8 row
          es: row.summary_es || row.summary_en,
        },
        data: dataSnapshot,
      };
      return lastBriefing;
    }
  } catch (err) {
    console.error('[Briefing] Failed to load from DB:', err.message);
  }
  return null;
}

/** Reset cached transporter (called when SMTP settings change). */
function _resetTransporter() {
  transporter = null;
}

/**
 * Reload briefing config from process.env. Called by api-settings when the
 * MSP changes the daily-summary severity threshold so the next briefing
 * picks up the new value without a process restart.
 */
function _reloadBriefingConfig() {
  config.briefing = config.briefing || {};
  config.briefing.minSeverity = (process.env.BRIEFING_MIN_SEVERITY || 'info').toLowerCase();
}

module.exports = {
  start,
  stop,
  generateAndSend,
  getLatestBriefing,
  getLatestBriefingFromDb,
  _resetTransporter,
  _reloadBriefingConfig,
};
