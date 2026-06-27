/**
 * Panoptica — Alert Exemption Rule Matcher
 *
 * Operator-defined, pattern-based alert suppression for per-policy
 * Risky Sign-in (and future) detectors. Complements the M365-mirrored
 * ca_exemptions framework — see migrate-alert-exemption-rules.sql for
 * the why-not-extend-ca_exemptions decision.
 *
 * Hot path:
 *   1. createOrUpdateAlert() in src/alert-engine.js extracts a "match
 *      signal" from the would-be alert's raw_data (UPN, country, IP).
 *   2. Calls findMatchingRule(tenantId, policyId, signal).
 *   3. If a rule matches, the caller writes the alert as auto-resolved
 *      (status='resolved', resolution_reason='exemption_rule',
 *      resolution_rule_id=rule.id) and skips email/AI analysis.
 *   4. After insert, the caller calls recordRuleMatch(rule.id) — fire-
 *      and-forget — to bump match_count and last_matched_at.
 *
 * Match precedence:
 *   - tenant_id + policy_id are always required and exact-match.
 *   - match_upn must match the signal's lowercased UPN exactly. UPN is
 *     the load-bearing key — without a UPN signal, the matcher returns
 *     null (we never auto-resolve a "tenant-wide" alert).
 *   - match_country, when set on the rule, must match the signal's
 *     uppercase ISO-2 country. NULL on the rule = wildcard.
 *   - match_ip_cidr, when set on the rule, must contain the signal's
 *     IP. NULL on the rule = wildcard. CIDR matching uses ipaddr.js if
 *     available; otherwise falls back to exact-string equality (the
 *     operator can still write a /32 or specific IP and have it match).
 *   - match_asn is RESERVED. We don't currently enrich sign-in events
 *     with ASN, so a non-NULL match_asn never matches. The modal warns
 *     operators selecting it.
 *
 * Non-blocking failure mode: if the DB is unreachable or the table
 * doesn't exist (migration not yet run), findMatchingRule returns null
 * — alerts behave as they did before this feature shipped. We never
 * suppress on the basis of a query error; that would silently swallow
 * real signals.
 */

'use strict';

const db = require('../db/database');

// Optional CIDR library. We don't add a runtime dependency just for this
// — if ipaddr.js is on the project later, this code starts using it
// transparently. Until then, fall back to exact-string IP equality.
let ipaddr = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ipaddr = require('ipaddr.js');
} catch (_) { /* not installed — fallback path */ }

/**
 * Find an active rule that matches the signal for this (tenant, policy).
 *
 * @param {number} tenantId  — internal tenants.id
 * @param {number} policyId  — alert_policies.id
 * @param {object} signal    — { upn, country?, ip? }
 * @returns {Promise<object|null>} rule row or null
 */
async function findMatchingRule(tenantId, policyId, signal) {
  if (!tenantId || !policyId || !signal || !signal.upn) return null;

  const upnLower = String(signal.upn).toLowerCase();
  const countryUpper = signal.country
    ? String(signal.country).toUpperCase()
    : null;
  const ip = signal.ip ? String(signal.ip) : null;

  let candidates;
  try {
    // Hot-path query: index hit on (tenant_id, policy_id, match_upn,
    // revoked_at, expires_at). Returns the small set of active rules whose
    // UPN matches; in-process filter narrows on country + IP (and ASN once
    // wired). Keeping the SQL simple makes it easy to review and avoids
    // pushing CIDR logic into MySQL.
    candidates = await db.queryRows(
      `SELECT id, tenant_id, policy_id, match_upn, match_country,
              match_ip_cidr, match_asn, expires_at, reason, created_by
         FROM alert_exemption_rules
        WHERE tenant_id  = ?
          AND policy_id  = ?
          AND match_upn  = ?
          AND revoked_at IS NULL
          AND expires_at > UTC_TIMESTAMP()`,
      [tenantId, policyId, upnLower]
    );
  } catch (err) {
    // Migration not run, table missing, or DB hiccup. Behave as if no rule
    // exists. Loud-log so we notice if this path is hit unexpectedly.
    console.warn(`[AlertExemptionMatcher] Query failed (tenant=${tenantId} policy=${policyId}): ${err.message}`);
    return null;
  }

  if (!candidates || candidates.length === 0) return null;

  // Filter on optional dimensions in JS. Most tenants will have <5 rules
  // per policy; this is essentially free.
  for (const rule of candidates) {
    if (rule.match_country && countryUpper !== rule.match_country) continue;

    if (rule.match_ip_cidr) {
      if (!ip) continue; // Rule narrows by IP but signal has none → no match
      if (!ipMatchesCidr(ip, rule.match_ip_cidr)) continue;
    }

    if (rule.match_asn) {
      // ASN enrichment not yet wired — the rule will never match. Log once
      // per rule per process so operators see the warning if they did pick
      // ASN. (We could fail-loud on rule create, but that pushes UX into
      // the API layer; logging here is informational.)
      logAsnUnsupportedOnce(rule.id);
      continue;
    }

    return rule;
  }

  return null;
}

