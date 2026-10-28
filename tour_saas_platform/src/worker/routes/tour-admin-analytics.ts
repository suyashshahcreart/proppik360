// ============================================================
// Tour-admin analytics — GET (session) + POST (ingest secret)
//
//   GET  /api/tour-admin/:tourId/analytics
//   POST /api/tour-admin/:tourId/analytics
// ============================================================
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ok, err } from '../utils/response'
import { requireTourAdminApiKey } from './tour-admin-public'
import { requireAnalyticsIngestKey } from '../middleware/analytics-ingest'
import { validateTourAdminSession } from '../services/tour-admin-auth'
import { isTourId } from '../services/tour-admin-fs'
import {
  listAnalyticsHistory,
  resolvePublishVersion,
  tourExistsByPublicId,
  upsertAnalyticsSnapshot,
} from '../services/tour-analytics'
import { analyticsIngestSchema, analyticsListQuerySchema } from '../utils/validation'
import type { Env, Variables } from '../types'

const tourAdminAnalytics = new Hono<{ Bindings: Env; Variables: Variables }>()

function tourIdFromRequest(c: {
  req: { param: (k: string) => string | undefined; path: string }
}): string {
  const fromParam = c.req.param('tourId') ?? ''
  if (isTourId(fromParam)) return fromParam
  const fromPath = c.req.path.match(/\/api\/tour-admin\/(\d{6})\/analytics(?:\/|$)/)?.[1] ?? ''
  return fromPath
}

const requireTourAdminSession = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const tourId = tourIdFromRequest(c)
  if (!isTourId(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) {
    return c.json(err('UNAUTHORIZED', 'Bearer token required'), 401)
  }

  const session = await validateTourAdminSession(c.env.DB, token, tourId)
  if (!session.valid || session.tour_id !== tourId) {
    return c.json(err('UNAUTHORIZED', 'Invalid or expired session'), 401)
  }

  c.set('tourAdminId', session.admin_id)
  c.set('tourAdminTourId', session.tour_id)
  await next()
})

tourAdminAnalytics.use('*', requireTourAdminApiKey)

tourAdminAnalytics.get('/', requireTourAdminSession, async (c) => {
  const tourId = tourIdFromRequest(c)
  const parsed = analyticsListQuerySchema.safeParse({
    source: c.req.query('source'),
    tracking_key: c.req.query('tracking_key'),
    publish_version: c.req.query('publish_version'),
    limit: c.req.query('limit'),
  })
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  if (parsed.data.source && parsed.data.source !== 'tour_admin') {
    return c.json(err('INVALID_INPUT', 'Only source=tour_admin is allowed on this endpoint'), 422)
  }

  const history = await listAnalyticsHistory(c.env.DB, tourId, {
    source: 'tour_admin',
    trackingKey: parsed.data.tracking_key,
    publishVersion: parsed.data.publish_version,
    limit: parsed.data.limit,
  })

  return c.json(ok({ tourId, history }))
})

tourAdminAnalytics.post('/', requireAnalyticsIngestKey, async (c) => {
  const tourId = tourIdFromRequest(c)
  if (!isTourId(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  if (!(await tourExistsByPublicId(c.env.DB, tourId))) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = analyticsIngestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const source = parsed.data.source ?? 'tour_admin'
  if (source !== 'tour_admin') {
    return c.json(err('INVALID_INPUT', 'source must be tour_admin for this endpoint'), 422)
  }

  try {
    const publishVersion = await resolvePublishVersion(
      c.env.DB,
      tourId,
      'tour_admin',
      parsed.data.publish_version,
    )
    const result = await upsertAnalyticsSnapshot(c.env.DB, {
      tourId,
      source: 'tour_admin',
      trackingKey: parsed.data.tracking_key,
      publishVersion,
      label: parsed.data.label,
      payload: parsed.data.payload,
      recordedAt: parsed.data.recorded_at,
    })
    return c.json(
      ok({
        tourId,
        created: result.created,
        entry: result.entry,
      }),
      result.created ? 201 : 200,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not save analytics'
    return c.json(err('INVALID_INPUT', message), 422)
  }
})

export { tourAdminAnalytics as tourAdminAnalyticsRoutes }
