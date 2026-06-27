/**
 * Panoptica — Alert Exemption Rules API
 *
 * Operator-defined, pattern-based per-policy auto-resolve rules for noise
 * reduction on Risky Sign-in (and future) detectors. Companion to the
 * M365-mirrored ca_exemptions framework — see
 * src/db/migrate-alert-exemption-rules.sql for the why-not-extend rationale.
 *
 * Endpoints (mounted at /api/alert-exemptions in server.js):
 *
 *   POST   /                      — create a rule (typically pre-filled
 *                                   from an open alert via the slideout)
 *   GET    /?tenant_id=&policy_id= — list active rules (filters optional)
 *   GET    /:id                   — fetch a single rule + match telemetry
 *   DELETE /:id                   — soft-revoke (sets revoked_at);
 *                                   includes ?reason=manual|expired param.
 *
 * Lifecycle invariants:
 *   - expires_at is always required at create. No "never expire" — Apr 2026
 *     product decision; the renewal moment is the design feature.
 *   - reason is always required at create.
 *   - Revoke is soft (revoked_at IS NOT NULL); historical rows preserved
 *     for audit. Hard delete is intentionally not exposed.
 *
 * Audit trail:
 *   - Tenant Change Log: alert_exemption_apply / alert_exemption_revoke
 *     written via change-log.logPanopticaChange. Picks IDENTITY surface so
 *     the row joins the per-tenant timeline alongside other identity events.
 *   - MSP audit: skipped here intentionally. tenant_change_events covers
 *     the per-tenant audit (which is the load-bearing one for forensics).
 *     msp-audit is for platform-level operator actions (login, RBAC,
 *     settings, template CRUD) — alert exemption is a tenant-scoped action.
 */

'use strict';

const express = require('express');
const auth = require('../auth');
const db = require('../db/database');
const changeLog = require('../change-log');

const router = express.Router();
router.use(auth.requireAuth);

// ─── Validation helpers ──────────────────────────────────────────────

const ALLOWED_DURATIONS = [30, 90, 180]; // days — must match modal dropdown

