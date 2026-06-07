-- ═══════════════════════════════════════════════════════
-- Panoptica — Seed Alert Policies
-- The 20 AdminDroid policies mapped to Graph API endpoints
-- ═══════════════════════════════════════════════════════

USE panoptica;

INSERT INTO alert_policies (name, description, category, severity, polling_tier, notification_target, detection_logic) VALUES

-- ─── Risky Sign-ins ───
-- NOTE (Phase 8, 2026-04-09): the aggregate volume policies below are DISABLED for alerting
-- (see the UPDATE block at the bottom of this file). They remain in the table so their
-- policy_id keeps linking rows in daily_event_counts, which now powers the Daily Activity
-- donut charts on the dashboard instead of firing alerts.
-- The track_daily_telemetry flag tells the alert engine to accumulate event counts
-- for these policies even though enabled=FALSE.
('Sign-ins blocked by Conditional Access',
 'Tenant-wide telemetry: daily count of sign-ins blocked by Conditional Access policies. Feeds the Daily Activity donut chart.',
 'risky_signins', 'high', 'medium', 'both',
 '{"endpoint": "/auditLogs/signIns", "filter": "conditionalAccessStatus eq \'failure\'", "threshold_type": "telemetry_only", "track_daily_telemetry": true, "daily_activity_widget": "ca_blocks"}'),

('Impossible travel detections',
 'Risk detections for unlikely travel patterns',
 'risky_signins', 'high', 'medium', 'both',
 '{"endpoint": "/identityProtection/riskDetections", "filter": "riskEventType eq \'impossibleTravel\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Account lockouts',
 'Account lockouts due to incorrect sign-in attempts (per-user brute force detector)',
 'risky_signins', 'severe', 'critical', 'both',
 '{"endpoint": "/auditLogs/signIns", "filter": "status/errorCode eq 50053", "threshold_type": "count_per_user", "threshold_count": 5, "window_minutes": 30}'),

('User login failure summary',
 'Tenant-wide telemetry: daily count of user login failures. Feeds the Daily Activity donut chart.',
 'risky_signins', 'medium', 'medium', 'personal',
 '{"endpoint": "/auditLogs/signIns", "filter": "status/errorCode ne 0", "threshold_type": "telemetry_only", "track_daily_telemetry": true, "daily_activity_widget": "login_failures"}'),

('Admin blocked by Conditional Access',
 'A user in a privileged administrative role was blocked by a Conditional Access policy. Admin logins should succeed; any CA block of an admin UPN is treated as critical.',
 'risky_signins', 'severe', 'critical', 'both',
 '{"endpoint": "/auditLogs/signIns", "filter": "conditionalAccessStatus eq \'failure\'", "admin_only": true, "threshold_type": "any_new", "lookback_minutes": 15}'),

-- ─── Threat Management ───
('Malware after delivery',
 'Malware campaign detected after email delivery',
 'threat_mgmt', 'severe', 'critical', 'both',
 '{"endpoint": "/security/alerts_v2", "filter": "category eq \'Malware\'", "threshold_type": "any_new", "lookback_minutes": 5}'),

('Malware in SharePoint/OneDrive',
 'Malware detected in SharePoint or OneDrive files',
 'threat_mgmt', 'severe', 'critical', 'both',
 '{"endpoint": "/security/alerts_v2", "filter": "category eq \'Malware\' and serviceSource eq \'SharePoint Online\'", "threshold_type": "any_new", "lookback_minutes": 5}'),

