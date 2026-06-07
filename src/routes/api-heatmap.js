/**
 * Panoptica365 — Heatmap API (multi-tenant posture roll-up)
 *
 * One MSP-level endpoint that flattens every MANAGED tenant's security posture
 * across the same categories/controls, side by side. Read-only: it rolls up the
 * EXISTING per-control verdicts that already drive the per-tenant Security page
 * (tenant_security_config.status) — it never computes its own pass/fail verdict.
 * If the Heatmap and the Security detail page ever disagree, that's a defect.
 *
 *   GET /api/heatmap
 *        Returns the fleet header numbers, the per-tenant × per-category grid
 *        (dots already sorted worst-first), the "universally weak" campaign
 *        candidates, and the Movers (7-day regression) panel.
 *
 * Design notes / gate resolutions (see Heatmap build spec §2):
 *
 *  Gate A — per-control applicability (licence gating). Resolved via the EXISTING
 *  polled status, NOT the control's static `licence_required` label. That label
 *  is documentation ("Entra ID P1", "Defender for Office 365 P1") and does NOT
 *  mean "above Business Premium" — BP bundles those features. The security poller
 *  returns status 'unavailable' only when a reader genuinely can't read the
 *  feature on a given tenant; THAT is the true per-tenant applicability signal.
 *  Those cells render neutral ('na') and are excluded from the denominator, so a
 *  tenant is never penalised for something it truly can't run — while controls it
 *  DOES run (which is most of them on Business Premium) are scored for real.
 *  (An earlier version gated on `licence_required` and wrongly greyed out healthy
 *  controls the per-tenant detail pages showed as Monitored — OK. Fixed
 *  2026-05-30. See cellState() for the full status→state mapping.)
 *
 *  Gate B — 7-day regression baseline. tenant_security_config is current-state
 *  only; there is no historical record of per-control posture. So we record one
 *  lightweight posture row per managed tenant per day in heatmap_posture_daily
 *  (upserted on each load), and the Movers panel compares today's score to the
 *  row from ~7 days ago. Until 7 days of history exist it reports the honest
 *  "collecting" state rather than fabricating a baseline.
 *
 * Scoring (operator decision, 2026-05-30): the headline % means "% of all
 * recommended controls that are set up AND healthy". Controls a tenant has not
 * yet baselined therefore count AGAINST the score (they are recommended but not
 * done). Controls we simply could not read (poll_error / awaiting-infra) are a
 * DATA-INTEGRITY signal, never a posture signal — they are excluded from the
 * denominator and never rendered red.
 *
 * Audit-only tenants are excluded everywhere (rows, fleet %, campaigns, Movers),
 * matching the polling engine's managed-only selection (mode = 'managed').
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const { SETTINGS } = require('../lib/security-settings/registry');

const router = express.Router();
router.use(auth.requireAuth);

// ── Category display order ────────────────────────────────────────
// Use the existing security_settings.category grouping verbatim — do not invent
// new categories. Order chosen to mirror the daily-triage reading order
// (identity/email first). Any category present in the registry but missing here
// is appended alphabetically so a future category can't silently vanish.
const CATEGORY_ORDER = ['identity', 'exchange', 'sharepoint', 'teams', 'defender', 'compliance'];

function orderedCategories(presentKeys) {
  const known = CATEGORY_ORDER.filter(c => presentKeys.has(c));
  const extra = [...presentKeys].filter(c => !CATEGORY_ORDER.includes(c)).sort();
  return [...known, ...extra];
}

// Priority → numeric rank (lower = worse) for worst-first dot ordering and the
// cell's severity left-edge.
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Map a stored control status onto a Heatmap cell state. This is the ONLY place
 * status vocabulary is translated, and it is deliberately faithful to the
 * Security page's own status meanings (same source-of-truth row).
 *
 *   compliant → green   (counts toward score)      — status 'monitored'/'pending'
 *   drifted   → red     (counts; not compliant)    — status 'drift'
 *   not_set   → amber   (counts; not compliant)    — readable but no baseline yet
 *   na        → neutral (excluded from score)      — reader reported not-available
 *                                                    on this tenant (genuine
 *                                                    licence-gating OR awaiting
 *                                                    infra → status 'unavailable')
 *   stale     → texture (excluded; data-integrity) — read failed / no data yet
 *
 * IMPORTANT (2026-05-30 fix): applicability is decided by the *polled status*,
 * NOT by the control's static `licence_required` label. `licence_required` is a
 * documentation field on the control (e.g. "Entra ID P1") — and Business
 * Premium already includes those features, so a tenant on BP that successfully
 * polls the control is monitoring it for real. The reader returns 'unavailable'
 * only when the feature genuinely can't be read on that tenant; THAT is the true
 * licence/applicability signal. Driving the cell from `licence_required` (the
 * original bug) wrongly greyed out controls the detail page showed as healthy,
 * which both lied to the operator and broke single-source-of-truth.
 *
 * @param {string|null} status  tenant_security_config.status (null = no row)
 */
