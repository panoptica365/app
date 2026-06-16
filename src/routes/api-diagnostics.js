/**
 * Panoptica365 — Diagnostics API (Part 3, 2026-06-03 build, §3.2).
 *
 * Admin-only. Lets an MSP capture a redacted support bundle (logs + config
 * summaries + DB health + docker logs) and download the zip to email us — the
 * only supported remote-debug flow now that pilots run on servers we have no
 * SSH access to.
 *
 *   POST /api/diagnostics/capture     → start a capture (single-flight, 409 if running)
 *   GET  /api/diagnostics/status      → { phase, step_summary, bundles: [...] }
 *   GET  /api/diagnostics/download/:id → stream the zip (audited — bundle leaves the box)
 */

const express = require('express');
const fs = require('fs');
const auth = require('../auth');
const mspAudit = require('../msp-audit');
const collector = require('../diagnostics-collector');

const router = express.Router();

// Strict id shape — guards the download path against traversal (§3.2).
const ID_RE = /^diag-[0-9TZ-]+$/;

// ─── Start a capture ───
router.post('/capture', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  const operator = req.session?.user?.email || req.session?.user?.name || 'unknown';
  try {
    const { capture_id } = collector.startCapture({ operator });

    try {
      await mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.MAINTENANCE,
        action: 'diagnostics.capture',
        description: `Started diagnostics capture ${capture_id}`,
        templateKey: 'diagnostics.captured',
        templateParams: { id: capture_id },
        targetType: 'diagnostics',
        targetId: capture_id,
        req,
      });
    } catch (_) { /* audit must never block */ }

    res.json({ ok: true, capture_id });
  } catch (e) {
    if (e.code === 'in_progress') {
      return res.status(409).json({ ok: false, error: 'capture_in_progress' });
    }
    console.error('[diagnostics] capture start failed:', e.message);
    res.status(500).json({ ok: false, error: 'capture_failed', detail: e.message });
  }
});

// ─── Status / progress + bundle list ───
router.get('/status', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const s = collector.getStatus();
  res.json({
    phase: s.phase,
    step: s.step,
    total: s.total,
    running: s.running,
    started_at: s.started_at,
    capture_id: s.capture_id,
    partial: s.partial,
    error: s.error,
    bundles: s.bundles,
  });
});

// ─── Download a bundle ───
router.get('/download/:id', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'bad_id' });
  }
  const file = collector.bundlePath(id);
  if (!file) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  // Audit BEFORE streaming — we want a record every time a bundle leaves the
  // box, even if the transfer is later interrupted (§3.2, category 'export').
  try {
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.EXPORT,
      action: 'diagnostics.download',
      description: `Downloaded diagnostics bundle ${id}`,
      templateKey: 'diagnostics.downloaded',
      templateParams: { id },
      targetType: 'diagnostics',
      targetId: id,
      req,
    });
  } catch (_) { /* audit must never block */ }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
  const stream = fs.createReadStream(file);
  stream.on('error', err => {
    console.error('[diagnostics] download stream error:', err.message);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
});

module.exports = router;
