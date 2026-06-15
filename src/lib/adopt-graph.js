/**
 * Panoptica365 — Adopt-in-Place Graph layer
 *
 * All Microsoft Graph reads/writes for tenant-sourced CA & Intune adoption.
 * Required scopes (confirmed granted on the app 2026-06-15):
 *   Policy.ReadWrite.ConditionalAccess           (CA read + state PATCH + delete)
 *   DeviceManagementConfiguration.ReadWrite.All  (Intune read + assignment writes + delete)
 *
 * House rules honoured: callGraphPaged follows @odata.nextLink; catch blocks use
 * `e.statusCode` (never `e.status`); read failures are classified into the three
 * §5.5 buckets (empty / unlicensed / transient) — never surfaced as a raw error.
 *
 * IMPORTANT: graph.callGraph(tenantId, …) takes the AZURE tenant GUID
 * (tenants.tenant_id), not the internal tenants.id.
 */

'use strict';

const graph = require('../graph');

const CA_LIST = '/identity/conditionalAccess/policies';
const SECURITY_DEFAULTS = '/policies/identitySecurityDefaultsEnforcementPolicy';

// Minimal Intune type map for adoption — the SAME five object types the template
// library supports (spec §5.2 / §11.1). Canonical source of the full definitions
// is POLICY_TYPES in src/routes/api-intune.js; only the endpoints adopt needs are
// mirrored here so this module stays decoupled from the deploy route. Keep in
// sync if Microsoft moves an endpoint.
const INTUNE_TYPES = [
  { key: 'configurationPolicies', version: 'beta', nameField: 'name',
    list: '/deviceManagement/configurationPolicies',
    item: id => `/deviceManagement/configurationPolicies('${id}')`,
    assignments: id => `/deviceManagement/configurationPolicies('${id}')/assignments`,
    assign: id => `/deviceManagement/configurationPolicies('${id}')/assign` },
  { key: 'deviceConfigurations', version: 'beta', nameField: 'displayName',
    list: '/deviceManagement/deviceConfigurations',
    item: id => `/deviceManagement/deviceConfigurations('${id}')`,
    assignments: id => `/deviceManagement/deviceConfigurations('${id}')/assignments`,
    assign: id => `/deviceManagement/deviceConfigurations('${id}')/assign` },
  { key: 'deviceCompliancePolicies', version: 'beta', nameField: 'displayName',
    list: '/deviceManagement/deviceCompliancePolicies',
    item: id => `/deviceManagement/deviceCompliancePolicies('${id}')`,
    assignments: id => `/deviceManagement/deviceCompliancePolicies('${id}')/assignments`,
    assign: id => `/deviceManagement/deviceCompliancePolicies('${id}')/assign` },
  { key: 'groupPolicyConfigurations', version: 'beta', nameField: 'displayName',
    list: '/deviceManagement/groupPolicyConfigurations',
    item: id => `/deviceManagement/groupPolicyConfigurations('${id}')`,
    assignments: id => `/deviceManagement/groupPolicyConfigurations('${id}')/assignments`,
    assign: id => `/deviceManagement/groupPolicyConfigurations('${id}')/assign` },
  { key: 'intents', version: 'beta', nameField: 'displayName',
    list: '/deviceManagement/intents',
    item: id => `/deviceManagement/intents('${id}')`,
    assignments: id => `/deviceManagement/intents('${id}')/assignments`,
    assign: id => `/deviceManagement/intents('${id}')/assign` },
];

function getIntuneType(key) {
  return INTUNE_TYPES.find(t => t.key === key) || null;
}

/**
 * Classify a Graph read error into the §5.5 outcome buckets.
 *   403                       → 'unlicensed'  (plan/entitlement excludes the surface;
 *                                              Business Standard CA, no-Intune-license, etc.)
 *   401 / 429 / 5xx / 0 / 404 → 'transient'   (token/throttle/network/unexpected — retry)
 * The raw message is carried so the audit log can distinguish a license gate
 * from a genuine failure (spec §5.5).
 */
