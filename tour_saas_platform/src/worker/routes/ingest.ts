// ============================================================
// Go-first ingest routes (primary upload path)
//
//   POST /api/tours/:tourId/ingest/initiate
//   PUT  /api/tours/:tourId/ingest/chunk
//   POST /api/tours/:tourId/ingest/complete
//   POST /api/tours/:tourId/ingest/abort
//   GET  /api/tours/:tourId/ingest/status
//
// Legacy R2 multipart routes in uploads.ts stay available for
// in-flight uploads started before this pipeline.
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission } from '../middleware/auth'
import { getTourByIdForOwner, updateTour } from '../services/tours'
import {
  goIngestAbort,
  goIngestChunk,
  goIngestComplete,
  goIngestInit,
  goIngestStatus,
} from '../services/processor-ingest'
import { backupVersionLabel, DEFAULT_INGEST_CHUNK_BYTES } from '../services/tour-paths'
import { ok, err } from '../utils/response'
import { initiateUploadSchema } from '../utils/validation'
import type { Env, Variables } from '../types'

const ingest = new Hono<{ Bindings: Env; Variables: Variables }>()

async function countPriorVersions(db: D1Database, tourId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM upload_sessions
        WHERE tour_id = ? AND stage NOT IN ('ingesting', 'aborted')`,
    )
    .bind(tourId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

ingest.post('/:tourId/ingest/initiate', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

  const allowed = tour.status === 'draft' || tour.status === 'failed' || tour.status === 'completed' || tour.status === 'ready'
  if (!allowed && tour.status !== 'ingesting') {
    return c.json(err('CONFLICT', `Cannot start ingest: tour status is '${tour.status}'`), 409)
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

  const { filename, fileSize, saveBackupZip } = parsed.data
  const saveBackupZipFlag = saveBackupZip ? 1 : 0
  const chunkSize = parseInt(c.env.PART_SIZE_BYTES, 10) || DEFAULT_INGEST_CHUNK_BYTES
  const totalChunks = Math.ceil(fileSize / chunkSize)
  if (totalChunks > 10000) {
    return c.json(err('INVALID_INPUT', `File requires ${totalChunks} chunks which exceeds 10,000`), 422)
  }

  const sessionId = crypto.randomUUID()
  const version = backupVersionLabel(await countPriorVersions(c.env.DB, tourId))
  const now = new Date().toISOString()

  let go: Awaited<ReturnType<typeof goIngestInit>>
  try {
    go = await goIngestInit(c.env, tourId, {
      sessionId,
      filename,
      fileSize,
      chunkSize,
      totalChunks,
      backupVersion: version,
      saveBackupZip: saveBackupZipFlag === 1,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
  }

  await c.env.DB
    .prepare(
      `INSERT INTO upload_sessions (
         id, tour_id, original_filename, file_size, chunk_size, total_chunks,
         bytes_received, backup_version, save_backup_zip, temp_zip_path, stage, started_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ingesting', ?, ?)`,
    )
    .bind(
      sessionId,
      tourId,
      filename,
      fileSize,
      chunkSize,
      totalChunks,
      version,
      saveBackupZipFlag,
      go.zipPath ?? null,
      now,
      now,
    )
    .run()

  const { startUploadHistory } = await import('../services/tour-upload-history')
  await startUploadHistory(c.env.DB, {
    tourId,
    uploadSessionId: sessionId,
    originalFilename: filename,
    fileSize,
    backupVersion: version,
    path: 'go_first',
    stage: 'ingesting',
    note: 'ZIP ingest started',
  })

  await updateTour(c.env.DB, tourId, 'ingesting', {
    upload_id: null,
    upload_session_id: sessionId,
    original_filename: filename,
    file_size: fileSize,
    processing_error: null,
    r2_key: null,
  })
  await c.env.DB
    .prepare(`UPDATE tours SET save_backup_zip = ?, updated_at = ? WHERE tour_id = ?`)
    .bind(saveBackupZipFlag, now, tourId)
    .run()
  await c.env.DB
    .prepare(
      `UPDATE tours
          SET processing_stage = 'ingesting',
              processing_started_at = NULL,
              progress_current_files = 0,
              progress_total_files = 0,
              progress_current_bytes = 0,
              progress_total_bytes = 0,
              updated_at = ?
        WHERE tour_id = ?`,
    )
    .bind(now, tourId)
    .run()

  return c.json(
    ok({
      sessionId,
      chunkSizeBytes: chunkSize,
      totalChunks,
      backupVersion: version,
    }),
  )
})

