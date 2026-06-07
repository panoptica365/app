/**
 * Panoptica365 — Change Log Service
 *
 * Shared helper for writing `source='panoptica'` rows into tenant_change_events.
 * Called from every Panoptica mutation site that touches tenant configuration
 * via Graph (CA policy push/retire/remediate, Intune policy push/retire, exemption
 * apply/revoke, etc).
 *
 * Two purposes:
 *   1. Audit trail — every Panoptica-initiated change is visible in the tenant's
 *      Change Log view, so the MSP has a complete record of "what did we touch
 *      and when" for a given tenant.
 *   2. Drift attribution — the alert engine reads recent rows (tenant + surface
 *      overlap + started_at within 60min of drift detection) and sets
 *      alerts.auto_attributed_change_id to link a drift alert to the change
 *      that caused it. NOTE: attribution is not suppression. Alerts still fire.
 *      The UI filters auto-attributed alerts from the primary count but they
 *      remain visible and auditable.
 *
 * Governance note: LLM prompts (Haiku per-event, Sonnet 24h digest) receive
 * these rows as narrative context only. They MUST NOT suppress or downgrade
 * alert severity based on change-event context. That rule is enforced in the
 * prompt text (see ai-analysis.js and routes/api-ai.js).
 */

const crypto = require('crypto');
const db = require('./db/database');

// Categories that map to specific mutation types. These string values MUST
// match the ENUM in tenant_change_events.category (see alert-engine.js
// ensureAlertColumns). If you add a new category here, also extend the ENUM
// via ALTER TABLE in alert-engine.js — otherwise INSERTs will fail with
// "Data truncated for column 'category'" and the log row will be silently
// dropped (try/catch inside logPanopticaChange catches the failure and the
// mutation itself proceeds — great for safety, terrible for observability).
const CATEGORY = {
  CA_POLICY_PUSH:         'ca_deploy',
  CA_POLICY_RETIRE:       'ca_retire',
  CA_POLICY_EDIT:         'ca_edit',
  INTUNE_POLICY_PUSH:     'intune_push',
  INTUNE_POLICY_RETIRE:   'intune_retire',
  INTUNE_POLICY_EDIT:     'intune_edit',
  EXEMPTION_APPLY:        'exemption_apply',
  EXEMPTION_REVOKE:       'exemption_revoke',
  // Apr 30, 2026 — operator-defined alert exemption rules. Distinct from
  // EXEMPTION_APPLY/REVOKE (which mirror M365 CA excludeUsers carve-outs).
  // Alert exemption rules are pattern-based per-policy auto-resolves with
  // no M365-side equivalent. See migrate-alert-exemption-rules.sql.
  // DB ENUM extension lives in the same migration.
  ALERT_EXEMPTION_APPLY:  'alert_exemption_apply',
  ALERT_EXEMPTION_REVOKE: 'alert_exemption_revoke',
  REMEDIATION_RUN:        'remediation',
  NAMED_LOCATION_EDIT:    'named_location',
  NAMED_LOCATION_CREATE:  'named_location_create',
  // Tier 1 operator-action categories (Apr 19 evening)
  ALERT_STATUS_CHANGE:    'alert_status_change',
  ALERT_NOTE:             'alert_note',
  AI_SEVERITY_REVERT:     'ai_severity_revert',
  ENFORCEMENT_TOGGLE:     'enforcement_toggle',
  TENANT_LIFECYCLE:       'tenant_lifecycle',
  // Apr 27, 2026 — single category for all four security-setting verbs
  // (Apply, Match, Remediate, Accept). Verb is captured in description so
  // operators can scan/filter at read time. Audit-trail rationale: even
  // Match/Accept (which don't write to Microsoft) change Panoptica's
  // monitoring baseline — a careless Accept on a hostile change must be
  // captured in the audit log.
  // Requires the corresponding ENUM expansion in alert-engine.js
  // ensureAlertColumns() — already done in the same patch as this constant.
  SECURITY_SETTING_CHANGE: 'security_setting_change',
  OTHER:                  'other',
};

const SURFACE = {
  CA:              'ca',
  INTUNE:          'intune',
  IDENTITY:        'identity',
  MFA:             'mfa',
  NAMED_LOCATIONS: 'named_locations',
  SHAREPOINT:      'sharepoint',
  EXCHANGE:        'exchange',
  DEVICES:         'devices',
  // Apr 27, 2026 — distinct surface for the Security Settings Engine.
  // Used by alerts.surfaceForAlertCategory() to enable 60-min auto-
  // attribution of SECURITY_DRIFT alerts to the operator's recent push.
  SECURITY_SETTING: 'security_setting',
  OTHER:           'other',
};

