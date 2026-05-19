/**
 * Panoptica365 — Reports API Routes
 * Security Posture PDF generation (Sonnet + Python/ReportLab)
 * and JSON data export for Custodia Menses integration.
 *
 * Rewritten May 7, 2026 to surface the full data picture: alerts, secure score,
 * Conditional Access policies, Security Settings drift state, Defender XDR
 * incidents, operator change log, MSP audit log, exemptions, activity volume.
 *
 * Model selection: REPORT_MODEL routes through a single config knob. Default is
 * Sonnet (rich analytical writing at ~5x lower cost than Opus). To swap to
 * Opus, set config.ai.reportModel or env REPORT_MODEL to the Opus model id.
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const config = require('../../config/default');
const tenantMode = require('../lib/tenant-mode');
const eventI18n = require('../lib/event-description-i18n');

const router = express.Router();
router.use(auth.requireAuth);

let aiClient = null;
function getAiClient() {
  if (!aiClient && config.ai.apiKey) {
    aiClient = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return aiClient;
}

// Single source of truth for the report-narrative model. Falls back to Sonnet.
// Swap to Opus by setting REPORT_MODEL env var (one-line change at runtime).
function getReportModel() {
  return process.env.REPORT_MODEL || config.ai.reportModel || config.ai.sonnetModel;
}

// ─── Temp directory for generated reports ───
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// ─── Range to SQL interval mapping ───
function rangeToInterval(range) {
  if (range === '7d') return '7 DAY';
  if (range === '90d') return '90 DAY';
  return '30 DAY'; // default
}

function rangeToLabel(range, lang) {
  const L = lang === 'fr' ? {
    '7d': 'Derniers 7 jours', '90d': 'Derniers 90 jours', _default: 'Derniers 30 jours',
  } : lang === 'es' ? {
    '7d': 'Últimos 7 días', '90d': 'Últimos 90 días', _default: 'Últimos 30 días',
  } : {
    '7d': 'Last 7 Days', '90d': 'Last 90 Days', _default: 'Last 30 Days',
  };
  return L[range] || L._default;
}

// ═══════════════════════════════════════════
// DATA GATHERING (shared by PDF and JSON)
// ═══════════════════════════════════════════

async function gatherReportData(tenantId, range) {
  const interval = rangeToInterval(range);
  const tenantIdInt = parseInt(tenantId, 10);

  // Timing helper — logs each section's wall time so a slow query is
  // immediately visible in pm2 logs. Without this, gatherReportData looks
  // like one big black box and we can't tell which query stalled.
  const t0 = Date.now();
  const tic = (label, since) => {
    const dt = Date.now() - since;
    console.log(`[Reports.gather] ${label} +${dt}ms (total ${Date.now() - t0}ms)`);
  };
  let tStep = Date.now();

  // Tenant info
  const tenant = await db.queryOne(
    'SELECT id, tenant_id, display_name, language, enabled, consented_at, last_polled_at FROM tenants WHERE id = ?',
    [tenantIdInt]
  );
  if (!tenant) throw new Error('Tenant not found');

  // i18n migration (May 2, 2026): ai_analysis was split into
  // ai_analysis_en/fr/es. Pick the tenant's language with English fallback.
  // Whitelist the lang token to prevent SQL injection through the column name.
  const lang = (tenant.language === 'fr' || tenant.language === 'es') ? tenant.language : 'en';
  const aiAnalysisExpr = `COALESCE(a.ai_analysis_${lang}, a.ai_analysis_en)`;

  // Alert summary by severity
  const alertsBySeverity = await db.queryRows(
    `SELECT severity, COUNT(*) AS cnt
     FROM alerts WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     GROUP BY severity`,
    [tenantIdInt]
  );

  // Alert summary by status
  const alertsByStatus = await db.queryRows(
    `SELECT status, COUNT(*) AS cnt
     FROM alerts WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     GROUP BY status`,
    [tenantIdInt]
  );

  // Alert summary by category
  const alertsByCategory = await db.queryRows(
    `SELECT p.category, COUNT(*) AS cnt
     FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     GROUP BY p.category ORDER BY cnt DESC`,
    [tenantIdInt]
  );

  // Top 15 most significant alerts (high/severe first, then by recurrence)
  const topAlerts = await db.queryRows(
    `SELECT a.severity, a.message, a.status, a.triggered_at, a.recurrence_count,
            ${aiAnalysisExpr} AS ai_analysis, p.name AS policy_name, p.category
     FROM alerts a
     JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     ORDER BY FIELD(a.severity, 'severe', 'high', 'medium', 'low', 'info'), a.recurrence_count DESC, a.triggered_at DESC
     LIMIT 15`,
    [tenantIdInt]
  );

  // All alerts for JSON export (full detail)
  const allAlerts = await db.queryRows(
    `SELECT a.id, a.severity, a.message, a.status, a.triggered_at, a.closed_at,
            a.recurrence_count, a.last_seen_at, ${aiAnalysisExpr} AS ai_analysis, a.dedup_key,
            p.name AS policy_name, p.category
     FROM alerts a
     JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     ORDER BY a.triggered_at DESC`,
    [tenantIdInt]
  );

  // Alert trend — daily counts for the period
  const alertTrend = await db.queryRows(
    `SELECT DATE(triggered_at) AS day, severity, COUNT(*) AS cnt
     FROM alerts
     WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
     GROUP BY day, severity
     ORDER BY day`,
    [tenantIdInt]
  );

  // Secure score (current — from Graph via existing endpoint logic)
  // We query metric_snapshots for the latest secure_score metric
  const secureScore = await db.queryOne(
    `SELECT metric_value, captured_at FROM metric_snapshots
     WHERE tenant_id = ? AND metric_name = 'secure_score'
     ORDER BY captured_at DESC LIMIT 1`,
    [tenantIdInt]
  );

  // Key metrics — latest snapshot for important security metrics
  const keyMetrics = await db.queryRows(
    `SELECT ms.service, ms.metric_name, ms.metric_value, ms.captured_at
     FROM metric_snapshots ms
     WHERE ms.tenant_id = ?
       AND ms.metric_name IN (
         'global_admins', 'admin_role_counts', 'mfa_not_registered_users',
         'mfa_registration_stats', 'conditional_access_policies',
         'user_count', 'licensed_user_count', 'guest_user_count',
         'mail_forwarding', 'inactive_users', 'risky_user_counts',
         'device_compliance_summary', 'os_distribution'
       )
       AND ms.captured_at = (
         SELECT MAX(ms2.captured_at) FROM metric_snapshots ms2
         WHERE ms2.tenant_id = ms.tenant_id AND ms2.metric_name = ms.metric_name
       )`,
    [tenantIdInt]
  );

  tic('alerts+metrics queries done', tStep); tStep = Date.now();
  // Parse metric values
  const metrics = {};
  for (const m of keyMetrics) {
    try {
      metrics[m.metric_name] = typeof m.metric_value === 'object' ? m.metric_value : JSON.parse(m.metric_value);
    } catch {
      metrics[m.metric_name] = m.metric_value;
    }
  }

  // Parse secure score
  let parsedSecureScore = null;
  if (secureScore) {
    try {
      parsedSecureScore = typeof secureScore.metric_value === 'object'
        ? secureScore.metric_value
        : JSON.parse(secureScore.metric_value);
      parsedSecureScore.captured_at = secureScore.captured_at;
    } catch {
      parsedSecureScore = null;
    }
  }

  // Secure score delta — earliest snapshot in the period for trend computation.
  // Plus the daily aggregated row immediately preceding the period start, so
  // we can compare "value at start of period" vs "value now".
  let secureScoreDelta = null;
  try {
    const earliestInPeriod = await db.queryOne(
      `SELECT metric_value, captured_at FROM metric_snapshots
       WHERE tenant_id = ?
         AND (metric_name = 'secure_score' OR metric_name = 'daily_agg_secure_score')
         AND captured_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       ORDER BY captured_at ASC LIMIT 1`,
      [tenantIdInt]
    );
    if (earliestInPeriod && parsedSecureScore) {
      const earlyParsed = typeof earliestInPeriod.metric_value === 'object'
        ? earliestInPeriod.metric_value
        : JSON.parse(earliestInPeriod.metric_value);
      const earlyPct = earlyParsed?.percentage ?? null;
      const nowPct = parsedSecureScore?.percentage ?? null;
      if (earlyPct !== null && nowPct !== null) {
        secureScoreDelta = {
          start_pct: parseFloat(earlyPct),
          end_pct: parseFloat(nowPct),
          delta_pct: parseFloat((nowPct - earlyPct).toFixed(2)),
          start_at: earliestInPeriod.captured_at,
        };
      }
    }
  } catch (e) {
    console.warn('[Reports] secure score delta calc failed:', e.message);
  }

  tic('secure score delta', tStep); tStep = Date.now();

  // ─── Security Settings posture ──────────────────────────────────────
  // Phase B settings live in tenant_security_config. Status enum:
  // not_applied | monitored | drift | pending | poll_error | unavailable.
  // We surface counts by status + a list of currently-drifting settings
  // with their priority + name so the narrative can flag risks.
  let securitySettings = { byStatus: {}, drifting: [], total: 0, recentEvents: [] };
  try {
    const cfgRows = await db.queryRows(
      `SELECT tsc.setting_id, tsc.status, tsc.last_checked_at,
              ss.name, ss.category, ss.priority
         FROM tenant_security_config tsc
         JOIN security_settings ss ON ss.setting_id = tsc.setting_id
        WHERE tsc.tenant_id = ?`,
      [tenantIdInt]
    );
    const byStatus = {};
    const drifting = [];
    for (const r of cfgRows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.status === 'drift') {
        drifting.push({
          setting_id: r.setting_id,
          name: r.name,
          category: r.category,
          priority: r.priority,
          last_checked_at: r.last_checked_at,
        });
      }
    }
    // Recent setting events during the period (drift_detected, remediated,
    // accepted, applied, matched). These are the operator-relevant transitions.
    const evRows = await db.queryRows(
      `SELECT sse.event_type, sse.setting_id, sse.operator_email, sse.created_at,
              ss.name, ss.priority
         FROM security_setting_events sse
         JOIN security_settings ss ON ss.setting_id = sse.setting_id
        WHERE sse.tenant_id = ?
          AND sse.created_at >= DATE_SUB(NOW(), INTERVAL ${interval})
          AND sse.event_type IN ('applied','matched','drift_detected','remediated','accepted')
        ORDER BY sse.created_at DESC LIMIT 30`,
      [tenantIdInt]
    );
    securitySettings = {
      total: cfgRows.length,
      byStatus,
      drifting,
      recentEvents: evRows.map(r => ({
        event_type: r.event_type,
        setting_id: r.setting_id,
        name: r.name,
        priority: r.priority,
        operator_email: r.operator_email,
        created_at: r.created_at,
      })),
    };
  } catch (e) {
    console.warn('[Reports] security settings posture failed:', e.message);
  }

  tic('security settings posture', tStep); tStep = Date.now();

  // ─── Defender XDR incidents (period only) ───────────────────────────
  let defenderIncidents = { total: 0, bySeverity: {}, byStatus: {}, top: [] };
  try {
    const incRows = await db.queryRows(
      `SELECT incident_id, display_name, severity, status, classification,
              alerts_count, incident_web_url, last_updated_at_utc, created_at_utc
         FROM defender_incidents
        WHERE tenant_id = ?
          AND last_updated_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${interval})
        ORDER BY FIELD(severity,'high','medium','low','informational'),
                 last_updated_at_utc DESC
        LIMIT 100`,
      [tenantIdInt]
    );
    const bySev = {};
    const byStat = {};
    for (const r of incRows) {
      const s = (r.severity || 'unknown').toLowerCase();
      bySev[s] = (bySev[s] || 0) + 1;
      const st = (r.status || 'unknown').toLowerCase();
      byStat[st] = (byStat[st] || 0) + 1;
    }
    defenderIncidents = {
      total: incRows.length,
      bySeverity: bySev,
      byStatus: byStat,
      top: incRows.slice(0, 10).map(r => ({
        incident_id: r.incident_id,
        display_name: r.display_name,
        severity: r.severity,
        status: r.status,
        classification: r.classification,
        alerts_count: r.alerts_count,
        last_updated_at_utc: r.last_updated_at_utc,
      })),
    };
  } catch (e) {
    // defender_incidents table may not exist on older deployments — degrade gracefully.
    console.warn('[Reports] defender incidents query failed:', e.message);
  }

  tic('defender incidents', tStep); tStep = Date.now();

  // ─── Operator change log (period only) ─────────────────────────────
  // Tenant Change Log — operator-facing record of every Match/Apply/Accept/
  // Remediate/CA-deploy/Intune-push action. Critical for explaining "what
  // happened" during the report period.
  let changeLog = { total: 0, byCategory: {}, recent: [] };
  try {
    const chRows = await db.queryRows(
      `SELECT id, source, category, affected_surface, started_at, impact,
              description, template_key, template_params, created_by
         FROM tenant_change_events
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND started_at >= DATE_SUB(NOW(), INTERVAL ${interval})
        ORDER BY started_at DESC LIMIT 50`,
      [tenantIdInt]
    );
    const byCat = {};
    for (const r of chRows) byCat[r.category] = (byCat[r.category] || 0) + 1;
    changeLog = {
      total: chRows.length,
      byCategory: byCat,
      recent: chRows.slice(0, 20).map(r => {
        let surface = r.affected_surface;
        if (typeof surface === 'string') {
          try { surface = JSON.parse(surface); } catch { /* keep string */ }
        }
        // Localize description to the tenant's language for the PDF.
        // Falls back to English if the row predates Phase 11 templating.
        const localizedDesc = eventI18n.renderDescription('tenant_change', r, lang);
        return {
          source: r.source,
          category: r.category,
          surface,
          started_at: r.started_at,
          impact: r.impact,
          description: localizedDesc,
          created_by: r.created_by,
        };
      }),
    };
  } catch (e) {
    console.warn('[Reports] change log query failed:', e.message);
  }

  tic('change log', tStep); tStep = Date.now();

  // ─── MSP audit (operator actions targeting this tenant) ─────────────
  // msp_audit_events has no tenant_id column — linkage is via
  // (target_type='tenant', target_id=<tenant pk as string>). The composite
  // index idx_target (target_type, target_id) makes this lookup fast.
  // Earlier rev had an OR with JSON_EXTRACT(metadata,'$.tenant_id') as a
  // fallback — that forced a full-table scan and stalled gatherReportData
  // on tenants with large msp_audit_events tables. Dropped: the canonical
  // linkage covers the operator activity we care about for the report.
  let mspAudit = { total: 0, byCategory: {}, recent: [] };
  try {
    const auditRows = await db.queryRows(
      `SELECT category, action, actor_email, target_type, target_name,
              description, template_key, template_params, success, created_at
         FROM msp_audit_events
        WHERE target_type = 'tenant'
          AND target_id = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL ${interval})
        ORDER BY created_at DESC LIMIT 50`,
      [String(tenantIdInt)]
    );
    const byCat = {};
    for (const r of auditRows) byCat[r.category] = (byCat[r.category] || 0) + 1;
    mspAudit = {
      total: auditRows.length,
      byCategory: byCat,
      recent: auditRows.slice(0, 15).map(r => ({
        category: r.category,
        action: r.action,
        actor_email: r.actor_email,
        target_type: r.target_type,
        target_name: r.target_name,
        description: eventI18n.renderDescription('msp_audit', r, lang),
        success: r.success === 1 || r.success === true,
        created_at: r.created_at,
      })),
    };
  } catch (e) {
    console.warn('[Reports] msp audit query failed:', e.message);
  }

  tic('msp audit', tStep); tStep = Date.now();

  // ─── Active alert exemptions ────────────────────────────────────────
  // Operator-defined rules that auto-resolve specific alert patterns. The
  // narrative should flag if exemptions are masking high-severity activity.
  let exemptions = { active: 0, list: [] };
  try {
    const exRows = await db.queryRows(
      `SELECT er.id, er.match_upn, er.match_country, er.match_ip_cidr, er.reason,
              er.expires_at, er.created_by, er.created_at, er.match_count, er.last_matched_at,
              p.name AS policy_name, p.category AS policy_category
         FROM alert_exemption_rules er
         JOIN alert_policies p ON p.id = er.policy_id
        WHERE er.tenant_id = ?
          AND er.revoked_at IS NULL
          AND er.expires_at > NOW()
        ORDER BY er.last_matched_at DESC, er.created_at DESC
        LIMIT 50`,
      [tenantIdInt]
    );
    exemptions = {
      active: exRows.length,
      list: exRows.slice(0, 20).map(r => ({
        policy_name: r.policy_name,
        policy_category: r.policy_category,
        match_upn: r.match_upn,
        match_country: r.match_country,
        match_ip_cidr: r.match_ip_cidr,
        reason: r.reason,
        expires_at: r.expires_at,
        created_by: r.created_by,
        match_count: r.match_count,
        last_matched_at: r.last_matched_at,
      })),
    };
  } catch (e) {
    console.warn('[Reports] exemptions query failed:', e.message);
  }

  tic('exemptions', tStep); tStep = Date.now();

  // ─── Activity volume (UAL + auth events) ────────────────────────────
  // daily_event_counts is the deduped per-tenant per-policy daily volume.
  // Used to surface activity spikes and overall busyness during the period.
  let activity = { totalEvents: 0, dailyTotals: [], topPolicies: [] };
  try {
    const dailyRows = await db.queryRows(
      `SELECT event_date, SUM(event_count) AS total
         FROM daily_event_counts
        WHERE tenant_id = ?
          AND event_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
        GROUP BY event_date ORDER BY event_date`,
      [tenantIdInt]
    );
    const topPolRows = await db.queryRows(
      `SELECT p.name AS policy_name, p.category, SUM(d.event_count) AS total
         FROM daily_event_counts d
         JOIN alert_policies p ON p.id = d.policy_id
        WHERE d.tenant_id = ?
          AND d.event_date >= DATE_SUB(CURDATE(), INTERVAL ${interval})
        GROUP BY p.name, p.category
        ORDER BY total DESC LIMIT 10`,
      [tenantIdInt]
    );
    let total = 0;
    for (const r of dailyRows) total += parseInt(r.total, 10) || 0;
    activity = {
      totalEvents: total,
      dailyTotals: dailyRows.map(r => ({ day: r.event_date, total: parseInt(r.total, 10) || 0 })),
      topPolicies: topPolRows.map(r => ({
        policy_name: r.policy_name,
        category: r.category,
        total: parseInt(r.total, 10) || 0,
      })),
    };
  } catch (e) {
    console.warn('[Reports] activity volume query failed:', e.message);
  }

  tic('activity volume', tStep);
  console.log(`[Reports.gather] DONE for tenant ${tenantIdInt} in ${Date.now() - t0}ms`);

  return {
    tenant: {
      display_name: tenant.display_name,
      azure_tenant_id: tenant.tenant_id,
      enabled: tenant.enabled,
      consented_at: tenant.consented_at,
      last_polled_at: tenant.last_polled_at,
    },
    language: tenant.language || 'en',
    range,
    rangeLabel: rangeToLabel(range, tenant.language || 'en'),
    generatedAt: new Date().toISOString(),
    secureScore: parsedSecureScore,
    alerts: {
      bySeverity: Object.fromEntries(alertsBySeverity.map(r => [r.severity, r.cnt])),
      byStatus: Object.fromEntries(alertsByStatus.map(r => [r.status, r.cnt])),
      byCategory: alertsByCategory.map(r => ({ category: r.category, count: r.cnt })),
      total: alertsBySeverity.reduce((sum, r) => sum + r.cnt, 0),
      topAlerts: topAlerts.map(a => ({
        severity: a.severity,
        message: a.message,
        status: a.status,
        triggered_at: a.triggered_at,
        recurrence_count: a.recurrence_count,
        ai_analysis: a.ai_analysis,
        policy_name: a.policy_name,
        category: a.category,
      })),
      trend: alertTrend.map(r => ({ day: r.day, severity: r.severity, count: r.cnt })),
    },
    allAlerts: allAlerts.map(a => ({
      id: a.id,
      severity: a.severity,
      message: a.message,
      status: a.status,
      triggered_at: a.triggered_at,
      closed_at: a.closed_at,
      recurrence_count: a.recurrence_count,
      last_seen_at: a.last_seen_at,
      ai_analysis: a.ai_analysis,
      dedup_key: a.dedup_key,
      policy_name: a.policy_name,
      category: a.category,
    })),
    metrics,
    secureScoreDelta,
    securitySettings,
    defenderIncidents,
    changeLog,
    mspAudit,
    exemptions,
    activity,
  };
}

