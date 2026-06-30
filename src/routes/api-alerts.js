/**
 * Panoptica — Alert API Routes (Phase 3)
 * CRUD for alerts, bulk status changes, notes, policy configuration.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const changeLog = require('../change-log');
const mspAudit = require('../msp-audit');
const psa = require('../psa');

const router = express.Router();
router.use(auth.requireAuth);

/**
 * PSA close/note pass for a manual resolution (Feature 8.3, decision 5). For
 * each alert that has an open linked Autotask ticket: if the operator chose to
 * close it (closeTicket=true) close the ticket via the API + closing note; else
 * leave it open and append an informational note. Best-effort — a PSA failure
 * never blocks or reverses the in-app resolution. The bulk variant applies the
 * single choice to every affected ticket.
 *
 * @param {number[]} alertIds   alerts just transitioned to resolved/false_positive
 * @param {boolean}  closeTicket operator's modal choice
 * @param {object}   req         Express req (operator identity for audit)
 */
async function applyPsaResolutionChoice(alertIds, closeTicket, req) {
  if (!psa.isConfigured()) return;
  let linkMap;
  try {
    linkMap = await psa.store.getOpenLinksForAlertIds(alertIds);
  } catch (err) {
    console.warn(`[API] PSA link lookup failed during resolution (non-fatal): ${err.message}`);
    return;
  }
  if (linkMap.size === 0) return;
  const operator = req.session?.user?.email || null;
  // When closing, only act once per distinct ticket (a grouped ticket has many
  // linked alerts but one ticket). Note-only acts per open link.
  const closedTickets = new Set();
  for (const [alertId, link] of linkMap) {
    try {
      if (closeTicket) {
        if (closedTickets.has(link.ticket_id)) continue;
        closedTickets.add(link.ticket_id);
        await psa.closeTicketForAlert(link, { id: alertId, tenant_id: link.tenant_id }, operator, req);
      } else {
        await psa.noteTicketForAlert(link, 'psa.ticket.note.resolved_left_open', { alertId });
      }
    } catch (err) {
      console.warn(`[API] PSA resolution action failed for alert ${alertId} (non-fatal): ${err.message}`);
    }
  }
}

/**
 * Derive a change-log surface from an alert policy category. Alert categories
 * are mostly descriptive strings — the surface-taxonomy is coarser. We map
 * deliberately so the 60-min drift-attribution window in findAttributingChange
 * has a chance to match (an operator resolving a CA drift alert shouldn't
 * cause another CA drift alert to attribute to their click — but surface overlap
 * combined with category=alert_status_change makes that distinguishable in SQL).
 *
 * Apr 27, 2026 — extended to accept an optional policyName second argument.
 * Some alert types (notably SECURITY_DRIFT) share the generic 'config_changes'
 * category enum value with unrelated policies, so we can't disambiguate
 * surface from category alone. Passing policy_name when available lets us
 * route those to the correct surface for auto-attribution. Call sites that
 * don't have policy_name handy can omit it — behavior falls through to the
 * keyword logic below.
 */
function surfaceForAlertCategory(category, policyName) {
  // Specific policy-name matches FIRST (more precise than category keywords).
  if (policyName === 'Security Setting Drift Detected') {
    return changeLog.SURFACE.SECURITY_SETTING;
  }
  if (!category) return changeLog.SURFACE.OTHER;
  const c = String(category).toLowerCase();
  if (c.includes('conditional access') || c.includes('ca ') || c === 'ca') return changeLog.SURFACE.CA;
  if (c.includes('intune') || c.includes('device') || c.includes('compliance')) return changeLog.SURFACE.INTUNE;
  if (c.includes('mfa')) return changeLog.SURFACE.MFA;
  if (c.includes('identity') || c.includes('sign-in') || c.includes('signin')) return changeLog.SURFACE.IDENTITY;
  if (c.includes('sharepoint')) return changeLog.SURFACE.SHAREPOINT;
  if (c.includes('exchange') || c.includes('mail')) return changeLog.SURFACE.EXCHANGE;
  return changeLog.SURFACE.OTHER;
}

// ═══════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════

/**
 * GET /api/alerts — List alerts with filters.
 * Query params: tenant_id, severity, status, category, show_resolved, page, limit, date_from, date_to
 */
