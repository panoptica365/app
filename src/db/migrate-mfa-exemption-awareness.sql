-- ════════════════════════════════════════════════════════════════════
-- migrate-mfa-exemption-awareness.sql
--
-- Broadens the CA exemption framework from foreign-login only to also
-- cover the "MFA disabled users" evaluator.
--
-- Context:
--   Phase 1 (migrate-ca-exemptions.sql) wired exemption suppression for
--   the foreign-login evaluator + the block_geographic_access control
--   dimension. A user on excludeUsers of a geography-restricting policy
--   no longer triggers foreign-login alerts. Good.
--
--   This migration extends the same pattern to the MFA-disabled evaluator.
--   A user on excludeUsers of a require-MFA CA policy who has not
--   registered MFA methods will no longer trigger "MFA disabled users"
--   alerts — they are permitted to operate without MFA by policy design.
--
-- Control dimension introduced:
--   require_mfa — enforced by CA policies whose grantControls.builtInControls
--                 includes 'mfa' (or whose grantControls.authenticationStrength
--                 is set — phishing-resistant / passwordless variants).
--
-- Data shape:
--   ca_templates.control_dimensions            JSON array  (inbound tags)
--   alert_policies.detection_logic.depends_on_controls  JSON array (reverse)
--
-- Idempotent: guards against re-application via JSON_CONTAINS checks.
--
-- ─── Superseded note (2026-04-20) ──────────────────────────────────
-- The original shipment also tagged ca_templates.control_dimensions via
-- name-LIKE patterns ('%Require MFA%', '%Multifactor authentication%', etc.).
-- That coupled behavior to the policy's displayName, which is wrong: an
-- MSP can name a policy anything. The template-tagging block has been
-- removed. The Node classifier (src/lib/ca-policy-classifier.js) + backfill
-- script (scripts/classify-ca-templates.js) are the sole source of truth
-- for ca_templates.control_dimensions.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tag the MFA-disabled alert policy with its control dependency ──
-- When evaluateMfaDisabled fires, it reads depends_on_controls from
-- detection_logic at runtime and filters UPNs in the tenant's active
-- exemption set for any of those control dimensions.
UPDATE alert_policies
SET detection_logic = JSON_SET(
  detection_logic,
  '$.depends_on_controls',
  JSON_ARRAY('require_mfa')
)
WHERE name = 'MFA disabled users'
  AND (JSON_EXTRACT(detection_logic, '$.depends_on_controls') IS NULL
       OR JSON_CONTAINS(JSON_EXTRACT(detection_logic, '$.depends_on_controls'),
                        '"require_mfa"') = 0);

-- ─── 2. (Removed 2026-04-20) Template tagging by name-LIKE ────────
-- Name-based heuristics were the wrong approach. See the classifier +
-- backfill script referenced in the header.

-- ─── 3. Back-compatibility: ensure monitored_fields covers excludeUsers ─
-- migrate-ca-exemptions.sql step 5 already did this for all templates, so
-- this is a no-op in normal deployments. Re-stating defensively in case a
-- tenant is applying this migration before the CA exemption one.
UPDATE ca_templates
SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeUsers')
WHERE JSON_CONTAINS(monitored_fields, '"conditions.users.excludeUsers"') = 0;

UPDATE ca_templates
SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeGroups')
WHERE JSON_CONTAINS(monitored_fields, '"conditions.users.excludeGroups"') = 0;

-- ─── 4. Sanity / audit ─────────────────────────────────────────────────
-- Surface what this migration touched — handy when running manually.
SELECT name, JSON_EXTRACT(detection_logic, '$.depends_on_controls') AS depends_on_controls
  FROM alert_policies
 WHERE name = 'MFA disabled users';
