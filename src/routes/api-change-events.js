/**
 * Panoptica — Tenant Change Events API (Change Log feature, 2026-04-19)
 *
 * Operator-logged context events (source='manual') and, in a future phase,
 * Panoptica-initiated change events (source='panoptica'). Surfaced per-tenant
 * on the Tenant Dashboard > Change Log view, and injected into the Haiku
 * daily digest prompt as NARRATIVE CONTEXT ONLY.
 *
 * Governance boundary (enforced here, not at the LLM):
 *   - Notes never drive suppression or severity downgrade of alerts. The
 *     LLM is instructed to use them for narrative only. If an operator
 *     genuinely needs to silence a recurring alert, the exemption system
 *     (/api/exemptions) is the correct path — not this log.
 *   - Every mutation (PUT/DELETE/restore) writes a snapshot row to
 *     tenant_change_event_edits FIRST, so the history is append-only.
 *   - Soft delete only — deleted_at is set, row is retained.
 *
 * Endpoints:
 *   GET    /?tenant_id=X&date=YYYY-MM-DD       List events for a single day
 *   GET    /range?tenant_id=X&from=&to=        List events in a date range (used by digest)
 *   GET    /:id                                Fetch one event + edit history
 *   POST   /                                   Create a new event
 *   PUT    /:id                                Edit (snapshot prior state first)
 *   DELETE /:id                                Soft delete (snapshot prior state first)
 *   POST   /:id/restore                        Restore a soft-deleted event
 *
 * Mounted at /api/change-events in server.js.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const eventI18n = require('../lib/event-description-i18n');

const router = express.Router();
router.use(auth.requireAuth);

// Resolve render language from query param or operator's session preference.
// Server-side i18n: API returns finished, localized descriptions. Raw
// template_key + template_params are returned alongside so the consumer can
// re-render in another language client-side if it wants to.
function resolveLang(req) {
  const q = (req.query?.lang || '').toString().toLowerCase();
  if (q === 'en' || q === 'fr' || q === 'es') return q;
  const u = req.session?.user;
  if (u?.language === 'fr' || u?.language === 'es') return u.language;
  return 'en';
}

// ─── Audit-journal lockdown window ────────────────────────────────────
//
// Manual change events (source='manual') are editable and deletable for a
// limited window after creation. Past the window they become immutable.
//
// Rationale: this table is the tenant's audit of record. Unbounded edits mean
// operators could rewrite yesterday's log before an auditor or customer sees
// it — that is not an audit journal, it is a notepad. The 60-minute window
// preserves fast typo corrections while preventing after-the-fact rewriting.
//
// Backstop: every edit already snapshots prior state into tenant_change_event_edits
// (append-only). So even within the window, the original is preserved forensically.
// The time lock is the *visible* commitment to immutability. Both layers matter
// for a commercial-grade audit journal.
//
// Corrections past the window: operators file a new event that references the
// prior event's correlation_tag (or id) in the description. Cleaner audit story
// than a silent edit.
const EDIT_WINDOW_MINUTES = 60;

/**
 * Returns { locked: boolean, reason?: string } for a manual event.
 * Panoptica-sourced events are always locked (handled separately).
 */
function computeLockState(row) {
  if (!row || row.source !== 'manual') return { locked: true, reason: 'non-manual' };
  // Lock window is measured from created_at for edit/delete;
  // from updated_at for restore (so you can undo a delete within the hour).
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  const ageMs = Date.now() - created.getTime();
  const windowMs = EDIT_WINDOW_MINUTES * 60 * 1000;
  if (ageMs > windowMs) return { locked: true, reason: 'window_expired' };
  return { locked: false };
}

// ─── Valid enum values (mirror ENUM columns in tenant_change_events) ──
const VALID_CATEGORIES = new Set([
  'ca_deploy', 'ca_retire', 'ca_edit',
  'intune_push', 'intune_retire', 'intune_edit',
  'named_location', 'exemption', 'remediation',
  'manual_cleanup', 'incident_response', 'migration', 'other',
]);
const VALID_SURFACES = new Set([
  'ca', 'intune', 'identity', 'mfa', 'named_locations',
  'sharepoint', 'exchange', 'devices', 'other',
]);
const VALID_IMPACTS = new Set(['low', 'medium', 'high']);

