-- ============================================================
-- Tour admin master defaults (singleton)
-- Migration: 0019_tour_admin_master
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_admin_master_settings (
  id                        TEXT PRIMARY KEY DEFAULT 'default',
  auto_create_on_tour_create INTEGER NOT NULL DEFAULT 1,
  password_enabled_default  INTEGER NOT NULL DEFAULT 1,
  otp_enabled_default       INTEGER NOT NULL DEFAULT 1,
  default_username_pattern  TEXT NOT NULL DEFAULT 'admin-{tour_id}',
  password_mode             TEXT NOT NULL DEFAULT 'random',
  default_password_hash     TEXT,
  default_country_code      TEXT NOT NULL DEFAULT '+91',
  default_mobile            TEXT,
  is_active_default         INTEGER NOT NULL DEFAULT 1,
  updated_by                TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tour_admin_master_settings (id) VALUES ('default');
