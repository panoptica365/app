/**
 * Panoptica365 — AI-path guard (Reliability 1.9, 2026-06-12).
 *
 * Three protections for the automated AI enrichment pipeline (per-alert Haiku
 * analysis, event summaries, Message Center correlation, known-good verdicts,
 * identity timelines):
 *
 *   1. DAILY TOKEN BUDGET — every Anthropic response's usage is accounted
 *      into `ai_usage_daily` (one row per UTC day). When the day's total
 *      crosses config.ai.dailyTokenBudget (AI_DAILY_TOKEN_BUDGET, default
 *      5M tokens, 0 = unlimited), preflight() starts answering "no" and ONE
 *      system alert is raised ("AI analysis paused — budget reached"). This
 *      is the runaway-loop fuse: a May-12-style backfill burst on a
 *      customer's own API key is a relationship problem, not just a cost.
 *
 *   2. CIRCUIT BREAKER — after AI_BREAKER_THRESHOLD consecutive failures
 *      (default 5), enrichment is skipped for AI_BREAKER_COOLDOWN_MIN
 *      (default 15 min), then self-resets. A dead/erroring API stops being
 *      retried on every single alert.
 *
 *   3. THE INVARIANT — alerts always fire without AI. Every guarded call
 *      site already degrades to null on AI failure; preflight() denial takes
 *      the exact same path. The guard can only ever remove the AI narrative,
 *      never the alert. Budget accounting itself FAILS OPEN: if the DB read
 *      breaks, enrichment proceeds (accounting must never block the pipeline).
 *
 * Enforcement scope: the AUTOMATED paths listed above. Operator-initiated
 * paths (reports, AI chat/digest, key tests) and the 1/day morning briefing
 * record usage into the same ledger but are not blocked — a runaway is by
 * definition automated.
 *
 * The budget-trip alert reuses the existing 'Panoptica System Health' policy
 * (live on Prod since the briefing self-alert shipped — no new alert_policies
 * ENUM value, dashboard-quiet by design, deduped per UTC day).
 */

'use strict';

const config = require('../../config/default');
const db = require('./../db/database');

const BREAKER_THRESHOLD = parseInt(process.env.AI_BREAKER_THRESHOLD, 10) || 5;
const BREAKER_COOLDOWN_MS = (parseInt(process.env.AI_BREAKER_COOLDOWN_MIN, 10) || 15) * 60 * 1000;
// Cache today's usage total briefly so per-alert preflights don't add a DB
// round-trip each; 60s of staleness is irrelevant against a daily budget.
const USAGE_CACHE_MS = 60 * 1000;

let schemaReady = null;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;
let usageCache = { date: null, total: 0, fetchedAt: 0 };
let budgetAlertRaisedFor = null; // UTC date string the trip alert was raised for

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ai_usage_daily (
          usage_date DATE PRIMARY KEY,
          calls INT UNSIGNED NOT NULL DEFAULT 0,
          input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
          output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[AiGuard] Ensured ai_usage_daily table exists');
    } catch (e) {
      console.error('[AiGuard] Schema ensure failed:', e.message);
    }
  })();
  return schemaReady;
}

/**
 * Account one response's token usage. Fire-and-forget safe — never throws.
 * Counts input (incl. cache read/write, which still represent real API
 * traffic) and output tokens.
 */
