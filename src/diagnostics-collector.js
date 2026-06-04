/**
 * Panoptica365 — Diagnostics collector (Part 3, 2026-06-03 build, §3.3/§3.4/§3.6).
 *
 * Assembles a support bundle into a temp working dir, runs the redactor over
 * every text file, then zips it to exports/diag-<TS>.zip. Safe to email: no
 * secrets, passwords, or credentials (tenant names ARE included by design).
 *
 * Robustness contract (§3.3): every collector step is independently try/caught.
 * A failing step writes `<step>.error.txt` INTO the bundle instead of aborting
 * the capture — a partial bundle is still useful (and is the scenario where we
 * most need one, e.g. DB unreachable). The temp dir is removed on success AND
 * failure. Retention: keep the 3 most recent zips.
 *
 * Single-flight: one capture at a time (module-level lock + in-memory job).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('./db/database');
const versionInfo = require('./version');
const redactor = require('./diagnostics-redactor');
const sidecarStamp = require('./lib/sidecar/stamp');

const ROOT = path.join(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'data', 'state');
const LOGS_DIR = path.join(ROOT, 'logs');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const SIDECAR_MOUNT = process.env.SIDECAR_PAYLOAD_DIR || '/app/sidecar-payload';

const APP_LOG_CAP_BYTES = 20 * 1024 * 1024; // last 20 MB of each app log (§3.3.5)
const DIAG_POLL_MS = 90 * 1000;             // wait up to 90s for the sidecar (§3.4)
const RETAIN_BUNDLES = 3;                    // keep the 3 most recent zips (§3.6)
const BUNDLE_RE = /^diag-[0-9TZ-]+\.zip$/;   // strict id/filename shape (§3.2)

// ─── In-memory job state (single-flight) ───
let job = null; // { capture_id, phase, step, total, started_at, finished, partial, error }

function isRunning() {
  return !!(job && !job.finished);
}

function setPhase(phase, step, total) {
  if (!job) return;
  job.phase = phase;
  if (typeof step === 'number') job.step = step;
  if (typeof total === 'number') job.total = total;
}

// ─── Helpers ───

function nowStampId() {
  // diag-YYYYMMDDTHHMMSSZ — matches BUNDLE_RE and is a safe slug for the
  // sidecar diag-request request_id (no path-traversal characters).
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `diag-${iso}`;
}

function isContainerEnv() {
  // Same heuristic as payload-delivery (§3.3.3): the bind mount only exists in
  // the Docker stack, never on the pm2 dev VM.
  try { return fs.statSync(SIDECAR_MOUNT).isDirectory(); } catch (_) { return false; }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function writeErrorFile(dir, step, err) {
  try {
    fs.writeFileSync(path.join(dir, `${step}.error.txt`), `${step} failed:\n${(err && err.stack) || err}\n`);
  } catch (_) { /* nothing more to do */ }
}

// Run one collector step under try/catch; on throw, write <step>.error.txt and
// record the gap in `skipped`. Returns true if the step succeeded.
async function step(dir, name, included, skipped, fn) {
  try {
    await fn();
    included.push(name);
    return true;
  } catch (e) {
    writeErrorFile(dir, name, e);
    skipped.push({ item: name, reason: e.message || String(e) });
    return false;
  }
}

// ─── DB sub-collectors (each independently resilient) ───

