/**
 * Panoptica365 — Unified Audit Log Worker
 *
 * Orchestrator for UAL ingestion via the Office 365 Management Activity API.
 * Runs on a 5-minute cron loop. Per managed tenant, per content type:
 *   1. Ensure the subscription is active (POST /subscriptions/start)
 *   2. List available content blobs since the last watermark
 *   3. Fetch each blob, parse records, write to ual_events
 *   4. Advance last_blob_time on success
 *
 * Boundary contracts:
 *   - Audit-only tenants are skipped (shouldProcessTenant gate).
 *   - Disabled tenants are skipped (tenants.enabled = FALSE).
 *   - Tenants with no consent for the Management API surface as
 *     401/403 errors → status='error' on ual_subscriptions; the worker
 *     will keep retrying every cycle until consent is granted.
 *   - Per-tenant per-content-type backoff: 3 consecutive failures pauses
 *     attempts for an hour to avoid hammering a structurally broken tenant.
 *
 * Microsoft constraints baked in:
 *   - 7-day blob retention → safe to backfill up to 7 days on first poll
 *   - 24-hour max window per /content call → loop the window
 *   - 15-min subscription-create cooldown → enforced by upstream consent
 *     flow, not here (this worker only creates one subscription per tenant
 *     per cycle because of the per-tenant per-content-type primary key)
 *
 * Reference: Documentation/Panoptica365 — Unified Audit Log Strategy v2.docx §4.3
 */

const db = require('./db/database');
const tenantMode = require('./lib/tenant-mode');
const ualEvents = require('./lib/ual-events');
const mgmtApi = require('./lib/management-api');
const ualEvaluators = require('./ual-evaluators');

const POLL_INTERVAL_MS = 5 * 60 * 1000;            // 5 minutes
const MAX_BACKFILL_DAYS = 7;                        // Microsoft retains blobs 7 days
// Microsoft caps each /content list call at 24h apart. Documented limit is
// "less than or equal to 24 hours" — but empirically (May 14, 2026 across
// 4 of 5 Audit.* subscriptions on Dienamex tenant) the endpoint rejected
// exactly-24h windows with AF20055. Cap at 23h to leave a safety margin
// for clock drift, ISO-conversion rounding, and any strict-less-than
// interpretation on Microsoft's side. Catch-up still works — each cycle
// advances the watermark by up to 23h.
const MAX_WINDOW_HOURS = 23;
const FAILURE_BACKOFF_THRESHOLD = 3;                // consecutive failures before pause
const FAILURE_BACKOFF_HOURS = 1;                    // pause duration after threshold
// Per-(tenant,contentType) blob fetch concurrency. Each blob is one HTTP GET
// against /content/{contentId}; we process them in chunks of this size to
// drop wall-clock time on the 7-day backfill. The management-api retry layer
// absorbs 429s so we don't need a separate throttle — if Microsoft pushes
// back, callManagement honors Retry-After.
//
// Bumped from 5 → 10 on May 5, 2026 to halve backfill catch-up time after
// the toMysqlDatetime fix landed. Empirically, concurrency=5 produced zero
// 429s during 17 hours of catch-up across 14 tenants × 5 content types, so
// 10 is still well within Microsoft's per-tenant budget. If 429s appear, the
// retry layer will report them and we dial back.
const BLOB_FETCH_CONCURRENCY = 10;

let loopHandle = null;
let cycleInProgress = false;

/**
 * Get the list of tenants to process this cycle.
 * Filters: enabled = TRUE AND not audit_only.
 *
 * Note we filter audit_only via the in-memory tenantMode helper rather than
 * a SQL join — this preserves the single source of truth in tenant-mode.js
 * (the mode column lives there, defaults are handled there).
 */
