/**
 * Panoptica — Default Configuration
 * All values that can be overridden by .env or runtime settings.
 */

// May 20, 2026 — single-source timezone for the whole app. Default Eastern
// preserves the MSP datetime-comparison contract documented in
// feedback_mysql_utc_timestamp.md. Override via TZ env var.
const TIMEZONE = process.env.TZ || 'America/Toronto';

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
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
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

  session: {
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },

  // Polling tiers (minutes)
  polling: {
    critical: 5,
    medium: 15,
    low: 30,
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
