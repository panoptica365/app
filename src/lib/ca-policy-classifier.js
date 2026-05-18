/**
 * CA Policy Classifier — behavior derives from JSON structure, never name.
 *
 * A Conditional Access policy's purpose is encoded in its grantControls +
 * conditions object, not in its displayName. An MSP can name a policy
 * "ketchup mustard relish" but if its grantControls.builtInControls contains
 * ['mfa'] and conditions.users.includeRoles names admin roles, it is a
 * "require MFA for admin roles" policy. The classifier must read the JSON
 * and never the name.
 *
 * This module is PURE:
 *   - No DB access.
 *   - No network calls.
 *   - No logging side effects.
 *   - Same input → same output, always.
 *
 * Input shape: Microsoft Graph Conditional Access policy JSON. See:
 * https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy
 *
 * Output shape:
 *   {
 *     dimensions: [
 *       {
 *         dimension: 'require_mfa' | 'block_geographic_access' | ...,
 *         scope: {
 *           users:   { include: string[], exclude: string[] },
 *           groups:  { include: string[], exclude: string[] },
 *           roles:   { include: string[], exclude: string[] },
 *           apps:    { include: string[], exclude: string[] },
 *           locations: { include: string[], exclude: string[] },     // GUID refs, tenant-local
 *           platforms: { include: string[], exclude: string[] }
 *         },
 *         state: 'enabled' | 'disabled' | 'enabledForReportingButNotEnforced'
 *       }
 *     ],
 *     unclassified: string[]    // freeform notes for manual review
 *   }
 *
 * Every dimension carries the same scope skeleton so downstream code
 * (alert evaluators, UI labels, backfill) is uniform regardless of which
 * dimension matched.
 *
 * Known dimensions (extend as new evaluators are added):
 *   - require_mfa                   grantControls.builtInControls contains 'mfa'
 *   - require_compliant_device      grantControls.builtInControls contains 'compliantDevice'
 *   - require_hybrid_join           grantControls.builtInControls contains 'domainJoinedDevice'
 *   - require_approved_app          grantControls.builtInControls contains 'approvedApplication'
 *   - require_app_protection        grantControls.builtInControls contains 'compliantApplication'
 *   - require_password_change       grantControls.builtInControls contains 'passwordChange'
 *   - block_geographic_access       grantControls.builtInControls contains 'block' AND conditions.locations declared
 *   - block_legacy_auth             grantControls.builtInControls contains 'block' AND conditions.clientAppTypes contains 'exchangeActiveSync' or 'other'
 *   - block_platform_access         grantControls.builtInControls contains 'block' AND conditions.platforms declared
 *   - block_risky_signin            grantControls.builtInControls contains 'block' AND conditions.signInRiskLevels declared
 *   - block_risky_user              grantControls.builtInControls contains 'block' AND conditions.userRiskLevels declared
 *   - require_identity_protection_response  grantControls non-block AND risk conditions declared
 */

'use strict';

// Grant-control name → dimension when the policy is a "grant with requirement" policy.
const REQUIRE_CONTROL_MAP = {
  mfa: 'require_mfa',
  compliantDevice: 'require_compliant_device',
  domainJoinedDevice: 'require_hybrid_join',
  approvedApplication: 'require_approved_app',
  compliantApplication: 'require_app_protection',
  passwordChange: 'require_password_change',
  // unknownFutureValue, etc. are ignored — classifier is forward-safe
};

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function hasAny(list) {
  return Array.isArray(list) && list.length > 0;
}

/**
 * Build the common scope object from the policy's conditions block.
 * Always returns the same shape (arrays possibly empty) so callers don't
 * have to null-check individual fields.
 */
function buildScope(policy) {
  const conditions = policy.conditions || {};
  const users = conditions.users || {};
  const apps = conditions.applications || {};
  const locations = conditions.locations || {};
  const platforms = conditions.platforms || {};

  return {
    users: {
      include: arr(users.includeUsers),
      exclude: arr(users.excludeUsers),
    },
    groups: {
      include: arr(users.includeGroups),
      exclude: arr(users.excludeGroups),
    },
    roles: {
      include: arr(users.includeRoles),
      exclude: arr(users.excludeRoles),
    },
    apps: {
      include: arr(apps.includeApplications),
      exclude: arr(apps.excludeApplications),
    },
    locations: {
      include: arr(locations.includeLocations),
      exclude: arr(locations.excludeLocations),
    },
    platforms: {
      include: arr(platforms.includePlatforms),
      exclude: arr(platforms.excludePlatforms),
    },
  };
}

/**
 * classifyCaPolicy — the public API.
 *
 * @param {object|string} policyJson — the CA policy object (or JSON string).
 * @returns {{ dimensions: Array, unclassified: string[] }}
 */