function cellState(status) {
  switch (status) {
    case 'monitored':
    case 'pending':      return 'compliant';
    case 'drift':        return 'drifted';
    case 'not_applied':  return 'not_set';   // readable, no baseline = not set up
    case 'unavailable':  return 'na';        // reader: not available on this tenant
    case 'poll_error':   return 'stale';     // read failed — data integrity, not posture
    case 'not_polled':
    case null:
    case undefined:      return 'stale';     // no data yet — don't penalise
    default:             return 'not_set';
  }
}

// A cell state counts toward the applicable-control denominator?
function countsTowardScore(state) {
  return state === 'compliant' || state === 'drifted' || state === 'not_set';
}

// Worst-first sort weight for dots within a cell. Trouble sits on the left, so
// the signal survives for colour-blind operators (position == state).
const STATE_WEIGHT = { drifted: 0, not_set: 1, compliant: 2, na: 3, stale: 4 };

function dotSort(a, b) {
  const sw = STATE_WEIGHT[a.state] - STATE_WEIGHT[b.state];
  if (sw !== 0) return sw;
  const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (pr !== 0) return pr;
  return a.control_id.localeCompare(b.control_id);
}

let _tableReady = false;
async function ensurePostureTable() {
  if (_tableReady) return;
  // Additive CREATE TABLE IF NOT EXISTS — safe/idempotent on every install.
  // One row per (tenant, UTC day) holding that day's applicable-only posture,
  // so the Movers panel has a real 7-day baseline going forward.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS heatmap_posture_daily (
      tenant_id     INT UNSIGNED NOT NULL,
      snapshot_date DATE NOT NULL,
      applicable    INT UNSIGNED NOT NULL DEFAULT 0,
      compliant     INT UNSIGNED NOT NULL DEFAULT 0,
      score_pct     DECIMAL(5,2) DEFAULT NULL,
      captured_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, snapshot_date),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  _tableReady = true;
}

/**
 * Record today's posture for each managed tenant (idempotent per UTC day).
 * Called on every Heatmap load so trend history accrues whenever the screen is
 * used — no separate scheduler to provision. score_pct is NULL when a tenant has
 * zero applicable controls (so the Movers delta can skip it cleanly).
 */
async function recordDailyPosture(tenantScores) {
  for (const t of tenantScores) {
    const pct = t.applicable > 0 ? Number(((t.compliant / t.applicable) * 100).toFixed(2)) : null;
    try {
      await db.execute(
        `INSERT INTO heatmap_posture_daily (tenant_id, snapshot_date, applicable, compliant, score_pct, captured_at)
         VALUES (?, UTC_DATE(), ?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           applicable = VALUES(applicable),
           compliant  = VALUES(compliant),
           score_pct  = VALUES(score_pct),
           captured_at = VALUES(captured_at)`,
        [t.id, t.applicable, t.compliant, pct]
      );
    } catch (e) {
      console.warn(`[Heatmap] daily posture upsert failed (tenant ${t.id}):`, e.message);
    }
  }
}

