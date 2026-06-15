/**
 * Panoptica365 — Adopt-in-Place store (Tenant-Sourced CA & Intune cards)
 *
 * Dedicated per-surface storage for objects ADOPTED from a tenant's existing
 * configuration (origin='tenant_sourced'), kept deliberately separate from the
 * template library (ca_templates / intune_templates). Adopted objects are
 * tenant-scoped and must NEVER become reusable library templates (spec §2.13),
 * so they get their own tables instead of polluting the template store.
 *
 * Three tables:
 *   tenant_sourced_objects   — one row per adopted/discovered object (the card)
 *   tenant_surface_watermark — per (tenant, surface): when the seen-set baseline
 *                              was established. Load-bearing for the
 *                              empty-but-licensed case — an established-but-empty
 *                              seen-set cannot be represented by "rows exist".
 *   tenant_object_seen_set   — per object id: the discovery watermark + the
 *                              `dismissed` marker (Stop-monitoring) so discovery
 *                              never re-cards an object the operator dismissed.
 *
 * Conventions mirror src/lib/known-good-store.js: cached ensureSchema promise,
 * idempotent alert-policy bootstrap, UTC wall-clock via toMysqlDatetime, pure
 * drift logic separated from I/O.
 */

'use strict';

const db = require('../db/database');
const { canonicalHash, normalizeForBaseline, structuralDiff } = require('./canonical-json');

const DISCOVERY_POLICY_NAME = 'Configuration created outside Panoptica';
const DISCOVERY_POLICY_DESCRIPTION =
  'A Conditional Access policy or Intune configuration appeared in the tenant ' +
  'that was not created through Panoptica (e.g. authored directly in the ' +
  'Microsoft console). Surfaced as a tenant-sourced card for review.';

let schemaReady = false;
let schemaPromise = null;
let _discoveryPolicyId = null;

const SURFACES = ['ca', 'intune'];

/** Strip ISO 'Z'/fractional + T→space for MySQL DATETIME params (house rule). */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

// ──────────────────────────────────────────────────────────────────────
// Pure drift logic (no I/O — unit-testable; see test/)
// ──────────────────────────────────────────────────────────────────────

/**
 * Normalize a CA policy / Intune config + (optional) assignment set into the
 * stable shape we baseline and hash. Assignments are normalized to their
 * `target` descriptors only (Graph re-mints assignment ids on every write, so
 * the id is volatile; the target is the meaningful part).
 *
 * @param {object} config       — full Graph object JSON
 * @param {Array}  [assignments]— Graph assignment objects (Intune); omit for CA
 * @returns {{ config: object, assignments: Array|null }}
 */
function normalizeObject(config, assignments) {
  const normConfig = normalizeForBaseline(config || {});
  let normAssignments = null;
  if (Array.isArray(assignments)) {
    normAssignments = assignments
      .map(a => normalizeForBaseline(a && a.target ? { target: a.target } : a))
      .sort((x, y) => canonicalHash(x).localeCompare(canonicalHash(y)));
  }
  return { config: normConfig, assignments: normAssignments };
}

/** sha256 over the normalized {config, assignments} pair. */
function baselineHash(normalized) {
  return canonicalHash({ config: normalized.config, assignments: normalized.assignments || null });
}

/**
 * Compute drift of a live object against a stored baseline.
 * @param {object} row        — tenant_sourced_objects row (baseline_config / baseline_assignments / baseline_hash)
 * @param {object} liveConfig — current Graph object JSON
 * @param {Array}  [liveAssignments]
 * @returns {{ drifted: boolean, configDiffs: Array, assignmentDiffs: Array, liveHash: string }}
 */
function computeDrift(row, liveConfig, liveAssignments) {
  const baseConfig = parseJson(row.baseline_config, {});
  const baseAssignments = parseJson(row.baseline_assignments, null);
  const live = normalizeObject(liveConfig, liveAssignments);
  const liveHash = baselineHash(live);

  if (liveHash === row.baseline_hash) {
    return { drifted: false, configDiffs: [], assignmentDiffs: [], liveHash };
  }
  const configDiffs = structuralDiff(baseConfig, live.config);
  const assignmentDiffs = (baseAssignments || live.assignments)
    ? structuralDiff(baseAssignments || [], live.assignments || [])
    : [];
  return {
    drifted: configDiffs.length > 0 || assignmentDiffs.length > 0,
    configDiffs,
    assignmentDiffs,
    liveHash,
  };
}

function parseJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// ──────────────────────────────────────────────────────────────────────
// Schema + policy bootstrap
// ──────────────────────────────────────────────────────────────────────

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_sourced_objects (
        id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id             INT UNSIGNED NOT NULL,
        surface               ENUM('ca','intune') NOT NULL,
        policy_type           VARCHAR(64)  NULL COMMENT 'Intune POLICY_TYPES key; NULL for CA',
        source_object_id      VARCHAR(200) NOT NULL COMMENT 'tenant-local Graph object id',
        display_name          VARCHAR(512) NOT NULL,
        origin                ENUM('template','tenant_sourced') NOT NULL DEFAULT 'tenant_sourced',
        lifecycle_state       ENUM('active','deactivated') NOT NULL DEFAULT 'active',
        ms_managed            TINYINT(1)   NOT NULL DEFAULT 0,
        baseline_config       JSON         NOT NULL,
        baseline_assignments  JSON         NULL,
        baseline_hash         CHAR(64)     NOT NULL,
        deactivation_snapshot JSON         NULL,
        monitor_on_deactivate TINYINT(1)   NOT NULL DEFAULT 0,
        drift_status          ENUM('ok','drifted','unchecked') NOT NULL DEFAULT 'unchecked',
        drift_details         JSON         NULL,
        last_checked_at       DATETIME     NULL,
        imported_by           VARCHAR(255) NULL,
        imported_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_surface_obj (tenant_id, surface, source_object_id),
        KEY idx_tenant_surface_state (tenant_id, surface, lifecycle_state),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_surface_watermark (
        id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id               INT UNSIGNED NOT NULL,
        surface                 ENUM('ca','intune') NOT NULL,
        seen_set_established_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        license_state           ENUM('licensed','unlicensed','unknown') NOT NULL DEFAULT 'unknown',
        last_reconciled_at      DATETIME     NULL,
        -- Set ONLY by an explicit operator Import (§2.3), never by the silent
        -- discovery first-enumeration. Drives the "Import existing settings"
        -- button: hidden only after a real import, not just because discovery
        -- watermarked the surface.
        imported_at             DATETIME     NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_surface (tenant_id, surface),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_object_seen_set (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id     INT UNSIGNED NOT NULL,
        surface       ENUM('ca','intune') NOT NULL,
        object_id     VARCHAR(200) NOT NULL,
        dismissed     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'operator chose Stop-monitoring; never re-card',
        first_seen_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_surface_objid (tenant_id, surface, object_id),
        KEY idx_tenant_surface (tenant_id, surface),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Eager column add for installs whose watermark table predates imported_at
    // (e.g. created by an earlier boot of this feature). Without this, a row
    // established by the silent discovery enumeration would wrongly hide the
    // Import button. Idempotent: probe INFORMATION_SCHEMA first.
    try {
      const col = await db.queryOne(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_surface_watermark' AND COLUMN_NAME = 'imported_at'"
      );
      if (!col) {
        await db.execute("ALTER TABLE tenant_surface_watermark ADD COLUMN imported_at DATETIME NULL AFTER last_reconciled_at");
        console.log('[Adopt] Added tenant_surface_watermark.imported_at');
      }
    } catch (e) {
      console.warn('[Adopt] imported_at migration (non-fatal):', e.message);
    }

    await ensureDiscoveryPolicy();
    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } catch (err) {
    schemaPromise = null; // allow retry on next call
    throw err;
  }
}

/**
 * Idempotent bootstrap of the 'Configuration created outside Panoptica' alert
 * policy. category MUST be a valid alert_policies.category ENUM value —
 * 'config_changes' is in the ENUM (verified) so no ALTER is needed.
 * threshold_type 'imperative' so the scheduled polling evaluator skips it —
 * it is fired only by the discovery loop / UAL evaluator.
 */
async function ensureDiscoveryPolicy() {
  const existing = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [DISCOVERY_POLICY_NAME]
  );
  if (existing) {
    _discoveryPolicyId = existing.id;
    return _discoveryPolicyId;
  }
  const id = await db.insert(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      DISCOVERY_POLICY_NAME,
      DISCOVERY_POLICY_DESCRIPTION,
      'config_changes',
      'medium',
      'medium',
      'both',
      JSON.stringify({ threshold_type: 'imperative', native_config_appeared: true }),
    ]
  );
  console.log(`[Adopt] Created alert policy "${DISCOVERY_POLICY_NAME}" id=${id}`);
  _discoveryPolicyId = id;
  return _discoveryPolicyId;
}

async function getDiscoveryPolicy() {
  await ensureSchema();
  if (!_discoveryPolicyId) await ensureDiscoveryPolicy();
  return db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_discoveryPolicyId]
  );
}

// ──────────────────────────────────────────────────────────────────────
// tenant_sourced_objects CRUD
// ──────────────────────────────────────────────────────────────────────

