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
