/**
 * PropPik 360 API — Node server (no Wrangler).
 * Database: SQLite file on D: (see SQLITE_PATH / data/platform.sqlite).
 * Storage: Cloudflare R2 via S3 API keys only.
 */
import { serve } from '@hono/node-server'
import { app } from '../worker/app'
import { reconcilePendingJobs } from '../worker/services/reconcile'
import { createRuntimeEnv, DEFAULT_SQLITE_PATH } from './env'

const env = createRuntimeEnv()
const port = Number(process.env.PORT ?? 8787)

const RECONCILE_MS = 5 * 60 * 1000
setInterval(() => {
  void reconcilePendingJobs(env).catch((e: Error) => {
    console.error('[reconcile]', e.message)
  })
}, RECONCILE_MS)

console.log(`[api] SQLite: ${DEFAULT_SQLITE_PATH}`)
console.log(`[api] Listening on http://127.0.0.1:${port}`)
console.log(`[api] Health: http://127.0.0.1:${port}/health`)

serve({
  fetch: (request) => app.fetch(request, env),
  port,
  hostname: '127.0.0.1',
})