ingest.put('/:tourId/ingest/chunk', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  if (tour.status !== 'ingesting') {
    return c.json(err('CONFLICT', `Tour is not ingesting (status is '${tour.status}')`), 409)
  }

  const sessionId = c.req.header('X-Session-Id') ?? ''
  const chunkRaw = c.req.header('X-Chunk-Number') ?? ''
  const chunkNumber = Number.parseInt(chunkRaw, 10)
  if (!sessionId || !Number.isFinite(chunkNumber) || chunkNumber < 1) {
    return c.json(err('INVALID_INPUT', 'X-Session-Id and X-Chunk-Number are required'), 422)
  }
  if (tour.upload_session_id !== sessionId) {
    return c.json(err('FORBIDDEN', 'Session does not match this tour'), 403)
  }

  try {
    const result = await goIngestChunk(
      c.env,
      tourId,
      chunkNumber,
      c.req.raw.body,
      c.req.header('Content-Length') ?? null,
    )
    const now = new Date().toISOString()
    await c.env.DB
      .prepare(
        `UPDATE upload_sessions SET bytes_received = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(result.bytesReceived, now, sessionId)
      .run()
    await c.env.DB
      .prepare(`UPDATE tours SET updated_at = ? WHERE tour_id = ?`)
      .bind(now, tourId)
      .run()
    return c.json(ok(result))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
  }
})

ingest.post('/:tourId/ingest/complete', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  if (tour.status !== 'ingesting' || !tour.upload_session_id) {
    return c.json(err('CONFLICT', 'No ingest session to complete'), 409)
  }

  try {
    const result = await goIngestComplete(c.env, tourId)
    const now = new Date().toISOString()
    await c.env.DB
      .prepare(
        `UPDATE upload_sessions
            SET stage = 'extracting', temp_zip_path = COALESCE(?, temp_zip_path), updated_at = ?
          WHERE id = ?`,
      )
      .bind(result.zipPath ?? null, now, tour.upload_session_id)
      .run()
    await c.env.DB
      .prepare(
        `UPDATE tours
            SET status = 'processing',
                processing_started_at = ?,
                processing_stage = 'extracting',
                processing_error = NULL,
                updated_at = ?
          WHERE tour_id = ?`,
      )
      .bind(now, now, tourId)
      .run()
    const { appendUploadHistoryStage } = await import('../services/tour-upload-history')
    await appendUploadHistoryStage(c.env.DB, tourId, 'extracting', 'Ingest complete — processing started')
    return c.json(ok({ message: 'Ingest complete — processing started', ...result }))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
  }
})

ingest.post('/:tourId/ingest/abort', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

  try {
    await goIngestAbort(c.env, tourId)
  } catch (e) {
    console.warn('[ingest] abort go failed', e)
  }
  const now = new Date().toISOString()
  if (tour.upload_session_id) {
    await c.env.DB
      .prepare(`UPDATE upload_sessions SET stage = 'aborted', error = ?, updated_at = ? WHERE id = ?`)
      .bind('Cancelled', now, tour.upload_session_id)
      .run()
  }
  await updateTour(c.env.DB, tourId, 'failed', {
    processing_error: 'Upload cancelled.',
    upload_session_id: null,
  })
  const { finalizeUploadHistory } = await import('../services/tour-upload-history')
  await finalizeUploadHistory(c.env.DB, {
    tourId,
    status: 'failed',
    stage: 'aborted',
    errorMessage: 'Upload cancelled.',
  })
  return c.json(ok({ message: 'Ingest aborted' }))
})

ingest.get('/:tourId/ingest/status', authMiddleware, requirePermission('tour_view'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('tourId')
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

  try {
    const status = await goIngestStatus(c.env, tourId)
    return c.json(
      ok({
        ...(status ?? { receivedChunks: [], missingChunks: [], assembled: false, bytesReceived: 0 }),
        sessionId: tour.upload_session_id,
      }),
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
  }
})

export { ingest as ingestRoutes }
