// ============================================================
// Tour ZIP presence in R2 — drives upload skip / resume UX
// ============================================================
import { tourZipObjectKey } from '../utils/tour-storage'
import { headObject, type R2Config } from './r2'
import { hasActiveMultipartUpload } from './reconcile'
import type { Env, Tour } from '../types'
import { publicTourId } from '../utils/tour-lookup'

/** Server-generated R2 key for a tour's finalized ZIP. */
export function buildTourZipKey(tourId: string): string {
  return tourZipObjectKey(tourId)
}

export interface TourZipState {
  /** Finalized `original.zip` object exists in R2 (HEAD 200). */
  zipOnR2: boolean
  /** Size of the ZIP in R2 (bytes), when known. */
  zipSize: number | null
  /** Last-Modified of the ZIP in R2 (HTTP date string), when known. */
  zipLastModified: string | null
  /** Step 1 done: ZIP finalized and no browser multipart session open. */
  uploadComplete: boolean
  /** User may POST /resume to run Go processing without re-uploading the ZIP. */
  canResumeProcessing: boolean
  /**
   * Slug (tour id) and QR code may still change — only while no ZIP has been
   * uploaded and no viewer/R2 path has been established.
   */
  canEditIdentity: boolean
  /** Go ingest session start (from upload_sessions.started_at), for pipeline timing. */
  upload_started_at: string | null
}

/**
 * True when slug / QR must stay fixed (ZIP uploaded at least once, or R2/viewer
 * paths already exist, or upload/processing is in flight).
 */
export function isTourIdentityLocked(tour: Tour, zip?: Pick<TourZipState, 'zipOnR2' | 'uploadComplete'>): boolean {
  if (zip?.uploadComplete || zip?.zipOnR2) return true
  if (tour.r2_key || tour.viewer_url) return true
  return (
    tour.status === 'uploading' ||
    tour.status === 'uploaded' ||
    tour.status === 'ingesting' ||
    tour.status === 'processing' ||
    tour.status === 'ready' ||
    tour.status === 'completed'
  )
}

export type TourWithZipState = Tour & TourZipState

function r2Config(env: Env): R2Config {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }
}

/** Statuses where processing can resume when the ZIP is already in R2. */
function isResumeEligibleStatus(status: Tour['status']): boolean {
  return (
    status === 'failed' ||
    status === 'uploading' ||
    status === 'ingesting' ||
    status === 'uploaded' ||
    status === 'processing' ||
    status === 'ready'
  )
}

/**
 * Inspect R2 + D1 tour row to determine upload / resume eligibility.
 * Skips R2 HEAD while a browser multipart session is active (stale ZIP at
 * the same key would otherwise look like a completed upload).
 */
export async function getTourZipState(env: Env, tour: Tour): Promise<TourZipState> {
  let activeMultipart = hasActiveMultipartUpload(tour)
  const r2Key = tour.r2_key ?? buildTourZipKey(publicTourId(tour))

  let zipOnR2 = false
  let zipSize: number | null = tour.file_size
  let zipLastModified: string | null = null

  const head = await headObject(r2Config(env), r2Key)
  zipOnR2 = head.exists
  if (head.exists) {
    zipSize = head.contentLength ?? tour.file_size
    zipLastModified = head.lastModified
  }

  // Stale upload_id after R2 finalize — treat as step 1 complete.
  if (
    activeMultipart &&
    zipOnR2 &&
    tour.file_size != null &&
    head.contentLength === tour.file_size
  ) {
    activeMultipart = false
  }

  const uploadComplete =
    (zipOnR2 && !activeMultipart) ||
    tour.status === 'processing' ||
    tour.status === 'ready' ||
    tour.status === 'completed' ||
    (tour.status === 'failed' && Boolean(tour.upload_session_id) && !activeMultipart)

  const canResumeProcessing =
    (uploadComplete && isResumeEligibleStatus(tour.status)) ||
    (tour.status === 'ready' && !tour.backup_completed_at) ||
    (tour.status === 'ready' && Boolean(tour.backup_completed_at) && !tour.cleanup_completed_at) ||
    tour.status === 'ingesting' ||
    tour.status === 'processing'

  const canEditIdentity = !isTourIdentityLocked(tour, { zipOnR2, uploadComplete })

  return {
    zipOnR2,
    zipSize,
    zipLastModified,
    uploadComplete,
    canResumeProcessing,
    canEditIdentity,
    upload_started_at: null,
  }
}

async function getLatestUploadSessionStart(env: Env, tourId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT started_at FROM upload_sessions WHERE tour_id = ? ORDER BY started_at DESC LIMIT 1`,
  )
    .bind(tourId)
    .first<{ started_at: string }>()
  return row?.started_at ?? null
}

export async function enrichTourWithZipState(
  env: Env,
  tour: Tour,
): Promise<TourWithZipState> {
  const [zipState, uploadStartedAt] = await Promise.all([
    getTourZipState(env, tour),
    getLatestUploadSessionStart(env, publicTourId(tour)),
  ])
  return { ...tour, ...zipState, upload_started_at: uploadStartedAt }
}

/** Tours that benefit from an R2 HEAD on list (failed / stuck / in-flight). */
export function tourNeedsZipCheck(tour: Tour): boolean {
  if (hasActiveMultipartUpload(tour)) return false
  return (
    tour.status === 'failed' ||
    tour.status === 'uploading' ||
    tour.status === 'uploaded' ||
    tour.status === 'processing'
  )
}

export async function enrichToursWithZipState(
  env: Env,
  tours: Tour[],
): Promise<TourWithZipState[]> {
  return Promise.all(
    tours.map(async (tour) => {
      if (!tourNeedsZipCheck(tour)) {
        const uploadComplete =
          tour.status === 'ready' ||
          tour.status === 'completed' ||
          tour.status === 'processing'
        return {
          ...tour,
          zipOnR2: uploadComplete || Boolean(tour.r2_key),
          zipSize: tour.file_size,
          zipLastModified: null,
          uploadComplete,
          canResumeProcessing: false,
          canEditIdentity: !isTourIdentityLocked(tour, {
            zipOnR2: uploadComplete || Boolean(tour.r2_key),
            uploadComplete,
          }),
          upload_started_at: null,
        }
      }
      return enrichTourWithZipState(env, tour)
    }),
  )
}

/**
 * True when status=uploading still has upload_id but R2 already holds the
 * finalized ZIP (e.g. /upload/complete updated R2 but D1 update failed).
 * Requires expected file_size to match R2 Content-Length when known.
 */
export async function hasFinalizedZipDespiteUploading(
  env: Env,
  tour: Tour,
): Promise<boolean> {
  if (!hasActiveMultipartUpload(tour) || !tour.r2_key) return false
  const head = await headObject(r2Config(env), tour.r2_key)
  if (!head.exists) return false
  if (tour.file_size != null && head.contentLength != null) {
    return head.contentLength === tour.file_size
  }
  return false
}