async function collectDb(dbDir, included, skipped) {
  fs.mkdirSync(dbDir, { recursive: true });

  // Each sub-file is independently try/caught so one missing table/column
  // doesn't lose the rest of the DB snapshot.
  const sub = async (file, fn) => {
    try {
      writeJson(path.join(dbDir, file), await fn());
      included.push(`db/${file}`);
    } catch (e) {
      writeErrorFile(dbDir, file.replace(/\.json$/, ''), e);
      skipped.push({ item: `db/${file}`, reason: e.message || String(e) });
    }
  };

  await sub('server-info.json', async () => {
    const vars = await db.queryRows(
      `SHOW VARIABLES WHERE Variable_name IN
       ('version','sql_mode','time_zone','max_connections','innodb_buffer_pool_size')`
    );
    const status = await db.queryRows(
      `SHOW GLOBAL STATUS WHERE Variable_name IN
       ('Uptime','Threads_connected','Aborted_connects','Slow_queries')`
    );
    const toObj = rows => Object.fromEntries(rows.map(r => [r.Variable_name, r.Value]));
    return { variables: toObj(vars), global_status: toObj(status) };
  });

  await sub('table-counts.json', async () => {
    // Estimate from information_schema — no full COUNT(*) on big tables (§3.3.6).
    const rows = await db.queryRows(
      `SELECT table_name, table_rows
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY table_name`
    );
    return rows.map(r => ({ table: r.table_name || r.TABLE_NAME, estimated_rows: r.table_rows ?? r.TABLE_ROWS }));
  });

  await sub('api-health.json', async () => {
    return await db.queryRows('SELECT * FROM api_health');
  });

  await sub('scheduler-runs.json', async () => {
    return await db.queryRows('SELECT * FROM drift_scheduler_runs ORDER BY id DESC LIMIT 50');
  });

  await sub('tenants.json', async () => {
    // SELECT * then project in JS so a runtime-added column (e.g. `mode`) that
    // may or may not exist never turns into a SQL error. Names INCLUDED by
    // design (§3.3.6 decision 2026-06-03).
    const rows = await db.queryRows('SELECT * FROM tenants ORDER BY id');
    return rows.map(r => ({
      id: r.id,
      tenant_guid: r.tenant_id,
      name: r.display_name,
      mode: r.mode ?? null,
      audit_only: r.mode ? (r.mode === 'audit_only') : null,
      polling_interval: r.polling_interval,
      last_polled_at: r.last_polled_at,
      poll_count: r.poll_count,
      enabled: r.enabled,
    }));
  });

  await sub('audit-events.json', async () => {
    return await db.queryRows('SELECT * FROM msp_audit_events ORDER BY id DESC LIMIT 200');
  });

  await sub('alerts-summary.json', async () => {
    const counts = await db.queryRows(
      `SELECT severity, status, COUNT(*) AS n
       FROM alerts
       WHERE triggered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY severity, status`
    );
    // Short message line only — never raw_data, operator notes, or ai_analysis_*
    // (§3.3.6). `alerts` has no title column; `message` is the condition summary.
    const recent = await db.queryRows(
      `SELECT tenant_id, LEFT(message, 200) AS message, severity, status, triggered_at
       FROM alerts
       ORDER BY triggered_at DESC
       LIMIT 20`
    );
    return { window_days: 7, counts_by_severity_status: counts, recent_alerts: recent };
  });

  await sub('ingestion.json', async () => {
    // Per-tenant latest timestamps. Each source is optional (the table may not
    // exist on every install) — probe independently.
    const probe = async (label, sql) => {
      try { return { [label]: await db.queryRows(sql) }; }
      catch (e) { return { [label]: { error: e.message } }; }
    };
    const ual = await probe('ual_events_latest',
      `SELECT tenant_id, MAX(creation_time) AS latest_event, MAX(ingested_at) AS latest_ingested
       FROM ual_events GROUP BY tenant_id`);
    const def = await probe('defender_incidents_latest',
      `SELECT tenant_id, MAX(last_updated_at_utc) AS latest_update, MAX(ingested_at) AS latest_ingested
       FROM defender_incidents GROUP BY tenant_id`);
    // morning_briefings is a single GLOBAL daily briefing — no tenant_id column.
    const brief = await probe('morning_briefings_latest',
      `SELECT MAX(generated_at) AS latest FROM morning_briefings`);
    return { ...ual, ...def, ...brief };
  });
}

// ─── App logs ───

