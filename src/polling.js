/**
 * Panoptica — Polling Engine (Phase 2 Rewrite)
 * Two-tier polling: live fetchers every cycle, slow fetchers every Nth cycle.
 * Stores metric snapshots and pushes updates via Socket.IO.
 */

const cron = require('node-cron');
const db = require('./db/database');
const fetchers = require('./fetchers');
const alertEngine = require('./alert-engine');

const SLOW_POLL_INTERVAL = 10; // Run slow-tier fetchers every 10th poll

let pollingJob = null;
let io = null;

// Resolves once the poll_count migration has settled. Every poll cycle queries
// poll_count, so the cycle must wait on this — otherwise a fresh install's
// first cycle races the runtime ALTER and emits transient
// "Unknown column 'poll_count'" errors during warm-up.
let migrationsReady = Promise.resolve();

/**
 * Start the polling engine.
 */
function start(socketIO) {
  io = socketIO;

  // Ensure schema columns exist (safe migrations). poll_count is now part of
  // the base schema.sql tenants definition, so on a fresh install this is a
  // no-op safety net; on older DBs it adds the column. Gate the poll cycle on
  // it so no query touches poll_count before it exists.
  migrationsReady = ensurePollCountColumn().catch(err =>
    console.error('[Polling] Failed to add poll_count column:', err.message)
  );
  ensureLatestSnapshotsTable().catch(err =>
    console.error('[Polling] Failed to provision metric_snapshots_latest:', err.message)
  );
  alertEngine.ensureAlertColumns().catch(err =>
    console.error('[Polling] Failed to add alert columns:', err.message)
  );

  // Check every minute for due tenants
  pollingJob = cron.schedule('* * * * *', async () => {
    try {
      await migrationsReady;
      await pollDueTenants();
    } catch (err) {
      console.error('[Polling] Cycle error:', err.message);
    }
  });

  console.log('[Polling] Engine started (checking every minute)');

  // Run immediately on startup — but only after the poll_count migration has
  // settled.
  setTimeout(() => {
    migrationsReady
      .then(() => pollDueTenants())
      .catch(err => console.error('[Polling] Initial poll error:', err.message));
  }, 5000);
}

function stop() {
  if (pollingJob) {
    pollingJob.stop();
    pollingJob = null;
  }
  console.log('[Polling] Engine stopped');
}

/**
 * Ensure poll_count column exists on tenants table.
 *
 * Idempotent and concurrency-tolerant: the column-existence check short-
 * circuits when it's already present, a duplicate-column error from a racing
 * adder is treated as success, and a deadlock / metadata lock-wait timeout
 * (two ALTERs racing — e.g. an overlapping container recreate) is retried
 * once, by which time the other writer has finished and the existence check
 * wins. Never throws — best-effort, same contract as the original.
 */
async function ensurePollCountColumn() {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const cols = await db.queryRows(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'poll_count'"
      );
      if (cols.length > 0) return;  // already present — nothing to do
      await db.execute("ALTER TABLE tenants ADD COLUMN poll_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_polled_at");
      console.log('[Polling] Added poll_count column to tenants table');
      return;
    } catch (e) {
      // A concurrent writer (or schema.sql) already added it — success.
      if (e.code === 'ER_DUP_FIELDNAME' || /duplicate column/i.test(e.message)) return;
      // Two concurrent ALTERs can deadlock or hit a metadata lock-wait
      // timeout. Retry once; the existence check will then short-circuit.
      const retryable = e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT';
      if (retryable && attempt < MAX_ATTEMPTS) {
        console.warn(`[Polling] ensurePollCountColumn ${e.code} — retrying once`);
        continue;
      }
      console.error('[Polling] ensurePollCountColumn error:', e.message);
      return;
    }
  }
}

/**
 * Ensure metric_snapshots_latest exists and is backfilled.
 *
 * Holds one row per (tenant_id, service, metric_name) with the most
 * recent non-aggregate snapshot. The dashboard's /api/tenants/:id/data
 * endpoint reads from this table instead of GROUP BY + MAX over the
 * full metric_snapshots history — which on a managed tenant polled
 * every 15 minutes with 90-day retention is hundreds of thousands of
 * rows. storeSnapshot() keeps this table current via INSERT … ON
 * DUPLICATE KEY UPDATE.
 *
 * Backfill runs once: if the table is empty but metric_snapshots has
 * rows, we seed it from the latest non-aggregate per metric. Subsequent
 * starts skip the backfill since the table is already populated.
 */
async function ensureLatestSnapshotsTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS metric_snapshots_latest (
        tenant_id     INT UNSIGNED NOT NULL,
        service       ENUM('entra', 'exchange', 'sharepoint', 'onedrive', 'teams', 'security') NOT NULL,
        metric_name   VARCHAR(255) NOT NULL,
        metric_value  JSON NOT NULL,
        captured_at   DATETIME NOT NULL,
        PRIMARY KEY (tenant_id, service, metric_name),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    const existing = await db.queryOne('SELECT COUNT(*) AS n FROM metric_snapshots_latest');
    if (existing && existing.n > 0) return;

    const sourceCount = await db.queryOne(
      "SELECT COUNT(*) AS n FROM metric_snapshots WHERE metric_name NOT LIKE 'daily_agg_%'"
    );
    if (!sourceCount || sourceCount.n === 0) {
      console.log('[Polling] metric_snapshots_latest ready (empty — no history to backfill)');
      return;
    }

    console.log(`[Polling] Backfilling metric_snapshots_latest from ${sourceCount.n} snapshot rows...`);
    const inserted = await db.execute(`
      INSERT INTO metric_snapshots_latest (tenant_id, service, metric_name, metric_value, captured_at)
      SELECT ms.tenant_id, ms.service, ms.metric_name, ms.metric_value, ms.captured_at
      FROM metric_snapshots ms
      INNER JOIN (
        SELECT tenant_id, service, metric_name, MAX(captured_at) AS max_captured
        FROM metric_snapshots
        WHERE metric_name NOT LIKE 'daily_agg_%'
        GROUP BY tenant_id, service, metric_name
      ) latest
        ON ms.tenant_id = latest.tenant_id
       AND ms.service = latest.service
       AND ms.metric_name = latest.metric_name
       AND ms.captured_at = latest.max_captured
      WHERE ms.metric_name NOT LIKE 'daily_agg_%'
    `);
    console.log(`[Polling] metric_snapshots_latest backfilled (${inserted} rows)`);
  } catch (e) {
    console.error('[Polling] ensureLatestSnapshotsTable error:', e.message);
  }
}

/**
 * Check which tenants are due for polling and poll them.
 */
async function pollDueTenants() {
  // Purge yesterday's event details before processing any tenants
  try {
    await alertEngine.purgeOldEventDetails();
  } catch (e) {
    console.warn('[Polling] Event detail purge failed:', e.message);
  }

  // Polling selection rules:
  //   - Managed tenants: poll on the regular interval (live tier every cycle,
  //     slow tier every Nth — see SLOW_POLL_INTERVAL).
  //   - Audit-only tenants: poll EXACTLY ONCE — the first poll on add, which
  //     captures the slow tier (security defaults, CA, Intune, etc.) and is
  //     the only data we'll ever export for them. After last_polled_at is
  //     set, they're excluded forever. Manual "Poll Now" still works (that
  //     endpoint doesn't go through this query).
  const tenants = await db.queryRows(
    // psa_name required for notifier's PSA attribution tag — see ual-worker
    // comment for full rationale. Added defensively May 13, 2026 after Bundle F
    // bug revealed the same omission likely affected legacy polling alerts too
    // (just bit less because most testing was on Trilogiam where the default
    // routing happens to be correct).
    `SELECT id, tenant_id, display_name, psa_name, mode, polling_interval, last_polled_at, poll_count
     FROM tenants
     WHERE enabled = TRUE
       AND (
         (mode = 'managed'
            AND (last_polled_at IS NULL
                 OR last_polled_at <= DATE_SUB(NOW(), INTERVAL polling_interval MINUTE)))
         OR
         (mode = 'audit_only' AND last_polled_at IS NULL)
       )`
  );

  if (tenants.length === 0) return;

  console.log(`[Polling] ${tenants.length} tenant(s) due for polling`);

  for (const tenant of tenants) {
    try {
      await pollTenant(tenant);
    } catch (err) {
      console.error(`[Polling] Failed polling "${tenant.display_name}":`, err.message);
    }
  }
}

/**
 * Poll a single tenant.
 * @param {object} tenant - Tenant row from DB
 * @param {object} socketIO - Optional Socket.IO override (for Poll Now)
 * @param {boolean} forceFull - Force a full poll (both tiers)
 */
