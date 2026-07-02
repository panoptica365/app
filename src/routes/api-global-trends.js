/* ════════════════════════════════════════════════════════════════════════
 * Panoptica365 — Global (fleet) Trends API
 *
 * GET /api/global-trends?range=7d|30d|90d|1y  → fleet-wide, longitudinal
 * security + operations aggregates across MANAGED tenants only. DB-only — no
 * Graph/Management/PSA/Anthropic calls. Read-only, all RBAC tiers (router-level
 * requireAuth, no requireAdmin — same as Heatmap).
 *
 * Spec: Documentation/Panoptica365 - Global Trends Dashboard - Build
 * Instructions 2026-06-18.md. Secure-Score derivations are shared with the
 * per-tenant endpoint via src/lib/trend-helpers.js.
 *
 * Managed-only is enforced exactly the way the Heatmap + polling engine select:
 * `enabled = TRUE` then `mode = 'managed'`. Audit-only tenants self-delete on
 * the 14+7-day clock; including them would put disappearing tenants in trends.
 * ════════════════════════════════════════════════════════════════════════ */
const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const th = require('../lib/trend-helpers');
const orgStore = require('../lib/org-store');

const router = express.Router();
router.use(auth.requireAuth);

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const ALERT_CATEGORIES = ['risky_signins', 'threat_mgmt', 'external_sharing', 'config_changes', 'permissions', 'info_governance'];

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const dateOf = (dt) => String(dt || '').slice(0, 10); // 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD'

