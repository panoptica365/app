/**
 * Named-Location Resolver — tenant-local GUID → ISO country code(s).
 *
 * Microsoft Graph Conditional Access references locations by tenant-local
 * GUID. The same country ("Canada") has a different GUID in each tenant,
 * and a single "named location" may cover multiple countries (e.g., a
 * "North America" location with ['US', 'CA', 'MX']). To reason about
 * geographic scope across tenants, we need to flatten these GUIDs to
 * universal ISO 3166-1 alpha-2 country codes at evaluation time.
 *
 * This resolver:
 *   - Fetches /identity/conditionalAccess/namedLocations for the tenant
 *   - Indexes by location GUID
 *   - Expands `countriesAndRegions` on each countryNamedLocation
 *   - Caches per-tenant (15 min TTL — named locations change rarely,
 *     but faster than the 60-min deployment-side cache because evaluators
 *     run more often and need fresher data)
 *   - Handles 'All' and 'AllTrusted' sentinels by returning a sentinel
 *     object — caller decides the semantic
 *
 * This module is NOT pure (reads from Graph). Callers should inject a
 * graph client for testability where needed.
 */

'use strict';

const graph = require('../graph');

const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Per-tenant cache: azureTenantId → { ts, locationsById: Map<guid, normalized> }
 *
 * `normalized` shape:
 *   {
 *     id:            'guid',
 *     displayName:   string,
 *     odataType:     '#microsoft.graph.countryNamedLocation' | '#microsoft.graph.ipNamedLocation',
 *     countriesAndRegions: string[],   // always array (may be empty)
 *     ipRanges:      Array<{ cidrAddress?, iPRange? }>,
 *     includeUnknownCountriesAndRegions: boolean,
 *     isTrusted:     boolean,
 *   }
 */
const _tenantCache = new Map();

function cachedFor(azureTenantId) {
  const entry = _tenantCache.get(azureTenantId);
  if (!entry) return null;
  if ((Date.now() - entry.ts) > CACHE_TTL_MS) {
    _tenantCache.delete(azureTenantId);
    return null;
  }
  return entry;
}

function normalize(loc) {
  return {
    id: loc.id,
    displayName: loc.displayName || '(unnamed)',
    odataType: loc['@odata.type'] || '',
    countriesAndRegions: Array.isArray(loc.countriesAndRegions)
      ? loc.countriesAndRegions.map(c => String(c).toUpperCase())
      : [],
    ipRanges: Array.isArray(loc.ipRanges) ? loc.ipRanges : [],
    includeUnknownCountriesAndRegions: !!loc.includeUnknownCountriesAndRegions,
    isTrusted: loc.isTrusted === true,
  };
}

/**
 * Force-refresh the cache for a tenant. Exposed so callers that just
 * created/modified a named location can bust the cache.
 */
function invalidate(azureTenantId) {
  if (azureTenantId) _tenantCache.delete(azureTenantId);
  else _tenantCache.clear();
}

/**
 * Load the tenant's named locations into the cache.
 * Returns the cached entry.
 */
async function loadTenant(azureTenantId) {
  const cached = cachedFor(azureTenantId);
  if (cached) return cached;

  let value = [];
  try {
    const resp = await graph.callGraph(
      azureTenantId,
      '/identity/conditionalAccess/namedLocations',
      { version: 'v1.0', method: 'GET' }
    );
    value = Array.isArray(resp?.value) ? resp.value : [];
  } catch (e) {
    // Cache a negative result briefly to prevent hammering Graph during an
    // outage. TTL is short so recovery is quick.
    console.error(`[NamedLocationResolver] Graph fetch failed for ${azureTenantId}: ${e.message}`);
    const entry = { ts: Date.now(), locationsById: new Map(), error: e.message };
    _tenantCache.set(azureTenantId, entry);
    return entry;
  }

  const locationsById = new Map();
  for (const loc of value) {
    if (loc && loc.id) locationsById.set(loc.id, normalize(loc));
  }
  const entry = { ts: Date.now(), locationsById, error: null };
  _tenantCache.set(azureTenantId, entry);
  return entry;
}

