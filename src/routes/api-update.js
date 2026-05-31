/**
 * Panoptica — In-App Self-Update API (Stage 5 / C2).
 *
 * Read surface (all operators) + admin trigger. This router NEVER touches
 * Docker. Triggering an update only writes a request file onto the shared
 * data/state bind mount; the separate panoptica-updater sidecar performs the
 * actual swap and writes back a status file that we read here (§7.2).
 *
 * Endpoints:
 *   GET  /api/update/status   (any authenticated role) — manifest-check result
 *                                                        + in-flight progress
 *   POST /api/update/check    (admin) — force an immediate manifest re-check
 *   POST /api/update/trigger  (admin) — request the updater apply the update
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('../auth');
const mspAudit = require('../msp-audit');
const updateChecker = require('../lib/update/update-checker');

const router = express.Router();

const STATE_DIR = path.join(__dirname, '..', '..', 'data', 'state');
const REQUEST_PATH = path.join(STATE_DIR, 'update-request.json');
const STATUS_PATH = path.join(STATE_DIR, 'update-status.json');

// Exact image tag the updater may pin (mirrors the updater's own validation).
const IMAGE_TAG_RE = /^v\d+\.\d+\.\d+$/;

// Phases that mean "an update is still in progress" — used for single-flight.
const NON_TERMINAL = new Set(['queued', 'snapshotting', 'pulling', 'restarting', 'health_check']);

function readStatusFile() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (e) {
    return null; // no update has ever run, or file mid-write — both fine
  }
}

function isInProgress(status) {
  return !!(status && status.phase && NON_TERMINAL.has(status.phase));
}

// ─── Read: status (all roles) ───
router.get('/status', auth.requireAuth, (req, res) => {
  const check = updateChecker.getStatus();
  const progress = readStatusFile();
  res.json({
    check,
    progress,
    in_progress: isInProgress(progress),
    is_admin: req.session?.user?.role === 'admin',
  });
});

// ─── Admin: force a manifest re-check ───
router.post('/check', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const check = await updateChecker.checkNow();
    res.json({ ok: true, check });
  } catch (e) {
    // checkNow never throws, but be defensive — a failed check is a non-event.
    res.json({ ok: true, check: updateChecker.getStatus() });
  }
});

// ─── Admin: trigger an update ───
router.post('/trigger', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  const check = updateChecker.getStatus();

  // 1) There must actually be a valid, available update to apply.
  if (!check.update_available || !check.latest_image_tag || !IMAGE_TAG_RE.test(check.latest_image_tag)) {
    return res.status(409).json({ ok: false, error: 'no_update_available' });
  }

  // 2) Single-flight: refuse if an update is already running.
  const existing = readStatusFile();
  if (isInProgress(existing)) {
    return res.status(409).json({ ok: false, error: 'update_in_progress', phase: existing.phase });
  }

  const requestId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const requestedBy = req.session?.user?.name || req.session?.user?.email || 'unknown';
  const request = {
    request_id: requestId,
    target_image_tag: check.latest_image_tag,
    target_version: check.latest_version,
    from_version: check.running_version,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // Write atomically so the updater never reads a half-written request.
    const tmp = REQUEST_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(request, null, 2));
    fs.renameSync(tmp, REQUEST_PATH);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'could_not_queue', detail: e.message });
  }

  // Audit the request (success/rollback/failure of the swap itself are audited
  // by a reconciler when the updater writes a terminal status — see server.js).
  try {
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.MAINTENANCE,
      action: 'update.request',
      description: `Requested update from ${check.running_version} to ${check.latest_version}`,
      templateKey: 'update.requested',
      templateParams: { from: check.running_version, to: check.latest_version },
      targetType: 'app_update',
      targetId: requestId,
      targetName: check.latest_version,
      metadata: { target_image_tag: check.latest_image_tag, mandatory: check.mandatory },
      req,
    });
  } catch (e) { /* audit must never block the operation */ }

  res.json({ ok: true, request_id: requestId, target_version: check.latest_version });
});

module.exports = router;
