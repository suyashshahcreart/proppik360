// ============================================================
// Public tour-admin APIs (no SaaS session cookie)
//
//   GET  /api/tour-admin/:tourId/config
//   POST /api/tour-admin/:tourId/login/password
//   POST /api/tour-admin/:tourId/otp/send
//   POST /api/tour-admin/:tourId/otp/verify
//   GET  /api/tour-admin/:tourId/session
//   POST /api/tour-admin/:tourId/logout
// ============================================================
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ok, err } from '../utils/response'
import {
  tourAdminPasswordLoginSchema,
  tourAdminOtpSendSchema,
  tourAdminOtpVerifySchema,
} from '../utils/validation'
import {
  loginWithPassword,
  sendOtp,
  verifyOtp,
  validateTourAdminSession,
  deleteTourAdminSession,
  getTourAdminPublicConfig,
} from '../services/tour-admin-auth'
import type { Env, Variables } from '../types'

const tourAdminPublic = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Optional partner API key when TOUR_ADMIN_API_KEY is configured. */
export const requireTourAdminApiKey = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const expected = c.env.TOUR_ADMIN_API_KEY?.trim()
  if (!expected) {
    await next()
    return
  }
  const provided =
    c.req.header('X-Tour-Admin-Api-Key')?.trim() ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (provided !== expected) {
    return c.json(err('UNAUTHORIZED', 'Invalid or missing tour admin API key'), 401)
  }
  await next()
})

tourAdminPublic.use('*', requireTourAdminApiKey)

tourAdminPublic.get('/:tourId/config', async (c) => {
  const tourId = c.req.param('tourId')
  if (!/^\d{6}$/.test(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }
  const config = await getTourAdminPublicConfig(c.env.DB, tourId)
  if (!config) return c.json(err('NOT_FOUND', 'Tour admin not available'), 404)
  return c.json(ok(config))
})

tourAdminPublic.post('/:tourId/login/password', async (c) => {
  const tourId = c.req.param('tourId')
  if (!/^\d{6}$/.test(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourAdminPasswordLoginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const result = await loginWithPassword(
    c.env.DB,
    tourId,
    parsed.data.username,
    parsed.data.password,
  )
  if ('error' in result) {
    return c.json(err('AUTH_FAILED', result.error), result.status as 401 | 403 | 404)
  }

  return c.json(
    ok({
      token: result.sessionId,
      expires_at: result.expiresAt,
      tour_id: tourId,
      login_method: 'password',
    }),
  )
})

tourAdminPublic.post('/:tourId/otp/send', async (c) => {
  const tourId = c.req.param('tourId')
  if (!/^\d{6}$/.test(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourAdminOtpSendSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const result = await sendOtp(c.env, tourId, parsed.data.mobile)
  if ('error' in result) {
    return c.json(err('OTP_SEND_FAILED', result.error), result.status as 400 | 403 | 404 | 502)
  }

  return c.json(ok({ sent: true, expires_in_sec: result.expiresInSec }))
})

tourAdminPublic.post('/:tourId/otp/verify', async (c) => {
  const tourId = c.req.param('tourId')
  if (!/^\d{6}$/.test(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourAdminOtpVerifySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const result = await verifyOtp(c.env.DB, tourId, parsed.data.mobile, parsed.data.otp)
  if ('error' in result) {
    return c.json(err('OTP_VERIFY_FAILED', result.error), result.status as 400 | 401 | 403 | 404 | 429)
  }

  return c.json(
    ok({
      token: result.sessionId,
      expires_at: result.expiresAt,
      tour_id: tourId,
      login_method: 'otp',
    }),
  )
})

tourAdminPublic.get('/:tourId/session', async (c) => {
  const tourId = c.req.param('tourId')
  const token =
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    c.req.query('token') ||
    ''

  if (!token) {
    return c.json(err('UNAUTHORIZED', 'Bearer token required'), 401)
  }

  const session = await validateTourAdminSession(c.env.DB, token, tourId)
  if (!session.valid) {
    return c.json(err('UNAUTHORIZED', 'Invalid or expired session'), 401)
  }

  return c.json(ok(session))
})

tourAdminPublic.post('/:tourId/logout', async (c) => {
  const token =
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (token) {
    await deleteTourAdminSession(c.env.DB, token)
  }
  return c.json(ok({ message: 'Logged out' }))
})

export { tourAdminPublic as tourAdminPublicRoutes }
