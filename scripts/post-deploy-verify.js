#!/usr/bin/env node
/**
 * Panoptica365 — Post-deploy verification (Reliability 1.6, 2026-06-12).
 *
 * The executable form of the Bundle-F lesson: green offline tests are not
 * "shipped" — make at least one REAL call per ingestion source, and assert
 * the ingest tables are actually receiving rows (defender_incidents sat
 * silently empty for six days because a validator stubbed the network).
 *
 * Run ON THE SERVER after a deploy/restart, with live credentials:
 *
 *   node scripts/post-deploy-verify.js
 *
 * Checks (each independent; the script runs all and exits 1 if any FAIL):
 *   live  graph        — one real Graph call for the first enabled tenant
 *   live  mgmt_api     — one real Management Activity API call (UAL source)
 *   live  psa          — Autotask field-info probe (SKIP if not configured)
 *   live  anthropic    — tiny 1-token Haiku call (SKIP if no API key)
 *   data  metric_snapshots — rows captured in the last 2 hours
 *   data  ual_events       — rows ingested in the last 24 hours
 *   data  defender_incidents — rows ingested in the last 7 days (WARN only:
 *         a genuinely quiet week is possible; silence is suspicious, not fatal)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const results = [];
function report(name, status, detail) {
  results.push({ name, status });
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(`${pad(status, 6)} ${pad(name, 22)} ${detail || ''}`);
}

(async () => {
  const db = require('../src/db/database');
  const config = require('../config/default');

  let tenant = null;
  try {
    tenant = await db.queryOne(
      "SELECT id, tenant_id, display_name FROM tenants WHERE enabled = TRUE AND mode = 'managed' ORDER BY id LIMIT 1"
    );
  } catch (e) {
    report('database', 'FAIL', e.message);
  }
  if (tenant) report('database', 'PASS', `first managed tenant: ${tenant.display_name}`);

  // ── live: Graph ──
  if (tenant) {
    try {
      const graph = require('../src/graph');
      const data = await graph.callGraph(tenant.tenant_id, '/organization?$select=id,displayName');
      const ok = Array.isArray(data?.value) && data.value.length > 0;
      report('graph', ok ? 'PASS' : 'FAIL', ok ? `organization=${data.value[0].displayName}` : 'empty /organization response');
    } catch (e) {
      report('graph', 'FAIL', e.message);
    }
  }

  // ── live: Management Activity API (UAL source) ──
  if (tenant) {
    try {
      const mgmt = require('../src/lib/management-api');
      const subs = await mgmt.listSubscriptions(tenant.tenant_id);
      report('mgmt_api', 'PASS', `${subs.length} UAL subscription(s) on ${tenant.display_name}`);
    } catch (e) {
      report('mgmt_api', 'FAIL', e.message);
    }
  }

  // ── live: PSA (Autotask) ──
  try {
    const psa = require('../src/psa');
    if (!psa.isConfigured()) {
      report('psa', 'SKIP', 'PSA not configured');
    } else {
      const client = require('../src/psa/autotask-client');
      const fields = await client.getTicketFieldInfo();
      report('psa', fields.length > 0 ? 'PASS' : 'FAIL', `${fields.length} ticket field(s)`);
    }
  } catch (e) {
    report('psa', 'FAIL', e.message);
  }

  // ── live: Anthropic ──
  try {
    if (!config.ai.apiKey) {
      report('anthropic', 'SKIP', 'no ANTHROPIC_API_KEY');
    } else {
      const { createAiClient } = require('../src/lib/ai-client');
      const client = createAiClient(config.ai.apiKey, { timeoutMs: 30000 });
      const resp = await client.messages.create({
        model: config.ai.haikuModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      report('anthropic', resp?.id ? 'PASS' : 'FAIL', `model=${resp?.model}`);
    }
  } catch (e) {
    report('anthropic', 'FAIL', e.message);
  }

  // ── data freshness: the silent-empty detectors ──
  const freshness = [
    ['metric_snapshots', "SELECT COUNT(*) AS n FROM metric_snapshots WHERE captured_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)", 'rows in last 2h', 'FAIL'],
    ['ual_events', "SELECT COUNT(*) AS n FROM ual_events WHERE ingested_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)", 'rows in last 24h', 'FAIL'],
    ['defender_incidents', "SELECT COUNT(*) AS n FROM defender_incidents WHERE ingested_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)", 'rows in last 7d', 'WARN'],
  ];
  for (const [name, sql, label, failLevel] of freshness) {
    try {
      const row = await db.queryOne(sql);
      const n = Number(row?.n || 0);
      report(name, n > 0 ? 'PASS' : failLevel, `${n} ${label}`);
    } catch (e) {
      report(name, 'FAIL', e.message);
    }
  }

  const failed = results.filter(r => r.status === 'FAIL');
  const warned = results.filter(r => r.status === 'WARN');
  console.log(`\npost-deploy-verify: ${results.length} checks — ${failed.length} FAIL, ${warned.length} WARN`);
  await db.close().catch(() => {});
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('post-deploy-verify crashed:', e); process.exit(1); });