/**
 * Find an active "Defender alert type" exception rule for a would-be alert.
 *
 * Distinct from findMatchingRule (the UPN-keyed risky-sign-in matcher) — this
 * one keys on the Microsoft Defender alert TYPE/name (raw_data.defender_alert_type)
 * and is what the operator-driven "Create exception" button on Defender alerts
 * creates. It exists so an MSP can silence noisy Microsoft-already-handled
 * inbound classes (e.g. "Email messages containing malware removed after
 * delivery") WITHOUT silencing the whole Defender policy — outbound-spam-from-
 * compromised-account alerts carry a different alertType and never match here.
 *
 * Scope: a rule applies to one tenant (tenant_id) OR fleet-wide (all_tenants=1).
 * Match is case-insensitive exact on the type string (not substring) so an
 * exception only ever silences the exact Microsoft alert class the operator
 * picked. Permanent until revoked: expires_at is NULL for these rules, but we
 * still honour a non-NULL expiry defensively in case one is ever set.
 *
 * Same fail-safe contract as findMatchingRule: any error (missing columns
 * before migration, DB hiccup) returns null so alerts behave exactly as they
 * did before this feature — we never suppress on the basis of a query error.
 *
 * @param {number} tenantId   — internal tenants.id of the would-be alert
 * @param {string} alertType  — raw_data.defender_alert_type
 * @returns {Promise<object|null>} rule row or null
 */
async function findMatchingDefenderTypeRule(tenantId, alertType) {
  if (!tenantId || !alertType || typeof alertType !== 'string') return null;
  const typeLower = alertType.trim().toLowerCase();
  if (!typeLower) return null;

  try {
    // Prefer a tenant-specific rule over a fleet-wide one if both exist
    // (all_tenants ASC puts tenant_id matches, where all_tenants=0, first).
    const rows = await db.queryRows(
      `SELECT id, tenant_id, policy_id, match_alert_type, all_tenants,
              reason, created_by
         FROM alert_exemption_rules
        WHERE match_alert_type IS NOT NULL
          AND LOWER(match_alert_type) = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
          AND (all_tenants = 1 OR tenant_id = ?)
        ORDER BY all_tenants ASC
        LIMIT 1`,
      [typeLower, tenantId]
    );
    return (rows && rows.length) ? rows[0] : null;
  } catch (err) {
    console.warn(`[AlertExemptionMatcher] Defender-type query failed (tenant=${tenantId}, type="${alertType}"): ${err.message}`);
    return null;
  }
}

/**
 * Find an active POLICY-level exception rule for a would-be alert.
 *
 * This is the "silence this whole category" primitive (operator "Create
 * exception" on EOP email-threat alerts — Inbound spam/malware/phish blocked,
 * #7/#23). Each of those classes is its own alert policy, so exempting the
 * whole policy IS "this category entirely" and is safe by construction:
 * outbound spam / malware / phish are different policies and are untouched.
 *
 * A policy-level rule is identified by having NO narrower match keys set
 * (match_upn IS NULL AND match_alert_type IS NULL) — so it can't be confused
 * with a UPN risky-sign-in rule or a Defender alert-type rule. Scope is one
 * tenant (tenant_id) OR fleet-wide (all_tenants=1). Permanent unless an
 * expiry was set. Same fail-safe contract as the other matchers: any error
 * returns null and the alert behaves exactly as before.
 *
 * @param {number} tenantId  — internal tenants.id of the would-be alert
 * @param {number} policyId  — alert_policies.id
 * @returns {Promise<object|null>} rule row or null
 */
