-- ============================================================
-- 360 Tour SaaS — Tombstone legacy soft-deleted tour IDs
-- Migration: 0010_tombstone_deleted_tour_ids
-- ============================================================
--
-- Soft-delete now renames tours.id to `{id}-deleted-{YYYYMMDDHHmmss}`
-- so the original slug can be reused on re-upload. Rows soft-deleted
-- before that change still hold the original PK and block INSERT.
--
-- This migration renames those legacy rows and re-points media_links
-- that referenced the old tour id. R2 object keys under tours/{oldId}/
-- are unchanged (delete already purged them, or they remain orphaned
-- under the original prefix — not under the tombstone id).
-- ============================================================

CREATE TABLE IF NOT EXISTS _tombstone_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
);

INSERT INTO _tombstone_map (old_id, new_id)
SELECT
  id,
  id || '-deleted-' ||
    replace(replace(replace(substr(deleted_at, 1, 19), '-', ''), 'T', ''), ':', '')
FROM tours
WHERE deleted_at IS NOT NULL
  AND id NOT LIKE '%-deleted-%'
  AND length(deleted_at) >= 19;

UPDATE media_links
SET entity_id = (
  SELECT new_id FROM _tombstone_map WHERE old_id = media_links.entity_id
)
WHERE entity_type = 'tour'
  AND entity_id IN (SELECT old_id FROM _tombstone_map);

UPDATE tours
SET id = (
  SELECT new_id FROM _tombstone_map WHERE old_id = tours.id
)
WHERE id IN (SELECT old_id FROM _tombstone_map);

DROP TABLE IF EXISTS _tombstone_map;
