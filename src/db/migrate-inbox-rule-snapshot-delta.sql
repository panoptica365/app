-- ═══════════════════════════════════════════════════════
-- Panoptica — Inbox Rule + External Forwarding: Audit → Snapshot-Delta
-- Migration date: 2026-04-17
-- ═══════════════════════════════════════════════════════
--
-- The four policies below were originally wired to query /auditLogs/directoryAudits
-- for Exchange events (Set-Mailbox, New-InboxRule, Set-InboxRule, Remove-InboxRule).
-- Those events are NOT in directoryAudits — they live in the Office 365 Unified
-- Audit Log (Management Activity API), which requires Audit Premium. Result:
-- the four policies silently returned empty arrays every poll and never fired
-- alerts, despite appearing active in the UI.
--
-- This migration rewires them to snapshot-delta detection on the existing
-- mail_forwarding data fetched by fetchMailForwarding() (Graph endpoint
-- /users/{id}/mailFolders/inbox/messageRules), paired with new evaluators
-- evaluateInboxRuleCreated / evaluateInboxRuleModified / evaluateExternalForwardingNew
-- in alert-engine.js.
--
-- Safe to run multiple times. UPDATE by name catches any duplicate rows created
-- by the historical INSERT in both seed-policies.sql and migrate-advanced-detection.sql.
-- ═══════════════════════════════════════════════════════

USE panoptica;

-- External forwarding rule creation: audit → snapshot delta on externalRules subset.
-- Severity left at 'medium' — bump later if customer tenants block tenant-level
-- auto-forward and any rule appearing means higher-signal event.
UPDATE alert_policies
SET detection_logic = JSON_OBJECT(
      'delta_query', TRUE,
      'delta_source', 'mail_forwarding.externalRules',
      'delta_type', 'created',
      'threshold_type', 'any_new'
    ),
    enabled = TRUE
WHERE name = 'External forwarding rule creation';

-- Inbox rule created: snapshot delta on all enabled rules.
UPDATE alert_policies
SET detection_logic = JSON_OBJECT(
      'delta_query', TRUE,
      'delta_source', 'mail_forwarding.allRules',
      'delta_type', 'created',
      'threshold_type', 'any_new'
    ),
    enabled = TRUE
WHERE name = 'Inbox rule created';

-- Inbox rule modified: snapshot delta on action hashes. The evaluator filters
-- noise by only alerting when the NEW actions include forward/redirect/delete/move —
-- benign edits (renames, condition-only changes, enable/disable cycles) are
-- skipped. delta_type='modified' is the discriminator in evaluateChangeDetection.
UPDATE alert_policies
SET detection_logic = JSON_OBJECT(
      'delta_query', TRUE,
      'delta_source', 'mail_forwarding.allRules',
      'delta_type', 'modified',
      'threshold_type', 'any_new'
    ),
    enabled = TRUE
WHERE name = 'Inbox rule modified';

-- Inbox rule deleted: snapshot delta on disappearances from allRules.
-- Reversed 2026-04-18: previously soft-disabled on 2026-04-17. Decision revised —
-- insight into rule deletions IS valuable (cleanup of malicious rules, covering
-- tracks). Signal-to-noise tradeoff handled by keeping severity=info + notification
-- target=none by default: dashboard-only, no email. Flip notification_target via
-- UI to opt in to email alerts later.
--
-- Caveat: allRules only snapshots ENABLED rules (see fetchMailForwarding). A user
-- disabling a rule without deleting it will also trigger this alert. Evaluator
-- message says "deleted or disabled" to reflect this.
UPDATE alert_policies
SET detection_logic = JSON_OBJECT(
      'delta_query', TRUE,
      'delta_source', 'mail_forwarding.allRules',
      'delta_type', 'deleted',
      'threshold_type', 'any_new'
    ),
    enabled = TRUE
WHERE name = 'Inbox rule deleted';