function classifyReadError(e) {
  const sc = e && e.statusCode;
  if (sc === 403) return { reason: 'unlicensed', detail: String(e.message || '').slice(0, 300) };
  return { reason: 'transient', detail: `${sc || 'ERR'}: ${String(e && e.message || '').slice(0, 280)}` };
}

// ──────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────

/**
 * Enumerate CA policies. Returns one of:
 *   { ok: true, values: [...] }                      (incl. empty array)
 *   { ok: false, reason: 'unlicensed', detail }
 *   { ok: false, reason: 'transient',  detail }
 */
async function readCaPolicies(azureTenantId) {
  try {
    const values = await graph.callGraphPaged(azureTenantId, CA_LIST, { maxPages: 50 });
    return { ok: true, values: values || [] };
  } catch (e) {
    return { ok: false, ...classifyReadError(e) };
  }
}

/** Read Security Defaults on/off state — status indicator only, never carded (§2.6). */
async function readSecurityDefaults(azureTenantId) {
  try {
    const data = await graph.callGraph(azureTenantId, `${SECURITY_DEFAULTS}?$select=isEnabled`, { silent: true });
    return { ok: true, isEnabled: !!(data && data.isEnabled) };
  } catch (e) {
    return { ok: false, ...classifyReadError(e) };
  }
}

/**
 * Enumerate ALL Intune object types (the surface). Each object is returned with
 * its assignment set captured. Surface-level classification:
 *   - every type license-gated (403)   → unlicensed
 *   - any type transiently failed       → transient (retry the whole surface;
 *                                         never leave a partial baseline)
 *   - otherwise                         → ok, values = union across types
 *
 * @returns { ok:true, values:[{policyType, id, displayName, config, assignments}] }
 *        | { ok:false, reason, detail }
 */
async function readIntuneObjects(azureTenantId) {
  const values = [];
  let licenseGated = 0;
  for (const t of INTUNE_TYPES) {
    let objects;
    try {
      objects = await graph.callGraphPaged(azureTenantId, t.list, { version: t.version, maxPages: 50 });
    } catch (e) {
      const c = classifyReadError(e);
      if (c.reason === 'unlicensed') { licenseGated += 1; continue; }
      return { ok: false, reason: 'transient', detail: `${t.key}: ${c.detail}` };
    }
    for (const o of objects || []) {
      let assignments = [];
      try {
        assignments = await graph.callGraphPaged(azureTenantId, t.assignments(o.id), { version: t.version, maxPages: 20 });
      } catch (e) {
        // An object that lists but whose assignments can't be read right now is a
        // transient condition — don't bake an incomplete baseline.
        return { ok: false, reason: 'transient', detail: `${t.key}/assignments: ${classifyReadError(e).detail}` };
      }
      values.push({
        policyType: t.key,
        id: o.id,
        displayName: o[t.nameField] || o.displayName || o.name || o.id,
        config: o,
        assignments: assignments || [],
      });
    }
  }
  if (licenseGated === INTUNE_TYPES.length) {
    return { ok: false, reason: 'unlicensed', detail: 'deviceManagement not licensed for this tenant' };
  }
  return { ok: true, values };
}

