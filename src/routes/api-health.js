/**
 * Panoptica — System Health API
 *
 * Aggregates operational health signals into a single endpoint for the
 * footer status indicator and its click-through diagnostic modal.
 *
 * Design principles:
 *   1. NO outbound API calls from this endpoint. All signals are derived
 *      from DB state that pollers/briefing jobs already populate.
 *      This keeps latency O(1) regardless of tenant count — critical for
 *      scaling to 150+ tenants without adding reliability risk.
 *   2. Thresholds scale gracefully. For small MSPs (≤20 tenants) we trigger
 *      on absolute counts ("1 tenant stale = amber"). For larger operators
 *      we additionally check percentage ("20% stale = critical"). Whichever
 *      fires first wins.
 *   3. Each check returns its own independent state. The overall rollup is
 *      max(states) — i.e. any critical check makes the system critical.
 *
 * Signals:
 *   - alert_poller   : tenants.last_polled_at vs tenants.polling_interval
 *                      (primary signal per Jacques' explicit ask)
 *   - graph_endpoints: api_health WHERE status != 'healthy' in last 2h
 *   - claude_api     : MAX(morning_briefings.generated_at)
 *   - database       : SELECT 1 latency (if this returns, DB is trivially up)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../auth');
const db = require('../db/database');
const aiAnalysis = require('../ai-analysis');
const driftHeartbeat = require('../drift-scheduler-heartbeat');
const workerHeartbeat = require('../worker-heartbeat');
const config = require('../../config/default');
const psa = require('../psa');
const { t } = require('../i18n');

const router = express.Router();
router.use(auth.requireAuth);

// ─── Tunables ───
// Grace periods balance false-positive noise against detection latency.
// Alert poller: 15-min cadence + 5-min grace = amber once a tenant is >20 min stale.
const POLLER_GRACE_MINUTES = 5;
// Graph errors older than this are no longer considered "current".
const GRAPH_ERROR_WINDOW_HOURS = 2;
// Briefing is generated daily at 06:00 ET. >30h = one missed day. >72h = multiple.
const CLAUDE_WARN_HOURS = 30;
const CLAUDE_CRIT_HOURS = 72;
// DB ping thresholds.
const DB_WARN_MS = 50;
const DB_CRIT_MS = 200;
// Disk-space sentry (added 2026-06-04 after a full disk wedged Prod). Warn early
// so there's time to act before anything breaks; crit when it's nearly gone.
const DISK_WARN_PCT = 80;
const DISK_CRIT_PCT = 90;
// The volume that matters is wherever the app + its data/logs/backups live.
const DISK_PATH = path.join(__dirname, '..', '..');
// AI parse-health: action threshold per project_ai_analysis_overhaul memory.
// Below MIN_SAMPLES we report 'collecting baseline' instead of throwing alarms
// off two bad parses. Above 5% miss-rate is the documented action threshold.
const AI_PARSE_MIN_SAMPLES = 50;
const AI_PARSE_WARN_PCT = 2;
const AI_PARSE_CRIT_PCT = 5;
// Drift scheduler heartbeat staleness — both schedulers run on a 60-min
// cycle. Allow 30 min of slack before warn (slow Graph cycle, etc.); 90 min
// total before crit (a missed cycle is a real signal).
const DRIFT_HEARTBEAT_WARN_SECONDS = 75 * 60;
const DRIFT_HEARTBEAT_CRIT_SECONDS = 90 * 60;

// State severity order — used to roll up overall status.
const STATE_ORDER = { ok: 0, warn: 1, crit: 2 };
function worseOf(a, b) {
  return STATE_ORDER[a] >= STATE_ORDER[b] ? a : b;
}
function overallState(checks) {
  return checks.reduce((acc, c) => worseOf(acc, c.state), 'ok');
}

// ─── Threshold helpers ───
// Small-MSP: trigger on absolute counts. Large-MSP: also trigger on percentage.
// Whichever is stricter wins — so a 150-tenant op with 4 stale tenants still
// fires warn, and a 14-tenant op with 4 stale tenants fires crit.
function classifyFailureCount(failed, total, warnMin, critMin, critPct) {
  if (total === 0 || failed === 0) return 'ok';
  const pct = (failed / total) * 100;
  if (failed >= critMin || pct >= critPct) return 'crit';
  if (failed >= warnMin) return 'warn';
  return 'ok';
}

// ─── Individual checks ───

async function checkAlertPoller(lang) {
  // Audit-only tenants are explicitly designed to poll ONCE on add and then
  // only on operator-manual refresh — they do NOT participate in the 15-min
  // cron. Including them in the "overdue" check produces false-positive
  // health degradation. Filter to managed only. (Per audit-only spec lock-in
  // 2026-04-28: "Scheduled polling SKIPPED for audit_only".)
  const tenants = await db.queryRows(
    `SELECT id, display_name, polling_interval, last_polled_at,
            TIMESTAMPDIFF(MINUTE, last_polled_at, NOW()) AS mins_since_poll
     FROM tenants
     WHERE enabled = TRUE
       AND mode = 'managed'`
  );
  const total = tenants.length;
  const stale = tenants.filter(t => {
    if (t.last_polled_at === null) return true;
    const limit = (t.polling_interval || 15) + POLLER_GRACE_MINUTES;
    return t.mins_since_poll > limit;
  });

  // Jacques' rule: any single stale tenant → amber. ≥3 or ≥20% → crit.
  const state = classifyFailureCount(stale.length, total, 1, 3, 20);

  let summary;
  if (total === 0) {
    summary = t('health.alert_poller.summary.no_tenants', { lang });
  } else if (stale.length === 0) {
    summary = t('health.alert_poller.summary.all_polled', { lang, count: total, total });
  } else {
    summary = t('health.alert_poller.summary.overdue', { lang, count: stale.length, stale: stale.length, total });
  }

  // Freshest / stalest for at-a-glance context
  const ageSorted = tenants
    .filter(t => t.last_polled_at !== null)
    .sort((a, b) => a.mins_since_poll - b.mins_since_poll);
  const freshestMins = ageSorted[0]?.mins_since_poll;
  const stalestMins = ageSorted[ageSorted.length - 1]?.mins_since_poll;

  const detail = {
    freshest_minutes: freshestMins ?? null,
    stalest_minutes: stalestMins ?? null,
    stale_tenants: stale.map(t => ({
      id: t.id,
      name: t.display_name,
      minutes_overdue: t.last_polled_at === null
        ? null
        : t.mins_since_poll - ((t.polling_interval || 15) + POLLER_GRACE_MINUTES),
      last_polled_at: t.last_polled_at,
    })),
  };

  return {
    id: 'alert_poller',
    label: t('health.alert_poller.label', { lang }),
    state,
    summary,
    detail,
  };
}

async function checkGraphEndpoints(lang) {
  // Count distinct tenants with any broken/degraded endpoint in the last N hours.
  const rows = await db.queryRows(
    `SELECT h.tenant_id, t.display_name, h.endpoint, h.status,
            h.failure_count, h.last_error, h.last_failure_at, h.last_success_at
     FROM api_health h
     JOIN tenants t ON t.id = h.tenant_id
     WHERE t.enabled = TRUE
       AND t.mode = 'managed'
       -- Only real failures count toward the health card. 'unavailable' means
       -- the tenant's license tier / Defender provisioning doesn't include the
       -- endpoint (e.g. Business Basic/Standard has no Entra ID P1/P2) — a normal
       -- state, not a degradation, so it must not light up the bottom-left bar.
       AND h.status IN ('degraded','broken')
       AND h.last_failure_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
     ORDER BY h.last_failure_at DESC`,
    [GRAPH_ERROR_WINDOW_HOURS]
  );

  // Match the denominator to the numerator — only count managed tenants
  // since audit-only tenants are excluded from the affected-tenants tally.
  const tenantCountRow = await db.queryOne(
    `SELECT COUNT(*) AS cnt FROM tenants WHERE enabled = TRUE AND mode = 'managed'`
  );
  const totalTenants = tenantCountRow?.cnt || 0;

  const affectedTenants = new Set(rows.map(r => r.tenant_id));
  const brokenCount = rows.filter(r => r.status === 'broken').length;

  // ≥1 tenant affected → warn; ≥3 tenants OR ≥10% OR any endpoint marked 'broken' (not just degraded) → crit.
  let state = classifyFailureCount(affectedTenants.size, totalTenants, 1, 3, 10);
  if (brokenCount > 0) state = worseOf(state, 'crit');

  const summary = affectedTenants.size === 0
    ? t('health.graph_endpoints.summary.all_healthy', { lang })
    : t('health.graph_endpoints.summary.affected', {
        lang,
        count: affectedTenants.size,
        records: rows.length,
      });

  const detail = {
    window_hours: GRAPH_ERROR_WINDOW_HOURS,
    total_tenants: totalTenants,
    failing_tenants: affectedTenants.size,
    records: rows.map(r => ({
      tenant: r.display_name,
      endpoint: r.endpoint,
      status: r.status,
      failure_count: r.failure_count,
      last_error: r.last_error,
      last_failure_at: r.last_failure_at,
      last_success_at: r.last_success_at,
    })),
  };

  return {
    id: 'graph_endpoints',
    label: t('health.graph_endpoints.label', { lang }),
    state,
    summary,
    detail,
  };
}

async function checkClaudeApi(lang) {
  const row = await db.queryOne(
    `SELECT MAX(generated_at) AS last_generated_at,
            TIMESTAMPDIFF(HOUR, MAX(generated_at), NOW()) AS hours_since
     FROM morning_briefings`
  );

  let state = 'ok';
  let summary;

  if (!row || row.last_generated_at === null) {
    state = 'warn';
    summary = t('health.claude_api.summary.no_briefings', { lang });
  } else if (row.hours_since >= CLAUDE_CRIT_HOURS) {
    state = 'crit';
    summary = t('health.claude_api.summary.critical', { lang, hours: row.hours_since });
  } else if (row.hours_since >= CLAUDE_WARN_HOURS) {
    state = 'warn';
    summary = t('health.claude_api.summary.warn', { lang, hours: row.hours_since });
  } else {
    summary = t('health.claude_api.summary.ok', { lang, hours: row.hours_since });
  }

  return {
    id: 'claude_api',
    label: t('health.claude_api.label', { lang }),
    state,
    summary,
    detail: {
      last_generated_at: row?.last_generated_at ?? null,
      hours_since: row?.hours_since ?? null,
      warn_threshold_hours: CLAUDE_WARN_HOURS,
      crit_threshold_hours: CLAUDE_CRIT_HOURS,
    },
  };
}

async function checkAiParseHealth(lang) {
  // In-process counter only — resets on pm2 restart by design. The useful
  // question is "is Haiku format-drifting now", not "ever".
  const stats = aiAnalysis.getParseStats();
  const total = stats.total_parses;
  const sevMissPct = stats.severity_miss_pct;

  let state = 'ok';
  let summary;

  if (total < AI_PARSE_MIN_SAMPLES) {
    summary = t('health.ai_parse.summary.baseline', {
      lang,
      count: total,
      total,
      min: AI_PARSE_MIN_SAMPLES,
    });
  } else if (sevMissPct >= AI_PARSE_CRIT_PCT) {
    state = 'crit';
    summary = t('health.ai_parse.summary.crit', {
      lang,
      pct: sevMissPct,
      total,
      threshold: AI_PARSE_CRIT_PCT,
    });
  } else if (sevMissPct >= AI_PARSE_WARN_PCT) {
    state = 'warn';
    summary = t('health.ai_parse.summary.warn', {
      lang,
      pct: sevMissPct,
      total,
    });
  } else {
    summary = t('health.ai_parse.summary.ok', {
      lang,
      pct: sevMissPct,
      total,
    });
  }

  return {
    id: 'ai_parse_health',
    label: t('health.ai_parse.label', { lang }),
    state,
    summary,
    detail: {
      ...stats,
      min_samples_for_alert: AI_PARSE_MIN_SAMPLES,
      warn_threshold_pct: AI_PARSE_WARN_PCT,
      crit_threshold_pct: AI_PARSE_CRIT_PCT,
    },
  };
}

async function checkDriftSchedulers(lang) {
  // Direct heartbeat reads — drift_scheduler_runs is the single source of
  // truth, replacing the indirect inference from api_health rows.
  const last = await driftHeartbeat.getLastRunPerScheduler();

  function classify(scheduler, run) {
    if (!run) {
      // Never run since process start — could be a fresh boot. The 30s/60s
      // initial-run delays in each scheduler mean this resolves quickly.
      return {
        state: 'warn',
        summary: t('health.drift_schedulers.scheduler_summary.no_run', { lang, scheduler }),
      };
    }
    const age = run.seconds_since_end;
    if (run.error_message) {
      return {
        state: 'crit',
        summary: t('health.drift_schedulers.scheduler_summary.errored', {
          lang,
          scheduler,
          error: truncate(run.error_message, 80),
        }),
      };
    }
    if (age >= DRIFT_HEARTBEAT_CRIT_SECONDS) {
      return {
        state: 'crit',
        summary: t('health.drift_schedulers.scheduler_summary.crit_age', {
          lang,
          scheduler,
          min: Math.floor(age / 60),
          threshold: DRIFT_HEARTBEAT_CRIT_SECONDS / 60,
        }),
      };
    }
    if (age >= DRIFT_HEARTBEAT_WARN_SECONDS) {
      return {
        state: 'warn',
        summary: t('health.drift_schedulers.scheduler_summary.warn_age', {
          lang,
          scheduler,
          min: Math.floor(age / 60),
        }),
      };
    }
    return {
      state: 'ok',
      summary: t('health.drift_schedulers.scheduler_summary.ok', {
        lang,
        scheduler,
        min: Math.floor(age / 60),
        checks: run.total_checks ?? 0,
      }),
    };
  }

  const ca = classify('ca', last.ca);
  const intune = classify('intune', last.intune);

  // Roll up: worse of the two.
  const state = STATE_ORDER[ca.state] >= STATE_ORDER[intune.state] ? ca.state : intune.state;

  let summary;
  if (state === 'ok') {
    summary = t('health.drift_schedulers.summary.ok', {
      lang,
      caMin: last.ca?.seconds_since_end ? Math.floor(last.ca.seconds_since_end / 60) : '?',
      intuneMin: last.intune?.seconds_since_end ? Math.floor(last.intune.seconds_since_end / 60) : '?',
    });
  } else {
    summary = t('health.drift_schedulers.summary.degraded', {
      lang,
      caSummary: ca.summary,
      intuneSummary: intune.summary,
    });
  }

  return {
    id: 'drift_schedulers',
    label: t('health.drift_schedulers.label', { lang }),
    state,
    summary,
    detail: {
      ca: last.ca,
      intune: last.intune,
      ca_status: ca,
      intune_status: intune,
      warn_threshold_seconds: DRIFT_HEARTBEAT_WARN_SECONDS,
      crit_threshold_seconds: DRIFT_HEARTBEAT_CRIT_SECONDS,
    },
  };
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.substring(0, n - 1) + '…';
}

// ─── Worker liveness (Reliability P0, 2026-06-12) ───
//
// Reads the worker_heartbeats registry every background loop stamps (see
// src/worker-heartbeat.js) and applies per-worker staleness thresholds.
// Workers that are configured OFF (PSA without a provider, Message Center
// without a source tenant, briefing disabled) report ok with an
// "idle by configuration" summary — read from the same config the workers
// read, so the gate can never disagree with the worker.
//
// thresholds in SECONDS, keyed on time-since-last-success. `idle` is an
// optional () => boolean evaluated per request.
const WORKER_LIVENESS_SPEC = [
  { id: 'polling',          warn: 45 * 60,        crit: 2 * 3600 },
  { id: 'ual',              warn: 15 * 60,        crit: 3600 },
  { id: 'psa',              warn: 3600,           crit: 6 * 3600,   idle: () => !psa.isConfigured() },
  { id: 'known_good',       warn: 26 * 3600,      crit: 50 * 3600 },
  { id: 'message_center',   warn: 26 * 3600,      crit: 50 * 3600,  idle: () => !(config.messageCenter && config.messageCenter.sourceTenant) },
  { id: 'morning_briefing', warn: 26 * 3600,      crit: 50 * 3600,  idle: () => !config.briefing.enabled },
  { id: 'audit_expiry',     warn: 26 * 3600,      crit: 50 * 3600 },
  { id: 'security_apply',   warn: 15 * 60,        crit: 3600 },
  { id: 'license_refresh',  warn: 8 * 86400,      crit: 15 * 86400 },
  { id: 'update_checker',   warn: 4 * 3600,       crit: 26 * 3600 },
  { id: 'retention',        warn: 26 * 3600,      crit: 50 * 3600 },
  { id: 'ca_drift',         warn: 75 * 60,        crit: 90 * 60 },
  { id: 'intune_drift',     warn: 75 * 60,        crit: 90 * 60 },
  // Adopted CA+Intune drift sweep (hourly at :15). Heavier than the deployed
  // schedulers (discovery + drift across both surfaces for every tenant), so a
  // more generous window to avoid false-amber on large fleets.
  { id: 'adopt_drift',      warn: 100 * 60,       crit: 3 * 3600 },
];

// Human-readable age with localized unit. Minutes under 2h, hours under 2d,
// days beyond — matches how an operator reads a staleness number.
function formatAge(seconds, lang) {
  if (seconds == null) return '—';
  if (seconds < 2 * 3600) return t('health.worker_liveness.age_min', { lang, n: Math.max(0, Math.floor(seconds / 60)) });
  if (seconds < 48 * 3600) return t('health.worker_liveness.age_hours', { lang, n: Math.floor(seconds / 3600) });
  return t('health.worker_liveness.age_days', { lang, n: Math.floor(seconds / 86400) });
}

async function checkWorkerLiveness(lang) {
  const beats = await workerHeartbeat.getAllHeartbeats();
  const uptimeSec = Math.round(process.uptime());

  const workers = [];
  const problems = [];
  let state = 'ok';
  let idleCount = 0;

  for (const spec of WORKER_LIVENESS_SPEC) {
    const name = t(`health.worker_liveness.workers.${spec.id}`, { lang });
    const row = beats.get(spec.id) || null;
    let wState = 'ok';
    let wSummary;
    let idle = false;
    try { idle = spec.idle ? !!spec.idle() : false; } catch (_) { idle = false; }

    if (idle) {
      idleCount++;
      wSummary = t('health.worker_liveness.worker.idle', { lang, worker: name });
    } else if (!row || (!row.last_success && !row.last_error)) {
      // Never completed a cycle. The registry persists across restarts, so
      // this is a fresh install / first run — stay quiet while the process is
      // younger than the warn threshold, escalate if it never shows up.
      if (uptimeSec >= spec.crit) {
        wState = 'crit';
        wSummary = t('health.worker_liveness.worker.never_ran', { lang, worker: name, age: formatAge(uptimeSec, lang) });
      } else if (uptimeSec >= spec.warn) {
        wState = 'warn';
        wSummary = t('health.worker_liveness.worker.never_ran', { lang, worker: name, age: formatAge(uptimeSec, lang) });
      } else {
        wSummary = t('health.worker_liveness.worker.pending', { lang, worker: name });
      }
    } else if (!row.last_success) {
      // Has started (and erred) but never completed a single cycle.
      wState = 'crit';
      wSummary = t('health.worker_liveness.worker.never_succeeded', {
        lang, worker: name,
        failures: row.consecutive_failures || 0,
        error: truncate(row.last_error_message || '', 80),
      });
    } else {
      const age = row.seconds_since_success;
      if (age >= spec.crit) {
        wState = 'crit';
        wSummary = t('health.worker_liveness.worker.stale_crit', { lang, worker: name, age: formatAge(age, lang), threshold: formatAge(spec.crit, lang) });
      } else if (age >= spec.warn) {
        wState = 'warn';
        wSummary = t('health.worker_liveness.worker.stale_warn', { lang, worker: name, age: formatAge(age, lang), threshold: formatAge(spec.warn, lang) });
      } else if ((row.consecutive_failures || 0) >= 3) {
        // Fresh last_success but the recent cycles keep failing — early signal.
        wState = 'warn';
        wSummary = t('health.worker_liveness.worker.failing', {
          lang, worker: name,
          failures: row.consecutive_failures,
          error: truncate(row.last_error_message || '', 80),
        });
      } else {
        wSummary = t('health.worker_liveness.worker.ok', { lang, worker: name, age: formatAge(age, lang) });
      }
    }

    state = worseOf(state, wState);
    if (wState !== 'ok') problems.push(name);
    workers.push({
      id: spec.id,
      name,
      state: wState,
      summary: wSummary,
      idle,
      last_start: row?.last_start ?? null,
      last_success: row?.last_success ?? null,
      last_error: row?.last_error ?? null,
      last_error_message: row?.last_error_message ?? null,
      consecutive_failures: row?.consecutive_failures ?? 0,
      last_duration_ms: row?.last_duration_ms ?? null,
      seconds_since_success: row?.seconds_since_success ?? null,
      warn_threshold_seconds: spec.warn,
      crit_threshold_seconds: spec.crit,
    });
  }

  const activeCount = workers.length - idleCount;
  const summary = state === 'ok'
    ? (idleCount > 0
        ? t('health.worker_liveness.summary.all_ok_with_idle', { lang, count: activeCount, idle: idleCount })
        : t('health.worker_liveness.summary.all_ok', { lang, count: activeCount }))
    : t('health.worker_liveness.summary.degraded', { lang, count: problems.length, list: problems.join(', ') });

  return {
    id: 'worker_liveness',
    label: t('health.worker_liveness.label', { lang }),
    state,
    summary,
    detail: { workers, process_uptime_seconds: uptimeSec },
  };
}

// ─── DB size (Reliability P0, 2026-06-12; size threshold removed 2026-06-19) ───
//
// Per-table rows + bytes from information_schema, reported for visibility only.
// There is NO size threshold: MySQL/InnoDB scales to hundreds of GB, and a fixed
// GB "warn" just produced a permanent amber on any healthy, growing book. This
// check always reports 'ok' and never affects the overall health rollup.
// TABLE_ROWS / DATA_LENGTH are InnoDB estimates — fine for a readout, not an audit.
const DB_SIZE_TOP_TABLES = 12;

async function checkDbSize(lang) {
  try {
    // MySQL 8 caches information_schema.TABLES statistics for up to 24h
    // (information_schema_stats_expiry, default 86400) — long enough to
    // report yesterday's size after a big prune, which is exactly the kind
    // of stale signal a health check must not emit (bit on Prod 2026-06-12:
    // the modal showed 27.98 GB for hours after a 2.1M-row delete). Force
    // fresh stats for THESE reads only, on a single dedicated connection,
    // and reset before releasing it back to the pool. withTransaction is
    // just the same-connection vehicle here — the reads don't need one.
    const { totals, rows } = await db.withTransaction(async (conn) => {
      await conn.query('SET SESSION information_schema_stats_expiry = 0');
      try {
        const [totalRows] = await conn.query(
          `SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS total_bytes,
                  COUNT(*) AS table_count
             FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()`
        );
        const [topRows] = await conn.query(
          `SELECT TABLE_NAME AS table_name,
                  TABLE_ROWS AS table_rows,
                  DATA_LENGTH AS data_bytes,
                  INDEX_LENGTH AS index_bytes
             FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
            LIMIT ${DB_SIZE_TOP_TABLES}`
        );
        return { totals: totalRows[0] || null, rows: topRows };
      } finally {
        await conn.query('SET SESSION information_schema_stats_expiry = DEFAULT').catch(() => {});
      }
    });

    const totalBytes = Number(totals?.total_bytes || 0);
    const totalGb = totalBytes / (1024 ** 3);

    return {
      id: 'db_size',
      label: t('health.db_size.label', { lang }),
      state: 'ok',
      summary: t('health.db_size.summary.ok', { lang, gb: totalGb.toFixed(2), tables: totals?.table_count ?? 0 }),
      detail: {
        total_bytes: totalBytes,
        table_count: totals?.table_count ?? 0,
        top_tables: rows.map(r => ({
          table: r.table_name,
          rows: Number(r.table_rows || 0),
          data_bytes: Number(r.data_bytes || 0),
          index_bytes: Number(r.index_bytes || 0),
        })),
      },
    };
  } catch (err) {
    return {
      id: 'db_size',
      label: t('health.db_size.label', { lang }),
      state: 'ok',
      summary: t('health.db_size.summary.unknown', { lang }),
      detail: { error: err.message || String(err) },
    };
  }
}

async function checkDatabase(lang) {
  const t0 = Date.now();
  try {
    await db.queryOne('SELECT 1 AS ok');
    const ms = Date.now() - t0;
    let state = 'ok';
    if (ms >= DB_CRIT_MS) state = 'crit';
    else if (ms >= DB_WARN_MS) state = 'warn';
    return {
      id: 'database',
      label: t('health.database.label', { lang }),
      state,
      summary: t('health.database.summary.ok', { lang, ms }),
      detail: { ping_ms: ms, warn_threshold_ms: DB_WARN_MS, crit_threshold_ms: DB_CRIT_MS },
    };
  } catch (err) {
    return {
      id: 'database',
      label: t('health.database.label', { lang }),
      state: 'crit',
      summary: t('health.database.summary.unreachable', { lang }),
      detail: { error: err.message || String(err) },
    };
  }
}

async function checkDisk(lang) {
  // fs.statfsSync is available on Node 18.15+. Compute "used %" the way `df`
  // reports it so the number matches what an operator sees on the box.
  try {
    const s = fs.statfsSync(DISK_PATH);
    const total = s.blocks * s.bsize;
    const availToUser = s.bavail * s.bsize;
    const free = s.bfree * s.bsize;
    const used = total - free;
    // df Use% = used / (used + available-to-user)
    const usedPct = Math.round((used / (used + availToUser)) * 100);
    const freeGb = (availToUser / (1024 ** 3));

    let state = 'ok';
    if (usedPct >= DISK_CRIT_PCT) state = 'crit';
    else if (usedPct >= DISK_WARN_PCT) state = 'warn';

    const summary = state === 'ok'
      ? t('health.disk.summary.ok', { lang, pct: usedPct, freeGb: freeGb.toFixed(1) })
      : (state === 'crit'
          ? t('health.disk.summary.crit', { lang, pct: usedPct, freeGb: freeGb.toFixed(1) })
          : t('health.disk.summary.warn', { lang, pct: usedPct, freeGb: freeGb.toFixed(1) }));

    return {
      id: 'disk',
      label: t('health.disk.label', { lang }),
      state,
      summary,
      detail: {
        path: DISK_PATH,
        used_pct: usedPct,
        free_bytes: availToUser,
        total_bytes: total,
        warn_threshold_pct: DISK_WARN_PCT,
        crit_threshold_pct: DISK_CRIT_PCT,
      },
    };
  } catch (err) {
    return {
      id: 'disk',
      label: t('health.disk.label', { lang }),
      state: 'warn',
      summary: t('health.disk.summary.unknown', { lang }),
      detail: { path: DISK_PATH, error: err.message || String(err) },
    };
  }
}

// ─── Endpoint ───

/**
 * GET /api/health
 *
 * Returns:
 *   {
 *     overall:    'nominal' | 'degraded' | 'critical',
 *     summary:    human-readable aggregate line,
 *     checked_at: ISO timestamp,
 *     checks:     [{ id, label, state, summary, detail }, ...]
 *   }
 *
 * `state` on a check is ok|warn|crit. `overall` is the rolled-up version
 * (nominal|degraded|critical) — different vocabulary because the status bar
 * reads prose-like ("DEGRADED") while individual rows need short LED states.
 */
