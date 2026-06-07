-- ═══════════════════════════════════════════════════════
-- Panoptica — Re-enable "Inbox rule deleted" policy
-- Migration date: 2026-04-18
-- ═══════════════════════════════════════════════════════
--
-- On 2026-04-17 the "Inbox rule deleted" policy was soft-disabled
-- (migrate-inbox-rule-snapshot-delta.sql) on the reasoning that legitimate
-- user cleanup dominates the signal.
--
-- On 2026-04-18 that decision was reversed. Insight into rule deletions
-- IS valuable (detecting attacker cleanup of cover-up rules, users
-- disabling security-relevant rules). The noise tradeoff is handled by:
--   • severity=info
--   • notification_target='none' (dashboard-only, no email)
-- Operator can opt in to email later by flipping notification_target
-- to 'personal' or 'both' via the admin UI.
--
-- Prereq: the code path for delta_type='deleted' in evaluateChangeDetection
-- must be deployed (see evaluateInboxRuleDeleted in alert-engine.js).
-- Without it, setting enabled=TRUE is harmless — the evaluator dispatch
-- falls through to [] and no alerts are generated.
--
-- Safe to run multiple times. UPDATE is idempotent.
-- ═══════════════════════════════════════════════════════

USE panoptica;

UPDATE alert_policies
SET detection_logic = JSON_OBJECT(
      'delta_query', TRUE,
      'delta_source', 'mail_forwarding.allRules',
      'delta_type', 'deleted',
      'threshold_type', 'any_new'
    ),
    enabled = TRUE,
    description = 'Inbox rule was deleted or disabled — may indicate cleanup of malicious rules or covering tracks. Dashboard-only (no email) by default; flip notification_target to enable alerts.'
WHERE name = 'Inbox rule deleted';

-- Sanity check
SELECT id, name, enabled, notification_target, severity,
       JSON_EXTRACT(detection_logic, '$.delta_type') AS delta_type
  FROM alert_policies
 WHERE name = 'Inbox rule deleted';