async function pollTenant(tenant, socketIO, forceFull = false) {
  const emitIO = socketIO || io;
  const startTime = Date.now();
  const currentCount = (tenant.poll_count || 0) + 1;
  const runSlowTier = forceFull || currentCount === 1 || (currentCount % SLOW_POLL_INTERVAL === 0);

  if (runSlowTier) {
    console.log(`[Polling] ${tenant.display_name} — FULL poll (live + slow tier, count=${currentCount})`);
  } else {
    console.log(`[Polling] ${tenant.display_name} — live tier only (count=${currentCount}, next full at ${Math.ceil(currentCount / SLOW_POLL_INTERVAL) * SLOW_POLL_INTERVAL})`);
  }

  const results = {};

  // Build the list of fetcher promises, grouped by service
  const fetcherPromises = [];

  for (const [service, fns] of Object.entries(fetchers.liveFetchers)) {
    for (const fn of fns) {
      fetcherPromises.push({ service, fn, tier: 'live' });
    }
  }

  if (runSlowTier) {
    for (const [service, fns] of Object.entries(fetchers.slowFetchers)) {
      for (const fn of fns) {
        fetcherPromises.push({ service, fn, tier: 'slow' });
      }
    }
  }

  // Run all fetchers (parallel within each service group to be safe with rate limits)
  // Actually, run all in parallel — the Graph module handles retries/backoff
  const settled = await Promise.allSettled(
    fetcherPromises.map(async ({ service, fn, tier }) => {
      try {
        const data = await fn(tenant.tenant_id);
        return { service, data, tier };
      } catch (err) {
        console.error(`[Polling] ${tenant.display_name} — ${tier} fetcher failed:`, err.message);
        return { service, data: null, tier, error: err.message };
      }
    })
  );

  // Process results and store snapshots
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.data) {
      const { service, data } = result.value;
      if (!results[service]) results[service] = {};
      Object.assign(results[service], data);

      // Store each metric key as a separate snapshot
      for (const [metricName, metricValue] of Object.entries(data)) {
        await storeSnapshot(tenant.id, service, metricName, metricValue);
      }
    }
  }

  // Update last_polled_at and poll_count
  await db.execute('UPDATE tenants SET last_polled_at = NOW(), poll_count = ? WHERE id = ?', [currentCount, tenant.id]);

  // ─── Security Settings poll (Phase A1) ───
  // Piggyback on the slow-tier schedule. Read-only, lightweight (~2 Graph
  // calls today; up to ~13 when Phase A1b fills in the rest of the Graph
  // readers). A failure inside pollTenantSecurity must not abort the main
  // poll pass — it self-contains errors per-setting and updates
  // last_check_error on the tenant_security_config row.
  if (runSlowTier) {
    try {
      const secPoll = require('./lib/security-settings/poll');
      // Pass the full tenant row — pollTenantSecurity expects {id, tenant_id}
      // and uses tenant.tenant_id (Azure GUID) for Graph calls, tenant.id
      // (INT) for DB writes. The row we already have satisfies both.
      const secResult = await secPoll.pollTenantSecurity(tenant);
      console.log(`[Polling] ${tenant.display_name} — security settings: ${secResult.pollsRun} checked, ${secResult.errors} errors, ${secResult.unavailable} awaiting infra`);
    } catch (secErr) {
      console.error(`[Polling] Security settings poll failed for "${tenant.display_name}":`, secErr.message);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Polling] ${tenant.display_name} polled in ${elapsed}ms (${Object.keys(results).length} services)`);

  // Run alert engine evaluation
  try {
    const pollResults = { services: results };
    const newAlerts = await alertEngine.evaluateTenant(tenant, pollResults, new Date(startTime));
    if (newAlerts && newAlerts.length > 0) {
      // Push alert updates via Socket.IO
      if (emitIO) {
        emitIO.emit('alerts:new', {
          tenantId: tenant.id,
          displayName: tenant.display_name,
          count: newAlerts.length,
          alerts: newAlerts.map(a => ({ id: a.id, severity: a.severity, message: a.message })),
        });
      }
    }
  } catch (alertErr) {
    console.error(`[Polling] Alert evaluation failed for "${tenant.display_name}":`, alertErr.message);
  }

  // Push real-time update
  if (emitIO) {
    emitIO.emit('tenant:updated', {
      tenantId: tenant.id,
      displayName: tenant.display_name,
      timestamp: new Date().toISOString(),
      services: Object.keys(results),
      fullPoll: runSlowTier,
    });
  }
}

/**
 * Store a metric snapshot in the database.
 *
 * Writes to both metric_snapshots (full history, used for trend/diff
 * analysis and the alert engine) and metric_snapshots_latest (one row
 * per metric, used by the dashboard's "latest values" endpoint). The
 * UPSERT into the latter is what keeps managed-tenant dashboard loads
 * O(1) — see ensureLatestSnapshotsTable() for context.
 */
async function storeSnapshot(tenantDbId, service, metricName, metricValue) {
  // intune_compliance carries a poll-over-poll trend signal — read the
  // previous poll's value out of metric_snapshots_latest BEFORE we
  // overwrite it, then embed previous_percentage + trend into the new
  // payload. Done here (vs. in fetchers.js) because fetchers don't have
  // a DB handle and we want fetchers.js to stay a pure Graph→data layer.
  if (metricName === 'intune_compliance' && metricValue && typeof metricValue === 'object') {
    try {
      const prev = await db.queryOne(
        `SELECT metric_value FROM metric_snapshots_latest
         WHERE tenant_id = ? AND service = ? AND metric_name = 'intune_compliance'`,
        [tenantDbId, service]
      );
      if (prev && prev.metric_value != null) {
        let prevVal = prev.metric_value;
        if (typeof prevVal === 'string') {
          try { prevVal = JSON.parse(prevVal); } catch { prevVal = null; }
        }
        const prevPct = prevVal && typeof prevVal.percentage === 'number' ? prevVal.percentage : null;
        const curPct = typeof metricValue.percentage === 'number' ? metricValue.percentage : null;
        metricValue.previous_percentage = prevPct;
        if (prevPct == null || curPct == null) {
          metricValue.trend = null;
        } else if (curPct > prevPct) {
          metricValue.trend = 'up';
        } else if (curPct < prevPct) {
          metricValue.trend = 'down';
        } else {
          metricValue.trend = 'flat';
        }
      } else {
        metricValue.previous_percentage = null;
        metricValue.trend = null;
      }
    } catch (err) {
      console.warn(`[Polling] intune_compliance trend lookup failed (tenant ${tenantDbId}):`, err.message);
      metricValue.previous_percentage = null;
      metricValue.trend = null;
    }
  }

  const payload = JSON.stringify(metricValue);
  try {
    await db.insert(
      `INSERT INTO metric_snapshots (tenant_id, service, metric_name, metric_value, captured_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [tenantDbId, service, metricName, payload]
    );
  } catch (err) {
    console.error(`[Polling] Snapshot store failed (${service}/${metricName}):`, err.message);
  }
  try {
    await db.execute(
      `INSERT INTO metric_snapshots_latest (tenant_id, service, metric_name, metric_value, captured_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         metric_value = VALUES(metric_value),
         captured_at  = VALUES(captured_at)`,
      [tenantDbId, service, metricName, payload]
    );
  } catch (err) {
    console.error(`[Polling] Latest-snapshot upsert failed (${service}/${metricName}):`, err.message);
  }
}

