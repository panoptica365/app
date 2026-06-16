/**
 * Panoptica365 — Applications API (Feature 8.9)
 *
 * Backs the tenant-dashboard "Applications" tab: cache-first inventory read,
 * operator-triggered Refresh (live Graph + drift), and Save (bless checked
 * apps + Sonnet-triage the rest). Read-only toward the tenant — no
 * delete/revoke; cleanup is done by the operator in Entra (the UI deep-links
 * there). Mutations are Member+ and audited.
 */

'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const db = require('../db/database');
const store = require('../lib/known-good-store');
const evaluator = require('../lib/known-good-evaluator');
const worker = require('../known-good-worker');
const mspAudit = require('../msp-audit');
const changeLog = require('../change-log');

router.use(auth.requireAuth);

function loadTenant(tenantId) {
  return db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [tenantId]);
}

// ── GET /api/applications?tenant_id= — cache-first inventory + known-good state
router.get('/', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const inventory = await store.readInventory(tenantId);
    res.json({
      tenant: { id: tenant.id, tenant_id: tenant.tenant_id, display_name: tenant.display_name },
      inventory: inventory || null,
    });
  } catch (err) {
    console.error('[Applications] GET failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/applications/refresh?tenant_id= (Member+) — live Graph + drift diff
router.post('/refresh', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id || (req.body && req.body.tenant_id), 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const summary = await worker.refreshTenant(tenant, { fireAlerts: true });
    const inventory = await store.readInventory(tenantId);
    res.json({ ok: true, summary, inventory });
  } catch (err) {
    console.error('[Applications] refresh failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/applications/save (Member+) — bless checked + Sonnet-eval the rest
//    body: { tenant_id, blessed: [{ appId, kind }] }
router.post('/save', auth.requireMemberOrAdmin, async (req, res) => {
  // SSE-streamed. The bless writes are fast, but the Sonnet triage of un-blessed
  // apps is one batched Claude call that can run well past the reverse proxy's
  // read timeout on a tenant with many apps — a plain POST would 504 mid-call.
  // Streaming with a heartbeat keeps the connection alive (same pattern as the
  // report generators), so Save never times out regardless of the proxy config.
  // The done event carries only the counts; the client re-reads the inventory
  // cache-first (GET /api/applications) for the fresh bless flags + dots.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const sendEvent = (d) => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch { /* socket gone */ } };
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* socket gone */ }
  }, 10000);
  req.on('close', () => clearInterval(heartbeat));
  const finish = () => { clearInterval(heartbeat); res.end(); };

  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    if (!tenantId) { sendEvent({ error: 'tenant_id required' }); return finish(); }
    const tenant = await loadTenant(tenantId);
    if (!tenant) { sendEvent({ error: 'tenant not found' }); return finish(); }

    // Baseline = what the operator REVIEWED = the last Refresh's cached data.
    // Never re-fetch here (spec §8.1).
    const inv = await store.readInventory(tenantId);
    if (!inv || !Array.isArray(inv.apps)) {
      sendEvent({ error: 'no inventory — run Refresh first' });
      return finish();
    }
    const byKey = new Map(inv.apps.map(a => [`${a.kind}:${a.appId}`, a]));
    const blessedReq = Array.isArray(body.blessed) ? body.blessed : [];
    const operator = (req.session && req.session.user && req.session.user.email) || null;

    // 1-3. Bless each checked app, auto-resolve its open consent alerts, audit.
    sendEvent({ stage: 'blessing' });
    const blessedKeys = new Set();
    for (const sel of blessedReq) {
      const kind = sel.kind === 'registration' ? 'registration' : 'enterprise';
      const key = `${kind}:${sel.appId}`;
      const app = byKey.get(key);
      if (!app) continue;
      await store.bless(tenantId, app, { approvedBy: operator });
      blessedKeys.add(key);
      app.blessed = true;
      app.drift_state = 'clean';
      await autoResolveConsentAlerts(tenantId, sel.appId);
      await auditAction(req, tenant, app, operator, 'bless');
    }

    // 4. Sonnet-triage unblessed apps that still have no dot. Cold-start sends
    //    the whole set; later Saves send only the few still un-triaged.
    const toEvaluate = inv.apps.filter(a =>
      !blessedKeys.has(`${a.kind}:${a.appId}`) && !a.blessed && !(a.sonnet && a.sonnet.verdict)
    );
    let evaluated = 0;
    if (toEvaluate.length) {
      sendEvent({ stage: 'evaluating' });
      const verdicts = await evaluator.evaluateApps(toEvaluate);
      const now = store.toMysqlDatetime(new Date());
      for (const a of inv.apps) {
        const v = verdicts.get(String(a.appId));
        if (!v) continue;
        a.sonnet = { verdict: v.verdict, reasons: v.reasons, evaluated_at: now };
        evaluated += 1;
        if (blessedKeys.has(`${a.kind}:${a.appId}`)) {
          await store.recordVerdict(tenantId, a.appId, a.kind, v.verdict, v.reasons);
        }
      }
    }

    // 5. Rewrite the inventory cache with updated bless flags + dots.
    inv.generated_at = store.toMysqlDatetime(new Date());
    await store.writeInventory(tenantId, inv);

    sendEvent({ done: true, blessed: blessedKeys.size, evaluated, attempted: toEvaluate.length });
    finish();
  } catch (err) {
    console.error('[Applications] save failed:', err.message);
    sendEvent({ error: err.message });
    finish();
  }
});

