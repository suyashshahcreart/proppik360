-- ============================================================
-- Phase B: Generic artifact uploads (tour_admin ZIP + history)
-- Migration: 0025_artifact_uploads
-- ============================================================
--
-- Viewer tour ZIP stays on upload_sessions / tour_upload_history.
-- Admin (and future) packages use artifact_* tables + tour_artifacts.
-- Does NOT couple to tours.status.
-- ============================================================

CREATE TABLE IF NOT EXISTS artifact_upload_sessions (
  id                 TEXT PRIMARY KEY,
  tour_id            TEXT NOT NULL REFERENCES tours(tour_id),
  artifact_type      TEXT NOT NULL,
  original_filename  TEXT NOT NULL,
  file_size          INTEGER NOT NULL,
  chunk_size         INTEGER NOT NULL,
  total_chunks       INTEGER NOT NULL,
  bytes_received     INTEGER NOT NULL DEFAULT 0,
  backup_version     TEXT,
  backup_r2_key      TEXT,
  save_backup_zip    INTEGER NOT NULL DEFAULT 0,
  temp_zip_path      TEXT,
  stage              TEXT NOT NULL,
  error              TEXT,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_upload_sessions_tour
  ON artifact_upload_sessions(tour_id, artifact_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_upload_sessions_active
  ON artifact_upload_sessions(tour_id, artifact_type, stage);

CREATE TABLE IF NOT EXISTS artifact_upload_history (
  id                   TEXT PRIMARY KEY,
  tour_id              TEXT NOT NULL REFERENCES tours(tour_id),
  artifact_type        TEXT NOT NULL,
  upload_session_id    TEXT,
  attempt_number       INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL,
  stage                TEXT,
  original_filename    TEXT,
  file_size            INTEGER,
  backup_version       TEXT,
  backup_r2_key        TEXT,
  error_message        TEXT,
  started_at           TEXT NOT NULL,
  finished_at          TEXT,
  duration_ms          INTEGER,
  report_json          TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_upload_history_tour
  ON artifact_upload_history(tour_id, artifact_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_upload_history_session
  ON artifact_upload_history(upload_session_id);

CREATE INDEX IF NOT EXISTS idx_artifact_upload_history_active
  ON artifact_upload_history(tour_id, artifact_type, status);

-- 1:1 pointer per (tour_id, artifact_type) — publish URL / last success
CREATE TABLE IF NOT EXISTS tour_artifacts (
  id                   TEXT PRIMARY KEY,
  tour_id              TEXT NOT NULL REFERENCES tours(tour_id),
  artifact_type        TEXT NOT NULL,
  publish_url          TEXT,
  publish_prefix       TEXT,
  last_upload_at       TEXT,
  last_success_at      TEXT,
  upload_session_id    TEXT,
  backup_r2_key        TEXT,
  backup_version       TEXT,
  status               TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (tour_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS idx_tour_artifacts_tour
  ON tour_artifacts(tour_id);

INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_tour_admin_upload', 'tour_admin_upload', 'web');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name = 'tour_admin_upload';
