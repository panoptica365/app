/**
 * Panoptica — Tenant API Routes
 * CRUD operations for tenants + Secure Score data.
 */

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const polling = require('../polling');
const changeLog = require('../change-log');

const router = express.Router();

// ─── Migration: rename autotask_company_name → psa_name ───
(async () => {
  try {
    const oldCol = await db.queryRows(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'autotask_company_name'"
    );
    if (oldCol.length > 0) {
      await db.execute(
        "ALTER TABLE tenants CHANGE COLUMN autotask_company_name psa_name VARCHAR(255) DEFAULT NULL COMMENT 'Company name in PSA for ticket attribution'"
      );
      console.log('[Migration] Renamed tenants.autotask_company_name → psa_name');
    }
  } catch (err) {
    // Column may already be renamed
    if (!err.message.includes('Unknown column') && !err.message.includes("doesn't exist")) {
      console.error('[Migration] psa_name rename failed:', err.message);
    }
  }
})();

// ─── Migration: expand tenants.language ENUM to include 'es' (Apr 28, 2026) ───
// Was ENUM('en','fr') NOT NULL DEFAULT 'en'. Adds Spanish for the eventual
// non-Canadian beta MSP target (per Phase B3 in backlog.md). MODIFY is
// idempotent — re-running with the same definition is a no-op. We probe the
// COLUMN_TYPE first so the log line only fires when something actually changed.
(async () => {
  try {
    const col = await db.queryOne(
      "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'language'"
    );
    if (col && col.COLUMN_TYPE && !col.COLUMN_TYPE.includes("'es'")) {
      await db.execute(
        "ALTER TABLE tenants MODIFY COLUMN language ENUM('en','fr','es') NOT NULL DEFAULT 'en'"
      );
      console.log("[Migration] Expanded tenants.language ENUM → ('en','fr','es')");
    }
  } catch (err) {
    console.error('[Migration] tenants.language ENUM expansion failed (non-fatal):', err.message);
  }
})();

// ─── Migration: add tenants.mode + audit-lifecycle columns (Apr 28, 2026) ───
// Adds: mode ENUM('managed','audit_only'), audit_expires_at, audit_expiry_warned_at.
// Idempotent — checks INFORMATION_SCHEMA before each ALTER. Mirrors the language
// ENUM expansion pattern above. Belt + suspenders alongside schema-audit-mode.sql.
(async () => {
  try {
    const col = await db.queryOne(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'mode'"
    );
    if (!col) {
      // May 20, 2026 — use the deadlock-retry helper. ual-events.js's
      // ensureTenantCutoverColumns() also ALTERs the tenants table at
      // module-load (concurrent with this IIFE). On a fresh DB, those
      // two ALTERs race and MySQL deadlocks them, leaving tenants.mode
      // unadded. Retry-with-backoff lets whichever loses the deadlock
      // try again once the winner finishes.
      await db.executeWithDeadlockRetry(
        "ALTER TABLE tenants " +
        "ADD COLUMN mode ENUM('managed','audit_only') NOT NULL DEFAULT 'managed' AFTER language, " +
        "ADD COLUMN audit_expires_at DATETIME NULL DEFAULT NULL AFTER mode, " +
        "ADD COLUMN audit_expiry_warned_at DATETIME NULL DEFAULT NULL AFTER audit_expires_at, " +
        "ADD INDEX idx_tenants_mode (mode), " +
        "ADD INDEX idx_tenants_audit_expires_at (audit_expires_at)"
      );
      console.log("[Migration] Added tenants.mode + audit-lifecycle columns");
    }
  } catch (err) {
    console.error('[Migration] tenants.mode addition failed (non-fatal):', err.message);
  }
})();

// All routes require authentication
router.use(auth.requireAuth);

// ─── A3 RBAC — May 9, 2026 ───
// GET routes: viewer + operator + admin (all authenticated). No middleware.
// Mutate routes: operator + admin via requireMemberOrAdmin EXCEPT:
//   - mode change, enabled toggle, polling_interval change, admin jobs,
//     debug endpoints: admin only via requireAdmin.
// The PUT /:id handler additionally rejects member-attempted mode/enabled
// changes with a 403 in-handler (route-level middleware admits members for
// the safe-fields path).