// ─── Helpers ──────────────────────────────────────────────────────────

function parseSurface(raw) {
  if (!raw) return [];
  let arr;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (_) { arr = [raw]; }
  } else return [];
  return arr
    .map(s => String(s).toLowerCase().trim())
    .filter(s => VALID_SURFACES.has(s));
}

function normalizeEventRow(row, lang = 'en') {
  if (!row) return null;
  let surfaces = row.affected_surface;
  if (typeof surfaces === 'string') {
    try { surfaces = JSON.parse(surfaces); } catch (_) { surfaces = []; }
  }
  let templateParams = row.template_params;
  if (typeof templateParams === 'string') {
    try { templateParams = JSON.parse(templateParams); } catch (_) { templateParams = null; }
  }
  // Compute the "editable until" timestamp for the UI so the frontend doesn't
  // need to duplicate the window calculation. null for Panoptica-sourced or
  // never-editable rows. For a manual row, editable_until is created_at + window
  // regardless of current clock — the frontend compares against now().
  let editableUntil = null;
  let locked = true;
  if (row.source === 'manual') {
    const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    editableUntil = new Date(created.getTime() + EDIT_WINDOW_MINUTES * 60 * 1000);
    locked = editableUntil.getTime() <= Date.now();
  }
  // Phase 11 server-side i18n: localize description from template_key/params.
  // Falls back to the English description column for legacy rows where
  // template_key is NULL (manual operator-typed descriptions also stay as-typed).
  const localizedDescription = eventI18n.renderDescription(
    'tenant_change',
    { template_key: row.template_key, template_params: templateParams, description: row.description },
    lang
  );
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    source: row.source,
    category: row.category,
    affected_surface: Array.isArray(surfaces) ? surfaces : [],
    started_at: row.started_at,
    ended_at: row.ended_at,
    impact: row.impact,
    description: localizedDescription,
    description_en: row.description,
    template_key: row.template_key || null,
    template_params: templateParams || null,
    correlation_tag: row.correlation_tag,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    // Audit-journal immutability hints for the UI. `locked=true` ⇒ hide edit/delete.
    editable_until: editableUntil,
    locked,
  };
}

