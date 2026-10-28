// ============================================================
// Shared secret for public / tour-admin analytics POST ingest
// ============================================================
import { createMiddleware } from 'hono/factory'
import { err } from '../utils/response'
import type { Env, Variables } from '../types'

export const requireAnalyticsIngestKey = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const expected = c.env.TOUR_ANALYTICS_INGEST_SECRET?.trim()
  if (!expected) {
    return c.json(
      err('SERVICE_UNAVAILABLE', 'Analytics ingest is not configured (TOUR_ANALYTICS_INGEST_SECRET)'),
      503,
    )
  }

  const provided =
    c.req.header('X-Analytics-Ingest-Key')?.trim() ||
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim()

  if (!provided || provided !== expected) {
    return c.json(err('UNAUTHORIZED', 'Invalid or missing analytics ingest key'), 401)
  }

  await next()
})
