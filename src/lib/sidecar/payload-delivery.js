/**
 * Panoptica365 — Sidecar payload delivery (Part 1, 2026-06-03 build, spec §1.3).
 *
 * At app startup the in-image signed payload (scripts/sidecar/) is dropped onto
 * the shared `./scripts/payload` bind mount (mounted here at /app/sidecar-payload)
 * so the socket-holding bootstrap wrapper can signature-verify it and adopt it.
 *
 * Rules:
 *   1. If the mount directory doesn't exist (pm2 dev VM, or a pre-upgrade
 *      install) → skip silently. Detected by EXISTENCE, never by env sniffing.
 *   2. Copy only when the in-image PAYLOAD_VERSION is strictly NEWER than what's
 *      already on the host. Never delete, never downgrade — a rollback to an
 *      older app image must not clobber a newer payload (forward-compatible by
 *      design, spec §1.7).
 *   3. Atomic per-file: write `*.tmp` then rename(). Order matters — payload
 *      first, .sig second, PAYLOAD_VERSION LAST (the version file is the commit
 *      marker the wrapper trusts).
 *
 * Fire-and-forget from server.js, wrapped in try/catch — payload delivery must
 * never block or crash boot.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// In-image source: <repo>/scripts/sidecar  (this file is src/lib/sidecar/).
const SRC_DIR = path.join(__dirname, '..', '..', '..', 'scripts', 'sidecar');
// Host destination via the bind mount declared in the installer's compose.
const DEST_DIR = process.env.SIDECAR_PAYLOAD_DIR || '/app/sidecar-payload';

const PAYLOAD = 'updater-payload.sh';
const SIG = 'updater-payload.sh.sig';
const VERSION = 'PAYLOAD_VERSION';

function readVersionInt(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0; // absent / unreadable → treat as version 0 so the image wins
  }
}

function copyAtomic(srcFile, destFile) {
  const tmp = destFile + '.tmp';
  fs.copyFileSync(srcFile, tmp);
  fs.renameSync(tmp, destFile);
}

/**
 * Drop the in-image payload onto the shared mount if newer. Returns a small
 * status object for logging/tests. Never throws.
 */
function deliverPayload() {
  try {
    // (1) mount present?
    let st;
    try { st = fs.statSync(DEST_DIR); } catch (_) { st = null; }
    if (!st || !st.isDirectory()) {
      return { delivered: false, reason: 'no-mount' };
    }

    // (2) version comparison
    const imageVersion = readVersionInt(path.join(SRC_DIR, VERSION));
    const hostVersion = readVersionInt(path.join(DEST_DIR, VERSION));

    if (imageVersion <= 0) {
      // No in-image payload (shouldn't happen in a real image) — nothing to do.
      return { delivered: false, reason: 'no-image-payload' };
    }
    if (hostVersion >= imageVersion) {
      return { delivered: false, reason: 'host-current', hostVersion, imageVersion };
    }

    // (3) copy payload → sig → version (version LAST, the commit marker).
    copyAtomic(path.join(SRC_DIR, PAYLOAD), path.join(DEST_DIR, PAYLOAD));
    copyAtomic(path.join(SRC_DIR, SIG), path.join(DEST_DIR, SIG));
    copyAtomic(path.join(SRC_DIR, VERSION), path.join(DEST_DIR, VERSION));

    console.log(`[sidecar-payload] delivered payload v${imageVersion} (host was v${hostVersion}) → ${DEST_DIR}`);
    return { delivered: true, hostVersion, imageVersion };
  } catch (e) {
    console.error('[sidecar-payload] delivery failed (non-fatal):', e.message);
    return { delivered: false, reason: 'error', error: e.message };
  }
}

module.exports = { deliverPayload, SRC_DIR, DEST_DIR };
