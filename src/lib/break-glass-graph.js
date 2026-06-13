/**
 * Panoptica365 — Break-Glass Governance: Graph engine
 *
 * Group inspection (the member-count safety guard + validation), group membership
 * writes, and the Conditional Access exclusion apply loop. This is the load-
 * bearing, highest-stakes module in the feature: excludeGroupFromAllPolicies()
 * writes `excludeGroups` to EVERY enforceable CA policy on a live customer tenant.
 *
 * Design rules (see the Break-Glass Governance build doc):
 *   - We key on the immutable group objectId, never the name.
 *   - CA PATCH: Graph MERGES sub-fields under conditions.users, but the array
 *     value is REPLACED — so we read the live excludeGroups and send the full
 *     appended array (feedback_graph_patch_merges_nested). Omitting the other
 *     sub-fields (includeUsers, excludeUsers, …) leaves them intact.
 *   - Idempotent: a policy already excluding the group is a no-op ("already").
 *   - Partial-failure honest: per-policy result; the caller must never report
 *     "done" unless every enforceable policy is covered.
 *   - Paced + 429-aware: small delay between PATCHes; the Graph client already
 *     honors 429 Retry-After (the real throttle protection).
 *
 * All calls take the tenant's Azure GUID (tenant.tenant_id), like the fetchers.
 * Permissions: Group.Read.All / Group.ReadWrite.All / Policy.ReadWrite.ConditionalAccess
 * (all already in the product's catalog).
 */

'use strict';

const graph = require('../graph');

const GA_DELAY_MS = 250; // inter-PATCH pacing; 429 backoff in graph.js is the real guard
// A CA policy in one of these states is "enforceable" — the break-glass group
// MUST be excluded from it. Report-only is included because it can be promoted to
// enabled at any time. Disabled policies are skipped (coverage re-checks if flipped).
const ENFORCEABLE_STATES = new Set(['enabled', 'enabledForReportingButNotEnforced']);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isDynamic(group) {
  return Array.isArray(group.groupTypes) && group.groupTypes.includes('DynamicMembership');
}

// ──────────────────────────────────────────────────────────────────────
// Group inspection — picker list + per-group validation/guard
// ──────────────────────────────────────────────────────────────────────

/**
 * Cheap group list for the picker (no per-group member count — that's fetched on
 * selection by inspectGroup). Optional case-insensitive substring filter on name.
 * Returns lightweight rows carrying the flags the UI needs for the guard hints.
 */
async function listCandidateGroups(guid, query = '') {
  const groups = await graph.callGraphPaged(guid,
    '/groups?$select=id,displayName,securityEnabled,mailEnabled,groupTypes,onPremisesSyncEnabled&$top=999',
    { maxPages: 10 });
  const q = String(query || '').trim().toLowerCase();
  return (groups || [])
    .filter((g) => !q || String(g.displayName || '').toLowerCase().includes(q))
    .map((g) => ({
      id: g.id,
      displayName: g.displayName,
      securityEnabled: g.securityEnabled === true,
      mailEnabled: g.mailEnabled === true,
      dynamic: isDynamic(g),
      synced: !!g.onPremisesSyncEnabled,
    }))
    .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));
}

/**
 * Full inspection of ONE chosen group: validation flags + member count + a sample
 * of member names. Drives the member-count safety guard (§3) and validation (§4).
 * memberCountCapped=true means the real count is ≥ memberCount (we stopped paging)
 * — which for the guard only ever means "definitely too big", so it's safe.
 */
