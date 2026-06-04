/**
 * Panoptica365 — File logger (Part 2, 2026-06-03 build).
 *
 * Mirrors everything written to process.stdout / process.stderr into rotating
 * daily files under `logs/` so the app's logs survive container recreation and
 * are capturable by the Diagnostics bundle (Part 3) WITHOUT needing the Docker
 * socket. On the pm2 dev VM `logs/` is just a plain directory; on Docker
 * installs it is the bind-mounted ./data/logs — works in both.
 *
 * Design constraints (per build spec §2.1):
 *   - Intercept the low-level stream writes (NOT console.*) so we also catch
 *     libraries, unhandled-rejection traces, and anything that bypasses console.
 *   - The original write happens FIRST and unconditionally, so `docker logs` /
 *     `pm2 logs` are completely unaffected. File output is strictly additive.
 *   - File appends must NEVER throw into the hot path. On repeated failures
 *     (e.g. disk full) we disable file output and emit ONE warning rather than
 *     spamming.
 *   - Daily files, UTC date. Per-file size cap with .N suffix so one runaway
 *     loop can't eat the disk. 7-day retention swept at boot + every 6h.
 *   - No new npm dependency — hand-rolled.
 *
 * This module is intentionally initialized FIRST in server.js, before any
 * other require that might log, so the very first boot lines land in the file.
 *
 * Explicitly OUT of scope (spec §2.2): migrating existing console.log sites or
 * introducing log levels.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const RETENTION_DAYS = 7;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file before rolling to .N
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_WRITE_FAILURES = 10; // after this many append failures, give up quietly

// ISO-8601 UTC, second precision, with the trailing Z — matches the prefix the
// updater.sh log() helper uses, so mixed logs read consistently.
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let state = {
  enabled: false,
  initialized: false,
  currentDate: null, // 'YYYY-MM-DD' (UTC) the open stream is for
  segment: 1, // size-cap segment number for the current date
  stream: null, // fs.WriteStream for the current file
  bytesWritten: 0, // bytes in the current segment (approx)
  writeFailures: 0,
  origStdout: null,
  origStderr: null,
};

function utcDateString(d) {
  // 'YYYY-MM-DD' in UTC.
  return d.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function segmentPath(dateStr, segment) {
  // Segment 1 → app-YYYY-MM-DD.log; segment 2 → app-YYYY-MM-DD.2.log, etc.
  const suffix = segment > 1 ? `.${segment}` : '';
  return path.join(LOG_DIR, `app-${dateStr}${suffix}.log`);
}

function closeStream() {
  if (state.stream) {
    try { state.stream.end(); } catch (_) { /* ignore */ }
    state.stream = null;
  }
}

// Open (or reopen) the write stream for the given UTC date, choosing the
// highest existing segment for that date and continuing it (so a same-day
// restart appends rather than truncating). Returns true on success.
function openForDate(dateStr) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {
    return false;
  }

  // Find the highest existing segment for this date and its current size.
  let segment = 1;
  let size = 0;
  // Walk segments upward until we find one that doesn't exist or isn't full.
  // Bounded loop — a pathological day with thousands of 50MB segments would
  // stop being useful long before this matters, but cap defensively.
  for (let s = 1; s < 10000; s++) {
    let st = null;
    try { st = fs.statSync(segmentPath(dateStr, s)); } catch (_) { st = null; }
    if (!st) { segment = s; size = 0; break; }
    if (st.size < MAX_FILE_BYTES) { segment = s; size = st.size; break; }
    // else: this segment is full, try the next one
    segment = s + 1; size = 0;
  }

  let stream;
  try {
    stream = fs.createWriteStream(segmentPath(dateStr, segment), { flags: 'a' });
    stream.on('error', () => { recordWriteFailure(); });
  } catch (_) {
    return false;
  }

  closeStream();
  state.stream = stream;
  state.currentDate = dateStr;
  state.segment = segment;
  state.bytesWritten = size;
  return true;
}

function recordWriteFailure() {
  state.writeFailures += 1;
  if (state.writeFailures >= MAX_WRITE_FAILURES && state.enabled) {
    state.enabled = false;
    closeStream();
    // One warning, via the ORIGINAL stdout so we don't recurse into ourselves.
    try {
      state.origStdout(`[file-logger] ${nowIso()} disabling file logging after ${state.writeFailures} write failures (disk full?)\n`);
    } catch (_) { /* nothing more we can do */ }
  }
}

