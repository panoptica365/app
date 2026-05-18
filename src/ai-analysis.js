/**
 * Panoptica — AI Alert Analysis
 *
 * Uses Claude Haiku to analyze each new alert. Returns a structured object
 * containing (a) the prose analysis in three locales (en/fr/es), (b) a
 * proposed severity that is decoupled from the rule-based severity, and
 * (c) a machine-readable severity reason.
 *
 * Design goals (rewritten April 2026 after the Conditional Access
 * error-code 50097 false-positive incident):
 *
 *   - Do NOT feed the rule's severity into the prompt. Anchoring caused
 *     Haiku to justify SEVERE verdicts on benign events like device-auth
 *     interrupts that Microsoft itself labels "not an error" in the raw
 *     data.
 *   - Do NOT include an unscoped "recent alerts" correlation section.
 *     Pattern-finding across unrelated alerts produced confabulated
 *     narratives (e.g. ASR policy drift "correlating" with a sign-in
 *     interrupt that had no causal relationship). Cross-alert correlation
 *     lives in the tenant-level digest endpoint, not here.
 *   - DO pass the full raw_data (up to 20 KB) and give Haiku an
 *     authoritative-field list + error-code taxonomy so it has the
 *     evidence to downgrade severity when the raw data tells it to.
 *   - DO ask for a structured proposed severity. Caller decides whether
 *     to apply it (downgrade only, never upgrade — see alert-engine.js).
 *
 * Phase 9a (May 2, 2026) — multilingual generation:
 *   Output is now JSON `{ proposed_severity, severity_reason, en, fr, es }`
 *   instead of freeform "PROPOSED_SEVERITY:" markers. The three locale
 *   keys hold the human-readable EXPLANATION + ACTION prose. Severity is
 *   still language-agnostic (info/low/medium/high/severe) so the
 *   downgrade-only adjustment logic in alert-engine.js keeps working.
 *   The parser falls back to the legacy regex form if JSON parse fails,
 *   so a transitional Haiku response can't kill an alert's analysis.
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/default');
const db = require('./db/database');
const tenantMode = require('./lib/tenant-mode');

const RAW_DATA_CAP = 20000;
const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'severe']);

// ─── Parse-health telemetry (Apr 28, 2026 — extended Phase 9a May 2, 2026) ───
// In-process counters tracking how reliably Haiku emits the structured
// JSON envelope. Reset on pm2 restart — by design, since the useful
// question is "is the model drifting NOW", not "ever". Surfaced via
// /api/health → ai_parse_health check. If miss-rate exceeds 5% over
// 50+ samples, tighten the prompt or add schema-validation retry.
//
// Phase 9a renamed `severityMisses` from "PROPOSED_SEVERITY: regex didn't
// match" to "JSON envelope missing/malformed OR severity field absent" —
// the parser now does JSON.parse first, and a JSON failure that the regex
// fallback also can't rescue counts as a JSON parse-miss.
const parseStats = {
  totalParses: 0,
  jsonParseHits: 0,    // Phase 9a: clean JSON parse succeeded
  jsonParseMisses: 0,  // Phase 9a: JSON failed AND fallback regex still ran
  severityHits: 0,     // proposed_severity present and a valid token
  severityMisses: 0,   // proposed_severity absent or unrecognized
  reasonHits: 0,
  reasonMisses: 0,
  windowStartedAt: new Date().toISOString(),
};

function getParseStats() {
  const total = parseStats.totalParses;
  const jsonMissPct = total === 0 ? 0 : (parseStats.jsonParseMisses / total) * 100;
  const sevMissPct = total === 0 ? 0 : (parseStats.severityMisses / total) * 100;
  const reasonMissPct = total === 0 ? 0 : (parseStats.reasonMisses / total) * 100;
  return {
    total_parses: total,
    json_parse_hits: parseStats.jsonParseHits,
    json_parse_misses: parseStats.jsonParseMisses,
    json_parse_miss_pct: Number(jsonMissPct.toFixed(2)),
    severity_hits: parseStats.severityHits,
    severity_misses: parseStats.severityMisses,
    severity_miss_pct: Number(sevMissPct.toFixed(2)),
    reason_hits: parseStats.reasonHits,
    reason_misses: parseStats.reasonMisses,
    reason_miss_pct: Number(reasonMissPct.toFixed(2)),
    window_started_at: parseStats.windowStartedAt,
  };
}

let client = null;

function getClient() {
  if (!client && config.ai.apiKey) {
    client = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return client;
}

/**
 * Idempotent schema migration — adds rule_severity + ai_severity_reason
 * columns if missing, and backfills rule_severity from severity for
 * pre-existing rows. Called once on module load.
 */
