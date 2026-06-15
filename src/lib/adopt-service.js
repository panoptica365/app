/**
 * Panoptica365 — Adopt-in-Place service (orchestration)
 *
 * Ties together adopt-store (DB), adopt-graph (Graph reads/writes), the alert
 * engine, MSP audit, and the tenant Change Log. Used by:
 *   - src/routes/api-adopt.js   (operator-initiated import + lifecycle actions)
 *   - src/known-good-worker.js  (daily read-only discovery reconcile — §7)
 *   - src/ual-evaluators.js     (near-real-time new-object detection — §7.4)
 *
 * Posture (spec §2.1): every tenant write here is operator-initiated; the only
 * background behaviour is read-only discovery. Nothing mutates a tenant
 * automatically.
 */

'use strict';

const db = require('./../db/database');
const store = require('./adopt-store');
const adoptGraph = require('./adopt-graph');
const alertEngine = require('./../alert-engine');
const mspAudit = require('./../msp-audit');
const changeLog = require('./../change-log');

const SURFACE_LABEL = { ca: 'Conditional Access', intune: 'Intune' };

let _caDriftPolicyId = null;
let _intuneDriftPolicyId = null;

// ──────────────────────────────────────────────────────────────────────
// Policy resolution (reuse existing per-surface drift policies — spec §2.5)
// ──────────────────────────────────────────────────────────────────────

async function resolveDriftPolicy(surface) {
  const name = surface === 'ca' ? 'CA Policy Drift Detected' : 'Intune Policy Drift Detected';
  const cacheRef = surface === 'ca' ? _caDriftPolicyId : _intuneDriftPolicyId;
  if (cacheRef) {
    const p = await db.queryOne('SELECT id, name, severity, notification_target FROM alert_policies WHERE id = ? LIMIT 1', [cacheRef]);
    if (p) return p;
  }
  const row = await db.queryOne(
    'SELECT id, name, severity, notification_target FROM alert_policies WHERE name = ? LIMIT 1', [name]
  );
  if (row) {
    if (surface === 'ca') _caDriftPolicyId = row.id; else _intuneDriftPolicyId = row.id;
    return row;
  }
  // Fallback: the per-surface drift policy isn't bootstrapped yet (api-ca/api-intune
  // create it lazily). Fall back to the discovery policy so the signal still fires.
  return store.getDiscoveryPolicy();
}

// ──────────────────────────────────────────────────────────────────────
// Alert firing
// ──────────────────────────────────────────────────────────────────────

function cardDeepLink(tenant, surface, obj) {
  return {
    view: 'tenant-dashboard',
    tenantId: tenant.id,
    tab: surface === 'ca' ? 'ca-policies' : 'intune-policies',
    objectId: obj.source_object_id || obj.sourceObjectId,
    origin: 'tenant_sourced',
  };
}

async function fireAlert(tenant, policy, alertData) {
  try {
    const result = await alertEngine.createOrUpdateAlert(tenant, policy, alertData);
    if (result && result.isNew && !result.isAutoResolved) {
      alertEngine.processNewAlert(result, tenant).catch(e =>
        console.error(`[Adopt] processNewAlert failed for alert ${result.id}: ${e.message}`));
    }
    return result;
  } catch (err) {
    console.error(`[Adopt] alert insert failed (tenant ${tenant.id}): ${err.message}`);
    return null;
  }
}

/** "Configuration created outside Panoptica" — a brand-new native object (§7.4). */
async function fireDiscoveryAlert(tenant, surface, obj) {
  const policy = await store.getDiscoveryPolicy();
  if (!policy || !policy.enabled) return null;
  const name = obj.display_name || obj.displayName || obj.source_object_id || obj.sourceObjectId;
  const surfaceLabel = SURFACE_LABEL[surface];
  return fireAlert(tenant, policy, {
    dedup_key: `native_config_appeared:${surface}:${obj.source_object_id || obj.sourceObjectId}`,
    severity: policy.severity || 'medium',
    message: `New ${surfaceLabel} configuration created outside Panoptica: "${name}"`,
    raw_data: {
      surface, origin: 'tenant_sourced',
      objectName: name,
      message_template_key: 'alerts.message_format.adopt_native_appeared',
      message_template_params: { surface: surfaceLabel, name },
      deepLink: cardDeepLink(tenant, surface, obj),
    },
  });
}