// Suppression window: how long after a Panoptica change do we attribute
// subsequent drift alerts to it. 60 minutes gives one full 30-min fetch
// cycle of margin after the push. Beyond this, drift is treated as legit.
const ATTRIBUTION_WINDOW_MINUTES = 60;

/**
 * Generate a short, URL-safe correlation tag.
 * Used to link one logical mutation (which may span multiple Graph calls)
 * to its audit row. Not required to be cryptographically unique — just
 * collision-resistant within the tenant's event stream.
 */
function newCorrelationTag() {
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * Extract actor context (IP, user-agent, session id) from an Express req.
 * Returns an object ready to spread into logPanopticaChange opts.
 *
 * Call sites that have `req` in scope should pass `...captureActorContext(req)`.
 * Background jobs / pollers should omit — the columns will stay null, which is
 * the correct signal that nobody was logged in when the action happened.
 */
function captureActorContext(req) {
  if (!req) return {};
  // Prefer the socket address over X-Forwarded-For unless an explicit trust-proxy
  // chain is configured (express sets req.ip based on `trust proxy`). We take
  // req.ip which Express resolves correctly per-config.
  const ip = (req.ip || req.connection?.remoteAddress || '').slice(0, 45);
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 500);
  const sid = (req.sessionID || req.session?.id || '').slice(0, 128);
  return {
    actorIp: ip || null,
    actorUserAgent: ua || null,
    actorSessionId: sid || null,
  };
}

/**
 * Log a Panoptica-initiated change event.
 *
 * @param {object} opts
 * @param {number} opts.tenantId         — internal tenants.id (not azure_tenant_id GUID)
 * @param {string} opts.category         — one of CATEGORY values
 * @param {string[]} opts.surfaces       — one or more SURFACE values (JSON array in DB)
 * @param {string} opts.description      — human-readable summary, <= 500 chars
 * @param {string} [opts.createdBy]      — operator email; defaults to 'panoptica-system'
 * @param {string} [opts.correlationTag] — optional pre-generated tag for multi-row operations
 * @param {string} [opts.actorIp]        — originating IP (from captureActorContext)
 * @param {string} [opts.actorUserAgent] — HTTP User-Agent
 * @param {string} [opts.actorSessionId] — express-session SID
 * @returns {Promise<{id: number, correlationTag: string}>}
 */
