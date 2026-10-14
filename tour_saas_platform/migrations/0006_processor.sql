-- ============================================================
-- 360 Tour SaaS — Processor columns
-- Migration: 0006_processor
-- ============================================================
--
-- Adds three columns to the tours table to support the Go ZIP
-- processor pipeline:
--
--   viewer_url       — public R2 URL to serve the extracted tour
--   processing_error — last error message from the processor
--   processed_at     — ISO 8601 UTC timestamp when processing completed
-- ============================================================

ALTER TABLE tours ADD COLUMN viewer_url       TEXT;
ALTER TABLE tours ADD COLUMN processing_error TEXT;
ALTER TABLE tours ADD COLUMN processed_at     TEXT;
