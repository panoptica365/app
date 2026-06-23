/**
 * Panoptica365 — Email-auth refresh + drift worker (Feature A6 §6, §10)
 *
 * refreshTenant() is shared by the on-demand Refresh button (api-email-auth) and
 * the daily background loop, so both run identical read → score → narrative →
 * snapshot → diff logic.
 *
 * Mode contract (locked 2026-06-22):
 *   - Manual Refresh runs for ANY enabled tenant (managed OR audit_only) — it is
 *     a public-DNS read that populates OUR dns_posture, not a customer-tenant
 *     write, so it is clean under the audit_only contract (src/lib/tenant-mode).
 *   - Drift detection + alerts are MANAGED-ONLY. For audit_only we snapshot +
 *     score + narrate (to populate the dashboard) but never diff or alert.
 *   - The daily loop selects managed tenants only (mirrors drift-scheduler).
 *
 * Robustness (v0.1.23 guard): a domain whose APEX read fails (DnsReadError) is
 * skipped this cycle — its prior snapshot is preserved, never overwritten with a
 * degraded read and never diffed as "everything removed."
 */

'use strict';

const db = require('./db/database');
const graph = require('./graph');
const dnsReader = require('./lib/dns-reader');
const scorer = require('./lib/email-auth-scorer');
const narrator = require('./lib/email-auth-narrator');
const store = require('./lib/email-auth-store');
const tenantMode = require('./lib/tenant-mode');
const alertEngine = require('./alert-engine');
const workerHeartbeat = require('./worker-heartbeat');

const LOOP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const FIRST_RUN_DELAY_MS = 120 * 1000;        // let boot work settle
const MAX_CYCLE_RUNTIME_MS = 30 * 60 * 1000;

let loopHandle = null;
let cycleInProgress = false;
let guardSetAt = 0;

// ── Domain enumeration ────────────────────────────────────────────────────────

/**
 * The tenant's accepted domains via Graph /organization → verifiedDomains
 * (already consented under Organization.Read.All — no new consent, §6/§18.1).
 * onmicrosoft.com routing domains are flagged informational (Microsoft-managed
 * DKIM, no custom DMARC need) and excluded from scoring/drift (§6).
 * @returns {{ scored: Array<{domain,is_primary}>, informational: string[] }}
 */
async function enumerateDomains(tenantGuid) {
  const data = await graph.callGraph(tenantGuid, '/organization?$select=verifiedDomains');
  const org = (data && data.value && data.value[0]) || {};
  const verified = Array.isArray(org.verifiedDomains) ? org.verifiedDomains : [];
  const scored = [];
  const informational = [];
  for (const d of verified) {
    const name = String(d.name || '').toLowerCase().trim();
    if (!name) continue;
    const isOnmicrosoft = d.isInitial === true || /\.onmicrosoft\.com$/i.test(name);
    if (isOnmicrosoft) { informational.push(name); continue; }
    scored.push({ domain: name, is_primary: d.isDefault === true });
  }
  return { scored, informational };
}

// ── Shared refresh ─────────────────────────────────────────────────────────────

/**
 * Read + score + (conditionally) narrate + snapshot + diff every accepted domain
 * for one tenant.
 * @param {object} tenant  { id, tenant_id, display_name, psa_name? }
 * @param {object} opts    { fireAlerts=true, onProgress?: fn }
 * @returns {object} summary { domains, drifted, informational, results: [...] }
 */
async function refreshTenant(tenant, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  await store.ensureSchema();

  // Drift + alerts are managed-only (audit_only gets a point-in-time snapshot).
  const driftEnabled = opts.fireAlerts !== false && await tenantMode.isManaged(tenant.id);

  const { scored: domains, informational } = await enumerateDomains(tenant.tenant_id);
  if (!domains.length) {
    return { domains: 0, drifted: 0, informational, results: [] };
  }

  const results = [];
  let driftedTotal = 0;

  for (const d of domains) {
    onProgress({ stage: 'reading', domain: d.domain });
    let records;
    try {
      records = await dnsReader.readDomain(d.domain);
    } catch (err) {
      // Apex read failed (resolver down/transient). Preserve the prior snapshot;
      // never overwrite with a degraded read or diff it as removed (v0.1.23).
      console.warn(`[EmailAuth] apex read failed for ${d.domain} (tenant ${tenant.id}) — preserving prior snapshot: ${err.message}`);
      results.push({ domain: d.domain, read_error: true });
      onProgress({ stage: 'skipped', domain: d.domain, reason: 'read_error' });
      continue;
    }

    const scored = scorer.scoreDomain(records);
    const newHash = store.computeFindingsHash(scored);
    const prev = await store.getPostureDomain(tenant.id, d.domain);

    // Narrative: regenerate only when the deterministic findings changed (§9).
    // If findings DID change but regen fails, CLEAR the stale narrative (+ its
    // hash, so it retries next cycle) rather than leave prose that contradicts
    // the fresh gauge. If findings are unchanged, carry the cached narrative
    // forward verbatim (no AI call).
    let narrative, narrativeHash;
    const needNarrative = !prev || !prev.narrative || prev.narrative_hash !== newHash;
    if (!needNarrative) {
      narrative = prev.narrative;
      narrativeHash = prev.narrative_hash;
    } else {
      onProgress({ stage: 'narrating', domain: d.domain });
      const n = await narrator.generateNarrative(d.domain, scored, records);
      narrative = n || null;
      narrativeHash = n ? newHash : null;
    }

    // Drift (managed only) — diff against the prior snapshot before overwriting.
    if (driftEnabled && prev) {
      const events = store.detectRegressions(prev, { records, findings: scored.findings });
      for (const ev of events) {
        if (ev.positive) { console.log(`[EmailAuth] positive change ${tenant.id}/${d.domain} ${ev.mechanism}: ${ev.before_value} → ${ev.after_value}`); continue; }
        await fireDrift(tenant, d.domain, ev);
        driftedTotal += 1;
      }
    }

    await store.upsertPosture(tenant.id, {
      domain: d.domain,
      is_primary: d.is_primary,
      records,
      findings: scored.findings,
      detected_providers: records.detected_providers,
      overall_score: scored.overall_score,
      grade: scored.grade,
      non_mail: scored.non_mail,
      narrative,
      narrative_hash: narrativeHash,
    });
    results.push({ domain: d.domain, score: scored.overall_score, grade: scored.grade });
    onProgress({ stage: 'done', domain: d.domain, score: scored.overall_score, grade: scored.grade });
  }

  // Drop posture for domains no longer accepted (managed re-checks only — an
  // audit_only point-in-time refresh shouldn't prune the other view's history).
  if (driftEnabled) await store.pruneDomains(tenant.id, domains.map(d => d.domain));

  return { domains: domains.length, drifted: driftedTotal, informational, results, resolver_mode: dnsReader.getResolverMode() };
}

