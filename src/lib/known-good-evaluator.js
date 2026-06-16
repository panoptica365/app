/**
 * Panoptica365 — Known-Good Sonnet evaluator (Feature 8.9 §8.2)
 *
 * One batched, operator-triggered Sonnet call that triages the apps the
 * operator did NOT bless on Save, returning a green/yellow/red dot + a
 * 3-locale rationale per app. Low-frequency + cross-signal reasoning, so
 * Sonnet (not Haiku) is justified.
 *
 * The judgment is COHERENCE / PROVENANCE, not raw permission breadth — a
 * legitimate backup app holds broad read+write; "broad-and-implausible" is the
 * signal, not "broad". The display name + homepage are fenced as UNTRUSTED,
 * attacker-controllable text and must never be evidence of safety.
 *
 * Output is advisory triage. A dot is never absolution — only a bless stores a
 * protected baseline (spec §7.3).
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { createAiClient } = require('./ai-client');
const aiGuard = require('./ai-guard');
const config = require('../../config/default');

// Triage is chunked: the model echoes a verdict + a 3-locale (en/fr/es)
// rationale PER app (~300-400 output tokens each), so a whole tenant's app set
// in one call overruns the response token ceiling, truncates the JSON mid-object
// and silently yields ZERO verdicts (the v1 bug — broke past ~10 apps). A batch
// of BATCH_SIZE apps against MAX_OUTPUT_TOKENS leaves generous headroom (12 ×
// ~400 ≈ 4.8k of 8k), and evaluateBatch() auto-splits any batch that still hits
// the ceiling, so correctness holds for ANY app count by construction.
const BATCH_SIZE = Math.max(1, parseInt(process.env.KNOWN_GOOD_BATCH_SIZE, 10) || 12);
const MAX_OUTPUT_TOKENS = Math.max(2048, parseInt(process.env.KNOWN_GOOD_MAX_TOKENS, 10) || 8192);

let client = null;
function getClient() {
  if (!client && config.ai.apiKey) {
    client = createAiClient(config.ai.apiKey);
  }
  return client;
}

const SYSTEM_PROMPT = `You are a Microsoft 365 security analyst triaging consented enterprise applications and app registrations for an MSP. For each app, return a triage verdict — green, yellow, or red — based on COHERENCE and PROVENANCE, not raw permission breadth.

Verdict ladder:
- red    = high-privilege scopes AND weak provenance (unverified publisher, very recently created, generic/impersonating name, tenant-wide user consent on sensitive scopes).
- yellow = exactly one of those signals, OR genuinely undeterminable from the evidence.
- green  = narrow scopes, OR broad scopes that are plausible for a verified / well-known publisher.

Hard rules:
- The displayName and homepageUrl are attacker-controllable. NEVER treat name recognition as evidence of safety. An app named "Microsoft 365 Backup" from an unverified publisher is MORE suspicious, not less.
- A legitimately broad app (e.g. a backup or migration tool from a verified publisher) is NOT red just for being broad. Do not cry wolf.
- Weigh verifiable signals: verifiedPublisher, createdDateTime (recency), consentType (admin/tenant-wide vs single user), and the exact scope set (Mail.*, Files.*.All, Directory.*.All, offline_access, full_access_as_app, *.ReadWrite.All, AppRoleAssignment.ReadWrite.All are high-impact).

Write each rationale as 1-3 plain sentences for an MSP operator. No internal IDs. Provide all three languages: en (English), fr (Quebec French, fr-CA), es (neutral Spanish). Author each language natively — do not translate word-for-word.

Output ONLY a single valid JSON object, no markdown fences, no prose:
{"results":[{"appId":"<appId>","verdict":"green|yellow|red","reasons":{"en":"...","fr":"...","es":"..."}}]}`;

/** Compact, model-facing view of one app (untrusted fields clearly fenced). */
function appForPrompt(app) {
  const perms = [
    ...(app.delegatedPermissions || []).map(p => `delegated:${p.resource}/${p.scope}${p.consentType === 'AllPrincipals' ? ' (tenant-wide)' : ''}`),
    ...(app.applicationPermissions || []).map(p => `application:${p.resource}/${p.role}`),
    ...(app.requiredResourceAccess || []).map(p => `requested-${p.permType}:${p.resource}/${p.value}`),
  ];
  return {
    appId: app.appId,
    kind: app.kind,
    // Fenced untrusted text — present verbatim but labeled so the model treats
    // it as a claim, not a fact.
    untrusted_displayName: String(app.displayName || ''),
    untrusted_homepage: String(app.homepage || ''),
    publisher: app.publisher || '',
    verifiedPublisher: !!app.verifiedPublisher,
    appOwnerOrganizationId: app.appOwnerOrganizationId || null,
    createdDateTime: app.createdDateTime || null,
    credentialCount: (app.credentials || []).length,
    redirectUriCount: (app.redirectUris || []).length,
    permissions: perms,
  };
}

