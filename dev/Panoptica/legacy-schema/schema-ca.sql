-- ═══════════════════════════════════════════════════════════════
-- Panoptica — Conditional Access Policy Management Schema
-- Run on the panoptica database to add CA tables.
-- ═══════════════════════════════════════════════════════════════

-- ─── CA Policy Templates ───────────────────────────────────────
-- Global library of CA policy templates (imported from JSON exports).
-- Stores the full JSON plus extracted key fields for display.
CREATE TABLE IF NOT EXISTS ca_templates (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  -- The raw CA policy JSON from Entra export (source of truth)
  policy_json     JSON NOT NULL,
  -- Extracted key fields for quick display (denormalized from policy_json)
  state           VARCHAR(32) DEFAULT 'enabled',       -- enabled, disabled, enabledForReportingButNotEnforced
  grant_controls  VARCHAR(512),                         -- e.g. "Require MFA"
  target_users    VARCHAR(512),                         -- e.g. "All users"
  target_apps     VARCHAR(512),                         -- e.g. "All cloud apps"
  conditions_summary VARCHAR(512),                      -- human-readable summary
  -- Which fields in the JSON to monitor for drift (JSON array of dot-paths)
  -- e.g. ["state", "grantControls.builtInControls", "conditions.users.includeUsers"]
  monitored_fields JSON,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── CA Template Assignments ──────────────────────────────────
-- Links a template to a tenant with an enforcement mode.
CREATE TABLE IF NOT EXISTS ca_assignments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id     INT UNSIGNED NOT NULL,
  tenant_id       INT UNSIGNED NOT NULL,
  -- monitor: alert on drift only; remediate: auto-push corrections
  enforcement     ENUM('monitor', 'remediate') DEFAULT 'monitor',
  -- The Graph API policy ID in the target tenant (null if not yet deployed/matched)
  live_policy_id  VARCHAR(128),
  -- Last drift check results
  drift_status    ENUM('ok', 'drifted', 'missing', 'unchecked') DEFAULT 'unchecked',
  drift_details   JSON,
  last_checked_at DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES ca_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_template_tenant (template_id, tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── CA Drift Log ─────────────────────────────────────────────
-- Audit trail of detected drifts and remediations.
CREATE TABLE IF NOT EXISTS ca_drift_log (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id   INT UNSIGNED NOT NULL,
  drift_type      ENUM('field_changed', 'policy_disabled', 'policy_missing', 'policy_deleted', 'remediated') NOT NULL,
  field_path      VARCHAR(255),
  expected_value  TEXT,
  actual_value    TEXT,
  remediated      BOOLEAN DEFAULT FALSE,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES ca_assignments(id) ON DELETE CASCADE,
  INDEX idx_assignment_created (assignment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
