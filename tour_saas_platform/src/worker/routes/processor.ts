// ============================================================
// Processor-facing API routes
//
//   GET  /api/processor/tours/:tourId          — get tour + presigned download URL
//   POST /api/processor/tours/:tourId/complete — mark tour as ready
//   POST /api/processor/tours/:tourId/fail     — mark tour as failed
//
// These routes are NOT for browser clients. They are called by the
// Go ZIP processor service running on the VPS.
//
// SECURITY:
//   All routes require the X-Processor-Secret header to match the
//   PROCESSOR_SECRET environment variable. This replaces cookie auth.
//   The secret is set via: wrangler secret put PROCESSOR_SECRET
// ============================================================
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { R2Config } from '../services/r2'
import { updateTour, updateTourProgress } from '../services/tours'
import {
  appendUploadHistoryStage,
  finalizeUploadHistory,
  patchUploadHistoryBackup,
  patchUploadHistoryReady,
} from '../services/tour-upload-history'
import {
  listPendingJobTours,
  reconcilePendingJobs,
} from '../services/reconcile'
import { ok, err } from '../utils/response'
import {
  buildViewerUrl,
  extractSearchFromViewerUrl,
  getToursPathPrefix,
} from '../utils/viewer-url'
import type { Env, Variables } from '../types'

const processor = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── Secret auth middleware ────────────────────────────────────
const processorAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const secret = c.req.header('X-Processor-Secret')
    if (!secret || secret !== c.env.PROCESSOR_SECRET) {
      return c.json(err('UNAUTHORIZED', 'Invalid processor secret'), 401)
    }
    await next()
  },
)

processor.use('*', processorAuth)

// ── GET /api/processor/pending ────────────────────────────────
//
// Returns tour IDs waiting for (or mid) processing. Called by the
// Go processor on startup (and optionally on a timer) to resume work
// after restarts or outages. Duplicate /jobs POSTs are safe — Go
// dedupes in-flight tour IDs.
processor.get('/pending', async (c) => {
  const tours = await listPendingJobTours(c.env.DB)
  return c.json(
    ok({
      tourIds: tours.map((t) => t.id),
      tours: tours.map((t) => ({
        id: t.id,
        status: t.status,
        r2_key: t.r2_key,
        updated_at: t.updated_at,
        processing_started_at: t.processing_started_at,
        progress_current_files: t.progress_current_files,
      })),
    }),
  )
})

// ── POST /api/processor/reconcile ─────────────────────────────
//
// Heal stuck uploading tours (ZIP already in R2) and re-dispatch
// stale processing jobs. Invoked by Go on startup and by cron.
processor.post('/reconcile', async (c) => {
  const result = await reconcilePendingJobs(c.env)
  return c.json(ok(result))
})

// ── GET /api/processor/tours/:tourId ─────────────────────────
//
// Returns the tour row and a presigned 1-hour download URL for
// the original ZIP stored at tours/{tourId}/original.zip.
//
// The Go processor uses this URL to stream-download the ZIP
// without needing direct R2 credentials.
processor.get('/tours/:tourId', async (c) => {
  const tourId = c.req.param('tourId')

  const tour = await c.env.DB
    .prepare('SELECT * FROM tours WHERE tour_id = ?')
    .bind(tourId)
    .first()

  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  if (!tour.r2_key) {
    return c.json(err('CONFLICT', 'Tour has no R2 key — upload not started'), 409)
  }

  // Generate a presigned GET URL for the original ZIP (1 hour expiry)
  const r2Config: R2Config = {
    accountId: c.env.R2_ACCOUNT_ID,
    bucketName: c.env.R2_BUCKET_NAME,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
  }

  const downloadUrl = await getPresignedDownloadUrl(r2Config, tour.r2_key as string)

  return c.json(ok({
    tour,
    downloadUrl,
    publicDomain: c.env.R2_PUBLIC_DOMAIN,
    toursPathPrefix: getToursPathPrefix(c.env.R2_PUBLIC_DOMAIN),
  }))
})

