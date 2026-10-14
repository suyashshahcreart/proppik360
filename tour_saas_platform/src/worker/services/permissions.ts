// ============================================================
// Permission CRUD service
//
// Rule from reference: every newly created permission is
// auto-attached to the 'admin' role.
// Core meta-permission names are protected from deletion.
// ============================================================
import type { Permission, PermissionWithRoleCount } from '../types'

/** Permission names that may not be deleted (meta / system). */
const PROTECTED_PERMISSION_NAMES = new Set([
  'permission_view',
  'permission_create',
  'permission_edit',
  'permission_delete',
  'permission_assign',
  'role_view',
  'role_create',
  'role_edit',
  'role_delete',
  'role_assign_permissions',
  'user_view',
  'user_create',
  'user_edit',
  'user_delete',
  'user_manage_roles',
])

export async function listPermissions(
  db: D1Database,
): Promise<PermissionWithRoleCount[]> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.name, p.guard_name, p.created_at, p.updated_at,
              COUNT(rp.role_id) as roles_count
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_id = p.id
       GROUP BY p.id
       ORDER BY p.name ASC`,
    )
    .all<PermissionWithRoleCount>()

  return rows.results
}

export async function getPermission(
  db: D1Database,
  id: string,
): Promise<PermissionWithRoleCount | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.name, p.guard_name, p.created_at, p.updated_at,
              COUNT(rp.role_id) as roles_count
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`,
    )
    .bind(id)
    .first<PermissionWithRoleCount>()

  return row ?? null
}

export async function findPermissionByName(
  db: D1Database,
  name: string,
): Promise<Permission | null> {
  return (
    (await db
      .prepare('SELECT * FROM permissions WHERE name = ?')
      .bind(name)
      .first<Permission>()) ?? null
  )
}

export async function createPermission(
  db: D1Database,
  name: string,
): Promise<Permission> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO permissions (id, name, guard_name, created_at, updated_at)
       VALUES (?, ?, 'web', ?, ?)`,
    )
    .bind(id, name, now, now)
    .run()

  // Auto-attach to admin role
  const adminRole = await db
    .prepare(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`)
    .first<{ id: string }>()

  if (adminRole) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
      )
      .bind(adminRole.id, id)
      .run()
  }

  return {
    id,
    name,
    guard_name: 'web',
    created_at: now,
    updated_at: now,
  }
}

export async function updatePermission(
  db: D1Database,
  id: string,
  name: string,
): Promise<Permission | null> {
  const now = new Date().toISOString()

  await db
    .prepare(
      `UPDATE permissions SET name = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(name, now, id)
    .run()

  return (
    (await db
      .prepare('SELECT * FROM permissions WHERE id = ?')
      .bind(id)
      .first<Permission>()) ?? null
  )
}

/**
 * Delete a permission. Returns an error string if protected or still assigned.
 */
export async function deletePermission(
  db: D1Database,
  id: string,
): Promise<{ error: string } | null> {
  const perm = await db
    .prepare('SELECT * FROM permissions WHERE id = ?')
    .bind(id)
    .first<Permission>()

  if (!perm) return { error: 'Permission not found' }

  if (PROTECTED_PERMISSION_NAMES.has(perm.name)) {
    return { error: `Permission '${perm.name}' is protected and cannot be deleted` }
  }

  const roleCount = await db
    .prepare(
      'SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_id = ?',
    )
    .bind(id)
    .first<{ cnt: number }>()

  if ((roleCount?.cnt ?? 0) > 0) {
    return {
      error: `Permission is still assigned to ${roleCount?.cnt} role(s). Remove it from all roles first.`,
    }
  }

  await db.prepare('DELETE FROM permissions WHERE id = ?').bind(id).run()
  return null
}
