// ============================================================
// Open tours catalog — no login, no token
//
//   GET /api/public/tours
// ============================================================
import { Hono } from 'hono'
import { ok, err } from '../utils/response'
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

export { publicTours as publicToursRoutes }
