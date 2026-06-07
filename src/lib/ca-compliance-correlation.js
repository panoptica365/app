/**
 * Panoptica365 — CA Compliance Correlation
 *
 * Decides whether a UAL event from an "anomalous" location/IP should fire an
 * alert, or whether the underlying sign-in was already gated by a Conditional
 * Access policy that permitted access — in which case re-alerting the geo
 * signal would double-count a control that already passed (Octiga's failure
 * mode).
 *
 * Two CA architectures are supported. Both are common in real MSP fleets:
 *
 *   1. GRANT-CONTROL gating ("Grant: Block OR CompliantDevice")
 *      The CA policy lists CompliantDevice in enforcedGrantControls and returns
 *      result='success' on the sign-in. Microsoft surfaces this directly in
 *      the appliedConditionalAccessPolicies output. Detected explicitly by
 *      inspecting policy.enforcedGrantControls.
 *
 *   2. DEVICE-FILTER-CONDITION gating ("Conditions: device filter excludes
 *      device.isCompliant=True; Grant: Block")
 *      The CA policy block-fires only against non-compliant devices; compliant
 *      devices are excluded from the policy entirely via a device filter. When
 *      a compliant device signs in from outside the allowed location, the
 *      policy returns result='notApplied' — Microsoft does NOT surface in the
 *      JSON that the device filter exclusion was the reason. Detected
 *      inferentially: caStatus='success' + isCompliant=true + signin country
 *      is anomalous + at least one Block-style policy returned notApplied.
 *
 * The Trilogiam-pushed CA templates use architecture #2 (verified against
 * production data 2026-05-04). Both are equally valid; #2 is what Microsoft
 * documentation now recommends for country-block-with-compliant-device-exception.
 *
 * Reference: Documentation/Panoptica365 — Unified Audit Log Strategy v2.docx §4.7
 *            (the v2 doc was written assuming architecture #1; this module
 *            handles both. The strategy doc should be updated to reflect
 *            the inferential path next time it's revised.)
 */

const signinCache = require('./signin-cache');

const DEFAULT_WINDOW_MINUTES = 10;

// Microsoft's grant-control names are PascalCase, no spaces, no "Require"
// prefix (verified against Trilogiam fleet data 2026-05-04). Examples seen
// in the wild: 'Mfa', 'Block', 'CompliantDevice'. Normalize defensively in
// case Microsoft varies the format on other surfaces.
const COMPLIANT_DEVICE_GRANT_TOKENS = new Set(['compliantdevice']);

function normalizeToken(s) {
  return String(s || '').toLowerCase().replace(/[\s_-]/g, '');
}

function isCompliantDeviceGrant(controlName) {
  if (!controlName) return false;
  return COMPLIANT_DEVICE_GRANT_TOKENS.has(normalizeToken(controlName));
}

/**
 * Find policies that explicitly succeeded with CompliantDevice in their
 * grant controls. Architecture #1 detection.
 *
 * @param {Array<object>} policies  applied_ca_policies array (already JSON-parsed)
 * @returns {Array<{id: string, displayName: string}>}
 */
function findCompliantDeviceGrantPolicies(policies) {
  if (!Array.isArray(policies) || policies.length === 0) return [];
  const gating = [];
  for (const p of policies) {
    if (!p || p.result !== 'success') continue;
    const grants = Array.isArray(p.enforcedGrantControls) ? p.enforcedGrantControls : [];
    if (grants.some(isCompliantDeviceGrant)) {
      gating.push({ id: p.id, displayName: p.displayName });
    }
  }
  return gating;
}

/**
 * Helper for architecture #2 detection: at least one policy that would
 * normally Block was bypassed (notApplied). The strongest hint that an
 * exclusion (device filter, user exclusion, etc.) fired.
 */
function hasBypassedBlockPolicy(policies) {
  if (!Array.isArray(policies)) return false;
  return policies.some(p =>
    p
    && p.result === 'notApplied'
    && Array.isArray(p.enforcedGrantControls)
    && p.enforcedGrantControls.includes('Block')
  );
}

