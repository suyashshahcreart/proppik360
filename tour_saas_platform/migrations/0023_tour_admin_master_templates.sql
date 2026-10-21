-- ============================================================
-- Multiple tour-admin master templates + multi admins per tour
-- Migration: 0023_tour_admin_master_templates
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_admin_master_templates (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  username_pattern  TEXT NOT NULL DEFAULT 'admin-{tour_id}',
  password_mode     TEXT NOT NULL DEFAULT 'random',
  password_hash     TEXT,
  country_code      TEXT NOT NULL DEFAULT '+91',
  mobile            TEXT,
  password_enabled  INTEGER NOT NULL DEFAULT 1,
  otp_enabled       INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tour_admin_master_templates_sort
  ON tour_admin_master_templates(sort_order, label);

-- Seed one template from existing singleton master settings (if any)
INSERT OR IGNORE INTO tour_admin_master_templates (
  id, label, username_pattern, password_mode, password_hash,
  country_code, mobile, password_enabled, otp_enabled, is_active, sort_order
)
SELECT
  'tmpl_default',
  'Default admin',
  COALESCE(default_username_pattern, 'admin-{tour_id}'),
  COALESCE(password_mode, 'random'),
  default_password_hash,
  COALESCE(default_country_code, '+91'),
  default_mobile,
  COALESCE(password_enabled_default, 1),
  COALESCE(otp_enabled_default, 1),
  COALESCE(is_active_default, 1),
  0
FROM tour_admin_master_settings
WHERE id = 'default';

-- Ensure at least one template exists
INSERT OR IGNORE INTO tour_admin_master_templates (
  id, label, username_pattern, password_mode, country_code,
  password_enabled, otp_enabled, is_active, sort_order
) VALUES (
  'tmpl_default', 'Default admin', 'admin-{tour_id}', 'random', '+91', 1, 1, 1, 0
);

-- Rebuild tour_admins: allow multiple admins per tour (unique username within tour)
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS tour_admins_new (
  id               TEXT PRIMARY KEY,
  tour_id          TEXT NOT NULL REFERENCES tours(tour_id),
  username         TEXT NOT NULL,
  password_hash    TEXT,
  country_code     TEXT NOT NULL DEFAULT '+91',
  mobile           TEXT,
  password_enabled INTEGER NOT NULL DEFAULT 1,
  otp_enabled      INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  source           TEXT NOT NULL DEFAULT 'manual',
  last_login_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tour_id, username)
);

INSERT INTO tour_admins_new (
  id, tour_id, username, password_hash, country_code, mobile,
  password_enabled, otp_enabled, is_active, source, last_login_at, created_at, updated_at
)
SELECT
  id, tour_id, username, password_hash, country_code, mobile,
  password_enabled, otp_enabled, is_active, source, last_login_at, created_at, updated_at
FROM tour_admins;

DROP TABLE tour_admins;
ALTER TABLE tour_admins_new RENAME TO tour_admins;

CREATE INDEX IF NOT EXISTS idx_tour_admins_username ON tour_admins(username);
CREATE INDEX IF NOT EXISTS idx_tour_admins_tour ON tour_admins(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_admins_mobile ON tour_admins(tour_id, mobile);

PRAGMA foreign_keys=ON;
