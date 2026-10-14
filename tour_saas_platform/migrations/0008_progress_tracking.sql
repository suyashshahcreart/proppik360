-- ============================================================
-- 360 Tour SaaS — Go processor progress tracking
-- Migration: 0008_progress_tracking
-- ============================================================
--
-- Adds columns to support live progress reporting from the Go
-- processor back to the Worker, enabling the frontend to show
-- a real-time percentage bar and time-remaining estimate.
--
--   processing_started_at  — ISO 8601 UTC when upload complete set status=processing
--   progress_total_files   — total files Go will upload to R2 (set once at job start)
--   progress_current_files — files uploaded so far (updated ~every 2s)
--   progress_total_bytes   — total uncompressed bytes to upload (set once at job start)
--   progress_current_bytes — bytes uploaded so far (updated ~every 2s)
-- ============================================================

ALTER TABLE tours ADD COLUMN processing_started_at  TEXT;
ALTER TABLE tours ADD COLUMN progress_total_files    INTEGER;
ALTER TABLE tours ADD COLUMN progress_current_files  INTEGER;
ALTER TABLE tours ADD COLUMN progress_total_bytes    INTEGER;
ALTER TABLE tours ADD COLUMN progress_current_bytes  INTEGER;
