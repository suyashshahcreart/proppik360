-- ============================================================
-- MSG91 Flow templates map (BrokerX-style key → template_id)
-- Migration: 0024_msg91_templates
-- ============================================================

-- JSON object: { "login_otp": "abc...", "tour_access_otp": "...", ... }
INSERT OR IGNORE INTO settings (id, name, value) VALUES
  ('set_msg91_templates', 'msg91_templates', '{}'),
  ('set_msg91_timeout_ms', 'msg91_timeout_ms', '30000');
