-- ═══════════════════════════════════════════════════════
-- Panoptica — Add Email Threat Protection Policies
-- Run once on live database to add EOP/MDO alert policies
-- ═══════════════════════════════════════════════════════

USE panoptica;

INSERT INTO alert_policies (name, description, category, severity, polling_tier, notification_target, detection_logic) VALUES

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
 '{"endpoint": "emailThreats", "filter_direction": "Inbound", "threshold_type": "volume_spike", "baseline_window_hours": 168, "spike_multiplier": 3, "min_count": 10}');