/**
 * Correlate a UAL event back to its triggering Graph sign-in.
 *
 * Returns the raw signals — the caller decides what to do with them.
 * Use shouldSuppressGeoAlert() for the standard suppression decision on
 * geo/IP-anomalous UAL events.
 *
 * @param {object}      args
 * @param {number}      args.tenantId       Panoptica tenants.id (NOT the Entra GUID)
 * @param {string}      args.userUpn        UPN to match (case-insensitive)
 * @param {Date|string} args.eventTime      UAL event timestamp (UTC)
 * @param {string}     [args.eventIp]       UAL event source IP. Improves match precision.
 * @param {number}     [args.windowMinutes] Lookback/lookahead window. Default 10.
 *
 * @returns {Promise<{
 *   matchedSignIn: object|null,
 *   compliantDeviceGrantPolicies: Array<{id, displayName}>,
 *   confidence: 'high'|'medium'|'low'|'no_match',
 *   reason: string,
 * }>}
 */
async function correlate({
  tenantId,
  userUpn,
  eventTime,
  eventIp = null,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
}) {
  const empty = {
    matchedSignIn: null,
    compliantDeviceGrantPolicies: [],
    confidence: 'no_match',
    reason: '',
  };

  if (!tenantId || !userUpn || !eventTime) {
    return { ...empty, reason: 'correlate() requires tenantId, userUpn, eventTime' };
  }

  const eventDate = eventTime instanceof Date ? eventTime : new Date(eventTime);
  if (Number.isNaN(eventDate.getTime())) {
    return { ...empty, reason: `invalid eventTime: ${eventTime}` };
  }

  const since = new Date(eventDate.getTime() - windowMinutes * 60 * 1000);
  const until = new Date(eventDate.getTime() + windowMinutes * 60 * 1000);

  const candidates = await signinCache.lookupSignIns({
    tenantId,
    userUpn,
    since,
    until,
    ipAddress: eventIp || undefined,
  });

  if (candidates.length === 0) {
    return { ...empty, reason: `no sign-in for ${userUpn} within ±${windowMinutes} min of ${eventDate.toISOString()}` };
  }

  // lookupSignIns already sorted IP-matches first (when eventIp provided);
  // first row is the best candidate.
  const best = candidates[0];
  const policies = best.applied_ca_policies; // mysql2 auto-parses JSON

  const ipMatched = !!eventIp && best.ip_address === eventIp;
  const deltaMin = Math.abs(new Date(best.created_at).getTime() - eventDate.getTime()) / 60000;

  // Confidence: IP match is the strongest signal (same network session).
  // Time proximity is secondary. Both → high; either → medium; neither → low.
  let confidence;
  if (ipMatched && deltaMin <= 5) confidence = 'high';
  else if (ipMatched) confidence = 'medium';
  else if (deltaMin <= 5) confidence = 'medium';
  else confidence = 'low';

  const compliantDeviceGrantPolicies = findCompliantDeviceGrantPolicies(policies);

  return {
    matchedSignIn: {
      signinId: best.signin_id,
      createdAt: best.created_at,
      userUpn: best.user_upn,
      ipAddress: best.ip_address,
      country: best.country,
      city: best.city,
      isCompliant: best.is_compliant,
      isManaged: best.is_managed,
      caStatus: best.ca_status,
      statusErrorCode: best.status_error_code,
      riskDuring: best.risk_during,
      riskAggregated: best.risk_aggregated,
      // Keep the raw policies array so callers can inspect for non-compliance
      // signals (block policy actually fired, MFA challenged, etc.)
      appliedCaPolicies: policies,
    },
    compliantDeviceGrantPolicies,
    confidence,
    reason: `matched sign-in ${best.signin_id} (Δ=${deltaMin.toFixed(1)}min, ipMatch=${ipMatched})`,
  };
}

