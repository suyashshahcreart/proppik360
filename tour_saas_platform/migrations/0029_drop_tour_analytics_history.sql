-- ============================================================
-- Remove legacy tour analytics snapshot storage (superseded by analytics.proppik.cloud)
-- Migration: 0029_drop_tour_analytics_history
-- ============================================================

DROP TABLE IF EXISTS tour_analytics_history;

DELETE FROM role_permissions WHERE permission_id = 'perm_tour_analytics_view';
DELETE FROM permissions WHERE id = 'perm_tour_analytics_view';
