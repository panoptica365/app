/**
 * Panoptica365 — Sign-in Cache
 *
 * Persists Graph /auditLogs/signIns records into the `signin_cache` table so
 * downstream consumers (notably src/lib/ca-compliance-correlation.js) can do
 * fast, in-database lookups instead of issuing fresh Graph queries per
 * candidate event.
 *
 * Why this exists (UAL Phase 1, May 2026):
 *   The Office 365 Management Activity API (UAL) delivers events with a
 *   60–90 minute latency. Panoptica's geo / IP / mailbox-content evaluators
 *   need to know whether the user's underlying sign-in was gated by a
 *   compliant-device Conditional Access policy — without that signal, every
 *   traveling user on a managed laptop fires noisy alerts (Octiga's failure
 *   mode). Issuing a Graph re-query per UAL candidate event multiplies our
 *   throttling exposure unacceptably; caching the sign-ins we already pull
 *   for the alert engine is the right primitive.
 *
 *   See: Documentation/Panoptica365 — Unified Audit Log Strategy v2.docx §4.7
 *
 * Audit-only contract:
 *   The upstream alert pipeline (alert-engine.js evaluateTenant) already
 *   gates on tenantMode.shouldProcessTenant before calling fetchSignInLogs.
 *   This module re-checks defensively so future code paths (e.g. an
 *   on-demand Graph re-pull) cannot silently bypass the gate.
 *
 * Retention:
 *   14-day rolling. UAL latency is 60–90 min; correlation window is ±10 min.
 *   14 days gives generous headroom for backfill scenarios while keeping
 *   the table small (estimated <50MB per active tenant).
 *
 * Schema migration is eager (fire-and-forget at module load), matching the
 * pattern in src/ai-analysis.js::ensureSeverityAdjustmentSchema. See memory
 * feedback_eager_migration_pattern.md.
 */

const db = require('../db/database');
const tenantMode = require('./tenant-mode');

/**
 * MySQL DATETIME(3) parameter normalizer. Strips the 'Z' suffix and replaces
 * the 'T' separator that JS Date.toISOString() emits — MySQL UPDATE rejects
 * the ISO suffix with "Incorrect datetime value". See ual-events.js for the
 * detailed bug history.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

// Probabilistic pruning hit rate — every Nth cacheSignIns call triggers a
// background prune. Keeps the table bounded without requiring a separate
// scheduler dependency.
const PRUNE_PROBABILITY = 1 / 50;

// Retention window. UAL latency is 60–90 min; correlation window is ±10 min;
// 14 days gives headroom for backfill and operator review.
const RETENTION_DAYS = 14;

let schemaReady = false;
let schemaPromise = null;

/**
 * Idempotent migration. Creates signin_cache if missing.
 *
 * Charset utf8mb4 (matches schema.sql convention). DATETIME(3) for sub-second
 * precision on createdDateTime. UNIQUE on (tenant_id, signin_id) so re-polls
 * within the 30-minute fetch buffer (alert-engine.js line 1031) don't dupe.
 *
 * Note: ingested_at has no MySQL default — MySQL only allows CURRENT_TIMESTAMP
 * as a column default (not UTC_TIMESTAMP), and Panoptica's MySQL session
 * timezone is Eastern. The writer passes UTC_TIMESTAMP(3) explicitly so the
 * stored value is unambiguously UTC. See memory feedback_mysql_utc_timestamp.md.
 */