/**
 * Run retention cleanup.
 */
async function runRetention() {
  const retentionDays = 90;
  console.log(`[Retention] Aggregating snapshots older than ${retentionDays} days...`);

  try {
    const oldMetrics = await db.queryRows(
      `SELECT DISTINCT tenant_id, service, metric_name
       FROM metric_snapshots
       WHERE captured_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [retentionDays]
    );

    let aggregated = 0;
    for (const m of oldMetrics) {
      const days = await db.queryRows(
        `SELECT DATE(captured_at) AS snap_date, COUNT(*) AS cnt
         FROM metric_snapshots
         WHERE tenant_id = ? AND service = ? AND metric_name = ?
           AND captured_at < DATE_SUB(NOW(), INTERVAL ? DAY)
           AND metric_name NOT LIKE 'daily_agg_%'
         GROUP BY DATE(captured_at)`,
        [m.tenant_id, m.service, m.metric_name, retentionDays]
      );

      for (const day of days) {
        const snapshots = await db.queryRows(
          `SELECT metric_value FROM metric_snapshots
           WHERE tenant_id = ? AND service = ? AND metric_name = ?
             AND DATE(captured_at) = ?`,
          [m.tenant_id, m.service, m.metric_name, day.snap_date]
        );

        const lastValue = snapshots[snapshots.length - 1]?.metric_value;
        if (lastValue) {
          await db.insert(
            `INSERT INTO metric_snapshots (tenant_id, service, metric_name, metric_value, captured_at)
             VALUES (?, ?, ?, ?, ?)`,
            [m.tenant_id, m.service, `daily_agg_${m.metric_name}`,
             lastValue, `${day.snap_date} 23:59:59`]
          );
        }

        await db.execute(
          `DELETE FROM metric_snapshots
           WHERE tenant_id = ? AND service = ? AND metric_name = ?
             AND DATE(captured_at) = ?
             AND metric_name NOT LIKE 'daily_agg_%'`,
          [m.tenant_id, m.service, m.metric_name, day.snap_date]
        );

        aggregated += day.cnt;
      }
    }

    console.log(`[Retention] Aggregated ${aggregated} snapshots into daily summaries`);
  } catch (err) {
    console.error('[Retention] Failed:', err.message);
  }
}

module.exports = { start, stop, pollDueTenants, pollTenant, runRetention };