async function ensureSeverityAdjustmentSchema() {
  try {
    const cols = await db.queryRows(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts'
         AND COLUMN_NAME IN ('rule_severity', 'ai_severity_reason')`
    );
    const have = new Set(cols.map(c => c.COLUMN_NAME));

    if (!have.has('rule_severity')) {
      await db.execute(
        `ALTER TABLE alerts
           ADD COLUMN rule_severity ENUM('info','low','medium','high','severe') NULL AFTER severity`
      );
      console.log('[AI] Added alerts.rule_severity column');
    }
    if (!have.has('ai_severity_reason')) {
      await db.execute(
        `ALTER TABLE alerts
           ADD COLUMN ai_severity_reason TEXT NULL COMMENT 'Reason Haiku gave for severity adjustment' AFTER rule_severity`
      );
      console.log('[AI] Added alerts.ai_severity_reason column');
    }

    // Backfill rule_severity on any pre-existing rows that don't have it yet.
    // Done in one UPDATE — cheap and idempotent.
    const backfilled = await db.execute(
      `UPDATE alerts SET rule_severity = severity WHERE rule_severity IS NULL`
    );
    if (backfilled > 0) {
      console.log(`[AI] Backfilled rule_severity on ${backfilled} existing alert(s)`);
    }
  } catch (err) {
    console.error('[AI] ensureSeverityAdjustmentSchema failed:', err.message);
  }
}

/**
 * Phase 9a (May 2, 2026) — idempotent migration that splits the legacy
 * `ai_analysis` column into three locale columns:
 *   ai_analysis_en  ← renamed from ai_analysis (preserves history)
 *   ai_analysis_fr  ← new, NULL on pre-cutover rows (UI falls back to en)
 *   ai_analysis_es  ← new, NULL on pre-cutover rows (UI falls back to en)
 *
 * Mirrors morning-briefing.js::ensureBriefingTable() — first boot does
 * the rename + adds, every boot after that sees the columns already
 * exist and no-ops.
 *
 * Called lazily from the first analyzeAlert() invocation rather than at
 * module load, matching the morning-briefing pattern. The earlier
 * ensureSeverityAdjustmentSchema() still fires at module load because
 * its scope is narrower (no rename, just two ADD COLUMNs).
 */
let aiColumnMigrationDone = false;
let aiColumnMigrationPromise = null;

async function ensureAlertAiColumns() {
  // Single-flight: if a migration is already in progress, await it.
  if (aiColumnMigrationDone) return;
  if (aiColumnMigrationPromise) return aiColumnMigrationPromise;

  aiColumnMigrationPromise = (async () => {
    try {
      const cols = await db.queryRows(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts'`
      );
      const colNames = new Set(cols.map(c => c.COLUMN_NAME));

      // Step 1: rename legacy `ai_analysis` → `ai_analysis_en` if needed.
      if (colNames.has('ai_analysis') && !colNames.has('ai_analysis_en')) {
        console.log('[AI] Migrating alerts.ai_analysis → alerts.ai_analysis_en');
        await db.execute(
          `ALTER TABLE alerts CHANGE ai_analysis ai_analysis_en TEXT NULL COMMENT 'Claude Haiku/Sonnet output (English)'`
        );
        colNames.delete('ai_analysis');
        colNames.add('ai_analysis_en');
      }

      // Step 2: add ai_analysis_fr if missing.
      if (!colNames.has('ai_analysis_fr')) {
        console.log('[AI] Adding alerts.ai_analysis_fr column');
        await db.execute(
          `ALTER TABLE alerts ADD COLUMN ai_analysis_fr TEXT NULL COMMENT 'Claude Haiku output (Quebec French)' AFTER ai_analysis_en`
        );
      }

      // Step 3: add ai_analysis_es if missing.
      if (!colNames.has('ai_analysis_es')) {
        console.log('[AI] Adding alerts.ai_analysis_es column');
        await db.execute(
          `ALTER TABLE alerts ADD COLUMN ai_analysis_es TEXT NULL COMMENT 'Claude Haiku output (neutral Spanish)' AFTER ai_analysis_fr`
        );
      }

      aiColumnMigrationDone = true;
    } catch (err) {
      console.error('[AI] ensureAlertAiColumns failed:', err.message);
      // Don't latch the failure — let the next call retry.
    } finally {
      aiColumnMigrationPromise = null;
    }
  })();

  return aiColumnMigrationPromise;
}

