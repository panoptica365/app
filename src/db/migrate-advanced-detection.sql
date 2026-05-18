-- ═══════════════════════════════════════════════════════
-- Panoptica — Advanced Threat Detection Policies
-- Run once on live database to add new detection capabilities
-- ═══════════════════════════════════════════════════════

USE panoptica;

INSERT INTO alert_policies (name, description, category, severity, polling_tier, notification_target, detection_logic) VALUES

-- ─── 1. Foreign Login Detection (with compliant device exclusion) ───
('Foreign login (non-compliant device)',
 'Successful sign-in from outside allowed countries on a non-compliant or unmanaged device',
 'risky_signins', 'high', 'medium', 'both',
 '{"endpoint": "foreignLogin", "allowed_countries": ["CA"], "exclude_compliant_devices": true, "successful_only": true, "threshold_type": "any_new", "lookback_minutes": 15}'),

-- ─── 2. Consent Grant Attacks ───
('OAuth consent grant',
 'User or admin granted OAuth permissions to an application — potential consent phishing attack',
 'config_changes', 'info', 'medium', 'none',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Consent to application\'", "threshold_type": "any_new", "lookback_minutes": 15}'),

-- ─── 3. Inbox Rule Manipulation ───
-- NOTE (2026-04-17): Rewired from directoryAudits filter to snapshot-delta on
-- mail_forwarding.allRules. See migrate-inbox-rule-snapshot-delta.sql. The "Inbox
-- rule deleted" policy has been soft-disabled (enabled=FALSE) because legitimate
-- user cleanup dominates the signal.
('Inbox rule created',
 'New inbox rule created — attackers use rules to auto-forward or hide emails',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"delta_query": true, "delta_source": "mail_forwarding.allRules", "delta_type": "created", "threshold_type": "any_new"}'),

('Inbox rule modified',
 'Existing inbox rule was modified (action changed to include forwarding, delete, or move-to-folder)',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"delta_query": true, "delta_source": "mail_forwarding.allRules", "delta_type": "modified", "threshold_type": "any_new"}'),

-- Inbox rule deleted: snapshot-delta on disappearances from allRules. Enabled 2026-04-18
-- (previously soft-disabled 2026-04-17 — decision revised). Dashboard-only by default
-- (notification_target=none + severity=info). Note: allRules is enabled-only, so rule
-- disable is indistinguishable from deletion at this layer.
('Inbox rule deleted',
 'Inbox rule was deleted or disabled — may indicate cleanup of malicious rules or covering tracks. Dashboard-only (no email) by default; flip notification_target to enable alerts.',
 'threat_mgmt', 'info', 'medium', 'none',
 '{"delta_query": true, "delta_source": "mail_forwarding.allRules", "delta_type": "deleted", "threshold_type": "any_new"}'),

-- ─── 4. Broadened Risk Detections (anomalous tokens, etc.) ───
('Suspicious risk detection',
 'Medium or high risk detection from Entra ID Protection (anomalous token, unfamiliar sign-in properties, etc.)',
 'risky_signins', 'medium', 'medium', 'personal',
 '{"endpoint": "/identityProtection/riskDetections", "min_risk_level": "medium", "exclude_event_types": ["impossibleTravel"], "threshold_type": "any_new", "lookback_minutes": 15}'),

-- ─── 5. Admin Role Escalation (including Global Admin) ───
('Admin role assignment',
 'User assigned to a privileged administrative role (including Global Administrator)',
 'permissions', 'high', 'critical', 'both',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "activityDisplayName eq \'Add member to role\'", "role_names": ["Global Administrator", "Exchange Administrator", "SharePoint Administrator", "Security Administrator", "Privileged Role Administrator", "User Administrator", "Intune Administrator", "Teams Administrator", "Compliance Administrator", "Application Administrator", "Cloud Application Administrator", "Authentication Administrator", "Billing Administrator", "Helpdesk Administrator"], "threshold_type": "any_new", "lookback_minutes": 15}'),

-- ─── 6. Conditional Access Policy Changes ───
('Conditional Access policy changed',
 'A Conditional Access policy was created, modified, or deleted — critical security configuration change',
 'config_changes', 'high', 'medium', 'both',
 '{"endpoint": "/auditLogs/directoryAudits", "filter": "conditional access policy", "threshold_type": "any_new", "lookback_minutes": 15}');

-- "Inbox rule deleted" soft-disable (2026-04-17) was REVERSED on 2026-04-18.
-- Intentionally no-op UPDATE below to ensure any DB that already ran the
-- original soft-disable gets the row re-enabled on migration replay.
UPDATE alert_policies SET enabled = TRUE WHERE name = 'Inbox rule deleted';