/** Insert a drift row + fire the email_auth_drift alert (managed only). */
async function fireDrift(tenant, domain, ev) {
  let driftId = null;
  try {
    driftId = await store.insertDrift(tenant.id, { domain, ...ev });
  } catch (err) {
    console.error(`[EmailAuth] drift insert failed (tenant ${tenant.id}, ${domain}): ${err.message}`);
    return;
  }
  const policy = await store.getDriftPolicy();
  if (!policy || !policy.enabled) return;

  const message = `Email authentication on ${domain}: ${ev.mechanism.toUpperCase()} ${ev.change_type} (${ev.before_value} → ${ev.after_value})`;
  const alertData = {
    dedup_key: `email_auth_drift:${domain}:${ev.mechanism}:${ev.change_type}`,
    severity: ev.severity || policy.severity || 'high',
    message,
    raw_data: {
      domain, mechanism: ev.mechanism, change_type: ev.change_type,
      before_value: ev.before_value, after_value: ev.after_value,
      driftId,
      deepLink: { view: 'tenant-dashboard', tenantId: tenant.id, tab: 'email-auth', domain },
    },
  };
  try {
    const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
    if (result && result.id) await store.linkAlert(driftId, result.id);
    if (result && result.isNew && !result.isAutoResolved) {
      alertEngine.processNewAlert(result, tenant).catch(e =>
        console.error(`[EmailAuth] processNewAlert failed for alert ${result.id}: ${e.message}`));
    }
  } catch (err) {
    console.error(`[EmailAuth] drift alert insert failed (tenant ${tenant.id}, ${domain}): ${err.message}`);
  }
}

// ── Daily loop (managed tenants only) ────────────────────────────────────────

async function runOnce() {
  if (cycleInProgress) {
    const ageMs = guardSetAt ? Date.now() - guardSetAt : 0;
    if (ageMs > MAX_CYCLE_RUNTIME_MS) {
      console.error(`[Watchdog] [EmailAuth] previous cycle still in-progress after ${Math.round(ageMs / 60000)} min — abandoning it`);
    } else {
      console.log('[EmailAuth] Skipping cycle — previous run still in progress');
      return { skipped: true };
    }
  }
  cycleInProgress = true;
  guardSetAt = Date.now();
  const start = Date.now();
  workerHeartbeat.stampStart('email_auth');
  let processed = 0;
  let driftedTotal = 0;

  try {
    await store.ensureSchema();
    // Managed-only (mirrors drift-scheduler). audit_only tenants are NEVER in
    // the daily pass — they refresh on demand only (§3, mode contract).
    const tenants = await db.queryRows(
      `SELECT id, tenant_id, display_name, psa_name FROM tenants
        WHERE enabled = TRUE AND mode = 'managed' ORDER BY id`
    );
    for (const tenant of tenants) {
      try {
        const r = await refreshTenant(tenant, { fireAlerts: true });
        processed += 1;
        driftedTotal += r.drifted;
      } catch (err) {
        console.error(`[EmailAuth] refresh failed for tenant ${tenant.id} (${tenant.display_name}): ${err.message}`);
      }
    }
  } catch (err) {
    workerHeartbeat.stampError('email_auth', err.message);
    throw err;
  } finally {
    cycleInProgress = false;
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[EmailAuth] Daily cycle complete in ${secs}s — ${processed} tenant(s), ${driftedTotal} new drift event(s)`);
  workerHeartbeat.stampSuccess('email_auth', Date.now() - start);
  return { processed, driftedTotal };
}

function start() {
  if (loopHandle) { console.warn('[EmailAuth] start called twice — ignoring'); return; }
  console.log(`[EmailAuth] Starting daily email-auth loop (interval ${LOOP_INTERVAL_MS / 3600000}h)`);
  const first = setTimeout(() => {
    runOnce().catch(err => console.error('[EmailAuth] Initial cycle failed:', err.message));
    loopHandle = setInterval(() => {
      runOnce().catch(err => console.error('[EmailAuth] Cycle failed:', err.message));
    }, LOOP_INTERVAL_MS);
    if (loopHandle.unref) loopHandle.unref();
  }, FIRST_RUN_DELAY_MS);
  if (first.unref) first.unref();
}

function stop() {
  if (loopHandle) { clearInterval(loopHandle); loopHandle = null; console.log('[EmailAuth] Daily loop stopped'); }
}

module.exports = { refreshTenant, enumerateDomains, runOnce, start, stop };