router.get('/', async (req, res) => {
  try {
    const {
      tenant_id,
      severity,
      status,
      category,
      show_resolved,
      page = 1,
      limit = 50,
      date_from,
      date_to,
    } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (tenant_id) {
      where += ' AND a.tenant_id = ?';
      params.push(parseInt(tenant_id, 10));
    }

    if (severity) {
      where += ' AND a.severity = ?';
      params.push(severity);
    }

    if (status && status !== 'all') {
      where += ' AND a.status = ?';
      params.push(status);
    } else if (show_resolved !== 'true') {
      // Default: exclude resolved and false_positive
      where += " AND a.status NOT IN ('resolved', 'false_positive')";
    }

    if (category) {
      where += ' AND p.category = ?';
      params.push(category);
    }

    if (date_from) {
      where += ' AND a.triggered_at >= ?';
      params.push(date_from);
    }

    if (date_to) {
      where += ' AND a.triggered_at <= ?';
      params.push(date_to);
    }

    const limitInt = Math.max(1, parseInt(limit, 10) || 50);
    const pageInt = Math.max(1, parseInt(page, 10) || 1);
    const offsetInt = (pageInt - 1) * limitInt;

    // Get total count for pagination
    const [countRow] = await db.queryRows(
      `SELECT COUNT(*) AS total
       FROM alerts a
       JOIN alert_policies p ON a.policy_id = p.id
       ${where}`,
      params
    );
    const total = countRow?.total || 0;

    // Get paginated results (LIMIT/OFFSET interpolated — safe integers, not bind params)
    // LEFT JOIN tenant_change_events to surface the auto-attributed change
    // breadcrumb in one round-trip (chip rendered in alert row when present).
    // Apr 30, 2026 — i18n Phase 6: extract message_template_key and
    // message_template_params from raw_data so the Alerts UI can re-render
    // the alert message in the operator's locale. Only set for alert types
    // that have been migrated to structured templates (security drift today;
    // expanding to other surfaces over time). raw_kind tells the UI which
    // schema to expect. Pulling specific JSON paths keeps the payload small —
    // we don't want to ship full raw_data for every row in the list.
    const alerts = await db.queryRows(
      `SELECT a.id, a.tenant_id, a.policy_id, a.severity, a.message, a.status,
              a.alert_scope, a.is_rollup, a.rollup_parent_id,
              a.email_sent, a.recurrence_count, a.last_seen_at, a.triggered_at,
              a.closed_at, a.dedup_key, a.auto_attributed_change_id,
              SUBSTRING(COALESCE(a.ai_analysis_en, ''), 1, 200) AS ai_summary,
              p.name AS policy_name, p.category,
              t.display_name AS tenant_name,
              tce.description AS attributed_change_description,
              tce.created_by   AS attributed_change_actor,
              tce.started_at   AS attributed_change_started_at,
              JSON_UNQUOTE(JSON_EXTRACT(a.raw_data, '$.kind')) AS raw_kind,
              JSON_UNQUOTE(JSON_EXTRACT(a.raw_data, '$.message_template_key')) AS message_template_key,
              JSON_EXTRACT(a.raw_data, '$.message_template_params') AS message_template_params
       FROM alerts a
       JOIN alert_policies p ON a.policy_id = p.id
       JOIN tenants t ON a.tenant_id = t.id
       LEFT JOIN tenant_change_events tce ON tce.id = a.auto_attributed_change_id
                                          AND tce.deleted_at IS NULL
       ${where}
       ORDER BY a.triggered_at DESC
       LIMIT ${limitInt} OFFSET ${offsetInt}`,
      params
    );

    res.json({
      alerts,
      pagination: {
        total,
        page: pageInt,
        limit: limitInt,
        pages: Math.ceil(total / limitInt),
      },
    });
  } catch (err) {
    console.error('[API] List alerts failed:', err.message);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

/**
 * GET /api/alerts/stats — Alert statistics for dashboard widgets.
 * Query params:
 *   tenant_id  — filter to one tenant
 *   range      — 'open' (default), 'new', '24h', '7d', '30d'
 *                'open' = all alerts currently in new/investigating (active)
 *                'new'  = only unacknowledged alerts (status='new') — drives the
 *                         header bell + sidebar "new alerts" badge
 *                time-based = all alerts (incl. resolved) within the window
 */
router.get('/stats', async (req, res) => {
  try {
    const { tenant_id, range } = req.query;
    let tenantFilter = '';
    const params = [];
    if (tenant_id) {
      tenantFilter = ' AND tenant_id = ?';
      params.push(parseInt(tenant_id, 10));
    }

    // Build the range condition
    let rangeCondition = '';
    // Time-range KPI counts exclude false_positive (dismissed noise) but KEEP
    // resolved (real handled history) — 2026-05-30. The 'open' default below
    // still hides both, which is correct for an active-alert view.
    if (range === '24h') {
      rangeCondition = " AND triggered_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND status <> 'false_positive'";
    } else if (range === '7d') {
      rangeCondition = " AND triggered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status <> 'false_positive'";
    } else if (range === '30d') {
      rangeCondition = " AND triggered_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND status <> 'false_positive'";
    } else if (range === 'new') {
      // Bell / sidebar "new alerts" badge — only genuinely NEW (unacknowledged)
      // detections. Marking an alert investigating (or resolving/dismissing it)
      // acknowledges it, so it drops off the badge. 2026-06-20.
      rangeCondition = " AND status = 'new'";
    } else {
      // 'open' (default) — only active alerts (new + investigating)
      rangeCondition = " AND status NOT IN ('resolved', 'false_positive')";
    }

    // is_rollup = 0 on every count — operator roll-ups are workflow objects,
    // not countable detections (Alert Merge, 2026-06-05). The merged children
    // remain the countable truth.
    const bySeverity = await db.queryRows(
      `SELECT severity, COUNT(*) AS cnt FROM alerts WHERE is_rollup = 0${tenantFilter}${rangeCondition} GROUP BY severity`,
      params
    );
    const byStatus = await db.queryRows(
      `SELECT status, COUNT(*) AS cnt FROM alerts WHERE is_rollup = 0${tenantFilter} GROUP BY status`,
      params
    );
    const recent = await db.queryRows(
      `SELECT COUNT(*) AS cnt FROM alerts WHERE is_rollup = 0 AND triggered_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND status <> 'false_positive'${tenantFilter}`,
      params
    );

    res.json({
      bySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r.cnt])),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
      last24h: recent[0]?.cnt || 0,
    });
  } catch (err) {
    console.error('[API] Alert stats failed:', err.message);
    res.status(500).json({ error: 'Failed to load alert stats' });
  }
});

// ═══════════════════════════════════════════
// ALERT POLICIES (before /:id to avoid route collision)
// ═══════════════════════════════════════════

/**
 * GET /api/alerts/policies/list — List all alert policies.
 */
router.get('/policies/list', async (req, res) => {
  try {
    // NB: hidden_from_ui = 1 filters out internal/telemetry-only policies
    // (e.g., Phase 8 repurposed donut-feed policies). See migrate-hidden-from-ui.sql.
    const policies = await db.queryRows(
      'SELECT * FROM alert_policies WHERE hidden_from_ui = 0 ORDER BY category, name'
    );
    res.json(policies);
  } catch (err) {
    console.error('[API] List policies failed:', err.message);
    res.status(500).json({ error: 'Failed to load policies' });
  }
});

/**
 * PUT /api/alerts/policies/:id — Update a policy configuration.
 *
 * MSP audit-logged (May 6, 2026): captures before/after for severity,
 * notification_target, notification_limit, enabled, detection_logic. Category
 * SETTINGS_CHANGE because alert policies ARE settings — operator changes are
 * the same audit-trail class as SMTP config or RBAC group mappings. Closes
 * the gap left over from the Apr 19 MSP audit log Phase 1 self-logging pass
 * which missed alert_policies.
 */