// ── POST /api/applications/unbless (Member+) — body { tenant_id, appId, kind }
router.post('/unbless', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    if (!tenantId || !body.appId) return res.status(400).json({ error: 'tenant_id and appId required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const kind = body.kind === 'registration' ? 'registration' : 'enterprise';

    await store.unbless(tenantId, body.appId, kind);
    const inv = await store.readInventory(tenantId);
    if (inv && Array.isArray(inv.apps)) {
      const a = inv.apps.find(x => x.appId === body.appId && x.kind === kind);
      if (a) { a.blessed = false; a.drift_state = null; }
      await store.writeInventory(tenantId, inv);
    }
    const operator = (req.session && req.session.user && req.session.user.email) || null;
    await auditAction(req, tenant, { appId: body.appId, kind, displayName: body.displayName || body.appId }, operator, 'unbless');
    res.json({ ok: true });
  } catch (err) {
    console.error('[Applications] unbless failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── helpers ──────────────────────────────────────────────────────────

let _consentPolicyIds = null;
async function getConsentPolicyIds() {
  if (_consentPolicyIds) return _consentPolicyIds;
  const rows = await db.queryRows(
    "SELECT id FROM alert_policies WHERE name IN ('UAL: OAuth consent / app role grant', 'OAuth consent grant')"
  );
  _consentPolicyIds = rows.map(r => r.id);
  return _consentPolicyIds;
}

/** Auto-resolve open consent alerts for a blessed app (spec §10.2). */
async function autoResolveConsentAlerts(tenantId, appId) {
  try {
    const ids = await getConsentPolicyIds();
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(
      `UPDATE alerts
          SET status = 'resolved', resolution_reason = 'known_good_app', closed_at = NOW()
        WHERE tenant_id = ?
          AND status IN ('new','investigating')
          AND policy_id IN (${placeholders})
          AND JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$.appId')) = ?`,
      [tenantId, ...ids, String(appId)]
    );
  } catch (err) {
    console.warn(`[Applications] auto-resolve consent alerts failed (tenant ${tenantId}, app ${appId}): ${err.message}`);
  }
}

/** MSP audit + tenant change log for a bless / unbless. Both non-fatal. */
async function auditAction(req, tenant, app, operator, kind) {
  const verb = kind === 'unbless' ? 'Removed known-good baseline for' : 'Marked known-good:';
  const desc = `${verb} app "${app.displayName || app.appId}" on ${tenant.display_name}`;
  try {
    await mspAudit.logMspAudit({
      category: 'security',
      action: kind === 'unbless' ? 'known_good.unbless' : 'known_good.bless',
      description: desc,
      templateKey: kind === 'unbless' ? 'msp_audit.known_good_unbless' : 'msp_audit.known_good_bless',
      templateParams: { appName: app.displayName || app.appId, tenant: tenant.display_name },
      targetType: 'tenant', targetId: String(tenant.id), targetName: tenant.display_name,
      metadata: { appId: app.appId, appKind: app.kind },
      req,
    });
  } catch (e) { console.warn(`[Applications] msp audit (${kind}) failed:`, e.message); }
  try {
    await changeLog.logPanopticaChange({
      tenantId: tenant.id, category: 'other', surfaces: ['identity'],
      description: desc, createdBy: operator || 'panoptica-system',
    });
  } catch (e) { console.warn(`[Applications] change log (${kind}) failed:`, e.message); }
}

module.exports = router;
