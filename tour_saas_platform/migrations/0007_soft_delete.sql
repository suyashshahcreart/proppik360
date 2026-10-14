-- ============================================================
-- 360 Tour SaaS — Soft delete support
-- Migration: 0007_soft_delete
-- ============================================================
--
-- Adds deleted_at to tours table.
-- Soft-deleted tours are hidden from all listings but the record
-- and its audit trail are preserved.
-- ============================================================

ALTER TABLE tours ADD COLUMN deleted_at TEXT;
