/**
 * Panoptica365 — Unified Audit Log Storage Layer
 *
 * Schema, writer, lookup, and pruning for UAL events ingested via the
 * Office 365 Management Activity API. The actual fetcher (subscription
 * bootstrap + blob retrieval) lives in src/ual-worker.js — this module
 * just owns the persistence contract.
 *
 * Schema rationale (per Documentation/Panoptica365 — Unified Audit Log
 * Strategy v2.docx §4.4):
 *   - Two tables: ual_events (the stream) + ual_subscriptions (the
 *     per-tenant per-content-type bookkeeping).
 *   - raw_record JSON preserves the full Microsoft record so future
 *     evaluators can extract fields we didn't normalize at ingest time.
 *   - Indexes cover the three primary query shapes: temporal range,
 *     operation-scoped temporal range, and user-scoped temporal range.
 *   - 13-month retention on raw rows; daily aggregation pattern (deferred
 *     to a later phase) takes over for the 7-year audit trail.
 *
 * Audit-only contract:
 *   This module does NOT defensively gate on tenant_mode — that's the
 *   worker's job (it shouldn't even be polling audit-only tenants in the
 *   first place). If the worker accidentally calls writeUalEvents for an
 *   audit-only tenant, the rows would still be written; the worker is
 *   the right enforcement point and ual-worker.js calls shouldProcessTenant
 *   per-tenant per-poll.
 *
 * Migration is eager (fire-and-forget at module load) per
 * memory feedback_eager_migration_pattern.md.
 */

const db = require('../db/database');

/**
 * Convert a Date or ISO string to a MySQL-DATETIME-compatible literal.
 * MySQL accepts 'YYYY-MM-DD HH:MM:SS.fff' but NOT the trailing 'Z' that
 * Date.toISOString() produces. UPDATE statements against DATETIME(3) columns
 * are particularly strict about this — INSERT is sometimes lenient enough to
 * accept the Z, but UPDATE consistently rejects it with "Incorrect datetime
 * value" (verified against production fleet 2026-05-05).
 *
 * Returns null/undefined unchanged so column NULLs can be set explicitly.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

/**
 * Parse a DATETIME value READ from MySQL into a correct Date. The pool runs with
 * dateStrings:true, so columns come back as "YYYY-MM-DD HH:MM:SS[.fff]" — and we
 * always WRITE UTC (toMysqlDatetime / UTC_TIMESTAMP), so that string is a UTC
 * literal. `new Date(str)` would parse it in the SERVER's local zone; on a
 * non-UTC host (Prod runs America/Toronto) that shifts the value by the UTC
 * offset, pushing the UAL evaluation watermark hours into the future →
 * sinceTime >= untilTime → the "no-window" guard freezes evaluation and events
 * in the gap never alert. Force UTC by appending Z.
 */
function parseDbUtc(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return null;
  return new Date(s.replace(' ', 'T') + 'Z');
}

// 13-month raw retention per UAL Strategy doc §4.5. Daily aggregation
// (deferred to a later phase) takes over for the 7-year audit trail.
const RAW_RETENTION_DAYS = 395;

// Probabilistic pruning to keep the table bounded without a separate
// scheduler. Hit rate ~1/200 because UAL volume is much higher than
// signin_cache — even at low rates we'll prune frequently enough.
const PRUNE_PROBABILITY = 1 / 200;

let schemaReady = false;
let schemaPromise = null;

/**
 * Idempotent migration. Creates ual_events + ual_subscriptions if missing.
 *
 * Notes:
 *   - DATETIME(3) for sub-second precision on creation_time. Microsoft's
 *     UAL records carry millisecond precision and we want to preserve it
 *     for ±10 min correlation against signin_cache.
 *   - UNIQUE on (tenant_id, record_id) so re-fetches of the same content
 *     blob (e.g., worker retry after partial failure) don't duplicate.
 *   - charset utf8mb4 — matches schema.sql convention.
 *   - ingested_at has no MySQL default; writer passes UTC_TIMESTAMP(3)
 *     explicitly. See memory feedback_mysql_utc_timestamp.md (Panoptica's
 *     MySQL session timezone is Eastern; CURRENT_TIMESTAMP would store
 *     Eastern times against UTC creation_time values, breaking range
 *     comparisons).
 */
