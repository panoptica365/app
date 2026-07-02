/**
 * Panoptica365 — Bundle deployment job ledger (Phase 3: deploy engine)
 *
 * Tenant Groups & Configuration Bundles build instructions 2026-07-01, §3.
 * Owns the two-table job ledger, the target expansion + dedup, the
 * DETERMINISTIC preflight, and every legal status transition:
 *
 *   preflight ──(runPreflight)──▶ armed ──(startDeployment)──▶ running
 *   running   ──(worker)────────▶ done | failed
 *   preflight/armed ──(cancel)──▶ cancelled
 *
 * HARD RULE (locked with Jacques): there is NO transition into `running`
 * except from `armed`, and NO transition into `armed` except by
 * runPreflight() completing. Preflight cannot be skipped — do not add a
 * shortcut, ever.
 *
 * Preflight is CODE, not AI. Checks per item:
 *   - consent/token valid for the tenant (blocked if not — per tenant)
 *   - already present on tenant → skip_present, default action 'skip'
 *   - CA named-location placeholders: verified the tenant's named-location
 *     index is READABLE (read-only Graph GET; the resolver auto-creates
 *     missing locations at deploy time, so readability is the real gate)
 *   - Intune target-change warning: existing deployment with a different
 *     assignment_target than the bundle item → warn, never silent
 *
 * License gating: there is no reliable per-tenant SKU record in the DB
 * (verified 2026-07-01), so preflight does NOT fabricate a license verdict;
 * a genuinely unlicensed workload fails its own item at execution with the
 * Graph capability-gate message recorded in exec_error.
 */

'use strict';

const db = require('../db/database');
const auth = require('../auth');
const graph = require('../graph');
const orgStore = require('./org-store');

// ─────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────

