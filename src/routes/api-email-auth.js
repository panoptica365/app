/**
 * Panoptica365 — Email Auth API (Feature A6)
 *
 * Backs the tenant-dashboard "Email Auth" tab: cache-first posture read,
 * operator-triggered Refresh (live public-DNS read + score + AI narrative +
 * snapshot + drift), and Acknowledge (accept a drift → set a new baseline).
 *
 * Read-only toward the customer: Panoptica never writes DNS. The operator fixes
 * records at their registrar; we detect, advise, and deep-link.
 *
 * RBAC: requireAuth to read; requireMemberOrAdmin to Refresh/Acknowledge.
 * Mode: Refresh works for any enabled tenant (managed + audit_only) — it is a
 * public-DNS read populating our store. Acknowledge is managed-only (audit_only
 * has no drift), enforced by requireManagedMiddleware.
 */

'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const db = require('../db/database');
const store = require('../lib/email-auth-store');
const worker = require('../email-auth-worker');
const tenantMode = require('../lib/tenant-mode');
const mspAudit = require('../msp-audit');
let psa = null;
try { psa = require('../psa'); } catch { /* PSA optional */ }

router.use(auth.requireAuth);

function loadTenant(tenantId) {
  return db.queryOne('SELECT id, tenant_id, display_name, psa_name FROM tenants WHERE id = ?', [tenantId]);
}

// ── GET /api/email-auth?tenant_id= — cache-first posture + open drift ──────────
router.get('/', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const [domains, drift] = await Promise.all([
      store.getPosture(tenantId),
      store.getOpenDrift(tenantId),
    ]);
    res.json({
      tenant: { id: tenant.id, tenant_id: tenant.tenant_id, display_name: tenant.display_name },
      domains,
      drift,
    });
  } catch (err) {
    console.error('[EmailAuth] GET failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/email-auth/refresh?tenant_id= (Member+) — live read + snapshot ───
//    SSE-streamed: a multi-domain Sonnet narrative pass can outlast the reverse
//    proxy's read timeout. Heartbeat keeps the socket alive; the done event
//    carries the summary and the client re-reads the cache-first GET.
router.post('/refresh', auth.requireMemberOrAdmin, async (req, res) => {
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
    const tenantId = parseInt(req.query.tenant_id || (req.body && req.body.tenant_id), 10);
    if (!tenantId) { sendEvent({ error: 'tenant_id required' }); return finish(); }
    const tenant = await loadTenant(tenantId);
    if (!tenant) { sendEvent({ error: 'tenant not found' }); return finish(); }

    sendEvent({ stage: 'enumerating' });
    const summary = await worker.refreshTenant(tenant, {
      fireAlerts: true,
      onProgress: (p) => sendEvent(p),
    });
    sendEvent({ done: true, summary });
    finish();
  } catch (err) {
    console.error('[EmailAuth] refresh failed:', err.message);
    sendEvent({ error: err.message });
    finish();
  }
});

// ── POST /api/email-auth/acknowledge (Member+, managed) ────────────────────────
//    body: { tenant_id, domain, drift_id, note }. "I made this change" → mark
//    acknowledged, resolve the linked alert, set the new baseline (the current
//    snapshot already is the baseline for future diffs).
router.post('/acknowledge',
  auth.requireMemberOrAdmin,
  tenantMode.requireManagedMiddleware('email-auth.acknowledge'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = parseInt(body.tenant_id, 10);
      const driftId = parseInt(body.drift_id, 10);
      if (!tenantId || !driftId) return res.status(400).json({ error: 'tenant_id and drift_id required' });
      const tenant = await loadTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: 'tenant not found' });

      const drift = await store.getDrift(driftId);
      if (!drift || drift.tenant_id !== tenantId) return res.status(404).json({ error: 'drift not found' });
      if (drift.status !== 'open') return res.status(409).json({ error: 'drift already acknowledged' });

      const operator = (req.session && req.session.user && req.session.user.email) || null;
      const note = body.note ? String(body.note).slice(0, 512) : null;

      await store.acknowledgeDrift(driftId, { acknowledgedBy: req.session && req.session.user && req.session.user.id || null, ackNote: note });

      // Resolve the linked alert with a reason stamp (exemption pattern) + close
      // any linked PSA ticket (v0.2.0 auto-close on drift-clear).
      if (drift.alert_id) {
        try {
          await db.execute(
            `UPDATE alerts
                SET status = 'resolved', resolution_reason = 'email_auth_acknowledged', closed_at = NOW(),
                    notes = CONCAT(COALESCE(notes, ''), '\n[', NOW(), '] Email-auth drift accepted by ', ?, COALESCE(CONCAT(': ', ?), ''))
              WHERE id = ? AND tenant_id = ? AND status IN ('new','investigating')`,
            [operator || 'operator', note, drift.alert_id, tenantId]
          );
          if (psa && typeof psa.closeTicketsForResolvedAlerts === 'function') {
            await psa.closeTicketsForResolvedAlerts([drift.alert_id], { reason: 'email_auth_acknowledged' }).catch(() => {});
          }
        } catch (e) {
          console.warn('[EmailAuth] linked-alert resolve failed (drift still acknowledged):', e.message);
        }
      }

      // Audit (acknowledge is an operator action on tenant posture).
      try {
        await mspAudit.logMspAudit({
          category: 'security',
          action: 'email_auth.acknowledge_drift',
          description: `Accepted email-auth drift on ${drift.domain} (${drift.mechanism} ${drift.change_type}) for ${tenant.display_name}`,
          templateKey: 'msp_audit.email_auth_acknowledge',
          templateParams: { domain: drift.domain, mechanism: drift.mechanism, changeType: drift.change_type, tenant: tenant.display_name },
          targetType: 'tenant', targetId: String(tenant.id), targetName: tenant.display_name,
          metadata: { driftId, alertId: drift.alert_id || null },
          req,
        });
      } catch (e) { console.warn('[EmailAuth] msp audit (acknowledge) failed:', e.message); }

      res.json({ ok: true, drift_id: driftId, status: 'acknowledged' });
    } catch (err) {
      console.error('[EmailAuth] acknowledge failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;