async function listEligibleTenants() {
  // psa_name is required for the notifier's PSA attribution tag —
  // buildAttribution(tenant) reads it to emit "//<PSA_NAME>//" in the
  // email body, which Autotask's parser uses to route the ticket to the
  // correct customer company. Missing → ticket lands under the MSP's own
  // catch-all company. Bit Bundle F's first real alert on May 13, 2026.
  const candidates = await db.queryRows(
    `SELECT id, tenant_id, display_name, psa_name
       FROM tenants
      WHERE enabled = TRUE
      ORDER BY id`
  );
  const eligible = [];
  for (const t of candidates) {
    if (await tenantMode.shouldProcessTenant(t.id)) {
      eligible.push(t);
    }
  }
  return eligible;
}

/**
 * Decide whether a (tenant, content_type) subscription should be skipped
 * this cycle due to recent consecutive failures. Pauses attempts for
 * FAILURE_BACKOFF_HOURS once consecutive_failures >= FAILURE_BACKOFF_THRESHOLD,
 * then allows one trial poll per cycle thereafter.
 */
function shouldBackoff(subRow) {
  if (!subRow) return false;
  if ((subRow.consecutive_failures || 0) < FAILURE_BACKOFF_THRESHOLD) return false;
  if (!subRow.last_error_at) return false;
  const sinceMs = Date.now() - new Date(subRow.last_error_at).getTime();
  return sinceMs < FAILURE_BACKOFF_HOURS * 60 * 60 * 1000;
}

/**
 * Compute the (startTime, endTime) window for a content-list call.
 *
 * Watermark logic:
 *   - If we have last_blob_time, start from there
 *   - Otherwise backfill MAX_BACKFILL_DAYS (capped by Microsoft's 7-day retention)
 *   - Cap window at MAX_WINDOW_HOURS — if there's a gap longer than that,
 *     we'll need multiple cycles to catch up (each cycle advances the watermark
 *     by up to 24h)
 */
