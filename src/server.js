/**
 * Panoptica — Main Server
 * Express + Socket.IO + Session + MSAL
 */

// File logging (Part 2, 2026-06-03). Initialized FIRST — before dotenv and
// every other require — so the very first boot lines are mirrored into
// logs/app-YYYY-MM-DD.log. It only patches process.stdout/stderr.write
// (original write always runs first), so docker/pm2 logs are unaffected.
require('./file-logger').init();

// Process-level crash handlers (Reliability P0, 2026-06-12). Installed right
// after the file logger (so [FATAL] lines land in the daily log file) and
// BEFORE dotenv/config, so even boot-path crashes are caught. An unhandled
// rejection or uncaught exception logs the full stack, bumps
// data/state/crash-counter.json, and exits non-zero so docker/pm2 restarts us.
require('./lib/fatal-handlers').install();

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// MF-3: guarantee a strong session-signing secret BEFORE config + express-session
// load. Self-healing — if SESSION_SECRET is missing/weak/placeholder it generates
// a strong one and persists it to .env. Never uses the old hardcoded default, and
// never fails closed (no lockouts).
require('./lib/session-secret').ensureSessionSecret();

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const config = require('../config/default');
const db = require('./db/database');
const i18n = require('./i18n');

// Routes
const authRoutes = require('./routes/auth');
const authTeamsDelegatedRoutes = require('./routes/auth-teams-delegated');
const tenantApiRoutes = require('./routes/api-tenants');
const alertApiRoutes = require('./routes/api-alerts');
const aiApiRoutes = require('./routes/api-ai');
const reportApiRoutes = require('./routes/api-reports');
const caApiRoutes = require('./routes/api-ca');
const intuneApiRoutes = require('./routes/api-intune');
const exemptionsApiRoutes = require('./routes/api-exemptions');
const alertExemptionsApiRoutes = require('./routes/api-alert-exemptions');
const settingsApiRoutes = require('./routes/api-settings');
const dailyActivityApiRoutes = require('./routes/api-daily-activity');
const sharepointApiRoutes = require('./routes/api-sharepoint');
const healthApiRoutes = require('./routes/api-health');
const changeEventsApiRoutes = require('./routes/api-change-events');
const mspAuditApiRoutes = require('./routes/api-msp-audit');
const securityApiRoutes = require('./routes/api-security');
const heatmapApiRoutes = require('./routes/api-heatmap');
const userPrefsApiRoutes = require('./routes/api-user-prefs');
const metaApiRoutes = require('./routes/api-meta');
const updateApiRoutes = require('./routes/api-update');
const diagnosticsApiRoutes = require('./routes/api-diagnostics');
const psaApiRoutes = require('./routes/api-psa');
const licenseApiRoutes = require('./routes/api-license');
const setupApiRoutes = require('./routes/api-setup');
const legalApiRoutes = require('./routes/api-legal');
const learnApiRoutes = require('./routes/api-learn');
const applicationsApiRoutes = require('./routes/api-applications');
const accessReviewApiRoutes = require('./routes/api-access-review');
const identityTimelineApiRoutes = require('./routes/api-identity-timeline');
const partialRoutes = require('./routes/partials');

// MSP audit service (for boot-time table migration)
const mspAudit = require('./msp-audit');

// License boot orchestrator (v0.1.8+). Validates LICENSE_TOKEN against the
// embedded Ed25519 public key, generates+persists the install fingerprint
// if missing, and refuses to start the server if the license isn't valid.
// Stage B (refresh client) and Stage C (degrade middleware) will consume
// the verified claims via licenseValidator.getLicenseClaims() — that
// module's in-memory cache is updated by every loadAndVerifyLicenseToken
// call, so it stays current after weekly refreshes too. No need to thread
// the claims back out through server.js exports.
const licenseBoot = require('./lib/license/boot');
const licenseRefresh = require('./lib/license/refresh-client');
const updateChecker = require('./lib/update/update-checker');
const licenseDegrade = require('./lib/license/degrade-middleware');

// First-boot setup wizard (v0.1.10+). The middleware gates the entire app
// behind /setup if data/state/setup-completed-once.flag doesn't exist;
// once the wizard finishes it's a pass-through forever. See
// src/lib/setup/state.js for the load-bearing isInSetupMode() check.
const setupState = require('./lib/setup/state');
const setupMiddleware = require('./lib/setup/middleware');

