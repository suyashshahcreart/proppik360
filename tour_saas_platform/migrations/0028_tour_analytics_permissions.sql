-- ============================================================
-- Tour analytics RBAC
-- Migration: 0028_tour_analytics_permissions
-- ============================================================

INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_tour_analytics_view', 'tour_analytics_view', 'web');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN ('tour_analytics_view');