function computeWindow(lastBlobTime) {
  const now = new Date();
  const minStart = new Date(now.getTime() - MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  let start = lastBlobTime ? new Date(lastBlobTime) : minStart;
  if (start < minStart) start = minStart;

  // Defend against clock drift / future-dated watermarks. If start >= now
  // (would happen if our server clock lags Microsoft's blob clock, or a
  // bad watermark write put us in the future), pull start back by an hour
  // so we still have a valid window to query. Microsoft's INSERT IGNORE
  // on (tenant_id, record_id) handles the overlap.
  if (start >= now) {
    console.warn(`[UalWorker] computeWindow: start (${start.toISOString()}) >= now (${now.toISOString()}). Likely clock skew or future-dated watermark. Pulling start back 1h.`);
    start = new Date(now.getTime() - 60 * 60 * 1000);
  }

  const maxEnd = new Date(start.getTime() + MAX_WINDOW_HOURS * 60 * 60 * 1000);
  const end = now < maxEnd ? now : maxEnd;

  // Final sanity check — end must be strictly after start. If it isn't (e.g.,
  // now < start by a millisecond due to TZ issue), bail with a synthetic
  // 1-minute window. Caller will retry with a corrected watermark next cycle.
  if (end <= start) {
    console.warn(`[UalWorker] computeWindow: end (${end.toISOString()}) <= start (${start.toISOString()}). Forcing a 1-minute synthetic window.`);
    return { start, end: new Date(start.getTime() + 60 * 1000) };
  }

  return { start, end };
}

/**
 * Process a single (tenant, contentType) pair: ensure subscription, list,
 * fetch, persist. Returns counts for cycle reporting.
 */
async function processSubscription(tenant, contentType, subRow) {
  const result = {
    contentType,
    blobsSeen: 0,
    eventsInserted: 0,
    eventsSkipped: 0,
    eventsMalformed: 0,
    error: null,
  };

  // Ensure the subscription exists (idempotent — Microsoft returns
  // "already enabled" on duplicate starts, which startSubscription absorbs).
  if (!subRow || subRow.status !== 'enabled') {
    try {
      await mgmtApi.startSubscription(tenant.tenant_id, contentType);
      await ualEvents.upsertSubscription(tenant.id, contentType, {
        status: 'enabled',
        clearError: true,
      });
    } catch (err) {
      const msg = err.message || String(err);
      await ualEvents.upsertSubscription(tenant.id, contentType, {
        status: 'error',
        lastError: `subscription start: ${msg}`,
        incrementFailure: true,
      });
      result.error = `subscription start failed: ${msg}`;
      return result;
    }
  }

  // List available blobs since watermark.
  const { start, end } = computeWindow(subRow?.last_blob_time);
  let blobs;
  try {
    blobs = await mgmtApi.listAvailableContent(tenant.tenant_id, contentType, start, end);
  } catch (err) {
    const msg = err.message || String(err);
    await ualEvents.upsertSubscription(tenant.id, contentType, {
      lastError: `list content: ${msg}`,
      incrementFailure: true,
      lastPolledAt: new Date(),
    });
    result.error = `list content failed: ${msg}`;
    return result;
  }

  result.blobsSeen = blobs.length;

  // Sort blobs by contentCreated ascending so a mid-batch failure leaves
  // the watermark at the highest successfully-processed time.
  blobs.sort((a, b) => new Date(a.contentCreated) - new Date(b.contentCreated));

  // Filter out malformed entries up-front so chunk math is clean.
  const validBlobs = blobs.filter(b => b?.contentUri);

  // Process in chunks of BLOB_FETCH_CONCURRENCY. Within each chunk:
  //   - fetch all blobs in parallel
  //   - insert their events
  //   - advance the watermark to the chunk's max contentCreated
  //   - commit watermark to DB (per-chunk persistence — survives restart)
  //
  // If any blob in a chunk fails, the chunk's watermark advances only to
  // the largest contentCreated of SUCCESSFUL blobs in that chunk. Then we
  // stop — next cycle will retry from that watermark. The boundary blob
  // may be re-fetched (Microsoft's startTime filter is inclusive), but
  // INSERT IGNORE on (tenant_id, record_id) handles the dedup.
  let watermarkCandidate = subRow?.last_blob_time ? new Date(subRow.last_blob_time) : null;
  let perBlobError = null;

  for (let i = 0; i < validBlobs.length && !perBlobError; i += BLOB_FETCH_CONCURRENCY) {
    const chunk = validBlobs.slice(i, i + BLOB_FETCH_CONCURRENCY);

    // Fire all chunk fetches concurrently. Use allSettled so one failure
    // doesn't void the whole chunk's work.
    const settled = await Promise.allSettled(
      chunk.map(blob => mgmtApi.fetchContentBlob(tenant.tenant_id, blob.contentUri))
    );

    // Walk the chunk in time order (already sorted ascending). Watermark
    // can only advance to the largest contentCreated such that ALL earlier
    // blobs in this content type also succeeded — otherwise we'd skip past
    // the failed blob on the next cycle and permanently lose its events.
    //
    // After the first in-chunk failure, stop advancing the watermark and
    // stop processing remaining blobs in the chunk. INSERT IGNORE handles
    // the case where post-failure blobs in this chunk would be re-fetched
    // on the next cycle, so it's not a data-correctness issue, just a
    // small amount of wasted HTTP work.
    let firstFailureInChunk = -1;
    for (let j = 0; j < settled.length; j++) {
      const blob = chunk[j];
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        const records = outcome.value;
        const writeResult = await ualEvents.writeUalEvents(tenant.id, records);
        result.eventsInserted += writeResult.inserted;
        result.eventsSkipped += writeResult.skipped;
        result.eventsMalformed += writeResult.malformed;
        // Only advance watermark if no prior blob in this chunk failed —
        // otherwise we'd jump past the failed blob's contentCreated.
        if (firstFailureInChunk === -1) {
          const blobTime = new Date(blob.contentCreated);
          if (!watermarkCandidate || blobTime > watermarkCandidate) {
            watermarkCandidate = blobTime;
          }
        }
      } else {
        if (firstFailureInChunk === -1) firstFailureInChunk = j;
        if (!perBlobError) {
          perBlobError = outcome.reason?.message || String(outcome.reason);
        }
        console.warn(`[UalWorker] Blob fetch failed for tenant ${tenant.id} (${contentType}) ${blob.contentUri}: ${outcome.reason?.message || outcome.reason}`);
      }
    }

    // Commit per-chunk watermark progress (if any). Persisting per-chunk
    // means a server restart mid-cycle re-does at most BLOB_FETCH_CONCURRENCY
    // blobs of already-ingested work, instead of every blob since the last
    // full (tenant, contentType) completion.
    //
    // Wrapped in try/catch so a transient DB issue (lock timeout, connection
    // blip) doesn't propagate up and abandon the events that already made
    // it into ual_events. The watermark stays where it is for next cycle —
    // the worst case is we re-fetch this chunk's blobs (INSERT IGNORE dedups).
    if (watermarkCandidate && (!subRow?.last_blob_time || watermarkCandidate > new Date(subRow.last_blob_time))) {
      try {
        await ualEvents.upsertSubscription(tenant.id, contentType, {
          lastBlobTime: watermarkCandidate,
          lastPolledAt: new Date(),
        });
      } catch (err) {
        console.warn(`[UalWorker] Watermark commit failed for tenant ${tenant.id} (${contentType}) — events already written, will retry next cycle: ${err.message}`);
      }
    }
  }

  // Final upsert handles status / error / consecutive_failures bookkeeping.
  // Watermark is already up-to-date from the chunk loop, so we skip
  // lastBlobTime here to avoid an extra write. Same defensive try/catch
  // posture as the per-chunk upsert — a final-write failure must not
  // wipe out the cycle's event-counting work.
  try {
    await ualEvents.upsertSubscription(tenant.id, contentType, {
      lastPolledAt: new Date(),
      ...(perBlobError
        ? { lastError: `blob fetch: ${perBlobError}`, incrementFailure: true }
        : { clearError: true }),
    });
  } catch (err) {
    console.warn(`[UalWorker] Final subscription bookkeeping failed for tenant ${tenant.id} (${contentType}): ${err.message}`);
  }

  if (perBlobError) result.error = `partial: ${perBlobError}`;
  return result;
}

