/**
 * Panoptica365 — Tenant Mode Helpers
 *
 * Single source of truth for the audit_only / managed distinction.
 * Every code path that mutates tenant state MUST call requireManagedMode()
 * and bail out (or no-op) if it returns false.
 *
 * Modes:
 *   - managed     : full Panoptica feature set (alerts, drift, push, log)
 *   - audit_only  : read-only data collection for snapshot export.
 *                   No alerts, no drift, no writes to customer tenant,
 *                   no msp_audit_events / tenant_change_events writes,
 *                   no scheduled polling. Tenant auto-deletes after the
 *                   audit lifecycle (see schema-audit-mode.sql).
 */

const db = require('../db/database');

const MODE_MANAGED = 'managed';
const MODE_AUDIT_ONLY = 'audit_only';

/** Lightweight in-memory cache to avoid hammering the tenants table on every
 *  alert/drift evaluation. Invalidated whenever a mode changes via setMode(). */
const _cache = new Map();
const CACHE_TTL_MS = 30_000;

/**
 * Get the mode for a tenant. Returns 'managed' if not found (defensive default
 * — never accidentally treat an unknown tenant as audit_only and silently
 * skip writes the operator expected to happen).
 */
async function getMode(tenantId) {
  if (!tenantId) return MODE_MANAGED;
  const id = parseInt(tenantId, 10);
  const cached = _cache.get(id);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return cached.mode;
  }
  const row = await db.queryOne(
    'SELECT mode FROM tenants WHERE id = ? LIMIT 1',
    [id]
  );
  const mode = (row && row.mode) || MODE_MANAGED;
  _cache.set(id, { mode, t: Date.now() });
  return mode;
}

async function isAuditOnly(tenantId) {
  return (await getMode(tenantId)) === MODE_AUDIT_ONLY;
}

async function isManaged(tenantId) {
  return (await getMode(tenantId)) === MODE_MANAGED;
}

/**
 * Throws AuditOnlyTenantError if the tenant is audit_only.
 * Use at the top of any function/endpoint that mutates tenant-side state
 * (Apply, Remediate, Match, Accept, push CA template, push Intune template,
 * write to msp_audit_events, write to tenant_change_events, etc.).
 *
 * Pattern:
 *   const { requireManagedMode } = require('../lib/tenant-mode');
 *   await requireManagedMode(tenantId, 'security-settings.apply');
 */
class AuditOnlyTenantError extends Error {
  constructor(tenantId, action) {
    super(`Tenant ${tenantId} is audit_only — action "${action}" refused.`);
    this.name = 'AuditOnlyTenantError';
    this.code = 'AUDIT_ONLY_TENANT';
    this.statusCode = 403;
    this.tenantId = tenantId;
    this.action = action;
  }
}

async function requireManagedMode(tenantId, action = 'unspecified') {
  if (await isAuditOnly(tenantId)) {
    throw new AuditOnlyTenantError(tenantId, action);
  }
}

/**
 * Soft variant — returns true if the action should proceed, false if the
 * tenant is audit_only. Use in background jobs (alert engine, drift
 * scheduler) where throwing would crash the job loop. Caller should log
 * the skip and continue.
 */
async function shouldProcessTenant(tenantId) {
  return await isManaged(tenantId);
}

/**
 * Express middleware factory. Use on routes that act on a specific tenant
 * (URL param :tenantId or :id, or req.body.tenant_id).
 *
 *   router.post('/api/security/:tenantId/apply',
 *     requireManagedMiddleware('apply-security-setting'),
 *     async (req, res) => { ... });
 */
function requireManagedMiddleware(action) {
  return async (req, res, next) => {
    const tenantId = req.params.tenantId
      || req.params.id
      || (req.body && (req.body.tenant_id || req.body.tenantId));
    if (!tenantId) {
      return next(); // can't gate without tenant context — let handler decide
    }
    try {
      await requireManagedMode(tenantId, action);
      return next();
    } catch (e) {
      if (e instanceof AuditOnlyTenantError) {
        return res.status(403).json({
          error: 'audit_only_tenant',
          message: `This tenant is in audit-only mode. The action "${action}" is not permitted on audit-only tenants. Convert the tenant to managed mode (requires a license) to enable mutations.`,
          tenantId: e.tenantId,
          action: e.action,
        });
      }
      return next(e);
    }
  };
}

/**
 * Compute audit_expires_at = created_at + 14 days. Caller persists.
 * Returns ISO string suitable for MySQL DATETIME column.
 */
function computeAuditExpiresAt(createdAt = new Date()) {
  const t = new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Compute hard-delete date = audit_expires_at + 7-day grace.
 */
function computeHardDeleteAt(auditExpiresAt) {
  const t = new Date(auditExpiresAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Invalidate the cache for one tenant. Call after any UPDATE tenants SET mode.
 */
function invalidateCache(tenantId) {
  _cache.delete(parseInt(tenantId, 10));
}

function clearCache() {
  _cache.clear();
}

module.exports = {
  MODE_MANAGED,
  MODE_AUDIT_ONLY,
  AuditOnlyTenantError,
  getMode,
  isAuditOnly,
  isManaged,
  requireManagedMode,
  shouldProcessTenant,
  requireManagedMiddleware,
  computeAuditExpiresAt,
  computeHardDeleteAt,
  invalidateCache,
  clearCache,
};
