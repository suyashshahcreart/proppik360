// ============================================================
// System admin routes — Roles, Permissions, Users
//
//   GET    /api/system/permissions        — list
//   POST   /api/system/permissions        — create
//   GET    /api/system/permissions/:id    — detail
//   PUT    /api/system/permissions/:id    — update
//   DELETE /api/system/permissions/:id    — delete
//
//   GET    /api/system/roles              — list
//   POST   /api/system/roles              — create
//   GET    /api/system/roles/:id          — detail
//   PUT    /api/system/roles/:id          — update
//   DELETE /api/system/roles/:id          — delete
//
//   GET    /api/system/users              — list (no pure-customer users)
//   POST   /api/system/users              — create
//   GET    /api/system/users/:id          — detail
//   PUT    /api/system/users/:id          — update
//   DELETE /api/system/users/:id          — delete
//
// All routes require: authMiddleware + requireNotCustomer
// Individual routes add requirePermission('resource_action')
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission, requireNotCustomer } from '../middleware/auth'
import {
  listPermissions,
  getPermission,
  createPermission,
  updatePermission,
  deletePermission,
  findPermissionByName,
} from '../services/permissions'
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  findRoleByName,
} from '../services/roles'
import {
  listAdminUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  type AdminUserRow,
} from '../services/users-admin'
import { logActivity } from '../services/activity'
import { ok, err } from '../utils/response'
import {
  createPermissionSchema,
  createRoleSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
} from '../utils/validation'
import type { Env, Variables } from '../types'

const system = new Hono<{ Bindings: Env; Variables: Variables }>()

// Apply auth + not-customer to the entire system router
system.use('*', authMiddleware, requireNotCustomer)

// ── PERMISSIONS ───────────────────────────────────────────────

system.get('/permissions', requirePermission('permission_view'), async (c) => {
  const perms = await listPermissions(c.env.DB)
  return c.json(ok(perms))
})

system.get('/permissions/:id', requirePermission('permission_view'), async (c) => {
  const perm = await getPermission(c.env.DB, c.req.param('id'))
  if (!perm) return c.json(err('NOT_FOUND', 'Permission not found'), 404)
  return c.json(ok(perm))
})

system.post('/permissions', requirePermission('permission_create'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = createPermissionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const existing = await findPermissionByName(c.env.DB, parsed.data.name)
  if (existing) {
    return c.json(err('CONFLICT', `Permission '${parsed.data.name}' already exists`), 409)
  }

  const perm = await createPermission(c.env.DB, parsed.data.name)

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'created', 'permission', perm.id, {
    name: perm.name,
  })

  return c.json(ok(perm), 201)
})

system.put('/permissions/:id', requirePermission('permission_edit'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = createPermissionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const id = c.req.param('id')
  const existing = await findPermissionByName(c.env.DB, parsed.data.name)
  if (existing && existing.id !== id) {
    return c.json(err('CONFLICT', `Permission '${parsed.data.name}' already exists`), 409)
  }

  const perm = await updatePermission(c.env.DB, id, parsed.data.name)
  if (!perm) return c.json(err('NOT_FOUND', 'Permission not found'), 404)

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'updated', 'permission', id, {
    name: parsed.data.name,
  })

  return c.json(ok(perm))
})

system.delete('/permissions/:id', requirePermission('permission_delete'), async (c) => {
  const id = c.req.param('id')
  const error = await deletePermission(c.env.DB, id)
  if (error) {
    return c.json(err('CONFLICT', error.error), 409)
  }

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'deleted', 'permission', id)

  return c.json(ok({ message: 'Permission deleted' }))
})

// ── ROLES ─────────────────────────────────────────────────────

system.get('/roles', requirePermission('role_view'), async (c) => {
  const roles = await listRoles(c.env.DB)
  return c.json(ok(roles))
})

system.get('/roles/:id', requirePermission('role_view'), async (c) => {
  const role = await getRole(c.env.DB, c.req.param('id'))
  if (!role) return c.json(err('NOT_FOUND', 'Role not found'), 404)
  return c.json(ok(role))
})

system.post('/roles', requirePermission('role_create'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = createRoleSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const existing = await findRoleByName(c.env.DB, parsed.data.name)
  if (existing) {
    return c.json(err('CONFLICT', `Role '${parsed.data.name}' already exists`), 409)
  }

  // Only sync permissions if caller has role_assign_permissions
  const canAssignPerms = c.get('userPermissions').has('role_assign_permissions')
  const permIds = canAssignPerms ? parsed.data.permission_ids : []

  const role = await createRole(c.env.DB, parsed.data.name, permIds)

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'created', 'role', role.id, {
    name: role.name,
    permissions: permIds,
  })

  return c.json(ok(role), 201)
})