/**
 * Run one full cycle across all eligible tenants and content types.
 * Concurrent-safe: if a previous cycle is still running, this no-ops.
 *
 * Exposed for testing and for an admin "run UAL now" trigger.
 */
async function runOnce() {
  if (cycleInProgress) {
    console.log('[UalWorker] Skipping cycle — previous run still in progress');
    return { skipped: true };
  }
  cycleInProgress = true;
  const cycleStart = Date.now();

  const summary = {
    tenantsConsidered: 0,
    tenantsProcessed: 0,
    blobsSeenTotal: 0,
    eventsInsertedTotal: 0,
    perTenant: [],
  };

  try {
    const tenants = await listEligibleTenants();
    summary.tenantsConsidered = tenants.length;

    for (const tenant of tenants) {
      const tenantSummary = { tenantId: tenant.id, displayName: tenant.display_name, perContentType: [] };

      // Defensive re-check — tenant mode could have flipped since listEligibleTenants
      if (!await tenantMode.shouldProcessTenant(tenant.id)) {
        console.log(`[UalWorker] Tenant ${tenant.id} flipped to audit-only mid-cycle — skipping`);
        continue;
      }

      // Set the forward-only cutover the first time we see a tenant. Idempotent —
      // only writes if ual_first_seen_at is currently NULL. Existing tenants
      // were backfilled to UTC_TIMESTAMP() at migration; this catches new
      // onboardings that didn't exist at migration time. See Phase 4 design.
      try {
        await ualEvents.markTenantFirstSeen(tenant.id);
      } catch (err) {
        console.warn(`[UalWorker] markTenantFirstSeen failed for tenant ${tenant.id}: ${err.message}`);
      }

      const subscriptionRows = await ualEvents.getSubscriptions(tenant.id);
      const subByType = new Map(subscriptionRows.map(r => [r.content_type, r]));

      for (const contentType of mgmtApi.CONTENT_TYPES) {
        const subRow = subByType.get(contentType);
        if (shouldBackoff(subRow)) {
          tenantSummary.perContentType.push({
            contentType,
            skipped: 'backoff',
            consecutiveFailures: subRow.consecutive_failures,
          });
          continue;
        }
        try {
          const r = await processSubscription(tenant, contentType, subRow);
          tenantSummary.perContentType.push(r);
          summary.blobsSeenTotal += r.blobsSeen;
          summary.eventsInsertedTotal += r.eventsInserted;
        } catch (err) {
          // Defensive — processSubscription should swallow its own errors,
          // but if anything unexpected escapes we log and continue.
          console.error(`[UalWorker] Unhandled error for tenant ${tenant.id} ${contentType}:`, err.message);
          tenantSummary.perContentType.push({ contentType, error: err.message });
        }
      }

      // After ingestion completes for this tenant, run UAL evaluators against
      // the newly-ingested events. Wrapped in try/catch so an evaluator
      // failure cannot wedge ingestion for the rest of the cycle.
      try {
        const evalResult = await ualEvaluators.runEvaluators(tenant);
        tenantSummary.evaluators = evalResult;
        // Sum any fired alerts into the cycle totals for visibility in logs.
        const fired = (evalResult?.mailboxPermission?.fired || 0)
                    + (evalResult?.anomalousGeoFile?.fired || 0)
                    + (evalResult?.oauthConsent?.fired || 0)
                    + (evalResult?.spCredentials?.fired || 0)
                    + (evalResult?.privilegedRole?.fired || 0)
                    + (evalResult?.transportRule?.fired || 0)
                    + (evalResult?.mailboxForwarding?.fired || 0)
                    + (evalResult?.inboxRuleUal?.fired || 0);
        if (fired > 0) {
          summary.alertsFiredTotal = (summary.alertsFiredTotal || 0) + fired;
        }
      } catch (err) {
        console.error(`[UalWorker] runEvaluators failed for tenant ${tenant.id}: ${err.message}`);
        tenantSummary.evaluators = { error: err.message };
      }

      summary.perTenant.push(tenantSummary);
      summary.tenantsProcessed += 1;
    }
  } finally {
    cycleInProgress = false;
  }

  const elapsedSec = ((Date.now() - cycleStart) / 1000).toFixed(1);
  const alertSuffix = summary.alertsFiredTotal ? `, ${summary.alertsFiredTotal} alerts fired` : '';
  console.log(`[UalWorker] Cycle complete in ${elapsedSec}s — ${summary.tenantsProcessed}/${summary.tenantsConsidered} tenants, ${summary.blobsSeenTotal} blobs, ${summary.eventsInsertedTotal} events inserted${alertSuffix}`);
  return summary;
}

