// ============================================================
// Artifact ingest routes (tour_admin ZIP) — does NOT touch tours.status
//
//   POST /api/tours/:tourId/artifacts/tour_admin/ingest/initiate
//   PUT  /api/tours/:tourId/artifacts/tour_admin/ingest/chunk
//   POST /api/tours/:tourId/artifacts/tour_admin/ingest/complete
//   POST /api/tours/:tourId/artifacts/tour_admin/ingest/abort
//   GET  /api/tours/:tourId/artifacts/tour_admin/ingest/status
//   GET  /api/tours/:tourId/artifacts/tour_admin/history
//   GET  /api/tours/:tourId/artifacts/tour_admin/publish-info
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requireAnyPermission, requirePermission } from '../middleware/auth'
import { getTourByIdForOwner } from '../services/tours'
import {
  goAdminIngestAbort,
  goAdminIngestChunk,
  goAdminIngestComplete,
  goAdminIngestInit,
  goAdminIngestStatus,
} from '../services/processor-ingest-admin'
import {
  ARTIFACT_TYPE_TOUR_ADMIN,
  adminPublishUrl,
  backupVersionLabel,
} from '../services/admin-paths'
import { DEFAULT_INGEST_CHUNK_BYTES } from '../services/tour-paths'
import {
  appendArtifactUploadHistoryStage,
  finalizeArtifactUploadHistory,
  listArtifactUploadHistory,
  startArtifactUploadHistory,
} from '../services/artifact-upload-history'
import {
  getTourArtifact,
  markTourArtifactFailed,
  upsertTourArtifactSession,
} from '../services/tour-artifacts'
import { ok, err } from '../utils/response'
import { initiateUploadSchema } from '../utils/validation'
import type { Env, Variables } from '../types'

const artifactIngest = new Hono<{ Bindings: Env; Variables: Variables }>()

const ARTIFACT = ARTIFACT_TYPE_TOUR_ADMIN

function requireAdminBucket(env: Env): string | null {
  if (!env.R2_ADMIN_BUCKET_NAME?.trim() || !env.ADMIN_BUCKET) {
    return 'Admin R2 bucket is not configured (set R2_ADMIN_BUCKET_NAME)'
  }
  if (!env.R2_ADMIN_PUBLIC_DOMAIN?.trim()) {
    return 'Admin public domain is not configured (set R2_ADMIN_PUBLIC_DOMAIN)'
  }
  return null
}

