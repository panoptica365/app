/**
 * Panoptica365 — Feature 8.7: Identity Threat Correlation (ITDR) API
 *
 *   GET  /api/identity-timeline?tenantId=&upn=&anchorAlertId=&window=24h|7d&lang=
 *        → { window:{start,end}, events:[...], analysis:{...}|null, can_generate }
 *        Builds the merged read-only timeline live. Serves a cached Haiku story
 *        when its fingerprint matches; otherwise generates inline for Member+,
 *        or returns the timeline with analysis:null (Viewers, uncached).
 *
 *   POST /api/identity-timeline/analyze   (Member+)
 *        → forces (re)generation, upserts the cache, writes an audit row.
 *
 * Read-only: no route here mutates a tenant. The app gates /api behind auth
 * (matching sibling route mounts); the analyze route additionally requires
 * Member+.
 */

'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db/database');
const auth = require('../auth');
const mspAudit = require('../msp-audit');
const itl = require('../lib/identity-timeline');

const LANGS = new Set(['en', 'fr', 'es']);
const WINDOWS = new Set(['24h', '7d']);

function resolveLang(q) {
  const l = String(q || '').toLowerCase();
  return LANGS.has(l) ? l : 'en';
}

/**
 * Parse + validate the shared request context. Confirms the anchor alert
 * exists and belongs to the named tenant (tenant scoping). Returns the context
 * object, or sends an error response and returns null.
 */
async function loadContext(req, res) {
  const body = req.body || {};
  const tenantId = parseInt(req.query.tenantId || body.tenantId, 10);
  const anchorAlertId = parseInt(req.query.anchorAlertId || body.anchorAlertId, 10);
  const upn = itl.normUpn(req.query.upn || body.upn);
  const rawWindow = req.query.window || body.window;
  const windowKey = WINDOWS.has(rawWindow) ? rawWindow : '24h';
  const lang = resolveLang(req.query.lang || body.lang);

  if (!tenantId || !anchorAlertId || !upn) {
    res.status(400).json({ error: 'tenantId, anchorAlertId and upn are required' });
    return null;
  }

  const anchor = await db.queryOne(
    `SELECT a.tenant_id, a.triggered_at, t.tenant_id AS tenant_guid
       FROM alerts a JOIN tenants t ON a.tenant_id = t.id
      WHERE a.id = ?`,
    [anchorAlertId]
  );
  if (!anchor || Number(anchor.tenant_id) !== tenantId) {
    res.status(404).json({ error: 'Anchor alert not found for this tenant' });
    return null;
  }

  const win = itl.resolveWindow(anchor.triggered_at, windowKey);
  return { tenantId, upn, anchorAlertId, windowKey, lang, win, tenantGuid: anchor.tenant_guid };
}

/**
 * Build console deep-links that actually land somewhere. The tenant GUID in the
 * path scopes the Entra portal to the right directory; when we resolved the
 * user's object id from the audit log we deep-link straight to their profile,
 * otherwise we land on the tenant's Users list (the operator searches the UPN).
 * Navigation only — read-only.
 */
function buildEntraLinks(tenantGuid, objectId) {
  const tid = tenantGuid ? `${tenantGuid}/` : '';
  const base = `https://entra.microsoft.com/${tid}#view/`;
  const user = objectId
    ? base + 'Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/' + encodeURIComponent(objectId)
    : base + 'Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers';
  return { entra_user: user };
}

// --- GET: timeline (+ cached or inline-generated story) ---------------------
router.get('/', async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return;

    const { tenantId, upn, anchorAlertId, lang, win, tenantGuid } = ctx;
    const { events, objectId } = await itl.buildTimeline(tenantId, upn, win, anchorAlertId);
    const fingerprint = itl.computeEventFingerprint(events);

    const role = (req.session && req.session.user && req.session.user.role) || 'viewer';
    const canGenerate = role === 'admin' || role === 'member';

    const cached = await itl.getCachedAnalysis(tenantId, anchorAlertId, upn);
    let analysis = null;

    if (cached && cached.event_fingerprint === fingerprint) {
      // Fresh cache hit — never re-bills.
      analysis = itl.shapeCachedAnalysis(cached, lang);
    } else if (canGenerate) {
      // Member+: generate inline (switch to kick-and-poll later if latency hurts).
      const gen = await itl.generateAnalysis(events);
      if (gen) {
        await itl.upsertAnalysis({
          tenantId, anchorAlertId, upn, win, fingerprint,
          classification: gen.classification, story: gen.story,
          generatedBy: (req.session && req.session.user && req.session.user.email) || null,
        });
        const row = await itl.getCachedAnalysis(tenantId, anchorAlertId, upn);
        analysis = itl.shapeCachedAnalysis(row, lang);
      } else if (cached) {
        // Generation unavailable (no API key / error) — serve stale story flagged.
        analysis = itl.shapeCachedAnalysis(cached, lang, { stale: true });
      }
    } else if (cached) {
      // Viewer: serve the stale cached story, flagged; never generate.
      analysis = itl.shapeCachedAnalysis(cached, lang, { stale: true });
    }

    res.json({
      window: { start: win.start.toISOString(), end: win.end.toISOString() },
      events,
      analysis,
      can_generate: canGenerate,
      links: buildEntraLinks(tenantGuid, objectId),
    });
  } catch (err) {
    console.error('[API identity-timeline] GET error:', err);
    res.status(500).json({ error: 'Failed to build identity timeline' });
  }
});

// --- POST /analyze: force (re)generation (Member+) --------------------------
router.post('/analyze', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return;

    const { tenantId, upn, anchorAlertId, lang, win, tenantGuid } = ctx;
    const { events, objectId } = await itl.buildTimeline(tenantId, upn, win, anchorAlertId);
    const fingerprint = itl.computeEventFingerprint(events);

    const gen = await itl.generateAnalysis(events);
    if (!gen) {
      return res.status(503).json({ error: 'AI analysis is unavailable' });
    }

    await itl.upsertAnalysis({
      tenantId, anchorAlertId, upn, win, fingerprint,
      classification: gen.classification, story: gen.story,
      generatedBy: (req.session && req.session.user && req.session.user.email) || null,
    });
    const row = await itl.getCachedAnalysis(tenantId, anchorAlertId, upn);
    const analysis = itl.shapeCachedAnalysis(row, lang);

    // Audit: a paid, operator-initiated action. No internal IDs in the human
    // description; the anchor alert id rides as metadata, not in the copy.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.OTHER,
      action: 'identity_timeline.analyze',
      description: `Generated an identity correlation analysis for ${upn}`,
      templateKey: 'identity_timeline.analyze',
      templateParams: { upn },
      targetType: 'tenant',
      targetId: String(tenantId),
      metadata: { anchor_alert_id: anchorAlertId, classification: gen.classification },
      req,
    }).catch((e) => console.warn('[API identity-timeline] audit log failed (non-blocking):', e.message));

    res.json({
      window: { start: win.start.toISOString(), end: win.end.toISOString() },
      events,
      analysis,
      links: buildEntraLinks(tenantGuid, objectId),
    });
  } catch (err) {
    console.error('[API identity-timeline] POST analyze error:', err);
    res.status(500).json({ error: 'Failed to generate identity correlation analysis' });
  }
});

module.exports = router;