-- NOTE (2026-04-17): Rewired from directoryAudits filter (which didn't work —
-- Set-Mailbox events aren't in that log) to snapshot-delta on mail_forwarding.externalRules.
-- See migrate-inbox-rule-snapshot-delta.sql for the migration applied to existing DBs.
('External forwarding rule creation',
 'Creation of email forwarding rule to external address — detected via snapshot comparison of inbox rules',
 'threat_mgmt', 'medium', 'medium', 'both',
 '{"delta_query": true, "delta_source": "mail_forwarding.externalRules", "delta_type": "created", "threshold_type": "any_new"}'),

-- ─── External Sharing ───
('Anonymous link creations',
 'Anonymous sharing links created',
 'external_sharing', 'low', 'low', 'personal',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'SharingSet\'", "check_anonymous": true, "threshold_type": "any_new", "lookback_minutes": 30}'),

-- ─── Configuration Changes ───
('Enterprise application creation',
 'New enterprise application registered',
 'config_changes', 'medium', 'medium', 'both',
 '{"endpoint": "/applications", "delta_query": true, "cross_ref": "/servicePrincipals", "threshold_type": "any_new", "lookback_minutes": 15}'),

-- depends_on_controls declares that any user exempted (via ca_exemptions) on
-- a template tagged with control_dimensions including 'require_mfa' should
-- be filtered out of the fire list. Consumed by evaluateMfaDisabled.
('MFA disabled users',
 'Users with MFA disabled detected',
 'config_changes', 'high', 'critical', 'both',
 '{"endpoint": "/reports/authenticationMethods/userRegistrationDetails", "check_mfa_disabled": true, "threshold_type": "any_new", "lookback_minutes": 5, "depends_on_controls": ["require_mfa"]}'),

('User password changes',
 'User password change detected',
 'config_changes', 'high', 'medium', 'personal',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Change user password\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

('User license changes',
 'User license assignment or removal',
 'config_changes', 'info', 'low', 'none',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Change user license\'", "threshold_type": "any_new", "lookback_minutes": 30}'),

-- ─── Permissions & Governance ───
('Global admin privilege elevation',
 'User elevated to Global Administrator role',
 'permissions', 'high', 'critical', 'both',
 '{"endpoint": "/directoryRoles", "role_template_id": "62e90394-69f5-4237-9190-012177145e10", "delta_query": true, "threshold_type": "any_new", "lookback_minutes": 5}'),

('External user addition',
 'Guest user added to tenant',
 'permissions', 'low', 'low', 'personal',
 '{"endpoint": "/users", "filter": "userType eq \'Guest\'", "delta_query": true, "threshold_type": "any_new", "lookback_minutes": 30}'),

('Unusual file deletion volume',
 'Unusual volume of file deletions detected',
 'info_governance', 'severe', 'critical', 'both',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'FileDeleted\'", "threshold_type": "volume_spike", "baseline_window_hours": 168, "spike_multiplier": 3}'),

-- ─── Email Threat Protection (EOP / Defender for Office 365) ───
('Inbound malware blocked',
 'Inbound email containing malware was blocked by Exchange Online Protection',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"endpoint": "emailThreats", "filter_threat_type": "Malware", "filter_direction": "Inbound", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Inbound phishing blocked',
 'Inbound phishing email was blocked or junked by Exchange Online Protection',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"endpoint": "emailThreats", "filter_threat_type": "Phish", "filter_direction": "Inbound", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Inbound spam blocked',
 'Inbound spam email was blocked or junked by Exchange Online Protection',
 'threat_mgmt', 'low', 'low', 'none',
 '{"endpoint": "emailThreats", "filter_threat_type": "Spam", "filter_direction": "Inbound", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Email threat volume spike',
 'Unusual volume of blocked email threats — possible targeted campaign',
 'threat_mgmt', 'high', 'medium', 'both',
 '{"endpoint": "emailThreats", "filter_direction": "Inbound", "threshold_type": "volume_spike", "baseline_window_hours": 168, "spike_multiplier": 3, "min_count": 10}'),

-- ─── Advanced Threat Detection ───
-- allowed_countries is intentionally absent. The evaluator derives the set
-- from the tenant's live CA policies that classify as block_geographic_access
-- (see src/lib/ca-policy-classifier.js + src/lib/named-location-resolver.js).
-- Operator can override by setting allowed_countries explicitly.
-- depends_on_controls: any user exempted on a template classified as
-- block_geographic_access is filtered out. Consumed by the foreign-login
-- branch in src/alert-engine.js.
('Foreign login (non-compliant device)',
 'Successful sign-in from outside allowed countries on a non-compliant or unmanaged device',
 'risky_signins', 'high', 'medium', 'both',
 '{"endpoint": "foreignLogin", "exclude_compliant_devices": true, "successful_only": true, "threshold_type": "any_new", "lookback_minutes": 15, "depends_on_controls": ["block_geographic_access"]}'),

('OAuth consent grant',
 'User or admin granted OAuth permissions to an application — potential consent phishing attack',
 'config_changes', 'info', 'medium', 'none',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Consent to application\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Inbox rule created',
 'New inbox rule created — attackers use rules to auto-forward or hide emails',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'New-InboxRule\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

('Inbox rule modified',
 'Existing inbox rule was modified',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Set-InboxRule\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

-- NOTE (2026-04-18): Detection rewired to snapshot-delta on mail_forwarding.allRules
-- (matches Created/Modified evaluators). Previous directoryAudits-based detection
-- never fired because Remove-InboxRule events aren't in that log (Management
-- Activity API / Audit Premium only). Also: allRules only snapshots ENABLED rules,
-- so disabling a rule is indistinguishable from deletion at this layer — policy
-- stays severity=info + notification_target=none so it's a dashboard-only signal.
('Inbox rule deleted',
 'Inbox rule was deleted or disabled — may indicate cleanup of malicious rules or covering tracks. Dashboard-only (no email) by default; flip notification_target to enable alerts.',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"delta_query": true, "delta_source": "mail_forwarding.allRules", "delta_type": "deleted", "threshold_type": "any_new"}'),

('Suspicious risk detection',
 'Medium or high risk detection from Entra ID Protection (anomalous token, unfamiliar sign-in properties, etc.)',
 'risky_signins', 'medium', 'medium', 'personal',
 '{"endpoint": "/identityProtection/riskDetections", "min_risk_level": "medium", "exclude_event_types": ["impossibleTravel"], "threshold_type": "any_new", "lookback_minutes": 15}'),

('Admin role assignment',
 'User assigned to a privileged administrative role (including Global Administrator)',
 'permissions', 'high', 'critical', 'both',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Add member to role\'", "role_names": ["Global Administrator", "Exchange Administrator", "SharePoint Administrator", "Security Administrator", "Privileged Role Administrator", "User Administrator", "Intune Administrator", "Teams Administrator", "Compliance Administrator", "Application Administrator", "Cloud Application Administrator", "Authentication Administrator", "Billing Administrator", "Helpdesk Administrator"], "threshold_type": "any_new", "lookback_minutes": 15}'),

('Conditional Access policy changed',
 'A Conditional Access policy was created, modified, or deleted — critical security configuration change',
 'config_changes', 'high', 'medium', 'both',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "conditional access policy", "threshold_type": "any_new", "lookback_minutes": 15}');

-- ─── Phase 8 (2026-04-09) — Disable aggregate volume policies ───
-- ─── Phase 8b (2026-04-18) — Hide retired policies from admin UI ───
-- These fired every poll on ambient activity and created alert noise.
-- CA blocks and login failures are now surfaced via Daily Activity donut charts
-- (ambient telemetry) instead of alerts. The rows remain enabled=FALSE so the
-- alert engine's telemetry accumulator still counts events against policy_id
-- for the donut data, but no alerts are created.
--
-- hidden_from_ui = TRUE keeps them out of the admin UI policy list so they
-- can't be accidentally re-enabled (which would reintroduce the exact alert
-- noise Phase 8 eliminated).
UPDATE alert_policies SET enabled = FALSE, hidden_from_ui = TRUE
 WHERE name IN (
   'Sign-ins blocked by Conditional Access',
   'User login failure summary'
 );
