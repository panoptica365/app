/**
 * Panoptica365 — Process-level fatal handlers (Reliability P0, 2026-06-12).
 *
 * Before this module, the process had SIGINT/SIGTERM handlers but nothing for
 * `unhandledRejection` / `uncaughtException`. With ~12 background loops doing
 * fire-and-forget async work, one unhandled rejection in a rare path could
 * kill or corrupt the process with no log line explaining why — and on an
 * unattended MSP install, a poisoned input re-read every cycle becomes an
 * invisible crash-loop.
 *
 * Contract:
 *   - Log the full stack via console.error with a [FATAL] prefix. file-logger
 *     initializes before this module in server.js, so the line is mirrored
 *     into logs/app-YYYY-MM-DD.log as well as docker/pm2 output.
 *   - Increment a JSON crash counter at data/state/crash-counter.json
 *     ({ count, lastCrashAt, lastReason }) — synchronous best-effort write
 *     that never throws. The diagnostics bundle picks this file up.
 *   - Exit non-zero after a short flush delay. We do NOT limp on: an
 *     unknown-state process in an unattended install is worse than a clean
 *     restart (Docker restart policy / pm2 revives it).
 *
 * install() is called in server.js immediately after file-logger init and
 * BEFORE dotenv/config load, so even boot-path crashes are caught.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STATE_DIR = path.join(PROJECT_ROOT, 'data', 'state');
const CRASH_COUNTER_PATH = path.join(STATE_DIR, 'crash-counter.json');

// Give stdout/stderr (and the file-logger's append stream) a moment to flush
// before exiting. Both are usually synchronous for local files/pipes, but a
// fixed short delay is the cheap, dependable version.
const FLUSH_DELAY_MS = 250;

let installed = false;
let handling = false;

function bumpCrashCounter(reasonText) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    let current = { count: 0 };
    try {
      const parsed = JSON.parse(fs.readFileSync(CRASH_COUNTER_PATH, 'utf8'));
      if (parsed && typeof parsed.count === 'number') current = parsed;
    } catch (_) { /* missing or corrupt — start fresh */ }
    const next = {
      count: current.count + 1,
      lastCrashAt: new Date().toISOString(),
      lastReason: String(reasonText || 'unknown').slice(0, 2000),
    };
    fs.writeFileSync(CRASH_COUNTER_PATH, JSON.stringify(next, null, 2) + '\n');
  } catch (_) {
    // Best-effort only — a failed counter write must never mask the crash log.
  }
}

function describe(reason) {
  if (reason instanceof Error) return reason.stack || reason.message;
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch (_) {
    return String(reason);
  }
}

function handleFatal(kind, reason) {
  if (handling) {
    // A second fatal arrived during the flush delay — exit immediately rather
    // than rescheduling forever.
    try { console.error(`[FATAL] ${kind} during shutdown — exiting now`); } catch (_) { /* ignore */ }
    process.exit(1);
    return;
  }
  handling = true;
  const text = describe(reason);
  try {
    console.error(`[FATAL] ${kind}: ${text}`);
  } catch (_) { /* even logging must not block the exit path */ }
  bumpCrashCounter(`${kind}: ${text.split('\n')[0]}`);
  setTimeout(() => process.exit(1), FLUSH_DELAY_MS);
}

/**
 * Register the process-level handlers. Idempotent.
 */
function install() {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => handleFatal('unhandledRejection', reason));
  process.on('uncaughtException', (err) => handleFatal('uncaughtException', err));
}

module.exports = { install, CRASH_COUNTER_PATH };