// Run severity-adjustment migration on module load (fire and forget).
ensureSeverityAdjustmentSchema().catch(() => {});

// Phase 9a fix (May 2, 2026): also fire ai_analysis multi-locale column
// migration at module load. Originally lazy (first analyzeAlert call), but
// the api-alerts list endpoint queries ai_analysis_en immediately when the
// operator opens the dashboard — if no AI dispatch has happened yet, the
// column doesn't exist and the SELECT fails. Eager migration matches the
// pattern used by ensureSeverityAdjustmentSchema above.
ensureAlertAiColumns().catch((err) => {
  console.error('[AI] Eager column migration failed at module load:', err.message);
});

/**
 * Analyze an alert using Claude Haiku.
 *
 * @param {object} alert  - Alert with message, raw_data, policy_name, category, severity (rule severity).
 * @param {object} tenant - Tenant with display_name.
 * @returns {object|null} { ai_analysis_en, ai_analysis_fr, ai_analysis_es, proposedSeverity, proposedReason } or null.
 *                        - ai_analysis_en/fr/es: prose analysis per locale.
 *                        - proposedSeverity: one of info|low|medium|high|severe, or null.
 *                        - proposedReason: 1-sentence justification, or null.
 */
async function analyzeAlert(alert, tenant) {
  // Audit-only contract gate. Per Apr 28 design lock-in ("No AI in audit
  // flow per Jacques") AND the broader audit_only "no alerts, no drift"
  // rule, audit-only tenants must not consume Haiku tokens. Defense-in-
  // depth — alert-engine should already have skipped evaluateTenant.
  if (tenant && tenant.id && !await tenantMode.shouldProcessTenant(tenant.id)) {
    console.log(`[AI] Skipping analysis for tenant ${tenant.id} — audit_only`);
    return null;
  }

  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[AI] No Anthropic API key configured — skipping analysis');
    return null;
  }

  // Lazy-run the locale-column migration the first time we're about to
  // write to the new columns. Mirrors morning-briefing's lazy approach.
  await ensureAlertAiColumns();

  const prompt = buildPrompt(alert, tenant);

  try {
    // Phase 9a (May 2, 2026): output is 3 locales of prose plus the
    // severity envelope in one JSON, roughly 3x the single-locale token
    // cost. Override the global maxTokens (2048 by default — fine for
    // single-locale analysis but truncates 3-locale output) with a 4096
    // cap. Anthropic only charges for actual output tokens, so a higher
    // cap costs nothing if unused.
    const response = await anthropic.messages.create({
      model: config.ai.haikuModel,
      max_tokens: Math.max(config.ai.maxTokens || 0, 4096),
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content?.[0]?.text || null;
    if (!text) return null;

    if (response.usage) {
      console.log(
        `[AI] Haiku tokens — input=${response.usage.input_tokens || 0} ` +
        `output=${response.usage.output_tokens || 0} (3-locale)`
      );
    }

    const parsed = parseStructuredResponse(text);
    return {
      ai_analysis_en: parsed.ai_analysis_en,
      ai_analysis_fr: parsed.ai_analysis_fr,
      ai_analysis_es: parsed.ai_analysis_es,
      proposedSeverity: parsed.proposedSeverity,
      proposedReason: parsed.proposedReason,
    };
  } catch (e) {
    console.error('[AI] Haiku analysis failed:', e.message);
    return null;
  }
}

/**
 * Build the per-alert prompt.
 *
 * Intentionally excludes: the rule's severity (anchoring), correlations
 * with unrelated alerts (confabulation), and any "this is SEVERE, justify it"
 * framing. Supplies the full raw_data, an authoritative-field list, and an
 * error-code taxonomy so Haiku can reach its own verdict.
 *
 * Phase 9a: appends OUTPUT FORMAT instructing Haiku to emit a single JSON
 * envelope with `proposed_severity`, `severity_reason`, and per-locale
 * `en`/`fr`/`es` prose. The severity_reason stays language-agnostic
 * (English) since it feeds machine logic, not operator UI directly.
 */
function buildPrompt(alert, tenant) {
  const rawDataStr = typeof alert.raw_data === 'string'
    ? alert.raw_data
    : JSON.stringify(alert.raw_data ?? {}, null, 2);

  let rawForPrompt = rawDataStr;
  let truncated = false;
  if (rawDataStr.length > RAW_DATA_CAP) {
    rawForPrompt = rawDataStr.substring(0, RAW_DATA_CAP) + '\n...(raw_data truncated)';
    truncated = true;
    console.warn(`[AI] raw_data truncated from ${rawDataStr.length} to ${RAW_DATA_CAP} bytes for alert ${alert.id || '?'}`);
  }

  return `You are a Microsoft 365 security analyst for a managed services provider (MSP).
Analyze ONE alert and produce a structured verdict. You are the second pair of
eyes on a rule-based detection — your job is to say whether the evidence warrants
concern, using ONLY the data below.

═══ AUTHORITATIVE FIELDS ═══

When raw_data contains any of these fields, treat them as primary evidence and
quote them if they materially change the assessment:

  - status.additionalDetails    → Microsoft's own diagnostic text. If it says
                                   "this is not an error" or similar, trust it.
  - status.failureReason        → Human-readable failure description.
  - status.errorCode            → See taxonomy below.
  - conditionalAccessStatus     → success | failure | notApplied | unknownFutureValue.
  - deviceDetail.isCompliant    → Device compliance claim.
  - deviceDetail.isManaged      → Device management claim.
  - riskLevelDuringSignIn       → Entra ID Protection risk signal.
  - ipAddress + location        → Geographic context.

═══ ERROR CODE TAXONOMY ═══

Authentication INTERRUPTS (NOT blocks — downgrade severity, often "info"):
  50097  Device authentication required (compliance interrupt)
  50125  Sign-in was interrupted (password reset, TOU, MFA registration)
  50140  Keep Me Signed In interrupt
  50158  External SSO interrupt
  65001  User or admin consent required
  70044  Session expired, reauth needed

CA terminal DENIES (real blocks — keep at high/severe):
  53000  Device is not compliant
  53002  Application used is not an approved application
  53003  Access has been blocked by Conditional Access policies

Credential / MFA failures (context-dependent — assess by volume/pattern):
  50053  Account locked
  50126  Invalid credentials
  50074  Strong auth required (user failed MFA)
  50097 ≠ 50074 — the former is a policy interrupt, the latter is a user MFA failure.

═══ INPUT ═══

TENANT: ${tenant.display_name}
ALERT: ${alert.message}
POLICY: ${alert.policy_name || 'N/A'}
CATEGORY: ${alert.category || 'N/A'}

RAW_DATA${truncated ? ' (truncated, see log)' : ''}:
${rawForPrompt}

═══ OUTPUT FORMAT (exact) ═══

Output ONLY a single valid JSON object. No preamble, no Markdown fences, no
commentary before or after. The JSON has exactly five top-level keys:

  "proposed_severity": one of "info" | "low" | "medium" | "high" | "severe"
                       (always English token — feeds machine logic, NOT translated).
  "severity_reason":   one English sentence citing the specific raw_data
                       field(s) that drove the choice (machine-readable).
  "en":                English EXPLANATION + ACTION prose (see structure below).
  "fr":                Quebec French (fr-CA) rendition of the same prose.
  "es":                Neutral Spanish rendition of the same prose.

Each per-locale value follows this two-section structure (translate the
section labels naturally per language):

  EXPLANATION: <2-3 sentences grounded in the raw_data above; quote
               authoritative fields where relevant>
  ACTION:      <practical steps the MSP operator should take, OR
               "No action required — [reason]" if benign>

If the evidence indicates a benign event, set proposed_severity to "info"
and write an "ACTION: No action required — [reason]" line in each locale.

LANGUAGE RULES — read carefully:
  - Quebec French (fr-CA): use "Locataire" for tenant, "Stratégie" for policy,
    "Connexion à risque" for risky sign-in. Use « » guillemets for quoted text.
    Technical proper nouns stay English: SharePoint, OneDrive, Conditional
    Access, Intune, Entra, Exchange Online, Defender, etc. Do NOT translate
    error codes, GUIDs, email addresses, IPs, or field names like
    "errorCode" / "additionalDetails".
  - Neutral Spanish (es): use "Inquilino" for tenant, "Política" for policy,
    "Acceso Condicional" for Conditional Access (the phrase, not the product
    chrome — when referring to the Microsoft product feature, leave the
    English term where natural). Same rule for technical proper nouns: leave
    SharePoint, OneDrive, Intune, etc. in English. Avoid regional
    Spanish — pick neutral vocabulary (e.g. "computadora" not "ordenador").
  - Each locale value is a STANDALONE analysis. Do not say "in English" /
    "en français" / "en inglés" or cross-reference between languages.

Example output shape (real values will be much longer than these):
{"proposed_severity":"info","severity_reason":"status.additionalDetails labels error 50097 as a device-auth interrupt, not a denial.","en":"EXPLANATION: ...\\nACTION: No action required — ...","fr":"EXPLICATION : ...\\nACTION : Aucune action requise — ...","es":"EXPLICACIÓN: ...\\nACCIÓN: No se requiere acción — ..."}`;
}

/**
 * Parse Haiku's response. Phase 9a (May 2, 2026): primary path is
 * JSON.parse with markdown-fence stripping (Haiku occasionally wraps in
 * ```json … ```  despite the prompt asking it not to). On JSON failure,
 * fall back to the legacy regex parser so a transitional response that
 * still uses "PROPOSED_SEVERITY:" markers doesn't lose the analysis —
 * we'll pour the freeform text into ai_analysis_en and leave fr/es null
 * (the UI falls back to en when locale columns are empty).
 *
 * Returns:
 *   { ai_analysis_en, ai_analysis_fr, ai_analysis_es, proposedSeverity, proposedReason }
 */
function parseStructuredResponse(text) {
  parseStats.totalParses += 1;

  // Try clean/fenced JSON first.
  const jsonResult = tryParseJson(text);
  if (jsonResult) {
    parseStats.jsonParseHits += 1;
    if (jsonResult.proposedSeverity) parseStats.severityHits += 1;
    else parseStats.severityMisses += 1;
    if (jsonResult.proposedReason) parseStats.reasonHits += 1;
    else parseStats.reasonMisses += 1;
    return jsonResult;
  }

  // JSON parse failed — fall back to the legacy regex parser. Keeps the
  // raw text searchable in the UI even if Haiku temporarily drifts back
  // to the pre-Phase-9a marker format.
  parseStats.jsonParseMisses += 1;
  console.warn('[AI] JSON envelope parse failed — using legacy regex fallback');

  const sevMatch = text.match(/^PROPOSED_SEVERITY\s*:\s*(\w+)/im);
  const reasonMatch = text.match(/^SEVERITY_REASON\s*:\s*(.+?)(?=\n[A-Z_]+\s*:|\n\n|$)/ims);

  let proposedSeverity = null;
  if (sevMatch) {
    const candidate = sevMatch[1].toLowerCase().trim();
    if (VALID_SEVERITIES.has(candidate)) proposedSeverity = candidate;
  }
  if (proposedSeverity) parseStats.severityHits += 1;
  else parseStats.severityMisses += 1;

  let proposedReason = null;
  if (reasonMatch) {
    proposedReason = reasonMatch[1].trim().replace(/\s+/g, ' ');
    if (proposedReason.length > 500) proposedReason = proposedReason.substring(0, 497) + '...';
  }
  if (proposedReason) parseStats.reasonHits += 1;
  else parseStats.reasonMisses += 1;

  return {
    ai_analysis_en: text,
    ai_analysis_fr: null,
    ai_analysis_es: null,
    proposedSeverity,
    proposedReason,
  };
}

/**
 * Try to parse Haiku's response as the Phase 9a JSON envelope.
 * Returns the populated structured object on success, or null on any
 * failure (caller falls back to regex parsing).
 */
function tryParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip markdown fences if Haiku ignored the no-fence instruction.
  // Pattern: optional leading whitespace, ```json or ``` (any case),
  // newlines, content, trailing ``` fence.
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== 'object') return null;

  // Per-locale prose — each must be a non-empty string. If any locale
  // is missing or blank, treat the whole envelope as malformed and let
  // the regex fallback take over (better to have English-only than
  // partial garbage in the dashboard).
  const en = typeof obj.en === 'string' ? obj.en.trim() : '';
  const fr = typeof obj.fr === 'string' ? obj.fr.trim() : '';
  const es = typeof obj.es === 'string' ? obj.es.trim() : '';
  if (!en || !fr || !es) return null;

  // Severity — optional, but if present must be a valid token.
  let proposedSeverity = null;
  if (typeof obj.proposed_severity === 'string') {
    const candidate = obj.proposed_severity.toLowerCase().trim();
    if (VALID_SEVERITIES.has(candidate)) proposedSeverity = candidate;
  }

  // Severity reason — optional, but cap at 500 chars to avoid pathological
  // model output bloating the column.
  let proposedReason = null;
  if (typeof obj.severity_reason === 'string') {
    proposedReason = obj.severity_reason.trim().replace(/\s+/g, ' ');
    if (proposedReason.length > 500) proposedReason = proposedReason.substring(0, 497) + '...';
    if (!proposedReason) proposedReason = null;
  }

  return {
    ai_analysis_en: en,
    ai_analysis_fr: fr,
    ai_analysis_es: es,
    proposedSeverity,
    proposedReason,
  };
}

module.exports = { analyzeAlert, getParseStats, ensureAlertAiColumns };