/**
 * Resolve a list of location GUIDs to a summary object. Handles the 'All'
 * and 'AllTrusted' sentinels as literal passthroughs.
 *
 * @param {string} azureTenantId
 * @param {string[]} locationIds  e.g. ['All'], ['guid-1', 'guid-2']
 * @returns {Promise<{
 *   hasAll: boolean,
 *   hasAllTrusted: boolean,
 *   countryCodes: Set<string>,     // union across all country-type locations
 *   ipLocationCount: number,       // how many of the GUIDs were IP-type
 *   unresolvable: string[],        // GUIDs not found in tenant
 *   details: Array<normalized>,    // per-GUID normalized entries
 * }>}
 */
async function resolveLocationIds(azureTenantId, locationIds) {
  const result = {
    hasAll: false,
    hasAllTrusted: false,
    countryCodes: new Set(),
    ipLocationCount: 0,
    unresolvable: [],
    details: [],
  };

  if (!Array.isArray(locationIds) || locationIds.length === 0) return result;

  // Fast sentinel scan — 'All' and 'AllTrusted' never hit the cache.
  const guidIds = [];
  for (const id of locationIds) {
    if (id === 'All') result.hasAll = true;
    else if (id === 'AllTrusted') result.hasAllTrusted = true;
    else guidIds.push(id);
  }

  if (guidIds.length === 0) return result;

  const tenant = await loadTenant(azureTenantId);
  for (const id of guidIds) {
    const loc = tenant.locationsById.get(id);
    if (!loc) {
      result.unresolvable.push(id);
      continue;
    }
    result.details.push(loc);
    if (loc.odataType === '#microsoft.graph.countryNamedLocation') {
      for (const c of loc.countriesAndRegions) result.countryCodes.add(c);
    } else if (loc.odataType === '#microsoft.graph.ipNamedLocation') {
      result.ipLocationCount += 1;
    }
  }

  return result;
}

/**
 * Given a geo-scoped classifier dimension (block_geographic_access), return
 * the effective set of ALLOWED country codes for a foreign-login evaluator.
 *
 * Semantic rules:
 *   - include=['All'] + exclude=[country-guids]: policy blocks everywhere
 *     EXCEPT the excluded locations. Allowed = countries in exclude list.
 *   - include=[country-guids] (no 'All'): policy blocks only those specific
 *     locations. Allowed = everywhere NOT in include list — but we cannot
 *     enumerate "everywhere", so we signal this with `mode: 'blocklist'`
 *     and return the blocked set instead.
 *   - no locations declared: not a geo policy, returns mode: 'none'.
 *
 * Returns `{ mode: 'allowlist' | 'blocklist' | 'none', countries: Set<string>,
 *            unresolvable: string[], hasIpLocations: boolean }`.
 */
async function computeGeoSemantic(azureTenantId, scope) {
  const include = (scope?.locations?.include) || [];
  const exclude = (scope?.locations?.exclude) || [];

  if (include.length === 0 && exclude.length === 0) {
    return { mode: 'none', countries: new Set(), unresolvable: [], hasIpLocations: false };
  }

  const includeResolved = await resolveLocationIds(azureTenantId, include);
  const excludeResolved = await resolveLocationIds(azureTenantId, exclude);

  // The typical "block everything except Canada" policy:
  //   include: ['All'], exclude: ['<Canada-GUID>']
  if (includeResolved.hasAll && exclude.length > 0) {
    return {
      mode: 'allowlist',
      countries: excludeResolved.countryCodes,
      unresolvable: excludeResolved.unresolvable,
      hasIpLocations: excludeResolved.ipLocationCount > 0,
    };
  }

  // Specific include with no 'All' → blocklist semantic.
  if (!includeResolved.hasAll && include.length > 0) {
    return {
      mode: 'blocklist',
      countries: includeResolved.countryCodes,
      unresolvable: includeResolved.unresolvable,
      hasIpLocations: includeResolved.ipLocationCount > 0,
    };
  }

  // include=['All'] with no exclude → blocks everywhere. Degenerate; treat
  // as allowlist of zero countries.
  if (includeResolved.hasAll && exclude.length === 0) {
    return { mode: 'allowlist', countries: new Set(), unresolvable: [], hasIpLocations: false };
  }

  // Fallback — shouldn't reach here.
  return { mode: 'none', countries: new Set(), unresolvable: [], hasIpLocations: false };
}

module.exports = {
  resolveLocationIds,
  computeGeoSemantic,
  loadTenant,
  invalidate,
  _cache: _tenantCache, // exposed for tests
};