function classifyCaPolicy(policyJson) {
  if (!policyJson) return { dimensions: [], unclassified: ['empty policy'] };

  let policy;
  if (typeof policyJson === 'string') {
    try {
      policy = JSON.parse(policyJson);
    } catch (e) {
      return { dimensions: [], unclassified: [`invalid JSON: ${e.message}`] };
    }
  } else {
    policy = policyJson;
  }

  const state = policy.state || 'enabled';
  const grant = policy.grantControls || {};
  const builtIn = arr(grant.builtInControls);
  const conditions = policy.conditions || {};
  const scope = buildScope(policy);

  const dimensions = [];
  const unclassified = [];

  const isBlock = builtIn.includes('block');

  // --- Requirement-type grants (MFA, compliant device, etc.) --------------
  // These only count if the policy is NOT a block policy (the presence of
  // 'block' short-circuits — Graph doesn't allow 'block' + a requirement
  // in the same control, but if an operator tries, block wins).
  if (!isBlock) {
    for (const ctrl of builtIn) {
      const dim = REQUIRE_CONTROL_MAP[ctrl];
      if (dim) {
        dimensions.push({ dimension: dim, scope, state });
      }
    }
  }

  // --- Block-type dimensions ---------------------------------------------
  if (isBlock) {
    let matched = false;

    // Geographic: any locations condition triggers this. The scope carries
    // the location GUIDs (include/exclude) — the caller resolves them to
    // ISO country codes via the tenant's named-location data.
    if (hasAny(scope.locations.include) || hasAny(scope.locations.exclude)) {
      dimensions.push({ dimension: 'block_geographic_access', scope, state });
      matched = true;
    }

    // Legacy authentication: client-app-types specifying non-modern auth.
    const legacyClientAppTypes = ['exchangeActiveSync', 'other'];
    const clientApps = arr(conditions.clientAppTypes);
    if (clientApps.some(c => legacyClientAppTypes.includes(c))) {
      dimensions.push({ dimension: 'block_legacy_auth', scope, state });
      matched = true;
    }

    // Platform-based block: device platform restriction.
    if (hasAny(scope.platforms.include) || hasAny(scope.platforms.exclude)) {
      dimensions.push({ dimension: 'block_platform_access', scope, state });
      matched = true;
    }

    // Risk-based block.
    if (hasAny(conditions.signInRiskLevels)) {
      dimensions.push({ dimension: 'block_risky_signin', scope, state });
      matched = true;
    }
    if (hasAny(conditions.userRiskLevels)) {
      dimensions.push({ dimension: 'block_risky_user', scope, state });
      matched = true;
    }

    if (!matched) {
      unclassified.push(
        `block policy with no recognized condition (users=${scope.users.include.length}, apps=${scope.apps.include.length}) — review manually`
      );
    }
  }

  // --- Risk-response (non-block grant with risk conditions) --------------
  // Example: "if sign-in risk is medium+, require MFA." The require_mfa
  // dimension already fired above; we also emit a meta-dimension so risk
  // detectors can correlate with an exemption if one exists.
  if (!isBlock && builtIn.length > 0) {
    if (hasAny(conditions.signInRiskLevels) || hasAny(conditions.userRiskLevels)) {
      dimensions.push({
        dimension: 'require_identity_protection_response',
        scope,
        state,
      });
    }
  }

  // --- Unhandled cases ---------------------------------------------------
  if (builtIn.length === 0 && !grant.customAuthenticationFactors && !grant.authenticationStrength) {
    // Session-control-only policies (e.g., block downloads via persistent browser)
    // are a known gap. Surface as unclassified so operators can decide.
    const session = policy.sessionControls || {};
    const hasSession = Object.keys(session).some(k => session[k] !== null && session[k] !== undefined);
    if (!hasSession) {
      unclassified.push('policy has no grant or session controls — likely empty template');
    } else {
      unclassified.push('session-controls-only policy (not currently classified)');
    }
  }

  if (grant.authenticationStrength) {
    // Auth strength policies (phishing-resistant MFA, etc.) — treat as require_mfa
    // for exemption purposes unless already emitted.
    if (!dimensions.some(d => d.dimension === 'require_mfa')) {
      dimensions.push({ dimension: 'require_mfa', scope, state });
    }
  }

  return { dimensions, unclassified };
}

/**
 * Given classifier output, flatten to the legacy control_dimensions JSON
 * array used by ca_templates.control_dimensions. Callers who only need the
 * dimension identifiers (not scopes) use this.
 */
function toControlDimensionsList(classifierOutput) {
  if (!classifierOutput || !Array.isArray(classifierOutput.dimensions)) return [];
  const seen = new Set();
  const out = [];
  for (const d of classifierOutput.dimensions) {
    if (!d || !d.dimension) continue;
    if (seen.has(d.dimension)) continue;
    seen.add(d.dimension);
    out.push(d.dimension);
  }
  return out;
}

module.exports = {
  classifyCaPolicy,
  toControlDimensionsList,
  // Exported for unit tests / advanced callers.
  _internals: {
    REQUIRE_CONTROL_MAP,
    buildScope,
  },
};
