// ============================================================
// Analytics proxy — read-only GET to analytics.proppik.cloud
// ============================================================
import { Hono, type Context } from 'hono'
import { authMiddleware, requirePermission } from '../middleware/auth'
import { getTourByIdForOwner, getToursByOwner } from '../services/tours'
import {
  AnalyticsNotConfiguredError,
  AnalyticsUpstreamError,
  fetchAnalyticsHealth,
  fetchAnalyticsJson,
  mergeTourKeysQuery,
  toTourKey,
} from '../services/analytics-proxy'
import { ok, err } from '../utils/response'
import type { Env, Variables } from '../types'

const analytics = new Hono<{ Bindings: Env; Variables: Variables }>()

function queryFromRequest(c: { req: { url: string } }): string {
  return new URL(c.req.url).search.slice(1)
}

async function tourKeysForUser(env: Env, userId: string): Promise<string[]> {
  const tours = await getToursByOwner(env.DB, userId)
  return tours.map((t) => toTourKey(t.tour_id)).filter((k): k is string => k != null)
}

function mapAnalyticsError(c: Context<{ Bindings: Env; Variables: Variables }>, e: unknown) {
  if (e instanceof AnalyticsNotConfiguredError) {
    return c.json(err('SERVICE_UNAVAILABLE', e.message), 503)
  }
  if (e instanceof AnalyticsUpstreamError) {
    const code = e.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_ERROR'
    const httpStatus = e.status === 404 ? 404 : 502
    return c.json(err(code, 'Analytics request failed'), httpStatus)
  }
  return c.json(err('INTERNAL', 'Analytics proxy error'), 500)
}

analytics.get('/ping', authMiddleware, requirePermission('analytics_view'), async (c) => {
  try {
    const online = await fetchAnalyticsHealth(c.env)
    return c.json(ok({ online }))
  } catch (e) {
    return mapAnalyticsError(c, e)
  }
})

analytics.get('/overview', authMiddleware, requirePermission('analytics_view'), async (c) => {
  try {
    const user = c.get('user')
    const keys = await tourKeysForUser(c.env, user.id)
    const q = mergeTourKeysQuery(queryFromRequest(c), keys)
    const data = await fetchAnalyticsJson<Record<string, unknown>>(c.env, '/api/admin/overview', q)
    return c.json(ok(data))
  } catch (e) {
    return mapAnalyticsError(c, e)
  }
})

analytics.get('/projects', authMiddleware, requirePermission('analytics_view'), async (c) => {
  try {
    const user = c.get('user')
    const keys = await tourKeysForUser(c.env, user.id)
    const q = mergeTourKeysQuery(queryFromRequest(c), keys)
    const data = await fetchAnalyticsJson<{ projects: unknown[] }>(c.env, '/api/admin/projects', q)
    return c.json(ok(data))
  } catch (e) {
    return mapAnalyticsError(c, e)
  }
})

async function assertTourAccess(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tourId: string,
): Promise<{ tour: Awaited<ReturnType<typeof getTourByIdForOwner>>; tourKey: string } | Response> {
  const user = c.get('user')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }
  const tourKey = toTourKey(tour.tour_id)
  if (!tourKey) {
    return c.json(err('INVALID_INPUT', 'Invalid tour id'), 422)
  }
  return { tour, tourKey }
}

function tourAdminPath(tourKey: string, suffix: string): string {
  return `/api/admin/tours/${encodeURIComponent(tourKey)}/${suffix.replace(/^\//, '')}`
}

const tourSuffixRoutes = [
  'overview',
  'scenes',
  'sessions',
  'breakdowns',
  'insights',
  'audience-hidden',
  'urls',
  'visitors',
] as const

for (const suffix of tourSuffixRoutes) {
  analytics.get(
    `/tours/:tourId/${suffix}`,
    authMiddleware,
    requirePermission('analytics_view'),
    async (c) => {
      try {
        const tourId = c.req.param('tourId') ?? ''
        const access = await assertTourAccess(c, tourId)
        if (access instanceof Response) return access
        const { tourKey } = access
        const params = new URLSearchParams(queryFromRequest(c))
        const q: Record<string, string | undefined> = {}
        params.forEach((value, key) => {
          q[key] = value
        })
        const data = await fetchAnalyticsJson(c.env, tourAdminPath(tourKey, suffix), q)
        return c.json(ok(data))
      } catch (e) {
        return mapAnalyticsError(c, e)
      }
    },
  )
}

analytics.get(
  '/tours/:tourId/meta',
  authMiddleware,
  requirePermission('analytics_view'),
  async (c) => {
    try {
      const tourId = c.req.param('tourId') ?? ''
      const access = await assertTourAccess(c, tourId)
      if (access instanceof Response) return access
      const { tourKey } = access
      const data = await fetchAnalyticsJson(c.env, `/v1/config/${encodeURIComponent(tourKey)}`, {})
      return c.json(ok(data))
    } catch (e) {
      return mapAnalyticsError(c, e)
    }
  },
)

analytics.get(
  '/sessions/:sid/timeline',
  authMiddleware,
  requirePermission('analytics_view'),
  async (c) => {
    try {
      const sid = c.req.param('sid') ?? ''
      const tourId = c.req.query('tourId') ?? ''
      if (!/^\d{6}$/.test(tourId)) {
        return c.json(err('INVALID_INPUT', 'tourId query required (6 digits)'), 422)
      }
      const access = await assertTourAccess(c, tourId)
      if (access instanceof Response) return access
      const { tourKey } = access
      const params = new URLSearchParams(queryFromRequest(c))
      params.set('tour_key', tourKey)
      const q: Record<string, string | undefined> = {}
      params.forEach((value, key) => {
        q[key] = value
      })
      const data = await fetchAnalyticsJson(
        c.env,
        `/api/admin/sessions/${encodeURIComponent(sid)}/timeline-grouped`,
        q,
      )
      return c.json(ok(data))
    } catch (e) {
      return mapAnalyticsError(c, e)
    }
  },
)

export { analytics as analyticsRoutes }