// A3 (May 9, 2026): admin-only — alert policy edit is tenant-wide config.
router.put('/policies/:id', auth.requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    // Snapshot before — needed for the audit-log diff. Cheap (single-row PK lookup).
    const before = await db.queryOne(
      'SELECT id, name, severity, notification_target, notification_limit, enabled, detection_logic FROM alert_policies WHERE id = ?',
      [req.params.id]
    );
    if (!before) return res.status(404).json({ error: 'Policy not found' });

    const affected = await db.execute(
      `UPDATE alert_policies SET
        severity = COALESCE(?, severity),
        notification_target = COALESCE(?, notification_target),
        notification_limit = COALESCE(?, notification_limit),
        enabled = COALESCE(?, enabled),
        detection_logic = COALESCE(?, detection_logic)
       WHERE id = ?`,
      [
        b.severity ?? null,
        b.notification_target ?? null,
        b.notification_limit != null ? parseInt(b.notification_limit, 10) : null,
        b.enabled ?? null,
        b.detection_logic ? JSON.stringify(b.detection_logic) : null,
        req.params.id,
      ]
    );

    if (affected === 0) return res.status(404).json({ error: 'Policy not found' });
    console.log(`[API] Policy ${req.params.id} updated by ${req.session.user.email}`);

    const updated = await db.queryOne('SELECT * FROM alert_policies WHERE id = ?', [req.params.id]);

    // Build a minimal field-level diff so the audit log captures intent, not
    // the entire row. Only include fields the client actually attempted to
    // change (b.<field> !== undefined) so we don't record "nothing changed"
    // noise on partial updates that happened to no-op a field.
    const diff = {};
    for (const k of ['severity', 'notification_target', 'notification_limit', 'enabled', 'detection_logic']) {
      if (b[k] !== undefined) {
        diff[k] = { before: before[k], after: updated[k] };
      }
    }

    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: 'alert_policy.update',
      description: `Updated alert policy "${before.name}"`,
      templateKey: 'alert_policy.update',
      templateParams: { name: before.name },
      targetType: 'alert_policy',
      targetId: String(before.id),
      targetName: before.name,
      metadata: { diff },
      req,
    }).catch(err => console.warn('[API] mspAudit.logMspAudit failed (non-blocking):', err.message));

    res.json(updated);
  } catch (err) {
    console.error('[API] Update policy failed:', err.message);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

/**
 * PATCH /api/alerts/policies/:id/toggle — Enable/disable a policy.
 *
 * MSP audit-logged (May 6, 2026). Toggles are the most common alert-policy
 * mutation an operator will make (silencing a noisy detection, re-enabling
 * after investigation), so they deserve first-class audit coverage. Same
 * SETTINGS_CHANGE category as the PUT endpoint.
 */
// A3 (May 9, 2026): admin-only — alert policy enable/disable is tenant-wide.
router.patch('/policies/:id/toggle', auth.requireAdmin, async (req, res) => {
  try {
    const policy = await db.queryOne('SELECT id, enabled, name FROM alert_policies WHERE id = ?', [req.params.id]);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const newState = !policy.enabled;
    await db.execute('UPDATE alert_policies SET enabled = ? WHERE id = ?', [newState, req.params.id]);

    console.log(`[API] Policy "${policy.name}" ${newState ? 'enabled' : 'disabled'} by ${req.session.user.email}`);

    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.SETTINGS_CHANGE,
      action: newState ? 'alert_policy.enable' : 'alert_policy.disable',
      description: `${newState ? 'Enabled' : 'Disabled'} alert policy "${policy.name}"`,
      templateKey: newState ? 'alert_policy.enable' : 'alert_policy.disable',
      templateParams: { name: policy.name },
      targetType: 'alert_policy',
      targetId: String(policy.id),
      targetName: policy.name,
      metadata: { diff: { enabled: { before: !!policy.enabled, after: newState } } },
      req,
    }).catch(err => console.warn('[API] mspAudit.logMspAudit failed (non-blocking):', err.message));

    res.json({ id: policy.id, enabled: newState });
  } catch (err) {
    console.error('[API] Toggle policy failed:', err.message);
    res.status(500).json({ error: 'Failed to toggle policy' });
  }
});

/**
 * GET /api/alerts/rollups?tenant_id=<id>&status=open — open roll-ups for a
 * tenant, used to populate the "Add to Roll-up" picker (2026-06-29). Read-only;
 * router-level requireAuth covers it (any authenticated role may list — the
 * write controls are gated separately). child_count is the actual number of
 * cross-linked children (rollup_parent_id), type-independent of the raw_data
 * JSON denormalization.
 *
 * MUST be declared before GET /:id, or ":id" would swallow "rollups".
 */
router.get('/rollups', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: 'tenant_id required' });
    }
    const rows = await db.queryRows(
      `SELECT a.id, a.message, a.severity,
              (SELECT COUNT(*) FROM alerts c WHERE c.rollup_parent_id = a.id) AS child_count
         FROM alerts a
        WHERE a.is_rollup = 1 AND a.tenant_id = ? AND a.status IN ('new','investigating')
        ORDER BY a.triggered_at DESC`,
      [tenantId]
    );
    res.json({
      rollups: rows.map(r => ({
        id: r.id,
        message: r.message,
        severity: r.severity,
        child_count: Number(r.child_count) || 0,
      })),
    });
  } catch (err) {
    console.error('[API] List roll-ups failed:', err.message);
    res.status(500).json({ error: 'Failed to list roll-ups' });
  }
});

/**
 * GET /api/alerts/:id — Full alert detail.
 *
 * Phase 9a (May 2, 2026): the slideout passes `?lang=en|fr|es` so the
 * server can pick the right `ai_analysis_<lang>` column and return it
 * as the legacy `ai_analysis` field the UI already reads. Pre-cutover
 * rows have NULL fr/es columns — we fall back to ai_analysis_en in
 * that case (better English-only than empty). If lang is missing or
 * unrecognized, we default to English.
 */
