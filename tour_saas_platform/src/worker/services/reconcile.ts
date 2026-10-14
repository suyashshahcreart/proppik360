// ============================================================
// Reconcile stuck / pending tour processing jobs.
//
// Called from:
//   - Cron trigger (every few minutes)
//   - POST /api/processor/reconcile (Go startup / manual)
//   - Auth user POST /api/tours/:id/resume
//
// Handles two failure modes:
//   1. status=processing|uploaded but Go never got /jobs (processor
//      down, network blip, fire-and-forget killed) → re-notify
//   2. status=uploading with completed ZIP already in R2 AND no active
//      upload_id (browser never reached /upload/complete, or complete
//      died mid-flight) → flip to processing + notify
//   3. status=uploading with NO ZIP and stale → mark failed so the
//      user can re-upload (cannot process what was never finalized)
//
//   NEVER reconcile status=uploading when upload_id is set — that is an
//   in-progress browser multipart session. A leftover ZIP at the same
//   r2_key from a prior upload still passes objectExists until the new
//   multipart completes and overwrites it.
// ============================================================
import { objectExists, type R2Config } from './r2'
import { hasFinalizedZipDespiteUploading } from './tour-zip-state'
import { notifyProcessor } from './processor-notify'
import { setTourProcessingStarted, updateTour } from './tours'
import { finalizeUploadHistory, startResumeHistoryIfNeeded } from './tour-upload-history'
import type { Env, Tour } from '../types'
import { publicTourId } from '../utils/tour-lookup'

/** How long an uploading tour can sit without a completed ZIP before we fail it. */
export const STALE_UPLOADING_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * True when the browser has an open R2 multipart session (initiate was called
 * and complete/abort has not finished). Reconcile and user "Resume" must not
 * change status while this is true — a leftover ZIP at the same r2_key from a
 * prior upload still returns HEAD 200 until the new multipart completes.
 */
export function hasActiveMultipartUpload(tour: Tour): boolean {
  return tour.status === 'uploading' && Boolean(tour.upload_id)
}

/** Re-dispatch processing tours that have made no progress for this long. */
export const STALE_PROCESSING_MS = 60 * 1000 // 1 minute (covers processor restarts)

export interface ReconcileAction {
  tourId: string
  action:
    | 'notified'
    | 'healed_uploading'
    | 'failed_incomplete_upload'
    | 'skipped'
  detail?: string
}

export interface ReconcileResult {
  actions: ReconcileAction[]
  notified: number
  healed: number
  failed: number
}

function r2Config(env: Env): R2Config {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }
}

/**
 * Tours the Go processor should pick up: ZIP finalized, not yet ready/failed.
 */
export async function listPendingJobTours(db: D1Database): Promise<Tour[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tours
       WHERE deleted_at IS NULL
         AND status IN ('uploaded', 'processing')
         AND r2_key IS NOT NULL
       ORDER BY updated_at ASC`,
    )
    .all<Tour>()
  return result.results
}

/**
 * Stuck uploading tours that may need heal-or-fail.
 */
export async function listUploadingTours(db: D1Database): Promise<Tour[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tours
       WHERE deleted_at IS NULL
         AND status = 'uploading'
         AND r2_key IS NOT NULL
       ORDER BY updated_at ASC`,
    )
    .all<Tour>()
  return result.results
}

