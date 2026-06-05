-- ═══════════════════════════════════════════════════════
-- Panoptica — MySQL 8.0 Schema
-- Multi-Tenant M365 Monitoring Platform
-- ═══════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS panoptica
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE panoptica;

-- ─── Tenants ───
-- Registered M365 tenant configurations
-- No per-tenant client_id/client_secret — single multi-tenant app handles all
CREATE TABLE IF NOT EXISTS tenants (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(36)  NOT NULL UNIQUE COMMENT 'Azure AD / Entra GUID',
  display_name    VARCHAR(255) NOT NULL,
  psa_name             VARCHAR(255) DEFAULT NULL COMMENT 'Company name in PSA for ticket attribution',
  language        ENUM('en', 'fr', 'es') NOT NULL DEFAULT 'en',
  polling_interval INT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'Minutes — base interval',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  consented_at    DATETIME DEFAULT NULL COMMENT 'When admin consent was granted',
  last_polled_at  DATETIME DEFAULT NULL,
  poll_count      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Cumulative poll cycles (drives slow-tier scheduling). Runtime ensurePollCountColumn() is now a no-op safety net for pre-existing DBs.',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenants_enabled (enabled)
) ENGINE=InnoDB;

-- ─── Alert Policies ───
-- Configurable detection rules (seeded with the 20 AdminDroid policies)
CREATE TABLE IF NOT EXISTS alert_policies (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  category          ENUM('risky_signins', 'threat_mgmt', 'external_sharing',
                         'config_changes', 'permissions', 'info_governance') NOT NULL,
  severity          ENUM('info', 'low', 'medium', 'high', 'severe') NOT NULL DEFAULT 'medium',
  detection_logic   JSON COMMENT 'Thresholds, comparison windows, Graph endpoints',
  polling_tier      ENUM('critical', 'medium', 'low') NOT NULL DEFAULT 'medium' COMMENT '5/15/30 min',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  hidden_from_ui    TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Phase 8b: hide from admin UI policy list (telemetry-only / retired rows)',
  notification_target ENUM('support', 'personal', 'both', 'none') NOT NULL DEFAULT 'both',
  notification_limit INT UNSIGNED DEFAULT 24 COMMENT 'Max emails per day for medium/low',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─── Metric Snapshots ───
-- Point-in-time metric captures from Graph API
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL,
  service       ENUM('entra', 'exchange', 'sharepoint', 'onedrive', 'teams', 'security') NOT NULL,
  metric_name   VARCHAR(255) NOT NULL,
  metric_value  JSON NOT NULL,
  captured_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_snapshots_tenant_service (tenant_id, service),
  INDEX idx_snapshots_captured (captured_at),
  INDEX idx_snapshots_metric (tenant_id, metric_name, captured_at)
) ENGINE=InnoDB;

