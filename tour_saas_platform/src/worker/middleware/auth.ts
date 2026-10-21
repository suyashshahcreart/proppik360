// ============================================================
// Authentication + RBAC middleware for protected API routes
//
// Exports:
//   authMiddleware       — validates session + loads roles/permissions
//   requirePermission    — factory: returns 403 if permission missing
//   requireNotCustomer   — blocks users whose ONLY role is 'customer'
//
// Usage:
//   route.get('/protected', authMiddleware, requirePermission('tour_view'), handler)
// ============================================================
import { createMiddleware } from 'hono/factory'
import { validateSession, parseCookieHeader } from '../services/session'
import { getUserPermissionNames, getUserRoleNames } from '../services/rbac'
import { err } from '../utils/response'
import type { Env, Variables } from '../types'

// ── authMiddleware ────────────────────────────────────────────
export const authMiddleware = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const sessionId = parseCookieHeader(cookieHeader, 'session')

  if (!sessionId) {
    return c.json(err('UNAUTHORIZED', 'Authentication required'), 401)
  }

  const user = await validateSession(c.env.DB, sessionId)

  if (!user) {
    return c.json(err('UNAUTHORIZED', 'Session expired or invalid'), 401)
  }

  // Resolve RBAC data for this user (two parallel D1 queries)
  const [roles, permissions] = await Promise.all([
    getUserRoleNames(c.env.DB, user.id),
    getUserPermissionNames(c.env.DB, user.id),
  ])

  c.set('user', user)
  c.set('sessionId', sessionId)
  c.set('userRoles', roles)
  c.set('userPermissions', permissions)

  await next()
})

// ── requirePermission ─────────────────────────────────────────
/**
 * Returns a middleware that requires the authenticated user to have
 * the specified permission name. Must run after authMiddleware.
 */
export function requirePermission(permission: string) {
  return createMiddleware<{
    Bindings: Env
    Variables: Variables
  }>(async (c, next) => {
    const perms = c.get('userPermissions')
    if (!perms || !perms.has(permission)) {
      return c.json(err('FORBIDDEN', 'Insufficient permissions'), 403)
    }
    await next()
  })
}

/** Require at least one of the listed permissions. */
export function requireAnyPermission(...permissions: string[]) {
  return createMiddleware<{
    Bindings: Env
    Variables: Variables
  }>(async (c, next) => {
    const perms = c.get('userPermissions')
    if (!perms || !permissions.some((p) => perms.has(p))) {
      return c.json(err('FORBIDDEN', 'Insufficient permissions'), 403)
    }
    await next()
  })
}

// ── requireNotCustomer ────────────────────────────────────────
/**
 * Blocks access if the user's ONLY role is 'customer'.
 * Mirrors BrokerX's `not.customer` middleware.
 * Must run after authMiddleware.
 */
export const requireNotCustomer = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const roles = c.get('userRoles')
  const isOnlyCustomer =
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.every((r) => r === 'customer')

  if (isOnlyCustomer) {
    return c.json(err('FORBIDDEN', 'Access denied for customer accounts'), 403)
  }

  await next()
})
