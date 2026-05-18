/**
 * Panoptica365 — Microsoft Defender Incidents (Graph Security API)
 *
 * Bundle F (May 6, 2026 evening). Sister to UAL ingestion (Audit.General
 * AlertEntityGenerated → Bundle D-1 Defender alerts), but at the incident
 * grouping layer rather than individual alerts.
 *
 * Background:
 *   - Microsoft Defender XDR produces ALERTS (single events) + INCIDENTS
 *     (correlated multi-alert stories — phishing+sign-in+rule+forward
 *     stitched together as one timeline).
 *   - UAL surfaces alerts via AlertEntityGenerated (Bundle D-1 already
 *     ingests these). UAL does NOT surface the incident grouping.
 *   - Graph Security API (/v1.0/security/incidents) is the canonical
 *     incident source. Same correlation Microsoft's portal shows.
 *
 * Architecture:
 *   - Cron-driven via ual-worker.js (same 5-min cadence as UAL ingestion).
 *   - Per-tenant: callGraphPaged on /security/incidents with delta filter
 *     on lastUpdateDateTime > MAX(last_updated_at_utc) for that tenant.
 *   - Upsert into defender_incidents (UNIQUE on tenant_id + incident_id).
 *   - Evaluator runs after fetch in same cycle, fires alerts on:
 *       a) NEW incident — never-seen incident_id arrives
 *       b) UPDATE — severity escalates (low → medium → high) on existing
 *          incident, OR alerts_count grows (new linked alerts joined)
 *
 * License gating: incidents only fire on tenants with Defender XDR
 * (Defender for Business + Defender for O365 P1 minimum). Lower-tier
 * tenants (Business Standard / Basic) get fail-quiet — fetch returns
 * empty array, evaluator no-ops. By design per commercialization decision.
 *
 * Forward-compat to Bundle D-1: Bundle D-1 captured raw_data.incident_id
 * on every Defender alert. When Bundle F ships (this file), the alert
 * UI / API can join historical alerts to their incidents using that field.
 *
 * Reference: https://learn.microsoft.com/en-us/graph/api/resources/security-incident
 */

const db = require('../db/database');
// graph module is loaded lazily inside fetchDefenderIncidents — it pulls in
// auth.js which instantiates MSAL with credentials from .env at module load.
// Eager-loading would cause unit tests / synthetic-fixture validators to
// crash when running outside the production environment. Lazy-load defers
// that side effect until an actual fetch is attempted.
let _graph = null;
function getGraph() {
  if (!_graph) _graph = require('../graph');
  return _graph;
}

// Microsoft Graph caps $top at 50 for /security/incidents (verified empirically
// May 12, 2026 — Dienamex returned HTTP 400 "The limit of '50' for Top query
// has been exceeded. The value from the incoming request is '200'."). The
// previous value of 200 broke ingestion for ALL 14 tenants since the May 6
// deploy. Combined with $expand=alerts, 50 is the hard cap. Page count is
// raised to compensate for the 7-day initial backfill.
const MAX_INCIDENTS_PER_FETCH = 50;
const MAX_PAGES_PER_FETCH = 20;   // 50 × 20 = 1000 incidents per cycle ceiling
const INCIDENT_LOOKBACK_DAYS = 7; // for first-time fetch when no watermark exists

let schemaReady = false;
let schemaPromise = null;

/**
 * Strip ISO 'Z' suffix and convert T → space for MySQL DATETIME columns.
 * Matches the toMysqlDatetime helper in ual-events.js — kept local here
 * to avoid cross-module coupling for a one-line utility.
 */
function toMysqlDatetime(value) {
  if (value === null || value === undefined) return value;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.replace('T', ' ').replace(/Z$/, '');
}

async function ensureDefenderIncidentsSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS defender_incidents (
          id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id                INT UNSIGNED NOT NULL,
          incident_id              VARCHAR(64)  NOT NULL COMMENT 'Microsoft Graph Security incident id (GUID)',
          display_name             VARCHAR(512) DEFAULT NULL,
          description              TEXT         DEFAULT NULL,
          severity                 VARCHAR(32)  DEFAULT NULL COMMENT 'Microsoft severity: informational|low|medium|high|unknownFutureValue',
          status                   VARCHAR(32)  DEFAULT NULL COMMENT 'active|resolved|redirected|inProgress',
          classification           VARCHAR(48)  DEFAULT NULL COMMENT 'unknown|falsePositive|truePositive|informationalExpectedActivity',
          determination            VARCHAR(48)  DEFAULT NULL,
          assigned_to              VARCHAR(320) DEFAULT NULL,
          alerts_count             INT UNSIGNED NOT NULL DEFAULT 0,
          incident_web_url         VARCHAR(1024) DEFAULT NULL,
          raw_json                 JSON         NOT NULL,
          created_at_utc           DATETIME(3)  NOT NULL,
          last_updated_at_utc      DATETIME(3)  NOT NULL,
          ingested_at              DATETIME(3)  NOT NULL,
          evaluated_at_severity    VARCHAR(32)  DEFAULT NULL COMMENT 'Severity at last evaluation pass — for escalation detection',
          evaluated_at_alerts_count INT UNSIGNED DEFAULT NULL COMMENT 'Alerts count at last evaluation — for new-alert-joined detection',
          UNIQUE KEY uq_defender_incidents_tenant_incident (tenant_id, incident_id),
          INDEX idx_defender_incidents_temporal (tenant_id, last_updated_at_utc),
          INDEX idx_defender_incidents_status (tenant_id, status),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      schemaReady = true;
      console.log('[DefenderIncidents] Schema ready');
    } catch (err) {
      console.error('[DefenderIncidents] ensureDefenderIncidentsSchema failed:', err.message);
    } finally {
      schemaPromise = null;
    }
  })();

  return schemaPromise;
}

ensureDefenderIncidentsSchema().catch((err) => {
  console.error('[DefenderIncidents] Eager schema migration failed at module load:', err.message);
});

/**
 * Determine the "since" filter for the next Graph poll. Uses the most
 * recent last_updated_at_utc for the tenant in our DB; if none, falls
 * back to (now - INCIDENT_LOOKBACK_DAYS) so the first fetch on a tenant
 * picks up the trailing week's worth of incidents.
 */
