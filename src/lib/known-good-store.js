/**
 * Panoptica365 — Known-Good Apps store (Feature 8.9)
 *
 * Persistence + pure drift logic for the Applications tab's "known-good"
 * baseline model. Blessing an app snapshots the exact permission set the
 * operator reviewed; later Refreshes / the daily loop compare the live set
 * against that baseline and surface DRIFT when the live set gains anything
 * beyond the baseline (a superset). It is a baseline, not a mute.
 *
 * Owns one table:
 *   known_good_apps — one row per blessed (tenant_id, app_id, app_kind).
 *
 * Also owns the idempotent registration of the data-driven alert policy
 * "Known-good app drift" (slug `known_good_app_drift`) — created on first
 * boot if absent so the drift alert has a policy row to reference. Modeled
 * on ensureUalAlertPolicies() in src/ual-evaluators.js and the
 * message-center-store policy bootstrap.
 *
 * Three states are kept distinct (spec §7.3):
 *   1. Blessed   — row here, baseline stored, drift-watched.
 *   2. Evaluated — Sonnet dot only, NO row here (the dot lives in the
 *                  refresh snapshot cache, not in this table).
 *   3. Untouched — nothing anywhere.
 * Only bless() ever writes a protected baseline.
 *
 * Schema migration follows the eager / single-flight pattern (ensureSchema
 * awaited once, cached) used by src/lib/message-center-store.js.
 *
 * Timestamp convention (house rule): store UTC wall-clock via toMysqlDatetime
 * (mysql2 rejects Date objects + ISO 'Z' on parameterized writes); use
 * UTC_TIMESTAMP() / NOW() for "now".
 */

'use strict';

const crypto = require('crypto');
const db = require('../db/database');

// Operator-facing policy name. slugify(name) === 'known_good_app_drift', which
// is the explainer/i18n key namespace AND the dedup-key prefix the worker uses.
// Do NOT rename without a migration — the slug is load-bearing.
const DRIFT_POLICY_NAME = 'Known-good app drift';
const DRIFT_POLICY_DESCRIPTION =
  'An application you marked known-good gained one or more permissions beyond the baseline you approved. ' +
  'A blessed app whose permission set grows is re-surfaced here — it is not "ignore forever." Subset / removed ' +
  'permissions are informational and do not fire. Source: Microsoft Graph (servicePrincipals + applications), ' +
  'compared on Refresh and on the daily known-good loop.';

// App credential (client secret / certificate) expiry early-warning policy.
// Reuses the daily known-good collection (which already pulls keyCredentials /
// passwordCredentials with endDateTime) — no extra Graph fetch. Slug:
// app_credential_expiry (must match alert_policy_names / alert_explanations).
const EXPIRY_POLICY_NAME = 'App credential expiry';
const EXPIRY_POLICY_DESCRIPTION =
  'A client secret or certificate on a tenant app registration is approaching expiry. ' +
  'Panoptica warns at 30 days and 7 days out, and once expired, so you can rotate the ' +
  'credential before an outage. One alert per credential — it does not re-fire every cycle. ' +
  'Source: Microsoft Graph (/applications keyCredentials + passwordCredentials), evaluated on ' +
  'Refresh and on the daily known-good loop.';

let schemaReady = false;
let schemaPromise = null;
let _driftPolicyId = null;
let _expiryPolicyId = null;

/** Strip ISO 'Z'/fractional + T→space for MySQL DATETIME params. */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

// ──────────────────────────────────────────────────────────────────────
// Pure drift logic (no I/O — unit-testable in isolation; see test/)
// ──────────────────────────────────────────────────────────────────────

/**
 * Canonical signature for ONE app: a sorted, de-duplicated array of opaque
 * permission-identity strings covering everything we watch for drift.
 *
 * Covers both enterprise apps (granted delegated + application permissions)
 * and app registrations (requested permissions, credentials, redirect URIs),
 * so the drift compare is generic over `app.kind`.
 *
 * Tokens (each a stable identity, NOT a display string):
 *   del|<resourceAppId>|<scope>     delegated grant (oauth2PermissionGrants)
 *   app|<resourceAppId>|<role>      application grant (appRoleAssignments)
 *   req|<resourceAppId>|<value>     requested permission (requiredResourceAccess)
 *   cred|<keyId>                    app-registration credential (key/password)
 *   uri|<redirectUri>              app-registration redirect URI
 *
 * Sorting makes the signature order-independent so the hash is stable
 * regardless of Graph's response ordering (house rule: structural compare,
 * never JSON.stringify of the raw Graph payload).
 */
