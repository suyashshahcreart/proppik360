-- ============================================================
-- Customer master table
-- Migration: 0003_customers
-- ============================================================
--
-- customers: one row per customer contact / company profile.
-- customer_social_links: normalized social link rows (1:N).
--
-- Mobile is stored as country_code + mobile (not a single combined
-- string) so the UI country dropdown and number field map 1:1.
--
-- Photos are stored in R2; D1 keeps the object keys / public URLs.
-- Slug is optional but UNIQUE when set (globally across customers).
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             TEXT NOT NULL,

  -- Split mobile fields matching the form UI
  country_code      TEXT NOT NULL DEFAULT '+91',
  mobile            TEXT NOT NULL,

  company_name      TEXT,
  slug              TEXT,                                  -- optional unique identifier
  company_website   TEXT,
  tag_line          TEXT,
  designation       TEXT,

  -- R2 object keys (e.g. customers/{id}/profile.jpg)
  profile_photo_key TEXT,
  cover_photo_key   TEXT,
  -- Cached public URLs derived from R2_PUBLIC_DOMAIN
  profile_photo_url TEXT,
  cover_photo_url   TEXT,

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_slug
  ON customers(slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_owner_id ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_owner_created
  ON customers(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_social_links (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  platform_name  TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  icon_class     TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_social_links_customer
  ON customer_social_links(customer_id, sort_order);
