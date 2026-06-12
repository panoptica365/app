/**
 * Panoptica365 — Graph Readers for Security Settings (Phase A1b)
 *
 * CRITICAL convention — the `tenantAzureId` parameter is the Azure AD GUID
 * (the string from tenants.tenant_id), NOT the internal tenants.id INT.
 * Passing the INT here yields an AADSTS90002 "Tenant 'N' not found" error
 * from Microsoft's token endpoint.
 *
 * Beta-vs-v1.0 convention: path is plain (e.g. '/deviceManagement/...'), the
 * beta switch is passed as options.version = 'beta'. A path that begins
 * '/beta/...' yields a "Resource not found for the segment 'beta'" error
 * because the wrapper prepends the version itself.
 *
 * Per-setting functions read the CURRENT value from Graph and return:
 *   { ok: true,  current_value: <JSON-able>, interpreted: '<short string>' }
 *   { ok: false, error: '<message>' }
 *   { ok: false, unavailable: true, error: '<why>' }   — for licence-gated failures
 *
 * Phase A1b ships 12 readers (all current graph-strategy settings):
 *   Identity (6):  ENT-01, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09
 *   Defender (5):  DEF-01, DEF-02, DEF-04, DEF-05, DEF-07
 *   Compliance (1): CMP-03
 */

'use strict';

const graph = require('../../graph');

// ══════════════════════════════════════════════════════════════════
// Shared helper — scan Intune configurationPolicies for a setting
// ══════════════════════════════════════════════════════════════════
//
// Used by DEF-01 (Tamper Protection), DEF-02 (Network Protection),
// DEF-04 (CFA), DEF-05 (SmartScreen). All four follow the same shape:
// enumerate /deviceManagement/configurationPolicies, look for settings
// whose settingDefinitionId matches a keyword, and report whether any
// ASSIGNED policy sets the value to "enabled".
//
// Honest caveat for every DEF-* setting that uses this helper:
// the tenant-wide toggle in the Defender portal (separate from Intune)
// is NOT exposed via Graph today. "Not enforced via Intune" is factually
// correct but may read as misleading — the tenant may still have the
// feature ON via the Defender portal. The interpreted string explicitly
// mentions this so operators aren't misled.
async function scanIntunePolicyForSetting(tenantAzureId, settingKeyword) {
  // Enumerate configuration policies (paged). Fetching the list is cheap;
  // the filtering happens client-side.
  const policies = await graph.callGraphPaged(
    tenantAzureId,
    '/deviceManagement/configurationPolicies?$select=id,name,templateReference,settings,assignments&$expand=assignments,settings',
    { version: 'beta' }
  ) || [];

  let policyCount = 0;
  let assignedCount = 0;
  let enforcedAnywhere = false;
  const matchedPolicyIds = [];
  const keywordLower = settingKeyword.toLowerCase();

  for (const pol of policies) {
    const settings = Array.isArray(pol.settings) ? pol.settings : [];
    let touches = false;
    let setsOn = false;

    for (const s of settings) {
      const defId = s?.settingInstance?.settingDefinitionId || '';
      // Be generous on the match — setting definition IDs are long
      // namespaced strings. Any occurrence of the keyword counts; the
      // value check below confirms enablement.
      if (defId.toLowerCase().includes(keywordLower)) {
        touches = true;
        const choice = s?.settingInstance?.choiceSettingValue?.value || '';
        // Microsoft's choice values for enabled typically end in _1
        // (settings catalog) or are the literal string 'enabled'/'true'/'1'.
        if (/(_1$|enabled$|^1$|true$)/i.test(String(choice))) {
          setsOn = true;
        }
      }
    }

    if (touches) {
      policyCount++;
      matchedPolicyIds.push(pol.id);
      const hasAssignment = Array.isArray(pol.assignments) && pol.assignments.length > 0;
      if (hasAssignment) {
        assignedCount++;
        if (setsOn) enforcedAnywhere = true;
      }
    }
  }

  return { policyCount, assignedCount, enforcedAnywhere, matchedPolicyIds };
}

// interpretIntunePolicyScan helper removed Apr 26, 2026 — the 5 DEF-* readers
// that used it have been excluded from the Security Settings Engine (managed
// by the Intune Templates module). The scanIntunePolicyForSetting helper
// above is kept as utility code in case future settings need it.


