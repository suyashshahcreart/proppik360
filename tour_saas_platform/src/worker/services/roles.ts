// ============================================================
// Role CRUD service
//
// Rules from reference:
// - 'admin' role cannot be deleted
// - Role update = REPLACE (sync) permission set
// - On role delete, orphaned users reassigned to 'user' role
// ============================================================
import type { Role, RoleWithDetails } from '../types'

/** Role names that may not be deleted. */
const PROTECTED_ROLE_NAMES = new Set(['admin'])

export async function listRoles(db: D1Database): Promise<RoleWithDetails[]> {
  const roles = await db
    .prepare(
      `SELECT r.id, r.name, r.guard_name, r.created_at, r.updated_at,
              COUNT(DISTINCT ur.user_id) as users_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       GROUP BY r.id
       ORDER BY r.name ASC`,
    )
    .all<Role & { users_count: number }>()

  const result: RoleWithDetails[] = []
  for (const role of roles.results) {
    const perms = await db
      .prepare(
        `SELECT p.id, p.name
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?
         ORDER BY p.name ASC`,
      )
      .bind(role.id)
      .all<{ id: string; name: string }>()

    result.push({
      ...role,
      permission_names: perms.results.map((p) => p.name),
      permission_ids: perms.results.map((p) => p.id),
    })
  }

  return result
}

export async function getRole(
  db: D1Database,
  id: string,
): Promise<RoleWithDetails | null> {
  const role = await db
    .prepare(
      `SELECT r.id, r.name, r.guard_name, r.created_at, r.updated_at,
              COUNT(DISTINCT ur.user_id) as users_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       WHERE r.id = ?
       GROUP BY r.id`,
    )
    .bind(id)
    .first<Role & { users_count: number }>()

  if (!role) return null

  const perms = await db
    .prepare(
      `SELECT p.id, p.name
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.name ASC`,
    )
    .bind(id)
    .all<{ id: string; name: string }>()

  return {
    ...role,
    permission_names: perms.results.map((p) => p.name),
    permission_ids: perms.results.map((p) => p.id),
  }
}

export async function findRoleByName(
  db: D1Database,
  name: string,
): Promise<Role | null> {
  return (
    (await db
      .prepare('SELECT * FROM roles WHERE name = ?')
      .bind(name)
      .first<Role>()) ?? null
  )
}

export async function createRole(
  db: D1Database,
  name: string,
  permissionIds: string[],
): Promise<RoleWithDetails> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO roles (id, name, guard_name, created_at, updated_at)
       VALUES (?, ?, 'web', ?, ?)`,
    )
    .bind(id, name, now, now)
    .run()

  await syncRolePermissions(db, id, permissionIds)

  return (await getRole(db, id))!
}

export async function updateRole(
  db: D1Database,
  id: string,
  name: string,
  permissionIds: string[],
): Promise<RoleWithDetails | null> {
  const now = new Date().toISOString()

  await db
    .prepare(`UPDATE roles SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, now, id)
    .run()

  await syncRolePermissions(db, id, permissionIds)

  return getRole(db, id)
}

/**
 * Replace the entire permission set for a role.
 * This is the "sync" semantics from the reference.
 */
async function syncRolePermissions(
  db: D1Database,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  await db
    .prepare('DELETE FROM role_permissions WHERE role_id = ?')
    .bind(roleId)
    .run()

  for (const permId of permissionIds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
      )
      .bind(roleId, permId)
      .run()
  }
}

/**
 * Delete a role. Returns error string if protected.
 * Orphaned users (whose only role was this one) are reassigned to 'user' role.
 */
export async function deleteRole(
  db: D1Database,
  id: string,
): Promise<{ error: string } | null> {
  const role = await db
    .prepare('SELECT * FROM roles WHERE id = ?')
    .bind(id)
    .first<Role>()

  if (!role) return { error: 'Role not found' }

  if (PROTECTED_ROLE_NAMES.has(role.name)) {
    return { error: `Role '${role.name}' is protected and cannot be deleted` }
  }

  // Find users who will become role-less after deletion
  const orphans = await db
    .prepare(
      `SELECT ur.user_id
       FROM user_roles ur
       WHERE ur.role_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur2
           WHERE ur2.user_id = ur.user_id AND ur2.role_id != ?
         )`,
    )
    .bind(id, id)
    .all<{ user_id: string }>()

  // Reassign orphans to 'user' role
  const userRole = await db
    .prepare(`SELECT id FROM roles WHERE name = 'user' LIMIT 1`)
    .first<{ id: string }>()

  if (userRole) {
    for (const { user_id } of orphans.results) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        )
        .bind(user_id, userRole.id)
        .run()
    }
  }

  await db.prepare('DELETE FROM roles WHERE id = ?').bind(id).run()
  return null
}
