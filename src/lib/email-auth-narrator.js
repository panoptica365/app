/**
 * Panoptica365 — Email-auth AI narrator (Feature A6 §9)
 *
 * Prose ONLY — never scoring. The deterministic scorer owns the gauge; Sonnet
 * gets the findings and writes the per-domain explanation + prioritized,
 * registrar-actionable recommendations, in all three locales in ONE call
 * (i18n Option C). Regenerated only when the findings hash changes (the worker
 * gates this), not on every daily poll.
 *
 * Mirrors known-good-evaluator: createAiClient + ai-guard preflight/record,
 * tolerant JSON parse, never throws (a failed/blocked call just yields no
 * narrative and the tab falls back to the deterministic findings).
 */

'use strict';

const { createAiClient } = require('./ai-client');
const aiGuard = require('./ai-guard');
const config = require('../../config/default');

const MAX_OUTPUT_TOKENS = Math.max(1024, parseInt(process.env.EMAIL_AUTH_NARRATIVE_MAX_TOKENS, 10) || 2200);

let client = null;
function getClient() {
  if (!client && config.ai.apiKey) client = createAiClient(config.ai.apiKey);
  return client;
}

// Reports/narratives route through REPORT_MODEL (Sonnet by default) — §9.
function narratorModel() {
  return process.env.REPORT_MODEL || config.ai.reportModel || config.ai.sonnetModel;
}

const SYSTEM_PROMPT = `You are an email-deliverability and anti-spoofing analyst writing for a Managed Service Provider (MSP) operator. You are given the DETERMINISTIC findings of a public-DNS email-authentication audit for ONE domain (MX, SPF, DKIM, DMARC, and lighter mechanisms). The numeric score and grade are already computed — NEVER recompute, restate as a calculation, or contradict them. Your job is plain-language explanation plus prioritized fixes.

Rules:
- Assume the customer runs Microsoft 365 Business Premium unless the data shows another provider. If a recommendation requires a higher licence (e.g. an Entra ID P2 / Defender for Office 365 P2 capability), say so explicitly.
- Panoptica reads public DNS only and does NOT change records. Frame every fix as an action the operator performs at the domain's DNS host / registrar (e.g. "publish", "tighten", "add a TXT record"). Never imply Panoptica will edit DNS.
- The DKIM verdict can be "indeterminate" (the sender uses per-account selectors that DNS can't enumerate). Do NOT call that a failure — explain it as "could not confirm; verify from a sent-message header."
- Do not invent records or values that are not in the data. No internal IDs or database identifiers.
- Recommendations: 1-5 items, ordered most-impactful first, each one concrete sentence. If posture is already strong, say so and keep recommendations short or empty.

Write natively in each language (do not translate word-for-word): en (English), fr (Quebec French, fr-CA), es (neutral Spanish).

Output ONLY a single valid JSON object, no markdown fences, no prose around it:
{"en":{"summary":"2-4 sentences","recommendations":["...","..."]},"fr":{"summary":"...","recommendations":["..."]},"es":{"summary":"...","recommendations":["..."]}}`;

/** Compact, model-facing view of the deterministic result for ONE domain. */
function buildPayload(domain, scored, records) {
  const r = records || {};
  const fin = (scored && scored.findings) || {};
  const mech = (k) => fin[k] ? { status: fin[k].status, detail: fin[k].detail_key, params: fin[k].detail_params } : null;
  return {
    domain,
    score: scored.overall_score,
    grade: scored.grade,
    non_mail_domain: !!scored.non_mail,
    detected_providers: (r.detected_providers && r.detected_providers.all) || [],
    mx: r.mx ? { present: r.mx.present, hosts: (r.mx.hosts || []).map(h => h.exchange).slice(0, 5) } : null,
    spf: r.spf ? { present: r.spf.present, terminal: r.spf.terminal, lookups: r.spf.lookups, lookup_overflow: r.spf.lookup_overflow } : null,
    dkim: r.dkim ? { state: r.dkim.state, expected: r.dkim.expectedLabel || null, selectors_found: (r.dkim.selectorsFound || []).map(s => s.selector), weak_key: !!r.dkim.weakKey } : null,
    dmarc: r.dmarc ? { present: r.dmarc.present, p: r.dmarc.p, sp: r.dmarc.sp, pct: r.dmarc.pct, has_rua: !!(r.dmarc.rua && r.dmarc.rua.length) } : null,
    dnssec: r.dnssec ? r.dnssec.status : null,
    mta_sts: r.mta_sts ? !!r.mta_sts.present : null,
    tls_rpt: r.tls_rpt ? !!r.tls_rpt.present : null,
    findings: { spf: mech('spf'), dkim: mech('dkim'), dmarc: mech('dmarc'), mx: mech('mx') },
  };
}

/** Tolerant JSON extraction — strips ```json fences, falls back to brace match. */
function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fallthrough */ } }
  return null;
}

function normalizeLocale(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const recs = Array.isArray(o.recommendations) ? o.recommendations.map(s => String(s)).filter(Boolean).slice(0, 6) : [];
  return { summary: String(o.summary || ''), recommendations: recs };
}

/**
 * Generate the 3-locale narrative for one domain. Returns { en, fr, es } or
 * null (no key / budget tripped / parse failure). Never throws.
 * @param {string} domain
 * @param {object} scored   email-auth-scorer.scoreDomain() output
 * @param {object} records  dns-reader.readDomain() output
 */
async function generateNarrative(domain, scored, records) {
  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[EmailAuth] ANTHROPIC_API_KEY not set — skipping narrative');
    return null;
  }
  const gate = await aiGuard.preflight('email_auth_narrative');
  if (!gate.allowed) {
    console.warn(`[EmailAuth] narrative skipped for ${domain} — ${gate.reason}`);
    return null;
  }

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: narratorModel(),
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Explain this domain's email-authentication posture and give prioritized fixes.\n\n${JSON.stringify(buildPayload(domain, scored, records), null, 2)}`,
      }],
    });
  } catch (err) {
    aiGuard.recordFailure(err);
    console.error(`[EmailAuth] narrative call failed for ${domain}: ${err.message}`);
    return null;
  }
  aiGuard.recordSuccess(resp.usage);

  const text = (resp.content && resp.content[0] && resp.content[0].text) || '';
  const parsed = parseJson(text);
  if (!parsed) {
    console.error(`[EmailAuth] narrative JSON unparseable for ${domain}${resp.stop_reason === 'max_tokens' ? ' (hit max_tokens)' : ''}`);
    return null;
  }
  const en = normalizeLocale(parsed.en);
  return {
    en,
    fr: parsed.fr ? normalizeLocale(parsed.fr) : en,
    es: parsed.es ? normalizeLocale(parsed.es) : en,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { generateNarrative, buildPayload };