/**
 * Build the Movers panel. Compares each managed tenant's current score to its
 * recorded score ~7 days ago. Honest "collecting" state until a >=7-day-old row
 * exists for at least one tenant.
 */
async function buildMovers(tenantById, currentScoreById) {
  // How many distinct days of history do we hold (for managed tenants)?
  let oldestDays = 0;
  let daysCollected = 0;
  try {
    const span = await db.queryOne(
      `SELECT COUNT(DISTINCT snapshot_date) AS days,
              DATEDIFF(UTC_DATE(), MIN(snapshot_date)) AS oldest_days
         FROM heatmap_posture_daily`
    );
    daysCollected = span?.days || 0;
    oldestDays = span?.oldest_days || 0;
  } catch (e) {
    console.warn('[Heatmap] movers span lookup failed:', e.message);
  }

  if (oldestDays < 7) {
    return { state: 'collecting', days_collected: daysCollected, items: [] };
  }

  // For each tenant, the baseline row closest to 7 days ago (within a 5–10 day
  // window so a missed day doesn't blank the panel).
  let baselineRows = [];
  try {
    baselineRows = await db.queryRows(
      `SELECT h.tenant_id, h.score_pct
         FROM heatmap_posture_daily h
         JOIN (
           SELECT tenant_id, MIN(ABS(DATEDIFF(snapshot_date, UTC_DATE() - INTERVAL 7 DAY))) AS best
             FROM heatmap_posture_daily
            WHERE snapshot_date BETWEEN UTC_DATE() - INTERVAL 10 DAY AND UTC_DATE() - INTERVAL 5 DAY
            GROUP BY tenant_id
         ) pick
           ON pick.tenant_id = h.tenant_id
          AND ABS(DATEDIFF(h.snapshot_date, UTC_DATE() - INTERVAL 7 DAY)) = pick.best
        WHERE h.snapshot_date BETWEEN UTC_DATE() - INTERVAL 10 DAY AND UTC_DATE() - INTERVAL 5 DAY`
    );
  } catch (e) {
    console.warn('[Heatmap] movers baseline lookup failed:', e.message);
  }

  const items = [];
  for (const b of baselineRows) {
    const tenant = tenantById.get(b.tenant_id);
    const current = currentScoreById.get(b.tenant_id);
    if (!tenant || current == null || b.score_pct == null) continue; // skip stale/unknown
    const delta = Number((current - Number(b.score_pct)).toFixed(1));
    if (delta === 0) continue;
    items.push({
      tenant_id: b.tenant_id,
      display_name: tenant.display_name,
      current_pct: current,
      baseline_pct: Number(b.score_pct),
      delta_pct: delta,
      direction: delta < 0 ? 'down' : 'up',
    });
  }
  // Regressions first (most-negative delta), the early-warning the operator acts on.
  items.sort((a, b) => a.delta_pct - b.delta_pct);
  return { state: 'ready', days_collected: daysCollected, items };
}

/**
 * Count active fleet-wide exemptions for managed tenants. In this codebase
 * "exemptions" are Conditional-Access accepted-risk exclusions (ca_exemptions);
 * security controls themselves have no exemption surface, so this number is
 * informational and does NOT enter the posture score. Best-effort: the table may
 * not exist on installs that never ran the CA-exemptions migration.
 */
async function countActiveExemptions(managedIds) {
  if (managedIds.length === 0) return 0;
  const placeholders = managedIds.map(() => '?').join(',');
  try {
    const row = await db.queryOne(
      `SELECT COUNT(*) AS n
         FROM ca_exemptions e
         JOIN ca_assignments a ON a.id = e.assignment_id
        WHERE a.tenant_id IN (${placeholders})
          AND e.revoked_at IS NULL
          AND e.expires_at > UTC_TIMESTAMP()`,
      managedIds
    );
    return row?.n || 0;
  } catch (e) {
    // Table absent / migration not run — treat as zero, like exemption-resolver.
    return 0;
  }
}

