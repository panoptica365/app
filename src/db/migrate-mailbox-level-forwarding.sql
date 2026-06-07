-- ═══════════════════════════════════════════════════════
-- Panoptica — Mailbox-level forwarding (Set-Mailbox -ForwardingSmtpAddress)
-- Migration date: 2026-04-28
-- ═══════════════════════════════════════════════════════
--
-- Companion to the Apr 17 inbox-rule snapshot-delta migration. That work
-- covered per-rule forwarding via Graph /users/{id}/mailFolders/inbox/
-- messageRules. THIS work covers the OTHER vector: mailbox-level forwarding
-- via Set-Mailbox -ForwardingSmtpAddress, which is NOT exposed by Microsoft
-- Graph (verified Apr 28, 2026) and requires Exchange Online PowerShell.
--
-- Cost note: the new fetcher (fetchMailboxLevelForwarding in fetchers.js)
-- runs on the SLOW tier and uses Connect-ExchangeOnline + Get-Mailbox once
-- per cycle per tenant. That's one pwsh cold-connect per tenant per slow
-- cycle, not per-user. ~5-15s per tenant.
--
-- Severity rationale: tenant-level auto-forward to remote domains is blocked
-- on Jacques' fleet via remote-domain config, so a non-empty forwarding
-- address often fails to actually exfil mail. The SETTING existing still
-- indicates compromise intent, hence severity='high' (not severe). External
-- forwarding gets escalated by the evaluator's external_only knob if used.
--
-- Idempotent: INSERT IGNORE skips the row if name collides with an existing
-- policy. Safe to run repeatedly during deploy.
-- ═══════════════════════════════════════════════════════

USE panoptica;

INSERT IGNORE INTO alert_policies
  (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
VALUES (
  'Mailbox-level forwarding enabled',
  'A user mailbox now has Set-Mailbox -ForwardingSmtpAddress set. Detected via snapshot-delta on Get-Mailbox output. Sibling vector to inbox-rule forwarding — covers the case where forwarding is configured directly on the mailbox rather than via an inbox rule.',
  'risky_signins',
  'high',
  JSON_OBJECT(
    'delta_query', TRUE,
    'delta_source', 'mailbox_forwarding.users',
    'delta_type', 'enabled',
    'threshold_type', 'any_new'
  ),
  'medium',
  TRUE,
  'both'
);