-- ─── Metric Snapshots — Latest ───
-- One row per (tenant_id, service, metric_name) holding the most recent
-- non-aggregate snapshot. Maintained by storeSnapshot() via INSERT … ON
-- DUPLICATE KEY UPDATE on every poll. Exists so the dashboard's
-- "load latest values" endpoints don't have to GROUP BY + MAX over the
-- full metric_snapshots history (which on a managed tenant polled every
-- 15 min for 90 days is ~430k rows per tenant). daily_agg_* rows are
-- not stored here — they're historical aggregates, not "current state".
CREATE TABLE IF NOT EXISTS metric_snapshots_latest (
  tenant_id     INT UNSIGNED NOT NULL,
  service       ENUM('entra', 'exchange', 'sharepoint', 'onedrive', 'teams', 'security') NOT NULL,
  metric_name   VARCHAR(255) NOT NULL,
  metric_value  JSON NOT NULL,
  captured_at   DATETIME NOT NULL,
  PRIMARY KEY (tenant_id, service, metric_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── Alerts ───
-- Generated alert records
CREATE TABLE IF NOT EXISTS alerts (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED NOT NULL,
  policy_id           INT UNSIGNED NOT NULL,
  severity            ENUM('info', 'low', 'medium', 'high', 'severe') NOT NULL,
  rule_severity       ENUM('info', 'low', 'medium', 'high', 'severe') NULL COMMENT 'Rule verdict at creation time; preserved when AI adjusts severity',
  ai_severity_reason  TEXT NULL COMMENT 'Why AI changed severity (or proposed an upgrade that was not applied)',
  message             TEXT NOT NULL,
  raw_data            JSON,
  ai_analysis_en      TEXT NULL COMMENT 'Claude Haiku/Sonnet output (English)',
  ai_analysis_fr      TEXT NULL COMMENT 'Claude Haiku output (Quebec French)',
  ai_analysis_es      TEXT NULL COMMENT 'Claude Haiku output (neutral Spanish)',
  notes               TEXT COMMENT 'Operator working notes (Quill HTML)',
  status              ENUM('new', 'investigating', 'resolved', 'false_positive') NOT NULL DEFAULT 'new',
  email_sent          BOOLEAN NOT NULL DEFAULT FALSE,
  dedup_key           VARCHAR(512) DEFAULT NULL COMMENT 'Unique condition key for deduplication',
  recurrence_count    INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Times condition detected consecutively',
  is_rollup           TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Operator-created roll-up alert; excluded from all counts/reports',
  rollup_parent_id    BIGINT UNSIGNED DEFAULT NULL COMMENT 'FK alerts.id — set on children merged into a roll-up',
  last_seen_at        DATETIME DEFAULT NULL COMMENT 'Last time condition was detected',
  triggered_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at           DATETIME DEFAULT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_id) REFERENCES alert_policies(id) ON DELETE CASCADE,
  INDEX idx_alerts_tenant_status (tenant_id, status),
  INDEX idx_alerts_severity (severity),
  INDEX idx_alerts_triggered (triggered_at),
  INDEX idx_alerts_dedup (tenant_id, dedup_key, status),
  INDEX idx_alerts_rollup_parent (rollup_parent_id)
) ENGINE=InnoDB;

-- ─── API Health ───
-- Tracks Graph API endpoint health per tenant
CREATE TABLE IF NOT EXISTS api_health (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT UNSIGNED NOT NULL,
  endpoint        VARCHAR(512) NOT NULL,
  status          ENUM('healthy', 'degraded', 'broken') NOT NULL DEFAULT 'healthy',
  last_success_at DATETIME DEFAULT NULL,
  last_failure_at DATETIME DEFAULT NULL,
  failure_count   INT UNSIGNED NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_api_health_tenant_endpoint (tenant_id, endpoint)
) ENGINE=InnoDB;

-- ─── Morning Briefings ───
-- Cached Sonnet-generated daily briefings
-- MSP-wide AI daily briefing, multi-locale (Phase 8, May 2026). The app's
-- ensureBriefingTable() in src/morning-briefing.js is the authoritative
-- definition and migrates older shapes on boot; this mirrors it so a fresh
-- install starts with the correct columns. (Earlier this block defined a
-- `content`/`briefing_date`/`tenant_id` shape that diverged from the app and
-- silently broke daily summaries on fresh Docker installs — fixed v0.1.38.)
CREATE TABLE IF NOT EXISTS morning_briefings (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  summary_en    TEXT NOT NULL,
  summary_fr    TEXT NULL,
  summary_es    TEXT NULL,
  data_snapshot JSON NULL,
  generated_at  DATETIME NOT NULL,
  INDEX idx_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Panoptica365 — SharePoint audit tables (Phase: SharePoint port from Tabula Accessus)
-- Stores audit snapshots of SharePoint document library permissions.

CREATE TABLE IF NOT EXISTS sp_audits (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT UNSIGNED NOT NULL,
  site_id         VARCHAR(512) NOT NULL,
  site_name       VARCHAR(255),
  site_url        VARCHAR(1024),
  drive_id        VARCHAR(255) NOT NULL,
  drive_name      VARCHAR(255) NOT NULL,
  started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME DEFAULT NULL,
  status          ENUM('running','complete','error') NOT NULL DEFAULT 'running',
  folders_scanned INT UNSIGNED NOT NULL DEFAULT 0,
  library_size    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Drive quota used bytes',
  explicit_count  INT UNSIGNED NOT NULL DEFAULT 0,
  progress_json   LONGTEXT COMMENT 'JSON progress snapshot while running',
  result_json     LONGTEXT COMMENT 'Full audit result (baseline + explicit folders)',
  error_message   TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_sp_audits_tenant (tenant_id),
  INDEX idx_sp_audits_drive  (tenant_id, site_id, drive_id),
  INDEX idx_sp_audits_started (tenant_id, started_at DESC)
) ENGINE=InnoDB;