// ─── List all tenants ───
router.get('/', async (req, res) => {
  try {
    const tenants = await db.queryRows(
      `SELECT id, tenant_id, display_name, psa_name,
              language, mode, audit_expires_at, audit_expiry_warned_at,
              polling_interval, enabled, consented_at,
              last_polled_at, created_at
       FROM tenants ORDER BY display_name`
    );
    res.json(tenants);
  } catch (err) {
    console.error('[API] List tenants failed:', err.message);
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

// ─── Get single tenant ───
router.get('/:id', async (req, res) => {
  try {
    const tenant = await db.queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (err) {
    console.error('[API] Get tenant failed:', err.message);
    res.status(500).json({ error: 'Failed to load tenant' });
  }
});

// ─── Update tenant ───
// Operator can edit safe fields (display_name, psa_name, language).
// Admin only for: mode change, enabled toggle, polling_interval.
router.put('/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const b = req.body;

    // Convert undefined to null for mysql2 (undefined is rejected, null becomes SQL NULL)
    const display_name = b.display_name ?? null;
    const psa_name = b.psa_name ?? null;
    const language = b.language ?? null;
    const polling_interval = b.polling_interval != null ? parseInt(b.polling_interval, 10) : null;
    const enabled = b.enabled ?? null;
    // Mode: 'managed' or 'audit_only'. Validate strictly — anything else is rejected.
    let mode = null;
    if (b.mode != null) {
      if (b.mode !== 'managed' && b.mode !== 'audit_only') {
        return res.status(400).json({ error: `Invalid mode "${b.mode}" — must be "managed" or "audit_only"` });
      }
      mode = b.mode;
    }

    // A3 RBAC (May 9, 2026): operators can edit safe per-tenant fields but
    // NOT lifecycle/licensing/operational-tuning fields. The middleware
    // already admitted them — reject here if they attempted a privileged
    // field change. Admin requests fall through untouched.
    const role = req.session?.user?.role;
    if (role !== 'admin') {
      const privilegedAttempt = [];
      if (mode !== null) privilegedAttempt.push('mode');
      if (enabled !== null) privilegedAttempt.push('enabled');
      if (polling_interval !== null) privilegedAttempt.push('polling_interval');
      if (privilegedAttempt.length > 0) {
        return res.status(403).json({
          error: 'Admin role required',
          message: `Cannot change ${privilegedAttempt.join(', ')} as operator. These fields require admin.`,
          fields: privilegedAttempt,
        });
      }
    }

    // Capture pre-update state for audit diff. Only fields that actually
    // changed (non-null in body AND different from stored value) produce
    // audit text; full row dump would be noise.
    const prior = await db.queryOne(
      'SELECT display_name, psa_name, language, mode, audit_expires_at, polling_interval, enabled FROM tenants WHERE id = ?',
      [req.params.id]
    );
    if (!prior) return res.status(404).json({ error: 'Tenant not found' });

    // Mode transition logic. UTC_TIMESTAMP() per the project rule (Eastern session
    // tz vs JS UTC otherwise mismatches). Asymmetric by design:
    //   - audit_only → managed : ALLOWED (prospect converts to paying customer)
    //   - managed → audit_only : REJECTED (would arm a 21-day delete clock on a
    //     paying customer's accumulated data; if the MSP genuinely wants to
    //     decommission, use the explicit delete path, not this footgun)
    // Only set audit_expires_at on the audit_only→managed reset path or on
    // first-time audit_only assignment (which currently can only happen at
    // tenant creation, since this PUT now refuses managed→audit_only).
    if (mode === 'audit_only' && prior.mode === 'managed') {
      return res.status(400).json({
        error: 'invalid_mode_transition',
        message: 'Cannot convert a managed tenant to audit-only. Audit-only mode is for prospect tenants and arms an auto-delete clock; converting a managed tenant would risk losing accumulated history. If you need to remove a managed tenant, use the explicit delete path instead.',
      });
    }
    let auditExpiresClause = '';
    let auditWarnedClause = '';
    if (mode === 'audit_only' && prior.mode !== 'audit_only') {
      // First-time assignment (e.g., a future Add Tenant flow that lands here)
      auditExpiresClause = ', audit_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 14 DAY)';
      auditWarnedClause  = ', audit_expiry_warned_at = NULL';
    } else if (mode === 'managed' && prior.mode !== 'managed') {
      // audit_only → managed conversion: clear the audit lifecycle.
      auditExpiresClause = ', audit_expires_at = NULL';
      auditWarnedClause  = ', audit_expiry_warned_at = NULL';
    }

    const affected = await db.execute(
      `UPDATE tenants SET
        display_name = COALESCE(?, display_name),
        psa_name = COALESCE(?, psa_name),
        language = COALESCE(?, language),
        mode = COALESCE(?, mode),
        polling_interval = COALESCE(?, polling_interval),
        enabled = COALESCE(?, enabled)
        ${auditExpiresClause}
        ${auditWarnedClause}
       WHERE id = ?`,
      [display_name, psa_name, language, mode, polling_interval, enabled, req.params.id]
    );

    // Bust the tenant-mode cache so subsequent requireManagedMode checks see
    // the new value immediately rather than waiting for the 30s TTL to expire.
    try {
      const tenantMode = require('../lib/tenant-mode');
      tenantMode.invalidateCache(req.params.id);
    } catch (_) { /* lib not present in dev environments — non-fatal */ }

    if (affected === 0) return res.status(404).json({ error: 'Tenant not found' });

    const updated = await db.queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    console.log(`[API] Tenant ${req.params.id} updated by ${req.session.user.email}`);

    // Audit — emit one row per edit, describing which fields changed. Fields
    // whose request body value was null/undefined (meaning "unchanged") don't
    // appear in the diff. Fields whose value equals the prior value don't
    // either. No change → no audit row (noop write).
    const diffs = [];
    const checkField = (name, submitted, priorVal) => {
      if (submitted === null || submitted === undefined) return;
      if (submitted === priorVal) return;
      diffs.push(`${name}: ${JSON.stringify(priorVal)} → ${JSON.stringify(submitted)}`);
    };
    checkField('display_name', display_name, prior.display_name);
    checkField('psa_name', psa_name, prior.psa_name);
    checkField('language', language, prior.language);
    checkField('mode', mode, prior.mode);
    checkField('polling_interval', polling_interval, prior.polling_interval);
    // enabled may arrive as bool or 0/1 — normalize both sides for comparison.
    const enabledNormSubmitted = enabled == null ? null : !!enabled;
    const enabledNormPrior = !!prior.enabled;
    if (enabledNormSubmitted !== null && enabledNormSubmitted !== enabledNormPrior) {
      diffs.push(`enabled: ${enabledNormPrior} → ${enabledNormSubmitted}`);
    }

    if (diffs.length > 0) {
      try {
        await changeLog.logPanopticaChange({
          tenantId: parseInt(req.params.id, 10),
          category: changeLog.CATEGORY.TENANT_LIFECYCLE,
          surfaces: [changeLog.SURFACE.OTHER],
          description: `Tenant settings updated — ${diffs.join('; ')}`,
          templateKey: 'manual_cleanup',
          templateParams: { summary: diffs.join('; ') },
          createdBy: req.session.user.email,
          ...changeLog.captureActorContext(req),
        });
      } catch (logErr) {
        console.warn(`[API] Tenant-edit audit log failed (non-fatal): ${logErr.message}`);
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('[API] Update tenant failed:', err.message);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

// ─── Toggle tenant enabled/disabled ───
// Admin-only — lifecycle action.
router.patch('/:id/toggle', auth.requireAdmin, async (req, res) => {
  try {
    const tenant = await db.queryOne('SELECT id, enabled, display_name FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const newState = !tenant.enabled;
    await db.execute('UPDATE tenants SET enabled = ? WHERE id = ?', [newState, req.params.id]);

    console.log(`[API] Tenant "${tenant.display_name}" ${newState ? 'enabled' : 'disabled'} by ${req.session.user.email}`);

    // Audit — toggling enabled/disabled has high blast radius: disabling stops
    // all polling + alert evaluation for the tenant, which the MSP needs to
    // prove was intentional (and when it was re-enabled).
    try {
      await changeLog.logPanopticaChange({
        tenantId: tenant.id,
        category: changeLog.CATEGORY.TENANT_LIFECYCLE,
        surfaces: [changeLog.SURFACE.OTHER],
        description: `Tenant ${newState ? 'ENABLED' : 'DISABLED'} — ${newState ? 'polling + alert evaluation resumed' : 'polling + alert evaluation paused'}`,
        templateKey: newState ? 'tenant_lifecycle.enable' : 'tenant_lifecycle.disable',
        templateParams: { reason: newState ? 'polling + alert evaluation resumed' : 'polling + alert evaluation paused' },
        createdBy: req.session.user.email,
        ...changeLog.captureActorContext(req),
      });
    } catch (logErr) {
      console.warn(`[API] Tenant-toggle audit log failed (non-fatal): ${logErr.message}`);
    }

    res.json({ id: tenant.id, enabled: newState });
  } catch (err) {
    console.error('[API] Toggle tenant failed:', err.message);
    res.status(500).json({ error: 'Failed to toggle tenant' });
  }
});

// ─── Fetch Secure Scores for all enabled tenants ───
router.get('/scores/secure', async (req, res) => {
  try {
    // Return ALL enabled tenants (so the main-console tenant list still
    // shows audit-only ones — operator needs to be able to navigate to
    // their dashboards), but include `mode` so the frontend can filter
    // for the gauge calculations. The cross-tenant Secure Score gauges
    // (average / highest / lowest) reflect managed customers only —
    // audit-only tenants are short-lived prospect snapshots and would
    // distort the KPI signals.
    //
    // Scores are read from metric_snapshots_latest (kept current by the
    // poll engine) rather than fetched live from Graph. Microsoft only
    // recomputes Secure Score about once a day on their side, so the
    // cached value (≤ polling_interval old for managed tenants) is just
    // as accurate as a live call — and reading N rows by primary key
    // beats N parallel Graph round-trips, which on every main-console
    // load was costing 3-4 s of wall time.
    const tenants = await db.queryRows(
      `SELECT id, tenant_id, display_name, mode, last_polled_at FROM tenants
       WHERE enabled = TRUE`
    );

    const scoreRows = await db.queryRows(
      `SELECT tenant_id, metric_value
       FROM metric_snapshots_latest
       WHERE service = 'security' AND metric_name = 'secure_score'`
    );
    const scoreByTenant = new Map();
    for (const row of scoreRows) {
      // mysql2 auto-parses JSON columns, so row.metric_value is usually
      // already an object. Older rows written before the column was a
      // proper JSON type can come back as a string — handle both.
      let value = row.metric_value;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { continue; }
      }
      scoreByTenant.set(row.tenant_id, value);
    }

    const results = tenants.map(t => ({
      tenant_id: t.id,
      tenant_db_id: t.id,
      display_name: t.display_name,
      azure_tenant_id: t.tenant_id,
      mode: t.mode,
      last_polled_at: t.last_polled_at,
      score: scoreByTenant.get(t.id) || null,
    }));

    // Average is computed from MANAGED tenants only — audit-only tenants
    // are excluded from cross-tenant KPIs (their scores would distort the
    // signal). The full results array still includes audit-only tenants so
    // the frontend tenant list can render them; the frontend also filters
    // mode === 'managed' before computing highest/lowest gauges.
    const validManagedScores = results.filter(r => r.score?.percentage != null && r.mode === 'managed');
    const avgPercentage = validManagedScores.length > 0
      ? parseFloat((validManagedScores.reduce((sum, r) => sum + r.score.percentage, 0) / validManagedScores.length).toFixed(2))
      : null;

    res.json({ average: avgPercentage, tenants: results });
  } catch (err) {
    console.error('[API] Secure scores fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch secure scores' });
  }
});

// ─── Fetch Secure Score for a single tenant ───
router.get('/:id/secure-score', async (req, res) => {
  try {
    const tenant = await db.queryOne(
      'SELECT tenant_id, display_name FROM tenants WHERE id = ?', [req.params.id]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const score = await graph.getSecureScore(tenant.tenant_id);
    res.json({ display_name: tenant.display_name, score });
  } catch (err) {
    console.error('[API] Tenant secure score failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch secure score' });
  }
});

// ─── Latest snapshot data for a service ───
router.get('/:id/data/:service', async (req, res) => {
  try {
    const { id, service } = req.params;
    const validServices = ['entra', 'exchange', 'sharepoint', 'onedrive', 'teams', 'security'];
    if (!validServices.includes(service)) {
      return res.status(400).json({ error: 'Invalid service name' });
    }

    // Reads the denormalized "latest" table — one row per metric, kept
    // current by storeSnapshot(). Avoids GROUP BY + MAX over the full
    // metric_snapshots history, which on a managed tenant is hundreds
    // of thousands of rows.
    const snapshots = await db.queryRows(
      `SELECT metric_name, metric_value, captured_at
       FROM metric_snapshots_latest
       WHERE tenant_id = ? AND service = ?`,
      [id, service]
    );

    // Build a flat object: { metric_name: parsed_value, ... }
    const data = {};
    let lastCaptured = null;
    for (const snap of snapshots) {
      try {
        data[snap.metric_name] = JSON.parse(snap.metric_value);
      } catch {
        data[snap.metric_name] = snap.metric_value;
      }
      if (!lastCaptured || snap.captured_at > lastCaptured) {
        lastCaptured = snap.captured_at;
      }
    }

    res.json({ service, captured_at: lastCaptured, data });
  } catch (err) {
    console.error(`[API] Snapshot data failed:`, err.message);
    res.status(500).json({ error: 'Failed to load service data' });
  }
});

// ─── All latest snapshot data (overview — all services) ───
router.get('/:id/data', async (req, res) => {
  try {
    const { id } = req.params;

    // Reads the denormalized "latest" table — one row per (service,
    // metric_name), kept current by storeSnapshot(). Previous version
    // GROUP BY'd + JOIN-MAX'd over the full metric_snapshots history,
    // which on a managed tenant polled every 15 min for 90 days is
    // ~430k rows per tenant and caused 7-8 s dashboard loads.
    const snapshots = await db.queryRows(
      `SELECT service, metric_name, metric_value, captured_at
       FROM metric_snapshots_latest
       WHERE tenant_id = ?`,
      [id]
    );

    const services = {};
    let lastCaptured = null;
    for (const snap of snapshots) {
      if (!services[snap.service]) services[snap.service] = {};
      try {
        services[snap.service][snap.metric_name] = JSON.parse(snap.metric_value);
      } catch {
        services[snap.service][snap.metric_name] = snap.metric_value;
      }
      if (!lastCaptured || snap.captured_at > lastCaptured) {
        lastCaptured = snap.captured_at;
      }
    }

    res.json({ captured_at: lastCaptured, services });
  } catch (err) {
    console.error(`[API] All snapshot data failed:`, err.message);
    res.status(500).json({ error: 'Failed to load tenant data' });
  }
});

// ─── Poll Now: trigger immediate poll for a tenant ───
// Operator: operational refresh action, not a config change.
//
// Fire-and-forget: a full poll of a tenant runs for anywhere from a few
// seconds to several minutes (all Graph fetchers + pwsh spawns for
// EXO/SharePoint/Teams + the security-settings pass). Awaiting it inside
// the HTTP request held the connection open long enough to trip the
// reverse proxy's read timeout (nginx -> 504, Caddy likewise) — the poll
// itself kept running server-side, but the operator saw a failure. So we
// kick the poll off in the background and return 202 immediately; the
// dashboard finishes the UI off the `tenant:updated` Socket.IO event the
// poll already emits on success, or `tenant:poll_failed` emitted below.
router.post('/:id/poll', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenant = await db.queryOne(
      'SELECT id, tenant_id, display_name, polling_interval, last_polled_at, poll_count FROM tenants WHERE id = ? AND enabled = TRUE',
      [req.params.id]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found or disabled' });

    console.log(`[API] Poll Now triggered for "${tenant.display_name}" by ${req.session.user.email}`);
    const io = req.app.get('io');
    const forceFull = req.body.full !== false; // Default: full poll on manual trigger

    polling.pollTenant(tenant, io, forceFull).catch((err) => {
      console.error(`[API] Background poll failed for "${tenant.display_name}":`, err.message);
      if (io) {
        io.emit('tenant:poll_failed', {
          tenantId: tenant.id,
          displayName: tenant.display_name,
          error: err.message,
        });
      }
    });

    res.status(202).json({ success: true, started: true });
  } catch (err) {
    console.error('[API] Poll Now failed:', err.message);
    res.status(500).json({ error: 'Poll failed: ' + err.message });
  }
});

// ─── ADMIN: Manually trigger the audit-only expiry cycle ───
// Same logic the daily cron runs. Useful for verification before the cron
// runs, or to clear out a tenant once you've confirmed it's eligible. Returns
// a summary of what got warned + deleted.
router.post('/audit-expiry/run-now', auth.requireAdmin, async (req, res) => {
  try {
    const auditExpiry = require('../audit-expiry-scheduler');
    const result = await auditExpiry.runOnce();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[API] audit-expiry/run-now failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: Cascade-delete preview (dry-run) ───
// Returns row counts per table for what cascadeDeleteTenant() WOULD remove
// for the given tenant id, without actually deleting anything. Use to
// validate the cascade-delete inventory before letting the auto-expiry job
// fire on a real tenant. Restricted to admins.
router.get('/:id/cascade-delete-dryrun', auth.requireAdmin, async (req, res) => {
  try {
    const cascadeDelete = require('../lib/tenant-cascade-delete');
    const result = await cascadeDelete.cascadeDeleteTenant(req.params.id, {
      dryRun: true,
      reason: 'admin_dryrun',
    });
    res.json(result);
  } catch (err) {
    console.error('[API] cascade-delete-dryrun failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Re-run the EXO/Compliance directory-role assignment for a tenant. Admin-only.
// Same operation that runs automatically at onboarding (lib/assign-exo-roles) —
// exposed so an operator can retry if the first attempt missed (e.g. service
// principal still propagating right after consent). Idempotent + best-effort.
router.post('/:id/assign-exo-roles', auth.requireAdmin, async (req, res) => {
  try {
    const row = await db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Tenant not found' });
    const assignExoRoles = require('../lib/assign-exo-roles');
    const result = await assignExoRoles.assignExoRoles(row.tenant_id);

    try {
      const mspAudit = require('../msp-audit');
      await mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TENANT_LIFECYCLE_MSP,
        action: 'tenant.assign_exo_roles',
        description: `Assigned Exchange/Compliance roles for tenant "${row.display_name}" (spFound=${result.spFound}, allOk=${result.allOk})`,
        templateKey: 'tenant.assign_exo_roles',
        templateParams: { name: row.display_name },
        targetType: 'tenant',
        targetId: String(row.id),
        targetName: row.display_name,
        metadata: { results: result.results, sp_found: result.spFound },
        req,
      });
    } catch (e) { /* audit must not block */ }

    res.json({ ok: result.allOk, spFound: result.spFound, results: result.results });
  } catch (err) {
    console.error('[API] assign-exo-roles failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Hard delete a tenant and ALL of its data (cascade). Admin-only, irreversible.
// The actual multi-table delete lives in lib/tenant-cascade-delete.js (already
// used by the audit-expiry scheduler); here we wrap it with an audit trail.
// Identity is captured from the result (the lib snapshots it before deleting
// the tenants row) so the audit entry is meaningful after the row is gone.
router.delete('/:id', auth.requireAdmin, async (req, res) => {
  const cascadeDelete = require('../lib/tenant-cascade-delete');
  const mspAudit = require('../msp-audit');
  try {
    const result = await cascadeDelete.cascadeDeleteTenant(req.params.id, {
      dryRun: false,
      reason: 'admin_delete',
    });

    if (result.tenantNotFound) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    try {
      await mspAudit.logMspAudit({
        category: mspAudit.CATEGORY.TENANT_LIFECYCLE_MSP,
        action: 'tenant.delete',
        description: `Deleted tenant "${result.tenantName}" and all related data (${result.totalRowsDeleted} rows)`,
        templateKey: 'tenant.deleted',
        templateParams: { name: result.tenantName, rows: result.totalRowsDeleted },
        targetType: 'tenant',
        targetId: String(result.tenantId),
        targetName: result.tenantName,
        metadata: { tenant_guid: result.tenantGuid, total_rows_deleted: result.totalRowsDeleted, per_table: result.perTable },
        req,
      });
    } catch (e) { /* audit must never block the operation */ }

    res.json({ ok: true, deleted: true, tenantName: result.tenantName, totalRowsDeleted: result.totalRowsDeleted });
  } catch (err) {
    console.error('[API] tenant delete failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DEBUG: Check snapshot counts per service ───
router.get('/:id/debug-snapshots', auth.requireAdmin, async (req, res) => {
  try {
    const counts = await db.queryRows(
      `SELECT service, metric_name, COUNT(*) AS cnt,
              MAX(captured_at) AS latest,
              LENGTH(metric_value) AS val_len
       FROM metric_snapshots
       WHERE tenant_id = ?
       GROUP BY service, metric_name
       ORDER BY service, metric_name`,
      [req.params.id]
    );
    res.json({ tenant_id: req.params.id, snapshots: counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Health for a tenant ───
router.get('/:id/api-health', async (req, res) => {
  try {
    const health = await db.queryRows(
      'SELECT * FROM api_health WHERE tenant_id = ? ORDER BY endpoint', [req.params.id]
    );
    res.json(health);
  } catch (err) {
    console.error('[API] API health fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch API health' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Trends (Feature B3) — per-tenant posture & operations time series.
//
// One round-trip feeding the Trends tab. Read-only; visible to ALL RBAC tiers
// (router-level requireAuth, deliberately NO requireAdmin). Response keys map
// 1:1 to the charts, and the same series shapes are reused by the B1/B2 report
// renderers, so the heavy lifting lives here, not in the page module.
//
// Clock discipline (this codebase mixes timezones by table — match each table
// to the clock it was WRITTEN with, per the api-reports precedent):
//   • heatmap_posture_daily is written with UTC_DATE()/UTC_TIMESTAMP() → bound
//     with UTC_DATE().
//   • alerts (triggered_at/closed_at) + metric_snapshots (captured_at) are
//     written with NOW()/CURRENT_TIMESTAMP (session = Eastern) → bound with
//     NOW()/CURDATE(), exactly like src/routes/api-reports.js.
// `days` comes from a fixed whitelist, so interpolating it into INTERVAL is
// injection-safe (and sidesteps the prepared-statement `INTERVAL ? DAY` quirk).
//
// Data sources (verified 2026-06-17):
//   posture       heatmap_posture_daily.score_pct (managed-only, history ~v0.1.24)
//   secure_score  the tenant's OWN Microsoft Secure Score = metric_value.percentage.
//                 Aggregation only writes daily_agg_secure_score for days OLDER
//                 than the 7-day raw window, so the recent week lives only in raw
//                 `secure_score` rows — we UNION the two (raw reduced to one
//                 reading/day) so the line runs all the way to today.
//   alerts        resolved alerts are kept forever → deepest history. is_rollup
//                 rows are excluded from every count; false_positive is excluded
//                 from the customer-facing "resolved" / TTR series.
const TRENDS_RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

// Shared trend derivations (also used by the fleet endpoint). Aliased to the
// historical local names so the call sites below are unchanged.
const {
  num: trendNum,
  median: trendMedian,
  isoWeekLabel,
  parseJson: trendParseJson,
  categoryPct: trendCategoryPct,
  recommendationsCount: trendRecommendationsCount,
} = require('../lib/trend-helpers');

router.get('/:id/trends', async (req, res) => {
  const tenantId = req.params.id;
  const range = TRENDS_RANGES[req.query.range] ? req.query.range : '30d';
  const days = TRENDS_RANGES[range];
  try {
    const tenant = await db.queryOne('SELECT id FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // 1. Coverage stat (posture, DEMOTED to a number — it saturates at 100% on
    //    onboarding and flatlines, so it's no longer a chart). Latest posture
    //    row for the tenant. NULL for audit-only tenants (managed-only table).
    const covRow = await db.queryOne(
      `SELECT score_pct, compliant, applicable
         FROM heatmap_posture_daily
        WHERE tenant_id = ?
        ORDER BY snapshot_date DESC
        LIMIT 1`,
      [tenantId]
    );
    const coverage = (covRow && covRow.score_pct != null)
      ? { pct: trendNum(covRow.score_pct), compliant: trendNum(covRow.compliant), applicable: trendNum(covRow.applicable) }
      : null;

    // 2. Secure Score (THE HERO) + its three derived series, all parsed from
    //    the SAME daily_agg rows. Historical daily aggregates UNION the recent
    //    raw week (one reading/day) keyed by date, so every series runs to
    //    today. Each daily_agg row stores the FULL Microsoft payload
    //    (currentScore, maxScore, percentage, controlScores[],
    //    averageComparativeScores[]).
    const ssAgg = await db.queryRows(
      `SELECT DATE_FORMAT(captured_at, '%Y-%m-%d') AS d, metric_value
         FROM metric_snapshots
        WHERE tenant_id = ?
          AND metric_name = 'daily_agg_secure_score'
          AND captured_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        ORDER BY captured_at`,
      [tenantId]
    );
    const ssRawRecent = await db.queryRows(
      `SELECT DATE_FORMAT(t.captured_at, '%Y-%m-%d') AS d, t.metric_value
         FROM metric_snapshots t
         JOIN (
           SELECT MAX(captured_at) AS last_at
             FROM metric_snapshots
            WHERE tenant_id = ? AND metric_name = 'secure_score'
              AND captured_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
            GROUP BY DATE(captured_at)
         ) last ON t.captured_at = last.last_at
        WHERE t.tenant_id = ? AND t.metric_name = 'secure_score'
        ORDER BY t.captured_at`,
      [tenantId, tenantId]
    );
    const ssByDay = new Map(); // d → full parsed payload (recent raw wins)
    const collectSs = (row) => { const v = trendParseJson(row.metric_value); if (v) ssByDay.set(row.d, v); };
    ssAgg.forEach(collectSs);
    ssRawRecent.forEach(collectSs);
    const ssDays = [...ssByDay.keys()].sort();

    const secure_score = [];
    const secure_by_category = [];
    const recommendations = [];
    for (const d of ssDays) {
      const p = ssByDay.get(d);
      if (p.percentage != null) secure_score.push({ d, pct: trendNum(p.percentage) });
      const cat = trendCategoryPct(p.controlScores, trendNum(p.maxScore));
      if (cat) {
        secure_by_category.push(Object.assign({ d }, cat));
        const rec = trendRecommendationsCount(p.controlScores);
        recommendations.push({ d, addressed: rec.addressed, total: rec.total });
      }
    }

    // Benchmark + headroom from the latest day's payload (null-safe — TotalSeats
    // is often the only populated basis; IndustryTypes is null on small tenants).
    let secure_benchmark = null, points_available = null;
    if (ssDays.length) {
      const latest = ssByDay.get(ssDays[ssDays.length - 1]);
      const acs = Array.isArray(latest.averageComparativeScores) ? latest.averageComparativeScores : [];
      const totalSeats = acs.find(a => a && a.basis === 'TotalSeats');
      if (totalSeats && totalSeats.averageScore != null) {
        secure_benchmark = { basis: 'TotalSeats', pct: Math.round(trendNum(totalSeats.averageScore)) };
      }
      if (latest.maxScore != null && latest.currentScore != null) {
        points_available = Math.max(0, Math.round(trendNum(latest.maxScore) - trendNum(latest.currentScore)));
      }
    }

    // 3. Issues resolved by month + severity bucket. "Work done" → status
    //    'resolved' only (false_positive excluded), bucketed by close month.
    const resolvedRows = await db.queryRows(
      `SELECT DATE_FORMAT(closed_at, '%Y-%m') AS m,
              SUM(severity = 'severe')              AS severe,
              SUM(severity IN ('high','medium'))    AS high_med,
              SUM(severity = 'low')                 AS low,
              SUM(severity = 'info')                AS info
         FROM alerts
        WHERE tenant_id = ? AND is_rollup = 0 AND status = 'resolved'
          AND closed_at IS NOT NULL
          AND closed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        GROUP BY DATE_FORMAT(closed_at, '%Y-%m')
        ORDER BY m`,
      [tenantId]
    );
    const resolved_by_month = resolvedRows.map(r => ({
      m: r.m, severe: trendNum(r.severe), high_med: trendNum(r.high_med),
      low: trendNum(r.low), info: trendNum(r.info),
    }));

    // 4. Open issues over time — count of alerts still awaiting action at the
    //    END of each day in range. Reconstructed honestly from triggered_at /
    //    closed_at (closed_at is set on resolve AND false_positive, NULL on
    //    reopen). A UTC-free recursive date series keeps the comparison in the
    //    same session clock the alert timestamps were written with.
    const openRows = await db.queryRows(
      `WITH RECURSIVE seq AS (
         SELECT DATE_SUB(CURDATE(), INTERVAL ${days} DAY) AS d
         UNION ALL SELECT d + INTERVAL 1 DAY FROM seq WHERE d < CURDATE()
       )
       SELECT DATE_FORMAT(seq.d, '%Y-%m-%d') AS d, COUNT(a.id) AS open
         FROM seq
         LEFT JOIN alerts a
           ON a.tenant_id = ?
          AND a.is_rollup = 0
          AND a.triggered_at < seq.d + INTERVAL 1 DAY
          AND (a.closed_at IS NULL OR a.closed_at >= seq.d + INTERVAL 1 DAY)
        GROUP BY seq.d
        ORDER BY seq.d`,
      [tenantId]
    );
    const open_over_time = openRows.map(r => ({ d: r.d, open: trendNum(r.open) }));

    // 5. Time to resolve — median hours per ISO week, resolved alerts only.
    const ttrRows = await db.queryRows(
      `SELECT YEARWEEK(closed_at, 3) AS yw,
              TIMESTAMPDIFF(MINUTE, triggered_at, closed_at) AS mins
         FROM alerts
        WHERE tenant_id = ? AND is_rollup = 0 AND status = 'resolved'
          AND closed_at IS NOT NULL AND triggered_at IS NOT NULL
          AND closed_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`,
      [tenantId]
    );
    const ttrByWeek = new Map();
    for (const r of ttrRows) {
      const mins = trendNum(r.mins);
      if (mins < 0) continue; // guard against clock-skewed rows
      if (!ttrByWeek.has(r.yw)) ttrByWeek.set(r.yw, []);
      ttrByWeek.get(r.yw).push(mins);
    }
    const ttr_weekly = [...ttrByWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([yw, mins]) => ({
        w: isoWeekLabel(yw),
        median_hours: Math.round((trendMedian(mins) / 60) * 10) / 10,
      }));

    // 6. Alert volume per ISO week by severity bucket (new alerts fired).
    const volumeRows = await db.queryRows(
      `SELECT YEARWEEK(triggered_at, 3) AS yw,
              SUM(severity = 'severe')           AS severe,
              SUM(severity IN ('high','medium')) AS high_med,
              SUM(severity = 'low')              AS low,
              SUM(severity = 'info')             AS info
         FROM alerts
        WHERE tenant_id = ? AND is_rollup = 0
          AND triggered_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        GROUP BY YEARWEEK(triggered_at, 3)
        ORDER BY YEARWEEK(triggered_at, 3)`,
      [tenantId]
    );
    const volume_weekly = volumeRows.map(r => ({
      w: isoWeekLabel(r.yw), severe: trendNum(r.severe), high_med: trendNum(r.high_med),
      low: trendNum(r.low), info: trendNum(r.info),
    }));

    // 7. Top firing policies — fixed last-90-days window (independent of the
    //    selected range), human-readable policy name, coloured by the policy's
    //    dominant severity in that window. Never expose internal policy codes.
    const polRows = await db.queryRows(
      `SELECT a.policy_id, p.name AS name, COUNT(*) AS count,
              SUM(a.severity = 'severe')           AS c_severe,
              SUM(a.severity IN ('high','medium')) AS c_high_med,
              SUM(a.severity = 'low')              AS c_low,
              SUM(a.severity = 'info')             AS c_info
         FROM alerts a
         JOIN alert_policies p ON p.id = a.policy_id
        WHERE a.tenant_id = ? AND a.is_rollup = 0
          AND a.triggered_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY a.policy_id, p.name
        ORDER BY count DESC
        LIMIT 10`,
      [tenantId]
    );
    const top_policies = polRows.map(r => {
      const buckets = [
        ['severe', trendNum(r.c_severe)],
        ['high',   trendNum(r.c_high_med)],
        ['low',    trendNum(r.c_low)],
        ['info',   trendNum(r.c_info)],
      ];
      buckets.sort((a, b) => b[1] - a[1]);
      return { name: r.name, count: trendNum(r.count), severity: buckets[0][1] > 0 ? buckets[0][0] : 'info' };
    });

    // KPI stats — fixed 90-day windows (range-independent), so the headline
    // numbers don't shrink when the operator narrows the chart range.
    const statRow = await db.queryOne(
      `SELECT COUNT(*) AS resolved_90d,
              SUM(severity IN ('severe','high')) AS severe_high_90d
         FROM alerts
        WHERE tenant_id = ? AND is_rollup = 0 AND status = 'resolved'
          AND closed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [tenantId]
    );
    const openNowRow = await db.queryOne(
      `SELECT COUNT(*) AS open_now FROM alerts
        WHERE tenant_id = ? AND is_rollup = 0 AND status IN ('new','investigating')`,
      [tenantId]
    );

    // Earliest Secure Score data we hold for this tenant — drives the "since
    // onboarding" hero label and the honest "collecting…" state when a long
    // range outruns the data. (Secure Score is the deepest series, back to each
    // tenant's first poll via the daily aggregate.)
    const histRow = await db.queryOne(
      `SELECT DATE_FORMAT(MIN(captured_at), '%Y-%m-%d') AS secure_start
         FROM metric_snapshots
        WHERE tenant_id = ? AND metric_name IN ('secure_score','daily_agg_secure_score')`,
      [tenantId]
    );
    const secure_start = histRow?.secure_start || null;
    const rangeStartRow = await db.queryOne(
      `SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${days} DAY), '%Y-%m-%d') AS rs`
    );

    res.json({
      range,
      range_start: rangeStartRow?.rs || null,
      history_start: secure_start,
      secure_start,
      coverage,
      secure_score,
      secure_benchmark,
      secure_by_category,
      recommendations,
      points_available,
      resolved_by_month,
      open_over_time,
      ttr_weekly,
      volume_weekly,
      top_policies,
      stats: {
        resolved_90d: trendNum(statRow?.resolved_90d),
        severe_high_90d: trendNum(statRow?.severe_high_90d),
        open_now: trendNum(openNowRow?.open_now),
      },
    });
  } catch (err) {
    console.error('[API] Tenant trends fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch tenant trends' });
  }
});

module.exports = router;
