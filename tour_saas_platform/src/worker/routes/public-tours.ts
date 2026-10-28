// ============================================================
// Open tours catalog — no login, no token
//
//   GET  /api/public/tours
//   POST /api/public/tours/:tourId/analytics
// ============================================================
import { Hono } from 'hono'
import { ok, err } from '../utils/response'
import { requireAnalyticsIngestKey } from '../middleware/analytics-ingest'
import {
  resolvePublishVersion,
  tourExistsByPublicId,
  upsertAnalyticsSnapshot,
} from '../services/tour-analytics'
import { analyticsIngestSchema } from '../utils/validation'
import { listPublicTours, parsePublicTourFilters } from '../services/public-tours'
import { listPublicCustomers, parsePublicCustomerFilters } from '../services/public-customers'
import type { Env, Variables } from '../types'

const publicTours = new Hono<{ Bindings: Env; Variables: Variables }>()

publicTours.get('/tours', async (c) => {
  const parsed = parsePublicTourFilters({
    tour_id: c.req.query('tour_id'),
    customer_id: c.req.query('customer_id'),
    client: c.req.query('client'),
    date_from: c.req.query('date_from'),
    date_to: c.req.query('date_to'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    page: c.req.query('page'),
    per_page: c.req.query('per_page'),
  })
  if (!parsed.ok) {
    return c.json(err('INVALID_INPUT', parsed.message), 422)
  }

  const result = await listPublicTours(c.env.DB, c.env.R2_PUBLIC_DOMAIN, parsed.filters)
  return c.json(
    ok({
      items: result.items,
      total: result.total,
      page: result.page,
      per_page: result.per_page,
    }),
  )
})

publicTours.get('/customers', async (c) => {
  const parsed = parsePublicCustomerFilters({
    customer_id: c.req.query('customer_id'),
    client: c.req.query('client'),
    date_from: c.req.query('date_from'),
    date_to: c.req.query('date_to'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    page: c.req.query('page'),
    per_page: c.req.query('per_page'),
  })
  if (!parsed.ok) {
    return c.json(err('INVALID_INPUT', parsed.message), 422)
  }

  const result = await listPublicCustomers(c.env.DB, parsed.filters)
  return c.json(
    ok({
      items: result.items,
      total: result.total,
      page: result.page,
      per_page: result.per_page,
    }),
  )
})

publicTours.post('/tours/:tourId/analytics', requireAnalyticsIngestKey, async (c) => {
  const tourId = c.req.param('tourId') ?? ''
  if (!/^\d{6}$/.test(tourId)) {
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

  const source = parsed.data.source ?? 'main_tour'
  if (source !== 'main_tour') {
    return c.json(err('INVALID_INPUT', 'source must be main_tour for this endpoint'), 422)
  }

  try {
    const publishVersion = await resolvePublishVersion(
      c.env.DB,
      tourId,
      'main_tour',
      parsed.data.publish_version,
    )
    const result = await upsertAnalyticsSnapshot(c.env.DB, {
      tourId,
      source: 'main_tour',
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

export { publicTours as publicToursRoutes }