router.get('/:id', async (req, res) => {
  try {
    const requestedLang = (req.query.lang || 'en').toString().toLowerCase();
    const lang = ['en', 'fr', 'es'].includes(requestedLang) ? requestedLang : 'en';

    // LEFT JOIN the roll-up parent so a merged child can render its
    // "Rolled up into → <parent title>" banner without a second fetch
    // (Alert Merge, 2026-06-05). NULL for any non-child alert.
    const alert = await db.queryOne(
      `SELECT a.*, p.name AS policy_name, p.category, p.description AS policy_description,
              t.display_name AS tenant_name,
              tce.description AS attributed_change_description,
              tce.created_by   AS attributed_change_actor,
              tce.started_at   AS attributed_change_started_at,
              tce.category     AS attributed_change_category,
              par.message      AS rollup_parent_message
       FROM alerts a
       JOIN alert_policies p ON a.policy_id = p.id
       JOIN tenants t ON a.tenant_id = t.id
       LEFT JOIN tenant_change_events tce ON tce.id = a.auto_attributed_change_id
                                          AND tce.deleted_at IS NULL
       LEFT JOIN alerts par ON par.id = a.rollup_parent_id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Pick the locale column the operator asked for, with English fallback
    // for older rows that pre-date Phase 9a (fr/es columns NULL).
    const localized = lang === 'fr' ? alert.ai_analysis_fr
                    : lang === 'es' ? alert.ai_analysis_es
                    : alert.ai_analysis_en;
    alert.ai_analysis = localized || alert.ai_analysis_en || null;

    // Parse raw_data JSON
    try {
      alert.raw_data = JSON.parse(alert.raw_data);
    } catch { /* already parsed or non-JSON */ }

    res.json(alert);
  } catch (err) {
    console.error('[API] Get alert failed:', err.message);
    res.status(500).json({ error: 'Failed to load alert' });
  }
});

/**
 * PATCH /api/alerts/:id/status — Change alert status.
 */
// A3 (May 9, 2026): operator — ack/clear individual alerts.
router.patch('/:id/status', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { status, closeTicket } = req.body;
    const validStatuses = ['new', 'investigating', 'resolved', 'false_positive'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Fetch pre-update context for audit (tenant, prior status, policy category).
    const alertCtx = await db.queryOne(
      `SELECT a.tenant_id, a.status AS prior_status, p.name AS policy_name, p.category
         FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
        WHERE a.id = ?`,
      [req.params.id]
    );
    if (!alertCtx) return res.status(404).json({ error: 'Alert not found' });

    const closedAt = (status === 'resolved' || status === 'false_positive') ? 'NOW()' : 'NULL';
    const affected = await db.execute(
      `UPDATE alerts SET status = ?, closed_at = ${closedAt} WHERE id = ?`,
      [status, req.params.id]
    );

    if (affected === 0) return res.status(404).json({ error: 'Alert not found' });
    console.log(`[API] Alert ${req.params.id} status → ${status} by ${req.session.user.email}`);

    // PSA close/note pass (Feature 8.3, decision 5) — only on a real resolution.
    if (status === 'resolved' || status === 'false_positive') {
      await applyPsaResolutionChoice([parseInt(req.params.id, 10)], closeTicket === true, req);
    }

    // Audit only meaningful transitions (new→new is a noop write; skip).
    if (alertCtx.prior_status !== status) {
      try {
        await changeLog.logPanopticaChange({
          tenantId: alertCtx.tenant_id,
          category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
          surfaces: [surfaceForAlertCategory(alertCtx.category, alertCtx.policy_name)],
          description: `Alert #${req.params.id} "${alertCtx.policy_name}" — status ${alertCtx.prior_status} → ${status}`,
          templateKey: 'alert_status.single',
          templateParams: { newStatus: status, alertId: req.params.id, policyName: alertCtx.policy_name, priorStatus: alertCtx.prior_status },
          createdBy: req.session.user.email,
          ...changeLog.captureActorContext(req),
        });
      } catch (logErr) {
        console.warn(`[API] Alert-status audit log failed (non-fatal): ${logErr.message}`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Update alert status failed:', err.message);
    res.status(500).json({ error: 'Failed to update alert status' });
  }
});

/**
 * POST /api/alerts/:id/revert-ai-severity — Restore rule-based severity.
 *
 * When Haiku downgrades an alert's severity (e.g., SEVERE → INFO on a benign
 * error 50097 interrupt), the original rule verdict is preserved in
 * `rule_severity`. This endpoint lets an operator revert to that rule verdict
 * if they disagree with the AI adjustment. Clears `ai_severity_reason` so the
 * UI no longer shows the adjustment badge.
 *
 * No-op (returns 200 with `reverted: false`) if the alert was never adjusted
 * (severity already equals rule_severity, or rule_severity is NULL).
 */
