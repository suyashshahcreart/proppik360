-- ============================================================
-- Tour analytics / tracking snapshots (main tour + tour admin)
-- Migration: 0027_tour_analytics_history
-- ============================================================

CREATE TABLE IF NOT EXISTS tour_analytics_history (
  id              TEXT PRIMARY KEY,
  tour_id         TEXT NOT NULL REFERENCES tours(tour_id),
  source          TEXT NOT NULL,
  tracking_key    TEXT NOT NULL,
  publish_version INTEGER NOT NULL,
  label           TEXT,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  recorded_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (tour_id, source, tracking_key, publish_version)
);

CREATE INDEX IF NOT EXISTS idx_tour_analytics_tour_source_updated
  ON tour_analytics_history(tour_id, source, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_analytics_tour_version
  ON tour_analytics_history(tour_id, publish_version DESC);