/** Adopted card drifted from as-found (§2.5 / acceptance #3). Reuses the surface drift policy. */
async function fireDriftAlert(tenant, surface, obj, diffs, opts = {}) {
  const policy = await resolveDriftPolicy(surface);
  if (!policy) return null;
  const name = obj.display_name || obj.source_object_id;
  const surfaceLabel = SURFACE_LABEL[surface];
  const fieldList = diffs.slice(0, 8).map(d => d.path).join(', ');
  const reason = opts.reason || 'changed';
  const msgKey = reason === 'removed'
    ? 'alerts.message_format.adopt_removed'
    : 'alerts.message_format.adopt_drift';
  const message = reason === 'removed'
    ? `Tenant-sourced ${surfaceLabel} "${name}" was removed from the tenant outside Panoptica`
    : `Tenant-sourced ${surfaceLabel} "${name}" changed from as-found: ${diffs.length} field(s) (${fieldList})`;
  return fireAlert(tenant, policy, {
    dedup_key: `adopt_drift:${surface}:${obj.source_object_id}`,
    severity: policy.severity || 'high',
    message,
    raw_data: {
      surface, origin: 'tenant_sourced', reason,
      fieldCount: diffs.length, fields: diffs.slice(0, 20),
      message_template_key: msgKey,
      message_template_params: { surface: surfaceLabel, name, count: diffs.length, fields: fieldList },
      deepLink: cardDeepLink(tenant, surface, obj),
    },
  });
}