// ── POST /api/processor/tours/:tourId/complete ────────────────
//
// Called by Go processor when all files are uploaded to R2.
// Sets status='ready', stores the viewer URL, and records the time.
processor.post('/tours/:tourId/complete', async (c) => {
  const tourId = c.req.param('tourId')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const { viewerUrl, layout } = body as { viewerUrl?: string; layout?: string }
  if (!viewerUrl || typeof viewerUrl !== 'string') {
    return c.json(err('INVALID_INPUT', 'viewerUrl is required'), 422)
  }

  const search = extractSearchFromViewerUrl(viewerUrl)
  const publicViewerUrl = buildViewerUrl(c.env.R2_PUBLIC_DOMAIN, tourId, search)

  const now = new Date().toISOString()
  const flags = await c.env.DB
    .prepare(`SELECT save_backup_zip FROM tours WHERE tour_id = ?`)
    .bind(tourId)
    .first<{ save_backup_zip: number }>()
  const wantsBackup = (flags?.save_backup_zip ?? 0) === 1
  const postReadyStage = wantsBackup ? 'ready_pending_backup' : 'cleanup'

  await updateTour(c.env.DB, tourId, 'ready', {
    viewer_url: publicViewerUrl,
    processed_at: now,
    ready_at: now,
    processing_error: null,
  })

  await c.env.DB
    .prepare(
      `UPDATE tours SET processing_stage = ?, updated_at = ? WHERE tour_id = ?`,
    )
    .bind(postReadyStage, now, tourId)
    .run()

  if (layout === 'flat') {
    await c.env.DB
      .prepare(
        `UPDATE upload_sessions SET stage = ?, updated_at = ?
          WHERE tour_id = ? AND stage NOT IN ('aborted', 'completed')`,
      )
      .bind(postReadyStage, now, tourId)
      .run()
  }

  await patchUploadHistoryReady(c.env.DB, tourId, {
    viewerUrl: publicViewerUrl,
    layout: layout ?? null,
    stage: postReadyStage,
  })

  console.log(`[processor] Ready: tour=${tourId} viewerUrl=${publicViewerUrl}`)

  // Future: ctx.waitUntil(notifyUserTourReady(tourId)) — email/SMS after ready.
  return c.json(ok({ message: 'Tour marked as ready' }))
})

// ── POST /api/processor/tours/:tourId/progress ───────────────
//
// Called by the Go processor every ~2 seconds while uploading files.
// Updates the four progress counters WITHOUT changing the status field.
// The frontend polls /api/tours to get these values and renders a progress bar.
processor.post('/tours/:tourId/progress', async (c) => {
  const tourId = c.req.param('tourId')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const {
    currentFiles,
    totalFiles,
    currentBytes,
    totalBytes,
    stage,
  } = body as {
    currentFiles?: number
    totalFiles?: number
    currentBytes?: number
    totalBytes?: number
    stage?: string
  }

  if (
    typeof currentFiles !== 'number' ||
    typeof totalFiles !== 'number' ||
    typeof currentBytes !== 'number' ||
    typeof totalBytes !== 'number'
  ) {
    return c.json(
      err('INVALID_INPUT', 'currentFiles, totalFiles, currentBytes, totalBytes are all required numbers'),
      422,
    )
  }

  const allowedStages = new Set([
    'queued',
    'downloading',
    'ingesting',
    'extracting',
    'publishing',
    'uploading_assets',
    'finalizing',
    'ready_pending_backup',
    'backing_up',
    'cleanup',
    'completed',
  ])
  const normalizedStage =
    typeof stage === 'string' && allowedStages.has(stage)
      ? (stage as
          | 'queued'
          | 'downloading'
          | 'ingesting'
          | 'extracting'
          | 'publishing'
          | 'uploading_assets'
          | 'finalizing'
          | 'ready_pending_backup'
          | 'backing_up'
          | 'cleanup'
          | 'completed')
      : undefined

  await updateTourProgress(c.env.DB, tourId, {
    currentFiles,
    totalFiles,
    currentBytes,
    totalBytes,
    stage: normalizedStage,
  })

  if (normalizedStage) {
    await appendUploadHistoryStage(c.env.DB, tourId, normalizedStage, undefined, {
      currentFiles,
      totalFiles,
      currentBytes,
      totalBytes,
    })
  }

  return c.json(ok({ message: 'Progress updated' }))
})

