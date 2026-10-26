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
import { authMiddleware, requirePermission, requireAnyPermission, requireNotCustomer } from '../middleware/auth'
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
import { getSettingsMap, upsertSettings, ALL_SETTINGS_KEYS } from '../services/settings'
import { serializeMsg91Templates } from '../services/msg91-templates'
import {
  getMaster,
  updateMaster,
  masterToPublic,
} from '../services/tour-admin-master'
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  templateToPublic,
} from '../services/tour-admin-templates'
import { logActivity } from '../services/activity'
import { ok, err } from '../utils/response'
import {
  createPermissionSchema,
  createRoleSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  settingsPatchSchema,
  tourAdminMasterPutSchema,
  tourAdminTemplateBodySchema,
  systemCachePurgeSchema,
} from '../utils/validation'
import {
  CachePurgeNotConfiguredError,
  MAX_BULK_TOUR_PURGE,
  PURGE_ALL_CONFIRM_PHRASE,
  purgeCustom,
  purgeEverything,
  purgeTourCache,
} from '../services/cloudflare-cache'
import type { Env, Variables } from '../types'

function settingFlag(v: unknown): string {
  if (v === true || v === 1 || v === '1') return '1'
  if (v === false || v === 0 || v === '0') return '0'
  return String(v ?? '')
}

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

// ── SETTINGS ──────────────────────────────────────────────────

const SETTINGS_READ_PERMS = [
  'setting_view',
  'setting_edit',
  'setting_general',
  'setting_sms',
  'setting_tour_admin',
] as const

system.get('/settings', requireAnyPermission(...SETTINGS_READ_PERMS), async (c) => {
  const map = await getSettingsMap(c.env.DB, [...ALL_SETTINGS_KEYS])
  return c.json(ok(map))
})

system.patch('/settings', async (c) => {
  // Per-tab permission checked after parse
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = settingsPatchSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const perms = c.get('userPermissions')
  const tab = parsed.data.tab
  const need =
    tab === 'general'
      ? (['setting_general', 'setting_edit'] as const)
      : (['setting_sms', 'setting_edit'] as const)
  if (!need.some((p) => perms.has(p))) {
    return c.json(err('FORBIDDEN', 'Insufficient permissions'), 403)
  }

  const pairs: Record<string, string | null> = {}
  if (tab === 'general') {
    const d = parsed.data
    if (d.support_email !== undefined) pairs.support_email = d.support_email
    if (d.support_phone !== undefined) pairs.support_phone = d.support_phone
    if (d.tour_admin_api_base_url !== undefined) {
      pairs.tour_admin_api_base_url = d.tour_admin_api_base_url
    }
  } else {
    const d = parsed.data
    if (d.sms_msg91_enabled !== undefined) pairs.sms_msg91_enabled = settingFlag(d.sms_msg91_enabled)
    if (d.msg91_sender_id !== undefined) pairs.msg91_sender_id = d.msg91_sender_id
    if (d.msg91_otp_template_id !== undefined) pairs.msg91_otp_template_id = d.msg91_otp_template_id
    if (d.msg91_templates !== undefined) {
      const map: Record<string, string> = {}
      for (const row of d.msg91_templates) {
        map[row.key] = row.template_id
      }
      pairs.msg91_templates = serializeMsg91Templates(map)
      // Keep legacy single field in sync with tour_access_otp (or login_otp)
      if (map.tour_access_otp) pairs.msg91_otp_template_id = map.tour_access_otp
      else if (map.login_otp) pairs.msg91_otp_template_id = map.login_otp
    }
    if (d.msg91_timeout_ms !== undefined) pairs.msg91_timeout_ms = String(d.msg91_timeout_ms)
    if (d.msg91_route !== undefined) pairs.msg91_route = d.msg91_route
    if (d.otp_length !== undefined) pairs.otp_length = String(d.otp_length)
    if (d.otp_expiry_sec !== undefined) pairs.otp_expiry_sec = String(d.otp_expiry_sec)
    if (d.msg91_mock_mode !== undefined) pairs.msg91_mock_mode = settingFlag(d.msg91_mock_mode)
  }

  const actor = c.get('user')
  const updated = await upsertSettings(c.env.DB, pairs, actor.id)
  await logActivity(c.env.DB, actor.id, 'updated', 'settings', tab, { keys: Object.keys(pairs) })
  return c.json(ok(updated))
})

system.get(
  '/tour-admin-master',
  requireAnyPermission('setting_tour_admin', 'setting_view', 'setting_edit'),
  async (c) => {
    const master = await getMaster(c.env.DB)
    return c.json(ok(masterToPublic(master)))
  },
)

system.put('/tour-admin-master', requirePermission('setting_tour_admin'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourAdminMasterPutSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const actor = c.get('user')
  const master = await updateMaster(c.env.DB, parsed.data, actor.id)
  await logActivity(c.env.DB, actor.id, 'updated', 'tour_admin_master', 'default')
  return c.json(ok(masterToPublic(master)))
})

// ── TOUR ADMIN MASTER TEMPLATES ───────────────────────────────

system.get(
  '/tour-admin-master/templates',
  requireAnyPermission('setting_tour_admin', 'setting_view', 'setting_edit'),
  async (c) => {
    const rows = await listTemplates(c.env.DB)
    return c.json(ok(rows))
  },
)

