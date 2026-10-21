-- ============================================================
-- Settings + tour-admin RBAC permissions
-- Migration: 0021_settings_permissions
-- ============================================================

INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_setting_view',        'setting_view',        'web'),
  ('perm_setting_edit',        'setting_edit',        'web'),
  ('perm_setting_general',     'setting_general',     'web'),
  ('perm_setting_sms',         'setting_sms',         'web'),
  ('perm_setting_tour_admin',  'setting_tour_admin',  'web'),
  ('perm_tour_admin_view',     'tour_admin_view',     'web'),
  ('perm_tour_admin_edit',     'tour_admin_edit',     'web');

-- Admin gets all new permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions
WHERE name IN (
  'setting_view', 'setting_edit', 'setting_general', 'setting_sms',
  'setting_tour_admin', 'tour_admin_view', 'tour_admin_edit'
);
