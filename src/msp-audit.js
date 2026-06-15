/**
 * Panoptica365 — MSP Audit Log Service
 *
 * Captures operator actions at the MSP/platform level (NOT tenant-scoped).
 * Complements tenant_change_events (which captures per-tenant actions).
 *
 * Writes into `msp_audit_events`. Reads are Admin-only via the SYSTEM > Audit Log page.
 *
 * Design rules (load-bearing — read before changing):
 *
 *  1. Denormalize actor identity. Store actor_email, actor_oid, actor_role as
 *     they were at the time of the action. If the operator's email later changes
 *     or their Entra role is moved, the audit row must still say what was true
 *     then. Joins to a live users table would defeat the audit purpose.
 *
 *  2. Never log secret material. Do not put API keys, tokens, passwords, or
 *     client secrets into description or metadata. When a secret changes,
 *     the description says "rotated" and metadata carries a masked preview only.
 *
 *  3. Never let an audit failure kill the underlying mutation. Every call is
 *     wrapped in try/catch; a failure logs LOUDLY to stderr and returns null.
 *     A missing audit row is a known observability gap, not a data-loss event.
 *     This mirrors the contract in src/change-log.js::logPanopticaChange.
 *
 *  4. Records are immutable. There is no UPDATE or DELETE path in the service
 *     layer. If a bad row slips through, it stays — retractions are written as
 *     a new row with a pointer to the original in metadata.
 *
 *  5. Keep categories coarse, actions fine. `category` is for filtering in the
 *     UI (a short enum); `action` is the exact verb (unconstrained string).
 */

const db = require('./db/database');

// ─── Category enum — keep short and stable. DB ENUM mirrors this. ───
const CATEGORY = {
  AUTH:                 'auth',                 // login/logout
  TEMPLATE_CRUD:        'template_crud',        // CA + Intune template create/update/delete
  RBAC_CHANGE:          'rbac_change',          // group-ID assignments (which Entra group maps to admin/member/viewer)
  SETTINGS_CHANGE:      'settings_change',      // SMTP, notifications, Anthropic key, etc.
  TENANT_LIFECYCLE_MSP: 'tenant_lifecycle_msp', // onboard (admin consent), re-consent, disable
  EXPORT:               'export',               // reserved — CSV/PDF exports of privileged data
  USER_PREFS:           'user_prefs',           // per-operator prefs — mute create/revoke (Apr 28, 2026)
  ACCESS_DENIED:        'access_denied',        // 403 from requireAdmin / requireMemberOrAdmin (May 9, 2026)
  TENANT_CONFIG:        'tenant_config',        // adopt-in-place: import + lifecycle of tenant-sourced CA/Intune objects (Jun 15, 2026)
  OTHER:                'other',
  MAINTENANCE:          'maintenance',          // app self-update events (Stage 5)
};

/**
 * Extract operator identity + actor context from an Express req.
 * Returns a ready-to-spread object. Background jobs / boot-time calls
 * should pass no req; those columns will be null, which is the correct
 * signal that no human session initiated the action.
 */
function captureOperator(req) {
  if (!req) return {};
  const u = req.session?.user || {};
  const ip = (req.ip || req.connection?.remoteAddress || '').slice(0, 45);
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 500);
  const sid = (req.sessionID || req.session?.id || '').slice(0, 128);
  return {
    actorEmail:     u.email     || null,
    actorOid:       u.oid       || null,
    actorRole:      u.role      || null,
    actorIp:        ip  || null,
    actorUserAgent: ua  || null,
    actorSessionId: sid || null,
  };
}

/**
 * Write one row to msp_audit_events.
 *
 * @param {object} opts
 * @param {string}  opts.category       — one of CATEGORY values (DB ENUM)
 * @param {string}  opts.action         — specific verb, e.g. 'template.create', 'login.success'
 * @param {string}  opts.description    — short human-readable summary (<=500ch). English fallback when template_key is NULL or unmappable.
 * @param {string}  [opts.templateKey]  — i18n key under event_descriptions.msp_audit.<key>. Renderer interpolates templateParams. Falls back to description if missing.
 * @param {object}  [opts.templateParams] — flat object of params for template interpolation, e.g. { name: 'Block Legacy Auth', id: 12 }
 * @param {boolean} [opts.success=true]
 * @param {string}  [opts.errorMessage]
 * @param {string}  [opts.targetType]   — 'template'|'tenant'|'setting'|'user'|null
 * @param {string}  [opts.targetId]     — int id (as string) or GUID
 * @param {string}  [opts.targetName]   — denormalized display name
 * @param {object}  [opts.metadata]     — JSON-serializable extra context
 * @param {object}  [opts.req]          — if provided, captureOperator fills actor fields
 * @param {string}  [opts.actorEmail]   — explicit overrides (used by login failure path where req.session.user doesn't exist yet)
 * @param {string}  [opts.actorOid]
 * @param {string}  [opts.actorRole]
 * @param {string}  [opts.actorIp]
 * @param {string}  [opts.actorUserAgent]
 * @param {string}  [opts.actorSessionId]
 * @returns {Promise<{id:number|null}>}
 */