system.get(
  '/tour-admin-master/templates/:id',
  requireAnyPermission('setting_tour_admin', 'setting_view', 'setting_edit'),
  async (c) => {
    const row = await getTemplate(c.env.DB, c.req.param('id'))
    if (!row) return c.json(err('NOT_FOUND', 'Template not found'), 404)
    return c.json(ok(templateToPublic(row)))
  },
)

system.post('/tour-admin-master/templates', requirePermission('setting_tour_admin'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourAdminTemplateBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  try {
    const actor = c.get('user')
    const created = await createTemplate(c.env.DB, parsed.data, actor.id)
    await logActivity(c.env.DB, actor.id, 'created', 'tour_admin_template', created.id)
    return c.json(ok(created), 201)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not create template'
    const field =
      e && typeof e === 'object' && 'field' in e
        ? String((e as { field: unknown }).field)
        : undefined
    return c.json(err('INVALID_INPUT', message, field ? { field } : undefined), 422)
  }
})

system.put(
  '/tour-admin-master/templates/:id',
  requirePermission('setting_tour_admin'),
  async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
    }

    const parsed = tourAdminTemplateBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
    }

    try {
      const actor = c.get('user')
      const updated = await updateTemplate(c.env.DB, c.req.param('id'), parsed.data, actor.id)
      await logActivity(c.env.DB, actor.id, 'updated', 'tour_admin_template', updated.id)
      return c.json(ok(updated))
    } catch (e) {
      const code =
        e && typeof e === 'object' && 'code' in e
          ? String((e as { code: unknown }).code)
          : 'INVALID_INPUT'
      const message = e instanceof Error ? e.message : 'Could not update template'
      const field =
        e && typeof e === 'object' && 'field' in e
          ? String((e as { field: unknown }).field)
          : undefined
      return c.json(
        err(code, message, field ? { field } : undefined),
        code === 'NOT_FOUND' ? 404 : 422,
      )
    }
  },
)

// ── POST /api/system/cache/purge ──────────────────────────────
system.post('/cache/purge', requirePermission('setting_cache_purge'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = systemCachePurgeSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const actor = c.get('user')

  try {
    if (parsed.data.type === 'tours') {
      const tourIds = [...new Set(parsed.data.tourIds.map((id) => id.trim()))].slice(
        0,
        MAX_BULK_TOUR_PURGE,
      )
      const results = []
      let allOk = true
      for (const tid of tourIds) {
        const result = await purgeTourCache(c.env, tid)
        results.push({
          tourId: tid,
          mode: result.mode,
          purgedPrefixes: result.prefixes,
          fileCount: result.fileCount,
          success: result.cloudflare.success,
          error: result.cloudflare.errors?.[0]?.message,
        })
        if (!result.cloudflare.success) allOk = false
      }
      await logActivity(c.env.DB, actor.id, 'cache_purge_bulk', 'cache', null, {
        tourIds,
        results,
      })
      return c.json(
        ok({ results, success: allOk }),
        allOk ? 200 : 502,
      )
    }

    if (parsed.data.type === 'everything') {
      if (parsed.data.confirmPhrase !== PURGE_ALL_CONFIRM_PHRASE) {
        return c.json(
          err('INVALID_INPUT', `Confirmation phrase must be exactly: ${PURGE_ALL_CONFIRM_PHRASE}`),
          422,
        )
      }
      const cf = await purgeEverything(c.env)
      await logActivity(c.env.DB, actor.id, 'cache_purge_everything', 'cache', null, {
        cloudflareSuccess: cf.success,
      })
      if (!cf.success) {
        const msg = cf.errors?.[0]?.message ?? 'Cloudflare purge everything failed'
        return c.json(err('UPSTREAM_ERROR', msg, { cloudflare: cf }), 502)
      }
      return c.json(ok({ message: 'Entire zone cache purge requested', cloudflare: cf }))
    }

    const cf = await purgeCustom(c.env, parsed.data.mode, parsed.data.values)
    await logActivity(c.env.DB, actor.id, 'cache_purge_custom', 'cache', null, {
      mode: parsed.data.mode,
      values: parsed.data.values,
      cloudflareSuccess: cf.success,
    })
    if (!cf.success) {
      const msg = cf.errors?.[0]?.message ?? 'Cloudflare custom purge failed'
      return c.json(err('UPSTREAM_ERROR', msg, { cloudflare: cf }), 502)
    }
    return c.json(ok({ message: 'Custom cache purge completed', cloudflare: cf }))
  } catch (e) {
    if (e instanceof CachePurgeNotConfiguredError) {
      return c.json(err('SERVICE_UNAVAILABLE', e.message), 503)
    }
    const message = e instanceof Error ? e.message : 'Cache purge failed'
    return c.json(err('INVALID_INPUT', message), 422)
  }
})

system.delete(
  '/tour-admin-master/templates/:id',
  requirePermission('setting_tour_admin'),
  async (c) => {
    const id = c.req.param('id')
    const deleted = await deleteTemplate(c.env.DB, id)
    if (!deleted) return c.json(err('NOT_FOUND', 'Template not found'), 404)
    const actor = c.get('user')
    await logActivity(c.env.DB, actor.id, 'deleted', 'tour_admin_template', id)
    return c.json(ok({ message: 'Template deleted' }))
  },
)

// ── Helpers ───────────────────────────────────────────────────

/** Strip password_hash from user response. */
function safeUser(u: AdminUserRow) {
  const { password_hash: _pw, ...safe } = u as AdminUserRow & { password_hash?: string }
  return safe
}

export { system as systemRoutes }
