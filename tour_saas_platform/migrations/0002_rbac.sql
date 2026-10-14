-- ============================================================
-- RBAC: Roles, Permissions, and Activity Logs
-- Migration: 0002_rbac
-- ============================================================
--
-- Ports the BrokerX/Spatie RBAC data model to D1 (SQLite).
-- UI and authorization follow the reference in docs/laravel-rbac-for-refence.md.
--
-- Naming: resource_action snake_case (e.g. tour_view, role_create)
-- Sync semantics: role update REPLACES permission set; user update REPLACES role set
-- Auto-rule: every newly created permission is auto-attached to the admin role
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS permissions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  guard_name TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  guard_name TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Role ↔ Permission junction (sync-replaced on role update)
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- User ↔ Role junction (sync-replaced on user update)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Lightweight audit log for RBAC mutations
CREATE TABLE IF NOT EXISTS activity_logs (
  id              TEXT PRIMARY KEY,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT,
  properties_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id      ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id      ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role   ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor     ON activity_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created   ON activity_logs(created_at);


-- ============================================================
-- SEED: Default Roles
-- ============================================================
INSERT OR IGNORE INTO roles (id, name, guard_name) VALUES
  ('role_admin',    'admin',    'web'),
  ('role_user',     'user',     'web'),
  ('role_customer', 'customer', 'web');


-- ============================================================
-- SEED: Default Permissions
-- (IDs use perm_ prefix so they are human-readable and stable)
-- ============================================================

-- Meta: permission management
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_permission_view',   'permission_view',   'web'),
  ('perm_permission_create', 'permission_create', 'web'),
  ('perm_permission_edit',   'permission_edit',   'web'),
  ('perm_permission_delete', 'permission_delete', 'web'),
  ('perm_permission_assign', 'permission_assign', 'web');

-- Meta: role management
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_role_view',               'role_view',               'web'),
  ('perm_role_create',             'role_create',             'web'),
  ('perm_role_edit',               'role_edit',               'web'),
  ('perm_role_delete',             'role_delete',             'web'),
  ('perm_role_assign_permissions', 'role_assign_permissions', 'web');

-- Meta: user management
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_user_view',         'user_view',         'web'),
  ('perm_user_create',       'user_create',       'web'),
  ('perm_user_edit',         'user_edit',         'web'),
  ('perm_user_delete',       'user_delete',       'web'),
  ('perm_user_manage_roles', 'user_manage_roles', 'web');

-- Product: dashboard
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_dashboard_view', 'dashboard_view', 'web');

-- Product: tours
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_tour_view',   'tour_view',   'web'),
  ('perm_tour_create', 'tour_create', 'web'),
  ('perm_tour_edit',   'tour_edit',   'web'),
  ('perm_tour_delete', 'tour_delete', 'web');

-- Product: customers
INSERT OR IGNORE INTO permissions (id, name, guard_name) VALUES
  ('perm_customer_view',   'customer_view',   'web'),
  ('perm_customer_create', 'customer_create', 'web'),
  ('perm_customer_edit',   'customer_edit',   'web'),
  ('perm_customer_delete', 'customer_delete', 'web');


-- ============================================================
-- SEED: admin role gets ALL permissions
-- ============================================================
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions;


-- ============================================================
-- SEED: user role gets product permissions only (no System access)
-- ============================================================
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_user', id FROM permissions
WHERE name IN (
  'dashboard_view',
  'tour_view', 'tour_create', 'tour_edit', 'tour_delete',
  'customer_view', 'customer_create', 'customer_edit', 'customer_delete'
);

-- customer role intentionally gets no permissions


-- ============================================================
-- BACKFILL: assign RBAC roles based on existing users.role column
-- (admin → role_admin; everything else → role_user)
-- ============================================================
INSERT OR IGNORE INTO user_roles (user_id, role_id)
SELECT id, 'role_admin' FROM users WHERE role = 'admin';

INSERT OR IGNORE INTO user_roles (user_id, role_id)
SELECT id, 'role_user' FROM users WHERE role = 'user';
