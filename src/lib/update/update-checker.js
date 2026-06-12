/**
 * Panoptica — In-App Self-Update: manifest check service (Stage 5 / C2).
 *
 * Background module that learns "is a newer version available?" by polling a
 * small JSON manifest published through Cloudflare. It NEVER throws into the
 * request path and NEVER touches Docker — it only reads the manifest, compares
 * to the running version, and caches a small result object.
 *
 * Reliability contract (see build spec §2.11, §4, §5):
 *   - A missing / malformed / unreachable manifest is a NON-EVENT: log a
 *     warning, keep the last good result, show no banner, never crash.
 *   - All network work is bounded by a short timeout so a hung Cloudflare
 *     fetch can never stall the app.
 *   - The cached result is mirrored to a JSON sidecar under data/state/ (same
 *     pattern as the license cache) so it survives a restart.
 */

const fs = require('fs');
const path = require('path');
const versionInfo = require('../../version');
const workerHeartbeat = require('../../worker-heartbeat');

const MANIFEST_URL = process.env.UPDATE_MANIFEST_URL || 'https://updates.panoptica365.com/latest.json';
// Release channel (Reliability 1.7): 'stable' (default) follows manifest
// `latest`; 'early' additionally considers the optional `early` block when
// it is newer. Anything other than the literal 'early' means stable.
const CHANNEL = (process.env.UPDATE_CHANNEL || 'stable').toLowerCase() === 'early' ? 'early' : 'stable';
const CHECK_INTERVAL_MS = parseInt(process.env.UPDATE_CHECK_INTERVAL || '3600000', 10) || 3600000; // 1h
const FETCH_TIMEOUT_MS = parseInt(process.env.UPDATE_FETCH_TIMEOUT_MS || '8000', 10) || 8000;
const INITIAL_DELAY_MS = 15000; // let the app finish booting before the first check

const CACHE_PATH = path.join(__dirname, '..', '..', '..', 'data', 'state', 'update-check.json');

// Exact image tag the updater is allowed to pin: v<semver>. Anything else is rejected.
const IMAGE_TAG_RE = /^v\d+\.\d+\.\d+$/;

const RUNNING_VERSION = versionInfo.version;

let timer = null;

// Last known result. Defaults are the safe "no update known" state.
let cache = {
  checked_at: null,
  manifest_ok: false,
  update_available: false,
  running_version: RUNNING_VERSION,
  latest_version: null,
  latest_image_tag: null,
  released_at: null,
  mandatory: false,
  min_supported: null,
  below_min_supported: false,
  notes_summary: null,
  last_error: null,
};

function log(msg) { console.log(`[update-checker] ${msg}`); }
function warn(msg) { console.warn(`[update-checker] ${msg}`); }

/**
 * Semver compare on the leading X.Y.Z. Pre-release suffixes are ignored (we
 * only ship plain X.Y.Z tags). Returns -1 if a<b, 0 if equal, 1 if a>b.
 */
function compareSemver(a, b) {
  const parse = (v) => String(v || '').trim().replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function isPlainSemver(v) { return /^\d+\.\d+\.\d+$/.test(String(v || '').trim()); }

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      cache = { ...cache, ...parsed, running_version: RUNNING_VERSION };
      // Re-evaluate update_available against the CURRENT running version, in
      // case the app was just upgraded to/past the cached latest_version.
      if (cache.latest_version) {
        cache.update_available = computeAvailable(cache.latest_version, cache.latest_image_tag, cache.yanked);
      }
    }
  } catch (e) { /* no cache yet — fine */ }
}

function persistCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (e) {
    warn(`could not persist cache: ${e.message}`);
  }
}

function computeAvailable(latestVersion, imageTag, yanked) {
  if (!latestVersion || !isPlainSemver(latestVersion)) return false;
  if (!imageTag || !IMAGE_TAG_RE.test(imageTag)) return false;
  if (Array.isArray(yanked) && yanked.includes(latestVersion)) return false;
  return compareSemver(latestVersion, RUNNING_VERSION) > 0;
}

async function fetchManifest() {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MANIFEST_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': `Panoptica365/${RUNNING_VERSION}` },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, manifest: json };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(to);
  }
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') return null;
  const latest = m.latest;
  if (!latest || typeof latest !== 'object') return null;
  if (!isPlainSemver(latest.version)) return null;
  if (!latest.image_tag || !IMAGE_TAG_RE.test(latest.image_tag)) return null;
  return m;
}

/** Run one check. Never throws. Returns the (possibly unchanged) cache. */
async function check() {
  // Liveness stamp (Reliability P0, 2026-06-12). Success means "the checker
  // loop ran", NOT "the manifest was reachable" — manifest_ok already carries
  // that and an unreachable CDN must not page as a dead worker.
  const hbStart = Date.now();
  workerHeartbeat.stampStart('update_checker');
  try {
    const out = await checkInner();
    workerHeartbeat.stampSuccess('update_checker', Date.now() - hbStart);
    return out;
  } catch (e) {
    workerHeartbeat.stampError('update_checker', e.message);
    throw e;
  }
}