async function recordUsage(usage) {
  if (!usage) return;
  const input = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
  const output = usage.output_tokens || 0;
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO ai_usage_daily (usage_date, calls, input_tokens, output_tokens)
       VALUES (UTC_DATE(), 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         calls = calls + 1,
         input_tokens = input_tokens + VALUES(input_tokens),
         output_tokens = output_tokens + VALUES(output_tokens)`,
      [input, output]
    );
    usageCache.total += input + output; // keep the cached total roughly live
  } catch (e) {
    console.error('[AiGuard] recordUsage failed:', e.message);
  }
}

async function usedToday() {
  const today = utcToday();
  if (usageCache.date === today && Date.now() - usageCache.fetchedAt < USAGE_CACHE_MS) {
    return usageCache.total;
  }
  await ensureSchema();
  const row = await db.queryOne(
    'SELECT input_tokens + output_tokens AS total FROM ai_usage_daily WHERE usage_date = UTC_DATE()'
  );
  usageCache = { date: today, total: Number(row?.total || 0), fetchedAt: Date.now() };
  return usageCache.total;
}

/**
 * Gate for AUTOMATED enrichment calls. Returns { allowed, reason }.
 * Denies when the circuit breaker is open or the daily budget is spent.
 * FAILS OPEN if the budget lookup itself errors.
 */
async function preflight(label) {
  if (Date.now() < breakerOpenUntil) {
    const mins = Math.ceil((breakerOpenUntil - Date.now()) / 60000);
    return { allowed: false, reason: `circuit breaker open after ${consecutiveFailures} consecutive AI failures (retries in ~${mins} min)` };
  }
  const budget = config.ai.dailyTokenBudget;
  if (budget > 0) {
    let used;
    try {
      used = await usedToday();
    } catch (e) {
      console.error(`[AiGuard] budget lookup failed (failing OPEN): ${e.message}`);
      return { allowed: true, reason: 'budget unknown — failing open' };
    }
    if (used >= budget) {
      raiseBudgetAlert(used, budget).catch(() => {});
      return { allowed: false, reason: `daily AI token budget reached (${used.toLocaleString()} of ${budget.toLocaleString()} tokens; resets midnight UTC)` };
    }
  }
  return { allowed: true, reason: null };
}

/** Success on a guarded call: reset the breaker + account usage. */
function recordSuccess(usage) {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
  recordUsage(usage).catch(() => {});
}

/** Failure on a guarded call: count toward opening the breaker. */
function recordFailure(err) {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD && Date.now() >= breakerOpenUntil) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.error(
      `[AiGuard] Circuit breaker OPEN — ${consecutiveFailures} consecutive AI failures ` +
      `(last: ${err?.message || 'unknown'}). Skipping AI enrichment for ${BREAKER_COOLDOWN_MS / 60000} min; ` +
      `alerts continue without AI narratives.`
    );
  }
}

/**
 * One MSP-level alert per UTC day when the budget trips. Reuses the existing
 * 'Panoptica System Health' policy + the briefing's dedup/direct-insert
 * pattern (dashboard-quiet by design — same posture as the briefing-failure
 * self-alert this is modeled on).
 */
async function raiseBudgetAlert(used, budget) {
  const today = utcToday();
  if (budgetAlertRaisedFor === today) return;
  budgetAlertRaisedFor = today;
  try {
    let policy = await db.queryOne(
      "SELECT id FROM alert_policies WHERE name = 'Panoptica System Health' LIMIT 1"
    );
    if (!policy) {
      const id = await db.insert(
        `INSERT INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
         VALUES ('Panoptica System Health', 'Internal system failures (briefing delivery, SMTP errors, etc.)', 'config_changes', 'high', '{"type":"system_health"}', 'critical', TRUE, 'both')`
      );
      policy = { id };
    }

    // MSP tenant lookup — same 3-layer fallback as morning-briefing.js.
    let mspTenant = null;
    const mspTenantGuid = (process.env.MSP_TENANT_GUID || '').trim();
    if (mspTenantGuid) {
      mspTenant = await db.queryOne('SELECT id FROM tenants WHERE tenant_id = ? LIMIT 1', [mspTenantGuid]);
    }
    if (!mspTenant) {
      mspTenant = await db.queryOne(
        "SELECT id FROM tenants WHERE display_name LIKE '%trilogiam%' OR display_name LIKE '%Trilogiam%' LIMIT 1"
      );
    }
    const tenantId = mspTenant ? mspTenant.id : 1;

    const dedupKey = `system_health_ai_budget_${today}`;
    const existing = await db.queryOne(
      `SELECT id FROM alerts WHERE tenant_id = ? AND dedup_key = ? AND status IN ('new','investigating') LIMIT 1`,
      [tenantId, dedupKey]
    );
    if (existing) return;

    const message =
      `AI analysis paused — daily token budget reached (${used.toLocaleString()} of ${budget.toLocaleString()} tokens). ` +
      `Alerts continue to fire without AI narratives. Resumes automatically at midnight UTC. ` +
      `Raise AI_DAILY_TOKEN_BUDGET in .env if this volume is expected.`;
    const id = await db.insert(
      `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data, dedup_key, recurrence_count, last_seen_at, triggered_at)
       VALUES (?, ?, 'high', ?, ?, ?, 1, NOW(), NOW())`,
      [tenantId, policy.id, message, JSON.stringify({ type: 'ai_budget_reached', used, budget }), dedupKey]
    );
    console.warn(`[AiGuard] Daily AI token budget reached — system alert ${id} raised (used ${used} of ${budget})`);
  } catch (e) {
    budgetAlertRaisedFor = null; // retry on next trip
    console.error('[AiGuard] Failed to raise budget alert:', e.message);
  }
}

/** Exposed for diagnostics/tests. */
function breakerState() {
  return { consecutiveFailures, openUntil: breakerOpenUntil, open: Date.now() < breakerOpenUntil };
}

module.exports = {
  ensureSchema,
  preflight,
  recordUsage,
  recordSuccess,
  recordFailure,
  breakerState,
  _usedToday: usedToday,
};