async function ensureSigninCacheSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS signin_cache (
          id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id            INT UNSIGNED NOT NULL,
          signin_id            VARCHAR(64)  NOT NULL COMMENT 'Microsoft Graph signIn.id',
          created_at           DATETIME(3)  NOT NULL COMMENT 'signIn.createdDateTime in UTC',
          user_upn             VARCHAR(320) DEFAULT NULL,
          user_display_name    VARCHAR(255) DEFAULT NULL,
          ip_address           VARCHAR(64)  DEFAULT NULL,
          country              VARCHAR(8)   DEFAULT NULL COMMENT 'ISO country code (location.countryOrRegion)',
          city                 VARCHAR(128) DEFAULT NULL,
          app_display_name     VARCHAR(255) DEFAULT NULL,
          is_compliant         TINYINT(1)   DEFAULT NULL COMMENT 'deviceDetail.isCompliant',
          is_managed           TINYINT(1)   DEFAULT NULL COMMENT 'deviceDetail.isManaged',
          ca_status            VARCHAR(32)  DEFAULT NULL COMMENT 'success|failure|notApplied|unknownFutureValue',
          status_error_code    INT          DEFAULT NULL COMMENT 'status.errorCode (0 = success)',
          risk_during          VARCHAR(32)  DEFAULT NULL,
          risk_aggregated      VARCHAR(32)  DEFAULT NULL,
          applied_ca_policies  JSON         DEFAULT NULL COMMENT 'Full appliedConditionalAccessPolicies array — required for compliant-device gate detection',
          ingested_at          DATETIME(3)  NOT NULL COMMENT 'When Panoptica wrote this row (UTC)',
          UNIQUE KEY uq_signin_cache_tenant_signin (tenant_id, signin_id),
          INDEX idx_signin_cache_lookup (tenant_id, user_upn, created_at),
          INDEX idx_signin_cache_pruning (created_at),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      schemaReady = true;
      console.log('[SigninCache] Schema ready (signin_cache)');
    } catch (err) {
      console.error('[SigninCache] ensureSigninCacheSchema failed:', err.message);
      // Don't latch the failure; let the next caller retry.
    } finally {
      schemaPromise = null;
    }
  })();

  return schemaPromise;
}

// Eager migration at module load (fire-and-forget). Matches the
// ensureSeverityAdjustmentSchema pattern. Per memory feedback_eager_migration_pattern.md,
// lazy migrations break when a non-migrating code path queries the same table —
// future readers (correlation helper, dashboard queries) shouldn't have to
// each call ensureSigninCacheSchema themselves.
ensureSigninCacheSchema().catch((err) => {
  console.error('[SigninCache] Eager schema migration failed at module load:', err.message);
});

/**
 * Project a Graph signIn record into the cache row shape.
 * Defensive about missing nested fields — Graph occasionally omits
 * deviceDetail or location entirely.
 */
function projectSignIn(signIn) {
  const deviceDetail = signIn.deviceDetail || {};
  const location = signIn.location || {};
  const status = signIn.status || {};

  return {
    signin_id: signIn.id,
    created_at: signIn.createdDateTime,           // ISO string; mysql2 accepts directly when column is DATETIME
    user_upn: signIn.userPrincipalName || null,
    user_display_name: signIn.userDisplayName || null,
    ip_address: signIn.ipAddress || null,
    country: location.countryOrRegion || null,
    city: location.city || null,
    app_display_name: signIn.appDisplayName || null,
    is_compliant: typeof deviceDetail.isCompliant === 'boolean' ? (deviceDetail.isCompliant ? 1 : 0) : null,
    is_managed: typeof deviceDetail.isManaged === 'boolean' ? (deviceDetail.isManaged ? 1 : 0) : null,
    ca_status: signIn.conditionalAccessStatus || null,
    status_error_code: typeof status.errorCode === 'number' ? status.errorCode : null,
    risk_during: signIn.riskLevelDuringSignIn || null,
    risk_aggregated: signIn.riskLevelAggregated || null,
    applied_ca_policies: Array.isArray(signIn.appliedConditionalAccessPolicies)
      ? JSON.stringify(signIn.appliedConditionalAccessPolicies)
      : null,
  };
}

