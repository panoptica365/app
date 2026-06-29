/**
 * Panoptica365 — Adopt-in-Place API (Tenant-Sourced CA & Intune)
 *
 *   GET    /api/adopt/:tenantId/state            per-surface import state + Security Defaults (all roles)
 *   GET    /api/adopt/:tenantId/cards?surface=   tenant-sourced cards for a surface (all roles)
 *   POST   /api/adopt/:tenantId/import           import existing settings of one surface (Member+)
 *   POST   /api/adopt/card/:cardId/stop-monitoring   Panoptica-only, no tenant write (Member+)
 *   POST   /api/adopt/card/:cardId/deactivate    reversible tenant write (Member+)
 *   POST   /api/adopt/card/:cardId/restore       replay deactivation snapshot (Member+)
 *   POST   /api/adopt/card/:cardId/delete        destructive tenant write (Member+)
 *   POST   /api/adopt/card/:cardId/accept-baseline  re-baseline to live, clear drift; NO tenant write (Member+)
 *
 * Governing rules (spec §2.1, §2.10–2.12, §9):
 *   - Posture: every tenant write is operator-initiated + confirmed; never automatic.
 *   - RBAC: import / stop / deactivate / restore / delete are Member+ (Operators AND
 *     Admins, per Jacques). Viewers are read-only. Enforced server-side here AND on
 *     the controls (data-role-required="member").
 *   - Confirmation friction scales with blast radius: Delete requires the operator to
 *     type their OWN name (validated server-side against the session) + a checkbox.
 *   - Every write is audited (MSP audit row + tenant Change Log) inside adopt-service.
 *   - Microsoft-managed CA policies that reject a write degrade gracefully (§2.6).
 */

'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const store = require('../lib/adopt-store');
const service = require('../lib/adopt-service');
const adoptGraph = require('../lib/adopt-graph');

router.use(auth.requireAuth);

function operatorOf(req) {
  const u = (req.session && req.session.user) || {};
  return u.name || u.email || null;
}

/** Normalize a name for the delete-friction comparison (case/space-insensitive). */
function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Load a card + its tenant, or send a 404. Returns { card, tenant } or null. */
async function loadCardAndTenant(req, res) {
  const card = await store.getObjectById(Number(req.params.cardId));
  if (!card) { res.status(404).json({ error: 'not_found' }); return null; }
  const tenant = await service.loadTenant(card.tenant_id);
  if (!tenant) { res.status(404).json({ error: 'tenant_not_found' }); return null; }
  return { card, tenant };
}

// ─── Reads ───────────────────────────────────────────────────────────

/** Per-surface import state (drives the "Import existing settings" button) + Security Defaults status. */
router.get('/:tenantId/state', async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const tenant = await service.loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    const state = await service.getImportState(tenantId);
    // Security Defaults on/off — status indicator only, never carded (§2.6).
    let securityDefaults = null;
    try {
      const sd = await adoptGraph.readSecurityDefaults(tenant.tenant_id);
      securityDefaults = sd.ok ? { enabled: sd.isEnabled } : { unavailable: true };
    } catch (_e) { securityDefaults = { unavailable: true }; }

    res.json({ ok: true, surfaces: state, security_defaults: securityDefaults });
  } catch (e) {
    console.error('[Adopt] state error:', e.message);
    res.status(500).json({ error: 'state_failed' });
  }
});

/** Tenant-sourced cards for one surface. Baseline JSON is omitted from the list payload. */
router.get('/:tenantId/cards', async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const surface = req.query.surface === 'intune' ? 'intune' : 'ca';
    const cards = (await store.getObjects(tenantId, surface)).map(c => ({
      id: c.id,
      surface: c.surface,
      policy_type: c.policy_type,
      source_object_id: c.source_object_id,
      display_name: c.display_name,
      origin: c.origin,
      lifecycle_state: c.lifecycle_state,
      ms_managed: !!c.ms_managed,
      drift_status: c.drift_status,
      drift_details: c.drift_details,
      monitor_on_deactivate: !!c.monitor_on_deactivate,
      last_checked_at: c.last_checked_at,
      imported_at: c.imported_at,
    }));
    res.json({ ok: true, surface, cards });
  } catch (e) {
    console.error('[Adopt] cards error:', e.message);
    res.status(500).json({ error: 'cards_failed' });
  }
});

// ─── Import (Member+) ────────────────────────────────────────────────

