-- ════════════════════════════════════════════════════════════════════
-- Panoptica — Operator-Defined Alert Exemption Rules (Phase 1)
-- Migration date: 2026-04-30
-- ════════════════════════════════════════════════════════════════════
--
-- Purpose: complement the existing CA exemption framework (which mirrors
-- M365 excludeUsers/excludeGroups state) with an operator-defined,
-- pattern-based mechanism for noise reduction on Risky Sign-in detectors
-- and any future per-policy alert evaluator.
--
-- Why not extend ca_exemptions?
--   ca_exemptions is bound to a CA assignment (assignment_id FK) and a
--   directoryObject id (principal_id). Behavior is "if the M365 CA policy
--   excludes this principal AND the policy enforces a control dimension X,
--   then suppress evaluators that depend on X for that principal".
--   That model can't express "suppress alerts for UPN U from country C
--   regardless of which CA carve-out happens to apply" — operators want
--   per-pattern rules decoupled from M365 state.
--
-- Behavior delta vs. ca_exemptions:
--   - ca_exemptions:        suppression at evaluator filter time, no alert row.
--                           Audit trail in alerts_suppressed.
--   - alert_exemption_rules: alert row IS created and immediately resolved
--                           (status='resolved', resolution_reason='exemption_rule',
--                           resolution_rule_id=<rule.id>). Visible in dashboards
--                           with "Show auto-resolved" toggle for forensics.
--                           No email is sent.
--
-- Match key (per rule):
--   tenant_id      — REQUIRED — scoped to a single tenant.
--   policy_id      — REQUIRED — rules are per-policy, not blanket.
--   match_upn      — REQUIRED — exact lowercase match against
--                    raw_data.userPrincipalName (or whichever UPN field the
--                    matcher extracts for the policy).
--   match_country  — OPTIONAL — ISO-2 uppercase. NULL = wildcard.
--   match_ip_cidr  — OPTIONAL — IPv4 or IPv6 CIDR. NULL = wildcard.
--                    Matched via ipaddr.js if installed; otherwise exact-IP fallback.
--   match_asn      — OPTIONAL — RESERVED for future use. We don't currently
--                    enrich sign-in events with ASN, so persisting a non-NULL
--                    value will not match anything until a future ASN-lookup
--                    is wired. Modal will warn operators selecting this.
--
-- Lifecycle:
--   - Operator-driven create via POST /api/alert-exemptions.
--   - Hard expiry at expires_at (no "never expire" — see Apr 2026 product
--     decision: forced renewal moments are the design feature, not friction).
--   - Soft revoke (revoked_at IS NOT NULL) preserves history.
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

USE panoptica;

