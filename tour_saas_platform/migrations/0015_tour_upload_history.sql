-- ============================================================
-- 360 Tour SaaS — Durable per-ZIP upload history
-- Migration: 0015_tour_upload_history
-- ============================================================
--
-- One row per upload / re-upload / resume attempt.
-- Survives re-uploads so Tour view History can show the full report
-- (stages, progress, success / failed / warning, errors).
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_upload_history (
  id                   TEXT PRIMARY KEY,
  tour_id              TEXT NOT NULL REFERENCES tours(id),
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

CREATE INDEX IF NOT EXISTS idx_tour_upload_history_tour
  ON tour_upload_history(tour_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_upload_history_session
  ON tour_upload_history(upload_session_id);

CREATE INDEX IF NOT EXISTS idx_tour_upload_history_active
  ON tour_upload_history(tour_id, status);
