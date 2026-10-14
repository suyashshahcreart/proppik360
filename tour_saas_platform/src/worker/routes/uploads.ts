// ============================================================
// R2 multipart upload routes (LEGACY)
//
// The primary path is now Go-first ingest (routes/ingest.ts):
//   browser → Worker → Go temp ZIP → publish → backup.
//
// These endpoints remain so an in-flight browser multipart session
// started before that change can still finish. New uploads should
// not call them.
//
// SECURITY:
//   - All routes require authentication (authMiddleware)
//   - Tour ownership is verified on every request
//   - The R2 key is always server-generated (tours/{tourId}/original.zip)
//   - Clients never receive R2 credentials — only time-limited presigned URLs
//   - The uploadId from D1 is always compared against the client-provided value
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission } from '../middleware/auth'
import {
  initiateMultipartUpload,
  getPresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listMultipartUploadParts,
  type R2Config,
} from '../services/r2'
import {
  getTourByIdForOwner,
  updateTour,
  setTourProcessingStarted,
  touchTourUploadActivity,
} from '../services/tours'
import { notifyProcessor } from '../services/processor-notify'
import { buildTourZipKey, getTourZipState } from '../services/tour-zip-state'
import { ok, err } from '../utils/response'
import {
  initiateUploadSchema,
  partUrlSchema,
  completeUploadSchema,
  abortUploadSchema,
  listPartsSchema,
} from '../utils/validation'
import type { Env, Variables } from '../types'

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>()

/**
 * Build the R2Config object from Worker environment variables.
 * All R2 operations use this config.
 */
function getR2Config(env: Env): R2Config {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }
}

// ── POST /api/tours/:tourId/upload/initiate ───────────────────
//
// Creates the R2 multipart upload session, stores the uploadId in D1,
// and returns upload configuration to the browser.
//
// The browser uses this to know:
//   - the uploadId (needed for part-url requests)
//   - partSizeBytes (how to slice the file)
//   - totalParts (how many iterations to do)
uploads.post('/:tourId/upload/initiate', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')

  // Verify the tour exists and belongs to this user
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = initiateUploadSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const { filename, fileSize, forceReupload = false } = parsed.data

  const zipState = await getTourZipState(c.env, tour)

  // ZIP already finalized — resume processing instead of re-uploading.
  if (zipState.uploadComplete && !forceReupload) {
    return c.json(
      err(
        'CONFLICT',
        'ZIP is already uploaded to R2. Use Resume processing instead of starting a new upload.',
        {
          zipOnR2: true,
          uploadComplete: true,
          canResumeProcessing: zipState.canResumeProcessing,
        },
      ),
      409,
    )
  }

  // Only allow a new multipart session on draft/failed, or explicit re-upload.
  const canInitiate =
    tour.status === 'draft' ||
    tour.status === 'failed' ||
    (forceReupload && zipState.uploadComplete)
  if (!canInitiate) {
    return c.json(
      err('CONFLICT', `Cannot start upload: tour status is '${tour.status}'`),
      409,
    )
  }

  // Calculate part count. R2/S3 limits: max 10,000 parts, min 5 MiB per part.
  const partSizeBytes = parseInt(c.env.PART_SIZE_BYTES, 10) || 10 * 1024 * 1024
  const totalParts = Math.ceil(fileSize / partSizeBytes)

  if (totalParts > 10000) {
    return c.json(
      err(
        'INVALID_INPUT',
        `File requires ${totalParts} parts which exceeds the 10,000 part limit. ` +
          `Increase PART_SIZE_BYTES to at least ${Math.ceil(fileSize / 10000)} bytes.`,
      ),
      422,
    )
  }

  const r2Key = buildTourZipKey(tourId)
  const config = getR2Config(c.env)

  const uploadId = await initiateMultipartUpload(config, r2Key)

  // Persist the upload session in D1. Clear prior processing fields so a
  // re-upload on a failed tour starts clean.
  await updateTour(c.env.DB, tourId, 'uploading', {
    upload_id: uploadId,
    r2_key: r2Key,
    file_size: fileSize,
    original_filename: filename,
    processing_error: null,
  })

  await c.env.DB
    .prepare(
      `UPDATE tours
          SET processing_started_at = NULL,
              processing_stage       = NULL,
              progress_current_files = 0,
              progress_total_files   = 0,
              progress_current_bytes = 0,
              progress_total_bytes   = 0
        WHERE tour_id = ?`,
    )
    .bind(tourId)
    .run()

  const { startUploadHistory } = await import('../services/tour-upload-history')
  await startUploadHistory(c.env.DB, {
    tourId,
    originalFilename: filename,
    fileSize,
    path: 'legacy_multipart',
    stage: 'uploading',
    note: forceReupload ? 'Legacy multipart re-upload started' : 'Legacy multipart upload started',
  })

  console.log(
    `[upload] Initiated: tour=${tourId} uploadId=${uploadId} parts=${totalParts} size=${fileSize}`,
  )

  return c.json(
    ok({
      uploadId,
      r2Key,
      partSizeBytes,
      totalParts,
    }),
  )
})