router.post('/:tenantId/import', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const surface = req.body && req.body.surface === 'intune' ? 'intune' : 'ca';
    const tenant = await service.loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    const result = await service.importSurface(tenant, surface, { req, operator: operatorOf(req) });
    // status: 'success' | 'empty' | 'unlicensed' | 'transient'
    // 'success'/'empty' → caller hides the button; 'unlicensed'/'transient' → keep it.
    res.json({ ok: result.status === 'success' || result.status === 'empty', surface, ...result });
  } catch (e) {
    console.error('[Adopt] import error:', e.message);
    res.status(500).json({ ok: false, status: 'transient', error: 'import_failed' });
  }
});

// ─── Lifecycle actions (Member+) ─────────────────────────────────────

/** (1) Stop monitoring — Panoptica-only, NO tenant write. Lightest friction. */
router.post('/card/:cardId/stop-monitoring', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadCardAndTenant(req, res);
    if (!ctx) return;
    await service.stopMonitoring(ctx.tenant, ctx.card, { req, operator: operatorOf(req) });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Adopt] stop-monitoring error:', e.message);
    res.status(500).json({ error: 'stop_failed' });
  }
});

/** (2) Deactivate — reversible tenant write. Medium friction: acknowledge required. */
router.post('/card/:cardId/deactivate', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadCardAndTenant(req, res);
    if (!ctx) return;
    if (!req.body || req.body.acknowledge !== true) {
      return res.status(400).json({ error: 'acknowledge_required' });
    }
    const monitor = !!(req.body && req.body.monitor);
    // managed_by_microsoft is an EXPECTED outcome (§2.6), not a transport error —
    // return 200 with {ok:false,reason} so the UI shows the specific message
    // (Panoptica.api throws on non-2xx and would mask it as a generic failure).
    const result = await service.deactivate(ctx.tenant, ctx.card, { monitor, req, operator: operatorOf(req) });
    res.json(result);
  } catch (e) {
    console.error('[Adopt] deactivate error:', e.message);
    res.status(500).json({ error: 'deactivate_failed' });
  }
});

/** (2b) Restore a deactivated card — replays the snapshot. */
router.post('/card/:cardId/restore', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadCardAndTenant(req, res);
    if (!ctx) return;
    if (ctx.card.lifecycle_state !== 'deactivated') {
      return res.status(400).json({ error: 'not_deactivated' });
    }
    // managed_by_microsoft → 200 {ok:false,reason} (expected outcome, §2.6).
    const result = await service.restore(ctx.tenant, ctx.card, { req, operator: operatorOf(req) });
    res.json(result);
  } catch (e) {
    console.error('[Adopt] restore error:', e.message);
    res.status(500).json({ error: 'restore_failed' });
  }
});

/**
 * (3) Delete — destructive tenant write. Heaviest friction (§2.10):
 *   - acknowledge checkbox === true
 *   - typed_name must match the logged-in operator's OWN name or UPN (server-validated)
 */
router.post('/card/:cardId/delete', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadCardAndTenant(req, res);
    if (!ctx) return;
    const body = req.body || {};
    // Expected validation/business outcomes return 200 {ok:false,...} so the UI
    // reads the specific reason (Panoptica.api throws on non-2xx, masking it).
    if (body.acknowledge !== true) {
      return res.json({ ok: false, error: 'acknowledge_required' });
    }
    // Heaviest friction (§2.10): typed name must match the logged-in operator's
    // OWN name or UPN, validated server-side against the session.
    const u = (req.session && req.session.user) || {};
    const typed = normName(body.typed_name);
    const matches = typed && (typed === normName(u.name) || typed === normName(u.email));
    if (!matches) {
      return res.json({ ok: false, error: 'name_mismatch' });
    }
    // deleteFromTenant returns {ok:true} | {ok:false, reason:'managed_by_microsoft'|'graph_error', message}.
    const result = await service.deleteFromTenant(ctx.tenant, ctx.card, { req, operator: operatorOf(req) });
    res.json(result);
  } catch (e) {
    console.error('[Adopt] delete error:', e.message);
    res.status(500).json({ error: 'delete_failed' });
  }
});

/**
 * (4) Accept current live state as the new baseline — Panoptica-only (NO tenant
 * write). Re-baselines a drifted adopted card to the current live config and
 * clears the drift. Returns 200 {ok:false, reason:'not_found'} if the policy was
 * removed from the tenant (Panoptica.api throws on non-2xx, masking the reason).
 */
router.post('/card/:cardId/accept-baseline', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadCardAndTenant(req, res);
    if (!ctx) return;
    const result = await service.acceptBaseline(ctx.tenant, ctx.card, { req, operator: operatorOf(req) });
    res.json(result);
  } catch (e) {
    console.error('[Adopt] accept-baseline error:', e.message);
    res.status(500).json({ error: 'accept_baseline_failed' });
  }
});

module.exports = router;