/** Read one CA policy live (for drift/reconcile). Returns the object or null (404). */
async function readCaPolicy(azureTenantId, id) {
  try {
    return await graph.callGraph(azureTenantId, `${CA_LIST}/${id}`, { silent: true });
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

/** Read one Intune object + its assignments live. Returns {config, assignments} or null (404). */
async function readIntuneObject(azureTenantId, policyType, id) {
  const t = getIntuneType(policyType);
  if (!t) throw new Error(`Unknown Intune policy type: ${policyType}`);
  let config;
  try {
    config = await graph.callGraph(azureTenantId, t.item(id), { version: t.version, silent: true });
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
  if (!config) return null;
  let assignments = [];
  try {
    assignments = await graph.callGraphPaged(azureTenantId, t.assignments(id), { version: t.version, maxPages: 20 });
  } catch (_e) { assignments = []; }
  return { config, assignments: assignments || [] };
}

// ──────────────────────────────────────────────────────────────────────
// Writes — operator-initiated, never automatic (spec §2.1)
// ──────────────────────────────────────────────────────────────────────

class ManagedByMicrosoftError extends Error {
  constructor(message) { super(message); this.name = 'ManagedByMicrosoftError'; }
}

/**
 * Best-effort label hint: does this CA policy look Microsoft-managed?
 * Graph exposes no reliable boolean on conditionalAccessPolicy, so this is a
 * NON-AUTHORITATIVE UI/label hint only. The actual write protection (§2.6) does
 * NOT depend on it — see runManagedWrite, which degrades on the Graph rejection
 * SHAPE regardless of this flag (so the house rule "no behaviour from
 * displayName" holds: nothing security-relevant is decided from the name).
 */
function looksMicrosoftManaged(policy) {
  const dn = String(policy && policy.displayName || '');
  return /^microsoft[-\s]?managed/i.test(dn);
}

const MANAGED_REJECTION_SIGNATURES = [
  'managed by microsoft', 'microsoft-managed', 'cannot be modified', 'cannot be deleted',
  'read-only', 'readonly', 'not allowed to be modified', 'is managed',
];

/**
 * Wrap a CA write so that a Microsoft refusal to modify/delete a managed policy
 * surfaces as a clean ManagedByMicrosoftError (caller shows "managed by
 * Microsoft, cannot be changed here") rather than a stack trace (spec §2.6,
 * §12.10). Triggers on the error SHAPE (message signature on a 4xx) OR — as a
 * fast path — when the policy was already hinted managed. Shape-driven so the
 * guarantee holds even when the label hint missed.
 */
async function runManagedWrite(fn, msManaged) {
  try {
    return await fn();
  } catch (e) {
    const sc = e.statusCode;
    const msg = String(e.message || '').toLowerCase();
    const looksManagedRejection =
      [400, 403, 405, 409].includes(sc) &&
      (msManaged || MANAGED_REJECTION_SIGNATURES.some(s => msg.includes(s)));
    if (looksManagedRejection) {
      throw new ManagedByMicrosoftError(e.message || 'managed by Microsoft');
    }
    throw e;
  }
}

/** PATCH a CA policy's state ('enabled' | 'disabled' | 'enabledForReportingButNotEnforced'). */
async function caSetState(azureTenantId, id, state, msManaged = false) {
  return runManagedWrite(
    () => graph.callGraph(azureTenantId, `${CA_LIST}/${id}`, { method: 'PATCH', body: { state } }),
    msManaged
  );
}

/** DELETE a CA policy from the tenant. */
async function caDelete(azureTenantId, id, msManaged = false) {
  return runManagedWrite(
    () => graph.callGraph(azureTenantId, `${CA_LIST}/${id}`, { method: 'DELETE' }),
    msManaged
  );
}

/**
 * Replace an Intune object's assignment set. Pass [] to strip all (deactivate),
 * or an array of target objects to restore. `targets` are the `target` payloads
 * (e.g. {'@odata.type':'#microsoft.graph.allLicensedUsersAssignmentTarget'} or a
 * groupAssignmentTarget); they are wrapped as { target } for the /assign body.
 */
async function intuneSetAssignments(azureTenantId, policyType, id, targets) {
  const t = getIntuneType(policyType);
  if (!t) throw new Error(`Unknown Intune policy type: ${policyType}`);
  const assignments = (targets || []).map(target => ({ target }));
  return graph.callGraph(azureTenantId, t.assign(id), {
    version: t.version, method: 'POST', body: { assignments },
  });
}

/** DELETE an Intune object from the tenant. */
async function intuneDelete(azureTenantId, policyType, id) {
  const t = getIntuneType(policyType);
  if (!t) throw new Error(`Unknown Intune policy type: ${policyType}`);
  return graph.callGraph(azureTenantId, t.item(id), { version: t.version, method: 'DELETE' });
}

module.exports = {
  INTUNE_TYPES,
  getIntuneType,
  classifyReadError,
  looksMicrosoftManaged,
  ManagedByMicrosoftError,
  // reads
  readCaPolicies,
  readSecurityDefaults,
  readIntuneObjects,
  readCaPolicy,
  readIntuneObject,
  // writes
  caSetState,
  caDelete,
  intuneSetAssignments,
  intuneDelete,
};
