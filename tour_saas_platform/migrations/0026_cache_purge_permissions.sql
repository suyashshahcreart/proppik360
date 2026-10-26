-- ============================================================
-- CDN cache purge RBAC permissions
-- Migration: 0026_cache_purge_permissions
-- ============================================================

INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_cache_purge_tour',    'cache_purge_tour',    'web'),
  ('perm_setting_cache_purge', 'setting_cache_purge', 'web');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN ('cache_purge_tour', 'setting_cache_purge');
