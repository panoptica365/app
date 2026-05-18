/**
 * Panoptica — Daily Activity API (Phase 8, 2026-04-09)
 *
 * Returns per-tenant ambient telemetry counts for donut chart widgets.
 * Each widget is keyed off an alert policy flagged with
 *   detection_logic.track_daily_telemetry = true
 *   detection_logic.daily_activity_widget = '<widget key>'
 *
 * The alert engine accumulates event counts for these policies every poll cycle
 * into the daily_event_counts table. This endpoint aggregates that data into a
 * shape the frontend can render as a donut chart:
 *
 *   - Segment size  = today's raw event count for the tenant
 *   - Segment color = deviation of today's count from the tenant's 7-day rolling
 *                     average (green / yellow / orange / red)
 *   - Tooltip       = tenant name, today's count, 7-day avg, deviation %
 *   - Center text   = total across all tenants for this widget today
 *
 * Response shape:
 *   {
 *     widgets: {
 *       login_failures: {
 *         policy_id: 5,
 *         policy_name: 'User login failure summary',
 *         label: 'Login Failures',
 *         total_today: 123,
 *         tenants: [
 *           { tenant_db_id, display_name, today, avg, deviation_pct, color }
 *         ]
 *       },
 *       ca_blocks: { ... }
 *     },
 *     generated_at: ISO timestamp
 *   }
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const tenantMode = require('../lib/tenant-mode');

const router = express.Router();
router.use(auth.requireAuth);

// Widget label map — keeps backend generic but gives the frontend a nicer display name
// than whatever the admin named the underlying policy.
const WIDGET_LABELS = {
  login_failures: 'Login Failures',
  ca_blocks: 'CA Blocks',
};

// Color breakpoints (Phase 8) — see Claude.md for rationale.
// Green  = today ≤ 50% above the 7-day avg (normal / below normal)
// Yellow = 50–200% above avg (elevated)
// Orange = 200–500% above avg (spike)
// Red    = >500% above avg (anomaly)
// Gray   = insufficient baseline (<1 day of history)
function deviationColor(today, avg) {
  if (avg == null) return '#888888'; // no baseline yet
  if (avg === 0) {
    if (today === 0) return '#33CC66'; // both zero → green
    if (today < 50) return '#FFCC33';  // small uptick from zero → yellow
    return '#CC4444';                  // meaningful activity from zero baseline → red
  }
  const pct = ((today - avg) / avg) * 100;
  if (pct <= 50) return '#33CC66';     // green
  if (pct <= 200) return '#FFCC33';    // yellow
  if (pct <= 500) return '#FF9933';    // orange
  return '#CC4444';                    // red
}

function deviationPercent(today, avg) {
  if (avg == null || avg === 0) {
    return today === 0 ? 0 : null; // null = "no baseline" or "infinite" — frontend formats as "—"
  }
  return Math.round(((today - avg) / avg) * 100);
}

/**
 * GET /api/daily-activity
 * Returns today's telemetry snapshot grouped by widget + tenant.
 */