// ── POST /api/tours/:tourId/upload/part-url ───────────────────
//
// Signs and returns a presigned PUT URL for one specific part.
// The browser calls this for each part, then PUTs the chunk directly to R2.
// After a successful PUT, R2 returns an ETag the browser must save.
uploads.post('/:tourId/upload/part-url', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }
  if (tour.status !== 'uploading') {
    return c.json(
      err(
        'CONFLICT',
        `Tour is not currently uploading (status is '${tour.status}'). ` +
          (tour.status === 'processing'
            ? 'An auto-resume may have started processing while the browser upload was still in progress — cancel and retry the upload from the Tours page.'
            : tour.status === 'failed'
              ? 'Start a new upload session before uploading parts.'
              : 'Call /upload/initiate before uploading parts.'),
      ),
      409,
    )
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = partUrlSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const { partNumber, uploadId } = parsed.data

  // Verify the client-provided uploadId matches what we stored.
  // This prevents a user from generating URLs for another user's upload.
  if (tour.upload_id !== uploadId) {
    return c.json(err('FORBIDDEN', 'Upload ID does not match this tour'), 403)
  }

  if (!tour.r2_key) {
    return c.json(err('INTERNAL_ERROR', 'Tour has no R2 key'), 500)
  }

  const config = getR2Config(c.env)
  const presignedUrl = await getPresignedPartUrl(
    config,
    tour.r2_key,
    uploadId,
    partNumber,
  )

  // Heartbeat so reconcile stale-upload detection sees recent activity.
  c.executionCtx?.waitUntil(touchTourUploadActivity(c.env.DB, tourId))

  return c.json(ok({ presignedUrl }))
})

// ── POST /api/tours/:tourId/upload/list-parts ─────────────────
//
// Returns parts already uploaded to R2 for an active multipart session.
// The browser uses this to resume after network loss or page refresh.
uploads.post('/:tourId/upload/list-parts', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }
  if (tour.status !== 'uploading') {
    return c.json(
      err(
        'CONFLICT',
        `Tour is not currently uploading (status is '${tour.status}').`,
      ),
      409,
    )
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = listPartsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const { uploadId } = parsed.data

  if (tour.upload_id !== uploadId) {
    return c.json(err('FORBIDDEN', 'Upload ID does not match this tour'), 403)
  }

  if (!tour.r2_key) {
    return c.json(err('INTERNAL_ERROR', 'Tour has no R2 key'), 500)
  }

  const config = getR2Config(c.env)
  const parts = await listMultipartUploadParts(config, tour.r2_key, uploadId)

  return c.json(ok({ parts }))
})

// ── POST /api/tours/:tourId/upload/complete ───────────────────
//
// Finalizes the multipart upload by sending all ETags to R2.
// R2 assembles the parts into the final object.
// Updates tour status to 'uploaded' in D1.
uploads.post('/:tourId/upload/complete', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }
  if (tour.status !== 'uploading') {
    return c.json(
      err(
        'CONFLICT',
        `Cannot complete upload: tour status is '${tour.status}', expected 'uploading'. ` +
          'If processing started prematurely, retry the upload from the Tours page.',
      ),
      409,
    )
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = completeUploadSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const { uploadId, parts } = parsed.data

  if (tour.upload_id !== uploadId) {
    return c.json(err('FORBIDDEN', 'Upload ID does not match this tour'), 403)
  }

  if (!tour.r2_key) {
    return c.json(err('INTERNAL_ERROR', 'Tour has no R2 key'), 500)
  }

  const config = getR2Config(c.env)
  await completeMultipartUpload(config, tour.r2_key, uploadId, parts)

  // Set status to 'processing', record start time, and reset progress counters.
  // Keep 'processing' even if Go is down — reconcile / processor startup will resume.
  await setTourProcessingStarted(c.env.DB, tourId)

  const { appendUploadHistoryStage } = await import('../services/tour-upload-history')
  await appendUploadHistoryStage(
    c.env.DB,
    tourId,
    'queued',
    `Multipart complete (${parts.length} parts) — waiting for processor`,
  )

  console.log(`[upload] Completed: tour=${tourId} parts=${parts.length} — notifying processor`)

  // Notify with retries. Await so the client can show an immediate warning if
  // the processor is offline; ZIP is already in R2 either way.
  const notify = await notifyProcessor(c.env, tourId)

  if (!notify.ok) {
    // Schedule extra background attempts after the response (Cloudflare may
    // otherwise freeze the isolate). Status stays 'processing' for auto-resume.
    const retry = notifyProcessor(c.env, tourId)
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(retry)
    }

    return c.json(
      ok({
        message:
          'Upload completed — ZIP stored. Processor is offline; processing will start automatically when it comes back.',
        processorDispatched: false,
        processorError:
          notify.error ??
          'Upload worker server (Go) is not connected. Processing will resume automatically.',
      }),
    )
  }

  return c.json(
    ok({
      message: 'Upload completed — processing started',
      processorDispatched: true,
    }),
  )
})

// ── POST /api/tours/:tourId/upload/abort ──────────────────────
//
// Cancels an in-progress multipart upload.
// Frees the R2 storage reserved for uploaded parts.
// Updates tour status to 'failed' in D1.
uploads.post('/:tourId/upload/abort', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  if (!tour.upload_id || !tour.r2_key) {
    return c.json(err('CONFLICT', 'No active upload to abort'), 409)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = abortUploadSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  if (tour.upload_id !== parsed.data.uploadId) {
    return c.json(err('FORBIDDEN', 'Upload ID does not match this tour'), 403)
  }

  const config = getR2Config(c.env)
  await abortMultipartUpload(config, tour.r2_key, parsed.data.uploadId)

  await updateTour(c.env.DB, tourId, 'failed')

  const { finalizeUploadHistory } = await import('../services/tour-upload-history')
  await finalizeUploadHistory(c.env.DB, {
    tourId,
    status: 'failed',
    stage: 'aborted',
    errorMessage: 'Multipart upload aborted',
  })

  console.log(`[upload] Aborted: tour=${tourId}`)

  return c.json(ok({ message: 'Upload aborted successfully' }))
})

export { uploads as uploadRoutes }
