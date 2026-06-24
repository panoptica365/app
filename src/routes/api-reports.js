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
const { createAiClient } = require('../lib/ai-client');
const aiGuard = require('../lib/ai-guard');
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const config = require('../../config/default');
const tenantMode = require('../lib/tenant-mode');
const eventI18n = require('../lib/event-description-i18n');
// v0.2.9 — report enrichment sources (identity hygiene, break-glass, app risk).
const accessReviewStore = require('../lib/access-review-store');
const breakGlassGraph = require('../lib/break-glass-graph');
const knownGoodStore = require('../lib/known-good-store');
// v0.2.24 report polish — email-auth posture (Item 7) + localized alert titles (Item 4).
const emailAuthStore = require('../lib/email-auth-store');
const emailAuthWorker = require('../email-auth-worker');
const notifier = require('../notifier');

const router = express.Router();
router.use(auth.requireAuth);

let aiClient = null;
function getAiClient() {
  if (!aiClient && config.ai.apiKey) {
    aiClient = createAiClient(config.ai.apiKey, { timeoutMs: 600000 }); // Opus deep reports are long by nature
  }
  return aiClient;
}

// Single source of truth for the report-narrative model. Falls back to Sonnet.
// Swap to Opus by setting REPORT_MODEL env var (one-line change at runtime).
function getReportModel() {
  return process.env.REPORT_MODEL || config.ai.reportModel || config.ai.sonnetModel;
}

// Generous output ceiling for report narratives. The old 4000 cap truncated
// long, data-heavy tenants — especially in French/Spanish, which are wordier
// and tokenize worse (accented chars cost extra tokens). A truncated response
// has no closing brace, so JSON parsing fails and the caller is forced into a
// fallback. 8000 covers the worst realistic 11-section narrative with headroom.
const REPORT_NARRATIVE_MAX_TOKENS = 8000;