// ═══════════════════════════════════════════
// CA POLICY GATHERING + GUID RESOLUTION
// ═══════════════════════════════════════════

// Well-known Microsoft application IDs → friendly names
const WELL_KNOWN_APPS = {
  '00000002-0000-0000-c000-000000000000': 'Azure Active Directory Graph',
  '00000003-0000-0000-c000-000000000000': 'Microsoft Graph',
  '00000002-0000-0ff1-ce00-000000000000': 'Office 365 Exchange Online',
  '00000003-0000-0ff1-ce00-000000000000': 'Office 365 SharePoint Online',
  '00000004-0000-0ff1-ce00-000000000000': 'Office 365 Skype for Business',
  '797f4846-ba00-4fd7-ba43-dac1f8f63013': 'Azure Service Management API',
  '04b07795-8ddb-461a-bbee-02f9e1bf7b46': 'Microsoft Azure CLI',
  'cb1056e2-e479-49de-ae31-7812af012ed8': 'Microsoft Azure PowerShell',
  '1950a258-227b-4e31-a9cf-717495945fc2': 'Microsoft Azure PowerShell',
  '0000000c-0000-0000-c000-000000000000': 'Microsoft App Access Panel',
  '89bee1f7-5e6e-4d8a-9f3d-ecd601259da7': 'Office 365 Management',
  'c44b4083-3bb0-49c1-b47d-974e53cbdf3c': 'Azure Portal',
  'cc15fd57-2c6c-4117-a88c-83b1d56b4bbe': 'Microsoft Teams Services',
  '1fec8e78-bce4-4aaf-ab1b-5451cc387264': 'Microsoft Teams',
  '5e3ce6c0-2b1f-4285-8d4b-75ee78787346': 'Microsoft Teams Web Client',
  '4765445b-32c6-49b0-83e6-1d93765276ca': 'Microsoft Intune',
  'd4ebce55-015a-49b5-a083-c84d1797ae8c': 'Microsoft Intune Enrollment',
  '0000000a-0000-0000-c000-000000000000': 'Microsoft Intune',
  'de8bc8b5-d9f9-48b1-a8ad-b748da725064': 'Microsoft 365 Defender',
  '00000006-0000-0ff1-ce00-000000000000': 'Microsoft Office 365 Portal',
  'Office365': 'All Microsoft 365 Apps',
  'MicrosoftAdminPortals': 'Microsoft Admin Portals',
  'All': 'All Cloud Applications',
  'None': 'None',
};

