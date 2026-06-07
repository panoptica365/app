-- Panoptica365 — Learn feature: per-user lesson view tracking
--
-- REFERENCE ONLY. This table is created idempotently at boot by
-- ensureLearnSchema() in src/routes/api-learn.js (project convention
-- #89: schema lives in the module that owns it, run on startup — Jacques
-- does not run manual SQL scripts). This file documents the shape.
--
-- lesson_id format: "<topic-slug>/<lesson-slug>", e.g.
--   "identity-threats-and-attack-patterns/mfa-fatigue"
-- Stable as long as topic directories / lesson files aren't renamed.
--
-- user_id references panoptica.users(id) (INT UNSIGNED). No FK constraint —
-- keeps boot ordering independent of users-store and matches the optional-FK
-- latitude in the spec.

CREATE TABLE IF NOT EXISTS user_lesson_views (
  user_id   INT UNSIGNED NOT NULL,
  lesson_id VARCHAR(255) NOT NULL,
  viewed_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, lesson_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
