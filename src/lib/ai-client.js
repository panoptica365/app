/**
 * Panoptica365 — Shared Anthropic client factory (Reliability 1.9, 2026-06-12).
 *
 * Every Anthropic SDK client in the app is constructed here so the per-call
 * timeout and retry policy are uniform by construction. Before this module,
 * all nine construction sites used the SDK default timeout of TEN MINUTES —
 * a hung AI call held its worker for that long (see the 1.2 hang analysis;
 * AI calls were the one outbound path the fetchWithTimeout sweep could not
 * cover, because the SDK manages its own HTTP).
 *
 * Defaults: 120s per call (AI_TIMEOUT_MS), 2 SDK-managed retries on 429/5xx.
 * Call sites with legitimately slow work override per-client:
 *   - morning briefing (3-locale Sonnet summary): 300s
 *   - reports (Opus deep analysis, operator-initiated, long by nature): 600s
 *   - settings/setup key tests (operator waiting on a spinner): 30s
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS, 10) || 120000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]   per-call timeout override
 * @param {number} [opts.maxRetries]  SDK retry override
 */
function createAiClient(apiKey, opts = {}) {
  return new Anthropic({
    apiKey,
    timeout: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS,
    maxRetries: Number.isInteger(opts.maxRetries) ? opts.maxRetries : DEFAULT_MAX_RETRIES,
  });
}

module.exports = { createAiClient, DEFAULT_TIMEOUT_MS };
