/**
 * Panoptica — CA Exemption Resolver
 *
 * For a given tenant, builds the map of exempted UPNs keyed by control
 * dimension. Used by the alert engine to suppress evaluators whose target
 * control is moot for the excluded user.
 *
 * Flow at alert-evaluation time:
 *   1. Find active (non-expired, non-revoked) exemptions for this tenant.
 *   2. For each exemption's assignment, read the template's control_dimensions.
 *   3. Expand group exemptions to UPNs via group-resolver (transitive).
 *   4. Return Map<controlDimension, Set<upn>> for ctx.exemptedUpnsByControl.
 *
 * Semantics:
 *   - Suppression is per-control-dimension, NOT blanket per-user. A user
 *     exempted from "block_geographic_access" still triggers impossible-travel
 *     and other evaluators whose control dimensions they are not exempted from.
 *   - If group resolution fails (Graph error), the group's UPNs are NOT added
 *     to the exempt set. Fail-loud: we'd rather produce a false-positive
 *     alert than silently suppress one we shouldn't.
 */

const db = require('../db/database');
const groupResolver = require('./group-resolver');

/**
 * Build the exemption map for one tenant.
 *
 * @param {number} tenantDbId - Internal tenants.id (not the Azure GUID)
 * @param {string} tenantAzureGuid - The tenant's Azure AD tenant GUID
 *   (required for Graph group-member lookups)
 * @returns {Promise<Map<string, Set<string>>>}
 *   Keys: control dimension strings (e.g. "block_geographic_access")
 *   Values: Set of lowercased UPNs exempted for that dimension in this tenant
 */
async function buildExemptedUpnsByControl(tenantDbId, tenantAzureGuid) {
  const result = new Map();

  // One query: active exemptions for this tenant, joined to their template's
  // control_dimensions tag. Filters in SQL keep the JS hot-path small.
  let rows;
  try {
    rows = await db.queryRows(
      `SELECT e.id AS exemption_id,
              e.assignment_id,
              e.principal_type,
              e.principal_id,
              e.expires_at,
              t.control_dimensions
         FROM ca_exemptions e
         JOIN ca_assignments a ON a.id = e.assignment_id
         JOIN ca_templates   t ON t.id = a.template_id
        WHERE a.tenant_id = ?
          AND e.revoked_at IS NULL
          AND e.expires_at > NOW()
          AND t.control_dimensions IS NOT NULL`,
      [tenantDbId]
    );
  } catch (err) {
    // Table may not exist yet if migration hasn't run. Treat as zero
    // exemptions — everything alerts as it did before the feature shipped.
    console.warn(`[ExemptionResolver] Query failed for tenant ${tenantDbId}: ${err.message}`);
    return result;
  }

  if (rows.length === 0) return result;

  // Group exemptions by their principal_type so we can resolve group
  // memberships in parallel instead of serially.
  const groupLookups = []; // { controlDims: string[], groupId: string }
  const directUpns = [];   // { controlDims: string[], upn: string }

  for (const r of rows) {
    const controlDims = parseControlDimensions(r.control_dimensions);
    if (controlDims.length === 0) continue;

    if (r.principal_type === 'user') {
      // ca_exemptions stores the Entra object id; the evaluator compares
      // by UPN. We denormalize the UPN into principal_label at accept
      // time, but fall back to resolving via Graph here if needed.
      // For Phase 1, we rely on principal_label containing the UPN.
      const upn = await resolveUserUpn(tenantAzureGuid, r.principal_id, r.exemption_id);
      if (upn) directUpns.push({ controlDims, upn: upn.toLowerCase() });
    } else if (r.principal_type === 'group') {
      groupLookups.push({ controlDims, groupId: r.principal_id });
    }
  }

  // Parallelize all group-member lookups. Each is cached 15m.
  const groupMemberSets = await Promise.all(
    groupLookups.map(g => groupResolver.resolveGroupMembers(tenantAzureGuid, g.groupId))
  );

  // Fold everything into the result map
  for (const { controlDims, upn } of directUpns) {
    for (const dim of controlDims) {
      if (!result.has(dim)) result.set(dim, new Set());
      result.get(dim).add(upn);
    }
  }

  for (let i = 0; i < groupLookups.length; i++) {
    const { controlDims } = groupLookups[i];
    const upns = groupMemberSets[i];
    for (const dim of controlDims) {
      if (!result.has(dim)) result.set(dim, new Set());
      for (const upn of upns) result.get(dim).add(upn);
    }
  }

  return result;
}

