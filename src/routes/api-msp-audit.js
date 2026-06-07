/**
 * Panoptica365 — MSP Audit Log API
 *
 * Read-only endpoint backing the SYSTEM > Audit Log page.
 *
 * RBAC: Admin-only. Every route mounted here is gated by requireAdmin. Non-admin
 * operators will get 403 JSON. This is enforced at router level (not per-handler)
 * so new endpoints added later inherit the gate by default.
 *
 * There is intentionally NO write or delete endpoint. Rows are append-only by
 * design. Corrections are future work (separate "retraction" row pointing at
 * the original), not mutations of existing audit rows.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const eventI18n = require('../lib/event-description-i18n');

const router = express.Router();

/**
 * Resolve the language to render in. Order of precedence:
 *   1. ?lang= query param (en/fr/es), if explicitly provided
 *   2. req.session.user.language (operator's saved preference)
 *   3. 'en' fallback
 * Server-side rendering means the API always returns a finished, localized
 * description regardless of how the consumer asks. The raw template_key +
 * template_params are also returned so the consumer can re-render in another
 * language client-side if it wants to (rare).
 */
function resolveLang(req) {
  const q = (req.query?.lang || '').toString().toLowerCase();
  if (q === 'en' || q === 'fr' || q === 'es') return q;
  const u = req.session?.user;
  if (u?.language === 'fr' || u?.language === 'es') return u.language;
  return 'en';
}

// Both middlewares. requireAuth handles no-session redirect; requireAdmin
// handles the role check. Stacking is redundant but explicit — a future
// refactor that changes requireAdmin should still see an auth gate.
router.use(auth.requireAuth);
router.use(auth.requireAdmin);

// Valid filter values — keep in sync with the ENUM in msp-audit.js
const VALID_CATEGORIES = new Set([
  'auth', 'template_crud', 'rbac_change', 'settings_change',
  'tenant_lifecycle_msp', 'export', 'other',
]);

/**
 * GET /api/msp-audit/events
 *
 * Query params (all optional):
 *   from          ISO datetime (inclusive lower bound on created_at)
 *   to            ISO datetime (exclusive upper bound)
 *   category      single category string (must be in VALID_CATEGORIES)
 *   actor         substring match on actor_email
 *   target_type   exact match on target_type
 *   target_id     exact match on target_id
 *   q             full-text-ish LIKE on description
 *   success       'true' / 'false' — filter by outcome
 *   limit         default 100, max 500
 *   offset        default 0
 *
 * Returns: { total, rows: [...], limit, offset }
 */
