-- ============================================================
-- Per-tour admin credentials (one row per tour_id in v1)
-- Migration: 0020_tour_admins
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_admins (
  id               TEXT PRIMARY KEY,
  tour_id          TEXT NOT NULL UNIQUE REFERENCES tours(tour_id),
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
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tour_admins_username ON tour_admins(username);
CREATE INDEX IF NOT EXISTS idx_tour_admins_mobile ON tour_admins(tour_id, mobile);