async function snapshot(eventId, userEmail, action) {
  const row = await db.queryOne(
    'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  if (!row) return false;
  await db.execute(
    `INSERT INTO tenant_change_event_edits (event_id, edited_by, action, snapshot)
     VALUES (?, ?, ?, ?)`,
    [eventId, userEmail || null, action, JSON.stringify(row)]
  );
  return true;
}

// ─── Validation for create/update body ────────────────────────────────

function validateBody(body, { requireAll }) {
  const errors = [];
  const fields = {};

  if (body.category !== undefined) {
    if (!VALID_CATEGORIES.has(body.category)) errors.push('invalid category');
    else fields.category = body.category;
  } else if (requireAll) errors.push('category required');

  if (body.affected_surface !== undefined) {
    const s = parseSurface(body.affected_surface);
    if (s.length === 0) errors.push('affected_surface must include at least one valid surface');
    else fields.affected_surface = s;
  } else if (requireAll) errors.push('affected_surface required');

  if (body.started_at !== undefined) {
    const d = new Date(body.started_at);
    if (isNaN(d.getTime())) errors.push('invalid started_at');
    else fields.started_at = d;
  } else if (requireAll) errors.push('started_at required');

  if (body.ended_at !== undefined && body.ended_at !== null && body.ended_at !== '') {
    const d = new Date(body.ended_at);
    if (isNaN(d.getTime())) errors.push('invalid ended_at');
    else fields.ended_at = d;
  } else if (body.ended_at === null || body.ended_at === '') {
    fields.ended_at = null;
  }

  if (body.impact !== undefined) {
    if (!VALID_IMPACTS.has(body.impact)) errors.push('invalid impact');
    else fields.impact = body.impact;
  } else if (requireAll) fields.impact = 'medium';

  if (body.description !== undefined) {
    const desc = body.description === null ? null : String(body.description).slice(0, 500);
    fields.description = desc;
  }

  return { errors, fields };
}

// ─── GET /?tenant_id=X&date=YYYY-MM-DD ────────────────────────────────
// List events for a single calendar day (operator UI)

router.get('/', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

    const date = req.query.date; // YYYY-MM-DD
    const includeDeleted = req.query.include_deleted === '1';

    const clauses = ['tenant_id = ?'];
    const params = [tenantId];

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      clauses.push('DATE(started_at) = ?');
      params.push(date);
    }
    if (!includeDeleted) clauses.push('deleted_at IS NULL');

    const rows = await db.queryRows(
      `SELECT * FROM tenant_change_events
        WHERE ${clauses.join(' AND ')}
        ORDER BY started_at DESC, id DESC
        LIMIT 500`,
      params
    );
    const lang = resolveLang(req);
    res.json({ events: rows.map(r => normalizeEventRow(r, lang)) });
  } catch (e) {
    console.error('[API] change-events GET list error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /range?tenant_id=X&from=&to= ─────────────────────────────────
// Date-range query used by the Haiku digest (single day = from=to).
// Also powers 7/30/90-day report summaries later.

router.get('/range', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) required' });
    }

    const surfaces = parseSurface(req.query.surfaces);
    const rows = await db.queryRows(
      `SELECT * FROM tenant_change_events
        WHERE tenant_id = ? AND deleted_at IS NULL
          AND DATE(started_at) BETWEEN ? AND ?
        ORDER BY started_at DESC, id DESC
        LIMIT 200`,
      [tenantId, from, to]
    );

    // Surface filter applied in JS to match codebase convention (MySQL JSON
    // function semantics vary across versions — Claude.md notes this).
    const lang = resolveLang(req);
    let events = rows.map(r => normalizeEventRow(r, lang));
    if (surfaces.length > 0) {
      const surfaceSet = new Set(surfaces);
      events = events.filter(e => e.affected_surface.some(s => surfaceSet.has(s)));
    }
    res.json({ events });
  } catch (e) {
    console.error('[API] change-events GET range error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /:id — fetch one event + edit history ───────────────────────

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const row = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not found' });

    const history = await db.queryRows(
      `SELECT id, edited_by, edited_at, action
         FROM tenant_change_event_edits
        WHERE event_id = ?
        ORDER BY edited_at DESC, id DESC`,
      [id]
    );
    res.json({ event: normalizeEventRow(row, resolveLang(req)), history });
  } catch (e) {
    console.error('[API] change-events GET one error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST / — create a new manual event ──────────────────────────────
// A3 (May 9, 2026): operator — per-tenant operational annotation.
router.post('/', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = parseInt(req.body.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });

    const { errors, fields } = validateBody(req.body, { requireAll: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const userEmail = req.session?.user?.email || null;
    // Audit-trail actor context — same shape change-log.js uses for Panoptica rows.
    const actorIp = (req.ip || req.connection?.remoteAddress || '').slice(0, 45) || null;
    const actorUa = String(req.headers?.['user-agent'] || '').slice(0, 500) || null;
    const actorSid = (req.sessionID || req.session?.id || '').slice(0, 128) || null;

    const result = await db.execute(
      `INSERT INTO tenant_change_events
         (tenant_id, source, category, affected_surface, started_at, ended_at, impact, description, created_by, actor_ip, actor_user_agent, actor_session_id)
       VALUES (?, 'manual', ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        fields.category,
        JSON.stringify(fields.affected_surface),
        fields.started_at,
        fields.ended_at || null,
        fields.impact || 'medium',
        fields.description || null,
        userEmail,
        actorIp,
        actorUa,
        actorSid,
      ]
    );

    const insertId = result.insertId || result;
    const row = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [insertId]
    );
    console.log(`[API] Change event ${insertId} logged for tenant ${tenantId} by ${userEmail} (${fields.category})`);
    res.status(201).json({ event: normalizeEventRow(row) });
  } catch (e) {
    console.error('[API] change-events POST error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PUT /:id — edit (snapshot first) ────────────────────────────────
// A3 (May 9, 2026): operator — edit own/team-created change events.
router.put('/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const existing = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.deleted_at) return res.status(409).json({ error: 'event is deleted — restore first' });
    if (existing.source !== 'manual') {
      // Panoptica-originated events are immutable from the operator UI —
      // they represent what the app actually did. Edit them only by rerunning
      // the original action through Panoptica.
      return res.status(403).json({ error: 'panoptica-sourced events are immutable' });
    }
    // Audit-journal lockdown — past the edit window the event is immutable.
    // See EDIT_WINDOW_MINUTES comment at top of file for rationale.
    const lock = computeLockState(existing);
    if (lock.locked) {
      return res.status(403).json({
        error: `Event locked — the ${EDIT_WINDOW_MINUTES}-minute edit window has expired. Log a new event to correct or add context (reference this event's correlation tag in the description).`,
        code: 'EDIT_WINDOW_EXPIRED',
      });
    }

    const { errors, fields } = validateBody(req.body, { requireAll: false });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'no fields to update' });

    const userEmail = req.session?.user?.email || null;
    await snapshot(id, userEmail, 'update');

    // Build UPDATE SQL
    const sets = [];
    const params = [];
    if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category); }
    if (fields.affected_surface !== undefined) {
      sets.push('affected_surface = CAST(? AS JSON)');
      params.push(JSON.stringify(fields.affected_surface));
    }
    if (fields.started_at !== undefined) { sets.push('started_at = ?'); params.push(fields.started_at); }
    if (fields.ended_at !== undefined) { sets.push('ended_at = ?'); params.push(fields.ended_at); }
    if (fields.impact !== undefined) { sets.push('impact = ?'); params.push(fields.impact); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    params.push(id);

    await db.execute(
      `UPDATE tenant_change_events SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    const row = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    console.log(`[API] Change event ${id} updated by ${userEmail}`);
    res.json({ event: normalizeEventRow(row, resolveLang(req)) });
  } catch (e) {
    console.error('[API] change-events PUT error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── DELETE /:id — soft delete ───────────────────────────────────────
// A3 (May 9, 2026): admin-only — deleting audit-trail rows is sensitive.
router.delete('/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const existing = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.source !== 'manual') {
      return res.status(403).json({ error: 'panoptica-sourced events cannot be deleted' });
    }
    if (existing.deleted_at) return res.status(409).json({ error: 'already deleted' });
    // Audit-journal lockdown — past the edit window the event is immutable.
    const lock = computeLockState(existing);
    if (lock.locked) {
      return res.status(403).json({
        error: `Event locked — the ${EDIT_WINDOW_MINUTES}-minute deletion window has expired. The audit journal preserves historical entries; log a retraction event if the record needs correction.`,
        code: 'EDIT_WINDOW_EXPIRED',
      });
    }

    const userEmail = req.session?.user?.email || null;
    await snapshot(id, userEmail, 'delete');
    await db.execute(
      'UPDATE tenant_change_events SET deleted_at = NOW() WHERE id = ?',
      [id]
    );
    console.log(`[API] Change event ${id} soft-deleted by ${userEmail}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[API] change-events DELETE error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /:id/restore — undelete ────────────────────────────────────
// A3 (May 9, 2026): admin-only — same trust class as delete.
router.post('/:id/restore', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const existing = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (!existing.deleted_at) return res.status(409).json({ error: 'not deleted' });
    // Audit-journal lockdown — restore is a mutation. Allowed only within the
    // same post-creation window. Past the window, a soft-delete is final; use
    // a new event to re-state the record if needed.
    const lock = computeLockState(existing);
    if (lock.locked) {
      return res.status(403).json({
        error: `Event locked — the ${EDIT_WINDOW_MINUTES}-minute mutation window has expired. Soft-deletes are final past this window.`,
        code: 'EDIT_WINDOW_EXPIRED',
      });
    }

    const userEmail = req.session?.user?.email || null;
    await snapshot(id, userEmail, 'restore');
    await db.execute(
      'UPDATE tenant_change_events SET deleted_at = NULL WHERE id = ?',
      [id]
    );
    const row = await db.queryOne(
      'SELECT * FROM tenant_change_events WHERE id = ? LIMIT 1',
      [id]
    );
    console.log(`[API] Change event ${id} restored by ${userEmail}`);
    res.json({ event: normalizeEventRow(row, resolveLang(req)) });
  } catch (e) {
    console.error('[API] change-events restore error:', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