async function ensureUalSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      // ─── ual_events ─────────────────────────────────────────────────
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ual_events (
          id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id         INT UNSIGNED NOT NULL,
          record_id         VARCHAR(64)  NOT NULL COMMENT 'UAL record Id (typically GUID)',
          workload          VARCHAR(64)  NOT NULL COMMENT 'Audit.Exchange|Audit.SharePoint|Audit.AzureActiveDirectory|Audit.General|DLP.All',
          operation         VARCHAR(128) NOT NULL COMMENT 'MailItemsAccessed, Add-MailboxPermission, Consent to application, etc.',
          record_type       INT          DEFAULT NULL COMMENT 'Microsoft RecordType enum (e.g. 2 = ExchangeAdmin)',
          user_id           VARCHAR(64)  DEFAULT NULL COMMENT 'Entra object id when present',
          user_upn          VARCHAR(320) DEFAULT NULL,
          user_type         VARCHAR(32)  DEFAULT NULL COMMENT 'Regular|Admin|System|Application|ServicePrincipal',
          client_ip         VARCHAR(64)  DEFAULT NULL,
          user_agent        VARCHAR(512) DEFAULT NULL,
          target_resource   JSON         DEFAULT NULL COMMENT 'Normalized: {type, id, name, path}',
          raw_record        JSON         NOT NULL  COMMENT 'Full UAL record blob — source of truth for evaluators',
          creation_time     DATETIME(3)  NOT NULL  COMMENT 'UAL CreationTime field (UTC)',
          ingested_at       DATETIME(3)  NOT NULL  COMMENT 'When Panoptica wrote this row (UTC, set via UTC_TIMESTAMP(3))',
          UNIQUE KEY uq_ual_events_tenant_record (tenant_id, record_id),
          INDEX idx_ual_events_temporal (tenant_id, creation_time),
          INDEX idx_ual_events_op_temporal (tenant_id, operation, creation_time),
          INDEX idx_ual_events_user_temporal (tenant_id, user_upn, creation_time),
          INDEX idx_ual_events_workload_temporal (tenant_id, workload, creation_time),
          INDEX idx_ual_events_pruning (creation_time),
          INDEX idx_ual_events_ingested (tenant_id, ingested_at),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      // ─── ual_subscriptions ──────────────────────────────────────────
      // One row per (tenant, content_type). Five content_types per tenant.
      // status='disabled' is the initial state before subscription is set up;
      // 'enabled' after POST /subscriptions/start succeeds; 'error' if the
      // last attempt failed (operator must investigate).
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ual_subscriptions (
          tenant_id        INT UNSIGNED NOT NULL,
          content_type     VARCHAR(64)  NOT NULL,
          status           ENUM('disabled','enabled','error') NOT NULL DEFAULT 'disabled',
          last_blob_time   DATETIME(3)  DEFAULT NULL COMMENT 'Watermark — most recent blob contentCreated processed',
          last_polled_at   DATETIME(3)  DEFAULT NULL COMMENT 'When worker last attempted a poll',
          last_error       TEXT         DEFAULT NULL,
          last_error_at    DATETIME(3)  DEFAULT NULL,
          consecutive_failures INT      NOT NULL DEFAULT 0,
          created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (tenant_id, content_type),
          INDEX idx_ual_subs_status (status, tenant_id),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      // Jun 16, 2026 — installs created before today lack the (tenant_id,
      // ingested_at) index. Without it, the diagnostics ingestion sub-collector's
      // MAX(ingested_at) GROUP BY tenant full-scans the multi-GB, fat-JSON
      // ual_events table (a 6-9 min support-bundle hang at 1.8M rows). Add it
      // idempotently — INPLACE online DDL, concurrent DML allowed, one-time cost.
      const haveIngestedIdx = await db.queryRows(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ual_events'
            AND INDEX_NAME = 'idx_ual_events_ingested' LIMIT 1`
      );
      if (haveIngestedIdx.length === 0) {
        await db.execute(
          'ALTER TABLE ual_events ADD INDEX idx_ual_events_ingested (tenant_id, ingested_at)'
        );
        console.log('[UalEvents] Added index idx_ual_events_ingested (tenant_id, ingested_at)');
      }

      schemaReady = true;
      console.log('[UalEvents] Schema ready (ual_events, ual_subscriptions)');
    } catch (err) {
      console.error('[UalEvents] ensureUalSchema failed:', err.message);
    } finally {
      schemaPromise = null;
    }
  })();

  return schemaPromise;
}

// Eager migration at module load.
ensureUalSchema().catch((err) => {
  console.error('[UalEvents] Eager schema migration failed at module load:', err.message);
});

/**
 * Phase 4 (May 5, 2026) — adds two columns to the tenants table:
 *   ual_first_seen_at      DATETIME(3)  When Panoptica started watching
 *                                       this tenant for UAL alerts. Events
 *                                       with creation_time <= this value
 *                                       NEVER fire alerts (forward-only
 *                                       cutover, per Jacques's design choice
 *                                       2026-05-05).
 *   ual_last_evaluated_at  DATETIME(3)  When evaluators last processed
 *                                       events for this tenant. Used as the
 *                                       upper bookend of "events to consider
 *                                       this cycle." Updated atomically at
 *                                       the end of each evaluator run.
 *
 * On first migration, ual_first_seen_at is backfilled to UTC_TIMESTAMP() for
 * all existing rows — so the historical events ingested during the May 4-5
 * backfill never fire alerts. New tenants onboarded after migration get
 * ual_first_seen_at set on first poll attempt by ual-worker.js.
 *
 * Eager fire-and-forget at module load, same pattern as ensureUalSchema.
 */
let cutoverColumnsReady = false;
let cutoverColumnsPromise = null;

async function ensureTenantCutoverColumns() {
  if (cutoverColumnsReady) return;
  if (cutoverColumnsPromise) return cutoverColumnsPromise;

  cutoverColumnsPromise = (async () => {
    try {
      const cols = await db.queryRows(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
           AND COLUMN_NAME IN ('ual_first_seen_at', 'ual_last_evaluated_at')`
      );
      const have = new Set(cols.map(c => c.COLUMN_NAME));

      if (!have.has('ual_first_seen_at')) {
        // May 20, 2026 — deadlock-retry helper. api-tenants.js's tenants.mode
        // migration also ALTERs the tenants table at module load (concurrent
        // with this function). On fresh DBs the two ALTERs race and MySQL
        // deadlocks. Retry-with-backoff lets the loser retry post-winner.
        await db.executeWithDeadlockRetry(
          `ALTER TABLE tenants
             ADD COLUMN ual_first_seen_at DATETIME(3) DEFAULT NULL
             COMMENT 'When Panoptica started watching this tenant for UAL alerts (forward-only cutover)'`
        );
        // Backfill existing rows to NOW() — clean-slate semantics so the
        // 7-day backfill ingested during Phase 2b doesn't fire alerts.
        const backfilled = await db.execute(
          `UPDATE tenants SET ual_first_seen_at = UTC_TIMESTAMP(3) WHERE ual_first_seen_at IS NULL`
        );
        const count = (backfilled && (backfilled.affectedRows ?? backfilled)) || 0;
        console.log(`[UalEvents] Added tenants.ual_first_seen_at and backfilled ${count} existing tenant(s) to UTC_TIMESTAMP`);
      }

      if (!have.has('ual_last_evaluated_at')) {
        await db.executeWithDeadlockRetry(
          `ALTER TABLE tenants
             ADD COLUMN ual_last_evaluated_at DATETIME(3) DEFAULT NULL
             COMMENT 'When UAL evaluators last processed events for this tenant'`
        );
        console.log('[UalEvents] Added tenants.ual_last_evaluated_at column');
      }

      cutoverColumnsReady = true;
    } catch (err) {
      console.error('[UalEvents] ensureTenantCutoverColumns failed:', err.message);
    } finally {
      cutoverColumnsPromise = null;
    }
  })();

  return cutoverColumnsPromise;
}

