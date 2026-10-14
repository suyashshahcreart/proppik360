// ============================================================
// Dashboard routes
//
//   GET /api/dashboard/stats — tour counts + recent tours
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission } from '../middleware/auth'
import { ok } from '../utils/response'
import type { Env, Variables } from '../types'

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── GET /api/dashboard/stats ──────────────────────────────────
dashboard.get('/stats', authMiddleware, requirePermission('dashboard_view'), async (c) => {
  const user = c.get('user')

  // Count tours by status for this user in a single query
  const countsResult = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
     FROM tours
     WHERE owner_id = ? AND deleted_at IS NULL
     GROUP BY status`,
  )
    .bind(user.id)
    .all<{ status: string; count: number }>()

  // Build a summary object from the grouped results
  const stats = {
    total: 0,
    uploading: 0,
    uploaded: 0,
    ready: 0,
    failed: 0,
  }

  for (const row of countsResult.results) {
    stats.total += row.count
    if (row.status === 'uploading' || row.status === 'ingesting') stats.uploading += row.count
    if (row.status === 'uploaded') stats.uploaded += row.count
    if (row.status === 'ready' || row.status === 'completed') stats.ready += row.count
    if (row.status === 'failed') stats.failed += row.count
  }

  // Fetch the 5 most recently created tours
  const recentResult = await c.env.DB.prepare(
    `SELECT id, name, status, file_size, original_filename, created_at, updated_at
     FROM tours
     WHERE owner_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 5`,
  )
    .bind(user.id)
    .all<{
      id: string
      name: string
      status: string
      file_size: number | null
      original_filename: string | null
      created_at: string
      updated_at: string
    }>()

  return c.json(
    ok({
      stats,
      recentTours: recentResult.results,
    }),
  )
})

export { dashboard as dashboardRoutes }