function hydrate(row) {
  if (!row) return row;
  row.baseline_config = parseJson(row.baseline_config, {});
  row.baseline_assignments = parseJson(row.baseline_assignments, null);
  row.deactivation_snapshot = parseJson(row.deactivation_snapshot, null);
  row.drift_details = parseJson(row.drift_details, null);
  return row;
}

/**
 * Upsert an adopted/discovered object. `normalized` comes from normalizeObject().
 * Used by both Import (§5) and Discovery (§7) — discovery is just "import one".
 * On a pre-existing row, refreshes display_name/ms_managed/lifecycle_state but
 * does NOT clobber an existing baseline (re-import must not move the goalposts).
 *
 * @returns {Promise<{id:number, created:boolean}>}
 */
async function upsertObject(tenantId, obj) {
  await ensureSchema();
  const {
    surface, policyType = null, sourceObjectId, displayName,
    lifecycleState = 'active', msManaged = false,
    config, assignments = null, importedBy = null,
  } = obj;

  const normalized = normalizeObject(config, assignments);
  const hash = baselineHash(normalized);

  const existing = await db.queryOne(
    'SELECT id FROM tenant_sourced_objects WHERE tenant_id = ? AND surface = ? AND source_object_id = ? LIMIT 1',
    [tenantId, surface, sourceObjectId]
  );

  if (existing) {
    // Refresh identity/managed/state metadata only; keep the original baseline.
    await db.execute(
      `UPDATE tenant_sourced_objects
          SET display_name = ?, ms_managed = ?, lifecycle_state = ?
        WHERE id = ?`,
      [String(displayName || sourceObjectId).slice(0, 512), msManaged ? 1 : 0, lifecycleState, existing.id]
    );
    return { id: existing.id, created: false };
  }

  const id = await db.insert(
    `INSERT INTO tenant_sourced_objects
       (tenant_id, surface, policy_type, source_object_id, display_name, origin,
        lifecycle_state, ms_managed, baseline_config, baseline_assignments,
        baseline_hash, monitor_on_deactivate, drift_status, imported_by, imported_at)
     VALUES (?, ?, ?, ?, ?, 'tenant_sourced', ?, ?, ?, ?, ?, 0, 'ok', ?, NOW())`,
    [
      tenantId, surface, policyType, sourceObjectId,
      String(displayName || sourceObjectId).slice(0, 512),
      lifecycleState, msManaged ? 1 : 0,
      JSON.stringify(normalized.config),
      normalized.assignments ? JSON.stringify(normalized.assignments) : null,
      hash, importedBy,
    ]
  );
  return { id, created: true };
}

async function getObjects(tenantId, surface = null) {
  await ensureSchema();
  const params = [tenantId];
  let sql = 'SELECT * FROM tenant_sourced_objects WHERE tenant_id = ?';
  if (surface) { sql += ' AND surface = ?'; params.push(surface); }
  sql += ' ORDER BY display_name';
  const rows = await db.queryRows(sql, params);
  return rows.map(hydrate);
}

async function getObjectById(id) {
  await ensureSchema();
  return hydrate(await db.queryOne('SELECT * FROM tenant_sourced_objects WHERE id = ? LIMIT 1', [id]));
}

