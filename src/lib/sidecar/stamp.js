/**
 * Panoptica365 — Sidecar capability stamp reader (Part 1/3, 2026-06-03, §1.6).
 *
 * The bootstrap wrapper rewrites data/state/sidecar-versions.json every cycle
 * (~5s) with the verified payload version, its capabilities, and a refreshed
 * `payload_verified_at`. Any app code that wants the sidecar to do something
 * (write an update-request or diag-request) MUST consult this stamp first and
 * degrade gracefully if the sidecar is absent, stale, or lacks the capability.
 *
 * "Stale" = the stamp's payload_verified_at is older than STALE_SECONDS, which
 * means the wrapper isn't cycling → sidecar effectively down. On the pm2 dev VM
 * there is no sidecar at all, so the file is absent and present=false.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', '..', '..', 'data', 'state');
const STAMP_PATH = path.join(STATE_DIR, 'sidecar-versions.json');
const STALE_SECONDS = 60; // spec §1.6 — older than this → sidecar considered down

/**
 * @returns {{
 *   present: boolean,          // stamp file exists and parsed
 *   stale: boolean,            // present but payload_verified_at older than 60s
 *   ageSeconds: number|null,   // age of payload_verified_at
 *   bootstrap_version: number|null,
 *   payload_version: number|null,
 *   capabilities: string[],
 *   raw: object|null
 * }}
 */
function readStamp() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STAMP_PATH, 'utf8'));
  } catch (_) {
    return { present: false, stale: true, ageSeconds: null, bootstrap_version: null, payload_version: null, capabilities: [], raw: null };
  }

  const caps = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  let ageSeconds = null;
  let stale = true;
  if (raw.payload_verified_at) {
    const t = Date.parse(raw.payload_verified_at);
    if (Number.isFinite(t)) {
      ageSeconds = Math.max(0, Math.round((Date.now() - t) / 1000));
      stale = ageSeconds > STALE_SECONDS;
    }
  }

  return {
    present: true,
    stale,
    ageSeconds,
    bootstrap_version: typeof raw.bootstrap_version === 'number' ? raw.bootstrap_version : null,
    payload_version: typeof raw.payload_version === 'number' ? raw.payload_version : null,
    capabilities: caps,
    raw,
  };
}

/** True only if the sidecar is present, fresh, and advertises `capability`. */
function hasCapability(capability) {
  const s = readStamp();
  return s.present && !s.stale && s.capabilities.includes(capability);
}

module.exports = { readStamp, hasCapability, STALE_SECONDS, STAMP_PATH };
