-- ============================================================
-- Tour admin OTP requests + sessions (public API)
-- Migration: 0022_tour_admin_auth
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_admin_otp_requests (
  id               TEXT PRIMARY KEY,
  tour_id          TEXT NOT NULL REFERENCES tours(tour_id),
  tour_admin_id    TEXT NOT NULL REFERENCES tour_admins(id) ON DELETE CASCADE,
  mobile           TEXT NOT NULL,
  otp_hash         TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  msg91_request_id TEXT,
  verified_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tour_admin_otp_tour
  ON tour_admin_otp_requests(tour_id, mobile);

CREATE TABLE IF NOT EXISTS tour_admin_sessions (
  id            TEXT PRIMARY KEY,
  tour_id       TEXT NOT NULL REFERENCES tours(tour_id),
  tour_admin_id TEXT NOT NULL REFERENCES tour_admins(id) ON DELETE CASCADE,
  login_method  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tour_admin_sessions_tour
  ON tour_admin_sessions(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_admin_sessions_admin
  ON tour_admin_sessions(tour_admin_id);
