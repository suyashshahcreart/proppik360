-- ============================================================
-- Media Library
-- Migration: 0004_media_library
-- ============================================================
--
-- Implements a real generic media library (media + media_links)
-- as specified in docs/laravel-media-library-for-refence.md.
--
-- Key design decisions:
--   - Store R2 object key only; URL built at read time
--   - media_links is polymorphic (entity_type + entity_id + collection)
--   - Singleton collections: one active link per (entity_type, entity_id, collection)
--   - Orphan policy: when last link removed, delete R2 object + media row
--   - Supported collections for this project:
--       tour_thumbnail | tour_logo | tour_assets
--       customer_profile | customer_cover | customer_seo
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,           -- R2 object key; URL built at read time
  disk          TEXT NOT NULL DEFAULT 'r2',
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,               -- bytes
  checksum      TEXT,                           -- SHA-256 hex
  original_name TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_links (
  id          TEXT PRIMARY KEY,
  media_id    TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                    -- 'tour' | 'customer'
  entity_id   TEXT NOT NULL,
  collection  TEXT NOT NULL,                    -- see collection enum in validation.ts
  sort        INTEGER NOT NULL DEFAULT 0,
  meta_json   TEXT,                             -- optional slot / alt / fileName metadata
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_media_created_by   ON media(created_by);
CREATE INDEX IF NOT EXISTS idx_media_created_at   ON media(created_at);
CREATE INDEX IF NOT EXISTS idx_media_links_media  ON media_links(media_id);
CREATE INDEX IF NOT EXISTS idx_media_links_entity ON media_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_media_links_col    ON media_links(entity_type, entity_id, collection);


-- ============================================================
-- SEED: media_view, media_upload, media_delete permissions
-- (same names as the BrokerX reference stub)
-- ============================================================
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_media_view',   'media_view',   'web'),
  ('perm_media_upload', 'media_upload', 'web'),
  ('perm_media_delete', 'media_delete', 'web');

-- Admin gets all (consistent with existing "auto-attach new perm to admin" rule)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN ('media_view', 'media_upload', 'media_delete');

-- Regular user gets all media permissions (consistent with tour_* / customer_*
-- being fully granted to user role — users manage media on their own entities)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_user', id FROM permissions
WHERE name IN ('media_view', 'media_upload', 'media_delete');

-- role_customer gets none (zero-permission pattern preserved)
