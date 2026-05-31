/**
 * Panoptica365 — Enterprise Apps + App Registrations Graph collector (Feature 8.9)
 *
 * One fan-out per Refresh / daily loop. Produces the normalized app objects the
 * Applications tab, the Sonnet evaluator, and the drift compare all consume.
 *
 * Scope (spec §6.1, expanded 2026-05-30 to include app registrations):
 *   - Enterprise apps  = consented service principals, Microsoft-owned excluded
 *                        (reproduces the Entra "Enterprise Applications" filter).
 *   - App registrations = tenant-owned /applications (requested perms + creds +
 *                        redirect URIs are the risk surface).
 *
 * The fiddly part is resolving permission GUIDs → human names:
 *   - delegated grants (oauth2PermissionGrants) carry the scope STRING already.
 *   - application grants (appRoleAssignments) carry an appRoleId GUID → resolved
 *     via the RESOURCE service principal's appRoles collection.
 *   - app-registration requiredResourceAccess carries Scope/Role GUIDs →
 *     resolved via the resource SP's oauth2PermissionScopes / appRoles.
 * Resource SPs are cached per run (by objectId and by appId) so we don't refetch
 * Microsoft Graph's appRoles for every assignment.
 *
 * All Graph calls go through src/graph.js (retry/backoff/health). Per-app 403s
 * are swallowed (silent) so one unreadable app doesn't void the whole inventory.
 */

'use strict';

const graph = require('../graph');

// Microsoft-owned tenants whose service principals are catalog noise, not
// consented third-party apps. Dropping these collapses ~700 → ~tens.
const MICROSOFT_TENANT_IDS = new Set([
  'f8cdef31-a31e-4b4a-93e4-5f571e91255a', // Microsoft Services
  '72f988bf-86f1-41af-91ab-2d7cd011db47', // Microsoft (corp)
]);

const SP_SELECT =
  'id,appId,displayName,servicePrincipalType,accountEnabled,appOwnerOrganizationId,' +
  'publisherName,verifiedPublisher,signInAudience,createdDateTime,homepage,replyUrls';
const APP_SELECT =
  'id,appId,displayName,createdDateTime,signInAudience,publisherDomain,verifiedPublisher,' +
  'web,requiredResourceAccess,keyCredentials,passwordCredentials';

/**
 * Resolver that caches resource service principals (the apps that EXPOSE the
 * permissions being granted) so GUID→name resolution is one fetch per resource.
 */
function makeResourceResolver(tenantId) {
  const byObjectId = new Map(); // SP objectId → sp (with appRoles, scopes)
  const byAppId = new Map();    // appId       → sp

  async function fetchSp(filter) {
    try {
      const sps = await graph.callGraphPaged(tenantId,
        `/servicePrincipals?$filter=${filter}&$select=id,appId,displayName,appRoles,oauth2PermissionScopes`,
        { silent: true, maxPages: 1 });
      return (sps && sps[0]) || null;
    } catch {
      return null;
    }
  }

  async function byObject(objectId) {
    if (!objectId) return null;
    if (byObjectId.has(objectId)) return byObjectId.get(objectId);
    const sp = await fetchSp(`id eq '${objectId}'`);
    byObjectId.set(objectId, sp);
    if (sp && sp.appId) byAppId.set(sp.appId, sp);
    return sp;
  }

  async function byApp(appId) {
    if (!appId) return null;
    if (byAppId.has(appId)) return byAppId.get(appId);
    const sp = await fetchSp(`appId eq '${appId}'`);
    byAppId.set(appId, sp);
    if (sp && sp.id) byObjectId.set(sp.id, sp);
    return sp;
  }

  return { byObject, byApp };
}

/** appRoleId GUID → role value via the resource SP's appRoles. */
function resolveAppRole(sp, appRoleId) {
  if (!sp || !Array.isArray(sp.appRoles)) return appRoleId;
  const role = sp.appRoles.find(r => r.id === appRoleId);
  return role ? role.value : appRoleId;
}

/** requiredResourceAccess id GUID → name via resource SP scopes/roles. */
function resolveResourceAccess(sp, id, type) {
  if (!sp) return id;
  if (type === 'Role' && Array.isArray(sp.appRoles)) {
    const r = sp.appRoles.find(x => x.id === id);
    if (r) return r.value;
  }
  if (Array.isArray(sp.oauth2PermissionScopes)) {
    const s = sp.oauth2PermissionScopes.find(x => x.id === id);
    if (s) return s.value;
  }
  if (Array.isArray(sp.appRoles)) {
    const r = sp.appRoles.find(x => x.id === id);
    if (r) return r.value;
  }
  return id;
}

/** Collect granted permissions for one enterprise-app service principal. */
async function collectSpPermissions(tenantId, sp, resolver) {
  const delegatedPermissions = [];
  const applicationPermissions = [];

  let grants = [];
  let assignments = [];
  try {
    grants = await graph.callGraphPaged(tenantId,
      `/servicePrincipals/${sp.id}/oauth2PermissionGrants`, { silent: true });
  } catch { grants = []; }
  try {
    assignments = await graph.callGraphPaged(tenantId,
      `/servicePrincipals/${sp.id}/appRoleAssignments`, { silent: true });
  } catch { assignments = []; }

  for (const g of grants || []) {
    const resourceSp = await resolver.byObject(g.resourceId);
    const resourceName = (resourceSp && resourceSp.displayName) || g.resourceId;
    const resourceAppId = (resourceSp && resourceSp.appId) || g.resourceId;
    for (const scope of String(g.scope || '').split(' ').map(s => s.trim()).filter(Boolean)) {
      delegatedPermissions.push({
        resource: resourceName,
        resourceAppId,
        scope,
        consentType: g.consentType || null, // AllPrincipals | Principal
      });
    }
  }

  for (const a of assignments || []) {
    const resourceSp = await resolver.byObject(a.resourceId);
    const resourceName = a.resourceDisplayName || (resourceSp && resourceSp.displayName) || a.resourceId;
    const resourceAppId = (resourceSp && resourceSp.appId) || a.resourceId;
    applicationPermissions.push({
      resource: resourceName,
      resourceAppId,
      role: resolveAppRole(resourceSp, a.appRoleId),
    });
  }

  return { delegatedPermissions, applicationPermissions };
}