ensureTenantCutoverColumns().catch((err) => {
  console.error('[UalEvents] Eager cutover-columns migration failed at module load:', err.message);
});

/**
 * Set ual_first_seen_at for a tenant if it's NULL. Called by ual-worker
 * the first time it polls a tenant — sets the cutover to NOW for any
 * tenant that didn't get backfilled at migration (i.e., new onboardings).
 *
 * Idempotent: only sets if currently NULL. Existing values are preserved.
 */
async function markTenantFirstSeen(tenantId) {
  if (!tenantId) return;
  await ensureTenantCutoverColumns();
  await db.execute(
    `UPDATE tenants
        SET ual_first_seen_at = UTC_TIMESTAMP(3)
      WHERE id = ? AND ual_first_seen_at IS NULL`,
    [tenantId]
  );
}

/**
 * Update ual_last_evaluated_at to the given timestamp. Called by ual-evaluators
 * at the end of each cycle so the next cycle only considers events newer
 * than this watermark.
 */
async function setTenantLastEvaluatedAt(tenantId, when) {
  if (!tenantId) return;
  await ensureTenantCutoverColumns();
  await db.execute(
    `UPDATE tenants SET ual_last_evaluated_at = ? WHERE id = ?`,
    [toMysqlDatetime(when), tenantId]
  );
}