async function ensureSchema() {
  // Item tables FK config_bundles + tenants; bundles module creates
  // config_bundles at its own module load — await it to keep fresh-install
  // boots deterministic (same cross-await rationale as api-bundles.js).
  await Promise.allSettled([require('../routes/api-bundles').schemaReady]);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bundle_deployments (
      id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      bundle_id    INT UNSIGNED NOT NULL,
      status       ENUM('preflight','armed','running','done','failed','cancelled') NOT NULL DEFAULT 'preflight',
      target_summary JSON NULL,
      created_by   VARCHAR(255) NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at   DATETIME NULL,
      finished_at  DATETIME NULL,
      FOREIGN KEY (bundle_id) REFERENCES config_bundles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Per-item option SNAPSHOT columns (ca_state / assignment_target /
  // alert_routing): captured at submit time so what the operator reviewed
  // and armed is exactly what executes — a bundle edited between Submit and
  // Deploy cannot silently change the writes (TOCTOU guard).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bundle_deployment_items (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      deployment_id INT UNSIGNED NOT NULL,
      tenant_id     INT UNSIGNED NOT NULL,
      item_type     ENUM('ca','intune') NOT NULL,
      template_id   INT UNSIGNED NOT NULL,
      ca_state          ENUM('report_only','enabled') NULL,
      assignment_target ENUM('none','all_users','all_devices') NULL,
      alert_routing     ENUM('support','personal','both','none') NULL,
      preflight_status ENUM('ok','skip_present','warn','blocked') NULL,
      preflight_note   TEXT NULL,
      action        ENUM('create','skip','overwrite') NULL,
      exec_status   ENUM('pending','success','failed','skipped') NOT NULL DEFAULT 'pending',
      exec_error    TEXT NULL,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at   DATETIME NULL,
      INDEX idx_bdi_deployment (deployment_id),
      FOREIGN KEY (deployment_id) REFERENCES bundle_deployments(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id)     REFERENCES tenants(id)            ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

let schemaError = null;
const schemaReady = ensureSchema()
  .then(() => { console.log('[BundleDeploy] Schema ready (job ledger)'); })
  .catch(err => {
    schemaError = err;
    console.error('[BundleDeploy] Schema migration failed:', err.message);
  });

async function whenReady() {
  await schemaReady;
  if (schemaError) throw new Error(`Bundle-deploy schema migration failed: ${schemaError.message}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Create: target expansion + dedup (§3.2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Expand the operator's selection into a deduplicated tenant set and create
 * the job in `preflight` status with one item row per tenant × bundle item.
 *
 * @param {object} p
 * @param {number} p.bundleId
 * @param {'tenant'|'group'} p.targetKind
 * @param {number[]} p.targetIds       selected tenant ids OR group ids
 * @param {string} p.createdBy
 * @returns {{jobId:number, tenantCount:number, itemCount:number}}
 * @throws {{code:string}} on validation failure (caller maps to 4xx)
 */
async function createDeployment({ bundleId, targetKind, targetIds, createdBy }) {
  await whenReady();

  const bundle = await db.queryOne('SELECT id, name FROM config_bundles WHERE id = ?', [bundleId]);
  if (!bundle) throw Object.assign(new Error('bundle not found'), { code: 'unknown_bundle' });

  const caItems = await db.queryRows(
    'SELECT ca_template_id, ca_state, alert_routing FROM config_bundle_ca_items WHERE bundle_id = ?', [bundleId]
  );
  const intuneItems = await db.queryRows(
    'SELECT intune_template_id, assignment_target, alert_routing FROM config_bundle_intune_items WHERE bundle_id = ?', [bundleId]
  );
  if (caItems.length + intuneItems.length === 0) {
    throw Object.assign(new Error('bundle has no items'), { code: 'empty_bundle' });
  }

  // ── Expansion: union of selected tenants / of all members of selected
  //    groups (shared resolver — the single source of truth), deduped. ──
  const tenantIdSet = new Set();
  const selectedSummary = [];
  if (targetKind === 'tenant') {
    for (const id of targetIds) {
      const t = await db.queryOne('SELECT id, display_name FROM tenants WHERE id = ?', [id]);
      if (!t) throw Object.assign(new Error(`unknown tenant ${id}`), { code: 'unknown_tenant' });
      tenantIdSet.add(t.id);
      selectedSummary.push({ id: t.id, name: t.display_name });
    }
  } else if (targetKind === 'group') {
    for (const id of targetIds) {
      const g = await db.queryOne('SELECT id, name FROM tenant_groups WHERE id = ?', [id]);
      if (!g) throw Object.assign(new Error(`unknown group ${id}`), { code: 'unknown_group' });
      const members = await orgStore.resolveGroupMembers(g.id);
      for (const m of members || []) tenantIdSet.add(m);
      selectedSummary.push({ id: g.id, name: g.name, member_count: (members || []).length });
    }
  } else {
    throw Object.assign(new Error('invalid target kind'), { code: 'invalid_target_kind' });
  }

  if (tenantIdSet.size === 0) {
    throw Object.assign(new Error('selection resolves to zero tenants'), { code: 'empty_targets' });
  }

  const tenantIds = [...tenantIdSet];
  const placeholders = tenantIds.map(() => '?').join(',');
  const tenants = await db.queryRows(
    `SELECT id, display_name FROM tenants WHERE id IN (${placeholders}) ORDER BY display_name`, tenantIds
  );

  const targetSummary = {
    kind: targetKind,
    selected: selectedSummary,
    tenants: tenants.map(t => ({ id: t.id, name: t.display_name })),
  };

  // Timestamps written explicitly in UTC (UTC_TIMESTAMP()) — the column
  // DEFAULT CURRENT_TIMESTAMP is server-tz and the UI parses these as UTC.
  // Per-item options are SNAPSHOTTED here (TOCTOU guard — see schema note).
  const jobId = await db.withTransaction(async (conn) => {
    const [ins] = await conn.execute(
      `INSERT INTO bundle_deployments (bundle_id, status, target_summary, created_by, created_at)
       VALUES (?, 'preflight', ?, ?, UTC_TIMESTAMP())`,
      [bundleId, JSON.stringify(targetSummary), createdBy || null]
    );
    const id = ins.insertId;
    for (const t of tenants) {
      for (const ci of caItems) {
        await conn.execute(
          `INSERT INTO bundle_deployment_items
             (deployment_id, tenant_id, item_type, template_id, ca_state, alert_routing, created_at)
           VALUES (?, ?, 'ca', ?, ?, ?, UTC_TIMESTAMP())`,
          [id, t.id, ci.ca_template_id, ci.ca_state || 'report_only', ci.alert_routing || null]
        );
      }
      for (const ii of intuneItems) {
        await conn.execute(
          `INSERT INTO bundle_deployment_items
             (deployment_id, tenant_id, item_type, template_id, assignment_target, alert_routing, created_at)
           VALUES (?, ?, 'intune', ?, ?, ?, UTC_TIMESTAMP())`,
          [id, t.id, ii.intune_template_id, ii.assignment_target || 'none', ii.alert_routing || null]
        );
      }
    }
    return id;
  });

  return { jobId, tenantCount: tenants.length, itemCount: tenants.length * (caItems.length + intuneItems.length) };
}

// ─────────────────────────────────────────────────────────────────────────
// Preflight (§3.4) — deterministic, code-only
// ─────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /__PANOPTICA_[A-Z0-9_]+__/;

async function setItem(itemId, fields) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  params.push(itemId);
  await db.execute(`UPDATE bundle_deployment_items SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Run the deterministic preflight for a job in `preflight` status, then arm
 * it. Never throws for per-tenant problems — those become blocked/warn item
 * rows; only infrastructure failure (DB down) propagates, leaving the job in
 * `preflight` for the operator to see and retry via a new submission.
 */
async function runPreflight(jobId) {
  await whenReady();
  const job = await db.queryOne('SELECT * FROM bundle_deployments WHERE id = ?', [jobId]);
  if (!job || job.status !== 'preflight') return;

  const items = await db.queryRows(
    'SELECT * FROM bundle_deployment_items WHERE deployment_id = ? ORDER BY tenant_id, item_type, template_id', [jobId]
  );

  // Per-item options come from the item SNAPSHOT (taken at submit); the
  // template tables are consulted only for what can't be snapshotted cheaply
  // (CA policy JSON for the placeholder check, and existence).
  const caIds = [...new Set(items.filter(i => i.item_type === 'ca').map(i => i.template_id))];
  const intuneIds = [...new Set(items.filter(i => i.item_type === 'intune').map(i => i.template_id))];
  const caByTemplate = new Map();
  if (caIds.length) {
    const rows = await db.queryRows(
      `SELECT id, name, policy_json FROM ca_templates WHERE id IN (${caIds.map(() => '?').join(',')})`, caIds
    );
    for (const r of rows) caByTemplate.set(r.id, r);
  }
  const intuneByTemplate = new Map();
  if (intuneIds.length) {
    const rows = await db.queryRows(
      `SELECT id, name FROM intune_templates WHERE id IN (${intuneIds.map(() => '?').join(',')})`, intuneIds
    );
    for (const r of rows) intuneByTemplate.set(r.id, r);
  }

  // Group items by tenant so the consent check runs once per tenant.
  const byTenant = new Map();
  for (const it of items) {
    if (!byTenant.has(it.tenant_id)) byTenant.set(it.tenant_id, []);
    byTenant.get(it.tenant_id).push(it);
  }

  for (const [tenantId, tenantItems] of byTenant) {
    const tenant = await db.queryOne('SELECT id, tenant_id, display_name, enabled, mode FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) {
      for (const it of tenantItems) {
        await setItem(it.id, { preflight_status: 'blocked', preflight_note: 'Tenant no longer exists', action: 'skip' });
      }
      continue;
    }

    // ── Managed/enabled gate: bundle deploys write live security policies
    //    and only ever target managed, enabled tenants. Audit-only tenants
    //    (read-only prospect engagements) and disabled tenants are BLOCKED,
    //    matching the polling engine / Heatmap selection. ──
    if (!tenant.enabled || tenant.mode !== 'managed') {
      const reason = !tenant.enabled ? 'disabled' : 'audit-only';
      for (const it of tenantItems) {
        await setItem(it.id, {
          preflight_status: 'blocked',
          preflight_note: `Tenant is ${reason} — bundle deployments only target managed, enabled tenants.`,
          action: 'skip',
        });
      }
      continue;
    }

    // ── Consent/token check (blocked if not) ──
    let consentOk = true;
    let consentErr = null;
    try {
      await auth.acquireTokenForTenant(tenant.tenant_id);
    } catch (err) {
      consentOk = false;
      consentErr = err.message;
    }
    if (!consentOk) {
      for (const it of tenantItems) {
        await setItem(it.id, {
          preflight_status: 'blocked',
          preflight_note: `Consent/token check failed: ${String(consentErr).slice(0, 500)}`,
          action: 'skip',
        });
      }
      continue;
    }

    // ── CA named-location readability (once per tenant, only when some CA
    //    template in the bundle actually uses placeholders) ──
    const needsLocations = tenantItems.some(it =>
      it.item_type === 'ca' && PLACEHOLDER_RE.test(String(caByTemplate.get(it.template_id)?.policy_json || ''))
    );
    let locationsReadable = true;
    let locationsErr = null;
    if (needsLocations) {
      try {
        await graph.callGraph(tenant.tenant_id, '/identity/conditionalAccess/namedLocations', { version: 'v1.0', silent: true });
      } catch (err) {
        locationsReadable = false;
        locationsErr = err.message;
      }
    }

    for (const it of tenantItems) {
      try {
        if (it.item_type === 'ca') {
          const tpl = caByTemplate.get(it.template_id);
          if (!tpl) {
            await setItem(it.id, { preflight_status: 'blocked', preflight_note: 'Template no longer exists in the library', action: 'skip' });
            continue;
          }
          const existing = await db.queryOne(
            'SELECT id, live_policy_id FROM ca_assignments WHERE template_id = ? AND tenant_id = ?',
            [it.template_id, tenantId]
          );
          if (existing && existing.live_policy_id) {
            await setItem(it.id, {
              preflight_status: 'skip_present',
              preflight_note: 'Already deployed on this tenant (linked live policy). Default: skip. Overwrite re-asserts the template\'s monitored fields via the existing remediate path.',
              action: 'skip',
            });
            continue;
          }
          const hasPlaceholders = PLACEHOLDER_RE.test(String(tpl.policy_json || ''));
          if (hasPlaceholders && !locationsReadable) {
            await setItem(it.id, {
              preflight_status: 'blocked',
              preflight_note: `Policy uses named-location placeholders but the tenant's named locations cannot be read: ${String(locationsErr).slice(0, 300)}`,
              action: 'skip',
            });
            continue;
          }
          await setItem(it.id, {
            preflight_status: 'ok',
            preflight_note: (existing ? 'Assignment exists but nothing deployed yet — will deploy. ' : '')
              + (hasPlaceholders ? 'Named-location placeholders resolve (or are created) automatically at deploy. ' : '')
              + `Lands as ${it.ca_state === 'enabled' ? 'ENFORCED (On)' : 'report-only'}.`,
            action: 'create',
          });
        } else {
          const tpl = intuneByTemplate.get(it.template_id);
          if (!tpl) {
            await setItem(it.id, { preflight_status: 'blocked', preflight_note: 'Template no longer exists in the library', action: 'skip' });
            continue;
          }
          // Query-based presence check — intune_deployments has NO unique key
          // on (template_id, tenant_id); this mirrors the deploy path's own check.
          const existing = await db.queryOne(
            `SELECT id, status, deployed_policy_id, assignment_target FROM intune_deployments
              WHERE template_id = ? AND tenant_id = ? AND status != 'removed' LIMIT 1`,
            [it.template_id, tenantId]
          );
          if (existing && existing.status === 'deployed' && existing.deployed_policy_id) {
            let note = 'Already deployed on this tenant. Default: skip.';
            if (existing.assignment_target && existing.assignment_target !== it.assignment_target) {
              note += ` WARNING: overwrite would change the assignment target from "${existing.assignment_target}" to "${it.assignment_target}".`;
            }
            await setItem(it.id, { preflight_status: 'skip_present', preflight_note: note, action: 'skip' });
            continue;
          }
          await setItem(it.id, {
            preflight_status: 'ok',
            preflight_note: (existing ? `Earlier attempt recorded (status: ${existing.status}) — will retry. ` : '')
              + `Assignment target: ${it.assignment_target}.`,
            action: 'create',
          });
        }
      } catch (err) {
        // A single item's preflight failure must not sink the job — record
        // it honestly as blocked and move on (fail loud, per item).
        console.error(`[BundleDeploy] Preflight item ${it.id} failed:`, err.message);
        await setItem(it.id, {
          preflight_status: 'blocked',
          preflight_note: `Preflight check failed: ${String(err.message).slice(0, 500)}`,
          action: 'skip',
        }).catch(() => {});
      }
    }
  }

  // Arm the job — the ONLY way a job ever reaches `armed`.
  await db.execute("UPDATE bundle_deployments SET status = 'armed' WHERE id = ? AND status = 'preflight'", [jobId]);
  console.log(`[BundleDeploy] Job ${jobId} preflight complete → armed`);
}

/**
 * Close a job whose preflight hit an infrastructure failure (DB blip etc.)
 * so it never sits in `preflight` forever with no visible error. Items are
 * marked skipped with the reason; the job records as failed.
 */
async function failPreflight(jobId, message) {
  await whenReady();
  await db.execute(
    `UPDATE bundle_deployment_items
        SET exec_status = 'skipped', exec_error = ?, finished_at = UTC_TIMESTAMP()
      WHERE deployment_id = ? AND exec_status = 'pending'`,
    [`Pre-flight failed: ${String(message).slice(0, 500)}`, jobId]
  );
  await db.execute(
    "UPDATE bundle_deployments SET status = 'failed', finished_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'preflight'",
    [jobId]
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Operator controls
// ─────────────────────────────────────────────────────────────────────────

/**
 * Set the action on items (overwrite/skip for already-present; create/skip
 * for ok/warn). Only while the job is `armed`. Blocked items are pinned to
 * 'skip' — there is no way to force a blocked item through.
 */
async function setItemActions(jobId, { itemIds = null, allSkipPresent = false, action }) {
  await whenReady();
  if (!['create', 'skip', 'overwrite'].includes(action)) {
    throw Object.assign(new Error('invalid action'), { code: 'invalid_action' });
  }
  const job = await db.queryOne('SELECT id, status FROM bundle_deployments WHERE id = ?', [jobId]);
  if (!job) throw Object.assign(new Error('job not found'), { code: 'not_found' });
  if (job.status !== 'armed') throw Object.assign(new Error('job not editable'), { code: 'not_armed' });

  // Which preflight statuses may take which action:
  //   skip_present → skip | overwrite
  //   ok / warn    → create | skip
  //   blocked      → (skip only, enforced by the WHERE below)
  const allowedFrom = action === 'overwrite' ? "('skip_present')"
    : action === 'create' ? "('ok','warn')"
    : "('ok','warn','skip_present')";

  // The `armed` re-assertion inside the UPDATE closes the race with a
  // concurrent Start: once the job flips to running, no action can land.
  const armedGuard = "AND deployment_id IN (SELECT id FROM bundle_deployments WHERE status = 'armed')";
  let affected = 0;
  if (allSkipPresent) {
    if (action === 'create') throw Object.assign(new Error('create not valid for already-present items'), { code: 'invalid_action' });
    affected = await db.execute(
      `UPDATE bundle_deployment_items SET action = ?
        WHERE deployment_id = ? AND preflight_status = 'skip_present' ${armedGuard}`,
      [action, jobId]
    );
  } else {
    const ids = (itemIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) throw Object.assign(new Error('no items'), { code: 'no_items' });
    const ph = ids.map(() => '?').join(',');
    affected = await db.execute(
      `UPDATE bundle_deployment_items SET action = ?
        WHERE deployment_id = ? AND id IN (${ph}) AND preflight_status IN ${allowedFrom} ${armedGuard}`,
      [action, jobId, ...ids]
    );
  }
  return { affected };
}

/**
 * Arm → running. The ONLY transition into `running`; refuses anything else,
 * which is what makes preflight non-skippable at the data layer.
 */
async function startDeployment(jobId) {
  await whenReady();
  const affected = await db.execute(
    `UPDATE bundle_deployments SET status = 'running', started_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'armed'`,
    [jobId]
  );
  if (affected === 0) {
    const job = await db.queryOne('SELECT status FROM bundle_deployments WHERE id = ?', [jobId]);
    throw Object.assign(
      new Error(job ? `job is ${job.status}, not armed` : 'job not found'),
      { code: job ? 'not_armed' : 'not_found' }
    );
  }
}

async function cancelJob(jobId) {
  await whenReady();
  const affected = await db.execute(
    `UPDATE bundle_deployments SET status = 'cancelled', finished_at = UTC_TIMESTAMP()
      WHERE id = ? AND status IN ('preflight','armed')`,
    [jobId]
  );
  if (affected === 0) {
    const job = await db.queryOne('SELECT status FROM bundle_deployments WHERE id = ?', [jobId]);
    throw Object.assign(
      new Error(job ? `job is ${job.status} — only preflight/armed jobs can be cancelled` : 'job not found'),
      { code: job ? 'not_cancellable' : 'not_found' }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reads (Job Queue tab)
// ─────────────────────────────────────────────────────────────────────────

function safeParse(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v; // mysql2 auto-parses JSON columns
  try { return JSON.parse(v); } catch { return fallback; }
}

async function listJobs(limit = 50) {
  await whenReady();
  const capped = Math.min(Math.max(1, Number(limit) || 50), 200);
  const jobs = await db.queryRows(
    `SELECT d.*, b.name AS bundle_name
       FROM bundle_deployments d
       JOIN config_bundles b ON b.id = d.bundle_id
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${capped}`
  );
  if (!jobs.length) return [];
  const ids = jobs.map(j => j.id);
  const ph = ids.map(() => '?').join(',');
  const rollups = await db.queryRows(
    `SELECT deployment_id,
            COUNT(*) AS total,
            SUM(exec_status = 'success') AS success,
            SUM(exec_status = 'failed')  AS failed,
            SUM(exec_status = 'skipped') AS skipped,
            SUM(exec_status = 'pending') AS pending,
            SUM(preflight_status = 'blocked') AS blocked,
            SUM(preflight_status = 'skip_present') AS already_present,
            COUNT(DISTINCT tenant_id) AS tenant_count
       FROM bundle_deployment_items
      WHERE deployment_id IN (${ph})
      GROUP BY deployment_id`,
    ids
  );
  const byJob = new Map(rollups.map(r => [r.deployment_id, r]));
  return jobs.map(j => ({
    ...j,
    target_summary: safeParse(j.target_summary, null),
    rollup: byJob.get(j.id) || null,
  }));
}

async function getJob(jobId) {
  await whenReady();
  const job = await db.queryOne(
    `SELECT d.*, b.name AS bundle_name
       FROM bundle_deployments d
       JOIN config_bundles b ON b.id = d.bundle_id
      WHERE d.id = ?`,
    [jobId]
  );
  if (!job) return null;
  const items = await db.queryRows(
    `SELECT i.*, tn.display_name AS tenant_name,
            CASE i.item_type
              WHEN 'ca' THEN (SELECT name FROM ca_templates c WHERE c.id = i.template_id)
              ELSE (SELECT name FROM intune_templates x WHERE x.id = i.template_id)
            END AS template_name
       FROM bundle_deployment_items i
       JOIN tenants tn ON tn.id = i.tenant_id
      WHERE i.deployment_id = ?
      ORDER BY tn.display_name, i.item_type, template_name`,
    [jobId]
  );
  return { ...job, target_summary: safeParse(job.target_summary, null), items };
}

// ─────────────────────────────────────────────────────────────────────────
// Boot recovery + retention
// ─────────────────────────────────────────────────────────────────────────

/**
 * A job that was `running` when the process died: items already executed
 * keep their recorded results; still-pending items are marked skipped with
 * an explicit note, and the job is closed as failed so the ledger never
 * shows a running job that no worker owns. Re-deploying the same bundle is
 * safe — already-present items skip.
 */
async function recoverStrandedJobs() {
  await whenReady();
  const stranded = await db.queryRows("SELECT id FROM bundle_deployments WHERE status = 'running'");
  for (const j of stranded) {
    await db.execute(
      `UPDATE bundle_deployment_items
          SET exec_status = 'skipped',
              exec_error = 'Server restarted before this item ran — re-deploy the bundle to retry (already-deployed items will skip).',
              finished_at = UTC_TIMESTAMP()
        WHERE deployment_id = ? AND exec_status = 'pending'`,
      [j.id]
    );
    await db.execute(
      "UPDATE bundle_deployments SET status = 'failed', finished_at = UTC_TIMESTAMP() WHERE id = ?",
      [j.id]
    );
    console.warn(`[BundleDeploy] Recovered stranded running job ${j.id} — marked failed (restart)`);
  }
  return stranded.length;
}

// Completed jobs double as deployment history; prune only well past the
// review window. One constant, one line to change.
const JOB_RETENTION_DAYS = 90;

async function pruneOldJobs() {
  await whenReady();
  const affected = await db.execute(
    `DELETE FROM bundle_deployments
      WHERE status IN ('done','failed','cancelled')
        AND finished_at IS NOT NULL
        AND finished_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${JOB_RETENTION_DAYS} DAY)`
  );
  if (affected > 0) console.log(`[BundleDeploy] Pruned ${affected} deployment job(s) older than ${JOB_RETENTION_DAYS} days`);
  return affected;
}

module.exports = {
  schemaReady,
  whenReady,
  createDeployment,
  runPreflight,
  failPreflight,
  setItemActions,
  startDeployment,
  cancelJob,
  listJobs,
  getJob,
  recoverStrandedJobs,
  pruneOldJobs,
  JOB_RETENTION_DAYS,
};