async function getWatermark(tenantDbId) {
  await ensureDefenderIncidentsSchema();
  const row = await db.queryOne(
    `SELECT MAX(last_updated_at_utc) AS max_updated
       FROM defender_incidents
      WHERE tenant_id = ?`,
    [tenantDbId]
  );
  if (row && row.max_updated) return new Date(row.max_updated);
  const fallback = new Date(Date.now() - INCIDENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return fallback;
}

/**
 * Fetch new/updated Defender incidents from Microsoft Graph Security API
 * for one tenant. Upserts into defender_incidents; returns a summary.
 *
 * License gating: tenants without Defender XDR (Business Standard/Basic
 * SKUs) get a 401/403/404 from Graph — caught and returned as
 * { fetched: 0, license_gated: true } so we fail-quiet.
 *
 * @param {object} tenant  Row from tenants table — must include id and tenant_id
 * @returns {Promise<object>}  { fetched, inserted, updated, license_gated, error }
 */
async function fetchDefenderIncidents(tenant) {
  if (!tenant?.id || !tenant?.tenant_id) {
    return { fetched: 0, inserted: 0, updated: 0, error: 'invalid tenant' };
  }
  await ensureDefenderIncidentsSchema();

  const watermark = await getWatermark(tenant.id);
  // Microsoft Graph filter: lastUpdateDateTime gt 2026-05-06T...
  // ISO-8601 with Z, NOT MySQL format. Graph requires the suffix.
  const watermarkIso = watermark.toISOString();
  // $expand=alerts pulls the linked alert collection in the same call so
  // alerts_count is accurate on insert. Without this, inc.alerts is
  // undefined and alerts_count is always 0 → ALERTS_JOINED escalations
  // never fire (and NEW-incident inserts still fire, but we can never
  // detect linked-alert growth over time). Microsoft Graph allows up to
  // 200 incidents per page WITH $expand=alerts as of 2026-05.
  const endpoint =
    `/security/incidents?$filter=lastUpdateDateTime gt ${watermarkIso}` +
    `&$expand=alerts` +
    `&$top=${MAX_INCIDENTS_PER_FETCH}` +
    `&$orderby=lastUpdateDateTime asc`;

  let incidents;
  try {
    incidents = await getGraph().callGraphPaged(tenant.tenant_id, endpoint, { maxPages: MAX_PAGES_PER_FETCH });
  } catch (err) {
    // 401/403 = permission missing on this tenant's app consent. 404 =
    // endpoint not available (license-gated tenant). Classify via
    // err.statusCode (GraphError property — see memory
    // feedback_grapherror_property.md), NOT message regex. The previous
    // regex matched "404" anywhere in the message and also matched
    // "UnknownError" — Microsoft's generic transient 5xx inner code —
    // which would falsely mark a healthy tenant as license_gated and
    // permanently suppress diagnostics for it.
    const status = err?.statusCode || 0;
    const msg = String(err.message || err).slice(0, 200);
    if (status === 401 || status === 403 || status === 404) {
      console.warn(
        `[DefenderIncidents] license-gated or missing-consent for tenant ${tenant.id} ` +
        `(${tenant.display_name || tenant.tenant_id}) — status=${status}: ${msg}`
      );
      return { fetched: 0, inserted: 0, updated: 0, license_gated: true, status, reason: msg };
    }
    console.error(
      `[DefenderIncidents] fetch FAILED for tenant ${tenant.id} ` +
      `(${tenant.display_name || tenant.tenant_id}) status=${status}: ${err.message}`
    );
    return { fetched: 0, inserted: 0, updated: 0, error: err.message, status };
  }

  if (!Array.isArray(incidents) || incidents.length === 0) {
    console.log(
      `[DefenderIncidents] tenant ${tenant.id} (${tenant.display_name || tenant.tenant_id}) — ` +
      `no new incidents since ${watermarkIso}`
    );
    return { fetched: 0, inserted: 0, updated: 0 };
  }

  console.log(
    `[DefenderIncidents] tenant ${tenant.id} (${tenant.display_name || tenant.tenant_id}) — ` +
    `${incidents.length} incident(s) returned since ${watermarkIso}`
  );

  let inserted = 0;
  let updated = 0;
  const nowMysql = toMysqlDatetime(new Date());

  for (const inc of incidents) {
    if (!inc?.id) continue;
    const alertsCount = Array.isArray(inc.alerts) ? inc.alerts.length : 0;

    try {
      // INSERT-OR-UPDATE on (tenant_id, incident_id). On update, refresh
      // mutable fields (severity, status, last_updated_at_utc, alerts_count,
      // raw_json) but preserve evaluated_at_severity / evaluated_at_alerts_count
      // — those track what the evaluator last saw, NOT what Microsoft last sent.
      const affectedRows = await db.execute(
        `INSERT INTO defender_incidents
           (tenant_id, incident_id, display_name, description, severity, status,
            classification, determination, assigned_to, alerts_count,
            incident_web_url, raw_json, created_at_utc, last_updated_at_utc, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name        = VALUES(display_name),
           description         = VALUES(description),
           severity            = VALUES(severity),
           status              = VALUES(status),
           classification      = VALUES(classification),
           determination       = VALUES(determination),
           assigned_to         = VALUES(assigned_to),
           alerts_count        = VALUES(alerts_count),
           incident_web_url    = VALUES(incident_web_url),
           raw_json            = VALUES(raw_json),
           last_updated_at_utc = VALUES(last_updated_at_utc),
           ingested_at         = VALUES(ingested_at)`,
        [
          tenant.id,
          String(inc.id),
          inc.displayName ? String(inc.displayName).slice(0, 512) : null,
          inc.description ? String(inc.description) : null,
          inc.severity ? String(inc.severity).slice(0, 32) : null,
          inc.status ? String(inc.status).slice(0, 32) : null,
          inc.classification ? String(inc.classification).slice(0, 48) : null,
          inc.determination ? String(inc.determination).slice(0, 48) : null,
          inc.assignedTo ? String(inc.assignedTo).slice(0, 320) : null,
          alertsCount,
          inc.incidentWebUrl ? String(inc.incidentWebUrl).slice(0, 1024) : null,
          JSON.stringify(inc),
          toMysqlDatetime(inc.createdDateTime),
          toMysqlDatetime(inc.lastUpdateDateTime),
          nowMysql,
        ]
      );
      // db.execute() returns affectedRows as a plain number (see
      // src/db/database.js — it destructures the OkPacket and returns the
      // number directly). mysql2 semantics for INSERT ... ON DUPLICATE KEY
      // UPDATE: 0 = no-op, 1 = inserted, 2 = updated. Previously this code
      // treated the return as an object with .affectedRows / .changedRows,
      // so both counters always read 0 — masking the May 12 ingestion bug.
      if (affectedRows === 2) {
        updated += 1;
      } else if (affectedRows >= 1) {
        inserted += 1;
      }
    } catch (err) {
      console.warn(`[DefenderIncidents] upsert failed for tenant ${tenant.id} incident ${inc.id}: ${err.message}`);
    }
  }

  return { fetched: incidents.length, inserted, updated };
}

/**
 * Look up incidents that have been ingested but not yet evaluated, OR
 * have changed since last evaluation (severity escalation or new linked
 * alerts). Returns rows ready for the evaluator to fire alerts on.
 *
 * Two conditions trigger re-evaluation:
 *   (a) evaluated_at_severity IS NULL — never evaluated (truly new incident)
 *   (b) evaluated_at_severity != severity — Microsoft escalated severity
 *   (c) evaluated_at_alerts_count != alerts_count — new alerts joined
 */
async function lookupUnevaluatedIncidents(tenantDbId, limit = 200) {
  await ensureDefenderIncidentsSchema();
  const limitN = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  return db.queryRows(
    `SELECT id, tenant_id, incident_id, display_name, description, severity, status,
            classification, determination, assigned_to, alerts_count,
            incident_web_url, raw_json, created_at_utc, last_updated_at_utc,
            evaluated_at_severity, evaluated_at_alerts_count
       FROM defender_incidents
      WHERE tenant_id = ?
        AND (
          evaluated_at_severity IS NULL
          OR evaluated_at_severity <> severity
          OR evaluated_at_alerts_count <> alerts_count
        )
      ORDER BY last_updated_at_utc ASC
      LIMIT ${limitN}`,
    [tenantDbId]
  );
}

/**
 * Mark an incident as evaluated at its current state. Called by the
 * evaluator after firing/skipping the alert so we don't re-fire on the
 * same state.
 */
async function markEvaluated(incidentDbId, severity, alertsCount) {
  await db.execute(
    `UPDATE defender_incidents
        SET evaluated_at_severity = ?, evaluated_at_alerts_count = ?
      WHERE id = ?`,
    [severity || null, alertsCount || 0, incidentDbId]
  );
}

module.exports = {
  ensureDefenderIncidentsSchema,
  fetchDefenderIncidents,
  lookupUnevaluatedIncidents,
  markEvaluated,
  getWatermark,
  toMysqlDatetime,
  // exposed for tests
  _MAX_INCIDENTS_PER_FETCH: MAX_INCIDENTS_PER_FETCH,
  _INCIDENT_LOOKBACK_DAYS: INCIDENT_LOOKBACK_DAYS,
};