/**
 * Read the cutover state for a tenant — used by evaluators to compute the
 * lower bound of events to process this cycle.
 * Returns { ual_first_seen_at, ual_last_evaluated_at } as Date objects (or null).
 */
async function getTenantCutoverState(tenantId) {
  if (!tenantId) return { ual_first_seen_at: null, ual_last_evaluated_at: null };
  await ensureTenantCutoverColumns();
  const row = await db.queryOne(
    `SELECT ual_first_seen_at, ual_last_evaluated_at FROM tenants WHERE id = ? LIMIT 1`,
    [tenantId]
  );
  return {
    // parseDbUtc (not new Date) — these are UTC literals; local parsing freezes
    // the watermark on non-UTC hosts. See parseDbUtc above.
    ual_first_seen_at: parseDbUtc(row && row.ual_first_seen_at),
    ual_last_evaluated_at: parseDbUtc(row && row.ual_last_evaluated_at),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Record projection
// ──────────────────────────────────────────────────────────────────────

/**
 * Project a Microsoft UAL record into the ual_events row shape.
 *
 * Microsoft's UAL records are workload-shaped — same top-level fields
 * (Id, CreationTime, Operation, UserId, etc.) but each workload has its
 * own nested payload (ExchangeMetaData, SourceFileName, ObjectId, etc.).
 * We normalize the common fields and stash the full record in raw_record
 * for evaluators to mine.
 *
 * @param {object} record  Raw UAL record from a content blob
 * @returns {object|null}  Row data for INSERT, or null if record is malformed
 */
function projectUalRecord(record) {
  if (!record || typeof record !== 'object') return null;

  // Microsoft uses PascalCase for UAL fields (Id, CreationTime, Operation,
  // UserId, ClientIP, UserAgent, etc.). Defensive about each one — Microsoft
  // occasionally renames or omits fields between workloads.
  const recordId = record.Id || record.id;
  const creationTime = record.CreationTime || record.creationTime;
  const workload = record.Workload || record.workload;
  const operation = record.Operation || record.operation;

  // Guard: these four are non-negotiable. A record without them is malformed
  // and we can't index it usefully.
  if (!recordId || !creationTime || !workload || !operation) return null;

  // Best-effort target resource extraction. UAL records vary widely:
  //   - Exchange: MailboxOwnerUPN, ItemAttachments, ItemId, etc.
  //   - SharePoint: SiteUrl, ObjectId, SourceFileName, SourceRelativeUrl
  //   - AzureActiveDirectory: ObjectId, ModifiedProperties, Target
  //   - General: depends entirely on the operation
  // We extract a normalized hint here; evaluators read raw_record for detail.
  const targetResource = extractTargetResource(record);

  return {
    record_id: String(recordId),
    workload: String(workload),
    operation: String(operation),
    record_type: typeof record.RecordType === 'number' ? record.RecordType : null,
    user_id: record.UserId ? String(record.UserId) : null,
    user_upn: record.UserPrincipalName || record.UserId || null,
    user_type: typeof record.UserType === 'string' ? record.UserType
              : typeof record.UserType === 'number' ? String(record.UserType)
              : null,
    client_ip: record.ClientIP || record.ClientIPAddress || null,
    user_agent: record.UserAgent || (record.ExtendedProperties || []).find?.(p => p?.Name === 'UserAgent')?.Value || null,
    target_resource: targetResource ? JSON.stringify(targetResource) : null,
    raw_record: JSON.stringify(record),
    creation_time: String(creationTime),  // Microsoft returns ISO 8601 UTC string
  };
}

/**
 * Best-effort normalization of the "what was acted on" hint.
 * Format: { type, id, name, path } — all optional.
 *
 * Workload-specific inspection. Returns null if nothing identifiable.
 */
function extractTargetResource(record) {
  const out = {};

  // ObjectId is a fairly universal target identifier across workloads.
  if (record.ObjectId) out.id = String(record.ObjectId);

  // SharePoint files
  if (record.SourceFileName) out.name = String(record.SourceFileName);
  if (record.SourceRelativeUrl) out.path = String(record.SourceRelativeUrl);
  if (record.SiteUrl) {
    out.path = out.path ? `${record.SiteUrl}/${out.path}` : String(record.SiteUrl);
    out.type = out.type || 'sharepoint_site';
  }

  // Exchange mailbox
  if (record.MailboxOwnerUPN) {
    out.id = out.id || String(record.MailboxOwnerUPN);
    out.type = out.type || 'mailbox';
  }
  if (record.MailboxGuid) out.id = out.id || String(record.MailboxGuid);

  // Entra (AzureActiveDirectory)
  if (record.Target && Array.isArray(record.Target)) {
    const targetUpn = record.Target.find(t => t?.Type === 5 || t?.type === 5)?.ID;
    if (targetUpn) {
      out.id = out.id || String(targetUpn);
      out.type = out.type || 'entra_user';
    }
  }
  if (record.ApplicationId) {
    out.id = out.id || String(record.ApplicationId);
    out.type = out.type || 'entra_application';
  }

  return Object.keys(out).length > 0 ? out : null;
}

// ──────────────────────────────────────────────────────────────────────
// Writer
// ──────────────────────────────────────────────────────────────────────

/**
 * Persist a batch of UAL records for a tenant.
 *
 * Idempotent on (tenant_id, record_id) via INSERT IGNORE. Microsoft can
 * deliver the same record across overlapping content-blob fetches
 * (especially during worker restart / backfill). Dupe-suppression is
 * the writer's responsibility.
 *
 * Failures on individual rows are logged and skipped — a malformed record
 * must not block ingestion of valid sibling records in the same blob.
 *
 * @param {number}        tenantId  Panoptica tenants.id (NOT the Entra GUID)
 * @param {Array<object>} records   Raw UAL records from a content blob
 * @returns {Promise<{ inserted: number, skipped: number, malformed: number }>}
 */
async function writeUalEvents(tenantId, records) {
  if (!tenantId || !Array.isArray(records) || records.length === 0) {
    return { inserted: 0, skipped: 0, malformed: 0 };
  }

  await ensureUalSchema();

  let inserted = 0;
  let skipped = 0;
  let malformed = 0;

  for (const record of records) {
    const row = projectUalRecord(record);
    if (!row) {
      malformed += 1;
      continue;
    }
    try {
      const result = await db.execute(
        `INSERT IGNORE INTO ual_events (
           tenant_id, record_id, workload, operation, record_type,
           user_id, user_upn, user_type, client_ip, user_agent,
           target_resource, raw_record, creation_time, ingested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [
          tenantId,
          row.record_id,
          row.workload,
          row.operation,
          row.record_type,
          row.user_id,
          row.user_upn,
          row.user_type,
          row.client_ip,
          row.user_agent,
          row.target_resource,
          row.raw_record,
          toMysqlDatetime(row.creation_time),
        ]
      );
      if (result && (result === 1 || result.affectedRows === 1)) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      console.warn(`[UalEvents] Insert failed for tenant ${tenantId} record ${row.record_id}: ${err.message}`);
    }
  }

  if (Math.random() < PRUNE_PROBABILITY) {
    pruneOldEvents().catch((err) => {
      console.warn('[UalEvents] Background prune failed:', err.message);
    });
  }

  return { inserted, skipped, malformed };
}

/**
 * Look up UAL events for a tenant within a time window, optionally filtered.
 *
 * Used by evaluators (Phase 4+) to inspect recent events. Indexes on
 * (tenant_id, creation_time), (tenant_id, operation, creation_time), and
 * (tenant_id, user_upn, creation_time) cover the common query shapes.
 *
 * @param {object}   args
 * @param {number}   args.tenantId
 * @param {Date|string} args.since
 * @param {Date|string} args.until
 * @param {string}  [args.operation]   Filter by Operation field
 * @param {string}  [args.workload]    Filter by Workload field
 * @param {string}  [args.userUpn]     Filter by UserPrincipalName
 * @param {number}  [args.limit]       Default 1000
 * @returns {Promise<Array<object>>}   ual_events rows
 */
async function lookupEvents({ tenantId, since, until, operation, workload, userUpn, limit = 1000 }) {
  if (!tenantId || !since || !until) return [];

  // Strip ISO 'Z' suffix and convert T → space — MySQL DATETIME literals
  // reject the Z, especially on UPDATE statements. Apply uniformly.
  const sinceStr = toMysqlDatetime(since);
  const untilStr = toMysqlDatetime(until);

  const where = ['tenant_id = ?', 'creation_time >= ?', 'creation_time <= ?'];
  const params = [tenantId, sinceStr, untilStr];

  if (operation) {
    where.push('operation = ?');
    params.push(operation);
  }
  if (workload) {
    where.push('workload = ?');
    params.push(workload);
  }
  if (userUpn) {
    where.push('LOWER(user_upn) = LOWER(?)');
    params.push(userUpn);
  }

  // LIMIT inlined as a literal — mysql2 + MySQL prepared-statement protocol
  // has known asymmetric behavior with LIMIT/OFFSET as bound parameters that
  // can produce "Incorrect arguments to mysqld_stmt_execute" depending on
  // server version. Reproduced May 5 2026 — every UAL evaluator failed with
  // that exact error until this LIMIT was inlined. parseInt + clamp above
  // means the value is a sanitized integer literal, no SQL injection vector.
  const limitN = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 10000);

  return db.queryRows(
    `SELECT id, tenant_id, record_id, workload, operation, record_type,
            user_id, user_upn, user_type, client_ip, user_agent,
            target_resource, raw_record, creation_time, ingested_at
       FROM ual_events
      WHERE ${where.join(' AND ')}
      ORDER BY creation_time DESC
      LIMIT ${limitN}`,
    params
  );
}

/**
 * Delete ual_events rows older than the retention window.
 * UTC_TIMESTAMP per memory feedback_mysql_utc_timestamp.md.
 */
async function pruneOldEvents() {
  await ensureUalSchema();
  const result = await db.execute(
    `DELETE FROM ual_events
      WHERE creation_time < (UTC_TIMESTAMP(3) - INTERVAL ? DAY)`,
    [RAW_RETENTION_DAYS]
  );
  const deleted = (result && (result.affectedRows ?? result)) || 0;
  if (deleted > 0) {
    console.log(`[UalEvents] Pruned ${deleted} ual_events row(s) older than ${RAW_RETENTION_DAYS} days`);
  }
  return deleted;
}

// ──────────────────────────────────────────────────────────────────────
// Subscription bookkeeping
// ──────────────────────────────────────────────────────────────────────

/**
 * Upsert subscription state for a (tenant, content_type) pair.
 * Used by the worker to record subscription lifecycle and watermark progress.
 *
 * @param {number} tenantId
 * @param {string} contentType   Audit.Exchange|Audit.SharePoint|...
 * @param {object} state         Partial — only the fields you want to update
 * @param {'disabled'|'enabled'|'error'} [state.status]
 * @param {Date|string} [state.lastBlobTime]
 * @param {Date|string} [state.lastPolledAt]
 * @param {string} [state.lastError]      Setting non-null marks last_error_at = UTC_TIMESTAMP
 * @param {boolean} [state.clearError]    True wipes last_error / last_error_at and resets consecutive_failures
 * @param {boolean} [state.incrementFailure]  True bumps consecutive_failures
 */
async function upsertSubscription(tenantId, contentType, state = {}) {
  if (!tenantId || !contentType) return;
  await ensureUalSchema();

  // First, ensure a row exists (status='disabled' default).
  await db.execute(
    `INSERT INTO ual_subscriptions (tenant_id, content_type)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId, contentType]
  );

  // Then patch the requested fields. Build the UPDATE dynamically so we
  // only touch what the caller specified — partial updates are common.
  const sets = [];
  const params = [];

  if (state.status) {
    sets.push('status = ?');
    params.push(state.status);
  }
  if (state.lastBlobTime !== undefined) {
    sets.push('last_blob_time = ?');
    params.push(toMysqlDatetime(state.lastBlobTime));
  }
  if (state.lastPolledAt !== undefined) {
    sets.push('last_polled_at = ?');
    params.push(toMysqlDatetime(state.lastPolledAt));
  }
  if (state.lastError !== undefined) {
    sets.push('last_error = ?');
    sets.push('last_error_at = UTC_TIMESTAMP(3)');
    params.push(state.lastError);
  }
  if (state.clearError) {
    sets.push('last_error = NULL');
    sets.push('last_error_at = NULL');
    sets.push('consecutive_failures = 0');
  }
  if (state.incrementFailure) {
    sets.push('consecutive_failures = consecutive_failures + 1');
  }

  if (sets.length === 0) return;

  params.push(tenantId, contentType);
  await db.execute(
    `UPDATE ual_subscriptions SET ${sets.join(', ')} WHERE tenant_id = ? AND content_type = ?`,
    params
  );
}

/**
 * Read subscription state for a tenant.
 * @param {number} tenantId
 * @returns {Promise<Array<object>>} Rows for all known content_types
 */
async function getSubscriptions(tenantId) {
  if (!tenantId) return [];
  await ensureUalSchema();
  return db.queryRows(
    `SELECT tenant_id, content_type, status, last_blob_time, last_polled_at,
            last_error, last_error_at, consecutive_failures, created_at, updated_at
       FROM ual_subscriptions
      WHERE tenant_id = ?`,
    [tenantId]
  );
}

module.exports = {
  ensureUalSchema,
  ensureTenantCutoverColumns,
  writeUalEvents,
  lookupEvents,
  pruneOldEvents,
  upsertSubscription,
  getSubscriptions,
  markTenantFirstSeen,
  setTenantLastEvaluatedAt,
  getTenantCutoverState,
  toMysqlDatetime,
  // Exposed for tests / probes
  _projectUalRecord: projectUalRecord,
  _extractTargetResource: extractTargetResource,
  RAW_RETENTION_DAYS,
};
