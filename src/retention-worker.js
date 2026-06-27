/**
 * Panoptica — Data Retention Worker (Reliability P0, 2026-06-12)
 *
 * Daily loop that enforces configurable retention windows on the tables that
 * previously grew without bound (verified 2026-06-12: the ONLY deletes against
 * them were tenant cascade-delete). On an MSP box with a 40-tenant book this
 * was slow-motion degradation.
 *
 * Governed tables + defaults (env-overridable, days — see config/default.js):
 *   defender_incidents         395  raw ingest; alerts persist independently
 *   identity_timeline_analysis  90  cache — regenerated on demand
 *   heatmap_posture_daily      730  trend data is the QBR story; keep 2 y
 *   message_center_items       365  reference feed
 *   msp_audit_events           730  evidence — long by design
 *   tenant_change_events       730  evidence — long by design
 *
 * EXPLICITLY OUT OF SCOPE: the `alerts` table. Alerts are cross-referenced
 * (identity timeline sources, exemption suppression drawers, PSA ticket
 * links) — alert retention needs its own design. Do not add it here.
 *
 * Deletes are batched (LIMIT per batch + short sleep) so a first run against
 * years of accumulation can't hold long locks. Each cycle stamps the
 * worker_heartbeats registry ('retention') and logs per-table deleted counts.
 *
 * Timestamps: comparisons use UTC_TIMESTAMP()/UTC_DATE() per the project's
 * UTC-everywhere rule. A few governed columns are populated by MySQL
 * DEFAULT CURRENT_TIMESTAMP (session-local) — the few-hour skew is immaterial
 * against 90-730 day windows.
 *
 * A retention window of 0 (or negative) disables retention for that table.
 */

'use strict';

const cron = require('node-cron');
const config = require('../config/default');
const db = require('./db/database');
const workerHeartbeat = require('./worker-heartbeat');

// Batched deletes: bounded lock time per statement, breather between batches.
const BATCH_SIZE = 5000;
const BATCH_SLEEP_MS = 250;

// 03:30 local — offset from the other daily loops (backup 02:00, briefing
// 06:00, audit-expiry 09:00) and from the hourly drift cycles at :00/:30.
const CRON_SCHEDULE = '30 3 * * *';

// One entry per governed table. `column` is the verified time column;
// `dateOnly` switches the cutoff to UTC_DATE() for DATE columns.
// `ensureIndex` adds the retention index via the eager-migration pattern when
// the original CREATE TABLE didn't include a usable one (verified 2026-06-12:
// defender_incidents only has (tenant_id, last_updated_at_utc) — composite
// with tenant_id leading, useless for a global cutoff scan).
const TABLES = [
  {
    table: 'defender_incidents',
    column: 'last_updated_at_utc', // app-written UTC; an incident still being updated is never deleted
    configKey: 'defender_incidents',
    ensureIndex: { name: 'idx_defender_incidents_retention', ddl: 'ALTER TABLE defender_incidents ADD INDEX idx_defender_incidents_retention (last_updated_at_utc)' },
  },
  {
    table: 'identity_timeline_analysis',
    column: 'generated_at',
    configKey: 'identity_timeline_analysis',
    ensureIndex: { name: 'idx_ita_generated', ddl: 'ALTER TABLE identity_timeline_analysis ADD INDEX idx_ita_generated (generated_at)' },
  },
  {
    table: 'heatmap_posture_daily',
    column: 'snapshot_date',
    dateOnly: true,
    configKey: 'heatmap_posture_daily',
    ensureIndex: { name: 'idx_heatmap_snapshot_date', ddl: 'ALTER TABLE heatmap_posture_daily ADD INDEX idx_heatmap_snapshot_date (snapshot_date)' },
  },
  {
    table: 'message_center_items',
    column: 'first_seen_at', // idx_mc_first_seen exists in the base schema
    configKey: 'message_center_items',
  },
  {
    table: 'msp_audit_events',
    column: 'created_at', // idx_created exists in the base schema
    configKey: 'msp_audit_events',
  },
  {
    table: 'tenant_change_events',
    // Hard-delete by row age at the 2-year evidence horizon — applies to
    // soft-deleted (deleted_at set) and live rows alike; deleted_at stays the
    // operator-facing soft-delete signal inside the window, never the
    // retention timestamp.
    column: 'created_at',
    configKey: 'tenant_change_events',
    ensureIndex: { name: 'idx_tce_created', ddl: 'ALTER TABLE tenant_change_events ADD INDEX idx_tce_created (created_at)' },
  },
  {
    // Raw UAL events — the high-volume working copy (Purview is the system of
    // record). Prune by CreationTime; idx_ual_events_pruning (creation_time)
    // already exists in the base schema, so no ensureIndex. ON DELETE CASCADE
    // on the FK is irrelevant here — we delete the child rows directly.
    table: 'ual_events',
    column: 'creation_time',
    configKey: 'ual_events',
  },
  {
    // SharePoint audit jobs (v0.2.26). Prune terminal jobs (done/failed/
    // cancelled) by finished_at; queued/running rows have finished_at NULL so
    // they're never pruned. idx_spaj_finished (finished_at) is created in
    // sharepoint-audit-jobs.ensureSchema(), so no ensureIndex here.
    table: 'sp_audit_jobs',
    column: 'finished_at',
    configKey: 'sp_audit_jobs',
  },
];