// Roll to a fresh date and/or segment if needed before writing `len` bytes.
function ensureCurrentFile(len) {
  const today = utcDateString(new Date());
  if (today !== state.currentDate) {
    if (!openForDate(today)) { recordWriteFailure(); return false; }
    return true;
  }
  if (state.bytesWritten + len > MAX_FILE_BYTES) {
    // Roll to the next segment for the same date.
    state.segment += 1;
    let stream;
    try {
      stream = fs.createWriteStream(segmentPath(today, state.segment), { flags: 'a' });
      stream.on('error', () => { recordWriteFailure(); });
    } catch (_) {
      recordWriteFailure();
      return false;
    }
    closeStream();
    state.stream = stream;
    state.bytesWritten = 0;
  }
  return true;
}

// Build the file line(s) from a raw chunk: prefix each line with an ISO
// timestamp unless it already starts with one. Returns a string.
function withTimestamps(text) {
  // Most chunks are a single line ending in \n. Handle multi-line and partials.
  const ts = nowIso();
  // Split keeping it simple: prefix the chunk if it doesn't already start with
  // a timestamp. We don't re-split interior lines (cheap + good enough — the
  // common case is one console.log = one write = one line).
  if (ISO_PREFIX_RE.test(text)) return text;
  return `${ts} ${text}`;
}

function appendToFile(chunk) {
  if (!state.enabled || !state.stream) return;
  let text;
  try {
    text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  } catch (_) {
    return; // un-stringifiable chunk — skip file copy, original already went out
  }
  const line = withTimestamps(text);
  const len = Buffer.byteLength(line);
  if (!ensureCurrentFile(len)) return;
  try {
    state.stream.write(line);
    state.bytesWritten += len;
  } catch (_) {
    recordWriteFailure();
  }
}

function sweepOldFiles() {
  let entries;
  try {
    entries = fs.readdirSync(LOG_DIR);
  } catch (_) {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  // Filenames are app-YYYY-MM-DD[.N].log — derive the date from the name so we
  // don't depend on mtime (which container copies can rewrite).
  const dateRe = /^app-(\d{4})-(\d{2})-(\d{2})(?:\.\d+)?\.log$/;
  for (const name of entries) {
    const m = dateRe.exec(name);
    if (!m) continue;
    const fileDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (fileDay < cutoff) {
      try { fs.unlinkSync(path.join(LOG_DIR, name)); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Initialize file logging. Idempotent — a second call is a no-op. Safe to call
 * even if the log directory can't be created (file output simply stays off and
 * the app runs exactly as before).
 */
function init() {
  if (state.initialized) return;
  state.initialized = true;

  state.origStdout = process.stdout.write.bind(process.stdout);
  state.origStderr = process.stderr.write.bind(process.stderr);

  const opened = openForDate(utcDateString(new Date()));
  if (!opened) {
    // Couldn't open a log file — leave stdout/stderr untouched, run as before.
    try {
      state.origStdout(`[file-logger] ${nowIso()} could not open ${LOG_DIR} — file logging disabled\n`);
    } catch (_) { /* ignore */ }
    return;
  }
  state.enabled = true;

  // Patch the stream writes. The original is called FIRST and its return value
  // is what we hand back to callers (preserving backpressure semantics); the
  // file append is best-effort and wrapped so it can never throw into the hot
  // path.
  process.stdout.write = function (chunk, encoding, cb) {
    const ret = state.origStdout(chunk, encoding, cb);
    try { appendToFile(chunk); } catch (_) { /* never throw */ }
    return ret;
  };
  process.stderr.write = function (chunk, encoding, cb) {
    const ret = state.origStderr(chunk, encoding, cb);
    try { appendToFile(chunk); } catch (_) { /* never throw */ }
    return ret;
  };

  // Retention sweep now + every 6h. unref() so the timer never holds the
  // process open during graceful shutdown.
  sweepOldFiles();
  const timer = setInterval(sweepOldFiles, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();

  // Announce via the (now patched) stdout so the line lands in the file too.
  process.stdout.write(`[file-logger] ${nowIso()} file logging active → ${LOG_DIR} (daily, ${RETENTION_DAYS}d retention, ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB cap)\n`);
}

module.exports = { init, LOG_DIR };