async function logPanopticaChange(opts) {
  const {
    tenantId,
    category,
    surfaces,
    description,
    templateKey = null,
    templateParams = null,
    createdBy = 'panoptica-system',
    correlationTag = newCorrelationTag(),
    actorIp = null,
    actorUserAgent = null,
    actorSessionId = null,
  } = opts;

  if (!tenantId || !Number.isInteger(tenantId)) {
    throw new Error('logPanopticaChange: tenantId must be an integer');
  }
  if (!Object.values(CATEGORY).includes(category)) {
    throw new Error(`logPanopticaChange: invalid category '${category}'`);
  }
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new Error('logPanopticaChange: surfaces must be a non-empty array');
  }
  const validSurfaces = Object.values(SURFACE);
  for (const s of surfaces) {
    if (!validSurfaces.includes(s)) {
      throw new Error(`logPanopticaChange: invalid surface '${s}'`);
    }
  }

  const descTrimmed = (description || '').slice(0, 500);

  // Clamp actor fields defensively — captureActorContext already slices but
  // direct callers might not. Keep the DB column limits as the source of truth.
  const ipClamped = actorIp ? String(actorIp).slice(0, 45) : null;
  const uaClamped = actorUserAgent ? String(actorUserAgent).slice(0, 500) : null;
  const sidClamped = actorSessionId ? String(actorSessionId).slice(0, 128) : null;

  // i18n template fields. Both nullable; the renderer treats NULL templateKey
  // as "render description as-is" so legacy callers (and any not-yet-migrated
  // writers) continue to work in English without any change.
  const tplKeyClamped = templateKey ? String(templateKey).slice(0, 64) : null;
  let tplParamsJson = null;
  if (templateParams !== null && templateParams !== undefined) {
    try {
      tplParamsJson = JSON.stringify(templateParams);
    } catch (e) {
      console.warn('[ChangeLog] template_params serialization failed — dropping:', e.message);
    }
  }

  try {
    const result = await db.execute(
      `INSERT INTO tenant_change_events
        (tenant_id, source, category, affected_surface, started_at, impact, description, template_key, template_params, correlation_tag, created_by, actor_ip, actor_user_agent, actor_session_id)
       VALUES (?, 'panoptica', ?, ?, NOW(), 'low', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        category,
        JSON.stringify(surfaces),
        descTrimmed,
        tplKeyClamped,
        tplParamsJson,
        correlationTag,
        createdBy,
        ipClamped,
        uaClamped,
        sidClamped,
      ]
    );
    // db.execute may return OkPacket with insertId, or array-style [OkPacket, _]
    const insertId = result?.insertId ?? result?.[0]?.insertId ?? null;
    return { id: insertId, correlationTag };
  } catch (e) {
    // Never let a logging failure kill the mutation itself.
    // Log LOUDLY — a silent failure here means the audit trail is lying
    // (mutation happened, no row in the change log). Include MySQL error
    // code + the attempted values so the mismatch is obvious.
    console.error(
      '⚠  [ChangeLog] Failed to log Panoptica change — AUDIT GAP:',
      e.code || '(no code)',
      e.message,
      { tenantId, category, surfaces, createdBy, descriptionBytes: descTrimmed.length }
    );
    return { id: null, correlationTag };
  }
}

/**
 * Find a recent Panoptica change event that could explain a drift alert.
 * Used by the alert engine at emission time.
 *
 * Match rule: same tenant + surface overlap + started_at within window.
 *
 * @param {number} tenantId
 * @param {string[]} alertSurfaces — surfaces implicated by the drift (e.g. ['ca'] or ['intune'])
 * @param {object} [opts]
 * @param {number} [opts.windowMinutes=60]
 * @param {string} [opts.correlationTagPrefix] — optional. When set, only matches change rows
 *                                              whose correlation_tag starts with this prefix.
 *                                              Use case: shared surfaces (e.g. 'security_setting'
 *                                              covers ALL security setting changes) need a
 *                                              second-key disambiguator. Pass 'security_setting:ENT-05'
 *                                              to attribute only to that specific setting's changes.
 * @returns {Promise<{id: number, category: string, correlation_tag: string, started_at: Date} | null>}
 */
async function findAttributingChange(tenantId, alertSurfaces, opts = {}) {
  // Back-compat: original signature was findAttributingChange(tenantId, surfaces, windowMinutes).
  // If `opts` is a number, treat it as windowMinutes for callers not yet updated.
  const windowMinutes = typeof opts === 'number'
    ? opts
    : (opts.windowMinutes || ATTRIBUTION_WINDOW_MINUTES);
  const correlationTagPrefix = typeof opts === 'object' ? opts.correlationTagPrefix : null;

  if (!tenantId || !Array.isArray(alertSurfaces) || alertSurfaces.length === 0) {
    return null;
  }

  try {
    // Fetch candidate Panoptica events within the window. We fetch then
    // filter surface overlap in JS — consistent with the rest of the codebase
    // (MySQL JSON_OVERLAPS semantics vary across versions).
    const rows = await db.queryRows(
      `SELECT id, category, affected_surface, correlation_tag, started_at
         FROM tenant_change_events
        WHERE tenant_id = ?
          AND source = 'panoptica'
          AND deleted_at IS NULL
          AND started_at >= (NOW() - INTERVAL ? MINUTE)
        ORDER BY started_at DESC
        LIMIT 20`,
      [tenantId, windowMinutes]
    );

    const alertSet = new Set(alertSurfaces);
    for (const r of rows) {
      let eventSurfaces;
      try {
        eventSurfaces = typeof r.affected_surface === 'string'
          ? JSON.parse(r.affected_surface)
          : r.affected_surface;
      } catch {
        continue;
      }
      if (!Array.isArray(eventSurfaces)) continue;
      // Surface overlap check
      if (!eventSurfaces.some(s => alertSet.has(s))) continue;
      // Correlation-tag prefix filter (Apr 28, 2026): when caller passes a
      // prefix, only match rows whose tag starts with it. This disambiguates
      // shared-surface attribution (e.g., 'security_setting' covers every
      // security setting; without the prefix, an ENT-05 drift could match a
      // recent TEA-02 Apply because both are surface=security_setting).
      // Older rows (no prefix-tagged history) won't match — by design;
      // false negatives are safer than false attributions for past data.
      if (correlationTagPrefix) {
        if (!r.correlation_tag || !r.correlation_tag.startsWith(correlationTagPrefix)) continue;
      }
      return {
        id: r.id,
        category: r.category,
        correlation_tag: r.correlation_tag,
        started_at: r.started_at,
      };
    }
    return null;
  } catch (e) {
    console.error('[ChangeLog] findAttributingChange error:', e.message);
    return null;
  }
}

module.exports = {
  CATEGORY,
  SURFACE,
  ATTRIBUTION_WINDOW_MINUTES,
  newCorrelationTag,
  captureActorContext,
  logPanopticaChange,
  findAttributingChange,
};