// ── POST /api/processor/tours/:tourId/fail ────────────────────
//
// Called by Go processor when processing fails for any reason.
// Sets status='failed' and stores the error message.
processor.post('/tours/:tourId/fail', async (c) => {
  const tourId = c.req.param('tourId')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const { error } = body as { error?: string }
  if (!error || typeof error !== 'string') {
    return c.json(err('INVALID_INPUT', 'error message is required'), 422)
  }

  await updateTour(c.env.DB, tourId, 'failed', {
    processing_error: error,
  })

  await finalizeUploadHistory(c.env.DB, {
    tourId,
    status: 'failed',
    stage: 'failed',
    errorMessage: error,
  })

  console.error(`[processor] Failed: tour=${tourId} error=${error}`)

  return c.json(ok({ message: 'Tour marked as failed' }))
})

// ── POST /api/processor/tours/:tourId/backup-complete ─────────
processor.post('/tours/:tourId/backup-complete', async (c) => {
  const tourId = c.req.param('tourId')
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }
  const { backupKey, version } = body as { backupKey?: string; version?: string }
  if (!backupKey) {
    return c.json(err('INVALID_INPUT', 'backupKey is required'), 422)
  }
  const now = new Date().toISOString()
  await c.env.DB
    .prepare(
      `UPDATE tours
          SET backup_completed_at = ?,
              r2_key = ?,
              processing_stage = 'cleanup',
              updated_at = ?
        WHERE tour_id = ?`,
    )
    .bind(now, backupKey, now, tourId)
    .run()
  await c.env.DB
    .prepare(
      `UPDATE upload_sessions
          SET backup_r2_key = ?,
              backup_version = COALESCE(?, backup_version),
              stage = 'cleanup',
              updated_at = ?
        WHERE tour_id = ? AND stage NOT IN ('aborted')`,
    )
    .bind(backupKey, version ?? null, now, tourId)
    .run()
  await patchUploadHistoryBackup(c.env.DB, tourId, backupKey, version ?? null)
  return c.json(ok({ message: 'Backup recorded' }))
})

// ── POST /api/processor/tours/:tourId/completed ───────────────
processor.post('/tours/:tourId/completed', async (c) => {
  const tourId = c.req.param('tourId')
  const now = new Date().toISOString()
  await updateTour(c.env.DB, tourId, 'completed', {
    cleanup_completed_at: now,
    upload_session_id: null,
  })
  await c.env.DB
    .prepare(`UPDATE tours SET processing_stage = 'completed', updated_at = ? WHERE tour_id = ?`)
    .bind(now, tourId)
    .run()
  await c.env.DB
    .prepare(
      `UPDATE upload_sessions
          SET stage = 'completed', completed_at = ?, updated_at = ?
        WHERE tour_id = ? AND stage NOT IN ('aborted')`,
    )
    .bind(now, now, tourId)
    .run()
  await finalizeUploadHistory(c.env.DB, {
    tourId,
    status: 'success',
    stage: 'completed',
  })
  console.log(`[processor] Fully completed: tour=${tourId}`)
  return c.json(ok({ message: 'Tour marked as completed' }))
})

// ── Presigned GET URL helper ──────────────────────────────────
//
// Generates a presigned URL for downloading (GET) a specific R2 object.
// Uses the same AwsClient signing approach as getPresignedPartUrl,
// but with method=GET instead of PUT.
async function getPresignedDownloadUrl(
  config: R2Config,
  r2Key: string,
): Promise<string> {
  // Reuse the aws4fetch AwsClient signing from r2 service
  const { AwsClient } = await import('aws4fetch')
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  })

  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${r2Key}`,
  )
  url.searchParams.set('X-Amz-Expires', '3600')

  const signed = await client.sign(
    new Request(url.toString(), { method: 'GET' }),
    { aws: { signQuery: true } },
  )

  return signed.url
}

export { processor as processorRoutes }
