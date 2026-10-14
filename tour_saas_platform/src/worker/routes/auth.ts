// ============================================================
// Authentication routes
//
//   POST /api/auth/login   — validate credentials, set session cookie
//   POST /api/auth/logout  — clear session cookie, delete from D1
//   GET  /api/auth/me      — return current user info
//
// Both login and /me return roles[] + permissions[] so the
// frontend auth context can gate UI without extra round-trips.
// ============================================================
import { Hono } from 'hono'
import { verifyPassword } from '../services/auth'
import {
  createSession,
  deleteSession,
  buildSessionCookie,
  clearSessionCookie,
} from '../services/session'
import { getUserPermissionNames, getUserRoleNames } from '../services/rbac'
import { authMiddleware } from '../middleware/auth'
import { ok, err } from '../utils/response'
import { loginSchema } from '../utils/validation'
import type { Env, Variables } from '../types'

const auth = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── POST /api/auth/login ──────────────────────────────────────
auth.post('/login', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const { email, password } = parsed.data

  const user = await c.env.DB.prepare(
    `SELECT id, name, email, password_hash, role, status
     FROM users
     WHERE email = ?
     LIMIT 1`,
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string
      name: string
      email: string
      password_hash: string
      role: string
      status: string
    }>()

  const dummyHash =
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const hashToVerify = user?.password_hash ?? dummyHash
  const passwordValid = await verifyPassword(password, hashToVerify)

  if (!user || user.status !== 'active' || !passwordValid) {
    console.log(`[auth] Login failed for email: ${email}`)
    return c.json(err('INVALID_CREDENTIALS', 'Invalid email or password'), 401)
  }

  const sessionId = await createSession(c.env.DB, user.id)
  const isProduction = c.env.ENVIRONMENT === 'production'

  // Resolve RBAC data so frontend can gate UI immediately after login
  const [roles, permissionsSet] = await Promise.all([
    getUserRoleNames(c.env.DB, user.id),
    getUserPermissionNames(c.env.DB, user.id),
  ])
  const permissions = Array.from(permissionsSet)

  console.log(`[auth] Login successful: user=${user.id} email=${email}`)

  return new Response(
    JSON.stringify(
      ok({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roles,
        permissions,
      }),
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSessionCookie(sessionId, isProduction),
      },
    },
  )
})

// ── POST /api/auth/logout ─────────────────────────────────────
auth.post('/logout', authMiddleware, async (c) => {
  const sessionId = c.get('sessionId')
  await deleteSession(c.env.DB, sessionId)

  const isProduction = c.env.ENVIRONMENT === 'production'

  console.log(`[auth] Logout: session=${sessionId}`)

  return new Response(
    JSON.stringify(ok({ message: 'Logged out successfully' })),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearSessionCookie(isProduction),
      },
    },
  )
})

// ── GET /api/auth/me ──────────────────────────────────────────
auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')
  const roles = c.get('userRoles')
  const permissions = Array.from(c.get('userPermissions'))

  return c.json(
    ok({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles,
      permissions,
    }),
  )
})

export { auth as authRoutes }