/** A deactivated card was re-enabled/re-activated outside Panoptica (§6.4). */
async function fireReenableAlert(tenant, surface, obj) {
  const policy = await resolveDriftPolicy(surface);
  if (!policy) return null;
  const name = obj.display_name || obj.source_object_id;
  const surfaceLabel = SURFACE_LABEL[surface];
  return fireAlert(tenant, policy, {
    dedup_key: `adopt_reenabled:${surface}:${obj.source_object_id}`,
    severity: 'high',
    message: `Deactivated tenant-sourced ${surfaceLabel} "${name}" was re-enabled outside Panoptica`,
    raw_data: {
      surface, origin: 'tenant_sourced', reason: 'reenabled_externally',
      objectName: name,
      message_template_key: 'alerts.message_format.adopt_reenabled',
      message_template_params: { surface: surfaceLabel, name },
      deepLink: cardDeepLink(tenant, surface, obj),
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Audit (every action: MSP audit row + tenant Change Log row — spec §2.12)
// ──────────────────────────────────────────────────────────────────────

const AUDIT = {
  import:        { action: 'adopt.import',          tplKey: 'tenant_config_imported',     clCat: 'adopt_import',          tenantWrite: false },
  stop:          { action: 'adopt.stop_monitoring', tplKey: 'tenant_card_stop_monitoring', clCat: 'adopt_stop_monitoring', tenantWrite: false },
  deactivate:    { action: 'adopt.deactivate',      tplKey: 'tenant_object_deactivated',   clCat: 'adopt_deactivate',      tenantWrite: true  },
  restore:       { action: 'adopt.restore',         tplKey: 'tenant_object_restored',      clCat: 'adopt_restore',         tenantWrite: true  },
  delete:        { action: 'adopt.delete',          tplKey: 'tenant_object_deleted',       clCat: 'adopt_delete',          tenantWrite: true  },
};

/**
 * Write both audit rows for an adopt action. `tplParams` MUST carry the
 * object's human-readable name + operator — NEVER an internal id (house rule).
 */
async function auditAction(kind, tenant, { surface, objectName, operator, count, req, success = true, errorMessage = null }) {
  const meta = AUDIT[kind];
  const surfaceLabel = SURFACE_LABEL[surface] || surface;
  const tplParams = { name: objectName, surface: surfaceLabel, operator: operator || null };
  if (count !== undefined) tplParams.count = count;

  // MSP audit (platform-level, Admin-readable)
  await mspAudit.logMspAudit({
    category: mspAudit.CATEGORY.TENANT_CONFIG,
    action: meta.action,
    description: auditFallback(kind, surfaceLabel, objectName, count),
    templateKey: meta.tplKey,
    templateParams: tplParams,
    targetType: surface === 'ca' ? 'ca_policy' : 'intune_config',
    targetName: objectName,
    success, errorMessage, req,
  });

  // Tenant Change Log (appears in the tenant's Change Log view)
  if (success) {
    try {
      await changeLog.logPanopticaChange({
        tenantId: tenant.id,
        category: meta.clCat,
        surfaces: [surface],
        description: auditFallback(kind, surfaceLabel, objectName, count),
        templateKey: meta.tplKey,
        templateParams: tplParams,
        createdBy: operator || 'panoptica-system',
        ...(req ? changeLog.captureActorContext(req) : {}),
      });
    } catch (e) {
      console.warn(`[Adopt] change-log write failed (non-fatal): ${e.message}`);
    }
  }
}

function auditFallback(kind, surfaceLabel, objectName, count) {
  switch (kind) {
    case 'import': return `Imported ${count != null ? count + ' ' : ''}existing ${surfaceLabel} configuration(s) into monitoring`;
    case 'stop': return `Stopped monitoring ${surfaceLabel} "${objectName}" (no tenant change)`;
    case 'deactivate': return `Deactivated ${surfaceLabel} "${objectName}" in the tenant`;
    case 'restore': return `Restored ${surfaceLabel} "${objectName}" in the tenant`;
    case 'delete': return `Deleted ${surfaceLabel} "${objectName}" from the tenant`;
    default: return `${kind} ${surfaceLabel} "${objectName}"`;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Already-managed exclusion — don't duplicate Panoptica's own template cards
// ──────────────────────────────────────────────────────────────────────

/**
 * The set of LIVE Graph object ids in this tenant+surface that Panoptica
 * already manages via a deployed/matched template (ca_assignments.live_policy_id
 * / intune_deployments.deployed_policy_id). Import and discovery exclude these
 * so a policy Panoptica deployed never also gets a tenant-sourced card or a
 * "created outside Panoptica" alert.
 *
 * Matched by OBJECT ID, not displayName: the deployment records exactly which
 * live policy it created/matched, so this is exact even if the operator renames
 * the policy in the tenant (a name filter would miss a renamed policy and
 * duplicate it). Names are also not unique. (House rule: identity, not name.)
 */
async function getManagedLiveIds(tenantId, surface) {
  const set = new Set();
  try {
    if (surface === 'ca') {
      const rows = await db.queryRows(
        "SELECT live_policy_id FROM ca_assignments WHERE tenant_id = ? AND live_policy_id IS NOT NULL AND live_policy_id <> ''",
        [tenantId]
      );
      for (const r of rows) set.add(r.live_policy_id);
    } else {
      const rows = await db.queryRows(
        "SELECT deployed_policy_id FROM intune_deployments WHERE tenant_id = ? AND deployed_policy_id IS NOT NULL AND deployed_policy_id <> ''",
        [tenantId]
      );
      for (const r of rows) set.add(r.deployed_policy_id);
    }
  } catch (e) {
    // Template tables may not exist yet on a brand-new DB — then there is
    // nothing managed to exclude. Non-fatal.
    console.warn(`[Adopt] getManagedLiveIds(${surface}) failed (non-fatal): ${e.message}`);
  }
  return set;
}

// ──────────────────────────────────────────────────────────────────────
// Import (Step 1 — adopt in place, §5)
// ──────────────────────────────────────────────────────────────────────

/** Map a live CA policy into an upsertObject payload. */
function caToObject(policy, importedBy) {
  const disabled = policy.state === 'disabled';
  return {
    surface: 'ca', policyType: null,
    sourceObjectId: policy.id,
    displayName: policy.displayName || policy.id,
    lifecycleState: disabled ? 'deactivated' : 'active',
    msManaged: adoptGraph.looksMicrosoftManaged(policy),
    config: policy, assignments: null, importedBy,
  };
}

function intuneToObject(o, importedBy) {
  return {
    surface: 'intune', policyType: o.policyType,
    sourceObjectId: o.id,
    displayName: o.displayName || o.id,
    lifecycleState: 'active',
    msManaged: false,
    config: o.config, assignments: o.assignments || [], importedBy,
  };
}

/**
 * Import an entire surface for a tenant. Returns one of:
 *   { status: 'success', imported }
 *   { status: 'empty' }
 *   { status: 'unlicensed' }
 *   { status: 'transient', detail }
 * Each surface resolves independently (§5.5). On success/empty the caller hides
 * the button; on unlicensed/transient it stays visible.
 *
 * @param {object} tenant — { id, tenant_id, display_name }
 */
async function importSurface(tenant, surface, { req, operator } = {}) {
  await store.ensureSchema();
  const read = surface === 'ca'
    ? await adoptGraph.readCaPolicies(tenant.tenant_id)
    : await adoptGraph.readIntuneObjects(tenant.tenant_id);

  if (!read.ok) {
    // Audit the FAILED attempt, distinguishing license-gate from real failure.
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY.TENANT_CONFIG,
      action: AUDIT.import.action,
      description: read.reason === 'unlicensed'
        ? `Import skipped — ${SURFACE_LABEL[surface]} not licensed for tenant "${tenant.display_name}"`
        : `Import could not read ${SURFACE_LABEL[surface]} for tenant "${tenant.display_name}" (${read.reason})`,
      targetType: surface === 'ca' ? 'ca_policy' : 'intune_config',
      targetName: tenant.display_name,
      success: false,
      errorMessage: read.detail || read.reason,
      metadata: { surface, reason: read.reason },
      req,
    });
    // Do NOT establish a watermark — leaving it unestablished means the first
    // successful read later silently baselines (no false "new!" flood). §5.5.
    return { status: read.reason, detail: read.detail };
  }

  const objects = read.values || [];
  // Import is idempotent + safe to re-run (the button is always available). Skip
  // anything already handled so re-import only adopts genuinely NEW native
  // objects — same rules as the discovery loop, by object id:
  //   - managed by a Panoptica template       → never adopt (would duplicate)
  //   - already adopted (tenant-sourced card)  → leave as-is
  //   - dismissed (operator Stopped monitoring)→ respect that; don't resurrect
  const managed = await getManagedLiveIds(tenant.id, surface);
  const existingCards = await store.getObjects(tenant.id, surface);
  const cardedIds = new Set(existingCards.map(c => c.source_object_id));
  const seen = await store.getSeenSet(tenant.id, surface);

  let imported = 0;
  let skippedManaged = 0;
  for (const raw of objects) {
    if (managed.has(raw.id)) { skippedManaged += 1; continue; }
    if (cardedIds.has(raw.id)) continue;                       // already adopted
    const s = seen.get(raw.id);
    if (s && s.dismissed) continue;                            // operator stopped monitoring it
    const payload = surface === 'ca' ? caToObject(raw, operator) : intuneToObject(raw, operator);
    await store.upsertObject(tenant.id, payload);
    imported += 1;
  }
  // Seed the seen-set with EVERY enumerated id (managed + adopted) + mark the
  // watermark established (even when empty — load-bearing for empty-but-licensed).
  const ids = objects.map(o => o.id);
  if (ids.length) await store.addSeen(tenant.id, surface, ids);
  await store.establishWatermark(tenant.id, surface, { licenseState: 'licensed' });
  await store.markOperatorImported(tenant.id, surface); // records first-adopt time

  await auditAction('import', tenant, { surface, objectName: tenant.display_name, operator, count: imported, req });
  // status: 'success' (adopted ≥1 new), 'nothing_new' (objects exist but all
  // already managed/adopted/dismissed), 'empty' (no objects at all).
  let status = 'success';
  if (objects.length === 0) status = 'empty';
  else if (imported === 0) status = 'nothing_new';
  return { status, imported, total: objects.length, skipped_managed: skippedManaged };
}

// ──────────────────────────────────────────────────────────────────────
// Discovery reconcile (Step 3 — read-only loop, §7)
// ──────────────────────────────────────────────────────────────────────

/**
 * Reconcile ONE surface for ONE tenant: detect newly-appeared native objects,
 * drift-check active adopted cards, and watch deactivated cards for external
 * re-enable. Read-only with respect to the tenant. Silent on unlicensed/empty.
 *
 * @returns { newObjects, drifted, reenabled } counts (or { skipped:'unlicensed'|'transient' })
 */
async function reconcileTenantSurface(tenant, surface, { fireAlerts = true } = {}) {
  await store.ensureSchema();
  const read = surface === 'ca'
    ? await adoptGraph.readCaPolicies(tenant.tenant_id)
    : await adoptGraph.readIntuneObjects(tenant.tenant_id);

  if (!read.ok) {
    // Unlicensed / transient is a NORMAL silent state for discovery (§5.5/§7).
    if (await store.isWatermarkEstablished(tenant.id, surface)) {
      await store.touchReconciled(tenant.id, surface, read.reason === 'unlicensed' ? 'unlicensed' : null);
    }
    return { skipped: read.reason };
  }

  const liveList = (read.values || []).map(v => surface === 'ca'
    ? { id: v.id, displayName: v.displayName, config: v, assignments: null, state: v.state }
    : { id: v.id, displayName: v.displayName, config: v.config, assignments: v.assignments, policyType: v.policyType });
  const liveById = new Map(liveList.map(o => [o.id, o]));

  // First-ever enumeration with no watermark → silent baseline (no cards, no alerts).
  if (!await store.isWatermarkEstablished(tenant.id, surface)) {
    if (liveList.length) await store.addSeen(tenant.id, surface, liveList.map(o => o.id));
    await store.establishWatermark(tenant.id, surface, { licenseState: 'licensed' });
    return { newObjects: 0, drifted: 0, reenabled: 0, firstEnumeration: true };
  }

  const seen = await store.getSeenSet(tenant.id, surface);
  const carded = await store.getObjects(tenant.id, surface);
  const cardedById = new Map(carded.map(c => [c.source_object_id, c]));
  // Exclude anything Panoptica manages via a template — including a template
  // deployed AFTER adoption (its new live policy must not be flagged as
  // "created outside Panoptica"). Re-queried each cycle so it stays current.
  const managed = await getManagedLiveIds(tenant.id, surface);

  let newObjects = 0, drifted = 0, reenabled = 0;

  // 1) Newly-appeared native objects.
  for (const o of liveList) {
    if (cardedById.has(o.id)) continue;
    if (managed.has(o.id)) { await store.addSeen(tenant.id, surface, [o.id]); continue; } // Panoptica-managed → never card/alert
    const s = seen.get(o.id);
    if (s) continue;                 // already seen (incl. dismissed) → never re-card
    const payload = surface === 'ca'
      ? caToObject(o.config, null)
      : intuneToObject({ id: o.id, displayName: o.displayName, policyType: o.policyType, config: o.config, assignments: o.assignments }, null);
    const { id } = await store.upsertObject(tenant.id, payload);
    await store.addSeen(tenant.id, surface, [o.id]);
    newObjects += 1;
    if (fireAlerts) {
      const obj = await store.getObjectById(id);
      await fireDiscoveryAlert(tenant, surface, obj);
    }
  }

  // 2) Drift + re-enable on existing cards.
  for (const card of carded) {
    // If this object became Panoptica-managed since adoption (operator matched it
    // to a template), the template engine now owns its drift — skip here to avoid
    // double monitoring/alerting. The operator can Stop monitoring the stale card.
    if (managed.has(card.source_object_id)) continue;
    const live = liveById.get(card.source_object_id);

    if (!live) {
      // Adopted object no longer present in the tenant — a change from as-found.
      if (card.lifecycle_state === 'active' && card.drift_status !== 'drifted') {
        await store.setDrift(card.id, 'drifted', { reason: 'removed' });
        drifted += 1;
        if (fireAlerts) await fireDriftAlert(tenant, surface, card, [], { reason: 'removed' });
      }
      continue;
    }

    if (card.lifecycle_state === 'deactivated') {
      // Re-enable watch (always on for deactivated cards).
      const reactivated = surface === 'ca'
        ? live.state && live.state !== 'disabled'
        : Array.isArray(live.assignments) && live.assignments.length > 0;
      if (reactivated && card.drift_status !== 'drifted') {
        await store.setDrift(card.id, 'drifted', { reason: 'reenabled_externally' });
        reenabled += 1;
        if (fireAlerts) await fireReenableAlert(tenant, surface, card);
      }
      // Full drift only if the operator opted in (§2.9).
      if (!card.monitor_on_deactivate) continue;
    }

    const drift = store.computeDrift(card, live.config, live.assignments);
    if (drift.drifted) {
      if (card.drift_status !== 'drifted') {
        await store.setDrift(card.id, 'drifted', { configDiffs: drift.configDiffs, assignmentDiffs: drift.assignmentDiffs });
        drifted += 1;
        if (fireAlerts) {
          await fireDriftAlert(tenant, surface, card, [...drift.configDiffs, ...drift.assignmentDiffs]);
        }
      }
    } else if (card.drift_status === 'drifted') {
      await store.setDrift(card.id, 'ok', null); // reverted to as-found
    } else {
      await store.setDrift(card.id, 'ok', null);
    }
  }

  await store.touchReconciled(tenant.id, surface, 'licensed');
  return { newObjects, drifted, reenabled };
}

/** Reconcile both surfaces for one tenant — called by the daily worker. */
async function reconcileTenant(tenant, opts = {}) {
  const out = {};
  for (const surface of store.SURFACES) {
    try {
      out[surface] = await reconcileTenantSurface(tenant, surface, opts);
    } catch (e) {
      console.error(`[Adopt] reconcile ${surface} failed for tenant ${tenant.id} (${tenant.display_name}): ${e.message}`);
      out[surface] = { error: e.message };
    }
  }
  return out;
}

/**
 * Near-real-time hook (UAL evaluator, §7.4): a specific native object id was
 * reported created in a surface. Materialize + alert iff genuinely new
 * (respects watermark / seen-set / dismissed / already-carded). Idempotent with
 * the daily loop via the shared dedup key.
 */
async function handleNativeObjectAppeared(tenant, surface, objectId, policyType = null) {
  await store.ensureSchema();
  // Only act once a watermark exists — before that, the first enumeration is
  // the silent baseline and a UAL event should not pre-empt it with an alert.
  if (!await store.isWatermarkEstablished(tenant.id, surface)) return { skipped: 'no_watermark' };

  const seen = await store.getSeenSet(tenant.id, surface);
  if (seen.has(objectId)) return { skipped: 'already_seen' };
  const carded = await store.getObjects(tenant.id, surface);
  if (carded.some(c => c.source_object_id === objectId)) return { skipped: 'already_carded' };
  // Don't card a policy Panoptica deployed via a template.
  const managed = await getManagedLiveIds(tenant.id, surface);
  if (managed.has(objectId)) { await store.addSeen(tenant.id, surface, [objectId]); return { skipped: 'panoptica_managed' }; }

  // Read the one object live to baseline it accurately.
  let payload;
  if (surface === 'ca') {
    const p = await adoptGraph.readCaPolicy(tenant.tenant_id, objectId);
    if (!p) return { skipped: 'not_found' };
    payload = caToObject(p, null);
  } else {
    if (!policyType) return { skipped: 'no_policy_type' };
    const r = await adoptGraph.readIntuneObject(tenant.tenant_id, policyType, objectId);
    if (!r) return { skipped: 'not_found' };
    payload = intuneToObject({ id: objectId, displayName: r.config.displayName || r.config.name || objectId, policyType, config: r.config, assignments: r.assignments }, null);
  }
  const { id } = await store.upsertObject(tenant.id, payload);
  await store.addSeen(tenant.id, surface, [objectId]);
  const obj = await store.getObjectById(id);
  await fireDiscoveryAlert(tenant, surface, obj);
  return { created: true, cardId: id };
}

// ──────────────────────────────────────────────────────────────────────
// Lifecycle actions (Step 2 — §6)
// ──────────────────────────────────────────────────────────────────────

/** (1) Stop monitoring — Panoptica-only, NO tenant write. */
async function stopMonitoring(tenant, card, { req, operator } = {}) {
  await store.markDismissed(tenant.id, card.surface, card.source_object_id);
  await store.deleteObject(card.id);
  await auditAction('stop', tenant, { surface: card.surface, objectName: card.display_name, operator, req });
  return { ok: true };
}

/** (2) Deactivate — reversible tenant write. */
async function deactivate(tenant, card, { monitor = false, req, operator } = {}) {
  if (card.surface === 'ca') {
    // Snapshot prior state BEFORE the write so Restore is real.
    const live = await adoptGraph.readCaPolicy(tenant.tenant_id, card.source_object_id);
    const priorState = live ? live.state : 'enabled';
    try {
      await adoptGraph.caSetState(tenant.tenant_id, card.source_object_id, 'disabled', card.ms_managed);
    } catch (e) {
      if (e instanceof adoptGraph.ManagedByMicrosoftError) {
        await auditAction('deactivate', tenant, { surface: card.surface, objectName: card.display_name, operator, req, success: false, errorMessage: 'managed_by_microsoft' });
        return { ok: false, reason: 'managed_by_microsoft' };
      }
      throw e;
    }
    await store.setLifecycle(card.id, 'deactivated', { snapshot: { state: priorState }, monitorOnDeactivate: monitor });
  } else {
    // Intune: snapshot the FULL assignment set BEFORE stripping (no global off
    // switch; removing assignments destroys them — the snapshot makes Restore real).
    const live = await adoptGraph.readIntuneObject(tenant.tenant_id, card.policy_type, card.source_object_id);
    const targets = (live && live.assignments || []).map(a => a.target).filter(Boolean);
    await adoptGraph.intuneSetAssignments(tenant.tenant_id, card.policy_type, card.source_object_id, []);
    await store.setLifecycle(card.id, 'deactivated', { snapshot: { assignments: targets }, monitorOnDeactivate: monitor });
  }
  await auditAction('deactivate', tenant, { surface: card.surface, objectName: card.display_name, operator, req });
  return { ok: true };
}

/** (2b) Restore a deactivated card — replays the deactivation snapshot. */
async function restore(tenant, card, { req, operator } = {}) {
  const snap = card.deactivation_snapshot || {};
  if (card.surface === 'ca') {
    const state = snap.state && snap.state !== 'disabled' ? snap.state : 'enabled';
    try {
      await adoptGraph.caSetState(tenant.tenant_id, card.source_object_id, state, card.ms_managed);
    } catch (e) {
      if (e instanceof adoptGraph.ManagedByMicrosoftError) {
        await auditAction('restore', tenant, { surface: card.surface, objectName: card.display_name, operator, req, success: false, errorMessage: 'managed_by_microsoft' });
        return { ok: false, reason: 'managed_by_microsoft' };
      }
      throw e;
    }
  } else {
    await adoptGraph.intuneSetAssignments(tenant.tenant_id, card.policy_type, card.source_object_id, snap.assignments || []);
  }
  await store.setLifecycle(card.id, 'active', { snapshot: null });
  await store.setDrift(card.id, 'ok', null);
  await auditAction('restore', tenant, { surface: card.surface, objectName: card.display_name, operator, req });
  return { ok: true };
}

/** (3) Delete — destructive tenant write. */
async function deleteFromTenant(tenant, card, { req, operator } = {}) {
  try {
    if (card.surface === 'ca') {
      await adoptGraph.caDelete(tenant.tenant_id, card.source_object_id, card.ms_managed);
    } else {
      await adoptGraph.intuneDelete(tenant.tenant_id, card.policy_type, card.source_object_id);
    }
  } catch (e) {
    if (e instanceof adoptGraph.ManagedByMicrosoftError) {
      await auditAction('delete', tenant, { surface: card.surface, objectName: card.display_name, operator, req, success: false, errorMessage: 'managed_by_microsoft' });
      return { ok: false, reason: 'managed_by_microsoft' };
    }
    // Honest failure (Rule 12): the card stays; next discovery reconciles.
    await auditAction('delete', tenant, { surface: card.surface, objectName: card.display_name, operator, req, success: false, errorMessage: e.message });
    return { ok: false, reason: 'graph_error', message: e.message };
  }
  // Tenant delete succeeded — remove the card + drop from seen-set (if it ever
  // reappears, discovery treats it as new).
  await store.deleteObject(card.id);
  await store.removeSeen(tenant.id, card.surface, card.source_object_id);
  await auditAction('delete', tenant, { surface: card.surface, objectName: card.display_name, operator, req });
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers for routes
// ──────────────────────────────────────────────────────────────────────

/** Load a tenant row (db id + azure GUID + name) by internal id. */
async function loadTenant(tenantId) {
  return db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
}

/** Surface-level import status for the UI (drives whether to show the button). */
async function getImportState(tenantId) {
  await store.ensureSchema();
  const out = {};
  for (const surface of store.SURFACES) {
    const wm = await store.getWatermark(tenantId, surface);
    out[surface] = {
      // Button hidden ONLY after an explicit operator Import (imported_at set) —
      // incl. the empty-but-licensed case. The silent discovery enumeration
      // establishes a watermark row but leaves imported_at NULL, so it does NOT
      // hide the button. Unlicensed/transient never establish the watermark.
      imported: !!(wm && wm.imported_at),
      license_state: wm ? wm.license_state : 'unknown',
      last_reconciled_at: wm ? wm.last_reconciled_at : null,
    };
  }
  return out;
}

module.exports = {
  SURFACE_LABEL,
  importSurface,
  reconcileTenantSurface,
  reconcileTenant,
  handleNativeObjectAppeared,
  stopMonitoring,
  deactivate,
  restore,
  deleteFromTenant,
  loadTenant,
  getImportState,
  // exposed for tests
  caToObject,
  intuneToObject,
};
