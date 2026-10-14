-- ============================================================
-- 360 Tour SaaS — Initial Database Schema
-- Migration: 0001_initial
-- ============================================================
--
-- Applied with:
--   Local:  npm run migrate:local
--   Remote: npm run migrate:remote
--
-- UUIDs are generated in application code using crypto.randomUUID()
-- and inserted explicitly. D1 (SQLite) does not have a built-in UUID function.
--
-- All timestamps are stored as ISO 8601 TEXT in UTC using datetime('now').
-- ============================================================


-- ============================================================
-- USERS
-- Stores platform accounts. Each user can own many tours.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                          -- UUID generated in application
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                             -- PBKDF2-SHA256, see services/auth.ts
  role          TEXT NOT NULL DEFAULT 'user',              -- 'user' | 'admin'
  status        TEXT NOT NULL DEFAULT 'active',            -- 'active' | 'suspended'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fast email lookup on login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);


-- ============================================================
-- SESSIONS
-- Server-side session store. No JWTs — sessions are validated
-- on every request by querying this table.
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                            -- Opaque UUID set as session cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,                               -- ISO 8601 UTC timestamp
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fast lookup by user (for cleanup) and by expiry (for validation)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);


-- ============================================================
-- TOURS
-- One row per 360° tour. Tracks the upload lifecycle.
--
-- Status flow:
--   draft      → Tour created, no upload started yet
--   uploading  → R2 multipart upload in progress
--   uploaded   → All parts uploaded and multipart completed
--   processing → (Future) Go processor is extracting the ZIP
--   ready      → (Future) Tour is live and viewable
--   failed     → Upload or processing failed
--   archived   → Soft-deleted / disabled
--
-- Only draft → uploading → uploaded are used in this foundation.
-- The remaining statuses are reserved for future features.
-- ============================================================
CREATE TABLE IF NOT EXISTS tours (
  id                TEXT PRIMARY KEY,                      -- UUID generated in application
  name              TEXT NOT NULL,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Populated when upload is initiated
  original_filename TEXT,                                  -- e.g. 'tour-building-a.zip'
  file_size         INTEGER,                               -- bytes

  -- R2 storage location — always server-generated, never trusted from client
  -- Format: tours/{tourId}/original.zip
  r2_key            TEXT,

  -- R2 multipart upload session identifier.
  -- Stored so the Worker can complete or abort the upload later.
  upload_id         TEXT,

  status            TEXT NOT NULL DEFAULT 'draft',

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Filter tours by owner (most common query)
CREATE INDEX IF NOT EXISTS idx_tours_owner_id ON tours(owner_id);

-- Filter by status (dashboard stats query)
CREATE INDEX IF NOT EXISTS idx_tours_status ON tours(status);

-- Combined index for the common pattern: owner's tours filtered by status
CREATE INDEX IF NOT EXISTS idx_tours_owner_status ON tours(owner_id, status);