router.get('/', async (req, res) => {
  try {
    // 1) Load all policies and filter to those flagged as telemetry feeders.
    //    Filter in JS (not SQL JSON_EXTRACT) because MySQL JSON boolean comparison
    //    semantics vary across versions — the policies table is small (~30 rows).
    const allPolicies = await db.queryRows(
      'SELECT id, name, detection_logic FROM alert_policies'
    );
    const policies = allPolicies.filter(p => {
      let logic;
      try {
        logic = typeof p.detection_logic === 'string'
          ? JSON.parse(p.detection_logic)
          : p.detection_logic;
      } catch {
        return false;
      }
      return logic?.track_daily_telemetry === true && logic.daily_activity_widget;
    });

    if (policies.length === 0) {
      return res.json({ widgets: {}, generated_at: new Date().toISOString() });
    }

    // 2) Load all enabled MANAGED tenants. Audit-only tenants are excluded
    //    from the daily activity donut by the audit_only contract — they
    //    don't generate ongoing alerts/events, so showing them in the
    //    "today's activity" view is meaningless and clutters the chart.
    //    (Per audit-only spec: "NO alerts ... no scheduled polling".)
    const tenants = await db.queryRows(
      `SELECT id, display_name FROM tenants
       WHERE enabled = TRUE AND mode = 'managed'
       ORDER BY display_name`
    );

    // 3) For each widget policy, pull today's counts and 7-day averages in bulk
    const widgets = {};
    for (const policy of policies) {
      const logic = typeof policy.detection_logic === 'string'
        ? JSON.parse(policy.detection_logic)
        : policy.detection_logic;
      const widgetKey = logic.daily_activity_widget;
      if (!widgetKey) continue;

      // Today's count per tenant
      const todayRows = await db.queryRows(
        `SELECT tenant_id, event_count
           FROM daily_event_counts
          WHERE policy_id = ? AND event_date = CURDATE()`,
        [policy.id]
      );
      const todayByTenant = Object.fromEntries(todayRows.map(r => [r.tenant_id, r.event_count]));

      // 7-day rolling average per tenant (excluding today)
      const avgRows = await db.queryRows(
        `SELECT tenant_id, AVG(event_count) AS avg_count, COUNT(*) AS day_count
           FROM daily_event_counts
          WHERE policy_id = ?
            AND event_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            AND event_date < CURDATE()
          GROUP BY tenant_id`,
        [policy.id]
      );
      const avgByTenant = Object.fromEntries(
        avgRows.map(r => [r.tenant_id, { avg: Math.round(Number(r.avg_count)), days: r.day_count }])
      );

      // Build per-tenant entries
      const tenantEntries = tenants.map(t => {
        const today = todayByTenant[t.id] || 0;
        const baseline = avgByTenant[t.id];
        const avg = baseline ? baseline.avg : null;
        const baselineDays = baseline ? baseline.days : 0;
        return {
          tenant_db_id: t.id,
          display_name: t.display_name,
          today,
          avg,
          baseline_days: baselineDays,
          deviation_pct: deviationPercent(today, avg),
          color: deviationColor(today, avg),
        };
      });

      const totalToday = tenantEntries.reduce((sum, e) => sum + e.today, 0);

      widgets[widgetKey] = {
        policy_id: policy.id,
        policy_name: policy.name,
        label: WIDGET_LABELS[widgetKey] || policy.name,
        total_today: totalToday,
        tenants: tenantEntries,
      };
    }

    res.json({
      widgets,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API:DailyActivity] Failed:', err);
    res.status(500).json({ error: 'Failed to load daily activity data' });
  }
});

/**
 * GET /api/daily-activity/events?tenant_id=X&event_type=login_failure|ca_block
 * Returns today's individual sign-in events for drill-down modal,
 * plus any Haiku-generated summary.
 */
router.get('/events', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const eventType = req.query.event_type;

    if (!tenantId || !['login_failure', 'ca_block'].includes(eventType)) {
      return res.status(400).json({ error: 'tenant_id and valid event_type required' });
    }

    // Audit-only contract gate. Daily activity drill-down should not surface
    // for audit-only tenants — they're not in the donut anymore (post-fix),
    // but defense-in-depth: if a stale URL or direct API call hits this path
    // for an audit-only tenant, refuse rather than show pre-gate leftover
    // data with AI summaries that violate the "no AI in audit flow" rule.
    if (await tenantMode.isAuditOnly(tenantId)) {
      return res.status(403).json({
        error: 'audit_only_tenant',
        message: 'Daily activity event detail is disabled for audit-only tenants.',
      });
    }

    // Fetch today's events for this tenant + type
    const events = await db.queryRows(
      `SELECT id, event_time, user_display_name, user_principal_name,
              ip_address, city, country, app_display_name, error_code,
              failure_reason, ca_status, device_detail_browser, device_detail_os,
              risk_level, graph_event_id
         FROM daily_event_details
        WHERE tenant_id = ? AND event_type = ? AND event_date = CURDATE()
        ORDER BY event_time DESC`,
      [tenantId, eventType]
    );

    // Fetch Haiku summary if available
    const summaryRows = await db.queryRows(
      `SELECT summary, event_count, generated_at
         FROM daily_event_summaries
        WHERE tenant_id = ? AND event_type = ? AND event_date = CURDATE()
        LIMIT 1`,
      [tenantId, eventType]
    );

    res.json({
      tenant_id: tenantId,
      event_type: eventType,
      events,
      summary: summaryRows.length > 0 ? summaryRows[0] : null,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API:DailyActivity:Events] Failed:', err);
    res.status(500).json({ error: 'Failed to load event details' });
  }
});

module.exports = router;