/**
 * Write an alerts_suppressed audit row. Called by evaluators that drop a
 * fire because of an active exemption. Non-blocking — errors are logged
 * but do not bubble (we never want the audit path to break alerting).
 */
async function logSuppression({
  tenantDbId,
  policyId,
  evaluator,
  upn,
  controlDimension,
  eventSnippet,
}) {
  try {
    // Find the exemption that covered this UPN in this tenant for this dim.
    // Done best-effort — if the principal is reached via group, we may pick
    // any active exemption on a matching-dimension assignment. Good enough
    // for audit; exactness isn't a correctness property.
    const exemption = await db.queryOne(
      `SELECT e.id AS exemption_id, e.assignment_id
         FROM ca_exemptions e
         JOIN ca_assignments a ON a.id = e.assignment_id
         JOIN ca_templates   t ON t.id = a.template_id
        WHERE a.tenant_id = ?
          AND e.revoked_at IS NULL
          AND e.expires_at > NOW()
          AND JSON_CONTAINS(t.control_dimensions, JSON_QUOTE(?))
        ORDER BY e.principal_type = 'user' DESC, e.accepted_at DESC
        LIMIT 1`,
      [tenantDbId, controlDimension]
    );
    if (!exemption) return; // Race condition — exemption revoked between eval and log. Drop.

    await db.execute(
      `INSERT INTO alerts_suppressed
         (tenant_id, policy_id, evaluator, upn, exemption_id, assignment_id,
          control_dimension, event_snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantDbId, policyId, evaluator, upn,
        exemption.exemption_id, exemption.assignment_id,
        controlDimension,
        eventSnippet ? String(eventSnippet).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    console.warn(`[ExemptionResolver] logSuppression failed: ${err.message}`);
  }
}

function parseControlDimensions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Look up a UPN from a directoryObject id. Prefers the principal_label
 * denormalized at accept time; falls back to Graph /users/{id}.
 *
 * Cached for 1 hour within-process — user UPNs change rarely.
 */
const userUpnCache = new Map(); // key: objectId, value: { upn, expires }
const USER_CACHE_TTL = 60 * 60 * 1000;

async function resolveUserUpn(tenantAzureGuid, objectId, exemptionId) {
  const cached = userUpnCache.get(objectId);
  if (cached && cached.expires > Date.now()) return cached.upn;

  // Try principal_label first (denormalized at accept time)
  try {
    const row = await db.queryOne(
      'SELECT principal_label FROM ca_exemptions WHERE id = ?',
      [exemptionId]
    );
    if (row && row.principal_label) {
      // principal_label is stored as "Display Name <upn@domain>" — extract UPN
      const match = String(row.principal_label).match(/<([^>]+)>/);
      const upn = match ? match[1] : row.principal_label;
      if (upn && upn.includes('@')) {
        userUpnCache.set(objectId, { upn, expires: Date.now() + USER_CACHE_TTL });
        return upn;
      }
    }
  } catch (_e) { /* fall through to Graph */ }

  // Graph fallback
  try {
    const graph = require('../graph');
    const user = await graph.callGraph(
      tenantAzureGuid,
      `/users/${encodeURIComponent(objectId)}?$select=userPrincipalName`,
      { version: 'v1.0' }
    );
    const upn = user && user.userPrincipalName;
    if (upn) {
      userUpnCache.set(objectId, { upn, expires: Date.now() + USER_CACHE_TTL });
      return upn;
    }
  } catch (err) {
    console.warn(`[ExemptionResolver] Graph lookup failed for user ${objectId}: ${err.message}`);
  }
  return null;
}

module.exports = {
  buildExemptedUpnsByControl,
  logSuppression,
};
