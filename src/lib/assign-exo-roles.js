/**
 * Panoptica365 — Assign Exchange/Compliance directory roles to our service
 * principal IN A CUSTOMER TENANT (post-consent onboarding step).
 *
 * WHY THIS EXISTS
 * ---------------
 * Admin consent creates the enterprise app (service principal) + grants the
 * Graph/Exchange API permissions in the customer tenant — but it does NOT
 * assign Entra **directory roles**. Exchange Online / Security & Compliance
 * PowerShell (app-only cert auth) build their session RBAC from the directory
 * roles present *in the token for that tenant* (Microsoft docs: "For
 * multitenant applications in Exchange Online delegated scenarios, you need to
 * assign permissions in each customer tenant"). Without these roles, all the
 * EXO + Purview readers sit at "Awaiting Infra" for the tenant.
 *
 * Since the app already holds the consented application permission
 * RoleManagement.ReadWrite.Directory in the customer tenant, we can assign the
 * roles ourselves via Graph — turning a manual per-customer portal chore into
 * an automatic onboarding step.
 *
 * CONTRACT
 * --------
 * - BEST EFFORT: this NEVER throws into the onboarding path. A failure here
 *   leaves the tenant fully onboarded (Graph monitoring works); only the EXO/
 *   Purview readers stay "Awaiting Infra" until roles are assigned (the manual
 *   wizard step remains a valid fallback).
 * - IDEMPOTENT: re-running is safe. An already-assigned role is treated as
 *   success, not an error.
 * - Uses graph.callGraph(tenantId, …) which mints an app-only token for the
 *   SPECIFIC customer tenant — so every call lands in the right directory.
 */

const graph = require('../graph');
const config = require('../../config/default');

// Built-in Entra role TEMPLATE ids (stable, well-known GUIDs). When a role is
// "activated" in a tenant its roleDefinition id equals the template id, so we
// can assign directly by roleDefinitionId without first looking it up.
const ROLES = [
  { name: 'Exchange Administrator',   templateId: '29232cdf-9323-42fd-ade2-1d097af3e4de' },
  { name: 'Compliance Administrator', templateId: '17315797-102d-40b4-93e0-432062caca18' },
];

function log(msg) { console.log(`[exo-roles] ${msg}`); }
function warn(msg) { console.warn(`[exo-roles] ${msg}`); }

/**
 * Find the objectId of OUR service principal in the given customer tenant,
 * by the app registration's appId (config.entra.clientId).
 * Returns the SP id string, or null if not found / on error.
 */
async function findOwnServicePrincipal(tenantId) {
  const appId = config.entra && config.entra.clientId;
  if (!appId) { warn('no ENTRA_CLIENT_ID configured — cannot resolve service principal'); return null; }
  try {
    const res = await graph.callGraph(
      tenantId,
      `/servicePrincipals?$filter=appId eq '${appId}'&$select=id,appId,displayName`,
      { silent: true }
    );
    const sp = res && res.value && res.value[0];
    return sp ? sp.id : null;
  } catch (e) {
    warn(`could not resolve service principal in ${tenantId}: ${e.message}`);
    return null;
  }
}

/**
 * Ensure a directory role is ACTIVATED in the tenant (built-in roles are often
 * dormant until first used). If activation 409s ("already exists") that's fine.
 * Returns the active roleDefinitionId to assign against (the template id).
 */
async function ensureRoleActivated(tenantId, role) {
  try {
    await graph.callGraph(tenantId, '/directoryRoles', {
      method: 'POST',
      body: { roleTemplateId: role.templateId },
      silent: true,
    });
    log(`activated role "${role.name}" in ${tenantId}`);
  } catch (e) {
    // 409 = already activated → expected and fine. Anything else: log + carry on
    // (the assignment attempt below may still succeed if the role exists).
    if (e.statusCode && e.statusCode !== 409) {
      warn(`activate "${role.name}" returned ${e.statusCode} in ${tenantId}: ${e.message}`);
    }
  }
  return role.templateId;
}

/**
 * Assign one role to the SP via the unified RBAC endpoint. Idempotent:
 * a 409 (assignment already exists) counts as success.
 */
async function assignRole(tenantId, spId, role) {
  const roleDefinitionId = await ensureRoleActivated(tenantId, role);
  try {
    await graph.callGraph(tenantId, '/roleManagement/directory/roleAssignments', {
      method: 'POST',
      body: {
        principalId: spId,
        roleDefinitionId,
        directoryScopeId: '/',
      },
      silent: true,
    });
    log(`assigned "${role.name}" to SP ${spId} in ${tenantId}`);
    return { role: role.name, ok: true, alreadyAssigned: false };
  } catch (e) {
    if (e.statusCode === 409) {
      // Already assigned — idempotent success.
      return { role: role.name, ok: true, alreadyAssigned: true };
    }
    warn(`assign "${role.name}" failed in ${tenantId}: ${e.statusCode || ''} ${e.message}`);
    return { role: role.name, ok: false, error: e.message, statusCode: e.statusCode || null };
  }
}

/**
 * Assign Exchange Administrator + Compliance Administrator to our SP in the
 * given customer tenant. Best-effort, idempotent, never throws.
 * @param {string} tenantId  customer tenant GUID
 * @returns {Promise<{tenantId, spFound, results, allOk}>}
 */
async function assignExoRoles(tenantId) {
  const out = { tenantId, spFound: false, results: [], allOk: false };
  try {
    const spId = await findOwnServicePrincipal(tenantId);
    if (!spId) {
      warn(`service principal not found in ${tenantId} — skipping role assignment (consent may still be propagating)`);
      return out;
    }
    out.spFound = true;
    for (const role of ROLES) {
      // sequential — keeps Graph happy and logs readable
      // eslint-disable-next-line no-await-in-loop
      out.results.push(await assignRole(tenantId, spId, role));
    }
    out.allOk = out.results.every(r => r.ok);
    log(`role assignment for ${tenantId}: ${out.results.map(r => `${r.role}=${r.ok ? (r.alreadyAssigned ? 'already' : 'ok') : 'FAIL'}`).join(', ')}`);
  } catch (e) {
    // Absolute backstop — must never break onboarding.
    warn(`unexpected error assigning roles in ${tenantId}: ${e.message}`);
  }
  return out;
}

module.exports = { assignExoRoles, ROLES };