function collectAppLogs(logsOutDir) {
  fs.mkdirSync(logsOutDir, { recursive: true });
  let names = [];
  try { names = fs.readdirSync(LOGS_DIR).filter(n => /^app-.*\.log$/.test(n)); } catch (_) { names = []; }
  if (!names.length) {
    fs.writeFileSync(path.join(logsOutDir, 'NO-APP-LOGS.txt'),
      'No app-*.log files found. File logging may have only just started, or this is a very fresh install.\n');
    return 0;
  }
  for (const name of names) {
    const src = path.join(LOGS_DIR, name);
    const dest = path.join(logsOutDir, name);
    try {
      const st = fs.statSync(src);
      if (st.size <= APP_LOG_CAP_BYTES) {
        fs.copyFileSync(src, dest);
      } else {
        // Keep the LAST 20 MB (most recent) of an oversized log.
        const fd = fs.openSync(src, 'r');
        try {
          const buf = Buffer.alloc(APP_LOG_CAP_BYTES);
          fs.readSync(fd, buf, 0, APP_LOG_CAP_BYTES, st.size - APP_LOG_CAP_BYTES);
          fs.writeFileSync(dest, `[...truncated to last ${Math.round(APP_LOG_CAP_BYTES / 1024 / 1024)} MB...]\n`);
          fs.appendFileSync(dest, buf);
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch (e) {
      try { fs.writeFileSync(dest + '.error.txt', `could not copy ${name}: ${e.message}\n`); } catch (_) {}
    }
  }
  return names.length;
}

// ─── Sidecar docker-logs via the diag verb (§3.4) ───

async function collectDockerLogs(dockerOutDir, captureId, operator, manifest) {
  const stamp = sidecarStamp.readStamp();

  if (!isContainerEnv()) {
    manifest.skipped.push({ item: 'docker-logs', reason: 'non-container environment (pm2) — no sidecar' });
    manifest.environment = 'non-container';
    return;
  }
  manifest.environment = 'container';

  if (!stamp.present || stamp.stale) {
    manifest.skipped.push({ item: 'docker-logs', reason: `sidecar down (stamp ${stamp.present ? 'stale' : 'absent'})` });
    return;
  }
  if (!stamp.capabilities.includes('diag')) {
    manifest.skipped.push({ item: 'docker-logs', reason: `sidecar payload v${stamp.payload_version} lacks diag capability — update the app to refresh it` });
    return;
  }

  // Write the request file. NOTHING here is interpolated into a docker command
  // by the payload — container names + window are hard-coded there (§3.4).
  const reqPath = path.join(STATE_DIR, 'diag-request.json');
  const diagDir = path.join(STATE_DIR, 'diag', captureId);
  const statusPath = path.join(diagDir, 'diag-status.json');
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = reqPath + '.tmp';
    writeJson(tmp, { request_id: captureId, requested_by: operator, requested_at: new Date().toISOString() });
    fs.renameSync(tmp, reqPath);
  } catch (e) {
    manifest.skipped.push({ item: 'docker-logs', reason: `could not write diag-request: ${e.message}` });
    return;
  }

  // Poll for the sidecar's status file (up to 90s).
  const deadline = Date.now() + DIAG_POLL_MS;
  let status = null;
  while (Date.now() < deadline) {
    try { status = JSON.parse(fs.readFileSync(statusPath, 'utf8')); break; } catch (_) { /* not ready */ }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (!status) {
    manifest.skipped.push({ item: 'docker-logs', reason: 'sidecar timed out (>90s) — proceeded without docker logs' });
    return;
  }

  // Copy the collected .log files into the bundle (redaction happens later over
  // the whole working dir, including these).
  fs.mkdirSync(dockerOutDir, { recursive: true });
  let copied = 0;
  try {
    for (const name of fs.readdirSync(diagDir)) {
      if (!name.endsWith('.log')) continue;
      fs.copyFileSync(path.join(diagDir, name), path.join(dockerOutDir, name));
      copied++;
    }
  } catch (e) {
    manifest.skipped.push({ item: 'docker-logs', reason: `could not copy sidecar logs: ${e.message}` });
  }
  manifest.included.push(`docker-logs/ (${copied} containers, sidecar result=${status.result})`);
  if (status.error) manifest.docker_logs_note = status.error;

  // The raw docker logs are unredacted on disk — delete the sidecar's scratch
  // dir now that we've copied them into the (about-to-be-redacted) bundle.
  try { fs.rmSync(diagDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

// ─── Disk + config + version + health ───

function collectDisk(file) {
  // statfsSync is available on Node 18.15+. Probe the volumes behind the dirs
  // we care about (§3.3.7) — disk-full is a top suspected failure mode.
  const targets = { logs: LOGS_DIR, exports: EXPORTS_DIR, state: STATE_DIR };
  const out = {};
  for (const [label, p] of Object.entries(targets)) {
    try {
      const s = fs.statfsSync(p);
      out[label] = {
        path: p,
        free_bytes: s.bavail * s.bsize,
        total_bytes: s.blocks * s.bsize,
      };
    } catch (e) {
      out[label] = { path: p, error: e.message };
    }
  }
  writeJson(file, out);
}

function collectConfigSummary(file) {
  // For SECRET keys → { set, length } only; everything else → actual value
  // (§3.3.8). Iterate the loaded environment.
  const secretSet = new Set(redactor.SECRET_KEYS);
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (secretSet.has(k)) {
      out[k] = { set: typeof v === 'string' && v.length > 0, length: typeof v === 'string' ? v.length : 0 };
    } else {
      out[k] = v;
    }
  }
  writeJson(file, out);
}

function collectVersion(file) {
  writeJson(file, {
    app_version: versionInfo.version,
    node_version: process.version,
    uptime_seconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    environment: isContainerEnv() ? 'container' : 'non-container',
  });
}

function collectUpdateHistory(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = ['update-status.json', 'update-request.json', 'sidecar-versions.json', 'payload-rejected'];
  let copied = 0;
  for (const name of files) {
    const src = path.join(STATE_DIR, name);
    try {
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(outDir, name)); copied++; }
    } catch (_) { /* skip individually */ }
  }
  if (copied === 0) {
    fs.writeFileSync(path.join(outDir, 'NO-UPDATE-HISTORY.txt'),
      'No update-history files present. Expected on a pm2 / non-container install (no self-update sidecar), or on a box that has never run a self-update.\n');
  }
}

// ─── Retention + listing ───

function listBundles() {
  let names = [];
  try { names = fs.readdirSync(EXPORTS_DIR).filter(n => BUNDLE_RE.test(n)); } catch (_) { return []; }
  const bundles = names.map(n => {
    let size = 0, mtime = null;
    try { const st = fs.statSync(path.join(EXPORTS_DIR, n)); size = st.size; mtime = st.mtime.toISOString(); } catch (_) {}
    return { id: n.replace(/\.zip$/, ''), created_at: mtime, size_bytes: size, complete: true };
  });
  // Newest first.
  bundles.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return bundles;
}

function pruneOldBundles() {
  const bundles = listBundles();
  for (const b of bundles.slice(RETAIN_BUNDLES)) {
    try { fs.unlinkSync(path.join(EXPORTS_DIR, b.id + '.zip')); } catch (_) {}
  }
}

function bundlePath(id) {
  // Caller validates the shape; double-check here and confine to EXPORTS_DIR.
  if (!/^diag-[0-9TZ-]+$/.test(id)) return null;
  const p = path.join(EXPORTS_DIR, id + '.zip');
  if (path.dirname(p) !== EXPORTS_DIR) return null; // belt-and-suspenders vs traversal
  return fs.existsSync(p) ? p : null;
}

// ─── Zip ───

function zipDir(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    let archiver;
    try { archiver = require('archiver'); } catch (e) { return reject(new Error('archiver package not installed')); }
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('warning', err => { if (err.code !== 'ENOENT') reject(err); });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

// ─── The capture run ───

async function runCapture(captureId, operator, lang) {
  const workDir = path.join(os.tmpdir(), `panoptica-${captureId}`);
  const destZip = path.join(EXPORTS_DIR, `${captureId}.zip`);
  const manifest = {
    capture_id: captureId,
    started_at: new Date().toISOString(),
    finished_at: null,
    app_version: versionInfo.version,
    requested_by: operator,
    environment: null,
    payload_version: null,
    bootstrap_version: null,
    included: [],
    skipped: [],
    redactions: {},
  };

  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });

    const stamp = sidecarStamp.readStamp();
    manifest.payload_version = stamp.payload_version;
    manifest.bootstrap_version = stamp.bootstrap_version;

    const included = manifest.included;
    const skipped = manifest.skipped;

    // Plan: count the discrete steps so the UI can show progress.
    setPhase('collecting', 0, 8);

    await step(workDir, 'version.json', included, skipped, async () => collectVersion(path.join(workDir, 'version.json')));
    setPhase('collecting', 1);

    await step(workDir, 'health.json', included, skipped, async () => {
      const health = await require('./routes/api-health').runAllChecks(lang);
      writeJson(path.join(workDir, 'health.json'), health);
    });
    setPhase('collecting', 2);

    await step(workDir, 'config-summary.json', included, skipped, async () => collectConfigSummary(path.join(workDir, 'config-summary.json')));
    setPhase('collecting', 3);

    await step(workDir, 'disk.json', included, skipped, async () => collectDisk(path.join(workDir, 'disk.json')));
    setPhase('collecting', 4);

    await step(workDir, 'update-history', included, skipped, async () => collectUpdateHistory(path.join(workDir, 'update-history')));
    setPhase('collecting', 5);

    await step(workDir, 'app-logs', included, skipped, async () => collectAppLogs(path.join(workDir, 'app-logs')));
    setPhase('collecting', 6);

    // DB block — its own try/caught sub-files; the whole block also guarded so
    // a dead DB still yields logs + config + manifest (§3.7).
    await step(workDir, 'db', included, skipped, async () => collectDb(path.join(workDir, 'db'), included, skipped));
    setPhase('collecting', 7);

    // Docker logs via the sidecar (may be skipped/degraded — always recorded).
    await collectDockerLogs(path.join(workDir, 'docker-logs'), captureId, operator, manifest);
    setPhase('redacting', 8);

    // Redact EVERY text file (including sidecar docker logs) before zipping.
    const redaction = redactor.redactDir(workDir);
    manifest.redactions = redaction.totals;
    if (redaction.errors.length) manifest.redaction_errors = redaction.errors;

    // manifest.json LAST (§3.3.1).
    manifest.finished_at = new Date().toISOString();
    writeJson(path.join(workDir, 'manifest.json'), manifest);

    setPhase('zipping');
    pruneOldBundles(); // delete older ones at the START of finalize (§3.6)
    const bytes = await zipDir(workDir, destZip);

    job.partial = manifest.skipped.length > 0;
    job.bytes = bytes;
    setPhase('done');
    console.log(`[diagnostics] capture ${captureId} complete (${bytes} bytes, ${manifest.skipped.length} gaps)`);
  } catch (e) {
    // A fatal error still tries to produce a (partial) zip — it's most useful
    // exactly when something is badly wrong.
    console.error('[diagnostics] capture error:', e.message);
    job.error = e.message;
    try {
      manifest.fatal_error = e.message;
      manifest.finished_at = new Date().toISOString();
      writeJson(path.join(workDir, 'manifest.json'), manifest);
      try { redactor.redactDir(workDir); } catch (_) {}
      await zipDir(workDir, destZip);
      job.partial = true;
    } catch (e2) {
      console.error('[diagnostics] could not finalize partial bundle:', e2.message);
    }
    setPhase('error');
  } finally {
    job.finished = true;
    // Always remove the temp working dir (§3.6).
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─── Public API ───

/**
 * Start a capture. Throws {code:'in_progress'} if one is already running.
 * Returns { capture_id }. The run proceeds asynchronously; poll getStatus().
 */
function startCapture({ operator }) {
  if (isRunning()) {
    const err = new Error('a diagnostics capture is already running');
    err.code = 'in_progress';
    throw err;
  }
  const captureId = nowStampId();
  job = {
    capture_id: captureId,
    phase: 'queued',
    step: 0,
    total: 8,
    started_at: new Date().toISOString(),
    finished: false,
    partial: false,
    error: null,
    bytes: 0,
  };
  // Fire-and-forget; runCapture handles all its own errors.
  runCapture(captureId, operator, 'en').catch(e => {
    console.error('[diagnostics] unexpected:', e.message);
    if (job) { job.finished = true; job.phase = 'error'; job.error = e.message; }
  });
  return { capture_id: captureId };
}

function getStatus() {
  return {
    phase: job ? job.phase : 'idle',
    step: job ? job.step : 0,
    total: job ? job.total : 0,
    running: isRunning(),
    capture_id: job ? job.capture_id : null,
    partial: job ? job.partial : false,
    error: job ? job.error : null,
    bundles: listBundles(),
  };
}

module.exports = { startCapture, getStatus, listBundles, bundlePath, isRunning, BUNDLE_RE };
