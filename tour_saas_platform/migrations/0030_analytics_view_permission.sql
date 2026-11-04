-- ============================================================
-- Native analytics dashboard in 360 (/analytics)
-- Migration: 0030_analytics_view_permission
-- ============================================================

INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_analytics_view', 'analytics_view', 'web');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN ('analytics_view');