let cronJob = null;
let cycleInProgress = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── metric_snapshots (added 2026-06-12, second pass) ───────────────
//
// The polling engine stores a full snapshot of every metric for every tenant
// every poll cycle (~96/day/tenant, fat JSON payloads) and NOTHING ever
// deleted them — the original runRetention() in polling.js was never wired to
// any scheduler (confirmed dead code; Prod hit 20 GB in two months). Verified
// consumers of history (2026-06-12 sweep — the complete list):
//   1. alert-engine getPreviousSnapshot(): needs the PREVIOUS poll only
//      (snapshot-delta alert family: forwarding rules, new admins, etc.)
//   2. api-reports secure-score delta: needs a secure_score reading from up
//      to a report period (90d) ago — and already accepts
//      `daily_agg_secure_score` rows as the period-start value.
// Everything else reads only the latest row. So:
//   - keep RAW_DAYS whole days of full snapshots (alert engine + debugging),
//   - keep ONE end-of-day daily_agg_secure_score row per tenant per day
//     long-term (covers any report period; a few hundred bytes/day),
//   - delete all other raw rows past the window, batched.
// Day-boundary semantics (UTC_DATE) — only whole days are aggregated/pruned,
// so a day's aggregate is always its true last reading, never a partial day.
// Safety ordering: if aggregation fails, the prune is SKIPPED that night —
// raw secure_score rows are never deleted before their daily row exists.

function metricRawDays() {
  const d = Number(config.retention?.metricSnapshots?.rawDays);
  return Number.isFinite(d) ? d : 0;
}
function metricAggDays() {
  const d = Number(config.retention?.metricSnapshots?.aggDays);
  return Number.isFinite(d) ? d : 0;
}

/**
 * Ensure one daily_agg_secure_score row exists per (tenant, day) for every
 * day older than the raw window that has secure_score readings. Idempotent —
 * existing aggregate rows are never rewritten. Returns rows inserted.
 */
async function aggregateSecureScoreDays(rawDays) {
  const tenants = await db.queryRows('SELECT id FROM tenants');
  let inserted = 0;
  for (const tenant of tenants) {
    // Last secure_score reading per whole day older than the window.
    // Drives idx_snapshots_metric (tenant_id, metric_name, captured_at).
    const days = await db.queryRows(
      `SELECT DATE(captured_at) AS day, MAX(captured_at) AS last_at, MAX(service) AS service
         FROM metric_snapshots
        WHERE tenant_id = ? AND metric_name = 'secure_score'
          AND captured_at < DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
        GROUP BY DATE(captured_at)`,
      [tenant.id, rawDays]
    );
    if (days.length === 0) continue;
    const existing = await db.queryRows(
      `SELECT DATE(captured_at) AS day FROM metric_snapshots
        WHERE tenant_id = ? AND metric_name = 'daily_agg_secure_score'`,
      [tenant.id]
    );
    const have = new Set(existing.map(r => String(r.day)));
    for (const d of days) {
      if (have.has(String(d.day))) continue;
      const row = await db.queryOne(
        `SELECT metric_value FROM metric_snapshots
          WHERE tenant_id = ? AND metric_name = 'secure_score' AND captured_at = ?
          LIMIT 1`,
        [tenant.id, d.last_at]
      );
      if (!row) continue;
      const value = typeof row.metric_value === 'object'
        ? JSON.stringify(row.metric_value) : row.metric_value;
      await db.insert(
        `INSERT INTO metric_snapshots (tenant_id, service, metric_name, metric_value, captured_at)
         VALUES (?, ?, 'daily_agg_secure_score', ?, ?)`,
        [tenant.id, d.service || 'security', value, `${d.day} 23:59:59`]
      );
      inserted += 1;
    }
  }
  return inserted;
}