async function inspectGroup(guid, groupId) {
  const g = await graph.callGraph(guid,
    `/groups/${groupId}?$select=id,displayName,securityEnabled,mailEnabled,groupTypes,onPremisesSyncEnabled`);
  // Page a few pages of members — enough to know "tiny vs huge" and to show a
  // sample, without enumerating a wrongly-chosen 500-member group in full.
  const members = await graph.callGraphPaged(guid,
    `/groups/${groupId}/members?$select=id,displayName,userPrincipalName&$top=999`,
    { maxPages: 3 });
  const capped = members.length >= 3 * 999;
  return {
    id: g.id,
    displayName: g.displayName,
    securityEnabled: g.securityEnabled === true,
    mailEnabled: g.mailEnabled === true,
    dynamic: isDynamic(g),
    synced: !!g.onPremisesSyncEnabled,
    memberCount: members.length,
    memberCountCapped: capped,
    members: members.slice(0, 25).map((m) => ({
      id: m.id, displayName: m.displayName, userPrincipalName: m.userPrincipalName,
    })),
  };
}

/**
 * Validate a chosen group for break-glass use. Returns { ok, reasons:[code...] }.
 * `reasons` codes map to localized messages in the route/UI. A non-empty reasons
 * list with a hard code (not_security / dynamic) blocks; `synced` is a soft warn.
 */
