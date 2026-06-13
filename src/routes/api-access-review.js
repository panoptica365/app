/**
 * Panoptica365 — Access Review API (A1)
 *
 * Backs the tenant-dashboard "Access review" tab:
 *   GET    /api/access-review            cache-first snapshot (all tiers)
 *   POST   /api/access-review/refresh    live re-pull + reassemble (Member+)
 *   POST   /api/access-review/disable    PATCH accountEnabled=false (Member+)
 *   POST   /api/access-review/enable     PATCH accountEnabled=true  (Member+)
 *   POST   /api/access-review/delete     DELETE user (30-day soft)  (Member+)
 *   GET    /api/access-review/break-glass         list designations (all tiers)
 *   POST   /api/access-review/break-glass         add designation   (Member+)
 *   DELETE /api/access-review/break-glass/:id     remove            (Member+)
 *
 * Governing rules (dev/Panoptica/CLAUDE.md + the A1 build doc):
 *   - No autonomous remediation. Every write is operator-clicked, passes a
 *     confirm modal, and is gated + audited. Disable/Delete are Member+ (Jacques:
 *     Operators AND Admins).
 *   - Server-side guards are authoritative (NOT UI-only, NOT the cached snapshot):
 *       · Delete is rejected when the target holds ANY privileged role.
 *       · Disabling the LAST enabled Global Administrator is rejected (lockout).
 *       · Disabling/Deleting a break-glass account requires acknowledge_breakglass.
 *     Each guard re-checks LIVE Graph at write time so a stale snapshot can't let
 *     a dangerous write through.
 *   - A Graph 403 on a write means the User.ReadWrite.All scope/consent is missing
 *     on this tenant — say exactly that, never silently widen scope.
 *   - Every write lands in msp_audit_events (templateKey + params) AND the tenant
 *     change log: actor, target UPN, action, outcome.
 */

'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const db = require('../db/database');
const graph = require('../graph');
const fetchers = require('../fetchers');
const store = require('../lib/access-review-store');
const bgGraph = require('../lib/break-glass-graph');
const mspAudit = require('../msp-audit');
const changeLog = require('../change-log');
const config = require('../../config/default');

const GA_TEMPLATE_ID = '62e90394-69f5-4237-9190-012177145e10';

router.use(auth.requireAuth);

function loadTenant(tenantId) {
  return db.queryOne('SELECT id, tenant_id, display_name FROM tenants WHERE id = ?', [tenantId]);
}

function inactivityDays() {
  const n = config.accessReview && config.accessReview.inactivityThresholdDays;
  return Number.isFinite(n) && n > 0 ? n : 90;
}

// ──────────────────────────────────────────────────────────────────────
// Assembly — live pull both rosters + tag break-glass. Fail-fast: if EITHER
// critical pull throws, the whole refresh fails and the prior snapshot is left
// intact (never overwrite a good roster with a half-empty one — that would read
// as a false "0 admins" / removed users).
// ──────────────────────────────────────────────────────────────────────
async function assembleSnapshot(tenant) {
  const days = inactivityDays();
  const [rolesData, usersData, bgIndex] = await Promise.all([
    fetchers.fetchPrivilegedRoles(tenant.tenant_id),
    fetchers.fetchAccessReviewUsers(tenant.tenant_id, { inactivityDays: days }),
    store.breakGlassIndex(tenant.id),
  ]);

  const priv = rolesData.privileged_roles;
  const isBG = (row) => {
    const upn = String(row.userPrincipalName || '').toLowerCase();
    return bgIndex.upns.has(upn) || (row.id && bgIndex.ids.has(String(row.id)));
  };

  priv.accounts = priv.accounts.map(a => ({ ...a, breakGlass: isBG(a) }));
  const users = usersData.users.map(u => {
    const breakGlass = isBG(u);
    // Break-glass accounts are never styled inactive even when dormant (§5).
    return { ...u, breakGlass, inactive: breakGlass ? false : u.inactive };
  });

  const summary = {
    ...usersData.summary,
    privileged_total: priv.count,
    ga_count: priv.ga_count,
    no_mfa_admins: priv.no_mfa_count,
    tiers: priv.tiers,
  };

  return {
    payload: { privileged_roles: priv, users, summary, inactivity_days: days },
    reportsAnonymized: !!usersData.reports_anonymized,
  };
}