router.get('/', async (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : '30d';
  const days = RANGES[range];
  try {
    // ── Managed-tenant census (the only filter, applied everywhere) ──
    // Matches the Heatmap / polling-engine selection: enabled + mode='managed'.
    let managedTenants = await db.queryRows(
      "SELECT id, tenant_id, display_name, created_at FROM tenants WHERE enabled = TRUE AND mode = 'managed'"
    );

    // Optional tenant-group filter (Tenant Groups Phase 1 rider):
    // ?group=<tenant_groups.id> scopes every aggregate below to the group's
    // members via the shared resolver — same semantics as the Heatmap filter.
    if (req.query.group != null && req.query.group !== '') {
      const gid = Number(req.query.group);
      if (!Number.isInteger(gid) || gid <= 0) {
        return res.status(400).json({ error: 'invalid_group' });
      }
      const memberIds = await orgStore.resolveGroupMembers(gid);
      if (memberIds === null) return res.status(404).json({ error: 'unknown_group' });
      const memberSet = new Set(memberIds);
      managedTenants = managedTenants.filter(t => memberSet.has(t.id));
    }
    const managedIds = managedTenants.map(t => t.id);

    const rangeStartRow = await db.queryOne(
      `SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${days} DAY), '%Y-%m-%d') AS rs`
    );
    const rangeStart = rangeStartRow?.rs || null;

    // Calendar day axis for the range (for the tenant-count line, which needs
    // every day, not just days with data).
    const dayAxisRows = await db.queryRows(
      `WITH RECURSIVE seq AS (
         SELECT DATE_SUB(CURDATE(), INTERVAL ${days} DAY) AS d
         UNION ALL SELECT d + INTERVAL 1 DAY FROM seq WHERE d < CURDATE()
       )
       SELECT DATE_FORMAT(seq.d, '%Y-%m-%d') AS d FROM seq ORDER BY seq.d`
    );
    const dayAxis = dayAxisRows.map(r => r.d);

    // Book-growth line: managed tenants that existed on each day (created_at <= d)
    // + how many were onboarded that day. Derived from the managed census so a
    // dip in the secure-score average lines up with a step here.
    const tenant_count = dayAxis.map(d => ({
      d,
      count: managedTenants.filter(t => dateOf(t.created_at) && dateOf(t.created_at) <= d).length,
      onboarded: managedTenants.filter(t => dateOf(t.created_at) === d).length,
    }));

    // Empty book → everything else is empty (and IN () would be invalid SQL).
    if (!managedIds.length) {
      return res.json({
        range, range_start: rangeStart, managed_tenant_count: 0,
        secure_fleet: [], secure_like_for_like: [], tenant_count,
        secure_by_category: [], recommendations: [],
        resolved_by_month: [], open_over_time: [], ttr_weekly: [],
        volume_weekly: [], alert_categories: [], top_policies: [],
        coverage: null, stats: { resolved_90d: 0, severe_high_90d: 0, open_now: 0 },
      });
    }
    const idCsv = managedIds.join(','); // integers from DB — safe to interpolate

    // ── Secure Score across the fleet — built like the per-tenant endpoint but
    //    for ALL managed tenants in TWO queries (not 2×N round-trips): the daily
    //    aggregate UNION the recent raw week, keyed per tenant per day. ──
    const ssAgg = await db.queryRows(
      `SELECT ms.tenant_id AS tid, DATE_FORMAT(ms.captured_at, '%Y-%m-%d') AS d, ms.metric_value
         FROM metric_snapshots ms
        WHERE ms.metric_name = 'daily_agg_secure_score'
          AND ms.tenant_id IN (${idCsv})
          AND ms.captured_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        ORDER BY ms.tenant_id, ms.captured_at`
    );
    const ssRaw = await db.queryRows(
      `SELECT ms.tenant_id AS tid, DATE_FORMAT(ms.captured_at, '%Y-%m-%d') AS d, ms.metric_value
         FROM metric_snapshots ms
         JOIN (
           SELECT tenant_id, MAX(captured_at) AS last_at
             FROM metric_snapshots
            WHERE metric_name = 'secure_score'
              AND tenant_id IN (${idCsv})
              AND captured_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
            GROUP BY tenant_id, DATE(captured_at)
         ) last ON ms.tenant_id = last.tenant_id AND ms.captured_at = last.last_at
        WHERE ms.metric_name = 'secure_score'`
    );
    // byTenant: tid → (day → parsed payload). Recent raw wins over the aggregate.
    const byTenant = new Map();
    const collect = (row) => {
      const p = th.parseJson(row.metric_value);
      if (!p) return;
      if (!byTenant.has(row.tid)) byTenant.set(row.tid, new Map());
      byTenant.get(row.tid).set(row.d, p);
    };
    ssAgg.forEach(collect);
    ssRaw.forEach(collect);

    // Like-for-like cohort = tenants already in the book at window start.
    const cohort = new Set(
      managedTenants.filter(t => dateOf(t.created_at) && dateOf(t.created_at) <= rangeStart).map(t => t.id)
    );

    const dayUnion = new Set();
    for (const m of byTenant.values()) for (const d of m.keys()) dayUnion.add(d);
    const ssDays = [...dayUnion].sort();

    const secure_fleet = [];
    const secure_like_for_like = [];
    const secure_by_category = [];
    const recommendations = [];
    for (const d of ssDays) {
      const pcts = [], llPcts = [], benches = [];
      const catAccum = {}; // cat → { sum, n }
      let recOutstanding = 0, recAddressed = 0, recTotal = 0, recHasPct = false;
      for (const [tid, dayMap] of byTenant) {
        const p = dayMap.get(d);
        if (!p) continue; // tenant absent that day = not a zero, just absent
        if (p.percentage != null) {
          const pct = th.num(p.percentage);
          pcts.push(pct);
          if (cohort.has(tid)) llPcts.push(pct);
        }
        const acs = Array.isArray(p.averageComparativeScores) ? p.averageComparativeScores : [];
        const ts = acs.find(a => a && a.basis === 'TotalSeats');
        if (ts && ts.averageScore != null) benches.push(th.num(ts.averageScore));
        const cat = th.categoryPct(p.controlScores, th.num(p.maxScore));
        if (cat) for (const [k, v] of Object.entries(cat)) {
          if (!catAccum[k]) catAccum[k] = { sum: 0, n: 0 };
          catAccum[k].sum += v; catAccum[k].n += 1;
        }
        const rec = th.recommendationsCount(p.controlScores);
        if (rec.addressed != null) {
          recHasPct = true;
          recOutstanding += (rec.total - rec.addressed);
          recAddressed += rec.addressed;
          recTotal += rec.total;
        }
      }
      if (pcts.length) {
        secure_fleet.push({
          d,
          avg: Math.round(mean(pcts)),
          min: Math.round(Math.min(...pcts)),
          max: Math.round(Math.max(...pcts)),
          benchmark: benches.length ? Math.round(mean(benches)) : null,
          tenants: pcts.length,
        });
      }
      if (llPcts.length) secure_like_for_like.push({ d, avg: Math.round(mean(llPcts)) });
      const catKeys = Object.keys(catAccum);
      if (catKeys.length) {
        const row = { d };
        for (const k of catKeys) row[k] = Math.round((catAccum[k].sum / catAccum[k].n) * 10) / 10;
        secure_by_category.push(row);
      }
      if (recHasPct) {
        recommendations.push({ d, outstanding: recOutstanding, addressed_pct: recTotal > 0 ? Math.round((recAddressed / recTotal) * 100) : null });
      }
    }

    // ── Alert operations — scoped to the census (managed + optional group
    //    filter) via t.id IN (idCsv), so every aggregate below respects the
    //    same tenant set as the Secure Score charts. ──
    const resolvedRows = await db.queryRows(
      `SELECT DATE_FORMAT(a.closed_at, '%Y-%m') AS m,
              SUM(a.severity = 'severe')           AS severe,
              SUM(a.severity IN ('high','medium')) AS high_med,
              SUM(a.severity = 'low')              AS low,
              SUM(a.severity = 'info')             AS info
         FROM alerts a
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.status = 'resolved' AND a.closed_at IS NOT NULL
          AND a.closed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        GROUP BY DATE_FORMAT(a.closed_at, '%Y-%m')
        ORDER BY m`
    );
    const resolved_by_month = resolvedRows.map(r => ({
      m: r.m, severe: th.num(r.severe), high_med: th.num(r.high_med), low: th.num(r.low), info: th.num(r.info),
    }));

    const openRows = await db.queryRows(
      `WITH RECURSIVE seq AS (
         SELECT DATE_SUB(CURDATE(), INTERVAL ${days} DAY) AS d
         UNION ALL SELECT d + INTERVAL 1 DAY FROM seq WHERE d < CURDATE()
       )
       SELECT DATE_FORMAT(seq.d, '%Y-%m-%d') AS d, COUNT(a.id) AS open
         FROM seq
         LEFT JOIN alerts a
           ON a.is_rollup = 0
          AND a.tenant_id IN (${idCsv})
          AND a.triggered_at < seq.d + INTERVAL 1 DAY
          AND (a.closed_at IS NULL OR a.closed_at >= seq.d + INTERVAL 1 DAY)
        GROUP BY seq.d
        ORDER BY seq.d`
    );
    const open_over_time = openRows.map(r => ({ d: r.d, open: th.num(r.open) }));

    const ttrRows = await db.queryRows(
      `SELECT YEARWEEK(a.closed_at, 3) AS yw,
              TIMESTAMPDIFF(MINUTE, a.triggered_at, a.closed_at) AS mins
         FROM alerts a
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.status = 'resolved'
          AND a.closed_at IS NOT NULL AND a.triggered_at IS NOT NULL
          AND a.closed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`
    );
    const ttrByWeek = new Map();
    for (const r of ttrRows) {
      const mins = th.num(r.mins);
      if (mins < 0) continue;
      if (!ttrByWeek.has(r.yw)) ttrByWeek.set(r.yw, []);
      ttrByWeek.get(r.yw).push(mins);
    }
    const ttr_weekly = [...ttrByWeek.entries()].sort((a, b) => a[0] - b[0]).map(([yw, mins]) => ({
      w: th.isoWeekLabel(yw),
      median_hours: Math.round((th.median(mins) / 60) * 10) / 10,
      p90_hours: Math.round((th.percentile(mins, 90) / 60) * 10) / 10,
    }));

    const volumeRows = await db.queryRows(
      `SELECT YEARWEEK(a.triggered_at, 3) AS yw,
              SUM(a.severity = 'severe')           AS severe,
              SUM(a.severity IN ('high','medium')) AS high_med,
              SUM(a.severity = 'low')              AS low,
              SUM(a.severity = 'info')             AS info
         FROM alerts a
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        GROUP BY YEARWEEK(a.triggered_at, 3)
        ORDER BY YEARWEEK(a.triggered_at, 3)`
    );
    const volume_weekly = volumeRows.map(r => ({
      w: th.isoWeekLabel(r.yw), severe: th.num(r.severe), high_med: th.num(r.high_med), low: th.num(r.low), info: th.num(r.info),
    }));

    const catRows = await db.queryRows(
      `SELECT YEARWEEK(a.triggered_at, 3) AS yw, p.category AS cat, COUNT(*) AS c
         FROM alerts a
         JOIN alert_policies p ON p.id = a.policy_id
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        GROUP BY YEARWEEK(a.triggered_at, 3), p.category
        ORDER BY YEARWEEK(a.triggered_at, 3)`
    );
    const catByWeek = new Map();
    for (const r of catRows) {
      if (!catByWeek.has(r.yw)) {
        const base = { w: th.isoWeekLabel(r.yw) };
        for (const c of ALERT_CATEGORIES) base[c] = 0;
        catByWeek.set(r.yw, base);
      }
      const key = ALERT_CATEGORIES.includes(r.cat) ? r.cat : null;
      if (key) catByWeek.get(r.yw)[key] = th.num(r.c);
    }
    const alert_categories = [...catByWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

    const polRows = await db.queryRows(
      `SELECT a.policy_id, p.name AS name, COUNT(*) AS count,
              SUM(a.severity = 'severe')           AS c_severe,
              SUM(a.severity IN ('high','medium')) AS c_high_med,
              SUM(a.severity = 'low')              AS c_low,
              SUM(a.severity = 'info')             AS c_info
         FROM alerts a
         JOIN alert_policies p ON p.id = a.policy_id
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY a.policy_id, p.name
        ORDER BY count DESC
        LIMIT 12`
    );
    const top_policies = polRows.map(r => {
      const buckets = [
        ['severe', th.num(r.c_severe)], ['high', th.num(r.c_high_med)],
        ['low', th.num(r.c_low)], ['info', th.num(r.c_info)],
      ];
      buckets.sort((a, b) => b[1] - a[1]);
      return { name: r.name, count: th.num(r.count), severity: buckets[0][1] > 0 ? buckets[0][0] : 'info' };
    });

    // ── Coverage stat strip (posture latest per managed tenant) ──
    const covRows = await db.queryRows(
      `SELECT h.score_pct
         FROM heatmap_posture_daily h
         JOIN (SELECT tenant_id, MAX(snapshot_date) AS md FROM heatmap_posture_daily GROUP BY tenant_id) last
           ON h.tenant_id = last.tenant_id AND h.snapshot_date = last.md
         JOIN tenants t ON t.id = h.tenant_id AND t.id IN (${idCsv})
        WHERE h.score_pct IS NOT NULL`
    );
    const covPcts = covRows.map(r => th.num(r.score_pct));
    const coverage = {
      at_100: covPcts.filter(p => p >= 99.95).length,
      of: managedIds.length,
      fleet_avg_pct: covPcts.length ? Math.round(mean(covPcts)) : null,
    };

    // ── Stat strip alert numbers (fixed 90-day window) ──
    const statRow = await db.queryOne(
      `SELECT COUNT(*) AS resolved_90d, SUM(a.severity IN ('severe','high')) AS severe_high_90d
         FROM alerts a
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.status = 'resolved'
          AND a.closed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`
    );
    const openNowRow = await db.queryOne(
      `SELECT COUNT(*) AS open_now
         FROM alerts a
         JOIN tenants t ON t.id = a.tenant_id AND t.id IN (${idCsv})
        WHERE a.is_rollup = 0 AND a.status IN ('new','investigating')`
    );

    res.json({
      range,
      range_start: rangeStart,
      managed_tenant_count: managedIds.length,
      secure_fleet,
      secure_like_for_like,
      tenant_count,
      secure_by_category,
      recommendations,
      resolved_by_month,
      open_over_time,
      ttr_weekly,
      volume_weekly,
      alert_categories,
      top_policies,
      coverage,
      stats: {
        resolved_90d: th.num(statRow?.resolved_90d),
        severe_high_90d: th.num(statRow?.severe_high_90d),
        open_now: th.num(openNowRow?.open_now),
      },
    });
  } catch (err) {
    console.error('[API] Global trends fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch global trends' });
  }
});

module.exports = router;
