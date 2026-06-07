/**
 * Panoptica — Group Membership Resolver
 *
 * Resolves an Entra group ID to the set of transitive member UPNs (including
 * users inside nested groups). Used by the exemption resolver to expand
 * conditions.users.excludeGroups on a CA policy into concrete UPNs at
 * alert-evaluation time.
 *
 * Caches resolutions per (tenantGuid, groupId) for 15 minutes to keep alert
 * evaluation fast — fresh enough to catch membership changes on the poll
 * after they happen, stale enough to avoid hammering Graph on every signal.
 *
 * This is a generalization of the pattern originally in sharepoint-graph.js
 * (getGroupMembers). SharePoint code can delegate to this module — same
 * semantics, one cache.
 */

const graph = require('../graph');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_DEPTH = 5;                 // matches sharepoint-graph.js ceiling

// Cache key: `${tenantGuid}::${groupId}`
// Value: { upns: Set<string>, expires: number }
const cache = new Map();

/**
 * Resolve a single group to its transitive set of member UPNs.
 * Nested groups are expanded depth-first. Cycles protected via visited set.
 * Empty set on any Graph error — caller should treat as fail-loud (do NOT
 * suppress an alert when we can't prove membership).
 *
 * @param {string} tenantGuid - Azure AD tenant GUID
 * @param {string} groupId - Entra group object id
 * @param {object} [opts]
 * @param {boolean} [opts.bypassCache=false] - Skip cache read/write
 * @returns {Promise<Set<string>>} - Lowercased UPNs
 */
async function resolveGroupMembers(tenantGuid, groupId, opts = {}) {
  if (!tenantGuid || !groupId) return new Set();

  const key = `${tenantGuid}::${groupId}`;
  if (!opts.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.upns;
    }
  }

  const upns = new Set();
  try {
    await walk(tenantGuid, groupId, upns, new Set(), MAX_DEPTH);
  } catch (err) {
    // Network/auth failure — return whatever we got, do NOT cache. The
    // caller should fail-loud (not suppress). See exemption-resolver.js.
    console.warn(`[GroupResolver] Failed to resolve group ${groupId} in tenant ${tenantGuid}: ${err.message}`);
    return upns;
  }

  cache.set(key, { upns, expires: Date.now() + CACHE_TTL_MS });
  return upns;
}

/**
 * Resolve many groups in parallel, returning the union of all member UPNs.
 * Useful for building an exemption set across multiple excludeGroups on a
 * single CA policy.
 *
 * @param {string} tenantGuid
 * @param {Array<string>} groupIds
 * @returns {Promise<Set<string>>}
 */
async function resolveMany(tenantGuid, groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return new Set();
  const sets = await Promise.all(
    groupIds.map(id => resolveGroupMembers(tenantGuid, id))
  );
  const union = new Set();
  for (const s of sets) for (const u of s) union.add(u);
  return union;
}

/**
 * Recursive walker. Adds user UPNs directly; recurses into group members up
 * to MAX_DEPTH. Uses `/groups/{id}/members` which returns both users and
 * nested groups, distinguished by @odata.type.
 */
async function walk(tenantGuid, groupId, upns, visited, depthRemaining) {
  if (depthRemaining <= 0 || visited.has(groupId)) return;
  visited.add(groupId);

  const result = await graph.callGraph(
    tenantGuid,
    `/groups/${encodeURIComponent(groupId)}/members?$select=id,userPrincipalName&$top=999`,
    { version: 'v1.0' }
  );

  const members = (result && result.value) || [];
  for (const m of members) {
    const odataType = m['@odata.type'] || '';
    if (odataType.includes('group')) {
      // Nested group — recurse
      if (m.id) await walk(tenantGuid, m.id, upns, visited, depthRemaining - 1);
    } else if (odataType.includes('user') || m.userPrincipalName) {
      if (m.userPrincipalName) upns.add(m.userPrincipalName.toLowerCase());
    }
    // servicePrincipals and other directoryObject types are intentionally
    // skipped — they don't sign in interactively, exemption is moot.
  }
}

/**
 * Drop a specific (tenant, group) entry or the entire cache.
 * Called by the exemption-accept endpoint when a group is added to an
 * exemption, so the next alert evaluation sees current membership without
 * waiting for the 15m TTL.
 */
function invalidate(tenantGuid, groupId) {
  if (tenantGuid && groupId) {
    cache.delete(`${tenantGuid}::${groupId}`);
  } else {
    cache.clear();
  }
}

module.exports = {
  resolveGroupMembers,
  resolveMany,
  invalidate,
};