function appSignature(app) {
  const out = new Set();
  for (const p of app.delegatedPermissions || []) {
    out.add(`del|${p.resourceAppId || p.resource || ''}|${p.scope}`);
  }
  for (const p of app.applicationPermissions || []) {
    out.add(`app|${p.resourceAppId || p.resource || ''}|${p.role}`);
  }
  for (const p of app.requiredResourceAccess || []) {
    out.add(`req|${p.resourceAppId || p.resource || ''}|${p.value}`);
  }
  for (const c of app.credentials || []) {
    if (c.keyId) out.add(`cred|${c.keyId}`);
  }
  for (const u of app.redirectUris || []) {
    out.add(`uri|${u}`);
  }
  return Array.from(out).sort();
}

/** sha256 of a normalized signature array. */
function hashSignature(signature) {
  return crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}

/**
 * Diff a current signature against a baseline signature.
 * Returns { added, removed } as arrays of tokens.
 *   added   = tokens present now but NOT in the baseline (drift)
 *   removed = tokens in the baseline but gone now (informational only)
 */
function diffSignatures(baseline, current) {
  const baseSet = new Set(baseline || []);
  const curSet = new Set(current || []);
  return {
    added: (current || []).filter(t => !baseSet.has(t)),
    removed: (baseline || []).filter(t => !curSet.has(t)),
  };
}

/**
 * Drift verdict for one blessed app: drift iff the live signature is a strict
 * SUPERSET of the baseline (gained ≥1 token). Removed-only / unchanged = no drift.
 */
function isDrifted(baseline, current) {
  return diffSignatures(baseline, current).added.length > 0;
}

// ──────────────────────────────────────────────────────────────────────
// Schema + policy bootstrap
// ──────────────────────────────────────────────────────────────────────

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // known_good_apps. Keyed (tenant_id, app_id, app_kind): a locally-registered
    // app and its service principal share an appId, so app_kind disambiguates a
    // bless of the registration vs the enterprise-app SP. idx_app_id alone is
    // retained for the future fleet-level "known-good across all tenants" (v2).
    await db.execute(`
      CREATE TABLE IF NOT EXISTS known_good_apps (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id           INT UNSIGNED NOT NULL,
        app_id              VARCHAR(64)  NOT NULL,
        object_id           VARCHAR(64)  NULL,
        app_kind            ENUM('enterprise','registration') NOT NULL DEFAULT 'enterprise',
        display_name        VARCHAR(512) NOT NULL,
        baseline_perms      JSON         NOT NULL,
        baseline_hash       CHAR(64)     NOT NULL,
        approved_by         VARCHAR(255) NULL,
        approved_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        drift_state         ENUM('clean','drifted') NOT NULL DEFAULT 'clean',
        drift_detected_at   DATETIME     NULL,
        sonnet_verdict      ENUM('green','yellow','red') NULL,
        sonnet_evaluated_at DATETIME     NULL,
        sonnet_rationale    JSON         NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_app_kind (tenant_id, app_id, app_kind),
        KEY idx_app_id (app_id),
        KEY idx_tenant_drift (tenant_id, drift_state),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await ensureDriftPolicy();
    await ensureExpiryPolicy();
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
 * Idempotent bootstrap of the data-driven 'Known-good app drift' alert policy.
 * threshold_type 'imperative' so the scheduled polling evaluator skips it
 * cleanly — it is fired only by the known-good worker / Refresh path, exactly
 * like the Message Center 'Microsoft planned change' policy.
 */
async function ensureDriftPolicy() {
  const existing = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [DRIFT_POLICY_NAME]
  );
  if (existing) {
    _driftPolicyId = existing.id;
    return _driftPolicyId;
  }
  const id = await db.insert(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      DRIFT_POLICY_NAME,
      DRIFT_POLICY_DESCRIPTION,
      'permissions',
      'high',
      'medium',
      'both',
      JSON.stringify({ threshold_type: 'imperative', known_good_drift: true }),
    ]
  );
  console.log(`[KnownGood] Created alert policy "${DRIFT_POLICY_NAME}" id=${id}`);
  _driftPolicyId = id;
  return _driftPolicyId;
}

async function getDriftPolicy() {
  await ensureSchema();
  if (!_driftPolicyId) await ensureDriftPolicy();
  return db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_driftPolicyId]
  );
}

/**
 * Idempotent bootstrap of the 'App credential expiry' alert policy. Same
 * imperative model as the drift policy (the scheduled evaluator skips it; the
 * known-good worker fires it). category 'permissions' — an EXISTING ENUM value;
 * never add a new one (it silently fails to bootstrap).
 */
async function ensureExpiryPolicy() {
  const existing = await db.queryOne(
    'SELECT id FROM alert_policies WHERE name = ? LIMIT 1',
    [EXPIRY_POLICY_NAME]
  );
  if (existing) {
    _expiryPolicyId = existing.id;
    return _expiryPolicyId;
  }
  const id = await db.insert(
    `INSERT INTO alert_policies
       (name, description, category, severity, polling_tier, notification_target, detection_logic, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      EXPIRY_POLICY_NAME,
      EXPIRY_POLICY_DESCRIPTION,
      'permissions',
      'medium',
      'low',
      'both',
      JSON.stringify({ threshold_type: 'imperative', credential_expiry: true, thresholds_days: [30, 7] }),
    ]
  );
  console.log(`[KnownGood] Created alert policy "${EXPIRY_POLICY_NAME}" id=${id}`);
  _expiryPolicyId = id;
  return _expiryPolicyId;
}