// ══════════════════════════════════════════════════════════════════
// ENT-01 — Self-Service Password Reset (SSPR)
// ══════════════════════════════════════════════════════════════════
//
// Graph coverage for SSPR is partial. The Authentication Methods Policy
// exposes which auth methods are enabled tenant-wide; SSPR relies on
// those being configured, but Graph does NOT expose the SSPR-scope
// ("none"/"selected"/"all") directly. Best-effort read: report how many
// auth methods are enabled and note the Graph limitation in the string.
async function readSspr(tenantAzureId) {
  try {
    const res = await graph.callGraph(
      tenantAzureId,
      '/policies/authenticationMethodsPolicy',
      { version: 'beta' }
    );
    const configs = res?.authenticationMethodConfigurations || [];
    const enabled = configs
      .filter(c => c?.state === 'enabled')
      .map(c => c?.id || '(unknown)');

    // Apr 26 v3+v4 — capture state of ALL auth methods (not just the SSPR
    // baseline trio). The writer's matches() compares both the 3 baseline
    // methods AND any "additional methods" the operator opted into.
    //
    // CRITICAL: Microsoft Graph beta returns the `id` field in PascalCase
    // (verified against Trilogiam Apr 26: 'MicrosoftAuthenticator', 'Sms',
    // 'Email', etc.), but the URL PATH for the same configuration accepts
    // both PascalCase and camelCase (case-insensitive routing). The `id`
    // field comparison is case-SENSITIVE. Using PascalCase here to match
    // what Microsoft actually returns.
    const SSPR_METHODS = ['MicrosoftAuthenticator', 'Sms', 'Email'];

    // Build a per-method state map keyed by id. Captures every method the
    // tenant has configured, regardless of whether it's part of the SSPR
    // baseline. Used by both matches() (compare to baseline) and the
    // Configure tab UI (pre-populate the additional-methods checkboxes).
    const allMethods = {};
    for (const cfg of configs) {
      const id = cfg?.id;
      if (!id) continue;
      const includeTargets = Array.isArray(cfg.includeTargets) ? cfg.includeTargets : [];
      const targetsAllUsers = includeTargets.some(t => t?.id === 'all_users');
      allMethods[id] = {
        present: true,
        state: String(cfg.state || 'unknown'),
        all_users: targetsAllUsers,
      };
    }
    // Backward-compat slice for the SSPR baseline — kept so the existing
    // matches() logic for ENT-01 v1 still works during/after the v2 upgrade.
    const methodScope = {};
    for (const id of SSPR_METHODS) {
      methodScope[id] = allMethods[id] || { present: false, state: null, all_users: false };
    }

    return {
      ok: true,
      current_value: {
        enabled_methods: enabled,
        total_methods: configs.length,
        sspr_methods: methodScope,
        all_methods: allMethods,
      },
      interpreted: enabled.length > 0
        ? `${enabled.length} auth method${enabled.length === 1 ? '' : 's'} enabled — SSPR scope not exposed via Graph`
        : 'No auth methods enabled — SSPR cannot function',
    };
  } catch (e) {
    if (e.statusCode === 403) {
      return { ok: false, unavailable: true, error: 'Requires Entra ID P1 (not licensed on this tenant)' };
    }
    return { ok: false, error: `authenticationMethodsPolicy read failed: ${e.message}` };
  }
}