function validateGroup(inspected, { maxMembers = 5 } = {}) {
  const reasons = [];
  if (!inspected.securityEnabled) reasons.push('not_security');
  if (inspected.dynamic) reasons.push('dynamic');           // can't add members
  if (inspected.synced) reasons.push('synced');             // soft — MS prefers cloud-only
  const tooBig = inspected.memberCountCapped || inspected.memberCount > maxMembers;
  if (tooBig) reasons.push('too_many_members');             // the safety guard
  const hardBlock = reasons.some((r) => r === 'not_security' || r === 'dynamic');
  return {
    ok: !hardBlock && !tooBig,
    hardBlock,
    tooManyMembers: tooBig,
    reasons,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Group membership (designate / un-designate)
// ──────────────────────────────────────────────────────────────────────

/** Add a user to the break-glass group (idempotent — already-member is fine). */
async function addGroupMember(guid, groupId, userId) {
  try {
    await graph.callGraph(guid, `/groups/${groupId}/members/$ref`, {
      method: 'POST',
      body: { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` },
    });
  } catch (e) {
    // Graph returns 400 "object references already exist" when already a member.
    if (/already exist/i.test(e.message || '')) return { ok: true, alreadyMember: true };
    throw e;
  }
  return { ok: true };
}

/** Remove a user from the break-glass group (idempotent — not-a-member is fine). */
async function removeGroupMember(guid, groupId, userId) {
  try {
    await graph.callGraph(guid, `/groups/${groupId}/members/${userId}/$ref`, { method: 'DELETE' });
  } catch (e) {
    if (e.statusCode === 404 || /does not exist|not found/i.test(e.message || '')) {
      return { ok: true, notMember: true };
    }
    throw e;
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
// Conditional Access exclusion
// ──────────────────────────────────────────────────────────────────────

/** All CA policies (full objects) for a tenant. */
async function listCaPolicies(guid) {
  return graph.callGraphPaged(guid, '/identity/conditionalAccess/policies', { maxPages: 20 });
}

/** True if the tenant is on Security Defaults (→ CA exclusion is impossible). */
async function securityDefaultsEnabled(guid) {
  try {
    const p = await graph.callGraph(guid,
      '/policies/identitySecurityDefaultsEnforcementPolicy?$select=isEnabled', { silent: true });
    return !!(p && p.isEnabled);
  } catch (e) {
    // Non-fatal: if we can't read it, assume not-on (CA path) rather than block.
    return false;
  }
}

/** Resolve a UPN to a directory user (id needed for group membership). null if absent. */
async function getUserByUpn(guid, upn) {
  try {
    const u = await graph.callGraph(guid,
      `/users/${encodeURIComponent(upn)}?$select=id,displayName,userPrincipalName,accountEnabled`, { silent: true });
    return u && u.id ? u : null;
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

/**
 * Resolve a directory user by its (stable) object id → current UPN/displayName.
 * Used by the break-glass sign-in evaluator: UAL records identify a sign-in by
 * UPN, and an operator can move the account's domain (UPN changes) while the
 * object id stays put — so we match against the CURRENT UPN resolved here.
 * null if the account no longer exists.
 */
async function getUserById(guid, userId) {
  try {
    const u = await graph.callGraph(guid,
      `/users/${encodeURIComponent(userId)}?$select=id,displayName,userPrincipalName`, { silent: true });
    return u && u.id ? u : null;
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

function excludeGroupsOf(policy) {
  const u = policy && policy.conditions && policy.conditions.users;
  return (u && Array.isArray(u.excludeGroups)) ? u.excludeGroups : [];
}

/**
 * Coverage check: for every ENFORCEABLE policy, is the group already in
 * excludeGroups? Returns { total, covered, gaps:[{id,name,state}], policies:[...] }.
 * `total`/`covered` count only enforceable policies (the "must cover" set).
 */
async function coverage(guid, groupId, policies = null) {
  const all = policies || await listCaPolicies(guid);
  const out = { total: 0, covered: 0, gaps: [], policies: [] };
  for (const p of all || []) {
    const enforceable = ENFORCEABLE_STATES.has(p.state);
    const has = excludeGroupsOf(p).includes(groupId);
    out.policies.push({ id: p.id, name: p.displayName, state: p.state, enforceable, excluded: has });
    if (!enforceable) continue;
    out.total += 1;
    if (has) out.covered += 1;
    else out.gaps.push({ id: p.id, name: p.displayName, state: p.state });
  }
  return out;
}

/**
 * Exclude `groupId` from every enforceable CA policy. Reads each policy's live
 * excludeGroups and PATCHes the appended array (merge-safe). Idempotent, paced,
 * partial-failure honest.
 *
 * onProgress({ index, total, result }) is called after each policy if provided,
 * so the route/UI can stream per-policy status.
 *
 * Returns { results:[{policyId,name,state,status,error?}], summary:{excluded,
 * already,failed,skipped,total} }. status ∈ excluded|already|failed|skipped.
 */
async function excludeGroupFromAllPolicies(guid, groupId, { onProgress } = {}) {
  const policies = await listCaPolicies(guid);
  const results = [];
  const targets = policies || [];
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    let result;
    if (!ENFORCEABLE_STATES.has(p.state)) {
      result = { policyId: p.id, name: p.displayName, state: p.state, status: 'skipped' };
    } else {
      const excl = excludeGroupsOf(p);
      if (excl.includes(groupId)) {
        result = { policyId: p.id, name: p.displayName, state: p.state, status: 'already' };
      } else {
        try {
          await graph.callGraph(guid, `/identity/conditionalAccess/policies/${p.id}`, {
            method: 'PATCH',
            body: { conditions: { users: { excludeGroups: [...excl, groupId] } } },
          });
          result = { policyId: p.id, name: p.displayName, state: p.state, status: 'excluded' };
        } catch (e) {
          result = { policyId: p.id, name: p.displayName, state: p.state, status: 'failed', error: e.message };
        }
        await sleep(GA_DELAY_MS); // pace only after an actual write
      }
    }
    results.push(result);
    if (typeof onProgress === 'function') {
      try { onProgress({ index: i + 1, total: targets.length, result }); } catch { /* non-fatal */ }
    }
  }
  const summary = { total: results.length, excluded: 0, already: 0, failed: 0, skipped: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  // The load-bearing flag: did EVERY enforceable policy end up covered?
  summary.fullyCovered = results.every((r) => r.status === 'excluded' || r.status === 'already' || r.status === 'skipped')
    && results.some((r) => r.status === 'excluded' || r.status === 'already');
  summary.enforceableUncovered = results.filter((r) => r.status === 'failed').length;
  return { results, summary };
}

module.exports = {
  // group inspection
  listCandidateGroups,
  inspectGroup,
  validateGroup,
  // membership
  addGroupMember,
  removeGroupMember,
  // conditional access
  listCaPolicies,
  securityDefaultsEnabled,
  coverage,
  excludeGroupFromAllPolicies,
  // misc
  getUserByUpn,
  getUserById,
  // constants (for the routes/tests)
  ENFORCEABLE_STATES,
};