async function getExpiryPolicy() {
  await ensureSchema();
  if (!_expiryPolicyId) await ensureExpiryPolicy();
  return db.queryOne(
    'SELECT id, name, severity, category, notification_target, notification_limit, enabled FROM alert_policies WHERE id = ? LIMIT 1',
    [_expiryPolicyId]
  );
}

// ──────────────────────────────────────────────────────────────────────
// Baseline CRUD
// ──────────────────────────────────────────────────────────────────────

/** All blessed rows for a tenant, keyed by `${app_kind}:${app_id}`. */
async function getBaselines(tenantId) {
  await ensureSchema();
  const rows = await db.queryRows(
    'SELECT * FROM known_good_apps WHERE tenant_id = ?',
    [tenantId]
  );
  const map = new Map();
  for (const r of rows) {
    if (typeof r.baseline_perms === 'string') {
      try { r.baseline_perms = JSON.parse(r.baseline_perms); } catch { r.baseline_perms = []; }
    }
    if (typeof r.sonnet_rationale === 'string') {
      try { r.sonnet_rationale = JSON.parse(r.sonnet_rationale); } catch { r.sonnet_rationale = null; }
    }
    map.set(`${r.app_kind}:${r.app_id}`, r);
  }
  return map;
}

async function getBaseline(tenantId, appId, appKind = 'enterprise') {
  await ensureSchema();
  const r = await db.queryOne(
    'SELECT * FROM known_good_apps WHERE tenant_id = ? AND app_id = ? AND app_kind = ? LIMIT 1',
    [tenantId, appId, appKind]
  );
  if (r && typeof r.baseline_perms === 'string') {
    try { r.baseline_perms = JSON.parse(r.baseline_perms); } catch { r.baseline_perms = []; }
  }
  return r;
}

/**
 * Bless an app: snapshot the reviewed permission set as the baseline.
 * `app` is the collector app object (already loaded by Refresh — we never
 * re-fetch; the baseline must be exactly what the operator reviewed).
 * Resets drift_state to 'clean'. Returns { id, hash }.
 */
async function bless(tenantId, app, { approvedBy = null } = {}) {
  await ensureSchema();
  const kind = app.kind === 'registration' ? 'registration' : 'enterprise';
  const signature = appSignature(app);
  const hash = hashSignature(signature);
  await db.executeWithDeadlockRetry(
    `INSERT INTO known_good_apps
       (tenant_id, app_id, object_id, app_kind, display_name, baseline_perms, baseline_hash,
        approved_by, approved_at, drift_state, drift_detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'clean', NULL)
     ON DUPLICATE KEY UPDATE
       object_id        = VALUES(object_id),
       display_name     = VALUES(display_name),
       baseline_perms   = VALUES(baseline_perms),
       baseline_hash    = VALUES(baseline_hash),
       approved_by      = VALUES(approved_by),
       approved_at      = NOW(),
       drift_state      = 'clean',
       drift_detected_at = NULL`,
    [
      tenantId, app.appId, app.objectId || null, kind,
      String(app.displayName || app.appId).slice(0, 512),
      JSON.stringify(signature), hash, approvedBy,
    ]
  );
  const row = await getBaseline(tenantId, app.appId, kind);
  return { id: row ? row.id : null, hash };
}