// A3 (May 9, 2026): operator — undo AI severity adjustment on a single alert.
router.post('/:id/revert-ai-severity', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const alert = await db.queryOne(
      `SELECT a.id, a.severity, a.rule_severity, a.tenant_id, a.ai_severity_reason,
              p.name AS policy_name, p.category
         FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
        WHERE a.id = ?`,
      [req.params.id]
    );
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    if (!alert.rule_severity || alert.rule_severity === alert.severity) {
      return res.json({ reverted: false, severity: alert.severity });
    }

    await db.execute(
      'UPDATE alerts SET severity = ?, ai_severity_reason = NULL WHERE id = ?',
      [alert.rule_severity, req.params.id]
    );

    console.log(
      `[API] Alert ${req.params.id} severity reverted ${alert.severity} → ${alert.rule_severity} by ${req.session.user.email}`
    );

    // Audit — operator explicitly rejected an AI severity adjustment. This is
    // a non-trivial governance signal: every revert is a vote of no-confidence
    // in the Haiku severity-downgrade, and the signal needs to survive in the
    // tenant timeline so we can review patterns (are certain error codes
    // getting downgraded when they shouldn't be?).
    try {
      await changeLog.logPanopticaChange({
        tenantId: alert.tenant_id,
        category: changeLog.CATEGORY.AI_SEVERITY_REVERT,
        surfaces: [surfaceForAlertCategory(alert.category, alert.policy_name)],
        description: `Reverted AI severity on alert #${req.params.id} "${alert.policy_name}" — ${alert.severity} → ${alert.rule_severity} (AI reason cleared)`,
        templateKey: 'ai_severity_revert',
        templateParams: { alertId: req.params.id, policyName: alert.policy_name, fromSeverity: alert.severity, toSeverity: alert.rule_severity },
        createdBy: req.session.user.email,
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[API] AI-severity-revert audit log failed (non-fatal): ${logErr.message}`);
    }

    res.json({ reverted: true, severity: alert.rule_severity });
  } catch (err) {
    console.error('[API] Revert AI severity failed:', err.message);
    res.status(500).json({ error: 'Failed to revert severity' });
  }
});

/**
 * PATCH /api/alerts/:id/notes — Update alert notes (Quill HTML).
 */
// A3 (May 9, 2026): operator — alert notes.
router.patch('/:id/notes', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { notes } = req.body;

    // Fetch pre-update context — tenant + prior notes for change detection.
    // We log an audit row only when notes content actually changed (avoids
    // noise from UI re-saves of the same HTML).
    const alertCtx = await db.queryOne(
      `SELECT a.tenant_id, a.notes AS prior_notes, p.name AS policy_name, p.category
         FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
        WHERE a.id = ?`,
      [req.params.id]
    );
    if (!alertCtx) return res.status(404).json({ error: 'Alert not found' });

    const normalize = v => (v == null ? '' : String(v));
    const notesChanged = normalize(notes) !== normalize(alertCtx.prior_notes);

    const affected = await db.execute(
      'UPDATE alerts SET notes = ? WHERE id = ?',
      [notes ?? null, req.params.id]
    );

    if (affected === 0) return res.status(404).json({ error: 'Alert not found' });

    if (notesChanged) {
      try {
        // Describe the action — not the note content. We deliberately do NOT
        // store the note HTML in the audit log; notes can contain operator
        // speculation or customer-sensitive prose, and the audit row is
        // intended as a "who touched this, when" record. The note itself is
        // versioned implicitly by the UI (current state in alerts.notes).
        const priorLen = normalize(alertCtx.prior_notes).length;
        const newLen = normalize(notes).length;
        const verb = priorLen === 0 && newLen > 0 ? 'Added'
          : newLen === 0 && priorLen > 0 ? 'Cleared'
          : 'Edited';
        await changeLog.logPanopticaChange({
          tenantId: alertCtx.tenant_id,
          category: changeLog.CATEGORY.ALERT_NOTE,
          surfaces: [surfaceForAlertCategory(alertCtx.category, alertCtx.policy_name)],
          description: `${verb} notes on alert #${req.params.id} "${alertCtx.policy_name}" (${newLen} char${newLen === 1 ? '' : 's'})`,
          templateKey: 'alert_note',
          templateParams: { alertId: req.params.id, policyName: alertCtx.policy_name, verb, charCount: newLen },
          createdBy: req.session.user.email,
          ...changeLog.captureActorContext(req),
        });
      } catch (logErr) {
        console.warn(`[API] Alert-note audit log failed (non-fatal): ${logErr.message}`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Update alert notes failed:', err.message);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

/**
 * POST /api/alerts/bulk-status — Bulk status change.
 * Body: { alert_ids: [1, 2, 3], status: 'resolved' }
 */
// A3 (May 9, 2026): operator — bulk ack/clear.
router.post('/bulk-status', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { alert_ids, status, closeTicket } = req.body;
    const validStatuses = ['new', 'investigating', 'resolved', 'false_positive'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
      return res.status(400).json({ error: 'No alert IDs provided' });
    }

    const intIds = alert_ids.map(id => parseInt(id, 10));
    const placeholders = intIds.map(() => '?').join(',');

    // Fetch tenant breakdown BEFORE the update so we can emit one audit row
    // per tenant (not N per alert — that would flood the Change Log). We
    // only audit alerts whose status actually changes (prior != new).
    const preUpdate = await db.queryRows(
      `SELECT a.id, a.tenant_id, a.status AS prior_status, p.category, p.name AS policy_name
         FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
        WHERE a.id IN (${placeholders})`,
      intIds
    );

    const closedAt = (status === 'resolved' || status === 'false_positive') ? 'NOW()' : 'NULL';
    const affected = await db.execute(
      `UPDATE alerts SET status = ?, closed_at = ${closedAt} WHERE id IN (${placeholders})`,
      [status, ...intIds]
    );

    console.log(`[API] Bulk status change: ${alert_ids.length} alerts → ${status} by ${req.session.user.email}`);

    // PSA close/note pass (Feature 8.3, decision 5) — the modal asked once;
    // apply the single choice to every affected ticket. Only on real resolution.
    if (status === 'resolved' || status === 'false_positive') {
      await applyPsaResolutionChoice(intIds, closeTicket === true, req);
    }

    // Group audit-worthy changes by tenant. Skip alerts already at target status.
    const byTenant = new Map(); // tenant_id -> { count, surfaces:Set, sampleIds:[] }
    for (const r of preUpdate) {
      if (r.prior_status === status) continue;
      const key = r.tenant_id;
      let bucket = byTenant.get(key);
      if (!bucket) {
        bucket = { count: 0, surfaces: new Set(), sampleIds: [] };
        byTenant.set(key, bucket);
      }
      bucket.count += 1;
      bucket.surfaces.add(surfaceForAlertCategory(r.category, r.policy_name));
      if (bucket.sampleIds.length < 3) bucket.sampleIds.push(r.id);
    }
    const actorCtx = changeLog.captureActorContext(req);
    for (const [tenantId, bucket] of byTenant) {
      try {
        const idHint = bucket.count <= 3
          ? `alert${bucket.count === 1 ? '' : 's'} #${bucket.sampleIds.join(', #')}`
          : `alerts #${bucket.sampleIds.join(', #')} and ${bucket.count - 3} more`;
        await changeLog.logPanopticaChange({
          tenantId,
          category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
          surfaces: Array.from(bucket.surfaces),
          description: `Bulk status change → ${status}: ${bucket.count} ${idHint}`,
          templateKey: 'alert_status.bulk',
          templateParams: { newStatus: status, countLabel: `${bucket.count} ${idHint}` },
          createdBy: req.session.user.email,
          ...actorCtx,
        });
      } catch (logErr) {
        console.warn(`[API] Bulk-status audit log (tenant ${tenantId}) failed (non-fatal): ${logErr.message}`);
      }
    }

    res.json({ success: true, affected });
  } catch (err) {
    console.error('[API] Bulk status change failed:', err.message);
    res.status(500).json({ error: 'Failed to update alerts' });
  }
});

/**
 * GET /api/alerts/:id/psa-link — PSA ticket link for one alert (chip rendering).
 * Returns { linked, ticket_id, ticket_number, state, web_url } — linked=false
 * when there is no link row or PSA is off.
 */
router.get('/:id/psa-link', async (req, res) => {
  try {
    if (!psa.isConfigured()) return res.json({ linked: false });
    const link = await psa.store.getLinkForAlert(parseInt(req.params.id, 10));
    if (!link) return res.json({ linked: false });
    res.json({
      linked: true,
      ticket_id: Number(link.ticket_id),
      ticket_number: link.ticket_number || null,
      state: link.state,
      web_url: psa.ticketWebUrl(link.ticket_id),
    });
  } catch (err) {
    console.error('[API] psa-link lookup failed:', err.message);
    res.json({ linked: false });
  }
});

/**
 * POST /api/alerts/psa-links — open links for a set of alert ids (modal gating).
 * Body: { alert_ids: [..] }. Returns { links: { <alertId>: {ticket_number,
 * ticket_id, state, web_url} } } for alerts that have an OPEN linked ticket.
 * Used to decide whether the resolve flow shows the "close ticket?" modal.
 */
router.post('/psa-links', async (req, res) => {
  try {
    if (!psa.isConfigured()) return res.json({ links: {} });
    const ids = Array.isArray(req.body.alert_ids) ? req.body.alert_ids : [];
    const map = await psa.store.getOpenLinksForAlertIds(ids);
    const links = {};
    for (const [alertId, link] of map) {
      links[alertId] = {
        ticket_id: Number(link.ticket_id),
        ticket_number: link.ticket_number || null,
        state: link.state,
        web_url: psa.ticketWebUrl(link.ticket_id),
      };
    }
    res.json({ links });
  } catch (err) {
    console.error('[API] psa-links lookup failed:', err.message);
    res.json({ links: {} });
  }
});

/**
 * POST /api/alerts/bulk-status-filtered — Bulk status change for all matching alerts.
 * Body: { filters: { tenant_id, severity, status, category, show_resolved, date_from, date_to }, new_status: 'resolved' }
 * Used for "Select all X matching alerts" pattern.
 */
// A3 (May 9, 2026): operator — bulk ack/clear filtered.
router.post('/bulk-status-filtered', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const { filters, new_status } = req.body;
    const validStatuses = ['new', 'investigating', 'resolved', 'false_positive'];
    if (!validStatuses.includes(new_status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Build WHERE for the SELECT (used to gather tenant context PRE-update).
    // The UPDATE also uses the same WHERE — both need the same params but the
    // UPDATE prepends the new_status, so we keep two separate param arrays.
    let where = 'WHERE 1=1';
    const selectParams = [];

    if (filters.tenant_id) {
      where += ' AND a.tenant_id = ?';
      selectParams.push(parseInt(filters.tenant_id, 10));
    }
    if (filters.severity) {
      where += ' AND a.severity = ?';
      selectParams.push(filters.severity);
    }
    if (filters.status && filters.status !== 'all') {
      where += ' AND a.status = ?';
      selectParams.push(filters.status);
    } else if (filters.show_resolved !== 'true') {
      where += " AND a.status NOT IN ('resolved', 'false_positive')";
    }
    if (filters.category) {
      where += ' AND p.category = ?';
      selectParams.push(filters.category);
    }
    if (filters.date_from) {
      where += ' AND a.triggered_at >= ?';
      selectParams.push(filters.date_from);
    }
    if (filters.date_to) {
      where += ' AND a.triggered_at <= ?';
      selectParams.push(filters.date_to);
    }

    // Pre-update context for audit. Limited to id/tenant/prior_status/category —
    // any filter could return thousands of rows, so we cap at 5000 rows of
    // context gathering (sane upper bound; MSP-scale bulk ops are usually
    // hundreds, not thousands). If capped, we still issue the UPDATE fully
    // and emit a single-row log noting the cap.
    const preUpdate = await db.queryRows(
      `SELECT a.id, a.tenant_id, a.status AS prior_status, p.category, p.name AS policy_name
         FROM alerts a JOIN alert_policies p ON a.policy_id = p.id
         ${where}
         LIMIT 5000`,
      selectParams
    );

    const closedAt = (new_status === 'resolved' || new_status === 'false_positive') ? 'NOW()' : 'NULL';
    const affected = await db.execute(
      `UPDATE alerts a JOIN alert_policies p ON a.policy_id = p.id
       SET a.status = ?, a.closed_at = ${closedAt}
       ${where}`,
      [new_status, ...selectParams]
    );

    console.log(`[API] Bulk filtered status change: ${affected} alerts → ${new_status} by ${req.session.user.email}`);

    // PSA pass (Feature 8.3). The "select all matching" flow has no per-ticket
    // modal — closing potentially hundreds of customer tickets from one filter
    // click is too blunt — so linked tickets are LEFT OPEN with an informational
    // note (closeTicket=false). The tech closes them deliberately in Autotask.
    if (new_status === 'resolved' || new_status === 'false_positive') {
      await applyPsaResolutionChoice(preUpdate.map(r => r.id), false, req);
    }

    // Same grouping as /bulk-status.
    const byTenant = new Map();
    for (const r of preUpdate) {
      if (r.prior_status === new_status) continue;
      const key = r.tenant_id;
      let bucket = byTenant.get(key);
      if (!bucket) {
        bucket = { count: 0, surfaces: new Set(), sampleIds: [] };
        byTenant.set(key, bucket);
      }
      bucket.count += 1;
      bucket.surfaces.add(surfaceForAlertCategory(r.category, r.policy_name));
      if (bucket.sampleIds.length < 3) bucket.sampleIds.push(r.id);
    }
    const actorCtx = changeLog.captureActorContext(req);
    const capNote = preUpdate.length >= 5000 ? ' [audit context capped at 5000 rows]' : '';
    for (const [tenantId, bucket] of byTenant) {
      try {
        const idHint = bucket.count <= 3
          ? `alert${bucket.count === 1 ? '' : 's'} #${bucket.sampleIds.join(', #')}`
          : `alerts #${bucket.sampleIds.join(', #')} and ${bucket.count - 3} more`;
        await changeLog.logPanopticaChange({
          tenantId,
          category: changeLog.CATEGORY.ALERT_STATUS_CHANGE,
          surfaces: Array.from(bucket.surfaces),
          description: `Filtered bulk status change → ${new_status}: ${bucket.count} ${idHint}${capNote}`,
          templateKey: 'alert_status.bulk',
          templateParams: { newStatus: new_status, countLabel: `${bucket.count} ${idHint}${capNote}` },
          createdBy: req.session.user.email,
          ...actorCtx,
        });
      } catch (logErr) {
        console.warn(`[API] Bulk-filtered audit log (tenant ${tenantId}) failed (non-fatal): ${logErr.message}`);
      }
    }

    res.json({ success: true, affected });
  } catch (err) {
    console.error('[API] Bulk filtered status change failed:', err.message);
    res.status(500).json({ error: 'Failed to update alerts' });
  }
});

/**
 * POST /api/alerts/rollup — Manual roll-up (Alert Merge, 2026-06-05).
 *
 * Merges N open alerts for ONE tenant into a single operator-created roll-up
 * "parent" alert used to track the investigation. The originals become the
 * roll-up's children: resolved with resolution_reason='rolled_up' and
 * rollup_parent_id set. The parent is inserted directly (NOT via
 * alertEngine.processNewAlert), which is what keeps Haiku + the notifier out
 * of the path — the children already got their analysis and email.
 *
 * Body: { alert_ids: [int, …], title: "string" }
 * Stable 400 error codes (frontend maps to localized toasts):
 *   too_few | empty_title | title_too_long | not_found | multi_tenant
 *   | not_open | nested_rollup
 *
 * Response: { id: <parent id> }.
 */
// A3: operator — merging alerts is an alert-triage action (same tier as
// bulk-status), matching the data-role-required="member" Merge button.
router.post('/rollup', auth.requireMemberOrAdmin, async (req, res) => {
  // Severity ordering for "max severity among children".
  const SEV_RANK = { info: 0, low: 1, medium: 2, high: 3, severe: 4 };
  // Throw a tagged error the catch block turns into a stable 400 code.
  const reject = (code) => { const e = new Error(code); e.rollupCode = code; throw e; };

  try {
    const { alert_ids, title } = req.body;

    // Validate ids: coerce to positive ints, dedupe, require ≥ 2.
    const ids = Array.isArray(alert_ids)
      ? [...new Set(alert_ids.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0))]
      : [];
    if (ids.length < 2) return res.status(400).json({ error: 'too_few' });

    // Validate title.
    const cleanTitle = (typeof title === 'string' ? title : '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'empty_title' });
    if (cleanTitle.length > 512) return res.status(400).json({ error: 'title_too_long' });

    const placeholders = ids.map(() => '?').join(',');

    const result = await db.withTransaction(async (conn) => {
      // Lock the candidate rows for the duration of the merge so a concurrent
      // status change / second merge can't race us into an inconsistent state.
      const [rows] = await conn.execute(
        `SELECT a.id, a.tenant_id, a.policy_id, a.severity, a.status, a.is_rollup,
                a.message, t.display_name AS tenant_name
           FROM alerts a
           JOIN tenants t ON a.tenant_id = t.id
          WHERE a.id IN (${placeholders})
          FOR UPDATE`,
        ids
      );

      if (rows.length !== ids.length) reject('not_found');            // some id missing
      if (new Set(rows.map(r => r.tenant_id)).size > 1) reject('multi_tenant');
      if (rows.some(r => r.status !== 'new' && r.status !== 'investigating')) reject('not_open');
      if (rows.some(r => r.is_rollup)) reject('nested_rollup');       // no roll-ups of roll-ups (v1)

      const tenantId = rows[0].tenant_id;
      const tenantName = rows[0].tenant_name;

      // Highest-severity child wins severity + lends its policy_id (ties → first
      // selected; we iterate in the order ids arrived). Reusing the dominant
      // child's policy_id gives the dashboard a correct category chip without a
      // synthetic alert_policies row (its category is a strict ENUM).
      let dominant = rows[0];
      for (const r of rows) {
        if (SEV_RANK[r.severity] > SEV_RANK[dominant.severity]) dominant = r;
      }

      const childIds = rows.map(r => r.id);
      const rawData = JSON.stringify({
        rollup: true,
        child_alert_ids: childIds,
        // Denormalized child titles/severities so the detail panel renders the
        // child list without N extra fetches.
        children: rows.map(r => ({ id: r.id, message: r.message, severity: r.severity })),
      });

      // Parent: direct INSERT. status='new', dedup_key NULL (never dedup-matches),
      // is_rollup=1, email_sent=1 (defensive — nothing downstream should email it).
      // ai_analysis_* left NULL — the panel renders the child list instead.
      // NOW() for triggered_at matches every other alert insert + the closed_at
      // convention in this file (status/bulk endpoints use NOW()).
      const [ins] = await conn.execute(
        `INSERT INTO alerts (tenant_id, policy_id, severity, message, raw_data,
                             status, dedup_key, is_rollup, email_sent,
                             recurrence_count, triggered_at)
         VALUES (?, ?, ?, ?, ?, 'new', NULL, 1, 1, 1, NOW())`,
        [tenantId, dominant.policy_id, dominant.severity, cleanTitle, rawData]
      );
      const parentId = ins.insertId;

      // Children: resolve + cross-link. tenant_id guard is belt-and-suspenders
      // (already validated single-tenant above).
      await conn.execute(
        `UPDATE alerts
            SET status='resolved', resolution_reason='rolled_up',
                rollup_parent_id=?, closed_at=NOW()
          WHERE id IN (${placeholders}) AND tenant_id=?`,
        [parentId, ...ids, tenantId]
      );

      return { parentId, count: childIds.length, tenantName, tenantId };
    });

    console.log(`[API] Alert roll-up #${result.parentId}: merged ${result.count} alerts (tenant=${result.tenantName}) by ${req.session.user.email}`);

    // Audit (non-blocking, Phase 11 pattern). OTHER category — a roll-up is an
    // operator alert-triage action, not a settings/template/RBAC change.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.OTHER,
      action: 'alert_rollup.create',
      templateKey: 'alert_rollup.create',
      templateParams: { count: result.count, tenantName: result.tenantName, title: cleanTitle },
      description: `Merged ${result.count} alerts into roll-up #${result.parentId} "${cleanTitle}" (${result.tenantName})`,
      targetType: 'alert',
      targetId: String(result.parentId),
      targetName: cleanTitle,
      metadata: { childCount: result.count },
      req,
    }).catch(err => console.warn('[API] mspAudit.logMspAudit (alert_rollup.create) failed (non-blocking):', err.message));

    // PSA roll-up consolidation (Feature 8.3, 2026-06-09 — supersedes the
    // original §4.1 "link only when one shared ticket" rule, which orphaned
    // child tickets whenever the merged alerts spanned multiple tickets).
    // Autotask has no merge API, so emulate it: keep the oldest child ticket as
    // the survivor, rename it to the roll-up title + link it to the parent, and
    // auto-close the rest with a pointer. Best-effort — never breaks the merge.
    if (psa.isConfigured()) {
      try {
        await psa.consolidateRollupTickets(ids, {
          parentAlertId: result.parentId,
          parentTenantId: result.tenantId,
          title: cleanTitle,
          operatorEmail: req.session?.user?.email || null,
        });
      } catch (err) {
        console.warn(`[API] PSA roll-up consolidation for parent #${result.parentId} failed (non-fatal): ${err.message}`);
      }
    }

    res.json({ id: result.parentId });
  } catch (err) {
    if (err && err.rollupCode) {
      return res.status(400).json({ error: err.rollupCode });
    }
    console.error('[API] Alert roll-up failed:', err.message);
    res.status(500).json({ error: 'Failed to merge alerts' });
  }
});

