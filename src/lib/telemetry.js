/**
 * Panoptica365 — Fleet telemetry client (Reliability 1.8 v1, 2026-06-12).
 *
 * Once instances run in other MSPs' infrastructure, the vendor support model
 * is "wait for an email with a diagnostics bundle". This module sends a small
 * DAILY instance-health summary to the license server so a sick install is
 * visible before the customer churns.
 *
 * ── PRIVACY CONTRACT (allowlist by construction) ─────────────────────────
 * The payload is built field-by-field below — nothing is spread/copied from
 * any internal object, so a field nobody explicitly added can never leak.
 * It contains OPERATIONAL METADATA ONLY:
 *   - install identity (fingerprint + current license JWT for auth)
 *   - app version, release channel, uptime, container/native
 *   - per-health-check STATES (ok/warn/crit — never detail payloads)
 *   - stale worker NAMES (technical ids like 'ual' — never error messages)
 *   - crash counter, DB size (GB), disk used (%), tenant COUNT (a number)
 * Explicitly NEVER sent: tenant names/GUIDs, UPNs, alert content, error
 * message bodies, IPs, configuration values. Customer and tenant data never
 * leaves the install. Document any field change in
 * `Documentation/Panoptica365 - Data Flows & Telemetry.md` + the EULA posture.
 *
 * ── RELIABILITY CONTRACT ─────────────────────────────────────────────────
 * Fully best-effort: its own endpoint (/api/v1/telemetry), NEVER piggybacked
 * onto the license refresh call (a telemetry bug must not be able to break
 * licensing), 15s timeout, all failures swallowed after one quiet log line.
 * A license server that doesn't implement the endpoint yet (404) is logged
 * once per process and otherwise ignored.
 *
 * Toggle: TELEMETRY_ENABLED=false disables entirely (default on — it is also
 * the support signal the vendor relationship is priced on; see data-flows doc).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config/default');
const { fetchWithTimeout } = require('./http-timeout');

const ENABLED = (process.env.TELEMETRY_ENABLED || 'true').toLowerCase() !== 'false';
const INTERVAL_MS = (parseInt(process.env.TELEMETRY_INTERVAL_H, 10) || 24) * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000; // let the first poll cycles populate health
const TELEMETRY_URL = process.env.TELEMETRY_URL
  || (process.env.LICENSE_REFRESH_URL || 'https://license.panoptica365.com/api/v1/refresh')
       .replace(/\/refresh$/, '/telemetry');
const CRASH_COUNTER_PATH = path.join(__dirname, '..', '..', 'data', 'state', 'crash-counter.json');

let timer = null;
let warned404 = false;

function isContainerEnv() {
  try { return fs.existsSync('/.dockerenv'); } catch (_) { return false; }
}

function crashCount() {
  try {
    const c = JSON.parse(fs.readFileSync(CRASH_COUNTER_PATH, 'utf8'));
    return Number(c.count) || 0;
  } catch (_) { return 0; }
}

/** Build the allowlisted payload. Every field is explicit — see header. */
async function buildPayload() {
  const versionInfo = require('../version');
  const db = require('./../db/database');
  const validator = require('./license/validator');
  const health = await require('../routes/api-health').runAllChecks('en');

  const checks = {};
  let staleWorkers = [];
  for (const c of health.checks || []) {
    checks[c.id] = c.state; // STATE ONLY — never the detail payload
    if (c.id === 'worker_liveness' && c.detail && Array.isArray(c.detail.workers)) {
      staleWorkers = c.detail.workers.filter(w => w.state !== 'ok' && !w.idle).map(w => w.id);
    }
  }

  let dbTotalGb = null;
  const dbSize = (health.checks || []).find(c => c.id === 'db_size');
  if (dbSize?.detail?.total_bytes != null) dbTotalGb = Number((dbSize.detail.total_bytes / (1024 ** 3)).toFixed(2));
  let diskUsedPct = null;
  const disk = (health.checks || []).find(c => c.id === 'disk');
  if (disk?.detail?.used_pct != null) diskUsedPct = disk.detail.used_pct;

  let tenantCount = null;
  try {
    const row = await db.queryOne('SELECT COUNT(*) AS n FROM tenants WHERE enabled = TRUE');
    tenantCount = Number(row?.n ?? 0);
  } catch (_) { /* count stays null */ }

  const claims = validator.getLicenseClaims();

  return {
    schema_version: 1,
    sent_at: new Date().toISOString(),
    // identity / auth — the server validates current_jwt exactly like /refresh
    fingerprint: claims?.fingerprint || process.env.PANOPTICA_INSTALL_FINGERPRINT || null,
    current_jwt: require('./license/store').getEnvToken() || null,
    // instance facts
    app_version: versionInfo.version,
    channel: (process.env.UPDATE_CHANNEL || 'stable').toLowerCase() === 'early' ? 'early' : 'stable',
    environment: isContainerEnv() ? 'container' : 'native',
    uptime_seconds: Math.round(process.uptime()),
    tenant_count: tenantCount,
    // health summary — states only
    overall_health: health.overall,
    checks,
    stale_workers: staleWorkers,
    crash_count: crashCount(),
    db_total_gb: dbTotalGb,
    disk_used_pct: diskUsedPct,
  };
}

/** One send. Never throws. */
async function sendOnce() {
  if (!ENABLED) return { skipped: 'disabled' };
  try {
    const payload = await buildPayload();
    const res = await fetchWithTimeout(TELEMETRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 15000);
    if (res.status === 404 || res.status === 405 || res.status === 410) {
      if (!warned404) {
        console.log(`[Telemetry] license server does not implement ${TELEMETRY_URL} yet (${res.status}) — telemetry idle until it does`);
        warned404 = true;
      }
      return { skipped: 'endpoint_absent' };
    }
    if (!res.ok) {
      console.warn(`[Telemetry] send failed: HTTP ${res.status}`);
      return { error: `http_${res.status}` };
    }
    console.log(`[Telemetry] instance health summary sent (overall=${payload.overall_health})`);
    return { ok: true };
  } catch (e) {
    console.warn(`[Telemetry] send failed: ${e.message}`);
    return { error: e.message };
  }
}

/** Start the daily loop. Idempotent; timers never hold the process open. */
function start() {
  if (!ENABLED) {
    console.log('[Telemetry] disabled via TELEMETRY_ENABLED=false');
    return;
  }
  if (timer) return;
  const first = setTimeout(() => {
    sendOnce();
    timer = setInterval(sendOnce, INTERVAL_MS);
    if (timer.unref) timer.unref();
  }, INITIAL_DELAY_MS);
  if (first.unref) first.unref();
  console.log(`[Telemetry] started — daily instance-health summary to ${TELEMETRY_URL} (allowlisted; TELEMETRY_ENABLED=false to opt out)`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, sendOnce, buildPayload, TELEMETRY_URL };
