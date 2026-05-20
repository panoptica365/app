-- ═══════════════════════════════════════════════════════════════
-- Panoptica365 — Security Settings Engine Schema (Phase A1)
--
-- Three tables:
--   security_settings        — Static library. Seeded from the settings
--                              registry (src/lib/security-settings/registry.js)
--                              on boot by ensureSecuritySettingsSeeded().
--   tenant_security_config   — One row per (tenant × setting). Holds both the
--                              current polled value and the Panoptica-applied
--                              baseline. In Phase A applied_value is always
--                              NULL (no Apply/Match UI yet); rows are created
--                              the first time we successfully poll the
--                              setting for that tenant, so the list view can
--                              render Current Value + Last Checked.
--   security_setting_events  — Append-only audit trail. In Phase A the only
--                              event types that get written are `poll_ok` and
--                              `poll_error`. Apply / Match / Drift event types
--                              remain valid in the ENUM but are not emitted
--                              until Phase B.
--
-- Design note — why tenant_security_config carries current_value:
-- The doc says "rows are created on first apply; settings with no row are
-- implicitly not_applied." In Phase A that leaves nowhere to store polled
-- values. Rather than add a second table just for Phase A, we let rows be
-- created on first successful poll with applied_value NULL. That's still
-- "implicitly not_applied" (status column reflects it), the list view can
-- render current_value, and Phase B simply sets applied_value when the
-- operator Applies or Matches.
--
-- Run with: mysql --user=... --database=panoptica < schema-security.sql
-- Idempotent. Safe to re-run. Drops nothing.
-- ═══════════════════════════════════════════════════════════════

