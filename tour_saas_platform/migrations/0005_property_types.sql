-- ============================================================
-- Property classification master data (3-level hierarchy)
-- Migration: 0005_property_types
-- ============================================================
--
-- Hierarchy:
--   property_types
--     └── property_sub_types (FK property_type_id)
--           └── property_sub_sub_types (FK property_sub_type_id)
--
-- Soft-delete via deleted_at. Deletes are blocked in the service layer
-- when active children exist (prefer soft protection over cascade).
-- ============================================================

CREATE TABLE IF NOT EXISTS property_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_types_slug
  ON property_types(slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_types_status
  ON property_types(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_types_sort
  ON property_types(sort_order, name) WHERE deleted_at IS NULL;


CREATE TABLE IF NOT EXISTS property_sub_types (
  id               TEXT PRIMARY KEY,
  property_type_id TEXT NOT NULL REFERENCES property_types(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  slug             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_sub_types_parent
  ON property_sub_types(property_type_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_sub_types_slug_parent
  ON property_sub_types(property_type_id, slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_sub_types_sort
  ON property_sub_types(property_type_id, sort_order, name) WHERE deleted_at IS NULL;


CREATE TABLE IF NOT EXISTS property_sub_sub_types (
  id                   TEXT PRIMARY KEY,
  property_sub_type_id TEXT NOT NULL REFERENCES property_sub_types(id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  slug                 TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_sub_sub_types_parent
  ON property_sub_sub_types(property_sub_type_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_sub_sub_types_slug_parent
  ON property_sub_sub_types(property_sub_type_id, slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_property_sub_sub_types_sort
  ON property_sub_sub_types(property_sub_type_id, sort_order, name)
  WHERE deleted_at IS NULL;


-- ============================================================
-- SEED: property_type_* permissions (covers full hierarchy module)
-- Naming follows resource_action + _edit (not _update)
-- Admin-only master data — not granted to role_user / role_customer
-- ============================================================
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_property_type_view',   'property_type_view',   'web'),
  ('perm_property_type_create', 'property_type_create', 'web'),
  ('perm_property_type_edit',   'property_type_edit',   'web'),
  ('perm_property_type_delete', 'property_type_delete', 'web');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN (
  'property_type_view',
  'property_type_create',
  'property_type_edit',
  'property_type_delete'
);
