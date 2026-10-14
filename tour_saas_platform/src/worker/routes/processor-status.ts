// ============================================================
// Processor connectivity status (browser-facing)
//
//   GET /api/system/processor-health
//
// Alias of /api/tours/processor-status for Upload page convenience.
// Uses shared checkProcessorHealth from processor-notify.
// ============================================================
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { checkProcessorHealth } from '../services/processor-notify'
import { ok } from '../utils/response'
import type { Env, Variables } from '../types'

const processorStatus = new Hono<{ Bindings: Env; Variables: Variables }>()

processorStatus.get('/processor-health', authMiddleware, async (c) => {
  const health = await checkProcessorHealth(c.env)
  return c.json(
    ok({
      connected: health.online,
      online: health.online,
      latencyMs: health.latencyMs,
      checkedAt: health.checkedAt,
      attempts: health.attempts,
      healthUrl: health.healthUrl,
      message: health.online
        ? 'Upload worker server (Go) is connected'
        : 'Upload worker server (Go) is not connected',
      detail: health.error ?? null,
      hint: health.online
        ? null
        : 'Start tour_processor so it listens on PROCESSOR_WEBHOOK_URL (default http://127.0.0.1:9000), then refresh this page.',
      webhookConfigured: Boolean(c.env.PROCESSOR_WEBHOOK_URL),
    }),
  )
})

export { processorStatus as processorStatusRoutes }