/**
 * The metric_snapshots pass: aggregate first, then batched-prune raw rows
 * older than the raw window, then prune aggregate rows older than the (much
 * longer) aggregate window. Returns a result object for the cycle log.
 */
async function pruneMetricSnapshots() {
  const rawDays = metricRawDays();
  const aggDays = metricAggDays();
  if (rawDays <= 0) return { skipped: 'disabled' };

  const aggregated = await aggregateSecureScoreDays(rawDays);

  // Raw prune — everything but daily_agg_% past the whole-day cutoff, EXCEPT
  // a row that is still the NEWEST of its (tenant, service, metric). Several
  // report/export paths (tenant-snapshot.js, api-reports keyMetrics +
  // fetchLatestServiceData) read "latest per metric" from RAW history — and
  // audit-only tenants poll exactly once, so their single months-old snapshot
  // IS their entire dataset. The EXISTS guard keeps that last state forever
  // (one row per metric — tiny) while everything superseded is deleted.
  // Two-step batches (SELECT ids, DELETE by id) because MySQL forbids LIMIT
  // on a multi-table/correlated DELETE. Outer query range-scans
  // idx_snapshots_captured; the EXISTS probe is one dive into
  // idx_snapshots_metric per candidate row.
  let rawDeleted = 0;
  for (let i = 0; i < 2000; i++) {
    const victims = await db.queryRows(
      `SELECT ms.id
         FROM metric_snapshots ms
        WHERE ms.captured_at < DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
          AND ms.metric_name NOT LIKE 'daily_agg_%'
          AND EXISTS (
            SELECT 1 FROM metric_snapshots newer
             WHERE newer.tenant_id = ms.tenant_id
               AND newer.metric_name = ms.metric_name
               AND newer.service = ms.service
               AND newer.metric_name NOT LIKE 'daily_agg_%'
               AND newer.captured_at > ms.captured_at
          )
        LIMIT ${BATCH_SIZE}`,
      [rawDays]
    );
    if (victims.length === 0) break;
    const ids = victims.map(v => v.id);
    const placeholders = ids.map(() => '?').join(',');
    const affected = await db.execute(
      `DELETE FROM metric_snapshots WHERE id IN (${placeholders})`,
      ids
    );
    rawDeleted += affected;
    if (victims.length < BATCH_SIZE) break;
    await sleep(BATCH_SLEEP_MS);
  }

  // Aggregate-row prune — keeps the Secure Score daily history bounded too.
  let aggDeleted = 0;
  if (aggDays > 0) {
    for (let i = 0; i < 2000; i++) {
      const affected = await db.execute(
        `DELETE FROM metric_snapshots
          WHERE captured_at < DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
            AND metric_name LIKE 'daily_agg_%'
          LIMIT ${BATCH_SIZE}`,
        [aggDays]
      );
      aggDeleted += affected;
      if (affected < BATCH_SIZE) break;
      await sleep(BATCH_SLEEP_MS);
    }
  }

  return { aggregated, deleted: rawDeleted, agg_deleted: aggDeleted, raw_days: rawDays, agg_days: aggDays };
}

/**
 * Eager-migration: add the retention indexes that the original tables lack.
 * Idempotent (INFORMATION_SCHEMA existence check first), deadlock-tolerant,
 * never throws — a missing index degrades batch performance, not correctness.
 */
