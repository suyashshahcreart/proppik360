// ============================================================
// Hono API app (shared by Cloudflare Worker and Node server)
// ============================================================
import { Hono } from 'hono'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { tourRoutes } from './routes/tours'
import { uploadRoutes } from './routes/uploads'
import { ingestRoutes } from './routes/ingest'
import { processorRoutes } from './routes/processor'
import { customerRoutes } from './routes/customers'
import { systemRoutes } from './routes/system'
import { mediaRoutes } from './routes/media'
import { propertyTypeRoutes } from './routes/property-types'
import { processorStatusRoutes } from './routes/processor-status'
import type { Env, Variables } from './types'

export const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('/api/*', async (c, next) => {
  const requestOrigin = c.req.header('Origin')
  const allowedOrigin = c.env.CORS_ORIGIN

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':
          requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    })
  }

  await next()

  if (requestOrigin === allowedOrigin) {
    c.header('Access-Control-Allow-Origin', requestOrigin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin')
  }
})

app.route('/api/auth', authRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/tours', tourRoutes)
app.route('/api/tours', ingestRoutes)
app.route('/api/tours', uploadRoutes)
app.route('/api/processor', processorRoutes)
app.route('/api/customers', customerRoutes)
app.route('/api/system/media', mediaRoutes)
app.route('/api/system', propertyTypeRoutes)
app.route('/api/system', processorStatusRoutes)
app.route('/api/system', systemRoutes)

app.get('/health', (c) => c.json({ ok: true, service: 'proppik360-api' }))

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
    },
    404,
  )
})

app.onError((error, c) => {
  const isProduction = c.env?.ENVIRONMENT === 'production'
  console.error('[api] Unhandled error:', error.message)
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'An internal error occurred' : error.message,
      },
    },
    500,
  )
})