async function countPriorArtifactVersions(
  db: D1Database,
  tourId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM artifact_upload_sessions
        WHERE tour_id = ? AND artifact_type = ?
          AND stage NOT IN ('ingesting', 'aborted')`,
    )
    .bind(tourId, ARTIFACT)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function getActiveSession(db: D1Database, tourId: string) {
  return (
    (await db
      .prepare(
        `SELECT * FROM artifact_upload_sessions
          WHERE tour_id = ? AND artifact_type = ? AND stage = 'ingesting'
          ORDER BY started_at DESC LIMIT 1`,
      )
      .bind(tourId, ARTIFACT)
      .first<{
        id: string
        stage: string
        bytes_received: number
      }>()) ?? null
  )
}

artifactIngest.post(
  `/:tourId/artifacts/${ARTIFACT}/ingest/initiate`,
  authMiddleware,
  requirePermission('tour_admin_upload'),
  async (c) => {
    const bucketErr = requireAdminBucket(c.env)
    if (bucketErr) return c.json(err('MISCONFIGURED', bucketErr), 503)

    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

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
      return c.json(
        err('INVALID_INPUT', `File requires ${totalChunks} chunks which exceeds 10,000`),
        422,
      )
    }

    // Abort any prior in-progress admin ingest for this tour
    const prior = await getActiveSession(c.env.DB, tour.tour_id)
    if (prior) {
      try {
        await goAdminIngestAbort(c.env, tour.tour_id)
      } catch {
        /* ignore */
      }
      const nowAbort = new Date().toISOString()
      await c.env.DB
        .prepare(
          `UPDATE artifact_upload_sessions
              SET stage = 'aborted', error = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind('Superseded by new upload', nowAbort, prior.id)
        .run()
    }

    const sessionId = crypto.randomUUID()
    const version = backupVersionLabel(await countPriorArtifactVersions(c.env.DB, tour.tour_id))
    const now = new Date().toISOString()

    let go: Awaited<ReturnType<typeof goAdminIngestInit>>
    try {
      go = await goAdminIngestInit(c.env, tour.tour_id, {
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
        `INSERT INTO artifact_upload_sessions (
           id, tour_id, artifact_type, original_filename, file_size, chunk_size, total_chunks,
           bytes_received, backup_version, save_backup_zip, temp_zip_path, stage, started_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ingesting', ?, ?)`,
      )
      .bind(
        sessionId,
        tour.tour_id,
        ARTIFACT,
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

    await startArtifactUploadHistory(c.env.DB, {
      tourId: tour.tour_id,
      artifactType: ARTIFACT,
      uploadSessionId: sessionId,
      originalFilename: filename,
      fileSize,
      backupVersion: version,
      path: 'go_first',
      stage: 'ingesting',
      note: 'Admin package ZIP ingest started',
    })

    await upsertTourArtifactSession(c.env.DB, {
      tourId: tour.tour_id,
      artifactType: ARTIFACT,
      uploadSessionId: sessionId,
      status: 'ingesting',
    })

    return c.json(
      ok({
        sessionId,
        chunkSizeBytes: chunkSize,
        totalChunks,
        backupVersion: version,
        artifactType: ARTIFACT,
      }),
    )
  },
)

artifactIngest.put(
  `/:tourId/artifacts/${ARTIFACT}/ingest/chunk`,
  authMiddleware,
  requirePermission('tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const session = await getActiveSession(c.env.DB, tour.tour_id)
    if (!session) {
      return c.json(err('CONFLICT', 'No active admin ingest session'), 409)
    }

    const sessionId = c.req.header('X-Session-Id') ?? ''
    const chunkRaw = c.req.header('X-Chunk-Number') ?? ''
    const chunkNumber = Number.parseInt(chunkRaw, 10)
    if (!sessionId || !Number.isFinite(chunkNumber) || chunkNumber < 1) {
      return c.json(err('INVALID_INPUT', 'X-Session-Id and X-Chunk-Number are required'), 422)
    }
    if (session.id !== sessionId) {
      return c.json(err('FORBIDDEN', 'Session does not match this tour'), 403)
    }

    try {
      const result = await goAdminIngestChunk(
        c.env,
        tour.tour_id,
        chunkNumber,
        c.req.raw.body,
        c.req.header('Content-Length') ?? null,
      )
      const now = new Date().toISOString()
      await c.env.DB
        .prepare(
          `UPDATE artifact_upload_sessions SET bytes_received = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(result.bytesReceived, now, sessionId)
        .run()
      return c.json(ok(result))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
    }
  },
)

artifactIngest.post(
  `/:tourId/artifacts/${ARTIFACT}/ingest/complete`,
  authMiddleware,
  requirePermission('tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const session = await getActiveSession(c.env.DB, tour.tour_id)
    if (!session) {
      return c.json(err('CONFLICT', 'No ingest session to complete'), 409)
    }

    try {
      const result = await goAdminIngestComplete(c.env, tour.tour_id)
      const now = new Date().toISOString()
      await c.env.DB
        .prepare(
          `UPDATE artifact_upload_sessions
              SET stage = 'extracting', temp_zip_path = COALESCE(?, temp_zip_path), updated_at = ?
            WHERE id = ?`,
        )
        .bind(result.zipPath ?? null, now, session.id)
        .run()
      await upsertTourArtifactSession(c.env.DB, {
        tourId: tour.tour_id,
        artifactType: ARTIFACT,
        uploadSessionId: session.id,
        status: 'processing',
      })
      await appendArtifactUploadHistoryStage(
        c.env.DB,
        tour.tour_id,
        ARTIFACT,
        'extracting',
        'Ingest complete — admin package processing started',
      )
      return c.json(ok({ message: 'Admin ingest complete — processing started', ...result }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
    }
  },
)

artifactIngest.post(
  `/:tourId/artifacts/${ARTIFACT}/ingest/abort`,
  authMiddleware,
  requirePermission('tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    try {
      await goAdminIngestAbort(c.env, tour.tour_id)
    } catch (e) {
      console.warn('[artifact-ingest] abort go failed', e)
    }
    const now = new Date().toISOString()
    const session = await getActiveSession(c.env.DB, tour.tour_id)
    if (session) {
      await c.env.DB
        .prepare(
          `UPDATE artifact_upload_sessions SET stage = 'aborted', error = ?, updated_at = ? WHERE id = ?`,
        )
        .bind('Cancelled', now, session.id)
        .run()
    }
    await markTourArtifactFailed(c.env.DB, tour.tour_id, ARTIFACT)
    await finalizeArtifactUploadHistory(c.env.DB, {
      tourId: tour.tour_id,
      artifactType: ARTIFACT,
      status: 'failed',
      stage: 'aborted',
      errorMessage: 'Upload cancelled.',
    })
    return c.json(ok({ message: 'Admin ingest aborted' }))
  },
)

artifactIngest.get(
  `/:tourId/artifacts/${ARTIFACT}/ingest/status`,
  authMiddleware,
  requireAnyPermission('tour_admin_view', 'tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const artifact = await getTourArtifact(c.env.DB, tour.tour_id, ARTIFACT)
    try {
      const status = await goAdminIngestStatus(c.env, tour.tour_id)
      return c.json(
        ok({
          ...(status ?? {
            receivedChunks: [],
            missingChunks: [],
            assembled: false,
            bytesReceived: 0,
          }),
          sessionId: artifact?.upload_session_id ?? status?.sessionId ?? null,
          artifactStatus: artifact?.status ?? null,
          publishUrl: artifact?.publish_url ?? null,
        }),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json(err('PROCESSOR_UNAVAILABLE', message), 503)
    }
  },
)

artifactIngest.get(
  `/:tourId/artifacts/${ARTIFACT}/history`,
  authMiddleware,
  requireAnyPermission('tour_admin_view', 'tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const history = await listArtifactUploadHistory(c.env.DB, tour.tour_id, ARTIFACT)
    return c.json(ok({ tourId: tour.tour_id, artifactType: ARTIFACT, history }))
  },
)

artifactIngest.get(
  `/:tourId/artifacts/${ARTIFACT}/publish-info`,
  authMiddleware,
  requireAnyPermission('tour_admin_view', 'tour_admin_upload'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('tourId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const artifact = await getTourArtifact(c.env.DB, tour.tour_id, ARTIFACT)
    const domain = c.env.R2_ADMIN_PUBLIC_DOMAIN?.trim() ?? ''
    const publishUrl =
      artifact?.publish_url ??
      (domain ? adminPublishUrl(domain, tour.tour_id) : null)

    return c.json(
      ok({
        tourId: tour.tour_id,
        artifactType: ARTIFACT,
        publishUrl,
        status: artifact?.status ?? null,
        lastSuccessAt: artifact?.last_success_at ?? null,
        lastUploadAt: artifact?.last_upload_at ?? null,
        backupKey: artifact?.backup_r2_key ?? null,
        backupVersion: artifact?.backup_version ?? null,
        publicDomain: domain || null,
      }),
    )
  },
)

export { artifactIngest as artifactIngestRoutes }