async function logMspAudit(opts) {
  const {
    category,
    action,
    description,
    templateKey = null,
    templateParams = null,
    success = true,
    errorMessage = null,
    targetType = null,
    targetId = null,
    targetName = null,
    metadata = null,
    req = null,
  } = opts || {};

  if (!Object.values(CATEGORY).includes(category)) {
    console.error('⚠  [MspAudit] Invalid category — AUDIT GAP:', category, action);
    return { id: null };
  }
  if (!action || typeof action !== 'string') {
    console.error('⚠  [MspAudit] Missing action — AUDIT GAP:', category, description);
    return { id: null };
  }

  // Resolve actor fields: explicit opts win over req-derived.
  const fromReq = captureOperator(req);
  const actorEmail     = opts.actorEmail     ?? fromReq.actorEmail     ?? null;
  const actorOid       = opts.actorOid       ?? fromReq.actorOid       ?? null;
  const actorRole      = opts.actorRole      ?? fromReq.actorRole      ?? null;
  const actorIp        = opts.actorIp        ?? fromReq.actorIp        ?? null;
  const actorUserAgent = opts.actorUserAgent ?? fromReq.actorUserAgent ?? null;
  const actorSessionId = opts.actorSessionId ?? fromReq.actorSessionId ?? null;

  // Defensive clamping — DB columns are the source of truth, but callers are
  // often loose. Clamp here so a slip doesn't reach MySQL and trip STRICT mode.
  const descClamped   = String(description || '').slice(0, 500);
  const actionClamped = String(action).slice(0, 64);
  const tgtTypeClamp  = targetType ? String(targetType).slice(0, 32)  : null;
  const tgtIdClamp    = targetId   ? String(targetId).slice(0, 64)    : null;
  const tgtNameClamp  = targetName ? String(targetName).slice(0, 255) : null;
  const emailClamped  = actorEmail ? String(actorEmail).slice(0, 255) : null;
  const oidClamped    = actorOid   ? String(actorOid).slice(0, 64)    : null;
  const roleClamped   = actorRole  ? String(actorRole).slice(0, 16)   : null;
  const ipClamped     = actorIp    ? String(actorIp).slice(0, 45)     : null;
  const uaClamped     = actorUserAgent ? String(actorUserAgent).slice(0, 500) : null;
  const sidClamped    = actorSessionId ? String(actorSessionId).slice(0, 128) : null;

  let metadataJson = null;
  if (metadata !== null && metadata !== undefined) {
    try {
      metadataJson = JSON.stringify(metadata);
    } catch (e) {
      console.warn('[MspAudit] metadata serialization failed — dropping:', e.message);
    }
  }

  // Template fields for i18n. Both nullable; legacy rows leave them NULL and
  // the renderer falls back to description.
  const tplKeyClamped = templateKey ? String(templateKey).slice(0, 64) : null;
  let tplParamsJson = null;
  if (templateParams !== null && templateParams !== undefined) {
    try {
      tplParamsJson = JSON.stringify(templateParams);
    } catch (e) {
      console.warn('[MspAudit] template_params serialization failed — dropping:', e.message);
    }
  }

  try {
    const result = await db.execute(
      `INSERT INTO msp_audit_events
        (category, action, actor_email, actor_oid, actor_role,
         actor_ip, actor_user_agent, actor_session_id,
         target_type, target_id, target_name,
         description, metadata, template_key, template_params, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category,
        actionClamped,
        emailClamped,
        oidClamped,
        roleClamped,
        ipClamped,
        uaClamped,
        sidClamped,
        tgtTypeClamp,
        tgtIdClamp,
        tgtNameClamp,
        descClamped,
        metadataJson,
        tplKeyClamped,
        tplParamsJson,
        success ? 1 : 0,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
      ]
    );
    const insertId = result?.insertId ?? result?.[0]?.insertId ?? null;
    return { id: insertId };
  } catch (e) {
    console.error(
      '⚠  [MspAudit] Failed to write audit row — AUDIT GAP:',
      e.code || '(no code)',
      e.message,
      { category, action: actionClamped, targetType: tgtTypeClamp, targetId: tgtIdClamp }
    );
    return { id: null };
  }
}

/**
 * Mask a secret for audit metadata (first 7 + last 4, with middle elided).
 * Use for Anthropic key previews, SMTP passwords, etc. NEVER log the raw value.
 */
function maskSecret(v) {
  if (!v) return '';
  const s = String(v);
  if (s.length <= 12) return s.slice(0, 4) + '…';
  const prefix = s.startsWith('sk-ant-') ? 'sk-ant-' : s.slice(0, 7);
  return `${prefix}…${s.slice(-4)}`;
}

/**
 * Create the msp_audit_events table if missing. Called once at boot from
 * src/server.js. Idempotent — safe to run repeatedly. Mirrors the
 * ensureAlertColumns pattern (try/catch per DDL, informational logging).
 */
async function ensureMspAuditTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS msp_audit_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        category ENUM(
          'auth','template_crud','rbac_change','settings_change',
          'tenant_lifecycle_msp','export','user_prefs','access_denied','tenant_config','other','maintenance'
        ) NOT NULL,
        action VARCHAR(64) NOT NULL,
        actor_email VARCHAR(255) DEFAULT NULL,
        actor_oid VARCHAR(64) DEFAULT NULL,
        actor_role VARCHAR(16) DEFAULT NULL,
        actor_ip VARCHAR(45) DEFAULT NULL,
        actor_user_agent VARCHAR(500) DEFAULT NULL,
        actor_session_id VARCHAR(128) DEFAULT NULL,
        target_type VARCHAR(32) DEFAULT NULL,
        target_id VARCHAR(64) DEFAULT NULL,
        target_name VARCHAR(255) DEFAULT NULL,
        description VARCHAR(500) NOT NULL,
        metadata JSON DEFAULT NULL,
        success TINYINT(1) NOT NULL DEFAULT 1,
        error_message TEXT DEFAULT NULL,
        INDEX idx_created (created_at),
        INDEX idx_category_created (category, created_at),
        INDEX idx_actor_created (actor_email, created_at),
        INDEX idx_target (target_type, target_id),
        INDEX idx_action (action, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[MspAudit] Ensured msp_audit_events table exists');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('[MspAudit] msp_audit_events migration error:', e.message);
    }
  }

  // Apr 28, 2026: extend the category ENUM to include 'user_prefs' for
  // operator mute create/revoke. Idempotent: MODIFY is a no-op if the ENUM
  // already matches. Probe COLUMN_TYPE first so the log line only fires when
  // something actually changed. Same pattern as the Apr 19 change-events
  // ENUM extension.
  //
  // May 9, 2026 (A3): extended to include 'access_denied' for the 403 path
  // through requireAdmin / requireMemberOrAdmin. Single ALTER handles both
  // additions — the probe checks for the newest value, so when an older DB
  // missing 'access_denied' boots, the MODIFY brings both into place at once.
  //
  // Jun 15, 2026 (Adopt-in-Place): extended to include 'tenant_config' for the
  // import + lifecycle actions on tenant-sourced CA/Intune objects. The probe
  // now checks for the newest value so a DB missing it gets brought current.
  try {
    const col = await db.queryOne(
      "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'msp_audit_events' AND COLUMN_NAME = 'category'"
    );
    if (col && col.COLUMN_TYPE && !col.COLUMN_TYPE.includes("'tenant_config'")) {
      await db.execute(`
        ALTER TABLE msp_audit_events
          MODIFY COLUMN category ENUM(
            'auth','template_crud','rbac_change','settings_change',
            'tenant_lifecycle_msp','export','user_prefs','access_denied','tenant_config','other','maintenance'
          ) NOT NULL
      `);
      console.log("[MspAudit] Extended category ENUM with 'tenant_config'");
    }
  } catch (e) {
    console.warn('[MspAudit] category ENUM extension (non-fatal):', e.message);
  }

  // May 8, 2026: i18n templating for description column.
  // Adds template_key + template_params so the renderer can produce
  // localized descriptions in the operator's language at read time.
  // The existing `description` column stays as the English fallback for
  // legacy rows and any future writer that doesn't yet emit a template.
  // Idempotent: probe INFORMATION_SCHEMA first.
  for (const col of [
    { name: 'template_key', sql: "ALTER TABLE msp_audit_events ADD COLUMN template_key VARCHAR(64) DEFAULT NULL COMMENT 'i18n key under event_descriptions.msp_audit.<key>; NULL = legacy row, render description as-is' AFTER metadata" },
    { name: 'template_params', sql: "ALTER TABLE msp_audit_events ADD COLUMN template_params JSON DEFAULT NULL COMMENT 'Param map for template interpolation, e.g. {name, id}' AFTER template_key" },
  ]) {
    try {
      const exists = await db.queryOne(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'msp_audit_events' AND COLUMN_NAME = ?",
        [col.name]
      );
      if (!exists) {
        await db.execute(col.sql);
        console.log(`[MspAudit] Added column msp_audit_events.${col.name}`);
      }
    } catch (e) {
      console.warn(`[MspAudit] Adding ${col.name} (non-fatal):`, e.message);
    }
  }
}

module.exports = {
  CATEGORY,
  captureOperator,
  logMspAudit,
  maskSecret,
  ensureMspAuditTable,
};
