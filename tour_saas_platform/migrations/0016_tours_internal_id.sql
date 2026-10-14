-- ============================================================
-- Tours: INTEGER AUTOINCREMENT id + public tour_id (6 digits)
-- Migration: 0016_tours_internal_id
-- ============================================================
--
-- id         — internal primary key (auto-increment)
-- tour_id    — public 6-digit code (R2 paths, URLs, QR); UNIQUE
-- qr_code    — separate alphanumeric code for QR labels (unique when set)
-- ============================================================

PRAGMA foreign_keys=OFF;

CREATE TEMP TABLE _tour_id_map (
  old_id TEXT PRIMARY KEY,
  new_tour_id TEXT NOT NULL
);

INSERT INTO _tour_id_map (old_id, new_tour_id)
SELECT
  id,
  CASE
    WHEN length(id) = 6 AND id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]' THEN id
    ELSE printf(
      '%06d',
      100000 + (
        SELECT COUNT(*) FROM tours t2
        WHERE t2.created_at < tours.created_at
           OR (t2.created_at = tours.created_at AND t2.id <= tours.id)
      )
    )
  END
FROM tours;

CREATE TABLE tours_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT,
  file_size INTEGER,
  r2_key TEXT,
  upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  viewer_url TEXT,
  processing_error TEXT,
  processed_at TEXT,
  processing_started_at TEXT,
  progress_total_files INTEGER,
  progress_current_files INTEGER,
  progress_total_bytes INTEGER,
  progress_current_bytes INTEGER,
  processing_stage TEXT,
  deleted_at TEXT,
  ready_at TEXT,
  backup_completed_at TEXT,
  cleanup_completed_at TEXT,
  upload_session_id TEXT,
  customer_id TEXT REFERENCES customers(id),
  listing_status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT,
  owner_type TEXT,
  owner_type_details TEXT,
  property_category_id TEXT REFERENCES property_categories(id),
  property_sub_category_id TEXT REFERENCES property_categories(id),
  furnish_type TEXT,
  size_bhk TEXT,
  other_option_details TEXT,
  super_built_up_area REAL,
  price REAL,
  use_company_billing INTEGER NOT NULL DEFAULT 0,
  billing_company_name TEXT,
  gst_no TEXT,
  house_no TEXT,
  building_name TEXT,
  society_name TEXT,
  area_locality TEXT,
  landmark TEXT,
  pin_code TEXT,
  country TEXT,
  state TEXT,
  city TEXT,
  full_address TEXT,
  qr_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO tours_new (
  tour_id, qr_code, name, owner_id, original_filename, file_size, r2_key, upload_id, status,
  viewer_url, processing_error, processed_at, processing_started_at,
  progress_total_files, progress_current_files, progress_total_bytes, progress_current_bytes,
  processing_stage, deleted_at, ready_at, backup_completed_at, cleanup_completed_at,
  upload_session_id, customer_id, listing_status, payment_status, owner_type, owner_type_details,
  property_category_id, property_sub_category_id, furnish_type, size_bhk, other_option_details,
  super_built_up_area, price, use_company_billing, billing_company_name, gst_no,
  house_no, building_name, society_name, area_locality, landmark, pin_code, country, state, city,
  full_address, created_at, updated_at
)
SELECT
  m.new_tour_id,
  COALESCE(t.qr_code, m.new_tour_id),
  t.name,
  t.owner_id,
  t.original_filename,
  t.file_size,
  t.r2_key,
  t.upload_id,
  t.status,
  t.viewer_url,
  t.processing_error,
  t.processed_at,
  t.processing_started_at,
  t.progress_total_files,
  t.progress_current_files,
  t.progress_total_bytes,
  t.progress_current_bytes,
  t.processing_stage,
  t.deleted_at,
  t.ready_at,
  t.backup_completed_at,
  t.cleanup_completed_at,
  t.upload_session_id,
  t.customer_id,
  COALESCE(t.listing_status, 'pending'),
  t.payment_status,
  t.owner_type,
  t.owner_type_details,
  t.property_category_id,
  t.property_sub_category_id,
  t.furnish_type,
  t.size_bhk,
  t.other_option_details,
  t.super_built_up_area,
  t.price,
  COALESCE(t.use_company_billing, 0),
  t.billing_company_name,
  t.gst_no,
  t.house_no,
  t.building_name,
  t.society_name,
  t.area_locality,
  t.landmark,
  t.pin_code,
  t.country,
  t.state,
  t.city,
  t.full_address,
  t.created_at,
  t.updated_at
FROM tours t
JOIN _tour_id_map m ON m.old_id = t.id;

UPDATE upload_sessions
SET tour_id = (
  SELECT new_tour_id FROM _tour_id_map WHERE old_id = upload_sessions.tour_id
)
WHERE EXISTS (
  SELECT 1 FROM _tour_id_map WHERE old_id = upload_sessions.tour_id
);

UPDATE tour_upload_history
SET tour_id = (
  SELECT new_tour_id FROM _tour_id_map WHERE old_id = tour_upload_history.tour_id
)
WHERE EXISTS (
  SELECT 1 FROM _tour_id_map WHERE old_id = tour_upload_history.tour_id
);

UPDATE media_links
SET entity_id = (
  SELECT new_tour_id FROM _tour_id_map WHERE old_id = media_links.entity_id
)
WHERE entity_type = 'tour'
  AND EXISTS (
    SELECT 1 FROM _tour_id_map WHERE old_id = media_links.entity_id
  );

DROP TABLE tours;
ALTER TABLE tours_new RENAME TO tours;

CREATE INDEX IF NOT EXISTS idx_tours_owner_id ON tours(owner_id);
CREATE INDEX IF NOT EXISTS idx_tours_status ON tours(status);
CREATE INDEX IF NOT EXISTS idx_tours_owner_status ON tours(owner_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tours_qr_code
  ON tours(qr_code) WHERE qr_code IS NOT NULL AND deleted_at IS NULL;

-- Rebind child FKs to tours(tour_id)
CREATE TABLE upload_sessions_new (
  id                 TEXT PRIMARY KEY,
  tour_id            TEXT NOT NULL REFERENCES tours(tour_id),
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

INSERT INTO upload_sessions_new SELECT * FROM upload_sessions;
DROP TABLE upload_sessions;
ALTER TABLE upload_sessions_new RENAME TO upload_sessions;
CREATE INDEX IF NOT EXISTS idx_upload_sessions_tour ON upload_sessions(tour_id);

CREATE TABLE tour_upload_history_new (
  id                   TEXT PRIMARY KEY,
  tour_id              TEXT NOT NULL REFERENCES tours(tour_id),
  upload_session_id    TEXT,
  attempt_number       INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL,
  stage                TEXT,
  original_filename    TEXT,
  file_size            INTEGER,
  backup_version       TEXT,
  backup_r2_key        TEXT,
  error_message        TEXT,
  started_at           TEXT NOT NULL,
  finished_at          TEXT,
  duration_ms          INTEGER,
  report_json          TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

INSERT INTO tour_upload_history_new SELECT * FROM tour_upload_history;
DROP TABLE tour_upload_history;
ALTER TABLE tour_upload_history_new RENAME TO tour_upload_history;

CREATE INDEX IF NOT EXISTS idx_tour_upload_history_tour
  ON tour_upload_history(tour_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tour_upload_history_session
  ON tour_upload_history(upload_session_id);
CREATE INDEX IF NOT EXISTS idx_tour_upload_history_active
  ON tour_upload_history(tour_id, status);

DROP TABLE _tour_id_map;

PRAGMA foreign_keys=ON;