system.put('/roles/:id', requirePermission('role_edit'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = createRoleSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const id = c.req.param('id')
  const existing = await findRoleByName(c.env.DB, parsed.data.name)
  if (existing && existing.id !== id) {
    return c.json(err('CONFLICT', `Role '${parsed.data.name}' already exists`), 409)
  }

  const canAssignPerms = c.get('userPermissions').has('role_assign_permissions')
  const current = await getRole(c.env.DB, id)
  if (!current) return c.json(err('NOT_FOUND', 'Role not found'), 404)

  // If caller can't assign permissions, keep the existing set
  const permIds = canAssignPerms ? parsed.data.permission_ids : current.permission_ids

  const role = await updateRole(c.env.DB, id, parsed.data.name, permIds)
  if (!role) return c.json(err('NOT_FOUND', 'Role not found'), 404)

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'updated', 'role', id, {
    name: parsed.data.name,
    permissions: permIds,
  })

  return c.json(ok(role))
})

system.delete('/roles/:id', requirePermission('role_delete'), async (c) => {
  const id = c.req.param('id')
  const error = await deleteRole(c.env.DB, id)
  if (error) {
    return c.json(err('CONFLICT', error.error), 409)
  }

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'deleted', 'role', id)

  return c.json(ok({ message: 'Role deleted' }))
})

// ── USERS ─────────────────────────────────────────────────────

system.get('/users', requirePermission('user_view'), async (c) => {
  const users = await listAdminUsers(c.env.DB)
  return c.json(ok(users.map(safeUser)))
})

system.get('/users/:id', requirePermission('user_view'), async (c) => {
  const user = await getAdminUser(c.env.DB, c.req.param('id'))
  if (!user) return c.json(err('NOT_FOUND', 'User not found'), 404)
  return c.json(ok(safeUser(user)))
})

system.post('/users', requirePermission('user_create'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = createAdminUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const emailExists = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  )
    .bind(parsed.data.email.toLowerCase().trim())
    .first()

  if (emailExists) {
    return c.json(err('CONFLICT', 'A user with this email already exists'), 409)
  }

  const canManageRoles = c.get('userPermissions').has('user_manage_roles')
  const roleIds = canManageRoles ? parsed.data.role_ids : []

  const user = await createAdminUser(c.env.DB, {
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    status: parsed.data.status,
    roleIds,
  })

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'created', 'user', user.id, {
    name: user.name,
    email: user.email,
    roles: roleIds,
  })

  return c.json(ok(safeUser(user)), 201)
})

system.put('/users/:id', requirePermission('user_edit'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = updateAdminUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const id = c.req.param('id')

  if (parsed.data.email) {
    const emailExists = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
    )
      .bind(parsed.data.email.toLowerCase().trim(), id)
      .first()

    if (emailExists) {
      return c.json(err('CONFLICT', 'A user with this email already exists'), 409)
    }
  }

  const canManageRoles = c.get('userPermissions').has('user_manage_roles')

  const result = await updateAdminUser(c.env.DB, id, {
    name: parsed.data.name,
    email: parsed.data.email,
    password:
      parsed.data.password && parsed.data.password.length > 0
        ? parsed.data.password
        : undefined,
    status: parsed.data.status,
    roleIds: canManageRoles ? parsed.data.role_ids : undefined,
  })

  if ('error' in result) {
    return c.json(err('CONFLICT', result.error), 409)
  }

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'updated', 'user', id, {
    name: parsed.data.name,
    email: parsed.data.email,
  })

  return c.json(ok(safeUser(result)))
})

system.delete('/users/:id', requirePermission('user_delete'), async (c) => {
  const id = c.req.param('id')
  const error = await deleteAdminUser(c.env.DB, id)
  if (error) {
    return c.json(err('CONFLICT', error.error), 409)
  }

  const actor = c.get('user')
  await logActivity(c.env.DB, actor.id, 'deleted', 'user', id)

  return c.json(ok({ message: 'User deleted' }))
})

// ── Helpers ───────────────────────────────────────────────────

/** Strip password_hash from user response. */
function safeUser(u: AdminUserRow) {
  const { password_hash: _pw, ...safe } = u as AdminUserRow & { password_hash?: string }
  return safe
}

export { system as systemRoutes }