/** Ready tours whose backup or Go cleanup has not finished. */
export async function listReadyNeedingFinish(db: D1Database): Promise<Tour[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tours
       WHERE deleted_at IS NULL
         AND status = 'ready'
         AND (backup_completed_at IS NULL OR cleanup_completed_at IS NULL)
       ORDER BY updated_at ASC`,
    )
    .all<Tour>()
  return result.results
}

function isStale(iso: string | null, thresholdMs: number, now: number): boolean {
  if (!iso) return true
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return true
  return now - t >= thresholdMs
}

/**
 * Heal a single tour (used by user-facing resume + bulk reconcile).
 */
export async function resumeTour(
  env: Env,
  tour: Tour,
  options: {
    forceNotify?: boolean
    /** Cron: only fail incomplete uploads after STALE_UPLOADING_MS */
    failStaleUploading?: boolean
    /** User-triggered resume: fail incomplete upload immediately */
    failIncompleteUploadNow?: boolean
  } = {},
): Promise<ReconcileAction> {
  const forceNotify = options.forceNotify ?? false
  const failStaleUploading = options.failStaleUploading ?? true
  const failIncompleteUploadNow = options.failIncompleteUploadNow ?? false
  const now = Date.now()
  const config = r2Config(env)
  const pid = publicTourId(tour)

  if (tour.status === 'ready' || tour.status === 'archived' || tour.status === 'completed') {
    const wantsBackup =
      tour.save_backup_zip === 1 ||
      tour.save_backup_zip === true
    if (tour.status === 'ready' && wantsBackup && !tour.backup_completed_at) {
      const notify = await notifyProcessor(env, pid, 'backup')
      return {
        tourId: pid,
        action: 'notified',
        detail: notify.ok ? 'Retrying ZIP backup' : `Backup notify failed: ${notify.error}`,
      }
    }
    if (tour.status === 'ready' && !tour.cleanup_completed_at) {
      const notify = await notifyProcessor(env, pid, 'cleanup')
      return {
        tourId: pid,
        action: 'notified',
        detail: notify.ok ? 'Retrying Go cleanup' : `Cleanup notify failed: ${notify.error}`,
      }
    }
    return { tourId: pid, action: 'skipped', detail: `status=${tour.status}` }
  }

  if (tour.status === 'ingesting') {
    return {
      tourId: pid,
      action: 'skipped',
      detail: 'Browser ingest still in progress — resume from the upload page',
    }
  }

  if (tour.status === 'uploading') {
    if (!tour.r2_key) {
      return { tourId: pid, action: 'skipped', detail: 'no r2_key' }
    }

    // Never touch in-progress browser multipart uploads unless R2 already holds
    // the finalized ZIP at the expected size (complete succeeded, D1 stale).
    if (hasActiveMultipartUpload(tour)) {
      const finalizedDespiteUploading = await hasFinalizedZipDespiteUploading(env, tour)
      if (!finalizedDespiteUploading) {
        return {
          tourId: pid,
          action: 'skipped',
          detail: 'Active multipart upload in progress',
        }
      }
    }

    const exists = await objectExists(config, tour.r2_key)
    if (exists) {
      await setTourProcessingStarted(env.DB, pid)
      await startResumeHistoryIfNeeded(env.DB, tour, 'Healed uploading — ZIP found, processing started')
      const notify = await notifyProcessor(env, pid)
      return {
        tourId: pid,
        action: 'healed_uploading',
        detail: notify.ok
          ? 'ZIP found — started processing'
          : `ZIP found — processing set, notify failed: ${notify.error}`,
      }
    }

    const shouldFailIncomplete =
      failIncompleteUploadNow ||
      (failStaleUploading && isStale(tour.updated_at, STALE_UPLOADING_MS, now))

    if (shouldFailIncomplete) {
      await updateTour(env.DB, pid, 'failed', {
        processing_error:
          'Upload incomplete — ZIP was never finalized in R2. Please re-upload the tour.',
      })
      await finalizeUploadHistory(env.DB, {
        tourId: pid,
        status: 'failed',
        stage: 'failed',
        errorMessage:
          'Upload incomplete — ZIP was never finalized in R2. Please re-upload the tour.',
      })
      return {
        tourId: pid,
        action: 'failed_incomplete_upload',
        detail: 'No ZIP object; marked failed so user can re-upload',
      }
    }

    return {
      tourId: pid,
      action: 'skipped',
      detail: 'Upload still in progress or ZIP not finalized yet',
    }
  }

  if (tour.status === 'uploaded' || tour.status === 'processing') {
    if (!tour.r2_key) {
      return { tourId: pid, action: 'skipped', detail: 'no r2_key' }
    }

    // Skip re-notify if actively progressing unless forced
    const hasProgress = (tour.progress_current_files ?? 0) > 0
    const stale = isStale(
      tour.updated_at ?? tour.processing_started_at,
      STALE_PROCESSING_MS,
      now,
    )
    if (!forceNotify && hasProgress && !stale) {
      return {
        tourId: pid,
        action: 'skipped',
        detail: 'Actively processing (recent progress)',
      }
    }

    // Ensure status is processing (uploaded → processing)
    if (tour.status === 'uploaded') {
      await setTourProcessingStarted(env.DB, pid)
    }

    await startResumeHistoryIfNeeded(env.DB, tour, 'Re-dispatched to processor')
    const notify = await notifyProcessor(env, pid)
    return {
      tourId: pid,
      action: 'notified',
      detail: notify.ok ? 'Re-dispatched to processor' : `Notify failed: ${notify.error}`,
    }
  }

  if (tour.status === 'failed' || tour.status === 'draft') {
    // Only resume failed if ZIP exists (re-process without re-upload)
    if (tour.status === 'failed' && tour.r2_key) {
      const exists = await objectExists(config, tour.r2_key)
      if (exists) {
        await setTourProcessingStarted(env.DB, pid)
        await startResumeHistoryIfNeeded(
          env.DB,
          tour,
          'Resume after failure — re-processing existing ZIP',
        )
        const notify = await notifyProcessor(env, pid)
        return {
          tourId: pid,
          action: 'notified',
          detail: notify.ok
            ? 'Re-processing failed tour with existing ZIP'
            : `Notify failed: ${notify.error}`,
        }
      }
    }
    return { tourId: pid, action: 'skipped', detail: `status=${tour.status}` }
  }

  return { tourId: pid, action: 'skipped', detail: `status=${tour.status}` }
}

/**
 * Full reconcile pass used by cron and processor startup.
 */
export async function reconcilePendingJobs(env: Env): Promise<ReconcileResult> {
  const actions: ReconcileAction[] = []

  const uploading = await listUploadingTours(env.DB)
  for (const tour of uploading) {
    try {
      actions.push(await resumeTour(env, tour, { failStaleUploading: true }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[reconcile] uploading tour=${publicTourId(tour)}: ${msg}`)
      actions.push({ tourId: publicTourId(tour), action: 'skipped', detail: msg })
    }
  }

  const pending = await listPendingJobTours(env.DB)
  for (const tour of pending) {
    try {
      // Only re-notify stale / no-progress tours; Go also dedupes in-flight IDs.
      actions.push(await resumeTour(env, tour, { forceNotify: false }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[reconcile] pending tour=${publicTourId(tour)}: ${msg}`)
      actions.push({ tourId: publicTourId(tour), action: 'skipped', detail: msg })
    }
  }

  const finishing = await listReadyNeedingFinish(env.DB)
  for (const tour of finishing) {
    try {
      actions.push(await resumeTour(env, tour, { forceNotify: true }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[reconcile] finish tour=${publicTourId(tour)}: ${msg}`)
      actions.push({ tourId: publicTourId(tour), action: 'skipped', detail: msg })
    }
  }

  const result: ReconcileResult = {
    actions,
    notified: actions.filter((a) => a.action === 'notified').length,
    healed: actions.filter((a) => a.action === 'healed_uploading').length,
    failed: actions.filter((a) => a.action === 'failed_incomplete_upload').length,
  }

  console.log(
    `[reconcile] done notified=${result.notified} healed=${result.healed} failed=${result.failed} total=${actions.length}`,
  )
  return result
}
