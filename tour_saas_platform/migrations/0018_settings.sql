-- ============================================================
-- Flat key-value settings store (BrokerX-style)
-- Migration: 0018_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  value      TEXT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_name ON settings(name);

-- Seed defaults (INSERT OR IGNORE so re-runs are safe)
INSERT OR IGNORE INTO settings (id, name, value) VALUES
  ('set_support_email',           'support_email',           ''),
  ('set_support_phone',           'support_phone',           ''),
  ('set_tour_admin_api_base_url', 'tour_admin_api_base_url', 'http://127.0.0.1:8787/api/tour-admin'),
  ('set_sms_msg91_enabled',       'sms_msg91_enabled',       '0'),
  ('set_msg91_sender_id',         'msg91_sender_id',         ''),
  ('set_msg91_otp_template_id',   'msg91_otp_template_id',   ''),
  ('set_msg91_route',             'msg91_route',             '4'),
  ('set_otp_length',              'otp_length',              '6'),
  ('set_otp_expiry_sec',          'otp_expiry_sec',          '300'),
  ('set_msg91_mock_mode',         'msg91_mock_mode',         '0');