-- ─── Static library of settings ───────────────────────────────
-- Populated on boot from the JS registry. Not operator-editable.
-- setting_id is the canonical string key (e.g. 'EXO-02', 'ENT-07') used
-- everywhere in code and logs. It is NEVER displayed to the MSP operator
-- (per UX decision in Section D.3 of the design doc).
CREATE TABLE IF NOT EXISTS security_settings (
  setting_id          VARCHAR(16)  NOT NULL PRIMARY KEY       COMMENT 'Canonical key, e.g. EXO-02',
  name                VARCHAR(255) NOT NULL                    COMMENT 'Plain-language title shown in the list view',
  category            ENUM('exchange', 'identity', 'sharepoint',
                           'teams', 'defender', 'compliance') NOT NULL,
  priority            ENUM('critical', 'high', 'medium', 'low') NOT NULL,
  poll_strategy       ENUM('graph', 'powershell_exo',
                           'powershell_spo', 'powershell_teams') NOT NULL
                      COMMENT 'graph=readable via Graph API now; powershell_* means awaiting Phase A2 pwsh infra',
  poll_key            VARCHAR(255) NOT NULL
                      COMMENT 'Graph endpoint path OR PowerShell cmdlet expression. Opaque string; interpreted by the fetcher dispatcher.',
  description         TEXT         NOT NULL
                      COMMENT 'One-paragraph summary of what this setting does',
  security_impact     TEXT         NOT NULL
                      COMMENT 'Plain-language "threat story" — shown in Overview modal',
  user_impact         TEXT         NOT NULL
                      COMMENT 'What end users will notice (or not) — shown in Overview modal',
  admin_notes         TEXT         NOT NULL
                      COMMENT 'Pre-apply checks and caveats the operator should review',
  licence_required    VARCHAR(128) DEFAULT NULL
                      COMMENT 'Short licence gate string, e.g. "Entra ID P1", "Intune", "Defender for Business". NULL = no gate.',
  version             INT UNSIGNED NOT NULL DEFAULT 1
                      COMMENT 'Registry schema version — bump when a setting_id changes meaning. Lets migration paths diff new vs. old.',
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_security_settings_category (category),
  INDEX idx_security_settings_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── Per-tenant, per-setting state ────────────────────────────
-- One row per (tenant_id, setting_id) once the setting has been observed
-- at least once for the tenant. Phase A never sets applied_value — all
-- rows will have status='not_applied' after a successful poll, or
-- status='poll_error' after a failed one.
--
-- The status column is derived from (applied_value, current_value,
-- last_check_error) inside updateTenantSecurityConfig(); it is stored
-- denormalized so the list-view query doesn't have to re-compute it for
-- 25 settings × N tenants on every page load.
CREATE TABLE IF NOT EXISTS tenant_security_config (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED NOT NULL,
  setting_id          VARCHAR(16)  NOT NULL,
  status              ENUM('not_applied', 'monitored', 'drift',
                           'pending', 'poll_error', 'unavailable')
                      NOT NULL DEFAULT 'not_applied'
                      COMMENT 'unavailable = licence gate failed (Phase A2+); pending = Apply in flight (Phase B+)',
  applied_value       JSON DEFAULT NULL
                      COMMENT 'Baseline. NULL in Phase A — set by Apply or Match in Phase B.',
  current_value       JSON DEFAULT NULL
                      COMMENT 'Most recent polled value. NULL until first successful poll.',
  applied_at          DATETIME DEFAULT NULL,
  applied_by          VARCHAR(255) DEFAULT NULL
                      COMMENT 'Operator email at time of Apply/Match. Denormalized on purpose.',
  last_checked_at     DATETIME DEFAULT NULL,
  last_check_error    TEXT DEFAULT NULL
                      COMMENT 'Populated when status=poll_error. Cleared on next successful poll.',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id)  REFERENCES tenants(id)          ON DELETE CASCADE,
  FOREIGN KEY (setting_id) REFERENCES security_settings(setting_id) ON DELETE CASCADE,
  UNIQUE KEY uq_tenant_setting (tenant_id, setting_id),
  INDEX idx_tsc_status (status),
  INDEX idx_tsc_last_checked (last_checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── Append-only audit trail ──────────────────────────────────
-- Every state transition on a (tenant × setting) lands here. Feeds the
-- History tab in the per-setting modal and the Unified Audit Timeline on
-- the SYSTEM → Audit Log page. Immutable — no UPDATE/DELETE path in the
-- service layer (matches the rule in src/msp-audit.js).
--
-- Phase A only emits:
--   - poll_ok    on successful poll (NB: we do NOT emit this on every poll
--                — only on status transitions, to avoid log bloat. Rule
--                enforced in the writer, not the schema.)
--   - poll_error on failed poll (emitted on transition into error, not
--                every failed poll; recurrent errors just update
--                tenant_security_config.last_check_error.)
--
-- Phase B will additionally emit: applied, matched, remediated, accepted,
-- drift_detected. These ENUM values exist now so Phase B is a code-only
-- change, no DDL.
CREATE TABLE IF NOT EXISTS security_setting_events (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED NOT NULL,
  setting_id          VARCHAR(16)  NOT NULL,
  event_type          ENUM('applied', 'matched', 'drift_detected',
                           'remediated', 'accepted', 'poll_ok',
                           'poll_error') NOT NULL,
  previous_value      JSON DEFAULT NULL,
  new_value           JSON DEFAULT NULL,
  operator_email      VARCHAR(255) DEFAULT NULL
                      COMMENT 'NULL = automated event (poll, scheduled drift detection).',
  source              ENUM('panoptica', 'operator', 'system') NOT NULL DEFAULT 'system'
                      COMMENT 'panoptica = automated write path; operator = UI action; system = boot/migration/reseed',
  correlation_tag     VARCHAR(64) DEFAULT NULL
                      COMMENT 'Links related rows across a multi-step operation (matches change-log convention).',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id)  REFERENCES tenants(id)          ON DELETE CASCADE,
  FOREIGN KEY (setting_id) REFERENCES security_settings(setting_id) ON DELETE CASCADE,
  INDEX idx_sse_tenant_setting_created (tenant_id, setting_id, created_at DESC),
  INDEX idx_sse_created (created_at),
  INDEX idx_sse_event_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
