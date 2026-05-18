-- ─────────────────────────────────────────────────────────────────────────────
-- Panoptica365 — Audit-Only Tenant Mode
-- Adds the `mode` discriminator + audit lifecycle timestamps to the tenants
-- table. Apply manually on the Ubuntu VM:
--   mysql -u root -p panoptica < schema-audit-mode.sql
--
-- Lifecycle for audit_only tenants:
--   Day 0  : created. audit_expires_at = created_at + 14 DAY.
--   Day 14 : nightly job sends "expires in 7 days" email. audit_expiry_warned_at set.
--   Day 21 : nightly job hard-deletes the tenant + cascades all child rows,
--            then sends "tenant deleted, advise customer to revoke Panoptica365
--            enterprise app" email to the operator.
--
-- For managed tenants: mode='managed', audit_expires_at is NULL — no expiry.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN mode ENUM('managed', 'audit_only') NOT NULL DEFAULT 'managed'
    AFTER language,
  ADD COLUMN audit_expires_at DATETIME NULL DEFAULT NULL
    AFTER mode,
  ADD COLUMN audit_expiry_warned_at DATETIME NULL DEFAULT NULL
    AFTER audit_expires_at,
  ADD INDEX idx_tenants_mode (mode),
  ADD INDEX idx_tenants_audit_expires_at (audit_expires_at);

-- Defensive — ensure no existing rows are accidentally audit_only after
-- migration. They shouldn't be (default is 'managed') but belt + suspenders.
UPDATE tenants SET mode = 'managed' WHERE mode IS NULL OR mode = '';
