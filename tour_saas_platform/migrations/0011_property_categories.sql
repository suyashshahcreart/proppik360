-- ============================================================
-- Property classification: recursive hierarchy (unlimited depth)
-- Migration: 0011_property_categories
--
-- Replaces fixed 3-table schema (property_types → property_sub_types
-- → property_sub_sub_types) with a single self-referential table.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES property_categories(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  slug        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  sort_order  INTEGER NOT NULL DEFAULT 0,
  depth       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_categories_parent
  ON property_categories(parent_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_categories_slug_parent
  ON property_categories(COALESCE(parent_id, ''), slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_categories_status
  ON property_categories(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_categories_sort
  ON property_categories(COALESCE(parent_id, ''), sort_order, name) WHERE deleted_at IS NULL;


-- ── Migrate existing 3-level data (if tables exist) ──────────

INSERT OR IGNORE INTO property_categories
  (id, parent_id, name, slug, status, sort_order, depth, created_at, updated_at, deleted_at)
SELECT id, NULL, name, slug, status, sort_order, 0, created_at, updated_at, deleted_at
FROM property_types;

INSERT OR IGNORE INTO property_categories
  (id, parent_id, name, slug, status, sort_order, depth, created_at, updated_at, deleted_at)
SELECT id, property_type_id, name, slug, status, sort_order, 1, created_at, updated_at, deleted_at
FROM property_sub_types;

INSERT OR IGNORE INTO property_categories
  (id, parent_id, name, slug, status, sort_order, depth, created_at, updated_at, deleted_at)
SELECT id, property_sub_type_id, name, slug, status, sort_order, 2, created_at, updated_at, deleted_at
FROM property_sub_sub_types;


-- ── Drop legacy tables ───────────────────────────────────────

DROP TABLE IF EXISTS property_sub_sub_types;
DROP TABLE IF EXISTS property_sub_types;
DROP TABLE IF EXISTS property_types;