/**
 * POST /api/alerts/rollup/:parentId/children — Add alerts to an EXISTING open
 * roll-up (2026-06-29, extends Alert Merge). The operator-chosen open alerts
 * become children of the roll-up: resolved with resolution_reason='rolled_up'
 * and rollup_parent_id=<parent>, exactly like create-time merge. The parent's
 * denormalized children blob is appended to, and its severity rises to
 * max(parent, added) — never lowers, policy_id untouched. Like /rollup the
 * parent never enters processNewAlert (no Haiku, no email); the children already
 * got theirs. Purely manual grouping — no affinity/dedup matching.
 *
 * Body: { alert_ids: [int, …] }
 * Stable 400 codes (frontend → localized toasts):
 *   parent_not_found | parent_not_open | too_few | not_found | multi_tenant
 *   | not_addable
 * Response: { id: <parentId>, added: <count> }.
 */
// A2/A3: adding to a roll-up is an alert-triage action (member tier), matching
// the data-role-required="member" Add controls.
router.post('/rollup/:parentId/children', auth.requireMemberOrAdmin, async (req, res) => {
  const SEV_RANK = { info: 0, low: 1, medium: 2, high: 3, severe: 4 };
  const reject = (code) => { const e = new Error(code); e.rollupCode = code; throw e; };

  try {
    const parentId = parseInt(req.params.parentId, 10);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return res.status(400).json({ error: 'parent_not_found' });
    }

    // Candidate ids: coerce to positive ints, dedupe, drop the parent itself,
    // require ≥ 1.
    const ids = Array.isArray(req.body?.alert_ids)
      ? [...new Set(req.body.alert_ids
          .map(n => parseInt(n, 10))
          .filter(n => Number.isInteger(n) && n > 0 && n !== parentId))]
      : [];
    if (ids.length < 1) return res.status(400).json({ error: 'too_few' });

    const placeholders = ids.map(() => '?').join(',');

    const result = await db.withTransaction(async (conn) => {
      // Lock the parent roll-up for the duration of the add.
      const [prows] = await conn.execute(
        `SELECT a.id, a.tenant_id, a.severity, a.status, a.is_rollup, a.message,
                a.raw_data, t.display_name AS tenant_name
           FROM alerts a
           JOIN tenants t ON a.tenant_id = t.id
          WHERE a.id = ?
          FOR UPDATE`,
        [parentId]
      );
      // Missing OR not actually a roll-up → parent_not_found; closed → parent_not_open.
      if (prows.length === 0 || !prows[0].is_rollup) reject('parent_not_found');
      const parent = prows[0];
      if (parent.status !== 'new' && parent.status !== 'investigating') reject('parent_not_open');

      const tenantId = parent.tenant_id;
      const tenantName = parent.tenant_name;

      // Lock the candidate rows.
      const [rows] = await conn.execute(
        `SELECT id, tenant_id, severity, status, is_rollup, rollup_parent_id, message
           FROM alerts
          WHERE id IN (${placeholders})
          FOR UPDATE`,
        ids
      );

      if (rows.length !== ids.length) reject('not_found');             // some id missing
      if (rows.some(r => r.tenant_id !== tenantId)) reject('multi_tenant');
      // Each candidate must be an addable OPEN alert: open status, not itself a
      // roll-up, and not already a child of another roll-up.
      if (rows.some(r =>
        (r.status !== 'new' && r.status !== 'investigating') ||
        r.is_rollup ||
        r.rollup_parent_id != null
      )) reject('not_addable');

      // Children: resolve + cross-link. The rollup_parent_id IS NULL + is_rollup=0
      // guards are the final backstop against a race (candidate merged into two
      // roll-ups, or resolved elsewhere between the lock and here).
      await conn.execute(
        `UPDATE alerts
            SET status='resolved', resolution_reason='rolled_up',
                rollup_parent_id=?, closed_at=NOW()
          WHERE id IN (${placeholders}) AND tenant_id=?
            AND rollup_parent_id IS NULL AND is_rollup=0`,
        [parentId, ...ids, tenantId]
      );

      // Parent: append the denormalized children blob + bump severity. Read-
      // modify-write under the FOR UPDATE lock so concurrent adds can't clobber
      // each other's children. raw_data is a JSON column → mysql2 hands it back
      // parsed; tolerate a string too (defensive).
      let raw = parent.raw_data;
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
      raw = (raw && typeof raw === 'object') ? raw : {};
      const existingChildren = Array.isArray(raw.children) ? raw.children : [];
      const existingIds = Array.isArray(raw.child_alert_ids)
        ? raw.child_alert_ids
        : existingChildren.map(c => c.id);
      const addedChildren = rows.map(r => ({ id: r.id, message: r.message, severity: r.severity }));
      raw.rollup = true;
      raw.children = [...existingChildren, ...addedChildren];
      raw.child_alert_ids = [...new Set([...existingIds, ...rows.map(r => r.id)])];

      let newSeverity = parent.severity;
      for (const r of rows) {
        if ((SEV_RANK[r.severity] ?? 0) > (SEV_RANK[newSeverity] ?? 0)) newSeverity = r.severity;
      }

      await conn.execute(
        `UPDATE alerts SET severity=?, raw_data=? WHERE id=? AND is_rollup=1`,
        [newSeverity, JSON.stringify(raw), parentId]
      );

      return {
        parentId, count: rows.length, tenantId, tenantName,
        parentMessage: parent.message, addedIds: rows.map(r => r.id),
      };
    });

    console.log(`[API] Alert roll-up #${result.parentId}: added ${result.count} alert(s) (tenant=${result.tenantName}) by ${req.session.user.email}`);

    // Audit (non-blocking, Phase 11 pattern). OTHER category — an alert-triage action.
    mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.OTHER,
      action: 'alert_rollup.add',
      templateKey: 'alert_rollup.add',
      templateParams: { count: result.count, tenantName: result.tenantName, title: result.parentMessage },
      description: `Added ${result.count} alert(s) to roll-up #${result.parentId} "${result.parentMessage}" (${result.tenantName})`,
      targetType: 'alert',
      targetId: String(result.parentId),
      targetName: result.parentMessage,
      metadata: { addedCount: result.count },
      req,
    }).catch(err => console.warn('[API] mspAudit.logMspAudit (alert_rollup.add) failed (non-blocking):', err.message));

    // PSA — append the added children to the roll-up's EXISTING survivor ticket;
    // never open new tickets. Best-effort — never breaks the add.
    if (psa.isConfigured()) {
      try {
        await psa.appendToRollupTicket(result.parentId, result.addedIds, {
          parentTenantId: result.tenantId,
          title: result.parentMessage,
          operatorEmail: req.session?.user?.email || null,
        });
      } catch (err) {
        console.warn(`[API] PSA roll-up append for parent #${result.parentId} failed (non-fatal): ${err.message}`);
      }
    }

    res.json({ id: result.parentId, added: result.count });
  } catch (err) {
    if (err && err.rollupCode) {
      return res.status(400).json({ error: err.rollupCode });
    }
    console.error('[API] Alert roll-up add failed:', err.message);
    res.status(500).json({ error: 'Failed to add alerts to roll-up' });
  }
});

module.exports = router;