// Well-known Azure AD role template IDs → friendly names
const WELL_KNOWN_ROLES = {
  '62e90394-69f5-4237-9190-012177145e10': 'Global Administrator',
  'fe930be7-5e62-47db-91af-98c3a49a38b1': 'User Administrator',
  '29232cdf-9323-42fd-ade2-1d097af3e4de': 'Exchange Administrator',
  'f28a1f50-f6e7-4571-818b-6a12f2af6b6c': 'SharePoint Administrator',
  '194ae4cb-b126-40b2-bd5b-6091b380977d': 'Security Administrator',
  'e8611ab8-c189-46e8-94e1-60213ab1f814': 'Privileged Role Administrator',
  '729827e3-9c14-49f7-bb1b-9608f156bbb8': 'Helpdesk Administrator',
  'b0f54661-2d74-4c50-afa3-1ec803f12efe': 'Billing Administrator',
  '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3': 'Application Administrator',
  '158c047a-c907-4556-b7ef-446551a6b5f7': 'Cloud Application Administrator',
  '966707d0-3269-4727-9be2-8c3a10f19b9d': 'Password Administrator',
  'fdd7a751-b60b-444a-984c-02652fe8fa1c': 'Groups Administrator',
  '17315797-102d-40b4-93e0-432062caca18': 'Compliance Administrator',
  'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9': 'Conditional Access Administrator',
  'f2ef992c-3afb-46b9-b7cf-a126ee74c451': 'Global Reader',
  '5d6b6bb7-de71-4623-b4af-96380a352509': 'Security Reader',
  '790c1fb9-7f7d-4f88-86a1-ef1f95c05c1b': 'Authentication Administrator',
  '7698a772-787b-4ac8-901f-60d6b08affd2': 'Cloud Device Administrator',
  '9360feb5-f418-4baa-8175-e2a00bac4301': 'Directory Writers',
  '3a2c62db-5318-420d-8d74-23affee5d9d5': 'Intune Administrator',
  '4a5d8f65-41da-4de4-8968-e035b65339cf': 'Skype for Business Administrator',
  '69091246-20e8-4a56-aa4d-066075b2a7a8': 'Teams Administrator',
  'aaf43236-0c0d-4d5f-883a-6955382ac081': 'Identity Governance Administrator',
  '2b745bdf-0803-4d80-aa65-822c4493daac': 'Office Apps Administrator',
  '44367163-eba1-44c3-98af-f5787879f96a': 'Dynamics 365 Administrator',
  '11648597-926c-4cf3-9c36-bcebb0ba8dcc': 'Power Platform Administrator',
  'baf37b3a-610e-45da-9e62-d9d1e5e8914b': 'Teams Communications Administrator',
};

/**
 * Fetch CA policies from a tenant and resolve all GUIDs to human-readable names.
 * Returns an array of enriched policy objects.
 */
