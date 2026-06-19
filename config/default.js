/**
 * Panoptica — Default Configuration
 * All values that can be overridden by .env or runtime settings.
 */

// May 20, 2026 — single-source timezone for the whole app. Default Eastern
// preserves the MSP datetime-comparison contract documented in
// feedback_mysql_utc_timestamp.md. Override via TZ env var.
const TIMEZONE = process.env.TZ || 'America/Toronto';

// Retention windows honor an explicit 0 ("keep forever"); any missing or
// invalid value falls back to the recommended default.
function retentionDays(envName, def) {
  const n = parseInt(process.env[envName], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

module.exports = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  // May 20, 2026 — cross-cutting values referenced by multiple modules.
  // `timezone` is consumed by the notifier email timestamp, the briefing
  // cron, and the api-settings test email. `baseUrl` is the public-facing
  // URL used for "View in Dashboard" links inside outbound emails — empty
  // when unset, in which case email-emitting modules omit the link rather
  // than emit a broken URL.
  timezone: TIMEZONE,
  baseUrl: process.env.PANOPTICA_BASE_URL || '',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME || 'panoptica',
    user: process.env.DB_USER || 'panoptica',
    password: process.env.DB_PASS || '',
    connectionLimit: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
    waitForConnections: true,
    // Reliability P0 (2026-06-12): finite queue. Under a DB stall, requests
    // beyond this fail fast ("Queue limit reached.") instead of queueing
    // forever — memory stays bounded and recovery avoids a thundering herd.
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10) || 200,
  },

  // Data retention windows (days) enforced by src/retention-worker.js daily
  // at 03:30 (Reliability P0, 2026-06-12). 0 = keep forever (retention off
  // for that table). retentionDays() honors an explicit 0 — a plain
  // `parseInt(...) || default` would silently turn 0 into the default.
  // Editable in Settings → Data retention (api-settings PUT /retention
  // writes the RETENTION_* vars and live-reloads this block). The `alerts`
  // table is deliberately NOT governed — alerts are cross-referenced
  // (identity timeline, exemption drawers, PSA links) and their retention
  // needs its own design.
  retention: {
    days: {
      defender_incidents:         retentionDays('RETENTION_DEFENDER_INCIDENTS_DAYS', 395),
      identity_timeline_analysis: retentionDays('RETENTION_IDENTITY_TIMELINE_DAYS', 90),
      heatmap_posture_daily:      retentionDays('RETENTION_HEATMAP_DAYS', 730),
      message_center_items:       retentionDays('RETENTION_MESSAGE_CENTER_DAYS', 365),
      msp_audit_events:           retentionDays('RETENTION_MSP_AUDIT_DAYS', 730),
      tenant_change_events:       retentionDays('RETENTION_TENANT_CHANGES_DAYS', 730),
      // Raw Unified Audit Log events — by far the largest table (1.8M+ rows).
      // Microsoft Purview holds the authoritative long-term copy, so a 90-day
      // working window covers detection + the identity timeline; trends survive
      // in daily_event_counts. Left unbounded before 2026-06-16 (grew forever).
      ual_events:                 retentionDays('RETENTION_UAL_EVENTS_DAYS', 90),
    },
    // metric_snapshots: full raw poll history is kept rawDays whole days
    // (the snapshot-delta alert engine only needs the previous poll); beyond
    // that one daily_agg_secure_score row per tenant per day survives for
    // aggDays so the Posture Report's score-trend works over any period.
    // rawDays has no keep-forever option — unbounded raw history is the
    // 20 GB-in-2-months failure mode this exists to prevent.
    metricSnapshots: {
      rawDays: parseInt(process.env.RETENTION_METRIC_RAW_DAYS, 10) || 7,
      aggDays: retentionDays('RETENTION_METRIC_AGG_DAYS', 730),
    },
  },

  // Entra ID — app authentication (user login to Panoptica UI)
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    // May 20, 2026 — MSP-agnostic. Each MSP install must set these explicitly
    // in .env (they depend on the install's public hostname). Empty default
    // means a missing .env value surfaces as an obvious problem at first
    // login attempt rather than silently redirecting to a stranger's domain.
    redirectUri: process.env.ENTRA_REDIRECT_URI || '',
    adminConsentRedirectUri: process.env.ENTRA_ADMIN_CONSENT_REDIRECT_URI || '',
    // Apr 28, 2026 — delegated OAuth flow for operator-interactive Teams admin
    // writes (TEA-01, TEA-02). Required because Microsoft Teams admin Set-Cs*
    // cmdlets don't honor cert-based app-only SP auth on customer tenants via
    // GDAP — verified May 2 2026. Operator authenticates via this URI; their
    // delegated token is used for the cmdlet call.
    teamsDelegatedRedirectUri: process.env.ENTRA_TEAMS_DELEGATED_REDIRECT_URI || '',
    // Entra group ID that grants access to Panoptica UI (legacy — admin-only model).
    // Kept as fallback so existing deployments keep working.
    authorizedGroupId: process.env.ENTRA_AUTHORIZED_GROUP_ID || '',
    // Three-tier RBAC group IDs (Access Control card in Settings).
    // adminGroupId falls back to authorizedGroupId if unset.
    adminGroupId:  process.env.ENTRA_ADMIN_GROUP_ID  || process.env.ENTRA_AUTHORIZED_GROUP_ID || '',
    memberGroupId: process.env.ENTRA_MEMBER_GROUP_ID || '',
    viewerGroupId: process.env.ENTRA_VIEWER_GROUP_ID || '',
    authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
    // Multi-tenant authority for admin consent flow (customer tenant onboarding)
    multiTenantAuthority: 'https://login.microsoftonline.com/common',
  },

  // Outbound HTTP (Reliability P0, 2026-06-12). Total deadline applied by
  // src/lib/http-timeout.js fetchWithTimeout() to every outbound request —
  // covers headers AND body read, so a TCP stall can never hang a worker
  // loop. Per-call overrides exist where slow is legitimate (UAL blob
  // downloads use 300s in src/lib/management-api.js).
  http: {
    timeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS, 10) || 120000,
  },

  // Graph API — same client_id/secret as entra (single multi-tenant app)
  graph: {
    baseUrl: 'https://graph.microsoft.com/v1.0',
    betaUrl: 'https://graph.microsoft.com/beta',
    scopes: ['https://graph.microsoft.com/.default'],
    retryAttempts: 3,
    retryDelayMs: 1000,
    rateLimitBackoffMs: 5000,
  },

  // PowerShell Core — for EXO/SPO/Teams app-only auth (Phase A2+)
  // The runner refuses to operate if certPath/certThumbprint are missing,
  // surfacing a clear "PowerShell runner not configured" error rather than
  // failing in spawn() with an opaque message.
  pwsh: {
    binary:           process.env.PWSH_BINARY || '/usr/bin/pwsh',
    certPath:         process.env.GRAPH_CERT_PATH || '',
    certThumbprint:   process.env.GRAPH_CERT_THUMBPRINT || '',
    appId:            process.env.ENTRA_CLIENT_ID || '',  // reuses Panoptica's existing app reg
    // Wizard-driven cert provisioning (cert-provisioner.js). certDir is the
    // writable mounted directory the wizard generates the keypair into; it
    // defaults to the dirname of GRAPH_CERT_PATH so the .key/.crt/.cer/
    // .thumbprint siblings land next to the .pfx the runner loads. certDays
    // is the self-signed lifetime — long by design (5y) to minimize MSP
    // rotation friction; rotation is a deferred cert-management card.
    certDir:          process.env.GRAPH_CERT_PATH
                        ? require('path').dirname(process.env.GRAPH_CERT_PATH)
                        : '/app/certs',
    certDays:         parseInt(process.env.PANOPTICA_CERT_DAYS, 10) || 1825,
    invocationTimeoutMs: parseInt(process.env.PWSH_TIMEOUT_MS, 10) || 30000,
    // IPPSSession (Security & Compliance) connection URI. Worldwide tenants
    // use the default below. Sovereign-cloud / GCC tenants need a different
    // URI: GCC High = "https://ps.compliance.protection.office365.us/...",
    // DoD = its own. Empty string means let Connect-IPPSSession pick (it
    // detects from the tenant). Override via PWSH_IPPS_URI in .env.
    ippsConnectionUri: process.env.PWSH_IPPS_URI || '',
  },

  // Claude AI
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    haikuModel: 'claude-haiku-4-5-20251001',
    sonnetModel: 'claude-sonnet-4-6',
    // Opus tier — used by the Quick Assessment report (deep gap analysis).
    // Generic knob so other features can reach for Opus later. Override the
    // exact model id via OPUS_MODEL in .env.
    opusModel: process.env.OPUS_MODEL || 'claude-opus-4-8',
    // Reports use sonnetModel by default. Set REPORT_MODEL env to override
    // (e.g., 'claude-opus-4-6' for Opus tier). Single knob, no other call sites
    // affected.
    reportModel: process.env.REPORT_MODEL || null,
    // Feature 8.7 Identity Threat Correlation uses Sonnet by default (deeper
    // cross-source correlation + calmer escalation than Haiku). Override the
    // exact model id via IDENTITY_TIMELINE_MODEL; falls back to sonnetModel.
    identityTimelineModel: process.env.IDENTITY_TIMELINE_MODEL || null,
    maxTokens: 2048,
    // When true (default), Haiku's per-alert analysis can downgrade severity
    // (e.g. SEVERE → INFO for a 50097 device-auth interrupt that Microsoft's
    // own additionalDetails field labels "not an error"). Only downgrades are
    // ever applied; upgrades are logged. Set AI_CAN_ADJUST_SEVERITY=false to
    // disable (Haiku still runs and proposes, but severity stays at rule-based).
    canAdjustSeverity: process.env.AI_CAN_ADJUST_SEVERITY !== 'false',
    // Tenant-level digest cache TTL (ms). 15 min default.
    tenantDigestCacheMs: parseInt(process.env.AI_TENANT_DIGEST_CACHE_MS, 10) || (15 * 60 * 1000),
    // Reliability 1.9 (2026-06-12): daily token fuse for the AUTOMATED AI
    // enrichment paths (per-alert analysis, summaries, correlations).
    // Honors an explicit 0 = unlimited. 5M tokens/day is far above normal
    // operation (a busy 15-tenant day uses well under 1M) — this trips on
    // runaway loops, not legitimate load. Enforced by src/lib/ai-guard.js.
    dailyTokenBudget: (() => {
      const n = parseInt(process.env.AI_DAILY_TOKEN_BUDGET, 10);
      return Number.isFinite(n) && n >= 0 ? n : 5000000;
    })(),
  },

  // SMTP (SMTP2GO)
  smtp: {
    host: process.env.SMTP_HOST || 'mail.smtp2go.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 2525,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    // May 20, 2026 — MSP-agnostic. Each MSP install sets this from their own
    // SMTP-validated sending address. Empty default means missing .env value
    // surfaces as a clear error when the first email send fails — better than
    // silently appearing to send from a stranger's domain.
    from: process.env.SMTP_FROM || '',
  },

  // Notification routing
  notification: {
    psaEmail: process.env.PSA_EMAIL || '',
    psaAttribution: process.env.PSA_ATTRIBUTION || '//${PSA_NAME}//',
    notifyEmails: process.env.NOTIFY_EMAILS || '',
  },

  // PSA bi-directional integration (Feature 8.3, 2026-06-06).
  // provider '' / 'none' = OFF (default) — alerts keep using the email-to-ticket
  // path via notification.psaEmail. 'autotask' = native REST API tickets for
  // mapped tenants. All values live-reloaded by api-settings.reloadPsaConfig().
  // ticketConfig is parsed from AUTOTASK_TICKET_CONFIG (single-line JSON in
  // .env); see psa/index.js for its shape. Defaults to an empty object so a
  // half-configured install never throws on config.psa.ticketConfig.queueId.
  psa: {
    provider: (process.env.PSA_PROVIDER || '').toLowerCase(),
    pollIntervalMin: parseInt(process.env.PSA_POLL_INTERVAL_MIN, 10) || 10,
    ticketLanguage: (process.env.PSA_TICKET_LANGUAGE || 'en').toLowerCase(),
    defaultCompanyId: process.env.PSA_DEFAULT_COMPANY_ID
      ? Number(process.env.PSA_DEFAULT_COMPANY_ID) : null,
    autotask: {
      username:        process.env.AUTOTASK_USERNAME || '',
      secret:          process.env.AUTOTASK_SECRET || '',
      integrationCode: process.env.AUTOTASK_INTEGRATION_CODE || '',
      zoneUrl:         process.env.AUTOTASK_ZONE_URL || '',
    },
    ticketConfig: (() => {
      try { return JSON.parse(process.env.AUTOTASK_TICKET_CONFIG || '{}'); }
      catch { return {}; }
    })(),
  },

  session: {
    // ensureSessionSecret() (src/lib/session-secret.js), called at boot in
    // server.js BEFORE this module loads, guarantees a strong SESSION_SECRET is
    // present on process.env — generated + persisted if it was missing/weak. No
    // hardcoded default here on purpose: a "doormat" secret must never be possible.
    secret: process.env.SESSION_SECRET || '',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },

  // Polling tiers (minutes)
  polling: {
    critical: 5,
    medium: 15,
    low: 30,
  },

  // Access Review tab (A1). inactivityThresholdDays drives the "inactive" flag
  // on the all-user roster — an account whose newest M365 usage-report activity
  // is older than this is flagged. 90 d default (the usage report's own D90
  // window; raise toward 180 and the reader switches to the D180 report).
  // Override via ACCESS_REVIEW_INACTIVITY_DAYS in .env.
  accessReview: {
    inactivityThresholdDays: parseInt(process.env.ACCESS_REVIEW_INACTIVITY_DAYS, 10) || 90,
    // Break-glass governance: hard safety gate. Excluding a group from every CA
    // policy exempts all its members — so a break-glass group with more than this
    // many members triggers a confirm-with-acknowledgement (server-enforced). A
    // real emergency-access group holds ~1–3 accounts. Override via env.
    breakGlassMaxGroupMembers: parseInt(process.env.BREAK_GLASS_MAX_GROUP_MEMBERS, 10) || 5,
  },

  // Microsoft Message Center feed (Feature 8.8)
  // sourceTenant holds the Azure tenant GUID the daily worker pulls the
  // Message Center from. Empty/unset = None / disabled (the default — no
  // pull, no alerts). Changeable at any time via the Settings card; the
  // settings route rewrites MESSAGE_CENTER_SOURCE_TENANT and reloads this.
  messageCenter: {
    sourceTenant: process.env.MESSAGE_CENTER_SOURCE_TENANT || '',
  },

  // Morning Briefing
  briefing: {
    enabled: true,
    cronSchedule: '0 6 * * *', // Daily 6:00 AM (7 days/week — also serves as system heartbeat)
    timezone: TIMEZONE,
    // May 13, 2026 — minimum severity threshold for the daily summary email.
    // Alerts below this threshold (and alerts auto-resolved by alert-exemption
    // rules) are still ingested and visible in the dashboard — they're just
    // omitted from the briefing email body and counted in the filter summary
    // footer instead. Valid values: 'info' | 'low' | 'medium' | 'high' | 'severe'.
    // Default 'info' preserves prior behavior; MSPs with many tenants typically
    // dial up to 'medium' or 'high' to cut info/low noise from the morning email.
    minSeverity: (process.env.BRIEFING_MIN_SEVERITY || 'info').toLowerCase(),
  },

  // Mid-month export for Custodia Menses
  monthlyExport: {
    enabled: true,
    dayOfMonth: 15,
    outputDir: process.env.EXPORT_DIR || '/opt/panoptica/exports',
  },

  // Reports — customer-facing PDFs
  // mspName drives the "Prepared by ___" line in the footer. Eventually a
  // Settings card will write to this same key so customers can rebrand.
  // platformAttribution toggles the "via Panoptica365" tail string —
  // operators can disable it for white-label usage.
  report: {
    // May 20, 2026 — MSP-agnostic. Empty default lets the Python PDF
    // generator's own fallback ('Panoptica365') kick in, which is the
    // correct brand-neutral label when no MSP_NAME is set.
    mspName: process.env.MSP_NAME || '',
    platformAttribution: process.env.REPORT_PLATFORM_ATTRIBUTION !== 'false',
    // Default tenant licensing assumption fed to the AI narrative when no
    // tenant-specific licensing data is available. Most Panoptica customers
    // are Business Premium; sign-in risk / user risk / PIM all need P2.
    defaultLicenseTier: process.env.DEFAULT_LICENSE_TIER || 'Microsoft 365 Business Premium',
  },
};
