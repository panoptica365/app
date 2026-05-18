-- ═══════════════════════════════════════════════════════
-- Panoptica — Hide repurposed telemetry policies from UI
-- (Phase 8b, 2026-04-18)
--
-- The three policies below are functionally retired as alerts
-- but their rows must remain in alert_policies because:
--   • "Sign-ins blocked by Conditional Access" and "User login
--     failure summary" are repurposed as telemetry feeds for the
--     Daily Activity donut chart (policy_id is the bucket key for
--     daily_event_counts).
--   • "Admin login failures" is superseded by Account lockouts +
--     Admin blocked by Conditional Access; row is kept to preserve
--     FK integrity for any historical alerts.
--
-- They must NOT be toggleable via the admin UI, otherwise a future
-- operator will re-enable them and reintroduce the alert noise that
-- Phase 8 (2026-04-09) was designed to eliminate.
--
-- This migration adds a `hidden_from_ui` column to alert_policies
-- and flags the three rows as hidden. The UI list endpoint
-- (GET /api/alert-policies) filters by hidden_from_ui = 0.
-- All other consumers (telemetry accumulator, report JOINs,
-- morning briefing) continue to see every row.
-- ═══════════════════════════════════════════════════════

USE panoptica;

-- Add column. On a rerun this will fail with "Duplicate column name" —
-- that's expected and safe. Pass --force (-f) to mysql if you want the
-- UPDATE and SELECT below to still execute after a duplicate-column error.
ALTER TABLE alert_policies
  ADD COLUMN hidden_from_ui TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled;

-- Flag the three retired policies as hidden
UPDATE alert_policies
   SET hidden_from_ui = 1
 WHERE name IN (
   'Sign-ins blocked by Conditional Access',
   'User login failure summary',
   'Admin login failures'
 );

-- Sanity check (optional — comment out if your client doesn't support SELECT after UPDATE)
SELECT id, name, enabled, hidden_from_ui
  FROM alert_policies
 WHERE hidden_from_ui = 1
 ORDER BY name;
