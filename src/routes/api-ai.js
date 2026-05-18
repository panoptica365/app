/**
 * Panoptica — AI API Routes (Phase 4)
 * Morning briefing retrieval + Ask Claude stateless Q&A.
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const auth = require('../auth');
const db = require('../db/database');
const config = require('../../config/default');
const briefing = require('../morning-briefing');
const tenantMode = require('../lib/tenant-mode');

const router = express.Router();
router.use(auth.requireAuth);

let aiClient = null;

function getAiClient() {
  if (!aiClient && config.ai.apiKey) {
    aiClient = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return aiClient;
}

// ═══════════════════════════════════════════
// MORNING BRIEFING
// ═══════════════════════════════════════════

/**
 * GET /api/ai/briefing — Get the latest morning briefing for dashboard widget.
 */
router.get('/briefing', async (req, res) => {
  try {
    // Phase 8 (May 2, 2026): briefings are now stored in 3 locales. Pick the
    // one matching ?lang= query param (frontend passes window.PanopticaI18n
    // .currentLang()), fall back to en when missing or unsupported.
    const requestedLang = req.query.lang;
    const lang = ['en', 'fr', 'es'].includes(requestedLang) ? requestedLang : 'en';

    let latest = briefing.getLatestBriefing();
    if (!latest) {
      latest = await briefing.getLatestBriefingFromDb();
    }
    if (!latest) {
      return res.json({ available: false, message: 'No briefing generated yet. The first briefing will be generated at 6:00 AM.' });
    }
    // summaryByLocale was added in Phase 8. Old in-memory state from a
    // pre-restart cache might lack it; fall back to the legacy `summary`
    // field which holds English.
    const localized = latest.summaryByLocale || { en: latest.summary, fr: latest.summary, es: latest.summary };
    res.json({
      available: true,
      generatedAt: latest.generatedAt,
      summary: localized[lang] || localized.en,
      lang,
      totalAlerts: latest.data?.totalAlerts || 0,
      tenantsWithAlerts: latest.data?.tenantsWithAlerts || 0,
      severityCounts: latest.data?.severityCounts || {},
    });
  } catch (err) {
    console.error('[API:AI] Briefing fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load briefing' });
  }
});

/**
 * POST /api/ai/briefing/generate — Manually trigger a briefing (for testing).
 */
