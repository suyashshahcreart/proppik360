-- ============================================================
-- 360 Tour SaaS — Processor pipeline stage tracking
-- Migration: 0009_processing_stage
-- ============================================================
--
-- Adds processing_stage so the Upload page can show which Go
-- processor step is active (download / extract / upload assets).
--
-- Values (set by Worker + Go processor):
--   queued            — job accepted, waiting for a processor slot
--   downloading       — streaming ZIP from R2 to temp disk
--   extracting        — opening/analyzing ZIP contents
--   uploading_assets  — concurrent file uploads to R2 viewer/
--   finalizing        — building viewer URL / notifying complete
-- ============================================================

ALTER TABLE tours ADD COLUMN processing_stage TEXT;