function validateUpn(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function validateCountry(s) {
  if (!s) return null;
  const upper = String(s).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function validateCidr(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  // Light validation only — allow plain IP or CIDR. Defer real CIDR
  // semantics to the matcher (ipaddr.js if installed, exact-string fallback).
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  // Reject obvious nonsense: must contain at least one digit and at most one slash
  if (!/[0-9a-fA-F]/.test(trimmed)) return null;
  if ((trimmed.match(/\//g) || []).length > 1) return null;
  return trimmed;
}

function actorFor(req) {
  return (req.session?.user?.email) || 'unknown@panoptica';
}

// ─── POST / — create rule ────────────────────────────────────────────
// A3 (May 9, 2026): operator — alert exemption rule creation.
router.post('/', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    // Jun 26, 2026 — Defender alert-type exception (operator "Create exception"
    // button on Microsoft Defender alerts, #7/#23). Distinct shape from the
    // UPN-keyed risky-sign-in rule: keyed on the Defender alert TYPE, scoped to
    // one tenant or fleet-wide, and permanent (no duration). Routed first so it
    // never trips the UPN validation below.
    if (req.body && req.body.policy_exemption) {
      return await createPolicyException(req, res);
    }
    if (req.body && typeof req.body.match_alert_type === 'string' && req.body.match_alert_type.trim()) {
      return await createDefenderTypeException(req, res);
    }

    const {
      tenant_id,
      policy_id,
      match_upn,
      match_country,
      match_ip_cidr,
      match_asn,
      reason,
      duration_days,
      source_alert_id,
    } = req.body || {};

    // Required fields
    const tenantId = parseInt(tenant_id, 10);
    const policyId = parseInt(policy_id, 10);
    if (!Number.isFinite(tenantId) || !Number.isFinite(policyId)) {
      return res.status(400).json({ error: 'tenant_id and policy_id are required integers' });
    }
    const upn = validateUpn(match_upn);
    if (!upn) return res.status(400).json({ error: 'match_upn must be a valid lowercase UPN' });
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'reason is required' });
    }
    const reasonClamped = String(reason).slice(0, 1000);

    const days = parseInt(duration_days, 10);
    if (!ALLOWED_DURATIONS.includes(days)) {
      return res.status(400).json({
        error: `duration_days must be one of ${ALLOWED_DURATIONS.join(', ')}`,
      });
    }

    // Optional narrow keys
    const country = match_country ? validateCountry(match_country) : null;
    if (match_country && !country) {
      return res.status(400).json({ error: 'match_country must be a valid 2-letter country code' });
    }
    const ipCidr = match_ip_cidr ? validateCidr(match_ip_cidr) : null;
    if (match_ip_cidr && !ipCidr) {
      return res.status(400).json({ error: 'match_ip_cidr must be a valid IP or CIDR' });
    }
    const asn = match_asn ? String(match_asn).trim().slice(0, 32) : null;

    // Verify tenant + policy exist (and that policy_id is a real alert_policies row)
    const tenant = await db.queryOne(
      'SELECT id, display_name FROM tenants WHERE id = ?',
      [tenantId]
    );
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });

    const policy = await db.queryOne(
      'SELECT id, name FROM alert_policies WHERE id = ?',
      [policyId]
    );
    if (!policy) return res.status(404).json({ error: 'alert policy not found' });

    // mysql2 rejects Date objects in pool.execute — pass an ISO string.
    // UTC throughout: server clock is local but expires_at comparison in
    // matcher uses UTC_TIMESTAMP().
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    const actor = actorFor(req);

    // db.insert returns the new insertId; db.execute returns affectedRows only
    // (so the previous insertId extraction here always yielded null, leaving
    // the source alert's resolution_rule_id unlinked). Fixed Jun 26, 2026.
    const ruleId = await db.insert(
      `INSERT INTO alert_exemption_rules
        (tenant_id, policy_id, match_upn, match_country, match_ip_cidr, match_asn,
         reason, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, policyId, upn, country, ipCidr, asn, reasonClamped, expiresAt, actor]
    );

    // ─── Tenant Change Log row (audit trail) ──────────────────────────
    // Surface = identity (these rules are sign-in / risky-sign-in scoped).
    // If we extend to non-identity policies later, callers should pass
    // the surface; for now hardcoding is fine since the only consumer is
    // the Risky Sign-in alert family.
    const matchSummary = [
      `UPN: ${upn}`,
      country ? `country: ${country}` : null,
      ipCidr  ? `ip: ${ipCidr}`  : null,
      asn     ? `asn: ${asn}`    : null,
    ].filter(Boolean).join(', ');

    await changeLog.logPanopticaChange({
      tenantId,
      category: changeLog.CATEGORY.ALERT_EXEMPTION_APPLY,
      surfaces: [changeLog.SURFACE.IDENTITY],
      description: `Alert exemption rule created — policy "${policy.name}" — ${matchSummary} — expires ${expiresAt.slice(0, 10)} — reason: ${reasonClamped.slice(0, 200)}`,
      templateKey: 'alert_exemption.apply',
      templateParams: { policyName: policy.name, matchUpn: matchSummary, expiresAt: expiresAt.slice(0, 10), reason: reasonClamped.slice(0, 200) },
      createdBy: actor,
      ...changeLog.captureActorContext(req),
    }).catch(e => {
      // Log loudly but never fail the create on audit-write failure — the
      // rule is already in the DB at this point.
      console.error('[AlertExemptions] change-log write failed (rule still created):', e.message);
    });

    // Optionally: immediately resolve the source alert that prompted this
    // exemption. The slideout passes source_alert_id so the operator
    // doesn't have to manually mark the current alert resolved.
    if (source_alert_id && Number.isFinite(parseInt(source_alert_id, 10))) {
      try {
        await db.execute(
          `UPDATE alerts
              SET status             = 'resolved',
                  resolution_reason  = 'exemption_rule',
                  resolution_rule_id = ?,
                  closed_at          = NOW(),
                  notes              = CONCAT(COALESCE(notes, ''),
                                             '\n[', NOW(), '] Resolved by alert exemption rule #', ?, ': ', ?)
            WHERE id          = ?
              AND tenant_id   = ?
              AND status IN ('new', 'investigating')`,
          [ruleId, ruleId, reasonClamped.slice(0, 500), parseInt(source_alert_id, 10), tenantId]
        );
      } catch (e) {
        console.warn('[AlertExemptions] source-alert resolve failed (non-fatal):', e.message);
      }
    }

    res.status(201).json({
      id: ruleId,
      tenant_id: tenantId,
      policy_id: policyId,
      match_upn: upn,
      match_country: country,
      match_ip_cidr: ipCidr,
      match_asn: asn,
      reason: reasonClamped,
      expires_at: expiresAt,
      created_by: actor,
    });
  } catch (err) {
    console.error('[AlertExemptions] POST failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET / — list rules ──────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { tenant_id, policy_id, include_revoked } = req.query;

    const clauses = [];
    const params = [];
    if (tenant_id) {
      const tid = parseInt(tenant_id, 10);
      if (!Number.isFinite(tid)) return res.status(400).json({ error: 'invalid tenant_id' });
      clauses.push('r.tenant_id = ?');
      params.push(tid);
    }
    if (policy_id) {
      const pid = parseInt(policy_id, 10);
      if (!Number.isFinite(pid)) return res.status(400).json({ error: 'invalid policy_id' });
      clauses.push('r.policy_id = ?');
      params.push(pid);
    }
    if (!include_revoked) {
      clauses.push('r.revoked_at IS NULL');
      // NULL expires_at = permanent (Defender-type rules) — keep those active.
      clauses.push('(r.expires_at IS NULL OR r.expires_at > UTC_TIMESTAMP())');
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    const rows = await db.queryRows(
      `SELECT r.id,
              r.tenant_id,
              tn.display_name AS tenant_name,
              r.policy_id,
              p.name          AS policy_name,
              p.category      AS policy_category,
              r.match_upn,
              r.match_country,
              r.match_ip_cidr,
              r.match_asn,
              r.match_alert_type,
              r.all_tenants,
              r.reason,
              r.expires_at,
              TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), r.expires_at) AS days_remaining,
              r.created_by,
              r.created_at,
              r.revoked_at,
              r.revoked_by,
              r.revoke_reason,
              r.match_count,
              r.last_matched_at
         FROM alert_exemption_rules r
         JOIN tenants        tn ON tn.id = r.tenant_id
         LEFT JOIN alert_policies p ON p.id = r.policy_id
         ${where}
         ORDER BY r.revoked_at IS NULL DESC, r.expires_at ASC`,
      params
    );

    res.json({ rules: rows });
  } catch (err) {
    console.error('[AlertExemptions] GET list failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id — single rule ──────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const row = await db.queryOne(
      `SELECT r.*,
              tn.display_name AS tenant_name,
              p.name          AS policy_name,
              p.category      AS policy_category
         FROM alert_exemption_rules r
         JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN alert_policies p ON p.id = r.policy_id
        WHERE r.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'rule not found' });

    res.json({ rule: row });
  } catch (err) {
    console.error('[AlertExemptions] GET single failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id — soft revoke ───────────────────────────────────────
// A3 (May 9, 2026): operator — revoke alert exemption rule.
router.delete('/:id', auth.requireMemberOrAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const reasonStr = (req.query.reason || req.body?.reason || 'manual')
      .toString().slice(0, 64);

    // Fetch first so we can build the audit description AND fail clean if
    // the row is already revoked.
    const rule = await db.queryOne(
      `SELECT r.id, r.tenant_id, r.policy_id, r.match_upn, r.match_country,
              r.match_alert_type, r.all_tenants,
              r.revoked_at, p.name AS policy_name, tn.display_name AS tenant_name
         FROM alert_exemption_rules r
         JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN alert_policies p ON p.id = r.policy_id
        WHERE r.id = ?`,
      [id]
    );
    if (!rule) return res.status(404).json({ error: 'rule not found' });
    if (rule.revoked_at) {
      return res.status(409).json({ error: 'rule already revoked', revoked_at: rule.revoked_at });
    }

    const actor = actorFor(req);
    // Describe whichever rule kind this is: Defender alert-type, or UPN.
    const matchDesc = rule.match_alert_type
      ? `type "${rule.match_alert_type}"${rule.all_tenants ? ' (all tenants)' : ''}`
      : `UPN ${rule.match_upn}${rule.match_country ? ' / ' + rule.match_country : ''}`;

    await db.execute(
      `UPDATE alert_exemption_rules
          SET revoked_at    = UTC_TIMESTAMP(),
              revoked_by    = ?,
              revoke_reason = ?
        WHERE id = ?`,
      [actor, reasonStr, id]
    );

    await changeLog.logPanopticaChange({
      tenantId: rule.tenant_id,
      category: changeLog.CATEGORY.ALERT_EXEMPTION_REVOKE,
      surfaces: [changeLog.SURFACE.IDENTITY],
      description: `Alert exemption rule revoked — policy "${rule.policy_name}" — ${matchDesc} — reason: ${reasonStr}`,
      templateKey: 'alert_exemption.revoke',
      templateParams: { policyName: rule.policy_name, matchUpn: matchDesc },
      createdBy: actor,
      ...changeLog.captureActorContext(req),
    }).catch(e => {
      console.error('[AlertExemptions] revoke change-log write failed:', e.message);
    });

    res.json({ ok: true, id, revoked_at: new Date().toISOString() });
  } catch (err) {
    console.error('[AlertExemptions] DELETE failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Policy-level exception (create) ─────────────────────────────────
// Jun 27, 2026 (#7/#23). Operator clicks "Create exception" on a noisy EOP
// email-threat alert (Inbound spam/malware/phish blocked). Each class is its
// own policy, so we silence the WHOLE policy ("this category entirely"),
// scoped to this tenant or fleet-wide. We:
//   1. Insert a permanent (no-expiry) rule with NO narrower match keys
//      (match_upn / match_alert_type both NULL) — the alert engine reads it via
//      findMatchingPolicyRule and auto-resolves future matches.
//   2. Immediately resolve currently-open alerts of that policy (scoped) so the
//      existing noise drops to history right away.
// Safe by construction: a different category is a different policy_id, so this
// can never suppress outbound spam or a different threat class.
async function createPolicyException(req, res) {
  const { tenant_id, policy_id, all_tenants, reason, source_alert_id } = req.body || {};

  const tenantId = parseInt(tenant_id, 10);
  const policyId = parseInt(policy_id, 10);
  if (!Number.isFinite(tenantId) || !Number.isFinite(policyId)) {
    return res.status(400).json({ error: 'tenant_id and policy_id are required integers' });
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return res.status(400).json({ error: 'reason is required' });
  }
  const reasonClamped = String(reason).slice(0, 1000);
  const fleetWide = all_tenants === true || all_tenants === 1
    || all_tenants === '1' || all_tenants === 'true';

  const tenant = await db.queryOne('SELECT id, display_name FROM tenants WHERE id = ?', [tenantId]);
  if (!tenant) return res.status(404).json({ error: 'tenant not found' });
  const policy = await db.queryOne('SELECT id, name FROM alert_policies WHERE id = ?', [policyId]);
  if (!policy) return res.status(404).json({ error: 'alert policy not found' });

  const actor = actorFor(req);

  // Guard: don't let two identical active policy rules pile up for the same
  // scope (e.g. operator double-clicks, or one already exists fleet-wide).
  // Block if an active rule already covers this create: a fleet-wide rule
  // covers everything; otherwise a tenant rule for this same tenant. (A new
  // fleet-wide rule is still allowed to supersede narrower tenant rules.)
  const existing = await db.queryOne(
    `SELECT id FROM alert_exemption_rules
      WHERE policy_id = ? AND match_upn IS NULL AND match_alert_type IS NULL
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
        AND (all_tenants = 1 OR (? = 0 AND tenant_id = ?))
      LIMIT 1`,
    [policyId, fleetWide ? 1 : 0, tenantId]
  );
  if (existing) {
    return res.status(409).json({ error: 'an active exception already covers this policy and scope', id: existing.id });
  }

  // expires_at NULL = permanent until manually revoked. db.insert returns id.
  const ruleId = await db.insert(
    `INSERT INTO alert_exemption_rules
       (tenant_id, policy_id, all_tenants, reason, expires_at, created_by)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [tenantId, policyId, fleetWide ? 1 : 0, reasonClamped, actor]
  );

  // Resolve currently-open alerts of this policy (scoped) to history.
  let resolvedCount = 0;
  try {
    const scopeClause = fleetWide ? '' : ' AND a.tenant_id = ?';
    const params = [ruleId, ruleId, reasonClamped.slice(0, 500), policyId];
    if (!fleetWide) params.push(tenantId);
    resolvedCount = await db.execute(
      `UPDATE alerts a
          SET a.status             = 'resolved',
              a.resolution_reason  = 'exemption_rule',
              a.resolution_rule_id = ?,
              a.closed_at          = NOW(),
              a.notes              = CONCAT(COALESCE(a.notes, ''),
                                           '\n[', NOW(), '] Resolved by alert exemption rule #', ?, ': ', ?)
        WHERE a.policy_id = ?
          AND a.status IN ('new', 'investigating')
          ${scopeClause}`,
      params
    ) || 0;
    if (ruleId && resolvedCount > 0) {
      await db.execute(
        'UPDATE alert_exemption_rules SET match_count = match_count + ?, last_matched_at = UTC_TIMESTAMP() WHERE id = ?',
        [resolvedCount, ruleId]
      ).catch(() => {});
    }
  } catch (e) {
    console.warn('[AlertExemptions] Policy-level bulk resolve failed (rule still created):', e.message);
  }

  const scopeLabel = fleetWide ? 'all managed tenants' : tenant.display_name;
  await changeLog.logPanopticaChange({
    tenantId,
    category: changeLog.CATEGORY.ALERT_EXEMPTION_APPLY,
    surfaces: [changeLog.SURFACE.IDENTITY],
    description: `Policy exception created — policy "${policy.name}" — scope: ${scopeLabel} — permanent — reason: ${reasonClamped.slice(0, 200)}`,
    templateKey: 'alert_exemption.apply',
    templateParams: { policyName: policy.name, matchUpn: `entire policy (${scopeLabel})`, expiresAt: 'permanent', reason: reasonClamped.slice(0, 200) },
    createdBy: actor,
    ...changeLog.captureActorContext(req),
  }).catch(e => {
    console.error('[AlertExemptions] Policy-level change-log write failed (rule still created):', e.message);
  });

  return res.status(201).json({
    id: ruleId,
    tenant_id: tenantId,
    policy_id: policyId,
    all_tenants: fleetWide ? 1 : 0,
    reason: reasonClamped,
    expires_at: null,
    created_by: actor,
    resolved_count: resolvedCount,
  });
}

// ─── Defender alert-type exception (create) ──────────────────────────
// Jun 26, 2026 (#7/#23). Operator clicks "Create exception" on a noisy
// Microsoft-already-handled inbound Defender alert. We:
//   1. Insert a permanent (no-expiry) rule keyed on the alert TYPE, scoped to
//      this tenant or fleet-wide. The alert engine's createOrUpdateAlert reads
//      it (findMatchingDefenderTypeRule) and auto-resolves FUTURE matches.
//   2. Immediately resolve any currently-open alerts of that type (scoped) so
//      the existing noise drops to history right away.
// policy_id is the Defender policy the alert belongs to (carried from the
// slideout); the matcher doesn't filter on it, but the column is NOT NULL and
// it keeps the rule joinable to the policy in the management UI.
async function createDefenderTypeException(req, res) {
  const {
    tenant_id,
    policy_id,
    match_alert_type,
    all_tenants,
    reason,
    source_alert_id,
  } = req.body || {};

  const tenantId = parseInt(tenant_id, 10);
  const policyId = parseInt(policy_id, 10);
  if (!Number.isFinite(tenantId) || !Number.isFinite(policyId)) {
    return res.status(400).json({ error: 'tenant_id and policy_id are required integers' });
  }

  const alertType = String(match_alert_type).trim().slice(0, 255);
  if (!alertType) return res.status(400).json({ error: 'match_alert_type is required' });

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return res.status(400).json({ error: 'reason is required' });
  }
  const reasonClamped = String(reason).slice(0, 1000);

  // Coerce a variety of truthy representations the client might send.
  const fleetWide = all_tenants === true || all_tenants === 1
    || all_tenants === '1' || all_tenants === 'true';

  const tenant = await db.queryOne('SELECT id, display_name FROM tenants WHERE id = ?', [tenantId]);
  if (!tenant) return res.status(404).json({ error: 'tenant not found' });
  const policy = await db.queryOne('SELECT id, name FROM alert_policies WHERE id = ?', [policyId]);
  if (!policy) return res.status(404).json({ error: 'alert policy not found' });

  const actor = actorFor(req);

  // expires_at NULL = permanent until manually revoked (product decision).
  // db.insert returns the new insertId (db.execute returns affectedRows only).
  const ruleId = await db.insert(
    `INSERT INTO alert_exemption_rules
       (tenant_id, policy_id, match_alert_type, all_tenants, reason, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [tenantId, policyId, alertType, fleetWide ? 1 : 0, reasonClamped, actor]
  );

  // Resolve currently-open alerts of this type (scoped). Match the type out of
  // raw_data (JSON column) case-insensitively. Only touch active alerts so we
  // never re-close something an operator already triaged to false_positive.
  let resolvedCount = 0;
  try {
    const scopeClause = fleetWide ? '' : ' AND a.tenant_id = ?';
    const params = [
      ruleId, ruleId, reasonClamped.slice(0, 500), policyId, alertType,
    ];
    if (!fleetWide) params.push(tenantId);
    // db.execute returns affectedRows directly.
    resolvedCount = await db.execute(
      `UPDATE alerts a
          SET a.status             = 'resolved',
              a.resolution_reason  = 'exemption_rule',
              a.resolution_rule_id = ?,
              a.closed_at          = NOW(),
              a.notes              = CONCAT(COALESCE(a.notes, ''),
                                           '\n[', NOW(), '] Resolved by alert exemption rule #', ?, ': ', ?)
        WHERE a.policy_id = ?
          AND a.status IN ('new', 'investigating')
          AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(a.raw_data, '$.defender_alert_type'))) = LOWER(?)
          ${scopeClause}`,
      params
    ) || 0;
    if (ruleId && resolvedCount > 0) {
      // Reflect the back-fill in the rule's match telemetry.
      await db.execute(
        'UPDATE alert_exemption_rules SET match_count = match_count + ?, last_matched_at = UTC_TIMESTAMP() WHERE id = ?',
        [resolvedCount, ruleId]
      ).catch(() => {});
    }
  } catch (e) {
    console.warn('[AlertExemptions] Defender-type bulk resolve failed (rule still created):', e.message);
  }

  const scopeLabel = fleetWide ? 'all managed tenants' : tenant.display_name;
  await changeLog.logPanopticaChange({
    tenantId,
    category: changeLog.CATEGORY.ALERT_EXEMPTION_APPLY,
    surfaces: [changeLog.SURFACE.IDENTITY],
    description: `Defender alert exception created — type "${alertType}" — scope: ${scopeLabel} — permanent — reason: ${reasonClamped.slice(0, 200)}`,
    templateKey: 'alert_exemption.apply',
    templateParams: { policyName: policy.name, matchUpn: `type: ${alertType} (${scopeLabel})`, expiresAt: 'permanent', reason: reasonClamped.slice(0, 200) },
    createdBy: actor,
    ...changeLog.captureActorContext(req),
  }).catch(e => {
    console.error('[AlertExemptions] Defender-type change-log write failed (rule still created):', e.message);
  });

  return res.status(201).json({
    id: ruleId,
    tenant_id: tenantId,
    policy_id: policyId,
    match_alert_type: alertType,
    all_tenants: fleetWide ? 1 : 0,
    reason: reasonClamped,
    expires_at: null,
    created_by: actor,
    resolved_count: resolvedCount,
  });
}

module.exports = router;
