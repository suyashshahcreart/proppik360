-- ============================================================
-- 360 Tour SaaS — Go-first ingest sessions
-- Migration: 0013_go_first_upload
-- ============================================================
--
-- Primary upload path is browser → Worker → Go (chunked).
-- R2 ZIP copies are backups under tours/{id}/backup_zip/.
-- Published viewer files live at tours/{id}/ (no viewer/ folder).
--
-- Tour status additions:
--   ingesting  — ZIP chunks streaming to Go
--   completed  — ready + backup verified + Go temp cleaned
-- ============================================================

ALTER TABLE tours ADD COLUMN ready_at TEXT;
ALTER TABLE tours ADD COLUMN backup_completed_at TEXT;
ALTER TABLE tours ADD COLUMN cleanup_completed_at TEXT;
ALTER TABLE tours ADD COLUMN upload_session_id TEXT;

CREATE TABLE IF NOT EXISTS upload_sessions (
  id                 TEXT PRIMARY KEY,
  tour_id            TEXT NOT NULL REFERENCES tours(id),
  original_filename  TEXT NOT NULL,
  file_size          INTEGER NOT NULL,
  chunk_size         INTEGER NOT NULL,
  total_chunks       INTEGER NOT NULL,
  bytes_received     INTEGER NOT NULL DEFAULT 0,
  backup_version     TEXT,
  backup_r2_key      TEXT,
  temp_zip_path      TEXT,
  stage              TEXT NOT NULL,
  error              TEXT,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_tour ON upload_sessions(tour_id);
