/**
 * Panoptica — Main Server
 * Express + Socket.IO + Session + MSAL
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

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
const userPrefsApiRoutes = require('./routes/api-user-prefs');
const metaApiRoutes = require('./routes/api-meta');
const licenseApiRoutes = require('./routes/api-license');
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
const licenseDegrade = require('./lib/license/degrade-middleware');

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
const securityApplyWorker = require('./security-apply-worker');
const securityApplyJobs = require('./lib/security-settings/apply-jobs');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// ─── Middleware ───

// Trust Nginx reverse proxy (needed for secure cookies behind TLS termination)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lightweight readiness endpoint for the Stage 5 updater and external monitors.
// No auth, no DB call — returns 200 as long as the Node process is alive.
// Mounted BEFORE session middleware so it stays cheap and never touches the
// session store. Required by Master Plan §5.13. For richer diagnostics
// (per-check status, DB freshness, etc.) the operator-facing endpoint is
// /api/health, which IS session-gated and DB-backed.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

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
app.use('/api/user-prefs', userPrefsApiRoutes);
app.use('/api/meta', metaApiRoutes);

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

    // Ensure users + operator_mute_periods exist before the first login
    // (Apr 28, 2026). Lazily ensured by usersStore.upsertUserOnLogin, but
    // explicit boot-time ensure surfaces schema errors loudly. Same fire-
    // and-forget posture as the drift heartbeat.
    usersStore.ensureSchema().catch(err =>
      console.error('[Server] users-store schema ensure failed at boot:', err.message)
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
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  polling.stop();
  driftScheduler.stop();
  intuneDriftScheduler.stop();
  morningBriefing.stop();
  auditExpiryScheduler.stop();
  ualWorker.stopLoop();
  securityApplyWorker.stop();
  licenseRefresh.stop();
  await db.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] SIGTERM received, shutting down...');
  polling.stop();
  driftScheduler.stop();
  intuneDriftScheduler.stop();
  morningBriefing.stop();
  auditExpiryScheduler.stop();
  ualWorker.stopLoop();
  securityApplyWorker.stop();
  licenseRefresh.stop();
  await db.close();
  server.close(() => process.exit(0));
});

start();
