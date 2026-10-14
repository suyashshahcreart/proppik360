-- ============================================================
-- Property categories: optional icon identifier
-- Migration: 0012_property_category_icon
--
-- Stores icon reference as TEXT, e.g.:
--   lucide:Building2
--   url:https://cdn.example.com/icon.svg
--   custom:fa-solid fa-home
--   media:{uuid}
-- ============================================================

ALTER TABLE property_categories ADD COLUMN icon TEXT;