router.get('/', async (req, res) => {
  try {
    await ensurePostureTable();

    // ── Tenant census (managed vs audit-only reconciliation for the caption) ──
    const allTenants = await db.queryRows(
      `SELECT id, display_name, mode FROM tenants WHERE enabled = TRUE`
    );
    const managed = allTenants.filter(t => t.mode === 'managed');
    const auditOnly = allTenants.filter(t => t.mode === 'audit_only');
    const managedIds = managed.map(t => t.id);
    const tenantById = new Map(managed.map(t => [t.id, t]));

    // ── Catalog: every control, its category, priority, licence requirement ──
    // Static registry is the source of truth for metadata; statuses come from DB.
    const controls = SETTINGS.map(s => ({
      id: s.setting_id,
      name: s.name,
      category: s.category,
      priority: s.priority,
      licence_required: s.licence_required || null,
    }));
    const controlById = new Map(controls.map(c => [c.id, c]));

    const presentCategories = new Set(controls.map(c => c.category));
    const categoryKeys = orderedCategories(presentCategories);
    const controlsByCategory = new Map(categoryKeys.map(k => [k, []]));
    for (const c of controls) controlsByCategory.get(c.category)?.push(c);

    // Empty-fleet guard: render a sensible empty page, no divide-by-zero.
    if (managedIds.length === 0) {
      return res.json({
        managed_count: 0,
        total_count: allTenants.length,
        audit_only_count: auditOnly.length,
        stale_tenant_count: 0,
        active_exemptions: 0,
        fleet_score_pct: null,
        categories: categoryKeys.map(k => ({
          key: k,
          controls: (controlsByCategory.get(k) || []).map(c => ({ id: c.id, name: c.name, priority: c.priority, licence_required: c.licence_required })),
        })),
        tenants: [],
        universally_weak: [],
        movers: { state: 'collecting', days_collected: 0, items: [] },
      });
    }

    // ── Bulk status read: one query for all managed tenants × all controls ──
    const placeholders = managedIds.map(() => '?').join(',');
    const statusRows = await db.queryRows(
      `SELECT tenant_id, setting_id, status
         FROM tenant_security_config
        WHERE tenant_id IN (${placeholders})`,
      managedIds
    );
    // Map<tenant_id, Map<setting_id, status>>
    const statusByTenant = new Map(managedIds.map(id => [id, new Map()]));
    for (const r of statusRows) {
      const m = statusByTenant.get(r.tenant_id);
      if (m) m.set(r.setting_id, r.status);
    }

    // ── Per-tenant roll-up ──
    // weakCountByControl: for the "universally weak" campaign ranking.
    const weakByControl = new Map(controls.map(c => [c.id, { drifted: [], not_set: [] }]));
    const tenantsOut = [];
    let fleetApplicable = 0;
    let fleetCompliant = 0;

    for (const t of managed) {
      const tStatuses = statusByTenant.get(t.id) || new Map();
      const cells = {};
      let applicable = 0, compliant = 0, drift = 0, notSet = 0, stale = 0, naCount = 0;
      let anyData = false;

      for (const catKey of categoryKeys) {
        const catControls = controlsByCategory.get(catKey) || [];
        const dots = [];
        let worstRank = null; // worst priority among drifted controls (for the edge)
        let catApplicable = 0, catCompliant = 0;

        for (const c of catControls) {
          const status = tStatuses.has(c.id) ? tStatuses.get(c.id) : null;
          if (status != null) anyData = true;
          const state = cellState(status);
          dots.push({ control_id: c.id, name: c.name, priority: c.priority, state });

          if (countsTowardScore(state)) { applicable++; catApplicable++; }
          if (state === 'compliant') { compliant++; catCompliant++; }
          if (state === 'drifted') {
            drift++;
            weakByControl.get(c.id).drifted.push({ tenant_id: t.id, display_name: t.display_name });
            const r = PRIORITY_RANK[c.priority] ?? 9;
            if (worstRank === null || r < worstRank) worstRank = r;
          }
          if (state === 'not_set') {
            notSet++;
            weakByControl.get(c.id).not_set.push({ tenant_id: t.id, display_name: t.display_name });
          }
          if (state === 'stale') stale++;
          if (state === 'na') naCount++;
        }

        dots.sort(dotSort);
        const worstSeverity = worstRank === null
          ? null
          : Object.keys(PRIORITY_RANK).find(k => PRIORITY_RANK[k] === worstRank);
        cells[catKey] = {
          dots,
          worst_severity: worstSeverity,            // drives the cell left-edge
          applicable: catApplicable,
          compliant: catCompliant,
          na: catApplicable === 0 && dots.length > 0 && dots.every(d => d.state === 'na' || d.state === 'stale'),
        };
      }

      const scorePct = applicable > 0 ? Number(((compliant / applicable) * 100).toFixed(1)) : null;
      // A tenant is "stale" when we have no readable posture data at all.
      const isStale = !anyData || (applicable === 0 && stale > 0);

      fleetApplicable += applicable;
      fleetCompliant += compliant;

      tenantsOut.push({
        id: t.id,
        display_name: t.display_name,
        score_pct: scorePct,
        applicable, compliant, drift, not_set: notSet, stale, na: naCount,
        is_stale: isStale,
        cells,
      });
    }

    // Weakest-first. Tenants with no applicable controls (null score) sort last.
    tenantsOut.sort((a, b) => {
      if (a.score_pct == null && b.score_pct == null) return a.display_name.localeCompare(b.display_name);
      if (a.score_pct == null) return 1;
      if (b.score_pct == null) return -1;
      return a.score_pct - b.score_pct;
    });

    // ── Universally weak (campaign candidates) ──
    // Ranked by how many managed tenants have the control red (drifted) or
    // never-set-up — both are "fix it everywhere" campaigns. Drifted is the
    // stronger signal so it breaks ties.
    const universallyWeak = controls.map(c => {
      const w = weakByControl.get(c.id);
      const affectedMap = new Map();
      for (const x of w.drifted) affectedMap.set(x.tenant_id, { ...x, state: 'drifted' });
      for (const x of w.not_set) if (!affectedMap.has(x.tenant_id)) affectedMap.set(x.tenant_id, { ...x, state: 'not_set' });
      const affected = [...affectedMap.values()];
      return {
        control_id: c.id,
        name: c.name,
        category: c.category,
        priority: c.priority,
        drifted_count: w.drifted.length,
        not_set_count: w.not_set.length,
        weak_count: affected.length,
        affected,
      };
    })
      .filter(c => c.weak_count > 0)
      .sort((a, b) => {
        if (b.weak_count !== a.weak_count) return b.weak_count - a.weak_count;
        if (b.drifted_count !== a.drifted_count) return b.drifted_count - a.drifted_count;
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      });

    // ── Movers (Gate B) + daily posture recording ──
    const currentScoreById = new Map(tenantsOut.map(t => [t.id, t.score_pct]));
    await recordDailyPosture(tenantsOut.map(t => ({ id: t.id, applicable: t.applicable, compliant: t.compliant })));
    const movers = await buildMovers(tenantById, currentScoreById);

    const activeExemptions = await countActiveExemptions(managedIds);
    const staleTenantCount = tenantsOut.filter(t => t.is_stale).length;
    const fleetScorePct = fleetApplicable > 0
      ? Number(((fleetCompliant / fleetApplicable) * 100).toFixed(1))
      : null;

    res.json({
      managed_count: managed.length,
      total_count: allTenants.length,
      audit_only_count: auditOnly.length,
      stale_tenant_count: staleTenantCount,
      active_exemptions: activeExemptions,
      fleet_score_pct: fleetScorePct,
      categories: categoryKeys.map(k => ({
        key: k,
        controls: (controlsByCategory.get(k) || []).map(c => ({
          id: c.id, name: c.name, priority: c.priority, licence_required: c.licence_required,
        })),
      })),
      tenants: tenantsOut,
      universally_weak: universallyWeak,
      movers,
    });
  } catch (e) {
    console.error('[api-heatmap] failed:', e.message);
    res.status(500).json({ error: 'heatmap failed', detail: e.message });
  }
});

module.exports = router;