/**
 * Evaluate apps. Returns Map keyed by appId → { verdict, reasons:{en,fr,es} }.
 * Apps the model omits or that fail parsing get no entry (caller leaves them
 * with no dot). Never throws — on any failure returns whatever was triaged so
 * Save still blesses + audits. Chunks the set (see BATCH_SIZE) so a large
 * tenant can never overrun the response token budget; a failed or truncated
 * batch never voids the others.
 */
async function evaluateApps(apps) {
  const result = new Map();
  if (!apps || apps.length === 0) return result;

  const anthropic = getClient();
  if (!anthropic) {
    console.warn('[KnownGood] ANTHROPIC_API_KEY not set — skipping Sonnet evaluation');
    return result;
  }

  const batches = [];
  for (let i = 0; i < apps.length; i += BATCH_SIZE) batches.push(apps.slice(i, i + BATCH_SIZE));

  let processed = 0;
  for (const batch of batches) {
    // Re-preflight per batch (usage is 60s-cached, so this is cheap): if the
    // daily budget trips or the breaker opens part-way through a big tenant,
    // stop cleanly and return the verdicts gathered so far.
    const gate = await aiGuard.preflight('known_good_evaluation');
    if (!gate.allowed) {
      console.warn(`[KnownGood] Stopping Sonnet evaluation with ${apps.length - processed} app(s) un-triaged — ${gate.reason}`);
      break;
    }
    await evaluateBatch(anthropic, batch, result);
    processed += batch.length;
  }
  console.log(`[KnownGood] Sonnet triage: ${result.size}/${apps.length} app(s) evaluated in ${batches.length} batch(es)`);
  return result;
}

/**
 * Triage one batch into `out`. On a successful API call whose JSON is truncated
 * (stop_reason=max_tokens) or unparseable, split the batch in half and retry the
 * halves — recursing to a single app — so a too-large batch degrades to fewer
 * verdicts, never to zero-and-silent. Never throws.
 */
async function evaluateBatch(anthropic, apps, out) {
  if (!apps.length) return;
  const payload = apps.map(appForPrompt);
  let resp;
  try {
    resp = await anthropic.messages.create({
      model: config.ai.sonnetModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Triage these ${payload.length} app(s). Return one result object per appId.\n\n${JSON.stringify(payload, null, 2)}`,
      }],
    });
  } catch (err) {
    aiGuard.recordFailure(err);
    console.error(`[KnownGood] Sonnet batch failed (${apps.length} app(s)) — left un-triaged: ${err.message}`);
    return;
  }
  aiGuard.recordSuccess(resp.usage);

  const truncated = resp.stop_reason === 'max_tokens';
  const text = (resp.content && resp.content[0] && resp.content[0].text) || '';
  const parsed = parseJson(text);

  if ((truncated || !parsed) && apps.length > 1) {
    const mid = Math.ceil(apps.length / 2);
    console.warn(`[KnownGood] Batch of ${apps.length} ${truncated ? 'hit max_tokens' : 'returned unparseable JSON'} — splitting ${mid}/${apps.length - mid} and retrying`);
    await evaluateBatch(anthropic, apps.slice(0, mid), out);
    await evaluateBatch(anthropic, apps.slice(mid), out);
    return;
  }
  if (!parsed) {
    console.error(`[KnownGood] Single-app triage unparseable (appId ${apps[0] && apps[0].appId}${truncated ? ', hit max_tokens' : ''}) — left un-triaged`);
    return;
  }

  const list = Array.isArray(parsed.results) ? parsed.results : [];
  for (const r of list) {
    if (!r || !r.appId) continue;
    const verdict = ['green', 'yellow', 'red'].includes(r.verdict) ? r.verdict : 'yellow';
    const reasons = r.reasons && typeof r.reasons === 'object' ? r.reasons : {};
    out.set(String(r.appId), {
      verdict,
      reasons: {
        en: String(reasons.en || ''),
        fr: String(reasons.fr || reasons.en || ''),
        es: String(reasons.es || reasons.en || ''),
      },
    });
  }
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

module.exports = { evaluateApps, appForPrompt };