/**
 * Decide whether a geo/IP-anomalous UAL alert should be suppressed because
 * Microsoft already gated the underlying sign-in via compliance.
 *
 * Suppression fires when EITHER:
 *   - architecture #1: a CA policy explicitly succeeded via CompliantDevice
 *     grant control, OR
 *   - architecture #2: the sign-in succeeded from an out-of-allowlist country
 *     on a compliant device, AND at least one Block-style policy returned
 *     notApplied (indicating an exclusion fired)
 *
 * Conservative defaults:
 *   - If no sign-in matched: do NOT suppress. Better to alert with weak
 *     context than to miss a real event.
 *   - If allowedCountries is empty/unset: do NOT suppress on geo grounds.
 *     Falls back to architecture #1 detection only.
 *   - If caStatus !== 'success': do NOT suppress. The user got in via some
 *     other path (token replay, etc.) — that's exactly what we want to alert on.
 *
 * @param {object}  args
 * @param {object}  args.correlation        return value of correlate()
 * @param {Array<string>} [args.allowedCountries]  ISO codes the tenant treats as
 *                                                 normal (e.g. ['CA']). Empty/unset
 *                                                 disables architecture #2 detection.
 *
 * @returns {{ suppress: boolean, mechanism: string, reason: string }}
 */
function shouldSuppressGeoAlert({ correlation, allowedCountries = [] }) {
  if (!correlation || !correlation.matchedSignIn) {
    return {
      suppress: false,
      mechanism: 'none',
      reason: 'no sign-in context — alert proceeds with weak attribution',
    };
  }

  const { matchedSignIn, compliantDeviceGrantPolicies } = correlation;

  // Architecture #1: explicit grant-control gating
  if (compliantDeviceGrantPolicies.length > 0) {
    const names = compliantDeviceGrantPolicies.map(p => p.displayName).join(', ');
    return {
      suppress: true,
      mechanism: 'grant_control',
      reason: `CA policy granted access via CompliantDevice control: ${names}`,
    };
  }

  // Architecture #2: inferential device-filter detection.
  if (matchedSignIn.caStatus !== 'success') {
    return {
      suppress: false,
      mechanism: 'none',
      reason: `caStatus=${matchedSignIn.caStatus} — sign-in did not pass CA, alert proceeds`,
    };
  }

  if (matchedSignIn.isCompliant !== true) {
    return {
      suppress: false,
      mechanism: 'none',
      reason: `device not compliant (isCompliant=${matchedSignIn.isCompliant}) — no compliance-based exception possible`,
    };
  }

  const allowedSet = new Set((allowedCountries || []).filter(Boolean).map(c => String(c).toUpperCase()));
  const country = matchedSignIn.country ? String(matchedSignIn.country).toUpperCase() : null;

  if (allowedSet.size === 0) {
    return {
      suppress: false,
      mechanism: 'none',
      reason: 'no allowedCountries provided — cannot evaluate geo-anomaly suppression',
    };
  }

  if (!country || allowedSet.has(country)) {
    return {
      suppress: false,
      mechanism: 'none',
      reason: `sign-in from ${country || 'unknown'} is not anomalous (allowed: ${[...allowedSet].join(', ')})`,
    };
  }

  // Country IS anomalous. Check the device-filter inference:
  // at least one Block policy must have returned notApplied — that's the
  // signature of an exclusion having fired.
  if (!hasBypassedBlockPolicy(matchedSignIn.appliedCaPolicies)) {
    return {
      suppress: false,
      mechanism: 'none',
      reason: `compliant device signed in from ${country} but no Block policy was bypassed — no compliance-based gating signal`,
    };
  }

  return {
    suppress: true,
    mechanism: 'inferred_device_filter',
    reason: `compliant device signed in from ${country}; Block-from-location policy returned notApplied (allowed: ${[...allowedSet].join(', ')}) — compliance-based exception inferred`,
  };
}

module.exports = {
  correlate,
  shouldSuppressGeoAlert,
  // Exposed for unit tests / probe scripts
  _findCompliantDeviceGrantPolicies: findCompliantDeviceGrantPolicies,
  _hasBypassedBlockPolicy: hasBypassedBlockPolicy,
  _isCompliantDeviceGrant: isCompliantDeviceGrant,
  _normalizeToken: normalizeToken,
  DEFAULT_WINDOW_MINUTES,
};