// Robustly extract a JSON object from a model response. Returns the parsed
// object, or null if it cannot be parsed — it NEVER returns raw model text, so
// a fenced ```json wrapper or escaped \n sequences can never leak into a
// customer-facing report field. Callers fall back to clean, data-driven prose
// when this returns null.
function parseAiJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip a leading ```json / ``` fence and a trailing ``` fence, anywhere
  // leading whitespace precedes them (the old anchor required zero whitespace).
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through to brace extraction */ }
  // Greedy first-brace-to-last-brace extraction handles prose wrapped around a
  // complete object. A TRUNCATED response has no closing brace, so this also
  // (correctly) fails rather than half-parsing a partial narrative.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* not recoverable */ }
  }
  return null;
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

// ─── Report enrichment (v0.2.9) ───
// Shared, read-only assembly of the identity-hygiene, break-glass, and
// application-risk signals that all three reports surface. Pulls from the same
// stores the live UI uses (no re-implemented queries). Every source is wrapped
// so a single failure degrades that section gracefully instead of failing the
// whole report. Returns a plain object that is fed BOTH to the AI summaries
// and (verbatim) to the Python PDF generators.
//   tenantDbId    — tenants.id (INT) — for the DB-backed stores
//   azureTenantId — tenants.tenant_id (GUID) — for the live break-glass Graph call

// Permission-name helpers — render standard Graph permission names.
function permNamesFromTokens(tokens) {
  // baseline_perms tokens look like  del|<resourceAppId>|<scope>  /  app|...|<role>
  // /  req|...|<value>  /  cred|<keyId>  /  uri|<uri>. Only the first three are
  // permissions; the name is the last segment.
  const out = new Set();
  for (const tok of tokens || []) {
    const parts = String(tok).split('|');
    if (['del', 'app', 'req'].includes(parts[0]) && parts[2]) out.add(parts[2]);
  }
  return Array.from(out).sort();
}
function permNamesFromApp(app) {
  const out = new Set();
  for (const p of app.delegatedPermissions || []) if (p.scope) out.add(p.scope);
  for (const p of app.applicationPermissions || []) if (p.role) out.add(p.role);
  for (const p of app.requiredResourceAccess || []) if (p.value) out.add(p.value);
  return Array.from(out).sort();
}

async function gatherReportEnrichment(tenantDbId, azureTenantId) {
  const tid = parseInt(tenantDbId, 10);
  const enrichment = {
    identity: { available: false },
    breakGlass: { configured: false },
    apps: { available: false, knownGood: [], others: [] },
    emailAuth: { available: false },
  };

  // ── Identity hygiene — privileged roles + inactive accounts ──
  try {
    const snap = await accessReviewStore.readSnapshot(tid);
    if (snap) {
      const users = Array.isArray(snap.users) ? snap.users : [];
      const priv = (snap.privileged_roles && Array.isArray(snap.privileged_roles.accounts))
        ? snap.privileged_roles.accounts : [];
      // lastActivity for an admin is joined from the user roster, keyed by UPN/id.
      const key = (r) => String(r.userPrincipalName || r.upn || r.id || '').toLowerCase();
      const activityByKey = new Map(users.map(u => [key(u), u.lastActivity || null]));
      const thresholdDays = Number.isFinite(snap.inactivity_days) && snap.inactivity_days > 0
        ? snap.inactivity_days
        : ((config.accessReview && config.accessReview.inactivityThresholdDays) || 90);
      // Item 8: build the inactive roster once, then split members vs guests.
      const inactiveAll = users.filter(u => u.inactive).map(u => ({
        account: u.displayName || u.userPrincipalName || '',
        upn: u.userPrincipalName || '',
        type: u.type === 'guest' ? 'guest' : 'member',
        lastActivity: u.lastActivity || null,
        neverRedeemed: !!u.neverRedeemed,
      }));
      enrichment.identity = {
        available: true,
        captured_at: snap.captured_at || null,
        reports_anonymized: !!snap.reports_anonymized,
        threshold_days: thresholdDays,
        summary: {
          total: (snap.summary && snap.summary.total) ?? users.length,
          inactive: (snap.summary && snap.summary.inactive) ?? inactiveAll.length,
          ga_count: (snap.privileged_roles && snap.privileged_roles.ga_count) ?? (snap.summary && snap.summary.ga_count) ?? null,
          no_mfa_admins: (snap.privileged_roles && snap.privileged_roles.no_mfa_count) ?? (snap.summary && snap.summary.no_mfa_admins) ?? null,
          admin_total: priv.length,
          // Item 8: total guest accounts (for the "M of N guests inactive" note).
          guest_total: (snap.summary && snap.summary.guest_total) ?? users.filter(u => u.type === 'guest').length,
        },
        admins: priv.map(a => ({
          account: a.displayName || a.userPrincipalName || '',
          upn: a.userPrincipalName || '',
          roles: (a.roles || []).map(r => r.name),
          enabled: a.enabled !== false,
          mfa: a.mfaRegistered === true ? 'yes' : (a.mfaRegistered === false ? 'no' : 'unknown'),
          lastActivity: activityByKey.get(key(a)) || null,
          breakGlass: !!a.breakGlass,
        })),
        // Item 8: separate inactive members from inactive external/guest accounts.
        inactive_members: inactiveAll.filter(u => u.type !== 'guest'),
        inactive_guests: inactiveAll.filter(u => u.type === 'guest'),
      };
    }
  } catch (err) {
    console.warn('[Reports.enrich] identity snapshot unavailable (non-fatal):', err.message);
  }

  // ── Break-glass — DB config/designations + live group membership ──
  try {
    const cfg = await accessReviewStore.getGroupConfig(tid);
    const designations = await accessReviewStore.listBreakGlass(tid).catch(() => []);
    if (cfg && cfg.group_id) {
      enrichment.breakGlass = {
        configured: true,
        group_id: cfg.group_id,
        group_name: cfg.group_name || null,
        designations: (designations || []).map(d => ({
          account: d.display_name || d.user_principal_name || '',
          upn: d.user_principal_name || '',
        })),
        members_available: false,
        members: [],
      };
      // Live Graph call — best-effort. On failure keep the group identity but
      // mark members unavailable rather than failing the whole report.
      try {
        const inspected = await breakGlassGraph.inspectGroup(azureTenantId, cfg.group_id);
        enrichment.breakGlass.members_available = true;
        enrichment.breakGlass.member_count = inspected.memberCount;
        enrichment.breakGlass.member_count_capped = !!inspected.memberCountCapped;
        enrichment.breakGlass.members = (inspected.members || []).map(m => ({
          account: m.displayName || m.userPrincipalName || '',
          upn: m.userPrincipalName || '',
        }));
      } catch (gErr) {
        enrichment.breakGlass.members_error = gErr.message;
        console.warn('[Reports.enrich] break-glass member list unavailable (non-fatal):', gErr.message);
      }
    } else {
      enrichment.breakGlass = { configured: false, designations: (designations || []).map(d => ({ account: d.display_name || d.user_principal_name || '', upn: d.user_principal_name || '' })) };
    }
  } catch (err) {
    console.warn('[Reports.enrich] break-glass config unavailable (non-fatal):', err.message);
  }

  // ── Applications — known-good vs unblessed, with permissions + verdict ──
  try {
    const inv = await knownGoodStore.readInventory(tid);
    if (inv && Array.isArray(inv.apps)) {
      const baselines = await knownGoodStore.getBaselines(tid).catch(() => new Map());
      const knownGood = [];
      const others = [];
      for (const app of inv.apps) {
        const baseline = baselines.get(`${app.kind}:${app.appId}`);
        if (app.blessed) {
          knownGood.push({
            displayName: app.displayName || app.appId || '',
            publisher: app.publisher || '',
            // Known-good apps surface their APPROVED permission set (baseline),
            // not the live one (spec). Fall back to live if no baseline row.
            permissions: baseline && Array.isArray(baseline.baseline_perms)
              ? permNamesFromTokens(baseline.baseline_perms)
              : permNamesFromApp(app),
            drift_state: app.drift_state || null,
          });
        } else {
          others.push({
            displayName: app.displayName || app.appId || '',
            publisher: app.publisher || '',
            verdict: (app.sonnet && app.sonnet.verdict) || null,
            rationale: (app.sonnet && app.sonnet.reasons) || null, // {en,fr,es} — resolved per-lang in Python
            drift_state: app.drift_state || null,
            permissions: permNamesFromApp(app),
          });
        }
      }
      enrichment.apps = {
        available: true,
        generated_at: inv.captured_at || inv.generated_at || null,
        total: inv.apps.length,
        knownGood,
        others,
      };
    }
  } catch (err) {
    console.warn('[Reports.enrich] applications inventory unavailable (non-fatal):', err.message);
  }

  // ── Email-auth posture (Item 7) — cached read only, NO live DNS re-pull ──
  try {
    const domains = await emailAuthStore.getPosture(tid);
    if (Array.isArray(domains) && domains.length) {
      const toCard = (d) => ({
        domain: d.domain,
        is_primary: !!d.is_primary,
        non_mail: !!d.non_mail,
        overall_score: d.overall_score,
        grade: d.grade,
      });
      // Primary = the is_primary row (getPosture sorts is_primary DESC), else the
      // first scored domain. Only the primary carries findings + providers; other
      // mail domains render as a compact grade list (spec: no wall of gauges).
      const primaryRow = domains.find(d => d.is_primary) || domains[0];
      const primary = primaryRow ? {
        ...toCard(primaryRow),
        detected_providers: primaryRow.detected_providers || null,
        findings: primaryRow.findings || {},
      } : null;
      const others = domains.filter(d => d !== primaryRow).map(toCard);
      // Informational *.onmicrosoft.com routing domains aren't stored in
      // dns_posture — derive them best-effort from the org's verified domains
      // (the same source the tab uses). This is an org-metadata read, NOT a DNS
      // re-pull; graceful if Graph is unavailable at report time.
      let informational = [];
      try {
        const enumerated = await emailAuthWorker.enumerateDomains(azureTenantId);
        informational = (enumerated && enumerated.informational) || [];
      } catch (e) {
        console.warn('[Reports.enrich] email-auth informational domains unavailable (non-fatal):', e.message);
      }
      enrichment.emailAuth = { available: true, primary, others, informational };
    }
  } catch (err) {
    console.warn('[Reports.enrich] email-auth posture unavailable (non-fatal):', err.message);
  }

  return enrichment;
}

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
  // Reports exclude false_positive (dismissed-as-noise) but KEEP resolved —
  // a resolved alert is real handled history the tenant should see
  // (2026-05-30). Mirror this filter across every report/count query below.
  // Alert Merge (2026-06-05): every report/count query also excludes
  // is_rollup = 1 — operator roll-ups are workflow objects, not countable
  // detections. The merged children are 'resolved' (kept by the
  // false_positive-only filter) so the originals still count. Mirror the
  // is_rollup filter across every report/count query below.
  const alertsBySeverity = await db.queryRows(
    `SELECT severity, COUNT(*) AS cnt
     FROM alerts WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       AND status <> 'false_positive' AND is_rollup = 0
     GROUP BY severity`,
    [tenantIdInt]
  );

  // Alert summary by status
  const alertsByStatus = await db.queryRows(
    `SELECT status, COUNT(*) AS cnt
     FROM alerts WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       AND status <> 'false_positive' AND is_rollup = 0
     GROUP BY status`,
    [tenantIdInt]
  );

  // Alert summary by category
  const alertsByCategory = await db.queryRows(
    `SELECT p.category, COUNT(*) AS cnt
     FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       AND a.status <> 'false_positive' AND a.is_rollup = 0
     GROUP BY p.category ORDER BY cnt DESC`,
    [tenantIdInt]
  );

  // Top 15 most significant alerts (high/severe first, then by recurrence)
  const topAlerts = await db.queryRows(
    `SELECT a.id, a.severity, a.message, a.raw_data, a.status, a.triggered_at, a.recurrence_count,
            ${aiAnalysisExpr} AS ai_analysis, p.name AS policy_name, p.category
     FROM alerts a
     JOIN alert_policies p ON a.policy_id = p.id
     WHERE a.tenant_id = ? AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       AND a.status <> 'false_positive' AND a.is_rollup = 0
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
       AND a.status <> 'false_positive' AND a.is_rollup = 0
     ORDER BY a.triggered_at DESC`,
    [tenantIdInt]
  );

  // Alert trend — daily counts for the period
  const alertTrend = await db.queryRows(
    `SELECT DATE(triggered_at) AS day, severity, COUNT(*) AS cnt
     FROM alerts
     WHERE tenant_id = ? AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${interval})
       AND status <> 'false_positive' AND is_rollup = 0
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

  // v0.2.9 — identity-hygiene / break-glass / app-risk enrichment (graceful).
  const enrichment = await gatherReportEnrichment(tenantIdInt, tenant.tenant_id);

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
    enrichment,
    secureScore: parsedSecureScore,
    alerts: {
      bySeverity: Object.fromEntries(alertsBySeverity.map(r => [r.severity, r.cnt])),
      byStatus: Object.fromEntries(alertsByStatus.map(r => [r.status, r.cnt])),
      byCategory: alertsByCategory.map(r => ({ category: r.category, count: r.cnt })),
      total: alertsBySeverity.reduce((sum, r) => sum + r.cnt, 0),
      topAlerts: topAlerts.map(a => ({
        severity: a.severity,
        // Item 4: render the localized title via the SAME path the alert emails
        // use (message_template_key + params → tenant language). Falls back to the
        // stored English message for legacy/keyless alerts. Operator-typed free
        // text (exemption reasons, notes) is never touched.
        message: notifier.renderAlertMessageForLocale(a, lang),
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
    const [policies, namedLocations, groups, servicePrincipals, roleDefs] = await Promise.all([
      graph.callGraphPaged(azureTenantId, '/identity/conditionalAccess/policies').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/identity/conditionalAccess/namedLocations?$select=id,displayName').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/groups?$select=id,displayName&$top=999').catch(() => []),
      graph.callGraphPaged(azureTenantId, '/servicePrincipals?$select=appId,displayName&$top=999').catch(() => []),
      // Item 5: roleDefinitions resolves ANY directory role (built-in template IDs
      // beyond the hardcoded set, plus custom roles) so an excluded role shows a name.
      graph.callGraphPaged(azureTenantId, '/roleManagement/directory/roleDefinitions?$select=id,displayName,templateId').catch(() => []),
    ]);

    if (!policies || policies.length === 0) return [];

    // Build lookup maps
    const locationMap = Object.fromEntries((namedLocations || []).map(l => [l.id, l.displayName]));
    const groupMap = Object.fromEntries((groups || []).map(g => [g.id, g.displayName]));
    const appMap = Object.fromEntries((servicePrincipals || []).map(sp => [sp.appId, sp.displayName]));
    // CA stores the role TEMPLATE id; custom roles use the definition id — map both.
    const roleMap = {};
    for (const r of (roleDefs || [])) {
      if (!r || !r.displayName) continue;
      if (r.templateId) roleMap[r.templateId] = r.displayName;
      if (r.id) roleMap[r.id] = r.displayName;
    }

    // Item 5: resolve excluded PRINCIPALS (users / groups) the bulk fetch didn't
    // cover — typically a handful of break-glass users named in excludeUsers.
    // Batch-resolve only the unknown GUIDs via directoryObjects/getByIds (bounded
    // by the number of exclusions, not directory size). Best-effort: a principal
    // that still can't be resolved keeps its GUID (the agreed Item 5 fallback).
    const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SPECIAL_USER = new Set(['All', 'None', 'GuestsOrExternalUsers']);
    const unknownIds = new Set();
    for (const p of policies) {
      const u = (p.conditions && p.conditions.users) || {};
      for (const arr of [u.includeUsers, u.excludeUsers, u.includeGroups, u.excludeGroups]) {
        for (const id of (arr || [])) {
          if (typeof id === 'string' && GUID_RE.test(id) && !SPECIAL_USER.has(id) && !groupMap[id]) {
            unknownIds.add(id);
          }
        }
      }
    }
    const principalMap = {};
    if (unknownIds.size) {
      try {
        const resp = await graph.callGraph(azureTenantId, '/directoryObjects/getByIds', {
          method: 'POST',
          body: { ids: Array.from(unknownIds).slice(0, 1000), types: ['user', 'group', 'servicePrincipal'] },
        });
        for (const obj of ((resp && resp.value) || [])) {
          const name = obj.displayName || obj.userPrincipalName || null;
          if (obj.id && name) principalMap[obj.id] = name;
        }
      } catch (e) {
        console.warn('[Reports] CA principal resolution (getByIds) failed (non-fatal):', e.message);
      }
    }

    // Resolve a GUID to a name (special tokens → groups → batched principals)
    function resolveUser(id) {
      if (id === 'All') return 'All Users';
      if (id === 'GuestsOrExternalUsers') return 'Guests / External Users';
      if (id === 'None') return 'None';
      return groupMap[id] || principalMap[id] || id; // groups and users share include/exclude arrays
    }

    function resolveApp(id) {
      return WELL_KNOWN_APPS[id] || appMap[id] || id;
    }

    function resolveRole(id) {
      return WELL_KNOWN_ROLES[id] || roleMap[id] || id;
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
      max_tokens: REPORT_NARRATIVE_MAX_TOKENS,
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

    aiGuard.recordUsage(response.usage);
    if (response.stop_reason === 'max_tokens') {
      console.error(`[Reports] CA analysis truncated at max_tokens (${REPORT_NARRATIVE_MAX_TOKENS}) for ${tenantName} [${lang}]`);
      return { policies: [], crossAnalysis: '' };
    }
    const text = response.content?.[0]?.text || '';
    // Never leak raw model output into crossAnalysis (customer-facing).
    return parseAiJson(text) || { policies: [], crossAnalysis: '' };
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
        // May 20, 2026 — empty default. The Python PDF generator (see
        // scripts/generate-pdf-report.py) falls back to "Panoptica365"
        // when mspName is empty, which is the correct brand-neutral
        // label for any deployment without an explicit MSP_NAME set.
        mspName: reportCfg.mspName || '',
        platformAttribution: reportCfg.platformAttribution !== false,
        // Cover "Prepared by" — the logged-in operator's display name (UPN
        // fallback). A salesperson printing for a customer wants their own
        // name on the cover; empty falls back to the MSP name in the PDF script.
        preparedBy: req.session?.user?.name || req.session?.user?.email || '',
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
      max_tokens: REPORT_NARRATIVE_MAX_TOKENS,
      system: `You are a cybersecurity analyst writing a Security Posture Report for a small business client.

Your audience is a non-technical business owner. Write in clear, accessible language — avoid jargon (or define it inline the first time you use a term). Be narrative, not bullet-heavy. Think of it as a trusted advisor explaining their security situation in person.

This report covers ALL operational data for the period: alerts, Microsoft Secure Score, Conditional Access policies, the tenant's Security Settings posture (which protections are matched vs drifting), Microsoft Defender XDR incidents, the operator change log (every Match/Apply/Accept/Remediate action your MSP took, plus any operator-added manual notes), the MSP audit log, active alert exemptions, overall activity volume, and — new — identity hygiene (accounts holding admin roles, admins missing MFA, inactive accounts, break-glass readiness) and third-party application risk (Known-Good vs unblessed apps and their risk verdicts). Factor the identity and application signals into your executive summary and recommendations, not just their dedicated sections.

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
  "identity_hygiene_analysis": "1-2 paragraphs on identity hygiene from the IDENTITY HYGIENE and BREAK-GLASS data: how many accounts hold administrative roles, whether any admins lack registered MFA (call this out — it is high-risk), how many accounts are inactive (no activity beyond the stated threshold) and should be reviewed for offboarding, and whether a break-glass (emergency-access) group exists and looks healthy (a small, named, dedicated set). If a break-glass group is configured, say so positively; if none exists, recommend establishing one. If the Access Review snapshot was not available, say it was not captured and recommend running it — do NOT infer problems from missing data.",
  "application_risk_analysis": "1-2 paragraphs on third-party / enterprise application risk from the APPLICATION RISK data: how many apps are tagged Known-Good vs not, and call out any non-Known-Good apps carrying a red or yellow risk verdict (name them, with publisher and the nature of their permissions). Note any app showing permission drift. If everything is Known-Good or the inventory was not available, say so plainly. Use standard permission names (e.g. Mail.Read) — never internal IDs.",
  "recommendations": "2-3 paragraphs of prioritized, actionable recommendations. Tie each one to a specific data point (drifting setting NAME, recurring alert pattern, missing CA policy, exemption due to expire, an admin without MFA, an inactive privileged account, a red-verdict application). Respect the licensing boundary stated above. No generic 'enable MFA' filler — be specific."
}

Keep the total output under 2400 words. Be specific. Use real numbers from the data. Setting NAMES not IDs. Respect licensing.`,
      messages: [{
        role: 'user',
        content: `Generate the security posture report narrative for this tenant data:\n\n${dataSummary}`,
      }],
    });

    aiGuard.recordUsage(response.usage);

    // If the model ran out of output budget the JSON is truncated (no closing
    // brace) and unparseable. Don't try to salvage a half-narrative — fall back
    // to clean, data-driven prose so the customer never sees a broken report.
    if (response.stop_reason === 'max_tokens') {
      console.error(`[Reports] Narrative truncated at max_tokens (${REPORT_NARRATIVE_MAX_TOKENS}) for ${data.tenant?.display_name} [${lang}] — using default narrative`);
      return getDefaultNarrative(data);
    }

    const text = response.content?.[0]?.text || '';
    const parsed = parseAiJson(text);
    if (parsed) return parsed;

    // Parsing failed for some other reason — never dump the raw model output
    // (fence + escaped newlines) into a customer-facing field. Use the default.
    console.error(`[Reports] Could not parse narrative JSON for ${data.tenant?.display_name} — using default narrative`);
    return getDefaultNarrative(data);
  } catch (err) {
    console.error('[Reports] Narrative generation failed:', err.message);
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

  // ── Identity hygiene / break-glass / application risk (v0.2.9) ──
  s += summarizeEnrichmentForAI(data.enrichment);

  return s;
}

// Render the shared report enrichment as a compact text block for the AI
// (Security Posture Sonnet narrative + Quick Assessment Opus analysis). Names
// only, no internal IDs.
function summarizeEnrichmentForAI(enrichment) {
  if (!enrichment) return '';
  let s = '';
  const id = enrichment.identity || {};
  s += '\n═══ IDENTITY HYGIENE ═══\n';
  if (!id.available) {
    s += 'Access Review snapshot not available for this tenant (none captured yet).\n';
  } else {
    const sum = id.summary || {};
    s += `Users total: ${sum.total ?? '?'}; inactive (no activity in ${id.threshold_days}+ days): ${sum.inactive ?? '?'}.\n`;
    s += `Accounts holding admin roles: ${sum.admin_total ?? (id.admins || []).length}; Global Admins: ${sum.ga_count ?? '?'}; admins without registered MFA: ${sum.no_mfa_admins ?? '?'}.\n`;
    if ((id.admins || []).length) {
      s += 'ADMIN ACCOUNTS (account — roles — enabled — MFA — last activity):\n';
      for (const a of id.admins.slice(0, 25)) {
        s += `  ${a.account} — ${a.roles.join(', ') || '(none)'} — ${a.enabled ? 'enabled' : 'DISABLED'} — MFA ${a.mfa}${a.breakGlass ? ' — break-glass' : ''} — ${a.lastActivity || 'no recent activity'}\n`;
      }
    }
    const inact = id.inactive_users || [];
    if (inact.length) {
      s += `INACTIVE ACCOUNTS (${inact.length}; threshold ${id.threshold_days}d) — top 25:\n`;
      for (const u of inact.slice(0, 25)) {
        s += `  ${u.account} (${u.type}) — last activity ${u.lastActivity || (u.neverRedeemed ? 'never redeemed' : 'unknown')}\n`;
      }
    }
  }

  const bg = enrichment.breakGlass || {};
  s += '\n═══ BREAK-GLASS (emergency access) ═══\n';
  if (!bg.configured) {
    s += 'No break-glass group is configured for this tenant.\n';
  } else {
    s += `Break-glass group: ${bg.group_name || bg.group_id}.\n`;
    if (bg.members_available) {
      s += `Members (${bg.member_count}): ${(bg.members || []).map(m => m.account).join(', ') || '(none)'}\n`;
    } else {
      s += 'Live membership could not be read at report time.\n';
    }
  }

  const apps = enrichment.apps || {};
  s += '\n═══ APPLICATION RISK ═══\n';
  if (!apps.available) {
    s += 'Application inventory not available for this tenant (run the Applications scan).\n';
  } else {
    const others = apps.others || [];
    const byVerdict = { red: [], yellow: [], green: [], none: [] };
    for (const a of others) (byVerdict[a.verdict] || byVerdict.none).push(a);
    s += `Applications: ${apps.total}; Known-Good (blessed): ${(apps.knownGood || []).length}; not tagged Known-Good: ${others.length}.\n`;
    s += `Unblessed by risk verdict — red: ${byVerdict.red.length}, yellow: ${byVerdict.yellow.length}, green: ${byVerdict.green.length}, not evaluated: ${byVerdict.none.length}.\n`;
    const flagged = [...byVerdict.red, ...byVerdict.yellow];
    if (flagged.length) {
      s += 'NON-KNOWN-GOOD APPS OF NOTE (name — publisher — verdict — key permissions):\n';
      for (const a of flagged.slice(0, 20)) {
        s += `  ${a.displayName} — ${a.publisher || 'unknown publisher'} — ${a.verdict}${a.drift_state === 'drifted' ? ' — drifted' : ''} — ${(a.permissions || []).slice(0, 8).join(', ')}\n`;
      }
    }
  }
  return s;
}

function getDefaultNarrative(data) {
  const ss = data.securitySettings || {};
  const di = data.defenderIncidents || {};
  const cl = data.changeLog || {};
  const ex = data.exemptions || {};
  const en = data.enrichment || {};
  const idn = en.identity || {};
  const bg = en.breakGlass || {};
  const ap = en.apps || {};
  const idText = idn.available
    ? `${idn.summary?.admin_total ?? (idn.admins || []).length} account(s) hold admin roles${idn.summary?.no_mfa_admins ? `, ${idn.summary.no_mfa_admins} without registered MFA` : ''}; ${idn.summary?.inactive ?? (idn.inactive_users || []).length} account(s) are inactive (threshold ${idn.threshold_days}d). ${bg.configured ? `A break-glass group ("${bg.group_name || bg.group_id}") is configured.` : 'No break-glass group is configured.'} See the Identity tables for detail.`
    : 'Access Review data was not captured for this tenant — run an Access Review to populate identity hygiene.';
  const appText = ap.available
    ? `${(ap.knownGood || []).length} application(s) are tagged Known-Good; ${(ap.others || []).length} are not. See the Application Risk table for verdicts and permissions.`
    : 'Application inventory was not available — run the Applications scan to populate application risk.';
  return {
    identity_hygiene_analysis: idText,
    application_risk_analysis: appText,
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
      max_tokens: REPORT_NARRATIVE_MAX_TOKENS,
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
    aiGuard.recordUsage(response.usage);
    if (response.stop_reason === 'max_tokens') {
      console.error(`[Reports] Doc CA summaries truncated at max_tokens (${REPORT_NARRATIVE_MAX_TOKENS}) — ${caPolicies.length} policies`);
    }
    const text = response.content?.[0]?.text || '';
    const parsed = parseAiJson(text);
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

  // v0.2.9 — identity/break-glass/app-risk enrichment (Documentation + Quick
  // Assessment both flow through here, so both inherit it).
  const enrichment = await gatherReportEnrichment(tenant.id, tenant.tenant_id);

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
    enrichment,
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
        // May 20, 2026 — see matching site above; Python PDF generator
        // fallback handles brand-neutral default.
        mspName: (config.report && config.report.mspName) || '',
        platformAttribution: (config.report && config.report.platformAttribution) !== false,
        preparedBy: req.session?.user?.name || req.session?.user?.email || '',
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

// ═══════════════════════════════════════════════════════════════════════
// QUICK ASSESSMENT REPORT (v0.1.6)
// ═══════════════════════════════════════════════════════════════════════
//
// Point-in-time advisory report. Takes the same current-state snapshot the
// Documentation report uses, runs it through an Opus deep gap analysis, and
// renders a narrative PDF — strengths, weaknesses, and "what's MISSING"
// across Conditional Access, Intune, and the security-settings posture.
//
// Grounding (the layered model — enforced in the system prompt):
//   - Security-settings posture is Panoptica's registry-derived
//     tenant_security_config — code-owned, authoritative.
//   - CA / Intune gap detection is grounded in Microsoft's published
//     baselines via Opus, and is NOT capped by the template catalog.
//   - The CA / Intune template catalog is a secondary input only: it lets a
//     recommendation be tagged "deployable" when Panoptica already has a
//     matching template. A template an MSP has deleted costs a deployable
//     tag — never a finding.
//
// AUDIT-ONLY CARVE-OUT: this report uses AI, and audit-only tenants are
// otherwise gated out of AI (the Apr 29 sweep — Security Posture is gated
// for that reason). The Quick Assessment is deliberately exempt: it is the
// core deliverable that makes audit-only mode worth selling, so it must run
// for audit-only tenants. Conscious policy exception, not an oversight.

function getAssessmentModel() {
  return process.env.OPUS_MODEL || config.ai.opusModel;
}

async function gatherQuickAssessmentData(tenantId) {
  // Reuse the Documentation report's proven current-state assembly: tenant,
  // services (incl. entra licensing), securitySettings, exemptions,
  // caPolicies + caPolicySummaries, etc.
  const data = await gatherDocumentationData(tenantId);

  // Panoptica's own template catalogs — the "deployable" cross-reference.
  // MSP-editable, so this can legitimately be partial or empty.
  const [caTemplates, intuneTemplates] = await Promise.all([
    db.queryRows('SELECT name, description FROM ca_templates ORDER BY name').catch(() => []),
    db.queryRows('SELECT name, description, category, platform FROM intune_templates ORDER BY name').catch(() => []),
  ]);

  // Live Intune policy export — the tenant's ACTUAL device-management config,
  // pulled from Graph (the same logic behind the Intune "Export from Tenant"
  // action). This is what lets the report assess Intune for real instead of
  // guessing. Best-effort and entirely server-side/in-memory: a failure (or a
  // tenant with no Intune) must not block the report. Can take a minute on a
  // policy-heavy tenant — the SSE heartbeat keeps the connection alive.
  let intuneExport = null;
  try {
    const intuneRoutes = require('./api-intune');
    if (typeof intuneRoutes.exportTenantIntunePolicies === 'function') {
      intuneExport = await intuneRoutes.exportTenantIntunePolicies({
        id: data.tenant.id,
        tenant_id: data.tenant.azure_tenant_id,
        display_name: data.tenant.display_name,
      }, { includeSettings: false }); // inventory only — keeps the export fast
    }
  } catch (err) {
    console.warn('[Reports] Quick Assessment — Intune export failed (non-fatal):', err.message);
  }

  return { ...data, caTemplates, intuneTemplates, intuneExport };
}

// Build the text data block fed to Opus. A condensed, readable summary —
// not a raw JSON dump — same approach as buildDataSummary().
function buildAssessmentInput(data) {
  const svc = data.services || {};
  const sec = svc.security || {};
  const entra = svc.entra || {};
  let s = '';

  s += `TENANT: ${data.tenant.display_name}\n`;
  s += `MODE: ${data.tenant.mode}\n`;
  s += `CONFIGURATION CAPTURED: ${data.capturedAt || 'unknown'}\n\n`;

  // ── Licensing — drives which CA/Intune controls are even available ──
  const licenses = entra.licenses || [];
  s += 'LICENSING (subscribed SKUs — respect these boundaries in every recommendation):\n';
  if (licenses.length) {
    for (const l of licenses) {
      s += `  - ${l.displayName || l.skuPartNumber || 'Unknown SKU'}`;
      if (l.consumedUnits != null) s += ` (${l.consumedUnits} assigned)`;
      s += '\n';
    }
  } else {
    s += '  (no licensing data captured — state your licensing assumption explicitly)\n';
  }
  s += '\n';

  // ── Headline posture ──
  if (sec.secure_score) {
    s += `MICROSOFT SECURE SCORE: ${sec.secure_score.percentage ?? sec.secure_score.currentScore ?? 'N/A'}%\n`;
  }
  if (sec.mfa_status) {
    s += `MFA REGISTRATION: ${sec.mfa_status.registration_percentage ?? 'N/A'}%\n`;
  }
  if (sec.global_admins) {
    s += `GLOBAL ADMINS: ${sec.global_admins.count ?? 'N/A'}\n`;
  }
  if (entra.user_summary) {
    s += `USERS: ${entra.user_summary.total ?? '?'} total, ${entra.user_summary.licensed ?? '?'} licensed, ${entra.user_summary.guests ?? '?'} guests\n`;
  }
  s += '\n';

  // ── Conditional Access policies the tenant HAS ──
  const caPolicies = data.caPolicies || [];
  s += `CONDITIONAL ACCESS POLICIES CONFIGURED (${caPolicies.length}):\n`;
  if (caPolicies.length) {
    for (const p of caPolicies) {
      s += `  - "${p.name || p.displayName || 'Unnamed'}" [state=${p.state || 'unknown'}]`;
      const summary = (data.caPolicySummaries || {})[p.id] || (data.caPolicySummaries || {})[p.name];
      if (summary) s += ` — ${String(summary).replace(/\s+/g, ' ').slice(0, 240)}`;
      s += '\n';
    }
  } else {
    s += '  (none configured)\n';
  }
  s += '\n';

  // ── Security-settings posture — per-setting current state ──
  // CRITICAL: judge each setting by current_value (what the poll actually
  // read from the tenant), NEVER by `status`. `status` is a MANAGEMENT
  // state — and audit-only tenants are read-only, so every setting is
  // permanently `not_applied`. That carries zero security signal; the
  // current_value is the truth. (This is the bug behind the false v1
  // findings — see the system prompt.)
  const settings = data.securitySettings || [];
  s += `SECURITY SETTINGS — CURRENT STATE (${settings.length} settings tracked by Panoptica)\n`;
  s += 'Each line: [priority] NAME (category) | panoptica_status=<state> | current_value=<value the last poll actually read from the tenant>\n';
  s += 'panoptica_status is a MANAGEMENT state, NOT a security verdict:\n';
  s += '  monitored   = Panoptica applied a baseline and the tenant matches it (good).\n';
  s += '  drift       = a baseline was applied and the tenant has since diverged (a genuine regression).\n';
  s += '  not_applied = Panoptica is NOT managing this setting. Says NOTHING about whether it is secure — judge ONLY by current_value. Audit-only tenants are read-only, so EVERY setting is not_applied — that is normal and is NOT itself a finding.\n';
  s += '  pending / poll_error / unavailable = no reliable reading — do not treat as a gap.\n';
  for (const st of settings) {
    let cv = st.current_value;
    if (cv && typeof cv === 'object') cv = JSON.stringify(cv);
    cv = (cv === null || cv === undefined || cv === '') ? '(not captured)' : String(cv);
    if (cv.length > 400) cv = cv.slice(0, 400) + '…';
    s += `  - [${st.priority || 'n/a'}] ${st.name} (${st.category}) | panoptica_status=${st.status} | current_value=${cv}`;
    if (st.applied_value !== null && st.applied_value !== undefined) {
      let av = typeof st.applied_value === 'object' ? JSON.stringify(st.applied_value) : String(st.applied_value);
      if (av.length > 200) av = av.slice(0, 200) + '…';
      s += ` | panoptica_baseline=${av}`;
    }
    if (st.security_impact) s += ` | impact: ${String(st.security_impact).replace(/\s+/g, ' ').slice(0, 200)}`;
    s += '\n';
  }
  s += '\n';

  // ── Intune — live policy export pulled from the tenant via Graph ──
  const intuneExport = data.intuneExport;
  if (intuneExport && Array.isArray(intuneExport.policies) && intuneExport.policies.length) {
    s += `INTUNE POLICIES — LIVE EXPORT FROM THE TENANT (${intuneExport.policies.length} policies — this is the authoritative list of what is actually configured in Intune)\n`;
    for (const p of intuneExport.policies) {
      s += `  - [${p.policyType}] ${p.name}`;
      if (p.category) s += ` | category: ${p.category}`;
      if (p.templateFamily) s += ` | family: ${p.templateFamily}`;
      if (Array.isArray(p.settings)) s += ` | ${p.settings.length} settings`;
      if (p.description) s += ` | ${String(p.description).replace(/\s+/g, ' ').slice(0, 120)}`;
      s += '\n';
    }
    if (intuneExport.errors && intuneExport.errors.length) {
      s += `  NOTE: some Intune policy types could not be read (${intuneExport.errors.join('; ')}) — treat those areas as "not assessed", not as gaps.\n`;
    }
    s += '\n';
  } else if (intuneExport && Array.isArray(intuneExport.policies)
             && !(intuneExport.errors && intuneExport.errors.length)) {
    // Export ran cleanly (no errors) and found nothing — a genuine zero.
    s += 'INTUNE POLICIES — LIVE EXPORT FROM THE TENANT: the export completed with no errors and returned ZERO policies. This tenant genuinely has no Intune device-management policies configured — that is a real, confirmed finding.\n\n';
  } else {
    // No export object, or zero policies WITH errors — i.e. the export
    // failed (Graph error / permissions). Do NOT claim the tenant has no
    // Intune; we simply could not read it.
    s += 'INTUNE: the live Intune export could not be completed for this tenant (Graph error or permissions';
    if (intuneExport && intuneExport.errors && intuneExport.errors.length) {
      s += `: ${intuneExport.errors.join('; ')}`;
    }
    s += '). You do NOT have reliable Intune data — follow the Intune accuracy rule and do not speculate about what is or is not configured.\n\n';
  }

  // ── Active exemptions ──
  const exemptions = data.exemptions || [];
  if (exemptions.length) {
    s += `ACTIVE ALERT EXEMPTIONS (${exemptions.length}):\n`;
    for (const e of exemptions) {
      s += `  - ${e.policy_name || 'policy'} — reason: ${(e.reason || '').slice(0, 160)}\n`;
    }
    s += '\n';
  }

  // ── Panoptica template catalog — the "deployable" cross-reference ──
  const caT = data.caTemplates || [];
  s += `PANOPTICA CONDITIONAL ACCESS TEMPLATE CATALOG (${caT.length} — what the MSP can deploy in one click):\n`;
  for (const t of caT) s += `  - "${t.name}"${t.description ? ': ' + String(t.description).replace(/\s+/g, ' ').slice(0, 160) : ''}\n`;
  if (!caT.length) s += '  (catalog empty — recommend gaps anyway; just do not tag them deployable)\n';
  s += '\n';

  const intuneT = data.intuneTemplates || [];
  s += `PANOPTICA INTUNE TEMPLATE CATALOG (${intuneT.length} — what the MSP can deploy in one click):\n`;
  for (const t of intuneT) s += `  - "${t.name}" [${t.platform || 'any'}/${t.category || 'general'}]${t.description ? ': ' + String(t.description).replace(/\s+/g, ' ').slice(0, 140) : ''}\n`;
  if (!intuneT.length) s += '  (catalog empty — recommend gaps anyway; just do not tag them deployable)\n';
  s += '\n';

  // ── Identity hygiene / break-glass / application risk (v0.2.9) ──
  s += summarizeEnrichmentForAI(data.enrichment);

  return s;
}

/**
 * Run the Opus deep gap analysis. Streamed (large input + large structured
 * output) per Anthropic guidance — avoids HTTP timeouts. Returns the parsed
 * structured analysis object.
 */
async function runQuickAssessmentAnalysis(data, operatorContext) {
  const anthropic = getAiClient();
  if (!anthropic) {
    throw new Error('AI is not configured (ANTHROPIC_API_KEY missing) — the Quick Assessment requires AI analysis.');
  }

  const lang = data.language || 'en';
  let langInstruction = 'Write all narrative values in English.';
  if (lang === 'fr') {
    langInstruction = 'IMPORTANT: write ALL narrative values in Canadian French (Quebec spelling and accents). JSON keys stay in English; every value is in French.';
  } else if (lang === 'es') {
    langInstruction = 'IMPORTANT: write ALL narrative values in neutral Latin American Spanish (proper spelling and accents). JSON keys stay in English; every value is in Spanish.';
  }

  const system = `You are a senior Microsoft 365 security consultant writing a "Quick Assessment" — a point-in-time advisory report on one tenant's current security configuration. The audience is the MSP operator and, ultimately, their customer.

WHAT THIS REPORT IS: a narrative assessment of the tenant's CURRENT state — Conditional Access, Intune, and the broader security-settings posture. It explains what is configured well, what is weak, and crucially WHAT IS MISSING. It is advisory and narrative — write in clear, explanatory prose, not terse bullet fragments. Highlight strengths as well as weaknesses; be honest and specific, never generic.

═══ ACCURACY — NON-NEGOTIABLE, READ TWICE ═══

Every single finding MUST be backed by the data provided below. A false finding — telling the customer a control is missing when it is actually in place — destroys the credibility of the entire report. This has happened before; do not let it happen again.

- Only state that something is missing, disabled, or misconfigured when the data POSITIVELY shows it.
- NEVER infer a gap from the ABSENCE of data. If Panoptica did not capture something, say it was not captured — do not assume it is wrong or missing.
- The configured-items lists and current_value data below are authoritative. If a security setting's current_value shows it is already correctly configured, it is NOT a finding — do not report it.
- If a value is ambiguous or you cannot determine whether it is secure, do NOT report it as a gap.

═══ GROUNDING — how to decide what is "missing" ═══

1. SECURITY SETTINGS: the "SECURITY SETTINGS — CURRENT STATE" block lists every tracked setting with the value the last poll actually read (current_value). JUDGE EACH SETTING BY ITS current_value — never by panoptica_status. A setting is a finding ONLY when its current_value clearly shows an insecure configuration, OR its panoptica_status is "drift" (a baseline regression). panoptica_status of "not_applied" means Panoptica is not actively managing the setting — it is NOT evidence the setting is off or wrong, and on audit-only tenants EVERY setting is not_applied by design. NEVER write that a setting is "not enabled", "not configured", "missing", or "off" when its current_value shows it IS in place. When current_value confirms a setting is correctly configured, treat it as a STRENGTH, not a gap.

2. CONDITIONAL ACCESS: the CONDITIONAL ACCESS POLICIES CONFIGURED block is the authoritative list of what exists. Detect gaps against Microsoft's published CA baseline (require MFA, block legacy auth, require compliant/hybrid-joined devices, sign-in/user risk policies, etc.) — but ONLY claim a control is missing if it is genuinely absent from that list. If a policy in the list already covers a control, it is not missing.

3. INTUNE: the "INTUNE POLICIES — LIVE EXPORT FROM THE TENANT" block is a live export of the tenant's ACTUAL Intune policies — the authoritative inventory of what is configured. Assess device management against it: a control (device compliance, BitLocker/disk encryption, Defender configuration, ASR rules, firewall, app protection, etc.) is a gap ONLY if it is genuinely absent from that list. If a matching policy IS in the list, it is configured — treat it as a strength, never report it as missing. If the block says the export returned ZERO policies, the tenant has no Intune policies and you may state that as a confirmed finding. If instead the block says the export could not be completed, you DO NOT have the data — the "intune" section's "gaps" must then contain at most one entry noting that and recommending a direct review, and you must not speculate.

4. THE PANOPTICA TEMPLATE CATALOGS are a SECONDARY input, used ONLY for actionability. When a gap you identified matches a catalog template, set "deployable_template" to that template's exact name so the MSP knows it is a one-click deploy. If no catalog template matches, set "deployable_template" to null — the gap still stands as a manual recommendation. NEVER limit your findings to what is in the catalog, and never invent a finding just because a template exists.

═══ LICENSING ═══

Respect the LICENSING block. Entra ID P2 features (sign-in risk and user risk Conditional Access policies, PIM, full Identity Governance) are NOT in Business Basic/Standard/Business Premium — only E5 / E5 Security / P2 add-on. If a tenant lacks the license for a control you would recommend, either recommend the license upgrade explicitly as part of the recommendation, or recommend a tier-appropriate alternative. Never silently recommend a control the tenant cannot license.

${langInstruction}

═══ EXECUTIVE SUMMARY — DIFFERENT AUDIENCE, READ CAREFULLY ═══

The "executive_summary" is the ONLY part of this report written for the BUSINESS OWNER, not the operator. It must be readable by someone with no IT background. ABSOLUTELY FORBIDDEN in "executive_summary": configuration key names, Graph/API field names, internal identifiers, Panoptica template names, severity labels (high/medium/low), and product/feature jargon ("Conditional Access", "ASR", "BitLocker" may be named only if immediately explained in plain words). Speak in terms of business consequences and decisions. Every other key in this object stays operator-grade exactly as before.

Return ONLY a JSON object (no markdown fence, no preamble) with exactly these keys:
{
  "executive_summary": {
    "verdict": "One or two plain-language sentences a non-technical business owner immediately understands. No jargon. e.g. 'Your email security is in good shape, but the way staff sign in and the laptops themselves are largely unprotected — which is where a real incident would most likely start.'",
    "business_risks": [
      "2-4 short plain-language statements of what could actually go wrong FOR THE BUSINESS — framed as consequences (data loss, downtime, a stolen laptop exposing client/IP data, an account takeover), never as technical control names."
    ],
    "recommended_path": "1-2 sentences naming the single most important move in business terms and what it takes (e.g. the licensing step that unlocks the rest). No template names.",
    "outlook": "1 sentence — what 'good' looks like once the recommended path is followed. The destination, stated positively."
  },
  "overall_posture": "2-3 paragraphs. Open with a one-line verdict. Summarize the tenant's overall security standing across identity, devices, and configuration. End with the single most important thing to address.",
  "conditional_access": {
    "narrative": "1-2 paragraphs assessing the CA policies that ARE configured — coverage, gaps, and weaknesses.",
    "strengths": ["short strings — CA things done well; [] if none"],
    "gaps": [{"title": "short", "detail": "1-3 sentences — what is missing/weak and why it matters", "priority": "high|medium|low", "deployable_template": "exact catalog template name, or null"}]
  },
  "intune": {
    "narrative": "1-2 paragraphs assessing device management against the live Intune policy export. If the export could not be completed, say exactly that and do not speculate.",
    "strengths": ["Intune policies confirmed present in the export; [] if none or export unavailable"],
    "gaps": [{"title": "...", "detail": "...", "priority": "high|medium|low", "deployable_template": "name or null"}]
  },
  "security_settings": {
    "narrative": "1-2 paragraphs on the security-settings posture, based on the current_value of each setting — what is genuinely insecure or drifting, and what is correctly configured.",
    "strengths": ["settings whose current_value confirms they are correctly configured"],
    "gaps": [{"title": "...", "detail": "...", "priority": "high|medium|low", "deployable_template": "name or null"}]
  },
  "identity_posture": {
    "narrative": "1-2 paragraphs assessing identity hygiene from the IDENTITY HYGIENE and BREAK-GLASS blocks: how many accounts hold admin roles, whether any admins lack registered MFA (high-risk — name them), how many accounts are inactive past the stated threshold and should be reviewed for offboarding, and whether a break-glass (emergency-access) group exists and is healthy. If the Access Review snapshot was not captured, say so and recommend running it — never infer gaps from missing data.",
    "strengths": ["identity things done well — e.g. all admins have MFA, a dedicated break-glass group exists; [] if none"],
    "gaps": [{"title": "...", "detail": "...", "priority": "high|medium|low", "deployable_template": "name or null"}]
  },
  "application_risk": {
    "narrative": "1-2 paragraphs assessing third-party / enterprise application risk from the APPLICATION RISK block: how many apps are Known-Good vs not, and any non-Known-Good apps with a red/yellow risk verdict (name them with publisher and the nature of their permissions, using standard Graph permission names). Note any app with permission drift. If the inventory was not available, say so and do not speculate.",
    "strengths": ["app-governance things done well — e.g. most apps tagged Known-Good, no risky over-permissioned apps; [] if none"],
    "gaps": [{"title": "...", "detail": "...", "priority": "high|medium|low", "deployable_template": "name or null"}]
  },
  "strengths_summary": "1 paragraph — what this tenant genuinely does well. Be specific; do not invent strengths.",
  "prioritized_actions": [{"title": "short", "detail": "1-2 sentences", "priority": "high|medium|low", "area": "Conditional Access|Intune|Security Settings|Identity|Applications|Other", "deployable_template": "name or null"}]
}

Order "prioritized_actions" hardest-hitting first. Use real numbers and real names from the data. Be specific — no "enable MFA" filler unless MFA truly is the gap.`;

  let userContent = `Assess this tenant's current security configuration:\n\n${buildAssessmentInput(data)}`;
  if (operatorContext && operatorContext.trim()) {
    userContent += `\n\n═══ OPERATOR-PROVIDED CONTEXT ═══\nThe MSP operator added the following context for this assessment. Weigh it, but do not let it override what the data shows:\n\n${operatorContext.trim().slice(0, 20000)}\n`;
  }

  // Streamed: large grounded input + a large structured report. Streaming
  // avoids SDK HTTP timeouts on a multi-minute Opus call. (Adaptive thinking
  // / effort can be layered on later — kept minimal here to match the other
  // report call sites and the pinned SDK.)
  const stream = anthropic.messages.stream({
    model: getAssessmentModel(),
    max_tokens: 20000,
    system,
    messages: [{ role: 'user', content: userContent }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'max_tokens') {
    throw new Error('The AI analysis was cut off before it finished. Try generating the report again.');
  }
  const textBlock = (message.content || []).find(b => b && b.type === 'text');
  const raw = textBlock ? (textBlock.text || '') : '';
  const parsed = parseAiJson(raw);
  if (parsed) return parsed;
  throw new Error('The AI analysis did not return valid structured output. Try generating the report again.');
}

/**
 * Run the Python Quick Assessment PDF generator. Same spawn pattern as the
 * other report generators.
 */
function runQuickAssessmentPdfGenerator(inputData, outputPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-quick-assessment-report.py');
    const inputPath = outputPath.replace('.pdf', '.json');
    fs.writeFileSync(inputPath, JSON.stringify(inputData));

    const projectRoot = path.join(__dirname, '..', '..');
    let pythonBin = 'python3';
    const venvPython = path.join(projectRoot, 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) pythonBin = venvPython;

    const proc = spawn(pythonBin, [scriptPath, inputPath, outputPath], {
      cwd: projectRoot,
      timeout: 180000,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.stdout.on('data', (chunk) => { console.log('[QuickAssess-Gen]', chunk.toString().trim()); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`Quick Assessment PDF generation failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => {
      try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      reject(new Error(`Failed to spawn Quick Assessment PDF generator: ${err.message}`));
    });
  });
}

/**
 * POST /api/reports/quick-assessment
 *
 * SSE-streamed. Body: { tenant_id, context }. `context` is free-text the
 * operator typed in the Add-context modal — optional. Current-state only,
 * no date range. Allowed for audit-only tenants (see the carve-out note
 * above).
 */
router.post('/quick-assessment', auth.requireMemberOrAdmin, async (req, res) => {
  const { tenant_id } = req.body;
  const operatorContext = typeof req.body.context === 'string' ? req.body.context : '';
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });

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
    const data = await gatherQuickAssessmentData(tenant_id);

    sendEvent({ stage: 'analysis' });
    const analysis = await runQuickAssessmentAnalysis(data, operatorContext);

    sendEvent({ stage: 'pdf' });
    const svc = data.services || {};
    const sec = svc.security || {};
    const pdfFilename = `${data.tenant.display_name.replace(/[^a-zA-Z0-9]/g, '_')}_Quick_Assessment_${Date.now()}.pdf`;
    const pdfPath = path.join(REPORTS_DIR, pdfFilename);

    const pdfInput = {
      tenant: {
        display_name: data.tenant.display_name,
        azure_tenant_id: data.tenant.azure_tenant_id,
        mode: data.tenant.mode,
      },
      language: data.language || 'en',
      generatedAt: new Date().toISOString(),
      capturedAt: data.capturedAt || null,
      headline: {
        secure_score: sec.secure_score?.percentage ?? sec.secure_score?.currentScore ?? null,
        mfa_pct: sec.mfa_status?.registration_percentage ?? null,
        ca_policy_count: Array.isArray(data.caPolicies) ? data.caPolicies.length : null,
        security_settings_total: (data.securitySettings || []).length,
      },
      analysis,
      enrichment: data.enrichment || null,
      reportConfig: {
        mspName: (config.report && config.report.mspName) || '',
        platformAttribution: (config.report && config.report.platformAttribution) !== false,
        preparedBy: req.session?.user?.name || req.session?.user?.email || '',
      },
    };

    await runQuickAssessmentPdfGenerator(pdfInput, pdfPath);

    clearInterval(heartbeat);
    sendEvent({ done: true, url: `/api/reports/download/${encodeURIComponent(pdfFilename)}` });
    res.end();
  } catch (err) {
    console.error('[Reports] Quick Assessment generation failed:', err.message);
    clearInterval(heartbeat);
    sendEvent({ error: err.message });
    res.end();
  }
});

module.exports = router;