/**
 * Persist a batch of sign-in records for a tenant.
 *
 * Accepts the result shape produced by alert-engine.js::fetchSignInLogs:
 *   { failedSignIns, caBlockedSignIns, successfulSignIns }
 *
 * Idempotent on (tenant_id, signin_id) via INSERT IGNORE — the 30-minute
 * buffer in fetchSignInLogs means the same signin id can appear in
 * consecutive poll cycles. We don't UPSERT because Microsoft sign-in
 * records are immutable post-creation (later enrichment goes into
 * separate audit categories, not back into the original record).
 *
 * @param {number}  tenantId   Panoptica tenants.id (NOT the Entra GUID)
 * @param {object}  buckets    { failedSignIns, caBlockedSignIns, successfulSignIns }
 * @returns {Promise<{ inserted: number, skipped: number }>}
 */
async function cacheSignIns(tenantId, buckets) {
  if (!tenantId) return { inserted: 0, skipped: 0 };

  // Defensive audit-only gate. Upstream evaluateTenant already filters,
  // but if a future caller wires fetchSignInLogs into a different path
  // (e.g. on-demand re-pull from a forensic UI), we must still skip.
  if (!await tenantMode.shouldProcessTenant(tenantId)) {
    return { inserted: 0, skipped: 0 };
  }

  // Make sure schema is ready before any INSERT.
  await ensureSigninCacheSchema();

  const all = []
    .concat(Array.isArray(buckets?.failedSignIns) ? buckets.failedSignIns : [])
    .concat(Array.isArray(buckets?.caBlockedSignIns) ? buckets.caBlockedSignIns : [])
    .concat(Array.isArray(buckets?.successfulSignIns) ? buckets.successfulSignIns : []);

  if (all.length === 0) return { inserted: 0, skipped: 0 };

  // Dedup within the batch first (a single signin can appear in multiple
  // buckets — e.g. CA failure with errorCode != 0 hits both failed AND
  // caBlocked queries). Saves redundant INSERT IGNORE round-trips.
  const seen = new Set();
  const unique = [];
  for (const s of all) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    unique.push(s);
  }

  let inserted = 0;
  let skipped = 0;

  // INSERT IGNORE per row. Could batch with multi-row VALUES, but mysql2's
  // execute() escapes parameters one at a time and the batch size here is
  // typically <500 rows per poll — keep it simple, revisit if profiling
  // shows it's hot.
  for (const signIn of unique) {
    const row = projectSignIn(signIn);
    try {
      const result = await db.execute(
        `INSERT IGNORE INTO signin_cache (
           tenant_id, signin_id, created_at, user_upn, user_display_name,
           ip_address, country, city, app_display_name,
           is_compliant, is_managed, ca_status, status_error_code,
           risk_during, risk_aggregated, applied_ca_policies, ingested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [
          tenantId,
          row.signin_id,
          toMysqlDatetime(row.created_at),
          row.user_upn,
          row.user_display_name,
          row.ip_address,
          row.country,
          row.city,
          row.app_display_name,
          row.is_compliant,
          row.is_managed,
          row.ca_status,
          row.status_error_code,
          row.risk_during,
          row.risk_aggregated,
          row.applied_ca_policies,
        ]
      );
      // mysql2 execute() returns affectedRows; INSERT IGNORE returns 0 on dup.
      if (result && (result === 1 || result.affectedRows === 1)) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      // Don't let cache-write failures bubble up and break the alert pipeline.
      // Log and continue — the alert engine doesn't depend on cache success.
      console.warn(`[SigninCache] Insert failed for tenant ${tenantId} signin ${row.signin_id}: ${err.message}`);
    }
  }

  // Probabilistic prune. Keeps the table bounded without scheduler infra.
  // Hit rate ~1/50; with O(N tenants) pollings/hour, prune fires every few
  // hours per tenant in aggregate.
  if (Math.random() < PRUNE_PROBABILITY) {
    pruneOldEntries().catch((err) => {
      console.warn('[SigninCache] Background prune failed:', err.message);
    });
  }

  return { inserted, skipped };
}

/**
 * Look up cached sign-ins for a (tenant, user) within a time window.
 * Used by ca-compliance-correlation.js to find the sign-in that produced
 * a given UAL event.
 *
 * @param {object}  args
 * @param {number}  args.tenantId   Panoptica tenants.id
 * @param {string}  args.userUpn    User principal name (case-insensitive match)
 * @param {Date}    args.since      Lower bound (inclusive)
 * @param {Date}    args.until      Upper bound (inclusive)
 * @param {string} [args.ipAddress] If provided, prefer rows matching this IP
 * @returns {Promise<Array<object>>} Cached sign-in rows ordered by created_at DESC
 */
async function lookupSignIns({ tenantId, userUpn, since, until, ipAddress }) {
  if (!tenantId || !userUpn || !since || !until) return [];

  // Pass ISO strings, not Date objects — see memory
  // feedback_mysql2_execute_date_objects.md (mysql2 prepared statements
  // reject Date objects with "Incorrect arguments to mysqld_stmt_execute").
  // Use toMysqlDatetime to strip the 'Z' suffix that MySQL also rejects
  // on UPDATE statements; safer to apply uniformly.
  const sinceStr = toMysqlDatetime(since);
  const untilStr = toMysqlDatetime(until);

  const rows = await db.queryRows(
    `SELECT id, tenant_id, signin_id, created_at, user_upn, ip_address,
            country, city, app_display_name, is_compliant, is_managed,
            ca_status, status_error_code, risk_during, risk_aggregated,
            applied_ca_policies
       FROM signin_cache
      WHERE tenant_id = ?
        AND LOWER(user_upn) = LOWER(?)
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [tenantId, userUpn, sinceStr, untilStr]
  );

  // applied_ca_policies comes back already parsed (mysql2 auto-parses JSON
  // columns) per memory feedback_mysql2_json_primitive_reads.md. is_compliant
  // and is_managed come back as 1/0 ints; coerce to boolean for ergonomics.
  const projected = rows.map((r) => ({
    ...r,
    is_compliant: r.is_compliant == null ? null : Boolean(r.is_compliant),
    is_managed: r.is_managed == null ? null : Boolean(r.is_managed),
  }));

  // If caller hinted an IP, sort IP-match first while preserving DESC order
  // within each group. The correlation helper uses this hint to prefer
  // signins from the same source IP as the UAL event.
  if (ipAddress) {
    projected.sort((a, b) => {
      const aMatch = a.ip_address === ipAddress ? 0 : 1;
      const bMatch = b.ip_address === ipAddress ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      // Within same IP-match group, preserve DESC by created_at.
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  return projected;
}

/**
 * Delete signin_cache rows older than the retention window.
 * Idempotent — safe to call concurrently. Returns the number of rows deleted.
 *
 * Uses UTC_TIMESTAMP() per memory feedback_mysql_utc_timestamp.md
 * (Panoptica's MySQL session timezone is Eastern; NOW() comparison would
 * be off by the timezone offset against UTC-stored created_at values).
 */
async function pruneOldEntries() {
  await ensureSigninCacheSchema();
  const result = await db.execute(
    `DELETE FROM signin_cache
      WHERE created_at < (UTC_TIMESTAMP(3) - INTERVAL ? DAY)`,
    [RETENTION_DAYS]
  );
  const deleted = (result && (result.affectedRows ?? result)) || 0;
  if (deleted > 0) {
    console.log(`[SigninCache] Pruned ${deleted} signin_cache row(s) older than ${RETENTION_DAYS} days`);
  }
  return deleted;
}

module.exports = {
  ensureSigninCacheSchema,
  cacheSignIns,
  lookupSignIns,
  pruneOldEntries,
  // Exposed for tests / probes.
  _projectSignIn: projectSignIn,
  RETENTION_DAYS,
};