// ══════════════════════════════════════════════════════════════════
// ENT-05 — Number Matching and Additional Context for MFA Push
// ══════════════════════════════════════════════════════════════════
//
// Microsoft Authenticator config. Since May 2023 Microsoft enforces
// number matching tenant-wide by default; the readable policy tells us
// whether the operator has explicitly opted out via displayAppInformation
// / displayLocationInformation settings.
async function readMfaNumberMatching(tenantAzureId) {
  try {
    const res = await graph.callGraph(
      tenantAzureId,
      '/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator',
      { version: 'beta' }
    );
    const state = res?.state || 'unknown';
    // featureSettings shape: { displayAppInformationRequiredState: { state, includeTarget, excludeTarget } ... }
    const appInfo = res?.featureSettings?.displayAppInformationRequiredState?.state || 'unknown';
    const locInfo = res?.featureSettings?.displayLocationInformationRequiredState?.state || 'unknown';

    let interpreted;
    if (state !== 'enabled') {
      interpreted = `Authenticator disabled (state=${state})`;
    } else if (appInfo === 'enabled' && locInfo === 'enabled') {
      interpreted = 'App name + location enabled (full context)';
    } else if (appInfo === 'enabled' || locInfo === 'enabled') {
      interpreted = 'Partial — number matching on, context partial';
    } else {
      interpreted = 'Tenant default (number matching enforced since May 2023)';
    }

    return {
      ok: true,
      current_value: {
        authenticator_state: state,
        display_app_info: appInfo,
        display_location_info: locInfo,
      },
      interpreted,
    };
  } catch (e) {
    if (e.statusCode === 403) {
      return { ok: false, unavailable: true, error: 'Permission denied on authenticationMethodsPolicy' };
    }
    return { ok: false, error: `authenticationMethodsPolicy/MicrosoftAuthenticator read failed: ${e.message}` };
  }
}


// ══════════════════════════════════════════════════════════════════
// ENT-06 — Password Protection (Banned Password List)
// ══════════════════════════════════════════════════════════════════
//
// Directory settings carry the Password Rule Settings template. The
// template ID 5cf42378-d67d-4f36-ba46-e8b86229381d is Microsoft's
// well-known Password Rule Settings template. We read /beta/directory/settings
// or /beta/groupSettings depending on tenant — both return the same
// underlying template values. Falling back to groupSettings which is
// more broadly available.
async function readPasswordProtection(tenantAzureId) {
  const PWD_TEMPLATE_ID = '5cf42378-d67d-4f36-ba46-e8b86229381d';
  try {
    // /groupSettings is stable on v1.0 but REJECTED on beta with
    // "Resource not found for the segment 'groupSettings'" — Microsoft
    // moved/renamed the beta equivalent. v1.0 is the supported path
    // for the Password Rule Settings template.
    const settings = await graph.callGraphPaged(
      tenantAzureId,
      '/groupSettings'
    ) || [];

    const pwd = settings.find(s => s?.templateId === PWD_TEMPLATE_ID);
    if (!pwd) {
      return {
        ok: true,
        current_value: { template_present: false },
        interpreted: 'Default (Microsoft global banned-list only; no custom list)',
      };
    }

    const vals = Array.isArray(pwd.values) ? pwd.values : [];
    const v = k => (vals.find(x => x?.name === k)?.value) ?? null;
    const customListEnabled = (v('EnableBannedPasswordCheck') || '').toLowerCase() === 'true';
    const customList = v('BannedPasswordList') || '';
    // Microsoft stores the custom banned list as a TAB-separated string.
    // Split, trim, lowercase, drop empties, sort — canonical form for
    // matches() comparison and for pre-population in the Configure modal.
    const customWords = customList
      ? customList.split('\t').map(x => x.trim().toLowerCase()).filter(x => x.length > 0).sort()
      : [];
    const customEntries = customWords.length;
    const lockoutThreshold = parseInt(v('LockoutThreshold') || '0', 10);
    const lockoutDuration = parseInt(v('LockoutDurationInSeconds') || '0', 10);
    // groupSettings template id — stored so the writer's PATCH can reach the right object
    const settingsId = pwd.id || null;

    let interpreted;
    if (customListEnabled && customEntries > 0) {
      interpreted = `Global + custom list (${customEntries} banned term${customEntries === 1 ? '' : 's'}, lockout=${lockoutThreshold})`;
    } else if (customListEnabled) {
      interpreted = `Custom check enabled but list is empty (lockout=${lockoutThreshold})`;
    } else {
      interpreted = `Global list only (custom disabled, lockout=${lockoutThreshold})`;
    }

    return {
      ok: true,
      current_value: {
        template_present: true,
        settings_id: settingsId,
        custom_list_enabled: customListEnabled,
        custom_entries: customEntries,
        custom_words: customWords,    // sorted, lowercased
        lockout_threshold: lockoutThreshold,
        lockout_duration: lockoutDuration,
      },
      interpreted,
    };
  } catch (e) {
    if (e.statusCode === 403) {
      return { ok: false, unavailable: true, error: 'Requires Entra ID P1 for custom password list' };
    }
    return { ok: false, error: `groupSettings read failed: ${e.message}` };
  }
}


