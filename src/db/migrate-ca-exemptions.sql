-- ═══════════════════════════════════════════════════════════════
-- Panoptica — CA Exemption-Aware Alert Suppression (Phase 1)
-- Migration date: 2026-04-18
-- ═══════════════════════════════════════════════════════════════
--
-- Purpose: generalize CA exclusion awareness so that accepted exemptions
-- (users/groups in conditions.users.excludeUsers / excludeGroups) suppress
-- dependent alert evaluators — replacing the one-off Tatum/Alexandre
-- false-positive behaviour with a reusable per-control-dimension model.
--
-- What this migration does:
--   1. Creates ca_exemptions table — current-state registry of active
--      exemption grants (principal, expiry, accepted_by, etc.).
--   2. Creates alerts_suppressed table — audit trail for every alert that
--      *would* have fired but was skipped due to an active exemption.
--   3. Adds control_dimensions to ca_templates — template declares which
--      control dimensions it enforces (e.g. ["block_geographic_access"]).
--      NOTE: control_dimensions is populated by the Node classifier
--      (src/lib/ca-policy-classifier.js) invoked via
--      scripts/classify-ca-templates.js. This migration only adds the
--      column. No name-LIKE heuristics.
--   4. Extends ca_drift_log.drift_type ENUM to include drift_accepted and
--      exemption lifecycle events (code already attempts to write
--      'drift_accepted', currently silently failing on the ENUM constraint).
--   5. Adds excludeUsers / excludeGroups to monitored_fields on every
--      existing CA template so exemption-list changes produce drift alerts.
--   6. Tags the foreign-login alert_policy row with
--      depends_on_controls: ["block_geographic_access"] so the evaluator
--      knows which control dimension moots the alert for exempted users.
--
-- Safe to run multiple times.
--
-- ─── Superseded note (2026-04-20) ──────────────────────────────
-- The original shipment used name-LIKE template tagging (e.g. '%Canada
-- only%'). That coupled behavior to the policy's displayName, which is
-- wrong: behavior must derive from the policy JSON structure. The
-- name-LIKE blocks have been removed. The Node classifier + backfill
-- script (scripts/classify-ca-templates.js) is the sole source of truth
-- for control_dimensions.
-- ═══════════════════════════════════════════════════════════════

USE panoptica;

-- ─── 1. ca_exemptions — current-state registry ─────────────────
-- One row per (assignment, principal) exemption grant. Revocation sets
-- revoked_at so the row becomes inert without losing history. Expiry is
-- enforced at query time (expires_at > NOW()) and by the nightly cron.
CREATE TABLE IF NOT EXISTS ca_exemptions (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id     INT UNSIGNED NOT NULL,
  -- 'user' = direct UPN exemption (conditions.users.excludeUsers)
  -- 'group' = group membership expansion (conditions.users.excludeGroups)
  principal_type    ENUM('user', 'group') NOT NULL,
  -- Entra directoryObject id (user objectId or group objectId)
  principal_id      VARCHAR(128) NOT NULL,
  -- Denormalized for readability in UI / audit (displayName + UPN for users,
  -- displayName for groups). Refreshed opportunistically, not authoritative.
  principal_label   VARCHAR(512),
  -- Why this exemption was granted (free-text, required at accept time)
  reason            TEXT,
  expires_at        DATETIME NOT NULL,
  accepted_by       VARCHAR(255) NOT NULL,
  accepted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- When revoked (manually or by expiry cron). NULL = active.
  revoked_at        DATETIME,
  revoked_by        VARCHAR(255),
  revoke_reason     VARCHAR(64),  -- 'manual', 'expired', 'removed_from_policy'
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES ca_assignments(id) ON DELETE CASCADE,
  INDEX idx_assignment_active (assignment_id, revoked_at, expires_at),
  INDEX idx_expiry (expires_at, revoked_at),
  UNIQUE KEY uq_active_principal (assignment_id, principal_type, principal_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 2. alerts_suppressed — audit trail for suppressed fires ──
-- Every time an evaluator drops an alert row because the target UPN sits in
-- an active exemption's effective set, we append here. Critical for
-- post-incident forensics ("why didn't we get paged for X?").
CREATE TABLE IF NOT EXISTS alerts_suppressed (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         INT UNSIGNED NOT NULL,
  policy_id         INT UNSIGNED NOT NULL,
  -- The evaluator's logical endpoint (e.g. 'foreignLogin', 'inboxRuleCreated')
  evaluator         VARCHAR(64) NOT NULL,
  -- The would-be target
  upn               VARCHAR(255),
  -- Which exemption suppressed it
  exemption_id      INT UNSIGNED NOT NULL,
  assignment_id     INT UNSIGNED NOT NULL,
  control_dimension VARCHAR(64) NOT NULL,
  -- Optional: first ~200 chars of the raw event body for context
  event_snippet     VARCHAR(512),
  suppressed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (exemption_id) REFERENCES ca_exemptions(id) ON DELETE CASCADE,
  INDEX idx_tenant_time (tenant_id, suppressed_at),
  INDEX idx_policy_time (policy_id, suppressed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 3. ca_templates.control_dimensions ────────────────────────
-- JSON array of strings. Each string is a logical control dimension this
-- template's policy enforces (e.g. "block_geographic_access"). Policy-level
-- evaluators declare the reverse direction via detection_logic.depends_on_controls.
DROP PROCEDURE IF EXISTS __add_ca_templates_control_dimensions;
DELIMITER $$
CREATE PROCEDURE __add_ca_templates_control_dimensions()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ca_templates'
      AND COLUMN_NAME = 'control_dimensions'
  ) THEN
    ALTER TABLE ca_templates
      ADD COLUMN control_dimensions JSON NULL AFTER monitored_fields;
  END IF;
END$$
DELIMITER ;
CALL __add_ca_templates_control_dimensions();
DROP PROCEDURE IF EXISTS __add_ca_templates_control_dimensions;

-- ─── 4. ca_drift_log.drift_type ENUM extension ─────────────────
-- The Phase 10 accept-drift endpoint (api-ca.js:1646) writes 'drift_accepted'
-- into this column, but the original ENUM only covered the detection-side
-- values. The INSERT has been swallowed by `.catch(() => {})` since Phase 10.
-- Extending the ENUM makes the audit row actually land.
-- Also add exemption lifecycle values for the new accept-as-exemption path.
ALTER TABLE ca_drift_log MODIFY COLUMN drift_type ENUM(
  'field_changed',
  'policy_disabled',
  'policy_missing',
  'policy_deleted',
  'remediated',
  'drift_accepted',
  'exemption_granted',
  'exemption_revoked',
  'exemption_expired'
) NOT NULL;

-- ─── 5. Backfill excludeUsers / excludeGroups into monitored_fields ──
-- Three idempotent steps:
--   (a) templates with NULL monitored_fields get a sensible default,
--   (b) append excludeUsers if not already present,
--   (c) append excludeGroups if not already present.
-- JSON_ARRAY_APPEND is the simplest tool here — no merge, no null pollution.

-- (a) Seed defaults for any template missing monitored_fields entirely.
UPDATE ca_templates
SET monitored_fields = JSON_ARRAY('state', 'grantControls.builtInControls')
WHERE monitored_fields IS NULL;

-- (b) Append excludeUsers path if missing.
UPDATE ca_templates
SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeUsers')
WHERE JSON_CONTAINS(monitored_fields, '"conditions.users.excludeUsers"') = 0;

-- (c) Append excludeGroups path if missing.
UPDATE ca_templates
SET monitored_fields = JSON_ARRAY_APPEND(monitored_fields, '$', 'conditions.users.excludeGroups')
WHERE JSON_CONTAINS(monitored_fields, '"conditions.users.excludeGroups"') = 0;

-- ─── 6. Tag the foreign-login policy with its control dependency ───
-- Evaluator reads detection_logic.depends_on_controls at runtime — any UPN
-- exempted on a template classified as 'block_geographic_access' is
-- filtered out of the foreign-login fire list. (Previously this migration
-- set the dimension to 'block_geographic_access'; renamed 2026-04-20.)
UPDATE alert_policies
SET detection_logic = JSON_SET(
  detection_logic,
  '$.depends_on_controls',
  JSON_ARRAY('block_geographic_access')
)
WHERE name = 'Foreign login (non-compliant device)'
  AND (JSON_EXTRACT(detection_logic, '$.depends_on_controls') IS NULL
       OR JSON_CONTAINS(JSON_EXTRACT(detection_logic, '$.depends_on_controls'),
                        '"block_geographic_access"') = 0);

-- ─── 7. (Removed 2026-04-20) ──────────────────────────────────────
-- Template tagging by name-LIKE pattern has been removed. The Node
-- classifier (src/lib/ca-policy-classifier.js) is now the sole source of
-- truth for ca_templates.control_dimensions. For an existing DB, run:
--   node scripts/classify-ca-templates.js
-- For fresh installs, tagging happens automatically as templates are
-- imported via the hook in src/routes/api-ca.js.