-- ─── 1. alert_exemption_rules — operator-defined rule registry ────────
CREATE TABLE IF NOT EXISTS alert_exemption_rules (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         INT UNSIGNED NOT NULL,
  policy_id         INT UNSIGNED NOT NULL,
  -- Match keys (NULL = wildcard for that field except match_upn which is required)
  match_upn         VARCHAR(255) NOT NULL COMMENT 'Lowercased UPN; exact match',
  match_country     CHAR(2) DEFAULT NULL COMMENT 'ISO-3166-1 alpha-2, uppercase',
  match_ip_cidr     VARCHAR(64) DEFAULT NULL COMMENT 'IPv4/IPv6 CIDR; matcher uses ipaddr.js if available',
  match_asn         VARCHAR(32) DEFAULT NULL COMMENT 'RESERVED — ASN enrichment not yet wired',
  -- Lifecycle
  reason            TEXT NOT NULL COMMENT 'Operator justification, REQUIRED at create',
  expires_at        DATETIME NOT NULL COMMENT 'Hard expiry — no "never expire"',
  created_by        VARCHAR(255) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Revoke
  revoked_at        DATETIME DEFAULT NULL,
  revoked_by        VARCHAR(255) DEFAULT NULL,
  revoke_reason     VARCHAR(64) DEFAULT NULL COMMENT 'manual | expired',
  -- Match telemetry — operator-visible "this rule auto-resolved N alerts so far"
  match_count       INT UNSIGNED NOT NULL DEFAULT 0,
  last_matched_at   DATETIME DEFAULT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_id) REFERENCES alert_policies(id) ON DELETE CASCADE,
  -- Hot-path lookup index — matcher hits this on every alert insert
  INDEX idx_lookup (tenant_id, policy_id, match_upn, revoked_at, expires_at),
  INDEX idx_expiry (expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── 2. alerts.resolution_reason + resolution_rule_id ─────────────────
-- Adds provenance to the existing alerts table so an auto-resolved row can
-- be distinguished from a manually-resolved one and traced back to the rule
-- that resolved it. Idempotent via INFORMATION_SCHEMA probe.
DROP PROCEDURE IF EXISTS __add_alerts_resolution_columns;
DELIMITER $$
CREATE PROCEDURE __add_alerts_resolution_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'alerts'
      AND COLUMN_NAME = 'resolution_reason'
  ) THEN
    ALTER TABLE alerts
      ADD COLUMN resolution_reason VARCHAR(32) DEFAULT NULL
        COMMENT 'manual | exemption_rule | drift_cleared | etc.'
        AFTER status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'alerts'
      AND COLUMN_NAME = 'resolution_rule_id'
  ) THEN
    ALTER TABLE alerts
      ADD COLUMN resolution_rule_id INT UNSIGNED DEFAULT NULL
        COMMENT 'FK → alert_exemption_rules.id when resolution_reason = exemption_rule'
        AFTER resolution_reason;
  END IF;

  -- FK constraint — separate IF block so the column can be added even on
  -- replicas where alert_exemption_rules creates last in the migration order.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'alerts'
      AND CONSTRAINT_NAME = 'fk_alerts_resolution_rule'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'alert_exemption_rules'
  ) THEN
    ALTER TABLE alerts
      ADD CONSTRAINT fk_alerts_resolution_rule
        FOREIGN KEY (resolution_rule_id)
        REFERENCES alert_exemption_rules(id)
        ON DELETE SET NULL;
  END IF;

  -- Filter index for the dashboard's "Show auto-resolved" toggle.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'alerts'
      AND INDEX_NAME = 'idx_alerts_resolution'
  ) THEN
    ALTER TABLE alerts
      ADD INDEX idx_alerts_resolution (tenant_id, resolution_reason, status);
  END IF;
END$$
DELIMITER ;
CALL __add_alerts_resolution_columns();
DROP PROCEDURE IF EXISTS __add_alerts_resolution_columns;

-- ─── 3. tenant_change_events.category ENUM extension ──────────────────
-- Adds 'alert_exemption_apply' and 'alert_exemption_revoke' so rule
-- create/revoke writes land in the per-tenant Change Log. The existing
-- exemption_apply/revoke values cover CA only — keeping the alert-rule
-- variant distinct so the Tenant Timeline can render the correct icon
-- and surface attribution.
DROP PROCEDURE IF EXISTS __extend_tce_category_alert_exemption;
DELIMITER $$
CREATE PROCEDURE __extend_tce_category_alert_exemption()
BEGIN
  DECLARE col_type TEXT;
  SELECT COLUMN_TYPE INTO col_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_change_events'
      AND COLUMN_NAME = 'category'
    LIMIT 1;
  IF col_type IS NOT NULL AND col_type NOT LIKE '%alert_exemption_apply%' THEN
    -- Append the two new values to the existing ENUM. Other values are kept
    -- as-is — we only widen, never narrow.
    ALTER TABLE tenant_change_events
      MODIFY COLUMN category ENUM(
        'ca_deploy','ca_retire','ca_edit',
        'intune_push','intune_retire','intune_edit',
        'exemption_apply','exemption_revoke',
        'remediation','named_location','named_location_create',
        'alert_status_change','alert_note','ai_severity_revert',
        'enforcement_toggle','tenant_lifecycle',
        'security_setting_change',
        'alert_exemption_apply','alert_exemption_revoke',
        'other'
      ) NOT NULL;
  END IF;
END$$
DELIMITER ;
CALL __extend_tce_category_alert_exemption();
DROP PROCEDURE IF EXISTS __extend_tce_category_alert_exemption;

-- ─── 4. Sanity / audit ────────────────────────────────────────────────
SELECT 'alert_exemption_rules' AS table_name, COUNT(*) AS row_count
  FROM alert_exemption_rules;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'alerts'
   AND COLUMN_NAME IN ('resolution_reason','resolution_rule_id')
 ORDER BY ORDINAL_POSITION;