// Polling engine
const polling = require('./polling');
const driftScheduler = require('./drift-scheduler');
const intuneDriftScheduler = require('./intune-drift-scheduler');
const driftHeartbeat = require('./drift-scheduler-heartbeat');
const usersStore = require('./users-store');

// Morning briefing scheduler
const morningBriefing = require('./morning-briefing');
const auditExpiryScheduler = require('./audit-expiry-scheduler');
const ualWorker = require('./ual-worker');
const messageCenterWorker = require('./message-center-worker');
const knownGoodWorker = require('./known-good-worker');
const knownGoodStore = require('./lib/known-good-store');
const accessReviewStore = require('./lib/access-review-store');
const securityApplyWorker = require('./security-apply-worker');
const securityApplyJobs = require('./lib/security-settings/apply-jobs');
const psaWorker = require('./psa-worker');
const psaStore = require('./psa/store');
const retentionWorker = require('./retention-worker');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// ─── Middleware ───

// Trust Nginx reverse proxy (needed for secure cookies behind TLS termination)
app.set('trust proxy', 1);

// Report-branding logo uploads arrive as a base64 PNG in the JSON body, which
// blows past the default ~100kb cap. Give just that path a larger limit; the
// first express.json() to parse a request wins, so the global parser below is
// a no-op for it and stays at the default for every other route. (The route
// handler still enforces a 2 MB decoded ceiling.)
app.use('/api/settings/branding', express.json({ limit: '6mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lightweight readiness endpoint for the Stage 5 updater and external monitors.
// No auth, no DB call — returns 200 as long as the Node process is alive.
// Mounted BEFORE session middleware so it stays cheap and never touches the
// session store. Required by Master Plan §5.13. For richer diagnostics
// (per-check status, DB freshness, etc.) the operator-facing endpoint is
// /api/health, which IS session-gated and DB-backed.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// Strict readiness probe for the Stage 5 updater health gate: returns 503
// until the DB is reachable AND the schema has been applied. Unlike /healthz
// (process-alive only) and /api/health (session-gated, always 200), this is
// the signal the updater trusts before declaring a new image healthy (spec 2.8).
app.get('/healthz/ready', async (req, res) => {
  try {
    await db.queryOne('SELECT 1 AS ok');
    const row = await db.queryOne("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'tenants'");
    if (!row || !row.c) return res.status(503).type('text/plain').send('not-ready: schema');
    return res.type('text/plain').send('ready');
  } catch (e) {
    return res.status(503).type('text/plain').send('not-ready: db');
  }
});

// Boot-status probe for the setup wizard's "reconnecting…" screen.
//
// When the wizard's final step (/api/setup/complete) finishes, the app
// process exits cleanly (process.exit(0)) so the container restart policy
// revives it — that restart is what makes the dotenv-loaded, wizard-collected
// Entra credentials go live (see api-setup.js /complete + docker-compose.yml).
// The wizard polls THIS endpoint to know when the *restarted* process is back.
//
// `entra_configured` reads config.entra.clientId — the value snapshotted at
// THIS process's boot (config/default.js reads process.env at require time).
// The pre-restart process booted with a blank ENTRA_CLIENT_ID, so it reports
// false even in the brief window before it exits; only the restarted process
// (which read the populated .env) reports true. That makes the probe a
// deterministic "the new process with live creds is up" signal and eliminates
// the race where the wizard could see a stale "ok" from the dying process.
//
// Ungated (mounted before session/setup/auth middleware): the operator isn't
// logged in during setup, and there are no secrets in the response.
app.get('/api/boot-status', (req, res) => {
  let setupComplete;
  try { setupComplete = !setupState.isInSetupMode(); }
  catch { setupComplete = false; }
  res.json({
    ok: true,
    entra_configured: !!config.entra.clientId,
    setup_complete: setupComplete,
  });
});

// Session store — MySQL-backed (A5). Replaces the default MemoryStore so:
//   1. The "MemoryStore is not designed for a production environment" warning
//      no longer fires on boot.
//   2. Operator sessions survive `pm2 restart panoptica` — no more forced
//      re-logins after every deploy.
//   3. Multi-instance deployment becomes architecturally possible (not yet
//      required, but no longer blocked).
//
// The library auto-creates the `sessions` table on first boot
// (createDatabaseTable: true by default). Expired rows are pruned every
// 15 minutes by its internal reaper. The store uses its own small internal
// pool (connectionLimit:1 by default) so it doesn't compete with the main
// app's mysql2 pool in src/db/database.js.
const sessionStore = new MySQLStore({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  // Schema defaults are fine; pinning here so a future library default change
  // doesn't silently migrate table/column names.
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
  },
  // Reap expired rows every 15 minutes; 24h session ceiling matches maxAge.
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: config.session.maxAge,
});

sessionStore.onReady().then(() => {
  console.log('[Session] MySQL session store ready (table: sessions)');
}).catch(err => {
  // Non-fatal at startup — session() itself will still work (library falls
  // back to MemoryStore internally on error), but operators should fix the
  // DB before relying on cross-restart persistence.
  console.error('[Session] MySQL store init FAILED — falling back to in-memory:', err.message);
});

const sessionMiddleware = session({
  secret: config.session.secret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.server.env === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: config.session.maxAge,
    sameSite: 'lax',
  },
});
app.use(sessionMiddleware);

// Share session with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Static files — index: false prevents auto-serving index.html (we handle / in route)
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// ─── Routes ───

// ─── First-boot setup wizard middleware (v0.1.10+ Stage 4) ──────────
// Mounted AFTER static (so wizard CSS/JS loads) and BEFORE all auth/API
// routes (so it can gate them). Pass-through once setup-completed-once.flag
// exists. In setup mode, only /setup, /api/setup, /api/i18n, /api/meta,
// /healthz, and static assets are accessible; everything else 302s to
// /setup (browser nav) or 503s (API/XHR).
//
// Setup state file lives at data/state/setup.json (per-step progress) +
// data/state/setup-completed-once.flag (permanent backstop). See
// src/lib/setup/state.js for the design rationale.
app.use(setupMiddleware.setupMiddleware);

// Auth (login, callback, logout, admin consent)
app.use('/auth', authRoutes);
// Apr 28, 2026 — separate sub-mount for delegated Teams admin auth flow
// (used by TEA-01, TEA-02 writers). Routes live under /auth/teams-delegated.
app.use('/auth/teams-delegated', authTeamsDelegatedRoutes);

// License status + manual refresh. Mounted BEFORE the degrade middleware so
// operators always have a way to see "your license is in hard phase" and
// trigger a manual refresh, even when everything else is gated. The
// degrade middleware's ALWAYS_ALLOWED_PREFIXES list also includes
// '/api/license' as belt-and-suspenders.
app.use('/api/license', licenseApiRoutes);

// First-boot wizard API. Mounted BEFORE degrade middleware (wizard runs
// pre-license). Each endpoint internally checks setupState.isInSetupMode()
// and 403s if setup is already complete — so these are NOT a hole on
// production installs. See src/routes/api-setup.js for the full design.
app.use('/api/setup', setupApiRoutes);

// EULA / License Agreement. Mounted BEFORE the degrade middleware (like
// /api/setup + /api/license) so the agreement gate works during the first-boot
// wizard (pre-auth, pre-license) and is never blocked by a degraded license.
// The router itself enforces auth: anonymous only while setup is incomplete,
// requireAdmin once setup completes.
app.use('/api/legal', legalApiRoutes);

// First-boot wizard page (HTML shell + JS state machine). Standalone page,
// NOT served through the main SPA's index.html. Setup middleware's allowlist
// includes /setup as a prefix, so this route reaches even in setup mode.
// Once setup completes, redirect /setup → / so the operator doesn't accidentally
// land on the (now-disabled) wizard.
app.get('/setup', (req, res) => {
  if (!setupState.isInSetupMode()) {
    return res.redirect(302, '/');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'));
});

// ─── License degrade middleware (v0.1.8 Stage C) ───────────────────
// Three-phase enforcement for PAID licenses past JWT exp:
//   - ok / warning (0-14d past exp): pass-through (frontend shows banner)
//   - soft (15-21d):                 block new tenant + Intune template +
//                                    CA template creation with 402
//   - hard (22+d):                   block all non-GET except /auth, /healthz,
//                                    /api/license, /api/meta, /css, /js, etc.
// NFR licenses skip all phases. Mounted AFTER /auth + /api/license so those
// always work, BEFORE the rest of /api/* so writes get gated.
app.use(licenseDegrade.degradeMiddleware);

// API
app.use('/api/tenants', tenantApiRoutes);
app.use('/api/alerts', alertApiRoutes);
app.use('/api/ai', aiApiRoutes);
app.use('/api/reports', reportApiRoutes);
app.use('/api/ca', caApiRoutes);
app.use('/api/intune', intuneApiRoutes);
app.use('/api/exemptions', exemptionsApiRoutes);
app.use('/api/alert-exemptions', alertExemptionsApiRoutes);
app.use('/api/settings', settingsApiRoutes);
app.use('/api/daily-activity', dailyActivityApiRoutes);
app.use('/api/sharepoint', sharepointApiRoutes);
app.use('/api/health', healthApiRoutes);
app.use('/api/change-events', changeEventsApiRoutes);
app.use('/api/msp-audit', mspAuditApiRoutes);
app.use('/api/security', securityApiRoutes);
app.use('/api/heatmap', heatmapApiRoutes);
app.use('/api/user-prefs', userPrefsApiRoutes);
app.use('/api/learn', learnApiRoutes);
app.use('/api/applications', applicationsApiRoutes);
app.use('/api/access-review', accessReviewApiRoutes);
app.use('/api/identity-timeline', identityTimelineApiRoutes);
app.use('/api/meta', metaApiRoutes);
app.use('/api/update', updateApiRoutes);
app.use('/api/diagnostics', diagnosticsApiRoutes);
app.use('/api/psa', psaApiRoutes);

// i18n endpoint — frontend fetches locale strings
app.get('/api/i18n/:lang?', (req, res) => {
  const lang = req.params.lang || 'en';
  res.json(i18n.getLocale(lang));
});

// HTML partials for SPA navigation
app.use('/partials', partialRoutes);

// SPA fallback — serve index.html for all non-API, non-partial routes
app.get('/', (req, res) => {
  // If not authenticated, serve login page
  if (!req.session?.user) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Socket.IO ───

io.on('connection', (socket) => {
  const user = socket.request.session?.user;
  if (!user) {
    socket.disconnect();
    return;
  }
  console.log(`[WS] ${user.email} connected`);

  socket.on('disconnect', () => {
    console.log(`[WS] ${user.email} disconnected`);
  });
});

// Make io accessible to routes (for pushing real-time updates)
app.set('io', io);

// ─── Error Handling ───

app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Internal server error');
});

// ─── Startup ───

async function start() {
  // ─── License validation (v0.1.8+) ─────────────────────────────────
  // First gate. Runs BEFORE any DB connection, scheduler, or route mount.
  // Reasons for ordering:
  //   - A bad license should never trigger DB pool creation (wasted
  //     connections, possible noise in MySQL audit logs).
  //   - A bad license should never trigger session-store table creation
  //     in a fresh DB (sessions table is the express-mysql-session lib's
  //     boot hook; it would land before we'd noticed the license issue).
  //   - The fingerprint generator may write to .env, which is harmless if
  //     subsequent steps fail, but cleaner if it's the only side effect.
  //
  // validateLicenseAtBoot() process.exit(1)s on failure — never returns.
  // On success, the verified claims live in licenseValidator's module-scope
  // cache and are readable from anywhere via getLicenseClaims().
  await licenseBoot.validateLicenseAtBoot();

  // Verify database connection
  try {
    await db.ping();
    console.log('[DB] MySQL connected');
  } catch (err) {
    console.error('[DB] MySQL connection failed:', err.message);
    console.error('[DB] Make sure MySQL is running and credentials in .env are correct');
    process.exit(1);
  }

  // Ensure msp_audit_events table exists (idempotent). Failure is logged but
  // not fatal — the server still starts and audit writes will surface the
  // missing-table error LOUDLY, same contract as change-log.js.
  try {
    await mspAudit.ensureMspAuditTable();
  } catch (e) {
    console.error('[MspAudit] Failed to ensure audit table:', e.message);
  }

  // Seed/refresh the security settings library (Phase A1). Non-fatal on
  // failure — the server still boots; the Security tab will fail its first
  // query LOUDLY instead, which is the correct way to surface a schema drift.
  try {
    const securitySeed = require('./lib/security-settings/seed');
    await securitySeed.seed();
  } catch (e) {
    console.error('[SecuritySettings] Seed failed:', e.message);
  }

  // Seed the curated starter-template library (CA + Intune) — FRESH installs
  // only. Empty-table-gated per table, so existing installs (prod included) are
  // never touched. Awaits both route modules' schema-ensure promises first so
  // ca_templates / intune_templates and their late-added columns
  // (control_dimensions, source_tenant_id) exist before INSERT. Non-fatal: a
  // failure logs loudly but never blocks boot — worst case the Templates UI
  // shows its empty state, exactly as it did before this feature shipped.
  // See src/db/seed-templates.js.
  try {
    await Promise.allSettled([intuneApiRoutes.schemaReady, caApiRoutes.schemaReady]);
    await require('./db/seed-templates').seedStarterTemplates();
  } catch (e) {
    console.error('[Seed:Templates] Starter-template seeding failed at boot:', e.message);
  }

  // Drop the in-image signed updater payload onto the shared bind mount so the
  // socket-holding bootstrap wrapper can verify + adopt it (Part 1, spec §1.3).
  // No-op on the pm2 dev VM (the mount doesn't exist there). Fire-and-forget —
  // never blocks or crashes boot.
  try {
    require('./lib/sidecar/payload-delivery').deliverPayload();
  } catch (e) {
    console.error('[sidecar-payload] delivery threw (non-fatal):', e.message);
  }

  server.listen(config.server.port, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║         PANOPTICA — Online                ║');
    console.log(`  ║  Port: ${String(config.server.port).padEnd(35)}║`);
    console.log(`  ║  Env:  ${config.server.env.padEnd(35)}║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');

    // Start polling engine after server is listening
    polling.start(io);

    // Ensure the drift_scheduler_runs heartbeat table exists before either
    // scheduler's first cycle. Lazily ensured anyway via recordStart, but
    // running it at boot surfaces schema errors loudly instead of silently
    // mid-cycle. Fire-and-forget — heartbeat failure never blocks startup.
    driftHeartbeat.ensureSchema().catch(() => {});

    // Reliability P0 (2026-06-12) — eager-create worker_heartbeats, the
    // one-row-per-loop liveness registry every background worker stamps and
    // the worker_liveness health check reads. Same fire-and-forget posture.
    require('./worker-heartbeat').ensureSchema().catch(err =>
      console.error('[Server] worker-heartbeat schema ensure failed at boot:', err.message)
    );

    // Reliability 1.9 (2026-06-12) — eager-create ai_usage_daily, the AI
    // token ledger behind the daily budget fuse. Fire-and-forget.
    require('./lib/ai-guard').ensureSchema().catch(err =>
      console.error('[Server] ai-guard schema ensure failed at boot:', err.message)
    );

    // Ensure users + operator_mute_periods exist before the first login
    // (Apr 28, 2026). Lazily ensured by usersStore.upsertUserOnLogin, but
    // explicit boot-time ensure surfaces schema errors loudly. Same fire-
    // and-forget posture as the drift heartbeat.
    usersStore.ensureSchema().catch(err =>
      console.error('[Server] users-store schema ensure failed at boot:', err.message)
    );

    // Feature 8.8 — eager-create message_center_items + state tables at boot
    // (spec §4.1 eager-migration pattern), so the schema exists regardless of
    // whether the Message Center feed is currently enabled. Fire-and-forget.
    require('./lib/message-center-store').ensureSchema().catch(err =>
      console.error('[Server] message-center schema ensure failed at boot:', err.message)
    );

    // Feature 8.9 — eager-create known_good_apps + the drift alert policy at
    // boot so the Applications tab + drift worker have their schema regardless
    // of whether anything has triggered them yet. Fire-and-forget.
    knownGoodStore.ensureSchema().catch(err =>
      console.error('[Server] known-good schema ensure failed at boot:', err.message)
    );

    // Feature 8.3 — eager-create psa_tickets + tenants.psa_company_id at boot so
    // the schema exists regardless of whether PSA is currently configured.
    // Fire-and-forget (spec §4.1 eager-migration pattern).
    psaStore.ensureSchema().catch(err =>
      console.error('[Server] PSA schema ensure failed at boot:', err.message)
    );

    // A1 Access Review — eager-create access_review_snapshot + break_glass_accounts
    // at boot so the tab + write guards have their schema regardless of whether
    // anything has triggered them yet. Fire-and-forget.
    accessReviewStore.ensureSchema().catch(err =>
      console.error('[Server] access-review schema ensure failed at boot:', err.message)
    );

    // Extend api_health.status with 'unavailable' so capability-gated Graph
    // endpoints (tenant license tier / Defender provisioning, not failures) stop
    // polluting the API-health card. Idempotent probe; fire-and-forget.
    require('./graph').ensureSchema().catch(err =>
      console.error('[Server] api_health schema ensure failed at boot:', err.message)
    );

    // Start CA drift scheduler (60-minute cycle). Also passes
    // expireExemptions so overdue exemption grants are auto-revoked at the
    // top of each cycle — part of the exemption-aware alert suppression
    // shipped 2026-04-18.
    driftScheduler.start(caApiRoutes.checkDrift, caApiRoutes.expireExemptions);

    // Start Intune drift scheduler (60-minute cycle, offset at :30)
    intuneDriftScheduler.start(intuneApiRoutes.runAllIntuneDriftChecks, intuneApiRoutes.schemaReady);

    // Start morning briefing scheduler
    morningBriefing.start();

    // Start audit-only tenant expiry scheduler (daily at 09:00).
    // Sends day-14 warning emails + cascade-deletes at day 21 + sends
    // post-deletion enterprise-app revocation reminder.
    auditExpiryScheduler.start();

    // Start UAL worker (5-minute cycle). Per managed tenant, per content type:
    // ensure subscription, list/fetch new content blobs, persist to ual_events.
    // Audit-only tenants gated upstream via shouldProcessTenant. The first
    // cycle is deferred 30s to avoid piling onto startup work.
    // Wired May 4, 2026 (UAL Phase 2b).
    ualWorker.startLoop();

    // Start Microsoft Message Center worker (Feature 8.8). Wakes hourly but
    // acts once per 24h; no-ops entirely unless an operator has selected a
    // source tenant in Settings → Microsoft message feed. Surfaces
    // Microsoft-caused configuration drift as MSP-level alerts.
    messageCenterWorker.start();

    // Feature 8.9 — known-good apps drift loop (daily, ~24h per managed tenant;
    // never in the 15-min poll). Backstop for permission drift on blessed apps.
    knownGoodWorker.start();

    // Async-Apply infrastructure (May 6, 2026).
    // Stranded-job recovery FIRST — any apply jobs in 'running' state from
    // a previous process didn't actually complete (the pwsh child died with
    // the parent). Mark them as failed with reason 'process_restarted' so
    // the operator can re-Apply rather than waiting forever for a ghost job.
    securityApplyJobs.recoverStrandedJobs().catch(err =>
      console.error('[Server] recoverStrandedJobs failed at boot:', err.message)
    );
    // Then start the worker — concurrency 1, polls every 2s, 30-min hard
    // cap per job. Fully separate from the UAL worker.
    securityApplyWorker.start();

    // License refresh client (v0.1.8). Schedules a weekly heartbeat to the
    // license server based on the current JWT's iat. On success, writes the
    // new token to both .env and the cache sidecar; on failure, retries in
    // 24h. Boot validation has already verified the token, so the refresh
    // client safely assumes a valid current claims set is in
    // licenseValidator's in-memory cache. The timer is unref'd so a pending
    // refresh never blocks shutdown.
    licenseRefresh.start();
    updateChecker.start();
    updateChecker.reconcileTerminalStatus().catch(() => {});

    // Feature 8.3 — PSA worker (Autotask poll + retry). Wakes every minute,
    // acts every PSA_POLL_INTERVAL_MIN, no-ops entirely until an operator
    // selects a provider + credentials in Settings → PSA Integration.
    psaWorker.start();

    // Reliability P0 (2026-06-12) — daily retention worker (03:30 local).
    // Enforces the config.retention.days windows on the six previously
    // unbounded tables. Batched deletes; stamps the heartbeat registry.
    retentionWorker.start();

    // Reliability 1.8 (2026-06-12) — daily allowlisted instance-health
    // summary to the license server's /api/v1/telemetry (best-effort, its
    // own endpoint — never piggybacked onto the license refresh call).
    // States and counts only; no tenant data. TELEMETRY_ENABLED=false opts out.
    require('./lib/telemetry').start();
  });
}

// Graceful shutdown. The 30s deadline race (Reliability P0, 2026-06-12)
// guarantees a hung worker stop or stalled DB close can't stall `docker stop`
// until the daemon SIGKILLs us mid-write. The timer is unref'd so it never
// holds the process open when the clean path wins.
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received, shutting down...`);
  const deadline = setTimeout(() => {
    console.error('[Server] Shutdown deadline (30s) exceeded — forcing exit');
    process.exit(1);
  }, 30 * 1000);
  if (deadline.unref) deadline.unref();
  polling.stop();
  driftScheduler.stop();
  intuneDriftScheduler.stop();
  morningBriefing.stop();
  auditExpiryScheduler.stop();
  ualWorker.stopLoop();
  messageCenterWorker.stop();
  knownGoodWorker.stop();
  securityApplyWorker.stop();
  licenseRefresh.stop();
  psaWorker.stop();
  retentionWorker.stop();
  require('./lib/telemetry').stop();
  await db.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

start();