// A3 (May 9, 2026): operator — AI cost gate (viewer cannot trigger new spend).
router.post('/briefing/generate', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    console.log('[API:AI] Manual briefing generation requested');
    const result = await briefing.generateAndSend();
    res.json({ success: true, generatedAt: result.generatedAt });
  } catch (err) {
    console.error('[API:AI] Manual briefing failed:', err.message);
    res.status(500).json({ error: 'Briefing generation failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// TENANT DIGEST — "What's going on today?"
// ═══════════════════════════════════════════
//
// Purpose: per-tenant correlation narrative over the last 24 hours.
// Uses Sonnet (not Haiku) because the task is multi-source synthesis —
// stitch together alerts, CA/Intune drift, and key signals into a coherent
// paragraph rather than analysing a single event.
//
// Replaces the unscoped "recent alerts" correlation that used to live in
// the per-alert Haiku prompt (which produced confabulated cross-alert
// narratives). Here the scope is clear: one tenant, one 24h window.
//
// Cache: 15-minute in-memory cache keyed by tenant_id. MSP operators hit
// this button multiple times per shift; we don't want to burn Sonnet
// tokens for the same window.

const tenantDigestCache = new Map(); // tenant_id → { generatedAt, content }
const TENANT_DIGEST_MAX_ALERTS = 40;

function getTenantDigestCacheTtlMs() {
  return config.ai?.tenantDigestCacheMs || (15 * 60 * 1000);
}

/**
 * POST /api/ai/tenant-digest/:tenantId — Generate a 24h correlation digest.
 * Query: ?force=1 to bypass the cache.
 * Returns: { content, generatedAt, cached, fromCacheAgeMinutes? }
 */
// A3 (May 9, 2026): operator — AI cost gate.
router.post('/tenant-digest/:tenantId', auth.requireMemberOrAdmin, async (req, res) => {
  const anthropic = getAiClient();
  if (!anthropic) {
    return res.status(503).json({ error: 'AI service not configured. Check ANTHROPIC_API_KEY.' });
  }

  const tenantId = parseInt(req.params.tenantId, 10);
  if (isNaN(tenantId) || tenantId <= 0) {
    return res.status(400).json({ error: 'Invalid tenant ID.' });
  }

  // Phase 8d (May 2, 2026): tenant digest is generated in the operator's
  // current locale (not stored persistently — see project_i18n_phase06
  // architecture decision matrix). Cache key includes lang so different
  // operators in different languages don't collide on the same tenant.
  const requestedLang = req.query.lang;
  const lang = ['en', 'fr', 'es'].includes(requestedLang) ? requestedLang : 'en';
  const cacheKey = `${tenantId}:${lang}`;

  const force = req.query.force === '1' || req.query.force === 'true';
  const cached = tenantDigestCache.get(cacheKey);
  const now = Date.now();

  if (!force && cached) {
    const age = now - new Date(cached.generatedAt).getTime();
    if (age < getTenantDigestCacheTtlMs()) {
      return res.json({
        content: cached.content,
        generatedAt: cached.generatedAt,
        cached: true,
        fromCacheAgeMinutes: Math.round(age / 60000),
        lang,
      });
    }
  }

  try {
    const tenant = await db.queryOne(
      'SELECT id, display_name, mode FROM tenants WHERE id = ?',
      [tenantId]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

    // Audit-only contract gate: "No AI in audit flow" — locked-in 2026-04-28.
    // Refuse with 403 + a clear message rather than silently degrading to an
    // empty digest, so the operator knows why.
    if (tenant.mode === 'audit_only') {
      return res.status(403).json({
        error: 'audit_only_tenant',
        message: 'Tenant digest AI analysis is disabled for audit-only tenants. Audit-only tenants are read-only snapshot collection only — Panoptica does not consume Claude tokens or generate AI summaries on their data. Convert the tenant to managed mode to enable digests.',
      });
    }

    const context = await buildTenantDigestContext(tenantId);
    const prompt = buildTenantDigestPrompt(tenant, context, lang);

    // Cap output tokens aggressively. Physical ceiling on padding: even if
    // Sonnet "wants" to produce 4 paragraphs of hedging, it can't fit in
    // 300 tokens (~210 words). The busiest real digest we'd ever want is
    // ~150 words; 300 leaves headroom without enabling fluff.
    const response = await anthropic.messages.create({
      model: config.ai.sonnetModel,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content?.[0]?.text || 'No digest generated.';
    const generatedAt = new Date().toISOString();
    tenantDigestCache.set(cacheKey, { content, generatedAt });

    console.log(`[API:AI] Tenant digest generated for ${tenant.display_name} (${tenantId}) lang=${lang} by ${req.session?.user?.email || 'unknown'}`);
    res.json({ content, generatedAt, cached: false, lang });
  } catch (err) {
    console.error('[API:AI] Tenant digest error:', err.message, err.stack);
    res.status(500).json({ error: 'Digest generation failed: ' + err.message });
  }
});

/**
 * Gather 24h context for the digest: alerts (with AI severity adjustments),
 * CA/Intune drift events, sign-in signals. Limits each source so the prompt
 * stays under ~8KB.
 */
async function buildTenantDigestContext(tenantId) {
  const context = {};

  // Alerts in the last 24h — include rule_severity + ai_severity_reason so
  // Sonnet can see which ones the per-alert Haiku pass downgraded (and why).
  //
  // NB: mysql2 prepared statements don't accept LIMIT as a bind parameter
  // ("Incorrect arguments to mysqld_stmt_execute"). Interpolate the cap
  // directly — it's a module-local integer constant, not user input.
  const limitInt = parseInt(TENANT_DIGEST_MAX_ALERTS, 10);
  context.alerts = await db.queryRows(
    `SELECT a.id, a.severity, a.rule_severity, a.ai_severity_reason, a.message,
            a.status, a.triggered_at, a.recurrence_count,
            SUBSTRING(COALESCE(a.ai_analysis_en, ''), 1, 400) AS ai_snippet,
            ap.category, ap.name AS policy_name
     FROM alerts a
     LEFT JOIN alert_policies ap ON a.policy_id = ap.id
     WHERE a.tenant_id = ?
       AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY a.triggered_at DESC
     LIMIT ${limitInt}`,
    [tenantId]
  );

  // CA policies currently in a drift state OR checked in the last 24h
  context.caDrift = await db.queryRows(
    `SELECT t.name AS template_name, a.enforcement, a.drift_status,
            a.last_checked_at
     FROM ca_assignments a
     JOIN ca_templates t ON t.id = a.template_id
     WHERE a.tenant_id = ?
       AND (a.drift_status = 'drifted'
            OR a.last_checked_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
     ORDER BY a.drift_status DESC, t.name
     LIMIT 20`,
    [tenantId]
  );

  // Intune drift — drifted deployments or recently checked
  context.intuneDrift = await db.queryRows(
    `SELECT t.name AS template_name, t.category, t.policy_type,
            d.status, d.drift_status, d.last_checked_at
     FROM intune_deployments d
     JOIN intune_templates t ON t.id = d.template_id
     WHERE d.tenant_id = ?
       AND d.status != 'removed'
       AND (d.drift_status = 'drifted'
            OR d.last_checked_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
     ORDER BY d.drift_status DESC, t.name
     LIMIT 20`,
    [tenantId]
  );

  // Identity pressure signals — grab the latest capture of each metric name
  // that actually exists in the pipeline (see fetchers.js). Original code
  // queried names like `risky_signins_24h` that were never written — which
  // is why the first test run showed Sonnet confabulating "no risky users
  // flagged in the latest security signal captured this morning" with zero
  // evidence. Use real names or nothing.
  context.identitySignals = await db.queryRows(
    `SELECT ms.metric_name, ms.metric_value, ms.captured_at
     FROM metric_snapshots ms
     WHERE ms.tenant_id = ?
       AND ms.metric_name IN ('risky_user_counts', 'mfa_status')
       AND ms.captured_at = (
         SELECT MAX(ms2.captured_at) FROM metric_snapshots ms2
         WHERE ms2.tenant_id = ms.tenant_id AND ms2.metric_name = ms.metric_name
       )`,
    [tenantId]
  );

  // Operator-logged change events in the last 24h (any surface). Fed to the
  // Sonnet prompt as NARRATIVE CONTEXT ONLY — not a suppression signal.
  // Governance boundary enforced at the prompt level; the LLM is explicitly
  // instructed not to characterize alerts as "expected" or "safe" on the
  // basis of operator notes.
  try {
    context.changeEvents = await db.queryRows(
      `SELECT source, category, affected_surface, started_at, ended_at,
              impact, description, created_by
         FROM tenant_change_events
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY started_at DESC
        LIMIT 15`,
      [tenantId]
    );
  } catch (e) {
    // Non-fatal — digest still runs without change-event context
    console.warn(`[API:AI] change-event context fetch failed: ${e.message}`);
    context.changeEvents = [];
  }

  // Diagnostic log — tells us at a glance whether the prompt is receiving
  // real signal or just empty buckets. If this line shows all zeros, the
  // output should NOT be a multi-paragraph narrative.
  const drifted = {
    alerts: context.alerts?.length || 0,
    caDrift: context.caDrift?.filter(c => c.drift_status === 'drifted').length || 0,
    intuneDrift: context.intuneDrift?.filter(d => d.drift_status === 'drifted').length || 0,
    identitySignals: context.identitySignals?.length || 0,
    changeEvents: context.changeEvents?.length || 0,
  };
  console.log(`[API:AI] Tenant digest context for tenant ${tenantId}: ${JSON.stringify(drifted)}`);

  return context;
}

/**
 * Build the Sonnet digest prompt.
 *
 * Scoped to ONE tenant over the LAST 24 HOURS. No cross-tenant mixing.
 *
 * Design (after Apr 19 iteration):
 *
 *   - Single unified branch. No quiet/active split — that approach pre-filled
 *     template phrases ("identity signals within baseline") which Sonnet then
 *     parroted regardless of what the underlying values said. A tenant with
 *     0 alerts but 2 high-risk users would have been falsely described as
 *     baseline.
 *   - Output length scales to the data. One sentence for truly-quiet tenants,
 *     a short paragraph for active ones. Enforced via max_tokens=300 on the
 *     API call (physical ceiling on padding) rather than prose instruction
 *     alone.
 *   - ABSENCE RULE: the input always shows "None in last 24h" / "None
 *     currently drifted" / "None in scope" explicitly when a source is empty.
 *     Never omit a source; explicit-none prevents Sonnet from filling the gap.
 *   - Recommendations must be specific-and-grounded OR "None — move on.".
 *     Generic AI-ops fortune cookies are prohibited by example.
 */
function buildTenantDigestPrompt(tenant, context, lang) {
  const alertCount = context.alerts?.length || 0;
  const caDrifted = (context.caDrift || []).filter(c => c.drift_status === 'drifted');
  const intuneDrifted = (context.intuneDrift || []).filter(d => d.drift_status === 'drifted');
  const identitySignals = context.identitySignals || [];

  // Phase 8d (May 2, 2026): output language directive. Prompt and inputs stay
  // English (parser stability + token-friendly), but Sonnet writes the digest
  // in the operator's current locale. The "Recommended next step:" line label
  // also translates per locale.
  const langLabel = lang === 'fr' ? 'Quebec French (fr-CA)' : (lang === 'es' ? 'neutral Spanish (es)' : 'English (en)');
  const finalLineLabel = lang === 'fr' ? 'Prochaine étape recommandée' : (lang === 'es' ? 'Próximo paso recomendado' : 'Recommended next step');
  const noActionPhrase = lang === 'fr' ? 'Aucune — passer à la suite.' : (lang === 'es' ? 'Ninguno — continuar.' : 'None — move on.');

  const lines = [];
  lines.push(`You are the AI analyst for Panoptica365, an MSP's M365 monitoring platform.`);
  lines.push(`Tenant: ${tenant.display_name}. Window: last 24 hours.`);
  lines.push(`OUTPUT LANGUAGE: ${langLabel}. Write the entire digest in this language. The input data below stays in English — only the OUTPUT (your prose digest + the final "${finalLineLabel}:" line) is translated.`);
  lines.push('');
  lines.push(`═══ INPUT ═══`);
  lines.push('');

  // Alerts — always explicit about empty state
  if (alertCount > 0) {
    lines.push(`ALERTS (${alertCount} in last 24h):`);
    for (const a of context.alerts) {
      const sevDisplay = a.rule_severity && a.rule_severity !== a.severity
        ? `[${a.severity.toUpperCase()} ← was ${a.rule_severity.toUpperCase()}]`
        : `[${(a.severity || '?').toUpperCase()}]`;
      const recur = a.recurrence_count > 1 ? ` (×${a.recurrence_count})` : '';
      let line = `- ${sevDisplay} ${a.message || 'N/A'} — ${a.category || '?'} / ${a.policy_name || '?'} — status=${a.status}${recur}`;
      if (a.ai_severity_reason) line += ` [adjust: ${a.ai_severity_reason}]`;
      lines.push(line);
    }
  } else {
    lines.push(`ALERTS: None in last 24h.`);
  }
  lines.push('');

  // CA drift
  if (caDrifted.length > 0) {
    lines.push(`CONDITIONAL ACCESS DRIFT (${caDrifted.length} drifted):`);
    for (const c of caDrifted) {
      lines.push(`- ${c.template_name}: enforcement=${c.enforcement}, last checked ${c.last_checked_at}`);
    }
  } else {
    lines.push(`CONDITIONAL ACCESS DRIFT: None currently drifted.`);
  }
  lines.push('');

  // Intune drift
  if (intuneDrifted.length > 0) {
    lines.push(`INTUNE POLICY DRIFT (${intuneDrifted.length} drifted):`);
    for (const d of intuneDrifted) {
      lines.push(`- ${d.template_name} (${d.category}/${d.policy_type}): status=${d.status}, last checked ${d.last_checked_at}`);
    }
  } else {
    lines.push(`INTUNE POLICY DRIFT: None currently drifted.`);
  }
  lines.push('');

  // Operator-logged change events — narrative context only
  const changeEvents = context.changeEvents || [];
  if (changeEvents.length > 0) {
    lines.push(`OPERATOR CHANGE EVENTS (${changeEvents.length} in last 24h — NARRATIVE CONTEXT ONLY):`);
    for (const ce of changeEvents) {
      let surfaces = ce.affected_surface;
      if (typeof surfaces === 'string') {
        try { surfaces = JSON.parse(surfaces); } catch { surfaces = []; }
      }
      const surfaceStr = Array.isArray(surfaces) ? surfaces.join(',') : '';
      const who = ce.created_by || 'unknown';
      const desc = ce.description ? ce.description.substring(0, 200) : '(no description)';
      const tag = ce.source === 'panoptica' ? 'auto' : 'manual';
      lines.push(`- [${tag}] ${ce.started_at} ${ce.category} (impact=${ce.impact}, surfaces=${surfaceStr}) by ${who}: ${desc}`);
    }
  } else {
    lines.push(`OPERATOR CHANGE EVENTS: None logged in last 24h.`);
  }
  lines.push('');

  // Identity signals — full values, let Sonnet evaluate "baseline" itself
  if (identitySignals.length > 0) {
    lines.push(`IDENTITY SIGNALS (latest snapshot values — interpret these yourself, do not assume baseline):`);
    for (const s of identitySignals) {
      let valStr;
      try {
        const v = typeof s.metric_value === 'object' ? s.metric_value : JSON.parse(s.metric_value);
        valStr = typeof v === 'number' ? String(v) : JSON.stringify(v).substring(0, 300);
      } catch {
        valStr = String(s.metric_value).substring(0, 300);
      }
      lines.push(`- ${s.metric_name} = ${valStr} (as of ${s.captured_at})`);
    }
  } else {
    lines.push(`IDENTITY SIGNALS: None in scope (no recent risky_user_counts or mfa_status snapshot).`);
  }
  lines.push('');

  lines.push(`═══ TASK ═══`);
  lines.push('');
  lines.push(`Write the SHORTEST accurate summary the data supports. Length scales to data, not to fill a slot:`);
  lines.push(`- If alerts=0, no drift, and identity signals are all zero/benign: ONE SENTENCE total. Example shape: "Quiet 24h — 0 alerts, no drift, identity counters at 0. No action required."`);
  lines.push(`- If any signal is non-trivial (an alert, a drifted policy, a non-zero risky_user_counts, etc.): one short paragraph (≤ 100 words) summarising volume + themes + what (if anything) warrants attention.`);
  lines.push('');
  lines.push(`HARD RULES:`);
  lines.push(`- Ground every factual claim in a specific input line. Quote counts or values when it helps.`);
  lines.push(`- ABSENCE IS NOT EVIDENCE. Do not describe a source as "normal" or "at baseline" unless the VALUES in the input support that reading. If a source is marked "None in scope", do not characterise it at all.`);
  lines.push(`- Identity signals: read the actual numbers. risky_user_counts.total=0 → can say "no risky users". risky_user_counts.high=2 → mention it. mfa_status.mfa_not_registered=7 → mention it. Do not guess.`);
  lines.push(`- When an alert shows "[← was X]", Haiku downgraded it. Current severity is authoritative; the downgrade itself is not an event.`);
  lines.push(`- OPERATOR CHANGE EVENTS are narrative context, not evidence. You MAY reference them in ONE clause when they plausibly explain observed noise (e.g. "coincides with an operator-logged CA deploy at 14:00"). You MUST NOT describe alerts as "expected", "safe", "normal", or otherwise downgrade them on the basis of operator context. An operator having logged a change does not make the underlying security signal less real. Severity is set elsewhere; your job is to describe, not to adjudicate.`);
  lines.push(`- No preamble ("Here's the digest…"). No bullets. Prose only.`);
  lines.push('');
  lines.push(`FINAL LINE (mandatory) — exactly one of:`);
  lines.push(`- "${finalLineLabel}: <specific action grounded in a specific input line above>."`);
  lines.push(`- "${finalLineLabel}: ${noActionPhrase}"`);
  lines.push(`Generic fortune-cookie recommendations ("verify monitoring pipeline health", "review recent configuration changes") are PROHIBITED when no input line demands them.`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// ASK CLAUDE — CONVERSATIONAL Q&A
// ═══════════════════════════════════════════

const MAX_CONVERSATION_TURNS = 10;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Ensure chat_sessions table exists.
 */
async function ensureChatSessionsTable() {
  try {
    const tables = await db.queryRows(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_sessions'"
    );
    if (tables.length === 0) {
      await db.execute(`
        CREATE TABLE chat_sessions (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id INT UNSIGNED DEFAULT NULL COMMENT 'NULL = cross-tenant (main console)',
          user_email VARCHAR(255) NOT NULL,
          messages JSON NOT NULL COMMENT 'Array of {role, content} pairs',
          system_prompt TEXT NOT NULL COMMENT 'Context snapshot at session start',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_session_tenant (tenant_id),
          INDEX idx_session_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[AI] Created chat_sessions table');
    }
  } catch (err) {
    if (!err.message.includes('already exists')) {
      console.error('[AI] ensureChatSessionsTable error:', err.message);
    }
  }
}

// Run migration on load
ensureChatSessionsTable().catch(() => {});

/**
 * POST /api/ai/chat — Ask Claude a question (conversational).
 * Body: { question, tenantId?, sessionId? }
 * Returns: { answer, sessionId }
 */
// A3 (May 9, 2026): operator — AI cost gate (viewer reads only).
router.post('/chat', auth.requireMemberOrAdmin, async (req, res) => {
  const anthropic = getAiClient();
  if (!anthropic) {
    return res.status(503).json({ error: 'AI service not configured. Check ANTHROPIC_API_KEY.' });
  }

  const { question, tenantId, sessionId, lang: rawLang } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'Question is required.' });
  }
  // Phase 8d (May 2, 2026): operator's current locale, threaded into the
  // system prompt as a response-language directive. Stored system_prompt
  // stays locale-neutral so mid-conversation language switches just work.
  const lang = ['en', 'fr', 'es'].includes(rawLang) ? rawLang : 'en';

  if (question.trim().length > 1000) {
    return res.status(400).json({ error: 'Question too long (max 1000 characters).' });
  }

  const validTenantId = tenantId ? parseInt(tenantId, 10) : null;
  if (tenantId && (isNaN(validTenantId) || validTenantId <= 0)) {
    return res.status(400).json({ error: 'Invalid tenant ID.' });
  }

  // Audit-only contract gate: "No AI in audit flow." If the chat is scoped to
  // a specific tenant and that tenant is audit-only, refuse rather than send
  // their data to Claude. Cross-tenant chat (no validTenantId) still runs;
  // buildChatContext filters audit-only tenants out of its tenant list below.
  if (validTenantId) {
    if (await tenantMode.isAuditOnly(validTenantId)) {
      return res.status(403).json({
        error: 'audit_only_tenant',
        message: 'AI chat is disabled for audit-only tenants. Audit-only mode is read-only snapshot collection — Panoptica does not consume Claude tokens or generate AI analysis on their data. Convert the tenant to managed mode to enable chat.',
      });
    }
  }

  const userEmail = req.session?.user?.email || 'unknown';

  try {
    let session = null;
    let messages = [];
    let systemPrompt = '';

    // Try to resume existing session
    if (sessionId) {
      session = await db.queryOne(
        'SELECT id, messages, system_prompt, updated_at FROM chat_sessions WHERE id = ?',
        [parseInt(sessionId, 10)]
      );

      if (session) {
        // Check if session has expired (30 min inactivity)
        const lastUpdate = new Date(session.updated_at).getTime();
        if (Date.now() - lastUpdate > SESSION_TIMEOUT_MS) {
          // Session expired — start fresh
          session = null;
        } else {
          // Parse existing messages
          const raw = session.messages;
          messages = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw || '[]');
          systemPrompt = session.system_prompt;

          // Check turn limit
          const userTurns = messages.filter(m => m.role === 'user').length;
          if (userTurns >= MAX_CONVERSATION_TURNS) {
            return res.json({
              answer: 'This conversation has reached the 10-question limit. Please start a new conversation.',
              sessionId: session.id,
              expired: true,
            });
          }
        }
      }
    }

    // New session — build context and system prompt
    if (!session) {
      const context = await buildChatContext(validTenantId);
      systemPrompt = buildSystemPrompt(context, validTenantId);
      messages = [];
    }

    // Add the new user message
    messages.push({ role: 'user', content: question.trim() });

    // Inject per-turn language directive (Phase 8d). Not stored — recomputed
    // every turn so the operator can switch locale mid-conversation and
    // Claude's NEXT response shifts immediately.
    const langDirective = lang === 'fr'
      ? '\n\nRESPOND IN: Quebec French (fr-CA). All output prose in French; technical identifiers (cmdlet names, GUIDs, email addresses, JSON field names) stay as-is.'
      : (lang === 'es'
          ? '\n\nRESPOND IN: neutral Spanish (es). All output prose in Spanish; technical identifiers (cmdlet names, GUIDs, email addresses, JSON field names) stay as-is.'
          : '\n\nRESPOND IN: English.');
    const systemPromptForCall = systemPrompt + langDirective;

    // Call Haiku with full conversation
    const response = await anthropic.messages.create({
      model: config.ai.haikuModel,
      max_tokens: config.ai.maxTokens,
      system: systemPromptForCall,
      messages,
    });

    const answer = response.content?.[0]?.text || 'No response generated.';

    // Add assistant response to history
    messages.push({ role: 'assistant', content: answer });

    // Save/update session
    let returnSessionId;
    if (session) {
      await db.execute(
        'UPDATE chat_sessions SET messages = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(messages), session.id]
      );
      returnSessionId = session.id;
    } else {
      returnSessionId = await db.insert(
        'INSERT INTO chat_sessions (tenant_id, user_email, messages, system_prompt) VALUES (?, ?, ?, ?)',
        [validTenantId, userEmail, JSON.stringify(messages), systemPrompt]
      );
    }

    res.json({ answer, sessionId: returnSessionId });
  } catch (err) {
    console.error('[API:AI] Chat error:', err.message, err.stack);
    res.status(500).json({ error: 'AI query failed: ' + err.message });
  }
});

/**
 * DELETE /api/ai/chat/:sessionId — End a conversation (start fresh).
 */
router.delete('/chat/:sessionId', async (req, res) => {
  const id = parseInt(req.params.sessionId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid session ID.' });

  await db.execute('DELETE FROM chat_sessions WHERE id = ?', [id]);
  res.json({ success: true });
});

/**
 * Build context for the chat prompt.
 * Gathers recent alerts, tenant info, and metric highlights.
 */
async function buildChatContext(tenantId) {
  const context = {};

  if (tenantId) {
    // Scoped to a single tenant
    const tenant = await db.queryOne(
      'SELECT id, tenant_id, display_name, enabled, last_polled_at, poll_count, polling_interval FROM tenants WHERE id = ?',
      [tenantId]
    );
    context.tenant = tenant;

    // Recent alerts (last 7 days) — category lives on alert_policies, not alerts
    const recentAlerts = await db.queryRows(
      `SELECT a.severity, a.message, a.status, a.ai_analysis_en AS ai_analysis, a.triggered_at, ap.category
       FROM alerts a
       LEFT JOIN alert_policies ap ON a.policy_id = ap.id
       WHERE a.tenant_id = ? ORDER BY a.triggered_at DESC LIMIT 25`,
      [tenantId]
    );
    context.recentAlerts = recentAlerts;

    // Latest metrics snapshot — get distinct metric names, then fetch most recent for each
    // Using simple query to avoid mysql2 prepared statement issues with complex subqueries
    const tenantIdInt = parseInt(tenantId, 10);
    const metrics = await db.queryRows(
      `SELECT ms.service, ms.metric_name, ms.metric_value, ms.captured_at
       FROM metric_snapshots ms
       WHERE ms.tenant_id = ?
         AND ms.captured_at = (
           SELECT MAX(ms2.captured_at) FROM metric_snapshots ms2
           WHERE ms2.tenant_id = ms.tenant_id AND ms2.metric_name = ms.metric_name
         )`,
      [tenantIdInt]
    );
    context.metrics = metrics;

    // CA policy assignments for this tenant
    const caAssignments = await db.queryRows(
      `SELECT a.id, a.enforcement, a.drift_status, a.last_checked_at, a.alert_routing,
              t.name AS template_name, t.state AS template_state,
              t.grant_controls, t.target_users, t.target_apps,
              t.alert_routing AS template_alert_routing
       FROM ca_assignments a
       JOIN ca_templates t ON t.id = a.template_id
       WHERE a.tenant_id = ?
       ORDER BY t.name`,
      [tenantIdInt]
    );
    context.caAssignments = caAssignments;

    // Intune policy deployments for this tenant
    const intuneDeployments = await db.queryRows(
      `SELECT d.id, d.status, d.drift_status, d.drift_details, d.last_checked_at,
              d.assignment_target, d.alert_routing, d.deployed_at,
              t.name AS template_name, t.category, t.policy_type,
              t.alert_routing AS template_alert_routing
       FROM intune_deployments d
       JOIN intune_templates t ON t.id = d.template_id
       WHERE d.tenant_id = ? AND d.status != 'removed'
       ORDER BY t.name`,
      [tenantIdInt]
    );
    context.intuneDeployments = intuneDeployments;

  } else {
    // Cross-tenant context (main console). Audit-only tenants are excluded
    // from the AI's tenant context — per audit_only contract, their data
    // is not fed to Claude.
    const tenants = await db.queryRows(
      `SELECT id, display_name, enabled, last_polled_at FROM tenants
       WHERE enabled = TRUE AND mode = 'managed'
       ORDER BY display_name`
    );
    context.tenants = tenants;

    // Recent alerts across all tenants (last 48h, limited)
    const recentAlerts = await db.queryRows(
      `SELECT a.severity, a.message, a.status, a.triggered_at,
              ap.category, t.display_name AS tenant_name
       FROM alerts a
       JOIN tenants t ON a.tenant_id = t.id
       LEFT JOIN alert_policies ap ON a.policy_id = ap.id
       WHERE a.triggered_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
       ORDER BY a.triggered_at DESC LIMIT 30`
    );
    context.recentAlerts = recentAlerts;
  }

  return context;
}

/**
 * Build the system prompt with context injection.
 * This is sent once per session as the system message — not repeated per turn.
 */
function buildSystemPrompt(context, tenantId) {
  let contextBlock = '';

  if (tenantId && context.tenant) {
    const t = context.tenant;
    contextBlock += `TENANT: ${t.display_name}\n`;
    contextBlock += `Status: ${t.enabled ? 'Active' : 'Disabled'} | Last polled: ${t.last_polled_at || 'Never'} | Poll count: ${t.poll_count}\n\n`;

    // Recent alerts
    if (context.recentAlerts?.length > 0) {
      contextBlock += 'RECENT ALERTS (last 7 days):\n';
      for (const a of context.recentAlerts) {
        contextBlock += `- [${(a.severity || 'unknown').toUpperCase()}] ${a.message || 'N/A'} (${a.status || 'unknown'}, ${a.triggered_at || ''})`;
        if (a.ai_analysis) {
          const analysis = typeof a.ai_analysis === 'string' ? a.ai_analysis : JSON.stringify(a.ai_analysis);
          contextBlock += ` — AI: ${analysis.substring(0, 150)}`;
        }
        contextBlock += '\n';
      }
      contextBlock += '\n';
    } else {
      contextBlock += 'RECENT ALERTS: None in the last 7 days.\n\n';
    }

    // Key metrics — expand security-critical ones with full data, summarize the rest
    // These metrics get full detail so Claude can answer "which users/admins" questions
    const EXPAND_METRICS = new Set([
      'global_admins', 'admin_role_counts', 'mfa_not_registered_users',
      'risky_users', 'risky_user_counts', 'conditional_access_policies',
      'mfa_registration_stats', 'mail_forwarding', 'inactive_users',
    ]);

    if (context.metrics?.length > 0) {
      contextBlock += 'CURRENT METRICS:\n';
      for (const m of context.metrics) {
        let valueStr;
        try {
          const val = typeof m.metric_value === 'object' ? m.metric_value : JSON.parse(m.metric_value);

          if (EXPAND_METRICS.has(m.metric_name)) {
            // Expand with full detail (capped at 3000 chars to stay reasonable)
            const full = JSON.stringify(val, null, 1);
            valueStr = full.length > 3000 ? full.substring(0, 3000) + '...(truncated)' : full;
          } else if (typeof val === 'number') {
            valueStr = String(val);
          } else if (Array.isArray(val)) {
            valueStr = `${val.length} items`;
          } else if (typeof val === 'object' && val !== null) {
            const keys = Object.keys(val);
            valueStr = keys.length <= 5
              ? keys.map(k => `${k}=${typeof val[k] === 'number' ? val[k] : '...'}`).join(', ')
              : `${keys.length} fields`;
          } else {
            valueStr = String(val).substring(0, 100);
          }
        } catch {
          valueStr = String(m.metric_value).substring(0, 100);
        }
        contextBlock += `- ${m.service}/${m.metric_name}: ${valueStr} (as of ${m.captured_at})\n`;
      }
      contextBlock += '\n';
    }

    // CA Policy Assignments
    if (context.caAssignments?.length > 0) {
      contextBlock += `CONDITIONAL ACCESS POLICIES (${context.caAssignments.length} assigned):\n`;
      for (const a of context.caAssignments) {
        const driftBadge = a.drift_status === 'drifted' ? ' [DRIFTED]'
          : a.drift_status === 'ok' ? '' : ` [${(a.drift_status || 'unchecked').toUpperCase()}]`;
        const routing = a.alert_routing || a.template_alert_routing || 'both';
        contextBlock += `- ${a.template_name}: state=${a.template_state || 'N/A'}, enforcement=${a.enforcement || 'monitor'}${driftBadge}, alerts=${routing}`;
        if (a.grant_controls) contextBlock += `, grant=${a.grant_controls}`;
        if (a.target_users) contextBlock += `, users=${a.target_users}`;
        if (a.target_apps) contextBlock += `, apps=${a.target_apps}`;
        if (a.last_checked_at) contextBlock += ` (checked: ${a.last_checked_at})`;
        contextBlock += '\n';
      }
      contextBlock += '\n';
    } else {
      contextBlock += 'CONDITIONAL ACCESS POLICIES: None assigned to this tenant.\n\n';
    }

    // Intune Policy Deployments
    if (context.intuneDeployments?.length > 0) {
      const INTUNE_TYPE_LABELS = {
        configurationPolicies: 'Settings Catalog',
        deviceConfigurations: 'Device Config',
        deviceCompliancePolicies: 'Compliance',
        groupPolicyConfigurations: 'Admin Templates',
        intents: 'Security Baseline',
      };
      const ASSIGN_LABELS = { none: 'none', all_users: 'All Users', all_devices: 'All Devices' };

      contextBlock += `INTUNE POLICIES (${context.intuneDeployments.length} deployed/pending):\n`;
      for (const d of context.intuneDeployments) {
        const typeLabel = INTUNE_TYPE_LABELS[d.policy_type] || d.policy_type;
        const driftBadge = d.drift_status === 'drifted' ? ' [DRIFTED]'
          : d.drift_status === 'ok' ? '' : ` [${(d.drift_status || 'unchecked').toUpperCase()}]`;
        const assignLabel = ASSIGN_LABELS[d.assignment_target] || 'none';
        const routing = d.alert_routing || d.template_alert_routing || 'both';
        contextBlock += `- ${d.template_name}: type=${typeLabel}, status=${d.status}${driftBadge}, assigned=${assignLabel}, alerts=${routing}`;
        if (d.last_checked_at) contextBlock += ` (checked: ${d.last_checked_at})`;
        // Include drift details summary if drifted
        if (d.drift_status === 'drifted' && d.drift_details) {
          try {
            const details = typeof d.drift_details === 'object' ? d.drift_details : JSON.parse(d.drift_details);
            if (Array.isArray(details) && details.length > 0) {
              const fields = details.slice(0, 3).map(dd => dd.field || dd.settingDefinitionId || 'unknown').join(', ');
              contextBlock += ` — drifted fields: ${fields}${details.length > 3 ? ` +${details.length - 3} more` : ''}`;
            }
          } catch (e) { /* ignore parse errors */ }
        }
        contextBlock += '\n';
      }
      contextBlock += '\n';
    } else {
      contextBlock += 'INTUNE POLICIES: None deployed to this tenant.\n\n';
    }
  } else {
    // Cross-tenant context
    if (context.tenants?.length > 0) {
      contextBlock += `MONITORED TENANTS (${context.tenants.length}):\n`;
      for (const t of context.tenants) {
        contextBlock += `- ${t.display_name} (last polled: ${t.last_polled_at || 'Never'})\n`;
      }
      contextBlock += '\n';
    }

    if (context.recentAlerts?.length > 0) {
      contextBlock += 'RECENT ALERTS (last 48 hours):\n';
      for (const a of context.recentAlerts) {
        contextBlock += `- [${(a.severity || 'unknown').toUpperCase()}] ${a.tenant_name || 'Unknown'}: ${a.message || 'N/A'} (${a.status || 'unknown'}, ${a.triggered_at || ''})\n`;
      }
      contextBlock += '\n';
    } else {
      contextBlock += 'RECENT ALERTS: None in the last 48 hours.\n\n';
    }
  }

  return `You are the AI analyst for Panoptica365, an MSP's Microsoft 365 monitoring platform.
Answer questions based on the data provided. Be concise, specific, and actionable.
If you don't have enough data to answer, say so clearly.
Keep answers under 200 words unless the question requires more detail.
You are in a conversation — the user may ask follow-up questions referencing previous answers.
When analyzing security posture, always cross-reference related data sources — for example, a user listed as "not registered for MFA" may still be protected if a Conditional Access policy enforces MFA for their role. Do not treat any single metric in isolation; correlate policies, user lists, and alert data to give an accurate picture.
You have access to Conditional Access policy assignments (with enforcement mode, drift status, grant controls, and target scope) and Intune policy deployments (with type, status, drift, and assignment targets). Use these to give informed answers about the tenant's security configuration posture.

${contextBlock}`;
}

module.exports = router;