async function ensureSchema() {
  for (const spec of TABLES) {
    if (!spec.ensureIndex) continue;
    try {
      const row = await db.queryOne(
        `SELECT 1 AS present FROM INFORMATION_SCHEMA.STATISTICS
          WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
        [spec.table, spec.ensureIndex.name]
      );
      if (row) continue;
      await db.executeWithDeadlockRetry(spec.ensureIndex.ddl);
      console.log(`[Retention] Added index ${spec.ensureIndex.name} on ${spec.table}`);
    } catch (e) {
      // ER_DUP_KEYNAME = a concurrent boot already added it — success.
      if (e.code === 'ER_DUP_KEYNAME' || /duplicate key name/i.test(e.message)) continue;
      console.error(`[Retention] ensureSchema failed for ${spec.table}:`, e.message);
    }
  }
}

/** Resolve the configured window (days) for a table spec. */
function windowDays(spec) {
  const days = config.retention && config.retention.days
    ? Number(config.retention.days[spec.configKey])
    : NaN;
  return Number.isFinite(days) ? days : 0;
}

/**
 * Delete everything older than the configured window for one table, in
 * batches. Returns the number of rows deleted.
 */
async function pruneTable(spec, days) {
  const cutoffFn = spec.dateOnly ? 'UTC_DATE()' : 'UTC_TIMESTAMP()';
  const sql = `DELETE FROM ${spec.table}
                WHERE ${spec.column} < DATE_SUB(${cutoffFn}, INTERVAL ? DAY)
                LIMIT ${BATCH_SIZE}`;
  let total = 0;
  // Bounded loop: 2000 batches = 10M rows in one cycle, far beyond any real
  // backlog — a backstop against an impossible runaway, not a working limit.
  for (let i = 0; i < 2000; i++) {
    const affected = await db.execute(sql, [days]);
    total += affected;
    if (affected < BATCH_SIZE) break;
    await sleep(BATCH_SLEEP_MS);
  }
  return total;
}

/**
 * One full retention cycle across all governed tables. Per-table failures are
 * isolated — one broken table never blocks the others. Exposed for tests and
 * a future manual "run now" trigger.
 */
async function runOnce() {
  if (cycleInProgress) {
    console.log('[Retention] Skipping cycle — previous run still in progress');
    return { skipped: true };
  }
  cycleInProgress = true;
  const t0 = Date.now();
  workerHeartbeat.stampStart('retention');
  const results = {};
  let hadError = false;

  try {
    await ensureSchema();
    for (const spec of TABLES) {
      const days = windowDays(spec);
      if (days <= 0) {
        results[spec.table] = { skipped: 'disabled' };
        console.log(`[Retention] ${spec.table}: retention disabled (window <= 0)`);
        continue;
      }
      try {
        const deleted = await pruneTable(spec, days);
        results[spec.table] = { deleted, days };
        if (deleted > 0) {
          console.log(`[Retention] ${spec.table}: deleted ${deleted} row(s) older than ${days}d`);
        }
      } catch (e) {
        hadError = true;
        results[spec.table] = { error: e.message };
        console.error(`[Retention] ${spec.table}: prune failed —`, e.message);
      }
    }

    // metric_snapshots pass (aggregate-then-prune — see header above). An
    // aggregation failure aborts THIS pass only; the prune never runs without
    // its aggregation, and the six simple tables above are unaffected.
    try {
      const m = await pruneMetricSnapshots();
      results.metric_snapshots = m;
      if (m.aggregated || m.deleted || m.agg_deleted) {
        console.log(`[Retention] metric_snapshots: aggregated ${m.aggregated} secure-score day(s), deleted ${m.deleted} raw row(s) older than ${m.raw_days}d (+${m.agg_deleted} aggregate row(s) older than ${m.agg_days}d)`);
      }
    } catch (e) {
      hadError = true;
      results.metric_snapshots = { error: e.message };
      console.error('[Retention] metric_snapshots: pass failed (prune skipped without aggregation) —', e.message);
    }
  } finally {
    cycleInProgress = false;
  }

  const totalDeleted = Object.values(results).reduce((n, r) => n + (r.deleted || 0) + (r.agg_deleted || 0), 0);
  console.log(`[Retention] Cycle complete in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalDeleted} row(s) deleted across ${Object.keys(results).length} tables`);
  if (hadError) {
    workerHeartbeat.stampError('retention', 'one or more tables failed — see [Retention] log lines');
  } else {
    workerHeartbeat.stampSuccess('retention', Date.now() - t0);
  }
  return results;
}

/** Start the daily loop. Idempotent. */
function start() {
  if (cronJob) {
    console.warn('[Retention] start called twice — ignoring duplicate');
    return;
  }
  cronJob = cron.schedule(CRON_SCHEDULE, () => {
    runOnce().catch(err => console.error('[Retention] Unhandled cycle error:', err.message));
  }, { timezone: config.timezone });
  console.log(`[Retention] Scheduler started — daily at 03:30 (${config.timezone})`);

  // Ensure the indexes exist at boot (eager-migration pattern) so the first
  // 03:30 run doesn't pay the scan penalty. Fire-and-forget.
  ensureSchema().catch(() => {});
}

function stop() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[Retention] Scheduler stopped');
  }
}

module.exports = {
  start,
  stop,
  runOnce,
  ensureSchema,
  // Exposed for the read-only Settings card + tests
  TABLES,
  windowDays,
  metricRawDays,
  metricAggDays,
};