/**
 * Start the periodic loop. Runs first cycle immediately, then every
 * POLL_INTERVAL_MS thereafter. Idempotent — calling twice is a no-op.
 */
function startLoop() {
  if (loopHandle) {
    console.warn('[UalWorker] startLoop called twice — ignoring duplicate');
    return;
  }
  console.log(`[UalWorker] Starting loop — interval ${POLL_INTERVAL_MS / 1000}s`);
  // Defer the first run by 30s so we don't pile onto server-startup work.
  setTimeout(() => {
    runOnce().catch(err => console.error('[UalWorker] Initial cycle failed:', err.message));
    loopHandle = setInterval(() => {
      runOnce().catch(err => console.error('[UalWorker] Cycle failed:', err.message));
    }, POLL_INTERVAL_MS);
  }, 30 * 1000);
}

function stopLoop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
    console.log('[UalWorker] Loop stopped');
  }
}

module.exports = {
  runOnce,
  startLoop,
  stopLoop,
  // Exposed for tests / manual operator triggers
  _listEligibleTenants: listEligibleTenants,
  _processSubscription: processSubscription,
  _computeWindow: computeWindow,
  _shouldBackoff: shouldBackoff,
  POLL_INTERVAL_MS,
  MAX_BACKFILL_DAYS,
  MAX_WINDOW_HOURS,
  BLOB_FETCH_CONCURRENCY,
};