router.get('/events', async (req, res) => {
  try {
    const { from, to, category, actor, target_type, target_id, q, success } = req.query;

    const where = ['1=1'];
    const params = [];

    if (from) {
      // Pass the raw ISO 8601 string straight to MySQL. Do NOT wrap in
      // new Date(): db.queryRows uses pool.execute() (true prepared
      // statements), and under that protocol mysql2 doesn't reliably
      // convert a JS Date object to MySQL DATETIME — the server rejects
      // it with "Incorrect arguments to mysqld_stmt_execute". MySQL 8
      // parses ISO 8601 natively in DATETIME comparisons; a garbage
      // string like "yesterday" becomes NULL with a warning (no 500).
      where.push('created_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('created_at < ?');
      params.push(to);
    }
    if (category) {
      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ error: `Invalid category: ${category}` });
      }
      where.push('category = ?');
      params.push(category);
    }
    if (actor) {
      where.push('actor_email LIKE ?');
      params.push(`%${actor}%`);
    }
    if (target_type) {
      where.push('target_type = ?');
      params.push(target_type);
    }
    if (target_id) {
      where.push('target_id = ?');
      params.push(target_id);
    }
    if (q) {
      where.push('description LIKE ?');
      params.push(`%${q}%`);
    }
    if (success === 'true')  { where.push('success = 1'); }
    if (success === 'false') { where.push('success = 0'); }

    // LIMIT/OFFSET are interpolated as integers (not bound) because mysql2's
    // prepared-statement path — which db.query uses via pool.execute() — rejects
    // ? placeholders for LIMIT/OFFSET with a cryptic server-side error. Safe
    // here because both values are hard-clamped to integer ranges below before
    // hitting the SQL.
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const whereClause = where.join(' AND ');

    // Total count for pagination — same filters, no limit.
    const countRow = await db.queryOne(
      `SELECT COUNT(*) AS total FROM msp_audit_events WHERE ${whereClause}`,
      params
    );
    const total = countRow?.total ?? 0;

    const rows = await db.queryRows(
      `SELECT id, created_at, category, action,
              actor_email, actor_oid, actor_role,
              actor_ip, actor_user_agent, actor_session_id,
              target_type, target_id, target_name,
              description, metadata, template_key, template_params,
              success, error_message
         FROM msp_audit_events
        WHERE ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Parse metadata JSON for the client. MySQL returns it as a string
    // (mysql2 default) or object depending on driver config; normalize.
    for (const r of rows) {
      if (typeof r.metadata === 'string') {
        try { r.metadata = JSON.parse(r.metadata); } catch { /* leave as string */ }
      }
      if (typeof r.template_params === 'string') {
        try { r.template_params = JSON.parse(r.template_params); } catch { /* leave as string */ }
      }
      r.success = !!r.success;
    }

    // Phase 11 (May 8, 2026): server-side i18n. Mutates rows in place,
    // moving the original English description to description_en and replacing
    // description with the localized render (or leaving as-is for legacy
    // rows where template_key is NULL).
    const lang = resolveLang(req);
    eventI18n.localizeRows('msp_audit', rows, lang);

    res.json({ total, rows, limit, offset, lang });
  } catch (err) {
    console.error('[MspAudit] List failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/msp-audit/summary
 * Cheap roll-up for the page header: counts by category over the last N days (default 30).
 */
router.get('/summary', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const rows = await db.queryRows(
      `SELECT category, COUNT(*) AS n, SUM(success=0) AS failures
         FROM msp_audit_events
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY category
        ORDER BY n DESC`,
      [days]
    );
    const totalRow = await db.queryOne(
      `SELECT COUNT(*) AS n, SUM(success=0) AS failures
         FROM msp_audit_events
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    res.json({
      days,
      total: totalRow?.n ?? 0,
      failures: totalRow?.failures ?? 0,
      by_category: rows.map(r => ({
        category: r.category,
        count: Number(r.n),
        failures: Number(r.failures || 0),
      })),
    });
  } catch (err) {
    console.error('[MspAudit] Summary failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED AUDIT LOG (Apr 23 2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Merges msp_audit_events + tenant_change_events into a single chronological
// timeline for admin review. Purpose: admin can answer "what happened across
// everything" without jumping between surfaces. Per-tenant Tenant Change Log
// stays intact (operator/reader access); this view is additive for admins.
//
// Load-bearing design decisions:
//  - Admin-only (inherits requireAdmin from router.use at top of file).
//  - Common shape projection so frontend renders one row type with a source
//    badge. Source values: 'msp' | 'tenant-manual' | 'tenant-auto'.
//  - Merge in memory. OK for realistic MSP workload (a few thousand events/
//    month); not OK for multi-year queries. Caller should always supply a
//    date range.
//  - Tenant rows use started_at (not created_at) — that's when the event
//    happened in the tenant, not when it was logged in Panoptica.
//  - No writes or deletes. Read-only.

const VALID_SOURCES = new Set(['all', 'msp', 'tenant-manual', 'tenant-auto', 'tenant']);

/**
 * GET /api/msp-audit/unified
 *
 * Query params (all optional):
 *   from          ISO datetime — lower bound, inclusive, applied to both tables
 *   to            ISO datetime — upper bound, exclusive
 *   source        'all' (default), 'msp', 'tenant-manual', 'tenant-auto', 'tenant'
 *                 — 'tenant' includes both tenant-manual and tenant-auto.
 *   q             description LIKE %q% (applied to both tables)
 *   tenant_id     filter to one tenant (tenant events only; if set with
 *                 source=msp, returns no rows by design)
 *   limit         default 100, max 500 (applied AFTER merge)
 *   offset        default 0
 *
 * Returns: { total, rows: [...], limit, offset }
 */
router.get('/unified', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const source = VALID_SOURCES.has(req.query.source) ? req.query.source : 'all';
    const wantMsp = source === 'all' || source === 'msp';
    const wantTenantManual = source === 'all' || source === 'tenant' || source === 'tenant-manual';
    const wantTenantAuto = source === 'all' || source === 'tenant' || source === 'tenant-auto';

    const from = typeof req.query.from === 'string' && req.query.from.length > 0 ? req.query.from : null;
    const to   = typeof req.query.to   === 'string' && req.query.to.length   > 0 ? req.query.to   : null;
    const q    = typeof req.query.q    === 'string' && req.query.q.trim().length > 0 ? req.query.q.trim() : null;
    const tenantIdFilter = req.query.tenant_id ? parseInt(req.query.tenant_id, 10) : null;

    // ─── MSP side ───
    const mspRows = [];
    if (wantMsp && !tenantIdFilter) {
      const clauses = [];
      const params = [];
      if (from) { clauses.push('created_at >= ?'); params.push(from); }
      if (to)   { clauses.push('created_at <  ?'); params.push(to); }
      if (q)    { clauses.push('description LIKE ?'); params.push('%' + q + '%'); }
      const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
      const rows = await db.queryRows(
        `SELECT id, category, action, description, actor_email, actor_role,
                success, error_message, target_type, target_id, target_name,
                metadata, template_key, template_params, created_at
           FROM msp_audit_events
           ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT 1000`,
        params
      );
      for (const r of rows) mspRows.push(projectMsp(r));
    }

    // ─── Tenant side ───
    const tenantRows = [];
    if (wantTenantManual || wantTenantAuto) {
      const clauses = ['e.deleted_at IS NULL'];
      const params = [];
      if (from) { clauses.push('e.started_at >= ?'); params.push(from); }
      if (to)   { clauses.push('e.started_at <  ?'); params.push(to); }
      if (q)    { clauses.push('e.description LIKE ?'); params.push('%' + q + '%'); }
      if (tenantIdFilter) { clauses.push('e.tenant_id = ?'); params.push(tenantIdFilter); }
      // Source filter — reduce DB work when narrowing.
      if (wantTenantManual && !wantTenantAuto) { clauses.push("e.source = 'manual'"); }
      if (wantTenantAuto && !wantTenantManual) { clauses.push("e.source = 'panoptica'"); }
      const where = 'WHERE ' + clauses.join(' AND ');
      const rows = await db.queryRows(
        `SELECT e.id, e.tenant_id, e.source, e.category, e.affected_surface,
                e.started_at, e.ended_at, e.impact, e.description,
                e.template_key, e.template_params,
                e.correlation_tag, e.created_by, e.created_at,
                t.display_name AS tenant_name
           FROM tenant_change_events e
           LEFT JOIN tenants t ON t.id = e.tenant_id
           ${where}
           ORDER BY e.started_at DESC, e.id DESC
           LIMIT 1000`,
        params
      );
      for (const r of rows) tenantRows.push(projectTenant(r));
    }

    // ─── Merge + sort ───
    const all = mspRows.concat(tenantRows);
    all.sort((a, b) => {
      // Primary key: timestamp DESC. Secondary: source-stable (kind+id) so
      // same-second events don't flicker between renders.
      const ta = +new Date(a.timestamp);
      const tb = +new Date(b.timestamp);
      if (ta !== tb) return tb - ta;
      if (a.detail.kind !== b.detail.kind) return a.detail.kind.localeCompare(b.detail.kind);
      return b.detail.id - a.detail.id;
    });

    const total = all.length;
    const page = all.slice(offset, offset + limit);

    // Phase 11 server-side i18n: localize each row's description using its
    // table-specific renderer (msp rows → event_descriptions.msp_audit.<key>;
    // tenant rows → event_descriptions.tenant_change.<key>). Each row carries
    // _i18n_table from its projectXxx() function so we know which namespace
    // to look in.
    const lang = resolveLang(req);
    for (const row of page) {
      const localized = eventI18n.renderDescription(row._i18n_table, row, lang);
      row.description_en = row.description;
      row.description = localized;
      delete row._i18n_table;  // internal-only routing hint, don't ship to client
    }

    res.json({ total, rows: page, limit, offset, lang });
  } catch (err) {
    console.error('[MspAudit] Unified query failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function projectMsp(r) {
  let templateParams = r.template_params;
  if (typeof templateParams === 'string') {
    try { templateParams = JSON.parse(templateParams); } catch { templateParams = null; }
  }
  return {
    source: 'msp',
    timestamp: r.created_at,
    actor: r.actor_email || null,
    actor_role: r.actor_role || null,
    tenant_id: null,
    tenant_name: null,
    category: r.category,
    action: r.action,
    description: r.description,
    template_key: r.template_key || null,
    template_params: templateParams || null,
    _i18n_table: 'msp_audit',
    success: !!r.success,
    error_message: r.error_message || null,
    impact: null,
    target_type: r.target_type || null,
    target_id: r.target_id || null,
    target_name: r.target_name || null,
    detail: { kind: 'msp', id: r.id },
  };
}

function projectTenant(r) {
  let surfaces = [];
  try {
    const raw = typeof r.affected_surface === 'string' ? JSON.parse(r.affected_surface) : r.affected_surface;
    if (Array.isArray(raw)) surfaces = raw;
  } catch { /* non-fatal — leave empty */ }
  let templateParams = r.template_params;
  if (typeof templateParams === 'string') {
    try { templateParams = JSON.parse(templateParams); } catch { templateParams = null; }
  }
  return {
    source: r.source === 'panoptica' ? 'tenant-auto' : 'tenant-manual',
    timestamp: r.started_at,
    actor: r.created_by || null,
    actor_role: null,
    tenant_id: r.tenant_id,
    tenant_name: r.tenant_name || null,
    category: r.category,
    action: null,
    description: r.description,
    template_key: r.template_key || null,
    template_params: templateParams || null,
    _i18n_table: 'tenant_change',
    success: true,
    error_message: null,
    impact: r.impact || null,
    surfaces,
    ended_at: r.ended_at || null,
    correlation_tag: r.correlation_tag || null,
    detail: { kind: 'tenant', id: r.id },
  };
}

module.exports = router;