async function checkInner() {
  const result = await fetchManifest();
  if (!result.ok) {
    warn(`manifest fetch failed (${result.error}) — keeping last good result, no banner change`);
    cache = { ...cache, manifest_ok: false, last_error: result.error, checked_at: new Date().toISOString() };
    persistCache();
    return cache;
  }

  const m = validateManifest(result.manifest);
  if (!m) {
    warn('manifest malformed — keeping last good result, no banner change');
    cache = { ...cache, manifest_ok: false, last_error: 'malformed', checked_at: new Date().toISOString() };
    persistCache();
    return cache;
  }

  // Release channels (Reliability 1.7, 2026-06-12). `latest` is the STABLE
  // channel and remains the validated baseline every install understands.
  // Installs with UPDATE_CHANNEL=early additionally consider the manifest's
  // optional `early` block — used only when present, well-formed, and NEWER
  // than stable (a stale early entry falls back to stable automatically, so
  // an early-channel install can never be "held back" on an old early build).
  // Lets the vendor's own instance + a friendly pilot absorb a release for a
  // few days before the fleet's stable channel sees it.
  let entry = m.latest;
  let channel = 'stable';
  if (CHANNEL === 'early') {
    const e = m.early;
    if (e && isPlainSemver(e.version) && e.image_tag && IMAGE_TAG_RE.test(e.image_tag)
        && compareSemver(e.version, m.latest.version) > 0) {
      entry = e;
      channel = 'early';
    }
  }

  const yanked = Array.isArray(m.yanked) ? m.yanked : [];
  const available = computeAvailable(entry.version, entry.image_tag, yanked);
  const belowMin = entry.min_supported && isPlainSemver(entry.min_supported)
    ? compareSemver(RUNNING_VERSION, entry.min_supported) < 0
    : false;

  cache = {
    checked_at: new Date().toISOString(),
    manifest_ok: true,
    update_available: available,
    running_version: RUNNING_VERSION,
    channel,
    configured_channel: CHANNEL,
    latest_version: entry.version,
    latest_image_tag: entry.image_tag,
    released_at: entry.released_at || null,
    mandatory: !!entry.mandatory,
    min_supported: entry.min_supported || null,
    below_min_supported: belowMin,
    notes_summary: entry.notes_summary || null,
    yanked,
    last_error: null,
  };
  persistCache();
  log(`checked: running ${RUNNING_VERSION}, ${channel} ${entry.version}, available=${available}`);
  return cache;
}

/** Public: force an immediate re-check (admin "Check again"). */
async function checkNow() {
  return check();
}

/** Public: the cached result for the read endpoints (never throws). */
function getStatus() {
  return { ...cache };
}

/** Public: start the periodic checker. Idempotent. */
function start() {
  loadCacheFromDisk();
  // First check shortly after boot, then on the interval.
  setTimeout(() => { check().catch((e) => warn(`unexpected: ${e.message}`)); }, INITIAL_DELAY_MS);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { check().catch((e) => warn(`unexpected: ${e.message}`)); }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref(); // never keep the process alive for this
  log(`started: manifest=${MANIFEST_URL}, interval=${Math.round(CHECK_INTERVAL_MS / 1000)}s`);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

// ─── Terminal-outcome reconciler ───
// The app process is replaced mid-update, so the updater (a dumb container that
// must NOT touch the DB) cannot write the success/rollback/failure audit event.
// Instead, when the app comes back up we read the updater's status file and
// audit the terminal outcome exactly once, keyed by request_id.
const STATUS_PATH = path.join(__dirname, "..", "..", "..", "data", "state", "update-status.json");
const AUDIT_MARKER_PATH = path.join(__dirname, "..", "..", "..", "data", "state", "update-audit-marker.json");

async function reconcileTerminalStatus() {
  let status;
  try { status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")); } catch (e) { return; }
  if (!status || !status.request_id) return;
  const result = status.result || status.phase;
  if (!["success", "rolled_back", "failed"].includes(result)) return; // not terminal yet

  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(AUDIT_MARKER_PATH, "utf8")); } catch (e) {}
  if (marker && marker.request_id === status.request_id) return; // already audited

  const mspAudit = require("../../msp-audit");
  const map = {
    success:     { action: "update.success",     templateKey: "update.succeeded",   success: true },
    rolled_back: { action: "update.rolled_back",  templateKey: "update.rolled_back", success: false },
    failed:      { action: "update.failed",       templateKey: "update.failed",      success: false },
  };
  const m = map[result];
  try {
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.MAINTENANCE,
      action: m.action,
      description: `Update ${result}: ${status.from_version || "?"} -> ${status.to_version || "?"}`,
      templateKey: m.templateKey,
      templateParams: { from: status.from_version || "?", to: status.to_version || "?" },
      success: m.success,
      errorMessage: status.error || null,
      targetType: "app_update",
      targetId: status.request_id,
      targetName: status.to_version || null,
      metadata: { phase: status.phase, message: status.message || null },
      actorEmail: status.requested_by || "system",
    });
  } catch (e) { warn(`could not audit terminal status: ${e.message}`); }

  try {
    fs.mkdirSync(path.dirname(AUDIT_MARKER_PATH), { recursive: true });
    fs.writeFileSync(AUDIT_MARKER_PATH, JSON.stringify({ request_id: status.request_id, audited_at: new Date().toISOString() }, null, 2));
  } catch (e) { warn(`could not write audit marker: ${e.message}`); }
}

module.exports = { start, stop, check, checkNow, getStatus, compareSemver, reconcileTerminalStatus };
