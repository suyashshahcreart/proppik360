// ============================================================
// Admin user CRUD service
//
// Rules from reference:
// - Index hides pure-customer users
// - User update = REPLACE (sync) role set
// - Cannot remove the last admin
// - Cannot delete the last admin
// ============================================================
import type { User } from '../types'
import { hashPassword } from './auth'
import { isLastAdmin } from './rbac'

export interface AdminUserRow extends User {
  roles: string[]
}

/** List users, excluding those whose ONLY role is 'customer'. */
export async function listAdminUsers(db: D1Database): Promise<AdminUserRow[]> {
  const users = await db
    .prepare(
      `SELECT * FROM users
       WHERE NOT (
         EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = users.id AND r.name = 'customer'
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur2
           JOIN roles r2 ON r2.id = ur2.role_id
           WHERE ur2.user_id = users.id AND r2.name != 'customer'
         )
       )
       ORDER BY users.created_at DESC`,
    )
    .all<User>()

  const result: AdminUserRow[] = []
  for (const u of users.results) {
    const roles = await getUserRoleNames(db, u.id)
    result.push({ ...u, roles })
  }
  return result
}

export async function getAdminUser(
  db: D1Database,
  id: string,
): Promise<AdminUserRow | null> {
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>()

  if (!user) return null
  const roles = await getUserRoleNames(db, id)
  return { ...user, roles }
}

export async function createAdminUser(
  db: D1Database,
  data: {
    name: string
    email: string
    password: string
    status: 'active' | 'suspended'
    roleIds: string[]
  },
): Promise<AdminUserRow> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(data.password)

  // Derive legacy role column from RBAC roles for backwards compat
  const roleNames = await getRoleNamesByIds(db, data.roleIds)
  const legacyRole = roleNames.includes('admin') ? 'admin' : 'user'

  await db
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, data.name, data.email.toLowerCase().trim(), passwordHash, legacyRole, data.status, now, now)
    .run()

  await syncUserRoles(db, id, data.roleIds)

  return (await getAdminUser(db, id))!
}

export async function updateAdminUser(
  db: D1Database,
  id: string,
  data: {
    name?: string
    email?: string
    password?: string
    status?: 'active' | 'suspended'
    roleIds?: string[]
  },
): Promise<{ error: string } | AdminUserRow> {
  // Last-admin safeguard: if removing admin role, ensure another admin exists
  if (data.roleIds !== undefined) {
    const incomingRoleNames = await getRoleNamesByIds(db, data.roleIds)
    const willBeAdmin = incomingRoleNames.includes('admin')

    if (!willBeAdmin) {
      const currentRoles = await getUserRoleNames(db, id)
      const wasAdmin = currentRoles.includes('admin')
      if (wasAdmin && (await isLastAdmin(db, id))) {
        return { error: 'Cannot remove admin role from the last admin user' }
      }
    }
  }

  const sets: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) {
    sets.push('name = ?')
    values.push(data.name)
  }
  if (data.email !== undefined) {
    sets.push('email = ?')
    values.push(data.email.toLowerCase().trim())
  }
  if (data.password !== undefined && data.password.length > 0) {
    const hash = await hashPassword(data.password)
    sets.push('password_hash = ?')
    values.push(hash)
  }
  if (data.status !== undefined) {
    sets.push('status = ?')
    values.push(data.status)
  }

  // Sync roles and update legacy role column
  if (data.roleIds !== undefined) {
    await syncUserRoles(db, id, data.roleIds)
    const roleNames = await getRoleNamesByIds(db, data.roleIds)
    const legacyRole = roleNames.includes('admin') ? 'admin' : 'user'
    sets.push('role = ?')
    values.push(legacyRole)
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)
    await db
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run()
  }

  return (await getAdminUser(db, id))!
}

export async function deleteAdminUser(
  db: D1Database,
  id: string,
): Promise<{ error: string } | null> {
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>()

  if (!user) return { error: 'User not found' }

  const roles = await getUserRoleNames(db, id)
  if (roles.includes('admin') && (await isLastAdmin(db, id))) {
    return { error: 'Cannot delete the last admin user' }
  }

  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  return null
}

// ── Sync helpers ─────────────────────────────────────────────

async function syncUserRoles(
  db: D1Database,
  userId: string,
  roleIds: string[],
): Promise<void> {
  await db
    .prepare('DELETE FROM user_roles WHERE user_id = ?')
    .bind(userId)
    .run()

  for (const roleId of roleIds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
      )
      .bind(userId, roleId)
      .run()
  }
}

async function getUserRoleNames(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    )
    .bind(userId)
    .all<{ name: string }>()
  return rows.results.map((r) => r.name)
}

async function getRoleNamesByIds(db: D1Database, roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return []
  const placeholders = roleIds.map(() => '?').join(', ')
  const rows = await db
    .prepare(`SELECT name FROM roles WHERE id IN (${placeholders})`)
    .bind(...roleIds)
    .all<{ name: string }>()
  return rows.results.map((r) => r.name)
}