/** Enterprise apps (consented service principals), Microsoft-owned excluded. */
async function collectEnterpriseApps(tenantId, resolver) {
  const sps = await graph.callGraphPaged(tenantId,
    `/servicePrincipals?$select=${SP_SELECT}&$top=999`);

  const filtered = (sps || []).filter(sp =>
    !MICROSOFT_TENANT_IDS.has(sp.appOwnerOrganizationId) &&
    sp.servicePrincipalType !== 'ManagedIdentity'
  );

  const out = [];
  for (const sp of filtered) {
    const { delegatedPermissions, applicationPermissions } =
      await collectSpPermissions(tenantId, sp, resolver);
    out.push({
      kind: 'enterprise',
      appId: sp.appId,
      objectId: sp.id,
      displayName: sp.displayName,
      enabled: sp.accountEnabled !== false,
      publisher: sp.publisherName || '',
      verifiedPublisher: !!(sp.verifiedPublisher && sp.verifiedPublisher.displayName),
      verifiedPublisherName: sp.verifiedPublisher && sp.verifiedPublisher.displayName || null,
      appOwnerOrganizationId: sp.appOwnerOrganizationId || null,
      signInAudience: sp.signInAudience || null,
      createdDateTime: sp.createdDateTime || null,
      homepage: sp.homepage || null,
      delegatedPermissions,
      applicationPermissions,
    });
  }
  return out;
}

/** App registrations (tenant-owned /applications). */
async function collectAppRegistrations(tenantId, resolver) {
  const apps = await graph.callGraphPaged(tenantId,
    `/applications?$select=${APP_SELECT}&$top=999`);

  const out = [];
  for (const a of apps || []) {
    const requiredResourceAccess = [];
    for (const rra of a.requiredResourceAccess || []) {
      const resourceSp = await resolver.byApp(rra.resourceAppId);
      const resourceName = (resourceSp && resourceSp.displayName) || rra.resourceAppId;
      for (const ra of rra.resourceAccess || []) {
        requiredResourceAccess.push({
          resource: resourceName,
          resourceAppId: rra.resourceAppId,
          value: resolveResourceAccess(resourceSp, ra.id, ra.type),
          permType: ra.type === 'Role' ? 'application' : 'delegated',
        });
      }
    }

    const credentials = [
      ...(a.keyCredentials || []).map(k => ({
        type: 'key', keyId: k.keyId, displayName: k.displayName || null, endDateTime: k.endDateTime || null,
      })),
      ...(a.passwordCredentials || []).map(p => ({
        type: 'password', keyId: p.keyId, displayName: p.displayName || null, endDateTime: p.endDateTime || null,
      })),
    ];

    const redirectUris = [
      ...((a.web && a.web.redirectUris) || []),
    ];

    out.push({
      kind: 'registration',
      appId: a.appId,
      objectId: a.id,
      displayName: a.displayName,
      enabled: true,
      publisher: a.publisherDomain || '',
      verifiedPublisher: !!(a.verifiedPublisher && a.verifiedPublisher.displayName),
      verifiedPublisherName: a.verifiedPublisher && a.verifiedPublisher.displayName || null,
      appOwnerOrganizationId: null, // locally owned
      signInAudience: a.signInAudience || null,
      createdDateTime: a.createdDateTime || null,
      homepage: (a.web && a.web.homePageUrl) || null,
      requiredResourceAccess,
      credentials,
      redirectUris,
    });
  }
  return out;
}

/**
 * Full collection for a tenant. Returns { enterpriseApps, appRegistrations, apps }
 * where `apps` is the merged list. Caller owns persistence + drift compare.
 * @param {string} tenantId Azure tenant GUID (for graph calls)
 */
async function collectApps(tenantId) {
  const resolver = makeResourceResolver(tenantId);
  // Enterprise apps first — seeds the resolver cache with resource SPs that the
  // app-registration requiredResourceAccess pass will mostly reuse. Each half is
  // independently fault-tolerant: a 403 on /applications (Application.Read.All not
  // consented) still yields the enterprise-app inventory, and vice-versa.
  let enterpriseApps = [];
  let appRegistrations = [];
  try {
    enterpriseApps = await collectEnterpriseApps(tenantId, resolver);
  } catch (e) {
    console.warn(`[KnownGood] enterprise-app collection failed for ${tenantId}: ${e.message}`);
  }
  try {
    appRegistrations = await collectAppRegistrations(tenantId, resolver);
  } catch (e) {
    console.warn(`[KnownGood] app-registration collection failed for ${tenantId}: ${e.message}`);
  }
  return {
    enterpriseApps,
    appRegistrations,
    apps: [...enterpriseApps, ...appRegistrations],
  };
}

module.exports = {
  collectApps,
  collectEnterpriseApps,
  collectAppRegistrations,
  MICROSOFT_TENANT_IDS,
  // exported for unit tests
  resolveAppRole,
  resolveResourceAccess,
};