// ══════════════════════════════════════════════════════════════════
// ENT-07 — Restrict User Consent for Third-Party Applications
// ══════════════════════════════════════════════════════════════════
async function readUserConsentPolicy(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const assigned = res?.defaultUserRolePermissions?.permissionGrantPoliciesAssigned || [];

    // Microsoft updated the Entra portal in 2024-2025 to surface three modes:
    //   1. "Do not allow user consent"                                 → []
    //   2. "Allow user consent for apps from verified publishers..."   → microsoft-user-default-low
    //   3. "Let Microsoft manage your consent settings (Recommended)"  → microsoft-user-default-recommended
    // The legacy "Open" mode (microsoft-user-default-legacy) no longer
    // appears in the portal but may still be set on older tenants. Recognise
    // it so we can flag it as risky drift.
    let interpreted;
    if (assigned.length === 0) {
      interpreted = 'Restricted (admin consent required)';
    } else if (assigned.some(p => p.includes('microsoft-user-default-legacy'))) {
      interpreted = 'Open (users can consent to any app — legacy)';
    } else if (assigned.some(p => p.includes('microsoft-user-default-recommended'))) {
      interpreted = 'Microsoft-managed (recommended — auto-updates with Microsoft guidelines)';
    } else if (assigned.some(p => p.includes('microsoft-user-default-low'))) {
      interpreted = 'Low-risk only (users can consent to verified low-risk apps)';
    } else {
      interpreted = `Custom policies assigned (${assigned.length})`;
    }

    return {
      ok: true,
      current_value: { permissionGrantPoliciesAssigned: assigned },
      interpreted,
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}


// ENT-08 (Continuous Access Evaluation) reader removed Apr 26, 2026.
// Managed by the existing CA Policies module.


// ══════════════════════════════════════════════════════════════════
// ENT-09 — Guest User Default Permissions
// ══════════════════════════════════════════════════════════════════
//
// GET /policies/authorizationPolicy → guestUserRoleId. Microsoft uses
// three well-known role template IDs:
//   10dae51f-b6af-4016-8d66-8c2a99b929b3 → Guest User (Limited) — default
//   2af84b1e-32c8-42b7-82bc-daa82404023b → Restricted Guest User — hardened (recommended)
//   a0b1b346-4d3e-4e8b-98f8-753987be4970 → Same as member user — permissive (NOT recommended)
async function readGuestUserPermissions(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const roleId = res?.guestUserRoleId || '';
    const map = {
      '10dae51f-b6af-4016-8d66-8c2a99b929b3': 'Guest User (default — limited)',
      '2af84b1e-32c8-42b7-82bc-daa82404023b': 'Restricted Guest User (recommended)',
      'a0b1b346-4d3e-4e8b-98f8-753987be4970': 'Same as member user (NOT recommended)',
    };
    const interpreted = map[roleId] || `Unknown role template (${roleId})`;
    return {
      ok: true,
      current_value: { guestUserRoleId: roleId, role_name: map[roleId] || 'unknown' },
      interpreted,
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}


// ══════════════════════════════════════════════════════════════════
// ENT-10..13 — Entra authorization-policy toggles (Purple Knight, Jun 11 2026)
// ══════════════════════════════════════════════════════════════════
//
// All four read the SAME GET /policies/authorizationPolicy we already call for
// ENT-07 (user consent) and ENT-09 (guest role) — Policy.Read.All, already
// consented on every tenant. ENT-10/11/12 read booleans under
// defaultUserRolePermissions; ENT-13 reads the top-level allowInvitesFrom enum.
// The current_value shape each returns is what the registry writer.interpret()
// and writer.matches() consume.

// ENT-10 — Restrict App Registrations to Admins
async function readAppRegistrationPolicy(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const allowed = res?.defaultUserRolePermissions?.allowedToCreateApps === true;
    return {
      ok: true,
      current_value: { allowedToCreateApps: allowed },
      interpreted: allowed ? 'All users can register apps (Microsoft default)' : 'Admins only (recommended)',
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}

// ENT-11 — Restrict Security Group Creation to Admins
async function readSecurityGroupCreationPolicy(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const allowed = res?.defaultUserRolePermissions?.allowedToCreateSecurityGroups === true;
    return {
      ok: true,
      current_value: { allowedToCreateSecurityGroups: allowed },
      interpreted: allowed ? 'All users can create security groups (Microsoft default)' : 'Admins only (recommended)',
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}

// ENT-12 — Restrict Tenant Creation to Admins
async function readTenantCreationPolicy(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const allowed = res?.defaultUserRolePermissions?.allowedToCreateTenants === true;
    return {
      ok: true,
      current_value: { allowedToCreateTenants: allowed },
      interpreted: allowed ? 'All users can create tenants (Microsoft default)' : 'Admins only (recommended)',
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}

// ENT-13 — Restrict Who Can Invite Guests.
// Top-level allowInvitesFrom enum: none | adminsAndGuestInviters |
// adminsGuestInvitersAndAllMembers (Microsoft default) | everyone (finding fires here).
async function readGuestInvitePolicy(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/policies/authorizationPolicy');
    const value = String(res?.allowInvitesFrom || '');
    const map = {
      none: 'No one can invite guests (most restrictive)',
      adminsAndGuestInviters: 'Admins and designated inviters only (hardened)',
      adminsGuestInvitersAndAllMembers: 'Members and admins can invite (recommended — Microsoft default)',
      everyone: 'Anyone including guests can invite (NOT recommended)',
    };
    const interpreted = map[value] || `Unknown allowInvitesFrom="${value}"`;
    return {
      ok: true,
      current_value: { allowInvitesFrom: value },
      interpreted,
    };
  } catch (e) {
    return { ok: false, error: `authorizationPolicy read failed: ${e.message}` };
  }
}


// All 5 Defender readers (DEF-01 Tamper Protection, DEF-02 Network Protection,
// DEF-04 Controlled Folder Access, DEF-05 SmartScreen, DEF-07 LAPS) removed
// Apr 26, 2026. Managed by the existing Intune Templates module.
// The scanIntunePolicyForSetting helper at the top of this file is kept in
// case future settings need it; it can be deleted if no caller emerges.


// ══════════════════════════════════════════════════════════════════
// SPO-01 — Restrict External Sharing
// ══════════════════════════════════════════════════════════════════
//
// Endpoint: GET /admin/sharepoint/settings
// Properties of interest:
//   sharingCapability — string enum:
//     'disabled' | 'existingExternalUserSharingOnly' |
//     'externalUserSharingOnly' | 'externalUserAndGuestSharing'
//   sharingDomainRestrictionMode — 'none' | 'allowList' | 'blockList'
//   sharingAllowedDomainList — string[] (when restrictionMode='allowList')
//   sharingBlockedDomainList — string[] (when restrictionMode='blockList')
//   isResharingByExternalUsersEnabled — bool (extra hardening signal)
//
// Required app registration permission: SharePointTenantSettings.Read.All
// (application). NOT covered by Sites.Read.All. New permission grant +
// admin consent on each tenant.
//
// 403 here almost always means "permission not granted yet" — surface
// as unavailable so the LED is grey-lock not amber.
async function readSharingCapability(tenantAzureId) {
  try {
    const res = await graph.callGraph(tenantAzureId, '/admin/sharepoint/settings');
    const cap = String(res?.sharingCapability || 'unknown');
    const mode = String(res?.sharingDomainRestrictionMode || 'none');
    const allowedDomains = Array.isArray(res?.sharingAllowedDomainList) ? res.sharingAllowedDomainList : [];
    const blockedDomains = Array.isArray(res?.sharingBlockedDomainList) ? res.sharingBlockedDomainList : [];
    const reshareExt = res?.isResharingByExternalUsersEnabled === true;

    // Translate sharingCapability enum to plain language. Lead with the
    // alarming verb when the value is the SMB-default risky state.
    let capLabel;
    switch (cap) {
      case 'disabled':
        capLabel = 'External sharing disabled (most restrictive)';
        break;
      case 'existingExternalUserSharingOnly':
        capLabel = 'Existing guests only (recommended)';
        break;
      case 'externalUserSharingOnly':
        capLabel = 'Authenticated guests only — moderate';
        break;
      case 'externalUserAndGuestSharing':
        capLabel = '"Anyone" links ENABLED — risk (anonymous access, common SMB default)';
        break;
      default:
        capLabel = `Unknown sharingCapability="${cap}"`;
    }

    // Augment with domain-restriction posture when set.
    let restrictionNote = '';
    if (mode === 'allowList' && allowedDomains.length > 0) {
      restrictionNote = ` (restricted to ${allowedDomains.length} partner domain${allowedDomains.length === 1 ? '' : 's'})`;
    } else if (mode === 'blockList' && blockedDomains.length > 0) {
      restrictionNote = ` (${blockedDomains.length} domain${blockedDomains.length === 1 ? '' : 's'} blocked)`;
    }

    const reshareNote = reshareExt ? '; external users CAN reshare (extra risk)' : '';

    return {
      ok: true,
      current_value: {
        sharing_capability: cap,
        domain_restriction_mode: mode,
        allowed_domains_count: allowedDomains.length,
        blocked_domains_count: blockedDomains.length,
        external_reshare_enabled: reshareExt,
      },
      interpreted: `${capLabel}${restrictionNote}${reshareNote}`,
    };
  } catch (e) {
    if (e.statusCode === 403) {
      return {
        ok: false,
        unavailable: true,
        error: 'Requires SharePointTenantSettings.Read.All on the app registration (not currently granted)',
      };
    }
    return { ok: false, error: `admin/sharepoint/settings read failed: ${e.message}` };
  }
}


// SPO-02 (Restrict OneDrive Sync App on Unmanaged Devices) reader removed
// May 4, 2026 — same legacy-domain-GUID enforcement issue as documented in
// registry.js. Replaced by a CA Templates entry (cloud apps = SharePoint
// Online + OneDrive, grant = compliant device OR hybrid Entra-joined).
// CMP-03 (Sign-In Risk Policy) reader removed Apr 26, 2026.
// Managed by the existing CA Policies module.


// ══════════════════════════════════════════════════════════════════
// Dispatcher
// ══════════════════════════════════════════════════════════════════
// Apr 26, 2026: ENT-08 (CAE), CMP-03 (Sign-In Risk), and DEF-01/02/04/05/07
// (the 5 Defender Intune settings) removed from the dispatcher. They are
// excluded from the Security Settings Engine because the existing CA Policies
// and Intune Templates modules already manage them. Their reader functions
// were also deleted in the same pass to keep the file tight.
// May 4, 2026: SPO-02 removed for the same architectural reason — the
// real solution is a CA policy targeting SharePoint, which belongs in CA
// Templates, not in Security Settings.
const READERS = {
  'ENT-01': readSspr,
  'ENT-05': readMfaNumberMatching,
  'ENT-06': readPasswordProtection,
  'ENT-07': readUserConsentPolicy,
  'ENT-09': readGuestUserPermissions,
  'ENT-10': readAppRegistrationPolicy,
  'ENT-11': readSecurityGroupCreationPolicy,
  'ENT-12': readTenantCreationPolicy,
  'ENT-13': readGuestInvitePolicy,
  'SPO-01': readSharingCapability,
};

/**
 * Poll a single (tenant, setting) pair.
 *
 * @param {string} tenantAzureId — Azure AD GUID (tenants.tenant_id), NOT the INT id.
 * @param {string} settingId     — e.g. 'ENT-07'
 */
async function pollSetting(tenantAzureId, settingId) {
  const reader = READERS[settingId];
  if (!reader) {
    return {
      ok: false,
      error: `No graph reader implemented for ${settingId} — registry poll_strategy='graph' but no reader registered`,
    };
  }
  return reader(tenantAzureId, settingId);
}

module.exports = {
  pollSetting,
  // Exported for unit testing
  _readers: READERS,
  // Kept exported (Apr 26, 2026): no current caller in this module after the
  // 5 DEF-* readers were removed, but the helper is general-purpose and may
  // be reused by future settings or by other modules that need to introspect
  // Intune policy assignments.
  _scanIntunePolicyForSetting: scanIntunePolicyForSetting,
};