async function findMatchingPolicyRule(tenantId, policyId) {
  if (!tenantId || !policyId) return null;
  try {
    const rows = await db.queryRows(
      `SELECT id, tenant_id, policy_id, all_tenants, reason, created_by
         FROM alert_exemption_rules
        WHERE policy_id         = ?
          AND match_upn         IS NULL
          AND match_alert_type  IS NULL
          AND revoked_at        IS NULL
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
          AND (all_tenants = 1 OR tenant_id = ?)
        ORDER BY all_tenants ASC
        LIMIT 1`,
      [policyId, tenantId]
    );
    return (rows && rows.length) ? rows[0] : null;
  } catch (err) {
    console.warn(`[AlertExemptionMatcher] Policy-rule query failed (tenant=${tenantId}, policy=${policyId}): ${err.message}`);
    return null;
  }
}

/**
 * Bump match_count + last_matched_at for a rule that just resolved an
 * alert. Fire-and-forget — caller does not await. Failures log warn.
 *
 * @param {number} ruleId
 */
async function recordRuleMatch(ruleId) {
  if (!ruleId) return;
  try {
    await db.execute(
      `UPDATE alert_exemption_rules
          SET match_count     = match_count + 1,
              last_matched_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [ruleId]
    );
  } catch (err) {
    console.warn(`[AlertExemptionMatcher] recordRuleMatch failed for rule ${ruleId}: ${err.message}`);
  }
}

/**
 * Extract a match signal from an in-flight alert's raw_data, scoped to the
 * Risky Sign-in detector family. For other policies the signal will be
 * incomplete (no UPN), and findMatchingRule will short-circuit.
 *
 * raw_data shape we read (see Graph signIn schema):
 *   userPrincipalName: 'andrea@powertechsystems.eu'
 *   location.countryOrRegion: 'FR'
 *   ipAddress: '2a05:6e02:1029:be10:...'
 *
 * For aggregated foreign-login alerts (one alert per user+country+day),
 * the aggregator picks one representative event into raw_data, so the
 * signal still resolves cleanly.
 *
 * @param {object} rawData
 * @returns {{upn: string|null, country: string|null, ip: string|null}}
 */
function extractSignal(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    return { upn: null, country: null, ip: null };
  }

  // Walk the canonical sign-in shape first; fall through to common
  // alternative locations the codebase uses for non-sign-in alerts.
  const upn = rawData.userPrincipalName
    || rawData.upn
    || rawData.user
    || (rawData.signIn && rawData.signIn.userPrincipalName)
    || null;

  const country = (rawData.location && rawData.location.countryOrRegion)
    || rawData.countryOrRegion
    || rawData.country
    || null;

  const ip = rawData.ipAddress
    || rawData.ip
    || (rawData.signIn && rawData.signIn.ipAddress)
    || null;

  return {
    upn: upn ? String(upn).toLowerCase() : null,
    country: country ? String(country).toUpperCase() : null,
    ip: ip ? String(ip) : null,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────

function ipMatchesCidr(ip, cidr) {
  // Best-effort with ipaddr.js when available.
  if (ipaddr) {
    try {
      const addr = ipaddr.parse(ip);
      const [rangeAddr, prefix] = cidr.includes('/')
        ? ipaddr.parseCIDR(cidr)
        : [ipaddr.parse(cidr), null];
      if (prefix === null) {
        // Operator wrote a bare IP — exact match
        return addr.toNormalizedString() === rangeAddr.toNormalizedString();
      }
      return addr.match([rangeAddr, prefix]);
    } catch (_) { /* fall through */ }
  }
  // Fallback: exact string match. Strips the /32 or /128 if present so
  // a rule of "1.2.3.4/32" still matches signal "1.2.3.4".
  const bare = cidr.split('/')[0];
  return ip === bare;
}

const _asnWarned = new Set();
function logAsnUnsupportedOnce(ruleId) {
  if (_asnWarned.has(ruleId)) return;
  _asnWarned.add(ruleId);
  console.warn(`[AlertExemptionMatcher] Rule ${ruleId} has match_asn set but ASN enrichment is not yet wired — rule will not match. (Warned once per process.)`);
}

module.exports = {
  findMatchingRule,
  findMatchingDefenderTypeRule,
  findMatchingPolicyRule,
  recordRuleMatch,
  extractSignal,
};