/**
 * Run every health check and roll them up. Extracted so callers other than the
 * HTTP route — notably the diagnostics collector (Part 3, 2026-06-03) which
 * imports it directly rather than making an HTTP self-call — get the identical
 * aggregation. Never throws: a thrown check is caught by the route wrapper.
 */
async function runAllChecks(lang = 'en') {
  // Run all checks in parallel — they each hit different tables.
  const [alertPoller, graphEndpoints, claudeApi, aiParse, driftSchedulers, workerLiveness, database, dbSize, disk] = await Promise.all([
    checkAlertPoller(lang),
    checkGraphEndpoints(lang),
    checkClaudeApi(lang),
    checkAiParseHealth(lang),
    checkDriftSchedulers(lang),
    checkWorkerLiveness(lang),
    checkDatabase(lang),
    checkDbSize(lang),
    checkDisk(lang),
  ]);

  const checks = [alertPoller, graphEndpoints, claudeApi, aiParse, driftSchedulers, workerLiveness, database, dbSize, disk];
  const rolled = overallState(checks);
  const overall = rolled === 'ok' ? 'nominal' : (rolled === 'warn' ? 'degraded' : 'critical');

  // Build aggregate summary line for the status bar.
  let summary;
  if (overall === 'nominal') {
    summary = t('health.overall_summary.nominal', { lang });
  } else {
    // Surface the most important failing check in the summary line.
    const worst = checks.find(c => c.state === rolled);
    const tplKey = overall === 'critical'
      ? 'health.overall_summary.critical'
      : 'health.overall_summary.degraded';
    summary = t(tplKey, { lang, worstSummary: worst.summary });
  }

  return { overall, summary, checked_at: new Date().toISOString(), checks };
}

router.get('/', async (req, res) => {
  const lang = req.query.lang || 'en';
  try {
    res.json(await runAllChecks(lang));
  } catch (err) {
    console.error('[Health] Aggregate check failed:', err.message);
    // If the health endpoint itself throws, return critical — we genuinely
    // don't know what's going on, which is itself a critical state.
    res.status(500).json({
      overall: 'critical',
      summary: t('health.endpoint_error_summary', { lang }),
      checked_at: new Date().toISOString(),
      checks: [{
        id: 'meta',
        label: t('health.endpoint_error_label', { lang }),
        state: 'crit',
        summary: err.message || t('health.endpoint_unknown', { lang }),
        detail: {},
      }],
    });
  }
});

/**
 * GET /api/health/disk — just the disk check. Lightweight (no DB), for the
 * Settings → Disk space card and any UI that wants storage without running the
 * full aggregation. Auth is applied via router.use(requireAuth) above.
 */
router.get('/disk', async (req, res) => {
  const lang = req.query.lang || 'en';
  res.json(await checkDisk(lang));
});

module.exports = router;
module.exports.runAllChecks = runAllChecks;