async function setLifecycle(id, lifecycleState, { snapshot = undefined, monitorOnDeactivate = undefined } = {}) {
  await ensureSchema();
  const sets = ['lifecycle_state = ?'];
  const params = [lifecycleState];
  if (snapshot !== undefined) {
    sets.push('deactivation_snapshot = ?');
    params.push(snapshot === null ? null : JSON.stringify(snapshot));
  }
  if (monitorOnDeactivate !== undefined) {
    sets.push('monitor_on_deactivate = ?');
    params.push(monitorOnDeactivate ? 1 : 0);
  }
  params.push(id);
  await db.execute(`UPDATE tenant_sourced_objects SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function setDrift(id, driftStatus, driftDetails) {
  await ensureSchema();
  // We never silently move baseline_config / baseline_hash — drift only records
  // status + details. The as-found baseline stays put until the operator acts.
  await db.execute(
    `UPDATE tenant_sourced_objects
        SET drift_status = ?, drift_details = ?, last_checked_at = NOW()
      WHERE id = ?`,
    [driftStatus, driftDetails ? JSON.stringify(driftDetails) : null, id]
  );
}

/** Remove the card (Stop-monitoring / Delete). Does NOT touch the tenant. */
async function deleteObject(id) {
  await ensureSchema();
  await db.execute('DELETE FROM tenant_sourced_objects WHERE id = ?', [id]);
}

// ──────────────────────────────────────────────────────────────────────
// Seen-set + watermark
// ──────────────────────────────────────────────────────────────────────

/** True iff a watermark row exists — i.e. the seen-set has been established. */
async function isWatermarkEstablished(tenantId, surface) {
  await ensureSchema();
  const row = await db.queryOne(
    'SELECT id FROM tenant_surface_watermark WHERE tenant_id = ? AND surface = ? LIMIT 1',
    [tenantId, surface]
  );
  return !!row;
}

async function getWatermark(tenantId, surface) {
  await ensureSchema();
  return db.queryOne(
    'SELECT * FROM tenant_surface_watermark WHERE tenant_id = ? AND surface = ? LIMIT 1',
    [tenantId, surface]
  );
}

/**
 * Establish (or refresh) the watermark for a (tenant, surface). Establishing an
 * EMPTY watermark is legitimate and load-bearing: it records that we have seen
 * the surface and found zero objects, so discovery still catches the first
 * object ever created later (spec §5.5 / §7.1).
 */
async function establishWatermark(tenantId, surface, { licenseState = 'licensed' } = {}) {
  await ensureSchema();
  await db.execute(
    `INSERT INTO tenant_surface_watermark (tenant_id, surface, seen_set_established_at, license_state, last_reconciled_at)
     VALUES (?, ?, NOW(), ?, NOW())
     ON DUPLICATE KEY UPDATE license_state = VALUES(license_state), last_reconciled_at = NOW()`,
    [tenantId, surface, licenseState]
  );
}

/**
 * Mark that an EXPLICIT operator Import succeeded for this (tenant, surface).
 * This — not the mere existence of a watermark — is what hides the Import
 * button (§2.3). The silent discovery enumeration never calls this.
 */
async function markOperatorImported(tenantId, surface) {
  await ensureSchema();
  await db.execute(
    'UPDATE tenant_surface_watermark SET imported_at = NOW() WHERE tenant_id = ? AND surface = ?',
    [tenantId, surface]
  );
}

async function touchReconciled(tenantId, surface, licenseState) {
  await ensureSchema();
  const sets = ['last_reconciled_at = NOW()'];
  const params = [];
  if (licenseState) { sets.push('license_state = ?'); params.push(licenseState); }
  params.push(tenantId, surface);
  await db.execute(
    `UPDATE tenant_surface_watermark SET ${sets.join(', ')} WHERE tenant_id = ? AND surface = ?`,
    params
  );
}

/**
 * Read the seen-set for a (tenant, surface) as a Map objectId → { dismissed }.
 */
async function getSeenSet(tenantId, surface) {
  await ensureSchema();
  const rows = await db.queryRows(
    'SELECT object_id, dismissed FROM tenant_object_seen_set WHERE tenant_id = ? AND surface = ?',
    [tenantId, surface]
  );
  const map = new Map();
  for (const r of rows) map.set(r.object_id, { dismissed: !!r.dismissed });
  return map;
}

/** Add object ids to the seen-set (idempotent). */
async function addSeen(tenantId, surface, objectIds) {
  await ensureSchema();
  for (const oid of objectIds) {
    await db.execute(
      `INSERT INTO tenant_object_seen_set (tenant_id, surface, object_id, dismissed, first_seen_at)
       VALUES (?, ?, ?, 0, NOW())
       ON DUPLICATE KEY UPDATE first_seen_at = first_seen_at`,
      [tenantId, surface, String(oid).slice(0, 200)]
    );
  }
}

/** Mark an object dismissed (Stop-monitoring) so discovery never re-cards it. */
async function markDismissed(tenantId, surface, objectId) {
  await ensureSchema();
  await db.execute(
    `INSERT INTO tenant_object_seen_set (tenant_id, surface, object_id, dismissed, first_seen_at)
     VALUES (?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE dismissed = 1`,
    [tenantId, surface, String(objectId).slice(0, 200)]
  );
}

/** Remove an object id from the seen-set (after Delete — if it reappears it's new). */
async function removeSeen(tenantId, surface, objectId) {
  await ensureSchema();
  await db.execute(
    'DELETE FROM tenant_object_seen_set WHERE tenant_id = ? AND surface = ? AND object_id = ?',
    [tenantId, surface, objectId]
  );
}

module.exports = {
  // constants
  DISCOVERY_POLICY_NAME,
  SURFACES,
  // pure
  toMysqlDatetime,
  normalizeObject,
  baselineHash,
  computeDrift,
  // schema + policy
  ensureSchema,
  getDiscoveryPolicy,
  // objects
  upsertObject,
  getObjects,
  getObjectById,
  setLifecycle,
  setDrift,
  deleteObject,
  // seen-set + watermark
  isWatermarkEstablished,
  getWatermark,
  establishWatermark,
  markOperatorImported,
  touchReconciled,
  getSeenSet,
  addSeen,
  markDismissed,
  removeSeen,
};