/** Un-bless: remove the protected baseline. Returns affectedRows. */
async function unbless(tenantId, appId, appKind = 'enterprise') {
  await ensureSchema();
  return db.execute(
    'DELETE FROM known_good_apps WHERE tenant_id = ? AND app_id = ? AND app_kind = ?',
    [tenantId, appId, appKind]
  );
}

/** Persist a Sonnet verdict + 3-locale rationale onto a BLESSED row (state 1). */
async function recordVerdict(tenantId, appId, appKind, verdict, rationale) {
  await ensureSchema();
  return db.execute(
    `UPDATE known_good_apps
        SET sonnet_verdict = ?, sonnet_evaluated_at = NOW(), sonnet_rationale = ?
      WHERE tenant_id = ? AND app_id = ? AND app_kind = ?`,
    [verdict || null, rationale ? JSON.stringify(rationale) : null, tenantId, appId, appKind]
  );
}

/** Mark a blessed app drifted (or back to clean). */
async function setDriftState(tenantId, appId, appKind, state) {
  await ensureSchema();
  const drifted = state === 'drifted';
  return db.execute(
    `UPDATE known_good_apps
        SET drift_state = ?, drift_detected_at = ${drifted ? 'NOW()' : 'NULL'}
      WHERE tenant_id = ? AND app_id = ? AND app_kind = ?`,
    [drifted ? 'drifted' : 'clean', tenantId, appId, appKind]
  );
}

/** True if a CLEAN baseline exists for (tenant, app_id) of ANY kind. */
async function hasCleanBaselineForAppId(tenantId, appId) {
  await ensureSchema();
  const r = await db.queryOne(
    `SELECT id FROM known_good_apps
      WHERE tenant_id = ? AND app_id = ? AND drift_state = 'clean' LIMIT 1`,
    [tenantId, appId]
  );
  return !!r;
}

// ──────────────────────────────────────────────────────────────────────
// Inventory snapshot cache (the "lightweight cache" of spec §7.3)
//
// The resolved apps + permissions + per-app Sonnet dots for UNBLESSED apps
// live here, NOT in known_good_apps (an unblessed app must never get a
// protected baseline). Stored in metric_snapshots_latest so UI reads are
// cache-first (house rule: cache over live for UI endpoints). Rebuilt by
// Refresh / the daily loop; Save patches per-app Sonnet verdicts in place.
// ──────────────────────────────────────────────────────────────────────

const INVENTORY_SERVICE = 'entra';
const INVENTORY_METRIC = 'enterprise_apps_inventory';

/** Read the cached inventory snapshot for a tenant, or null. */
async function readInventory(tenantDbId) {
  const row = await db.queryOne(
    `SELECT metric_value, captured_at FROM metric_snapshots_latest
      WHERE tenant_id = ? AND service = ? AND metric_name = ?`,
    [tenantDbId, INVENTORY_SERVICE, INVENTORY_METRIC]
  );
  if (!row) return null;
  let value = row.metric_value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!value) return null;
  value.captured_at = row.captured_at;
  return value;
}

/** Upsert the cached inventory snapshot for a tenant. */
async function writeInventory(tenantDbId, inventory) {
  await db.execute(
    `INSERT INTO metric_snapshots_latest (tenant_id, service, metric_name, metric_value, captured_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE metric_value = VALUES(metric_value), captured_at = VALUES(captured_at)`,
    [tenantDbId, INVENTORY_SERVICE, INVENTORY_METRIC, JSON.stringify(inventory)]
  );
}

module.exports = {
  // schema + policy
  ensureSchema,
  getDriftPolicy,
  DRIFT_POLICY_NAME,
  getExpiryPolicy,
  EXPIRY_POLICY_NAME,
  // CRUD
  getBaselines,
  getBaseline,
  bless,
  unbless,
  recordVerdict,
  setDriftState,
  hasCleanBaselineForAppId,
  // inventory snapshot cache
  readInventory,
  writeInventory,
  // pure helpers (exported for the worker + unit tests)
  appSignature,
  hashSignature,
  diffSignatures,
  isDrifted,
  toMysqlDatetime,
};
