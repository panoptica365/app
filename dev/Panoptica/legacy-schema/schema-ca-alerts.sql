-- ═══════════════════════════════════════════════════════
-- Panoptica — CA Drift Alert Integration Migration
-- Adds alert_routing to ca_templates and ca_assignments,
-- and creates system alert policies for drift events.
-- ═══════════════════════════════════════════════════════

-- Add alert_routing to ca_templates (the default for all assignments)
ALTER TABLE ca_templates
  ADD COLUMN alert_routing ENUM('support', 'personal', 'both', 'none') NOT NULL DEFAULT 'both'
  AFTER monitored_fields;

-- Add alert_routing to ca_assignments (nullable = inherit from template)
ALTER TABLE ca_assignments
  ADD COLUMN alert_routing ENUM('support', 'personal', 'both', 'none') DEFAULT NULL
  AFTER enforcement;

-- Insert system alert policies for CA drift events (if not already present)
INSERT IGNORE INTO alert_policies (name, description, category, severity, detection_logic, polling_tier, enabled, notification_target)
VALUES
  ('CA Policy Drift Detected',
   'A conditional access policy has drifted from its expected template configuration.',
   'config_changes', 'high',
   '{"type": "ca_drift", "subtype": "detected"}',
   'medium', TRUE, 'both'),

  ('CA Policy Drift Remediated',
   'A drifted conditional access policy was automatically remediated back to template.',
   'config_changes', 'medium',
   '{"type": "ca_drift", "subtype": "remediated"}',
   'medium', TRUE, 'both');
