// ============================================================
// Core RBAC helpers
//
// These functions resolve a user's effective permissions and roles
// by walking user_roles → role_permissions → permissions.
//
// Called by authMiddleware on every authenticated request.
// No caching — D1 joins are fast enough; add KV cache later if needed.
// ============================================================

/**
 * Returns the set of all permission names effective for a user
 * (union of all permissions across all assigned roles).
 */
export async function getUserPermissionNames(
  db: D1Database,
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT p.name
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
    )
    .bind(userId)
    .all<{ name: string }>()

  return new Set(rows.results.map((r) => r.name))
}

/**
 * Returns the list of role names assigned to a user.
 */
export async function getUserRoleNames(
  db: D1Database,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
    )
    .bind(userId)
    .all<{ name: string }>()

  return rows.results.map((r) => r.name)
}

/**
 * Returns true if the user's ONLY role is 'customer' (no admin access).
 * Mirrors BrokerX's `not.customer` middleware guard.
 */
export async function isPureCustomer(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const roles = await getUserRoleNames(db, userId)
  if (roles.length === 0) return false
  return roles.every((r) => r === 'customer')
}

/**
 * Returns true if removing the admin role from userId would leave
 * zero admin users in the system.
 */
export async function isLastAdmin(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'admin' AND ur.user_id != ?`,
    )
    .bind(userId)
    .first<{ cnt: number }>()

  return (row?.cnt ?? 0) === 0
}