async function gatherCaPolicies(azureTenantId) {
  try {
    // Fetch policies, named locations, groups, and service principals in parallel
    const [policies, namedLocations, groups, servicePrincipals] = await Promise.all([
      graph.callGraphPaged(azureTenantId, '/identity/conditionalAccess/policies').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/identity/conditionalAccess/namedLocations?$select=id,displayName').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/groups?$select=id,displayName&$top=999').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/servicePrincipals?$select=appId,displayName&$top=999').catch(() => []),
    ]);

    if (!policies || policies.length === 0) return [];

    // Build lookup maps
    const locationMap = Object.fromEntries((namedLocations || []).map(l => [l.id, l.displayName]));
    const groupMap = Object.fromEntries((groups || []).map(g => [g.id, g.displayName]));
    const appMap = Object.fromEntries((servicePrincipals || []).map(sp => [sp.appId, sp.displayName]));

    // Resolve a GUID to a name
    function resolveUser(id) {
      if (id === 'All') return 'All Users';
      if (id === 'GuestsOrExternalUsers') return 'Guests / External Users';
      if (id === 'None') return 'None';
      return groupMap[id] || id; // groups and users share include/exclude arrays
    }

    function resolveApp(id) {
      return WELL_KNOWN_APPS[id] || appMap[id] || id;
    }

    function resolveRole(id) {
      return WELL_KNOWN_ROLES[id] || id;
    }

    function resolveLocation(id) {
      if (id === 'AllTrusted') return 'All Trusted Locations';
      if (id === 'All') return 'All Locations';
      return locationMap[id] || id;
    }

    // Enrich each policy
    return policies.map(p => {
      const c = p.conditions || {};
      const gc = p.grantControls || {};
      const sc = p.sessionControls || {};

      return {
        displayName: p.displayName,
        state: p.state, // enabled, disabled, enabledForReportingButNotEnforced
        createdDateTime: p.createdDateTime,
        modifiedDateTime: p.modifiedDateTime,
        // Resolved conditions
        users: {
          include: (c.users?.includeUsers || []).map(resolveUser),
          exclude: (c.users?.excludeUsers || []).map(resolveUser),
          includeGroups: (c.users?.includeGroups || []).map(resolveUser),
          excludeGroups: (c.users?.excludeGroups || []).map(resolveUser),
          includeRoles: (c.users?.includeRoles || []).map(resolveRole),
          excludeRoles: (c.users?.excludeRoles || []).map(resolveRole),
        },
        applications: {
          include: (c.applications?.includeApplications || []).map(resolveApp),
          exclude: (c.applications?.excludeApplications || []).map(resolveApp),
        },
        platforms: c.platforms ? {
          include: c.platforms.includePlatforms || [],
          exclude: c.platforms.excludePlatforms || [],
        } : null,
        locations: c.locations ? {
          include: (c.locations.includeLocations || []).map(resolveLocation),
          exclude: (c.locations.excludeLocations || []).map(resolveLocation),
        } : null,
        devices: c.devices?.deviceFilter ? {
          filterRule: c.devices.deviceFilter.rule || '',
          filterMode: c.devices.deviceFilter.mode || '',  // "include" or "exclude"
        } : null,
        clientAppTypes: c.clientAppTypes || [],
        signInRiskLevels: c.signInRiskLevels || [],
        userRiskLevels: c.userRiskLevels || [],
        servicePrincipalRiskLevels: c.servicePrincipalRiskLevels || [],
        // Grant controls
        grantControls: {
          operator: gc.operator || '',
          builtInControls: gc.builtInControls || [],
          customAuthenticationFactors: gc.customAuthenticationFactors || [],
          termsOfUse: gc.termsOfUse || [],
          authenticationStrength: gc.authenticationStrength?.displayName || null,
        },
        // Session controls
        sessionControls: {
          applicationEnforcedRestrictions: sc.applicationEnforcedRestrictions?.isEnabled || false,
          cloudAppSecurity: sc.cloudAppSecurity?.isEnabled || false,
          signInFrequency: sc.signInFrequency?.isEnabled ? `${sc.signInFrequency.value} ${sc.signInFrequency.type}` : null,
          persistentBrowser: sc.persistentBrowser?.isEnabled ? sc.persistentBrowser.mode : null,
          disableResilienceDefaults: sc.disableResilienceDefaults || false,
        },
      };
    });
  } catch (err) {
    console.error('[Reports] CA policy gathering failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════
// SONNET CA POLICY ANALYSIS
// ═══════════════════════════════════════════

async function generateCaAnalysis(caPolicies, tenantName, language) {
  const anthropic = getAiClient();
  if (!anthropic || caPolicies.length === 0) {
    return { policies: [], crossAnalysis: '' };
  }

  const lang = language || 'en';
  let langInstruction = '';
  if (lang === 'fr') {
    langInstruction = 'IMPORTANT: Write ALL content in French (Canadian French). JSON keys must stay in English, but all values must be in French.';
  } else if (lang === 'es') {
    langInstruction = 'IMPORTANT: Write ALL content in Spanish (neutral Latin American Spanish). JSON keys must stay in English, but all values must be in Spanish — proper accents, no English-token-swapped pseudo-Spanish.';
  }

  try {
    const policyData = JSON.stringify(caPolicies, null, 2);

    const response = await anthropic.messages.create({
      model: getReportModel(),
      max_tokens: 4000,
      system: `You are a Microsoft 365 security specialist analyzing Conditional Access policies for a non-technical business owner.
Your job is two-fold:

1. For EACH policy, write a clear 2-3 sentence summary in plain language explaining what the policy does, who it affects, and what it requires. Do not use technical jargon — imagine explaining to a small business owner. If the policy state is "enabledForReportingButNotEnforced", note it's in "report-only mode" (monitoring but not blocking).

2. After summarizing each policy, provide a CROSS-POLICY ANALYSIS: look for overlaps, gaps, conflicts, redundancies, or potential misconfigurations across the full set. Be specific — name the policies involved. Also identify any important protections that are MISSING (e.g., no policy blocking legacy authentication, no location-based restrictions, no sign-in risk policy, etc.).

${langInstruction}

Return a JSON object with exactly this structure:
{
  "policies": [
    { "name": "Policy Display Name", "summary": "Plain language summary..." },
    ...
  ],
  "cross_analysis": "2-4 paragraphs analyzing overlaps, gaps, conflicts, and missing protections across all policies."
}

Be honest and specific. If there are genuine risks, say so clearly. If the policies are well-configured, acknowledge that too.`,
      messages: [{
        role: 'user',
        content: `Analyze these Conditional Access policies for tenant "${tenantName}":\n\n${policyData}`,
      }],
    });

    const text = response.content?.[0]?.text || '';
    try {
      const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      return JSON.parse(cleaned);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { policies: [], crossAnalysis: text };
    }
  } catch (err) {
    console.error('[Reports] CA analysis (Sonnet) failed:', err.message);
    return { policies: [], cross_analysis: '' };
  }
}

// ═══════════════════════════════════════════
// JSON EXPORT (legacy — used by Custodia Menses integration)
// ═══════════════════════════════════════════

router.get('/json-export', async (req, res) => {
  try {
    const { tenant_id, range } = req.query;
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

    const data = await gatherReportData(tenant_id, range || '30d');

    // Set download headers
    const safeName = data.tenant.display_name.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${range || '30d'}_export.json"`);
    res.json(data);
  } catch (err) {
    console.error('[Reports] JSON export failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// DATA EXPORT (full snapshot bundle, streamed as ZIP)
// ═══════════════════════════════════════════
// Used by the Reports page "Data Export" option. Works for both managed and
// audit-only tenants; for audit-only the activity files (alerts, msp-audit
// events, change events) will be sparse or empty by design.
//
// Requires the `archiver` npm package — install with: npm install archiver --save

router.get('/data-export', async (req, res) => {
  const reqStart = Date.now();
  let archiver;
  try {
    archiver = require('archiver');
  } catch (e) {
    console.error('[Reports] data-export failed: archiver package not installed');
    return res.status(500).json({
      error: 'archiver_missing',
      message: 'The "archiver" npm package is required for ZIP export. Run: npm install archiver --save (then restart Panoptica).',
    });
  }

  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id is required' });
    console.log(`[Reports] data-export START tenant=${tenantId}`);

    const tenantSnapshot = require('../lib/tenant-snapshot');
    const { manifest, files } = await tenantSnapshot.collectTenant(tenantId);
    const readme = tenantSnapshot.buildReadme(manifest);
    console.log(`[Reports] data-export collect done tenant=${tenantId} (+${Date.now() - reqStart}ms)`);

    const safeName = (manifest.tenant.display_name || 'tenant')
      .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tenant';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `panoptica-snapshot-${safeName}-${ts}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('warning', err => {
      if (err.code !== 'ENOENT') console.warn('[Reports] archive warning:', err.message);
    });
    archive.on('error', err => {
      console.error('[Reports] archive error:', err.message);
      try { res.status(500).end(); } catch {}
    });
    archive.on('end', () => {
      console.log(`[Reports] data-export DONE tenant=${tenantId} ${zipName} (+${Date.now() - reqStart}ms, ${archive.pointer()} bytes)`);
    });

    archive.pipe(res);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(readme, { name: 'README.md' });
    for (const [path, content] of Object.entries(files)) {
      try {
        archive.append(JSON.stringify(content, null, 2), { name: path });
      } catch (e) {
        console.error(`[Reports] failed to serialize ${path}: ${e.message}`);
        archive.append(`{"error": "Failed to serialize: ${e.message.replace(/"/g, '\\"')}"}`, { name: path });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error(`[Reports] data-export FAILED (+${Date.now() - reqStart}ms):`, err.message);
    console.error(err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      try { res.end(); } catch {}
    }
  }
});

// Diagnostic — returns the manifest + counts as JSON without ZIPing or
// streaming. Use this to isolate whether a slow data-export is caused by
// data collection or by archive streaming.
router.get('/data-export-dryrun', async (req, res) => {
  const reqStart = Date.now();
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id is required' });
    const tenantSnapshot = require('../lib/tenant-snapshot');
    const { manifest, files } = await tenantSnapshot.collectTenant(tenantId);
    res.json({
      ok: true,
      elapsed_ms: Date.now() - reqStart,
      manifest,
      file_sizes_bytes: Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, JSON.stringify(v).length])
      ),
    });
  } catch (err) {
    console.error('[Reports] data-export-dryrun failed:', err.message);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ═══════════════════════════════════════════
// SECURITY POSTURE PDF (SSE streaming)
// ═══════════════════════════════════════════

// A3 (May 9, 2026): operator — report generation triggers AI spend + work.
router.post('/security-posture', auth.requireMemberOrAdmin, async (req, res) => {
  const { tenant_id, range } = req.body;
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

  // Audit-only contract gate: "No AI in audit flow." Security posture reports
  // are AI-generated narratives — not allowed for audit-only tenants. Use the
  // /data-export endpoint (snapshot bundler) instead — it produces the same
  // raw data without sending it to Claude.
  if (await tenantMode.isAuditOnly(tenant_id)) {
    return res.status(403).json({
      error: 'audit_only_tenant',
      message: 'AI-generated Security Posture reports are disabled for audit-only tenants. Use the Data Export (snapshot bundle) instead — it ships the raw policy + settings data without consuming Claude tokens.',
    });
  }

  // Set up SSE for real-time progress.
  // X-Accel-Buffering: no disables nginx response buffering for this stream.
  // Without it, nginx queues SSE chunks until the response ends and the
  // browser sees nothing during the long gatherReportData / Sonnet phases —
  // then connection drops at proxy_read_timeout (60s default) and the user
  // sees "network error" with the progress modal stuck on stage 1.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Heartbeat every 10s: SSE comment lines (lines starting with `:`) are
  // ignored by EventSource and fetch-based SSE readers but reset nginx's
  // proxy_read_timeout countdown and keep the browser connection alive.
  // Critical during gatherReportData (many SQL queries) and the AI Promise.all.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* socket gone */ }
  }, 10000);
  // Clean up if client disconnects mid-stream.
  req.on('close', () => clearInterval(heartbeat));

  try {
    // Stage 1: Gather data
    sendEvent({ stage: 'data' });
    const data = await gatherReportData(tenant_id, range || '30d');

    // Stage 2: Gather CA policies (parallel with charts)
    sendEvent({ stage: 'ca_policies' });
    const caPolicies = await gatherCaPolicies(data.tenant.azure_tenant_id);
    console.log(`[Reports] Fetched ${caPolicies.length} CA policies for ${data.tenant.display_name}`);

    // Stage 3: Charts (handled by Python script)
    sendEvent({ stage: 'charts' });

    // Stage 4: AI narrative + CA analysis from Sonnet (parallel)
    sendEvent({ stage: 'ai' });
    const [narrative, caAnalysis] = await Promise.all([
      generateNarrative(data),
      generateCaAnalysis(caPolicies, data.tenant.display_name, data.language),
    ]);

    // Stage 5: Assemble PDF
    sendEvent({ stage: 'pdf' });

    // Build the input JSON for the Python script
    const reportCfg = config.report || {};
    const pdfInput = {
      ...data,
      allAlerts: undefined, // Don't send full alert list to PDF (too much)
      narrative,
      caAnalysis,
      caPolicyCount: caPolicies.length,
      // Footer / branding config — drives the "Prepared by ___ via Panoptica365" line.
      // Eventually a Settings card will edit these values per MSP installation.
      reportConfig: {
        mspName: reportCfg.mspName || 'Trilogiam',
        platformAttribution: reportCfg.platformAttribution !== false,
      },
    };

    const pdfFilename = `${data.tenant.display_name.replace(/[^a-zA-Z0-9]/g, '_')}_Security_Posture_${range || '30d'}_${Date.now()}.pdf`;
    const pdfPath = path.join(REPORTS_DIR, pdfFilename);

    await runPdfGenerator(pdfInput, pdfPath);

    // Done — send download URL
    clearInterval(heartbeat);
    sendEvent({ done: true, url: `/api/reports/download/${encodeURIComponent(pdfFilename)}` });
    res.end();

  } catch (err) {
    console.error('[Reports] PDF generation failed:', err.message, err.stack);
    clearInterval(heartbeat);
    sendEvent({ error: err.message });
    res.end();
  }
});

// ─── Download generated report ───
router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  // Sanitize — only allow alphanumeric, underscore, hyphen, dot
  if (!/^[a-zA-Z0-9_\-. ]+\.(pdf|json)$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(REPORTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.download(filePath);
});

// ═══════════════════════════════════════════
// SONNET NARRATIVE GENERATION
// ═══════════════════════════════════════════

async function generateNarrative(data) {
  const anthropic = getAiClient();
  if (!anthropic) {
    return getDefaultNarrative(data);
  }

  // Build concise data summary for the model (not the full dump)
  const dataSummary = buildDataSummary(data);
  const lang = data.language || 'en';
  let langInstruction = '';
  if (lang === 'fr') {
    langInstruction = 'IMPORTANT: Write ALL narrative content in French (Canadian French). The JSON keys must stay in English, but all values must be in French. Use proper Quebec French spelling and accents.';
  } else if (lang === 'es') {
    langInstruction = 'IMPORTANT: Write ALL narrative content in Spanish (neutral Latin American Spanish). The JSON keys must stay in English, but all values must be in Spanish. Use proper Spanish spelling and accents — never English-token-swapped pseudo-Spanish.';
  }

  try {
    // License tier assumption — tenant-specific data not yet wired, so we
    // default to the platform-wide assumption (Business Premium for most MSP
    // customers). This drives the AI's licensing-gated recommendations.
    const licenseTier = (config.report && config.report.defaultLicenseTier) || 'Microsoft 365 Business Premium';

    const response = await anthropic.messages.create({
      model: getReportModel(),
      max_tokens: 4000,
      system: `You are a cybersecurity analyst writing a Security Posture Report for a small business client.

Your audience is a non-technical business owner. Write in clear, accessible language — avoid jargon (or define it inline the first time you use a term). Be narrative, not bullet-heavy. Think of it as a trusted advisor explaining their security situation in person.

This report covers ALL operational data for the period: alerts, Microsoft Secure Score, Conditional Access policies, the tenant's Security Settings posture (which protections are matched vs drifting), Microsoft Defender XDR incidents, the operator change log (every Match/Apply/Accept/Remediate action your MSP took, plus any operator-added manual notes), the MSP audit log, active alert exemptions, and overall activity volume.

═══ MANDATORY RULES ═══

1. NEVER reference internal setting IDs (EXO-09, ENT-05, SPO-01, TEA-01, CMP-02, etc.) in the narrative text. Use the human-readable setting NAME only ("Restrict External Forwarding", "Microsoft Authenticator Default", etc.). The IDs exist for the operator audit trail, not the customer.

2. LICENSE TIER ASSUMPTION: This tenant is licensed at "${licenseTier}". You MUST respect license boundaries when recommending protections. Specifically, the following require Microsoft Entra ID P2 (NOT included in Business Basic, Standard, or Business Premium — only in Microsoft 365 E5, E5 Security, or as a paid add-on):
   - Sign-in risk policies (Conditional Access using user.signInRiskLevel)
   - User risk policies (Conditional Access using user.userRiskLevel)
   - Privileged Identity Management (PIM)
   - Identity Governance (entitlement management, access reviews automation, lifecycle workflows)
   - Risk-based detection workflow with full reporting
   If the tenant is at Business Premium and you want to recommend any of the above, you must EITHER (a) mention the license upgrade as part of the recommendation, OR (b) recommend an alternative that works at the current tier. Do NOT silently recommend P2-only features as if they were available.

3. EXEMPTIONS — if there are active alert exemption rules, you MUST mention them somewhere in the narrative (security_highlights, exemption_analysis, or recommendations). Customers should know what alerts are being auto-resolved on their behalf and why. Exemptions are a managed risk, not a free pass — say so. Reference the exemption reason text when surfacing them.

4. CHANGE LOG SOURCES — the change log includes both source='panoptica' (automated platform writes) AND source='manual' (operator-added context entries the MSP typed in by hand). Manual entries are explanatory: they describe what the MSP did outside the platform that may explain a posture change. When manual entries exist for the period, use them as context to explain WHY things happened.

═══ CORRELATION GUIDANCE ═══

Your job is to CORRELATE across these data sources, not just summarize each one. Specifically:
- When alerts fire and operator actions follow, connect them ("After the May-2 sign-in alert, the MSP remediated the External Forwarding setting and the issue stopped recurring").
- When Security Settings drift, call it out as a real risk — these are the protections the customer pays for, and drift means they're partially defenseless.
- When exemptions are masking a lot of alerts (high match_count), surface that.
- When Defender XDR incidents and Panoptica alerts overlap on the same user, mention it (cross-tool confirmation is more credible).
- When the secure score moves, attribute the change to specific actions if the data supports it (CA deploy, Intune push, settings remediation).

Be honest. If posture improved, say so. If there's a real concern, name it without softening. Don't catastrophize.

${langInstruction}

You must return a JSON object with these exact keys:
{
  "executive_summary": "3 paragraphs. Open with a one-line verdict (e.g., 'Posture improved this period, with one item to watch.'). Then summarize the period: alert volume + severity, secure score and its movement, Security Settings posture (matched vs drift count, USE NAMES NOT IDS), Defender XDR incident count, and operator activity. End with the single most important takeaway.",
  "security_highlights": "2-3 paragraphs on the period's most significant patterns. Cross-correlate alerts with operator actions, exemption matches, and settings drift. If a specific user, IP, country, or app keeps appearing across multiple alerts, surface that pattern explicitly.",
  "alert_analysis": "2-3 paragraphs analyzing alert categories, recurrence, and resolution. Which alerts repeat? Which were closed by operator action vs auto-resolved by exemption? Which ones still need attention?",
  "secure_score_analysis": "1-2 paragraphs. Current score, trend over the period (use the start_pct → end_pct delta if provided), and what the major drivers are.",
  "settings_posture_analysis": "1-2 paragraphs on the Security Settings posture: how many settings are matched, how many drifting, and which drifts are highest-priority. Reference specific setting NAMES (never IDs).",
  "operator_activity_analysis": "1-2 paragraphs on what the MSP team did during the period — CA deploys, Intune pushes, settings work, exemption rules created. Use BOTH automated (source=panoptica) and manual (source=manual) entries from the change log to tell the full story.",
  "defender_incidents_analysis": "1 paragraph if there are Defender XDR incidents during the period. If zero incidents, say so concisely (one sentence) — that's a positive signal. Connect to Panoptica alerts where they overlap.",
  "exemption_analysis": "1 paragraph if there are active exemption rules. Name each exemption (policy name + UPN/country/IP filter), the operator's reason, and the match count over the period. Be neutral — exemptions are normal in a managed environment, but the customer should know they exist. If no active exemptions, output an empty string for this key.",
  "recommendations": "2-3 paragraphs of prioritized, actionable recommendations. Tie each one to a specific data point (drifting setting NAME, recurring alert pattern, missing CA policy, exemption due to expire). Respect the licensing boundary stated above. No generic 'enable MFA' filler — be specific."
}

Keep the total output under 2400 words. Be specific. Use real numbers from the data. Setting NAMES not IDs. Respect licensing.`,
      messages: [{
        role: 'user',
        content: `Generate the security posture report narrative for this tenant data:\n\n${dataSummary}`,
      }],
    });

    const text = response.content?.[0]?.text || '';
    // Try to parse as JSON
    try {
      // Handle case where Sonnet wraps in ```json
      const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      return JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Last resort — return as executive summary
      return { executive_summary: text, security_highlights: '', alert_analysis: '', secure_score_analysis: '', recommendations: '' };
    }
  } catch (err) {
    console.error('[Reports] Sonnet narrative failed:', err.message);
    return getDefaultNarrative(data);
  }
}

function buildDataSummary(data) {
  let s = '';
  s += `TENANT: ${data.tenant.display_name}\n`;
  s += `REPORT PERIOD: ${data.rangeLabel}\n`;
  s += `GENERATED: ${data.generatedAt}\n\n`;

  // ── Secure Score (current + delta over period) ──
  if (data.secureScore) {
    s += `SECURE SCORE: ${data.secureScore.percentage || data.secureScore.currentScore || 'N/A'}%`;
    if (data.secureScore.maxScore) s += ` (${data.secureScore.currentScore}/${data.secureScore.maxScore})`;
    s += '\n';
    if (data.secureScoreDelta) {
      const sign = data.secureScoreDelta.delta_pct >= 0 ? '+' : '';
      s += `  Period delta: ${data.secureScoreDelta.start_pct}% → ${data.secureScoreDelta.end_pct}% (${sign}${data.secureScoreDelta.delta_pct} pts)\n`;
    }
    // Industry comparison if present
    const cmp = data.secureScore.averageComparativeScores || [];
    const seats = cmp.find(c => c.basis === 'TotalSeats');
    if (seats?.averageScore != null) {
      s += `  Similar-size tenant average: ${seats.averageScore}%\n`;
    }
    s += '\n';
  }

  // ── Alerts ──
  s += `ALERTS (${data.rangeLabel}):\n`;
  s += `  Total: ${data.alerts.total}\n`;
  const sevMap = { severe: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
  for (const [sev, label] of Object.entries(sevMap)) {
    const cnt = data.alerts.bySeverity[sev] || 0;
    if (cnt > 0) s += `  ${label}: ${cnt}\n`;
  }
  s += 'BY STATUS:\n';
  for (const [status, cnt] of Object.entries(data.alerts.byStatus)) {
    s += `  ${status}: ${cnt}\n`;
  }
  if (data.alerts.byCategory.length > 0) {
    s += 'BY CATEGORY:\n';
    for (const c of data.alerts.byCategory) s += `  ${c.category}: ${c.count}\n`;
  }
  s += '\n';

  // ── Top alerts ──
  if (data.alerts.topAlerts.length > 0) {
    s += 'TOP INCIDENTS:\n';
    for (const a of data.alerts.topAlerts.slice(0, 12)) {
      s += `  [${(a.severity || '').toUpperCase()}] ${a.policy_name || ''} — ${a.message}`;
      if (a.recurrence_count > 1) s += ` (occurred ${a.recurrence_count}x)`;
      s += ` — ${a.status}, ${(a.triggered_at || '').toString().slice(0, 16)}\n`;
      if (a.ai_analysis) {
        const analysis = typeof a.ai_analysis === 'string' ? a.ai_analysis : JSON.stringify(a.ai_analysis);
        s += `    AI: ${analysis.substring(0, 220).replace(/\s+/g, ' ')}\n`;
      }
    }
    s += '\n';
  }

  // ── Security Settings posture ──
  const ss = data.securitySettings || {};
  if (ss.total) {
    s += `SECURITY SETTINGS (${ss.total} total tracked):\n`;
    for (const [status, cnt] of Object.entries(ss.byStatus || {})) {
      s += `  ${status}: ${cnt}\n`;
    }
    if ((ss.drifting || []).length > 0) {
      s += 'CURRENTLY DRIFTING (use the NAME in narrative, never the ID):\n';
      for (const d of ss.drifting) {
        s += `  [${d.priority}] name="${d.name}" (${d.category}) [internal_id=${d.setting_id}]\n`;
      }
    }
    if ((ss.recentEvents || []).length > 0) {
      s += `RECENT SETTING EVENTS (period, top 15 — use names, not IDs):\n`;
      for (const e of ss.recentEvents.slice(0, 15)) {
        s += `  ${(e.created_at || '').toString().slice(0, 16)} ${e.event_type} name="${e.name}"`;
        if (e.operator_email) s += ` by ${e.operator_email}`;
        s += '\n';
      }
    }
    s += '\n';
  }

  // ── Defender XDR incidents ──
  const di = data.defenderIncidents || {};
  if (di.total != null) {
    s += `DEFENDER XDR INCIDENTS (period): ${di.total}\n`;
    if (di.total > 0) {
      for (const [sev, cnt] of Object.entries(di.bySeverity || {})) s += `  severity=${sev}: ${cnt}\n`;
      for (const [st, cnt] of Object.entries(di.byStatus || {})) s += `  status=${st}: ${cnt}\n`;
      for (const inc of (di.top || []).slice(0, 8)) {
        s += `  [${inc.severity}/${inc.status}] ${inc.display_name || inc.incident_id} (${inc.alerts_count} alerts) — ${(inc.last_updated_at_utc || '').toString().slice(0, 16)}\n`;
      }
    }
    s += '\n';
  }

  // ── Operator Change Log (this tenant) ──
  const cl = data.changeLog || {};
  if (cl.total != null) {
    s += `OPERATOR CHANGE LOG (period): ${cl.total} events\n`;
    if (cl.total > 0) {
      for (const [cat, cnt] of Object.entries(cl.byCategory || {})) s += `  ${cat}: ${cnt}\n`;
      for (const ev of (cl.recent || []).slice(0, 12)) {
        const surface = Array.isArray(ev.surface) ? ev.surface.join(',') : (ev.surface || '');
        s += `  ${(ev.started_at || '').toString().slice(0, 16)} [${ev.category}] (${surface}) impact=${ev.impact} src=${ev.source}`;
        if (ev.created_by) s += ` by=${ev.created_by}`;
        if (ev.description) s += ` — ${ev.description.slice(0, 120)}`;
        s += '\n';
      }
    }
    s += '\n';
  }

  // ── MSP audit (operator activity in Panoptica re: this tenant) ──
  const ma = data.mspAudit || {};
  if (ma.total) {
    s += `MSP OPERATOR AUDIT (period): ${ma.total} events\n`;
    for (const [cat, cnt] of Object.entries(ma.byCategory || {})) s += `  ${cat}: ${cnt}\n`;
    for (const r of (ma.recent || []).slice(0, 8)) {
      s += `  ${(r.created_at || '').toString().slice(0, 16)} [${r.category}] ${r.action}`;
      if (r.actor_email) s += ` by=${r.actor_email}`;
      if (!r.success) s += ' (FAILED)';
      if (r.description) s += ` — ${(r.description || '').slice(0, 100)}`;
      s += '\n';
    }
    s += '\n';
  }

  // ── Active exemptions ──
  const ex = data.exemptions || {};
  if (ex.active) {
    s += `ACTIVE ALERT EXEMPTIONS: ${ex.active}\n`;
    for (const r of (ex.list || []).slice(0, 10)) {
      s += `  ${r.policy_name} — upn=${r.match_upn || '*'}`;
      if (r.match_country) s += ` country=${r.match_country}`;
      if (r.match_ip_cidr) s += ` ip=${r.match_ip_cidr}`;
      s += ` matches=${r.match_count}`;
      if (r.reason) s += ` reason="${(r.reason || '').slice(0, 80)}"`;
      s += '\n';
    }
    s += '\n';
  }

  // ── Activity volume ──
  const act = data.activity || {};
  if (act.totalEvents) {
    s += `ACTIVITY VOLUME (period): ${act.totalEvents} total events across all alert policies\n`;
    if ((act.topPolicies || []).length > 0) {
      s += 'TOP POLICIES BY VOLUME:\n';
      for (const p of act.topPolicies.slice(0, 8)) {
        s += `  ${p.policy_name} (${p.category}): ${p.total}\n`;
      }
    }
    s += '\n';
  }

  // ── Key metrics (existing — admins, MFA, users, devices, etc.) ──
  if (Object.keys(data.metrics || {}).length > 0) {
    s += 'KEY METRICS:\n';
    for (const [name, value] of Object.entries(data.metrics)) {
      const valStr = typeof value === 'object' ? JSON.stringify(value).substring(0, 350) : String(value);
      s += `  ${name}: ${valStr}\n`;
    }
  }

  return s;
}

function getDefaultNarrative(data) {
  const ss = data.securitySettings || {};
  const di = data.defenderIncidents || {};
  const cl = data.changeLog || {};
  const ex = data.exemptions || {};
  return {
    executive_summary: `This Security Posture Report covers the ${data.rangeLabel.toLowerCase()} for ${data.tenant.display_name}. During this period, ${data.alerts.total} alerts were detected. ${ss.total ? `${ss.byStatus?.monitored || 0} of ${ss.total} security settings are matched; ${ss.byStatus?.drift || 0} are drifting.` : ''} ${di.total ? `${di.total} Defender XDR incidents were observed.` : ''} The narrative generator was unavailable — review the data sections in this report for the full picture.`,
    security_highlights: 'AI narrative generation was unavailable. Review the alert and incident detail tables for security highlights.',
    alert_analysis: `A total of ${data.alerts.total} alerts were recorded. Review the severity distribution chart and the Notable Incidents table for details.`,
    secure_score_analysis: data.secureScore ? `Your current Secure Score is ${data.secureScore.percentage || 'N/A'}%.${data.secureScoreDelta ? ` It moved ${data.secureScoreDelta.delta_pct >= 0 ? '+' : ''}${data.secureScoreDelta.delta_pct} points during the period.` : ''}` : 'Secure Score data was not available at report generation time.',
    settings_posture_analysis: ss.total ? `Of ${ss.total} tracked security settings, ${ss.byStatus?.monitored || 0} are matched and ${ss.byStatus?.drift || 0} are drifting.` : 'Security settings tracking data is not yet available for this tenant.',
    operator_activity_analysis: cl.total ? `${cl.total} operator change events were recorded for this tenant during the period.` : 'No operator change events were recorded during the period.',
    defender_incidents_analysis: di.total ? `${di.total} Microsoft Defender XDR incidents were observed during this period. See the incidents table for detail.` : 'No Microsoft Defender XDR incidents were observed during this period.',
    exemption_analysis: ex.active ? `${ex.active} active alert exemption rule(s) are currently configured for this tenant. Each rule auto-resolves a specific alert pattern based on operator-defined criteria. Review the Active Alert Exemptions table for details.` : '',
    recommendations: `Review drifting security settings (${ss.byStatus?.drift || 0} currently drifting), confirm that active exemptions (${ex.active || 0}) remain justified, and follow up on any unresolved alerts in the Notable Incidents table.`,
  };
}

// ═══════════════════════════════════════════
// PYTHON PDF GENERATOR
// ═══════════════════════════════════════════

function runPdfGenerator(inputData, outputPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-pdf-report.py');
    const inputPath = outputPath.replace('.pdf', '.json');

    // Write input data to temp JSON
    fs.writeFileSync(inputPath, JSON.stringify(inputData, null, 2));

    // Use venv Python if available, else fall back to system python3
    // Try multiple possible venv locations
    const projectRoot = path.join(__dirname, '..', '..');
    const venvCandidates = [
      path.join(projectRoot, 'venv', 'bin', 'python'),
    ];
    let pythonBin = 'python3';
    for (const candidate of venvCandidates) {
      if (fs.existsSync(candidate)) {
        pythonBin = candidate;
        break;
      }
    }
    console.log(`[Reports] Using Python: ${pythonBin}`);

    const proc = spawn(pythonBin, [scriptPath, inputPath, outputPath], {
      cwd: path.join(__dirname, '..', '..'),
      timeout: 120000, // 2 minute timeout
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.stdout.on('data', (chunk) => { console.log('[PDF-Gen]', chunk.toString().trim()); });

    proc.on('close', (code) => {
      // Clean up input JSON
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }

      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`PDF generation failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      reject(new Error(`Failed to spawn PDF generator: ${err.message}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTATION REPORT (Wave 1 — May 8, 2026)
// ═══════════════════════════════════════════════════════════════════════
//
// Point-in-time snapshot of a tenant's full configuration. No date range —
// always reflects "right now". Mirrors the Tenant Dashboard cards + every
// expandable section into PDF, plus Panoptica-specific data (security
// settings state, exemptions, recent change log).
//
// No AI. Pure data assembly. Volume IS the deliverable — stored as a
// permanent record for the MSP (IT-Glue alternative) and shareable with
// the customer. Persisted in `documentation_snapshots` so future runs can
// compute "what changed since [last_snapshot_date]" (Wave 3).
//
// Wave 1 scope: all DB-sourced data (everything that lands in metric_snapshots
// + Phase B security settings + active exemptions + 90d change log + CA
// policies fetched live via Graph). Wave 2 adds tenant-native Intune
// policies, DNS records, full Defender for O365 / SharePoint settings.
// Wave 3 adds diff rendering against the prior snapshot.

/**
 * Pull every "latest snapshot" metric for a tenant. Same query as
 * /api/tenants/:id/data — extracted here so the documentation route can
 * reuse it without a recursive HTTP call.
 */
async function fetchLatestServiceData(tenantIdInt) {
  const snapshots = await db.queryRows(
    `SELECT ms.service, ms.metric_name, ms.metric_value, ms.captured_at
       FROM metric_snapshots ms
       INNER JOIN (
         SELECT service, metric_name, MAX(captured_at) AS max_captured
           FROM metric_snapshots
          WHERE tenant_id = ? AND metric_name NOT LIKE 'daily_agg_%'
          GROUP BY service, metric_name
       ) latest
         ON ms.service = latest.service
        AND ms.metric_name = latest.metric_name
        AND ms.captured_at = latest.max_captured
      WHERE ms.tenant_id = ?
        AND ms.metric_name NOT LIKE 'daily_agg_%'`,
    [tenantIdInt, tenantIdInt]
  );
  const services = {};
  let lastCaptured = null;
  for (const snap of snapshots) {
    if (!services[snap.service]) services[snap.service] = {};
    try {
      services[snap.service][snap.metric_name] = typeof snap.metric_value === 'object'
        ? snap.metric_value
        : JSON.parse(snap.metric_value);
    } catch {
      services[snap.service][snap.metric_name] = snap.metric_value;
    }
    if (!lastCaptured || snap.captured_at > lastCaptured) lastCaptured = snap.captured_at;
  }
  return { captured_at: lastCaptured, services };
}

/**
 * Pull the full Phase B security settings posture for a tenant.
 * Returns one row per setting with current state + drift info.
 */
async function fetchSecuritySettingsState(tenantIdInt) {
  return db.queryRows(
    `SELECT tsc.setting_id, tsc.status, tsc.applied_value, tsc.current_value,
            tsc.applied_at, tsc.applied_by, tsc.last_checked_at,
            ss.name, ss.category, ss.priority, ss.description, ss.security_impact
       FROM tenant_security_config tsc
       JOIN security_settings ss ON ss.setting_id = tsc.setting_id
      WHERE tsc.tenant_id = ?
      ORDER BY FIELD(ss.priority,'critical','high','medium','low'), ss.category, tsc.setting_id`,
    [tenantIdInt]
  );
}

/**
 * Active alert exemption rules for a tenant.
 */
async function fetchActiveExemptions(tenantIdInt) {
  return db.queryRows(
    `SELECT er.id, er.match_upn, er.match_country, er.match_ip_cidr,
            er.reason, er.expires_at, er.created_by, er.created_at,
            er.match_count, er.last_matched_at,
            p.name AS policy_name, p.category AS policy_category
       FROM alert_exemption_rules er
       JOIN alert_policies p ON p.id = er.policy_id
      WHERE er.tenant_id = ? AND er.revoked_at IS NULL AND er.expires_at > NOW()
      ORDER BY er.last_matched_at DESC, er.created_at DESC`,
    [tenantIdInt]
  );
}

/**
 * 90-day change-log roll-up for the tenant.
 */
async function fetchRecentChanges(tenantIdInt, lang) {
  const rows = await db.queryRows(
    `SELECT id, source, category, affected_surface, started_at, impact,
            description, template_key, template_params, created_by
       FROM tenant_change_events
      WHERE tenant_id = ? AND deleted_at IS NULL
        AND started_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      ORDER BY started_at DESC LIMIT 200`,
    [tenantIdInt]
  );
  for (const r of rows) {
    if (typeof r.affected_surface === 'string') {
      try { r.affected_surface = JSON.parse(r.affected_surface); } catch { /* keep */ }
    }
    r.description = eventI18n.renderDescription('tenant_change', r, lang);
  }
  return rows;
}

/**
 * Generate plain-language per-policy summaries for the Documentation report.
 * Single Haiku call with all CA policies in one prompt — returns JSON
 * { policies: [{ name, summary }] } where summary is 2-3 sentences explaining
 * what the policy enforces in business-owner language. Localized to `lang`.
 *
 * Falls back to an empty array on any error — the PDF section degrades to
 * showing the raw policy data without narrative summaries.
 */
async function generateCaPolicySummariesForDocs(caPolicies, lang) {
  if (!Array.isArray(caPolicies) || caPolicies.length === 0) return [];
  const anthropic = getAiClient();
  if (!anthropic) return [];

  let langInstruction = '';
  if (lang === 'fr') {
    langInstruction = 'IMPORTANT: Write ALL summary text in French (Canadian French). JSON keys stay in English; only the "summary" values are in French. Use proper Quebec French spelling and accents — no English-token-swapped pseudo-French.';
  } else if (lang === 'es') {
    langInstruction = 'IMPORTANT: Write ALL summary text in Spanish (neutral Latin American Spanish). JSON keys stay in English; only the "summary" values are in Spanish.';
  }

  try {
    const policyData = JSON.stringify(caPolicies, null, 2);
    const response = await anthropic.messages.create({
      model: config.ai.haikuModel,
      max_tokens: 4000,
      system: `You are a Microsoft 365 security specialist. For each Conditional Access policy in the list, write a concise 2-3 sentence plain-language summary explaining: (1) what the policy enforces, (2) who it applies to, and (3) what action it takes. Audience is a non-technical small-business owner — avoid jargon, define terms inline if necessary.

Tone: matter-of-fact, no marketing fluff, no emojis, no headers within summaries. Write each summary as a single coherent paragraph.

If a policy is in "report-only" mode (state=enabledForReportingButNotEnforced), explicitly note "this policy is currently in report-only mode — Microsoft logs what it would have blocked but doesn't actually block sign-ins."

If a policy is disabled, note that and explain that the configured rules are NOT currently enforced.

${langInstruction}

Return ONLY a JSON object with this exact structure:
{
  "policies": [
    { "name": "Exact Policy Name From Input", "summary": "Plain-language summary..." },
    ...
  ]
}

Match the "name" field exactly to the displayName in the input — the consumer joins on it.`,
      messages: [{
        role: 'user',
        content: `Generate per-policy summaries for these Conditional Access policies:\n\n${policyData}`,
      }],
    });
    const text = response.content?.[0]?.text || '';
    const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else return [];
    }
    return Array.isArray(parsed?.policies) ? parsed.policies : [];
  } catch (err) {
    console.error('[Reports] Doc CA summaries (Haiku) failed:', err.message);
    return [];
  }
}

/**
 * Currently-enabled alert policies (with toggle state).
 */
async function fetchAlertPolicyState() {
  return db.queryRows(
    `SELECT id, name, category, severity, enabled
       FROM alert_policies
      WHERE hidden_from_ui = 0
      ORDER BY category, FIELD(severity,'severe','high','medium','low','info'), name`
  );
}

/**
 * Master gather function for the Documentation report. Pulls everything
 * the dashboard would show plus Panoptica-specific data. Returns a single
 * JSON-serializable object passed to the Python PDF generator.
 */
async function gatherDocumentationData(tenantId) {
  const tenantIdInt = parseInt(tenantId, 10);

  const tenant = await db.queryOne(
    `SELECT id, tenant_id, display_name, language, enabled, mode, consented_at,
            last_polled_at, polling_interval, poll_count
       FROM tenants WHERE id = ?`,
    [tenantIdInt]
  );
  if (!tenant) throw new Error('Tenant not found');

  const lang = (tenant.language === 'fr' || tenant.language === 'es') ? tenant.language : 'en';

  // Run independent queries in parallel for speed.
  const [
    serviceData,
    securitySettings,
    exemptions,
    recentChanges,
    alertPolicies,
    caPolicies,
  ] = await Promise.all([
    fetchLatestServiceData(tenantIdInt),
    fetchSecuritySettingsState(tenantIdInt),
    fetchActiveExemptions(tenantIdInt),
    fetchRecentChanges(tenantIdInt, lang),
    fetchAlertPolicyState(),
    gatherCaPolicies(tenant.tenant_id).catch(() => []),  // existing Graph fetcher
  ]);

  // Per-policy plain-language summaries from Haiku. Sequential so it doesn't
  // block the rest of the gather; degrades to [] on any error.
  const caPolicySummaries = await generateCaPolicySummariesForDocs(caPolicies, lang);

  return {
    tenant: {
      id: tenant.id,
      display_name: tenant.display_name,
      azure_tenant_id: tenant.tenant_id,
      enabled: !!tenant.enabled,
      mode: tenant.mode,
      consented_at: tenant.consented_at,
      last_polled_at: tenant.last_polled_at,
      polling_interval: tenant.polling_interval,
      poll_count: tenant.poll_count,
    },
    language: lang,
    generatedAt: new Date().toISOString(),
    capturedAt: serviceData.captured_at,
    services: serviceData.services,
    securitySettings,
    exemptions,
    recentChanges,
    alertPolicies,
    caPolicies,
    caPolicySummaries,
  };
}

/**
 * POST /api/reports/documentation
 *
 * SSE-streamed point-in-time configuration snapshot. No body params required —
 * tenant_id only. Always operates on "current state" (no date range).
 */
// A3 (May 9, 2026): operator — documentation report generation.
router.post('/documentation', auth.requireMemberOrAdmin, async (req, res) => {
  const { tenant_id } = req.body;
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

  // Audit-only mode: still allowed (no AI involved). The Documentation report
  // is pure data formatting, so it doesn't violate the no-AI contract.
  // (Security Posture is gated; this one isn't.)

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  function sendEvent(d) { res.write(`data: ${JSON.stringify(d)}\n\n`); }
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* socket gone */ }
  }, 10000);
  req.on('close', () => clearInterval(heartbeat));

  try {
    sendEvent({ stage: 'data' });
    const data = await gatherDocumentationData(tenant_id);

    // Look up the previous snapshot so the PDF can render diff headers in Wave 3.
    sendEvent({ stage: 'previous' });
    const previous = await db.queryOne(
      `SELECT id, generated_at, summary_json
         FROM documentation_snapshots
        WHERE tenant_id = ?
        ORDER BY generated_at DESC LIMIT 1`,
      [data.tenant.id]
    ).catch(() => null);

    sendEvent({ stage: 'pdf' });
    const pdfFilename = `${data.tenant.display_name.replace(/[^a-zA-Z0-9]/g, '_')}_Documentation_${Date.now()}.pdf`;
    const pdfPath = path.join(REPORTS_DIR, pdfFilename);

    const pdfInput = {
      ...data,
      previous_snapshot: previous ? {
        generated_at: previous.generated_at,
        summary: (() => {
          try { return JSON.parse(previous.summary_json || '{}'); } catch { return {}; }
        })(),
      } : null,
      reportConfig: {
        mspName: (config.report && config.report.mspName) || 'Trilogiam',
        platformAttribution: (config.report && config.report.platformAttribution) !== false,
      },
    };

    await runDocumentationPdfGenerator(pdfInput, pdfPath);

    // Persist the snapshot. Wave 3 will diff against this.
    sendEvent({ stage: 'store' });
    try {
      const summaryJson = JSON.stringify(buildSummarySlice(data));
      await db.insert(
        `INSERT INTO documentation_snapshots
           (tenant_id, generated_by, language, snapshot_json, summary_json, pdf_filename)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          data.tenant.id,
          req.session?.user?.email || null,
          data.language,
          JSON.stringify(data),
          summaryJson,
          pdfFilename,
        ]
      );
    } catch (storeErr) {
      // Non-fatal — the PDF is already generated; we just lose the diff baseline.
      console.error('[Reports] Documentation snapshot store failed (non-fatal):', storeErr.message);
    }

    clearInterval(heartbeat);
    sendEvent({ done: true, url: `/api/reports/download/${encodeURIComponent(pdfFilename)}` });
    res.end();
  } catch (err) {
    console.error('[Reports] Documentation generation failed:', err.message, err.stack);
    clearInterval(heartbeat);
    sendEvent({ error: err.message });
    res.end();
  }
});

/**
 * Compact slice of the gathered data for diffing. We don't want to parse a
 * potentially-multi-megabyte JSON to compute "what changed" — this slice
 * holds the counts + identifiers that drive the diff narrative.
 */
function buildSummarySlice(data) {
  const svc = data.services || {};
  const sec = svc.security || {};
  const entra = svc.entra || {};
  const sp = svc.sharepoint || {};
  const ex = svc.exchange || {};
  const teams = svc.teams || {};
  return {
    captured_at: data.capturedAt,
    user_total: entra.user_summary?.total ?? null,
    user_licensed: entra.user_summary?.licensed ?? null,
    user_guests: entra.user_summary?.guests ?? null,
    global_admin_count: sec.global_admins?.count ?? null,
    ca_policy_count: Array.isArray(sec.conditional_access) ? sec.conditional_access.length : null,
    ca_policy_names: Array.isArray(sec.conditional_access)
      ? sec.conditional_access.map(p => p.name).sort() : [],
    secure_score_pct: sec.secure_score?.percentage ?? null,
    mfa_pct: sec.mfa_status?.registration_percentage ?? null,
    security_settings_drift: (data.securitySettings || []).filter(s => s.status === 'drift').length,
    security_settings_total: (data.securitySettings || []).length,
    exemption_count: (data.exemptions || []).length,
    license_skus: (entra.licenses || []).map(l => l.displayName).sort(),
    domain_names: (sp.domains || []).map(d => d.name).sort(),
    teams_count: teams.teams_counts?.total ?? null,
    site_count: sp.sharepoint_counts?.total_sites ?? null,
    mailbox_count: ex.mailbox_counts?.total ?? null,
  };
}

/**
 * Run the Python Documentation PDF generator. Same pattern as
 * runPdfGenerator (Security Posture) — separate script per report type
 * since the layouts and section logic differ substantially.
 */
function runDocumentationPdfGenerator(inputData, outputPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-documentation-report.py');
    const inputPath = outputPath.replace('.pdf', '.json');
    fs.writeFileSync(inputPath, JSON.stringify(inputData));

    const projectRoot = path.join(__dirname, '..', '..');
    const venvCandidates = [
      path.join(projectRoot, 'venv', 'bin', 'python'),
    ];
    let pythonBin = 'python3';
    for (const candidate of venvCandidates) {
      if (fs.existsSync(candidate)) { pythonBin = candidate; break; }
    }

    const proc = spawn(pythonBin, [scriptPath, inputPath, outputPath], {
      cwd: projectRoot,
      timeout: 180000,  // 3 min — bigger report than Security Posture
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.stdout.on('data', (chunk) => { console.log('[Doc-Gen]', chunk.toString().trim()); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`Documentation PDF generation failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => {
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      reject(new Error(`Failed to spawn Documentation PDF generator: ${err.message}`));
    });
  });
}

module.exports = router;