// ── GET /api/access-review?tenant_id= — cache-first (all tiers)
router.get('/', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const snapshot = await store.readSnapshot(tenantId);
    const breakGlass = await store.listBreakGlass(tenantId);
    res.json({
      tenant: { id: tenant.id, tenant_id: tenant.tenant_id, display_name: tenant.display_name },
      snapshot: snapshot || null,
      break_glass: breakGlass,
      inactivity_days: inactivityDays(),
    });
  } catch (err) {
    console.error('[AccessReview] GET failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/access-review/refresh?tenant_id= (Member+) — live re-pull
router.post('/refresh', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id || (req.body && req.body.tenant_id), 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    const { payload, reportsAnonymized } = await assembleSnapshot(tenant);
    await store.writeSnapshot(tenantId, payload, { reportsAnonymized });
    const snapshot = await store.readSnapshot(tenantId);
    res.json({ ok: true, snapshot, break_glass: await store.listBreakGlass(tenantId) });
  } catch (err) {
    console.error('[AccessReview] refresh failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Live guard helpers (authoritative — re-checked at write time)
// ──────────────────────────────────────────────────────────────────────

/** Enabled Global-Administrator user object ids (locale-proof — matches by template id). */
async function enabledGlobalAdminIds(guid) {
  const roles = await graph.callGraphPaged(guid, '/directoryRoles?$select=id,displayName,roleTemplateId');
  const ga = (roles || []).find(r => String(r.roleTemplateId || '').toLowerCase() === GA_TEMPLATE_ID);
  if (!ga) return [];
  const members = await graph.callGraphPaged(guid,
    `/directoryRoles/${ga.id}/members?$select=id,accountEnabled,userPrincipalName`);
  return (members || [])
    .filter(m => m.userPrincipalName && m.accountEnabled !== false)
    .map(m => String(m.id));
}

/** Does the target hold ANY watched privileged role? Authoritative live check. */
async function targetHoldsPrivilegedRole(guid, userId) {
  // ual-evaluators is the single source of truth for "privileged"; reuse it.
  const { ROLE_PRIORITY } = require('../ual-evaluators');
  const roles = await graph.callGraphPaged(guid,
    `/users/${userId}/transitiveMemberOf/microsoft.graph.directoryRole?$select=roleTemplateId,displayName`);
  for (const r of roles || []) {
    if (ROLE_PRIORITY.get(String(r.roleTemplateId || '').toLowerCase())) return true;
  }
  return false;
}

/** Translate a Graph write error into a clear, honest HTTP response. */
function writeError(res, err) {
  const status = err && (err.statusCode || err.status);
  if (status === 403) {
    // The product requests User.ReadWrite.All (setup wizard catalog), so a 403
    // here means it isn't consented on THIS tenant — say exactly that.
    return res.status(403).json({ error: 'write_scope_missing', message: err.message });
  }
  if (status === 404) return res.status(404).json({ error: 'user_not_found', message: err.message });
  console.error('[AccessReview] write failed:', err && err.message);
  return res.status(502).json({ error: 'graph_error', message: err ? err.message : 'unknown' });
}

/** Patch the cached snapshot after a successful write (best-effort). */
async function patchSnapshotUser(tenantId, userId, mutate) {
  try {
    const snap = await store.readSnapshot(tenantId);
    if (!snap || !Array.isArray(snap.users)) return;
    const idx = snap.users.findIndex(u => String(u.id) === String(userId));
    if (idx === -1) return;
    const next = mutate(snap.users[idx]);
    if (next === null) snap.users.splice(idx, 1);
    else snap.users[idx] = next;
    // Recompute the user-side summary counts that changed.
    snap.summary = {
      ...snap.summary,
      total: snap.users.length,
      members: snap.users.filter(u => u.type === 'member').length,
      guests: snap.users.filter(u => u.type === 'guest').length,
      inactive: snap.users.filter(u => u.inactive).length,
      never_redeemed: snap.users.filter(u => u.neverRedeemed).length,
    };
    const { captured_at, reports_anonymized, ...payload } = snap;
    await store.writeSnapshot(tenantId, payload, { reportsAnonymized: reports_anonymized });
  } catch (e) {
    console.warn(`[AccessReview] snapshot patch (tenant ${tenantId}, user ${userId}) failed: ${e.message}`);
  }
}

/** MSP audit + tenant change log for a user-lifecycle write. Both best-effort. */
async function auditWrite(req, tenant, { action, upn, displayName, outcome }) {
  const operator = (req.session && req.session.user && req.session.user.email) || null;
  const verb = action === 'delete' ? 'Deleted user'
    : action === 'disable' ? 'Disabled user'
    : 'Enabled user';
  const desc = `${verb} ${displayName || upn} (${upn}) on ${tenant.display_name} — ${outcome}`;
  try {
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY ? mspAudit.CATEGORY.OTHER : 'other',
      action: `access_review.user_${action}`,
      description: desc,
      templateKey: `msp_audit.access_review_user_${action}`,
      templateParams: { upn, name: displayName || upn, tenant: tenant.display_name, outcome },
      targetType: 'tenant', targetId: String(tenant.id), targetName: tenant.display_name,
      metadata: { upn, action, outcome },
      req,
    });
  } catch (e) { console.warn(`[AccessReview] msp audit (${action}) failed:`, e.message); }
  try {
    await changeLog.logPanopticaChange({
      tenantId: tenant.id, category: 'other', surfaces: ['identity'],
      description: desc, createdBy: operator || 'panoptica-system',
    });
  } catch (e) { console.warn(`[AccessReview] change log (${action}) failed:`, e.message); }
}

// ── Shared write handler for disable/enable/delete
async function handleWrite(req, res, action) {
  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    const userId = body.user_id ? String(body.user_id) : null;
    const upn = body.upn ? String(body.upn) : null;
    const displayName = body.display_name ? String(body.display_name) : (upn || userId);
    const ackBreakGlass = body.acknowledge_breakglass === true || body.acknowledge_breakglass === 'true';
    if (!tenantId || !userId) return res.status(400).json({ error: 'tenant_id and user_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    // ── Guards (authoritative, live) ─────────────────────────────────────
    // Break-glass: disable/delete need an explicit acknowledgement.
    if (action !== 'enable') {
      const bg = await store.isBreakGlass(tenantId, { upn, userId });
      if (bg && !ackBreakGlass) {
        return res.status(409).json({ error: 'breakglass_ack_required',
          message: 'This is a designated break-glass account. Re-confirm to proceed.' });
      }
    }

    if (action === 'delete') {
      // Never delete an account holding any privileged role.
      const privileged = await targetHoldsPrivilegedRole(tenant.tenant_id, userId);
      if (privileged) {
        return res.status(409).json({ error: 'target_is_admin',
          message: 'This account holds an administrative role and cannot be deleted here. Remove its roles in Entra first.' });
      }
    }

    if (action === 'disable') {
      // Block disabling the last enabled Global Administrator (lockout protection).
      const gaIds = await enabledGlobalAdminIds(tenant.tenant_id);
      if (gaIds.length <= 1 && gaIds.includes(userId)) {
        return res.status(409).json({ error: 'last_global_admin',
          message: 'This is the last enabled Global Administrator — disabling it would lock the tenant out.' });
      }
    }

    // ── The write ────────────────────────────────────────────────────────
    try {
      if (action === 'delete') {
        await graph.callGraph(tenant.tenant_id, `/users/${userId}`, { method: 'DELETE' });
      } else {
        await graph.callGraph(tenant.tenant_id, `/users/${userId}`,
          { method: 'PATCH', body: { accountEnabled: action === 'enable' } });
      }
    } catch (err) {
      await auditWrite(req, tenant, { action, upn, displayName, outcome: `failed (${err.message})` });
      return writeError(res, err);
    }

    // ── Persist + audit ─────────────────────────────────────────────────
    if (action === 'delete') {
      await patchSnapshotUser(tenantId, userId, () => null);
    } else {
      await patchSnapshotUser(tenantId, userId, (u) => ({ ...u, enabled: action === 'enable' }));
    }
    await auditWrite(req, tenant, { action, upn, displayName, outcome: 'success' });
    res.json({ ok: true, action, user_id: userId });
  } catch (err) {
    console.error(`[AccessReview] ${action} failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

router.post('/disable', auth.requireMemberOrAdmin, (req, res) => handleWrite(req, res, 'disable'));
router.post('/enable',  auth.requireMemberOrAdmin, (req, res) => handleWrite(req, res, 'enable'));
router.post('/delete',  auth.requireMemberOrAdmin, (req, res) => handleWrite(req, res, 'delete'));

// ──────────────────────────────────────────────────────────────────────
// Break-glass governance — group config, CA exclusion, designation CRUD
// ──────────────────────────────────────────────────────────────────────

function bgMaxMembers() {
  const n = config.accessReview && config.accessReview.breakGlassMaxGroupMembers;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Best-effort MSP audit for a break-glass governance action. */
async function bgAudit(req, tenant, { action, description, templateKey, templateParams, metadata }) {
  try {
    await mspAudit.logMspAudit({
      category: mspAudit.CATEGORY ? mspAudit.CATEGORY.OTHER : 'other',
      action, description, templateKey, templateParams,
      targetType: 'tenant', targetId: String(tenant.id), targetName: tenant.display_name,
      metadata: metadata || {}, req,
    });
  } catch (e) { console.warn(`[AccessReview] msp audit (${action}) failed:`, e.message); }
}

// ── GET /break-glass/config — group + live coverage + Security-Defaults state
router.get('/break-glass/config', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const group = await store.getGroupConfig(tenantId);
    const accounts = await store.listBreakGlass(tenantId);

    // Live posture: Security Defaults + CA policy count (+ coverage if configured).
    let securityDefaults = false, caPolicyCount = 0, coverage = null;
    try {
      securityDefaults = await bgGraph.securityDefaultsEnabled(tenant.tenant_id);
      const policies = await bgGraph.listCaPolicies(tenant.tenant_id);
      caPolicyCount = (policies || []).filter(p => bgGraph.ENFORCEABLE_STATES.has(p.state)).length;
      if (group) coverage = await bgGraph.coverage(tenant.tenant_id, group.group_id, policies);
    } catch (e) {
      console.warn(`[AccessReview] break-glass config posture probe failed (tenant ${tenantId}): ${e.message}`);
    }
    res.json({
      group: group || null,
      break_glass: accounts,
      security_defaults: securityDefaults,
      ca_policy_count: caPolicyCount,
      coverage,
      max_group_members: bgMaxMembers(),
    });
  } catch (err) {
    console.error('[AccessReview] break-glass config failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /break-glass/groups?q= — picker list (name shown, GUID stored)
router.get('/break-glass/groups', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const groups = await bgGraph.listCandidateGroups(tenant.tenant_id, req.query.q || '');
    res.json({ groups });
  } catch (err) {
    console.error('[AccessReview] break-glass groups failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /break-glass/inspect — member-count guard + validation for one group
router.post('/break-glass/inspect', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    const groupId = body.group_id ? String(body.group_id) : null;
    if (!tenantId || !groupId) return res.status(400).json({ error: 'tenant_id and group_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const group = await bgGraph.inspectGroup(tenant.tenant_id, groupId);
    const validation = bgGraph.validateGroup(group, { maxMembers: bgMaxMembers() });
    res.json({ group, validation, max_group_members: bgMaxMembers() });
  } catch (err) {
    console.error('[AccessReview] break-glass inspect failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /break-glass/configure — store the group (server-side guard), seed members
router.post('/break-glass/configure', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    const groupId = body.group_id ? String(body.group_id) : null;
    if (!tenantId || !groupId) return res.status(400).json({ error: 'tenant_id and group_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    // Authoritative server-side guard — never trust the UI alone.
    const group = await bgGraph.inspectGroup(tenant.tenant_id, groupId);
    const validation = bgGraph.validateGroup(group, { maxMembers: bgMaxMembers() });
    if (validation.hardBlock) {
      return res.status(409).json({ error: 'group_invalid', reasons: validation.reasons, group });
    }
    if (validation.tooManyMembers && body.acknowledge_large !== true) {
      return res.status(409).json({ error: 'group_too_large', reasons: validation.reasons, group });
    }

    await store.setGroupConfig(tenantId, {
      groupId, groupName: group.displayName,
      configuredBy: (req.session && req.session.user && req.session.user.email) || null,
    });

    // Seed: add every already-designated account that we have an id for to the group.
    const accounts = await store.listBreakGlass(tenantId);
    const seeded = [];
    for (const a of accounts) {
      if (!a.user_id) continue;
      try { await bgGraph.addGroupMember(tenant.tenant_id, groupId, a.user_id); seeded.push(a.user_principal_name); }
      catch (e) { console.warn(`[AccessReview] seed member ${a.user_principal_name} failed: ${e.message}`); }
    }

    await bgAudit(req, tenant, {
      action: 'access_review.breakglass_configure',
      description: `Configured break-glass group "${group.displayName}" on ${tenant.display_name}`,
      templateKey: 'msp_audit.access_review_breakglass_configure',
      templateParams: { group: group.displayName, tenant: tenant.display_name },
      metadata: { groupId, seeded: seeded.length },
    });
    res.json({ ok: true, group: await store.getGroupConfig(tenantId), seeded });
  } catch (err) {
    console.error('[AccessReview] break-glass configure failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /break-glass/exclude-group — exclude the group from every CA policy
router.post('/break-glass/exclude-group', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = parseInt((req.body && req.body.tenant_id) || req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const group = await store.getGroupConfig(tenantId);
    if (!group) return res.status(409).json({ error: 'no_group', message: 'Configure the break-glass group first.' });

    if (await bgGraph.securityDefaultsEnabled(tenant.tenant_id)) {
      return res.status(409).json({ error: 'security_defaults',
        message: 'Tenant is on Security Defaults — Conditional Access exclusion is not possible.' });
    }

    const { results, summary } = await bgGraph.excludeGroupFromAllPolicies(tenant.tenant_id, group.group_id);
    await bgAudit(req, tenant, {
      action: 'access_review.breakglass_exclude',
      description: `Excluded break-glass group "${group.group_name}" from ${summary.excluded + summary.already} CA policies on ${tenant.display_name} (${summary.failed} failed)`,
      templateKey: 'msp_audit.access_review_breakglass_exclude',
      templateParams: { group: group.group_name || '', count: String(summary.excluded + summary.already), tenant: tenant.display_name },
      metadata: { summary },
    });
    // Tenant Change Log entry — operators want this visible at the bottom of the
    // dashboard ("a new exclusion group"). Now load-bearing: since the drift
    // detector treats the break-glass exclusion as expected, this is the ONLY
    // place the change is recorded for the tenant timeline. A break-glass CA
    // exclusion is an excludeGroups carve-out, so it classifies as exemption_apply
    // on the CA surface. Logged only when something actually changed (not a no-op
    // re-apply); best-effort.
    if (summary.excluded > 0) {
      try {
        await changeLog.logPanopticaChange({
          tenantId: tenant.id,
          category: 'exemption_apply',
          surfaces: ['ca'],
          description: `Excluded break-glass group "${group.group_name || group.group_id}" from ${summary.excluded + summary.already} Conditional Access policies (${summary.excluded} newly excluded${summary.failed ? `, ${summary.failed} failed` : ''})`,
          createdBy: (req.session && req.session.user && req.session.user.email) || 'panoptica-system',
        });
      } catch (e) { console.warn(`[AccessReview] change log (breakglass exclude) failed: ${e.message}`); }
    }
    res.json({ ok: true, results, summary });
  } catch (err) {
    console.error('[AccessReview] break-glass exclude failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /break-glass/coverage — re-check exclusion coverage
router.get('/break-glass/coverage', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const group = await store.getGroupConfig(tenantId);
    if (!group) return res.json({ coverage: null });
    const coverage = await bgGraph.coverage(tenant.tenant_id, group.group_id);
    res.json({ coverage });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Break-glass account designation CRUD (now group-aware) ──

router.get('/break-glass', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    res.json({ break_glass: await store.listBreakGlass(tenantId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/break-glass', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const tenantId = parseInt(body.tenant_id, 10);
    const upn = body.upn ? String(body.upn).trim() : null;
    if (!tenantId || !upn) return res.status(400).json({ error: 'tenant_id and upn required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    // Resolve the UPN to a real user so we have the id for group membership and
    // so we never designate a non-existent account.
    let user = null;
    try { user = await bgGraph.getUserByUpn(tenant.tenant_id, upn); }
    catch (e) { return res.status(502).json({ error: 'graph_error', message: e.message }); }
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'No account with that UPN on the tenant.' });

    const operator = (req.session && req.session.user && req.session.user.email) || null;
    const id = await store.addBreakGlass(tenantId, {
      userId: user.id, upn: user.userPrincipalName || upn,
      displayName: user.displayName || (body.display_name || null),
      note: body.note ? String(body.note) : null, createdBy: operator,
    });

    // If the group is configured, add the account to it (designation = membership).
    const group = await store.getGroupConfig(tenantId);
    let addedToGroup = false;
    if (group) {
      try { await bgGraph.addGroupMember(tenant.tenant_id, group.group_id, user.id); addedToGroup = true; }
      catch (e) { console.warn(`[AccessReview] add ${upn} to break-glass group failed: ${e.message}`); }
    }

    await bgAudit(req, tenant, {
      action: 'access_review.breakglass_add',
      description: `Designated break-glass account ${upn} on ${tenant.display_name}`,
      templateKey: 'msp_audit.access_review_breakglass_add',
      templateParams: { upn, tenant: tenant.display_name },
      metadata: { upn, addedToGroup },
    });
    res.json({ ok: true, id, added_to_group: addedToGroup, break_glass: await store.listBreakGlass(tenantId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/break-glass/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenant_id, 10);
    const id = parseInt(req.params.id, 10);
    if (!tenantId || !id) return res.status(400).json({ error: 'tenant_id and id required' });
    const tenant = await loadTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    // Find the row first so we can pull it from the group too.
    const row = (await store.listBreakGlass(tenantId)).find(r => r.id === id);
    const group = await store.getGroupConfig(tenantId);
    if (row && row.user_id && group) {
      try { await bgGraph.removeGroupMember(tenant.tenant_id, group.group_id, row.user_id); }
      catch (e) { console.warn(`[AccessReview] remove break-glass member failed: ${e.message}`); }
    }
    await store.removeBreakGlass(tenantId, id);

    await bgAudit(req, tenant, {
      action: 'access_review.breakglass_remove',
      description: `Removed break-glass designation (${row ? row.user_principal_name : id}) on ${tenant.display_name}`,
      templateKey: 'msp_audit.access_review_breakglass_remove',
      templateParams: { tenant: tenant.display_name },
      metadata: { breakGlassId: id },
    });
    res.json({ ok: true, break_glass: await store.listBreakGlass(tenantId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
