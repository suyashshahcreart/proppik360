// ============================================================
// Tour database operations (D1 / SQLite)
// ============================================================
import type { Tour, TourStatus } from '../types'
import { buildDeletedTourId } from '../utils/slug'
import {
  TOUR_ID_REGEX,
  isSixDigitTourIdAvailable,
} from '../utils/tour-id'
import {
  QR_CODE_REGEX,
  generateUniqueQrCode,
  isQrCodeAvailable,
} from '../utils/qr-code'
import {
  normalizeTourDetails,
  type NormalizedTourDetails,
  type TourDetailsInput,
} from './tour-details'

// ── Progress update payload ──────────────────────────────────

/** Pipeline stage reported by the Go processor (or set by Worker on dispatch). */
export type ProcessingStage =
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
  | 'completed'

export interface TourProgressUpdate {
  currentFiles: number
  totalFiles: number
  currentBytes: number
  totalBytes: number
  /** Optional pipeline stage - omit to leave the existing stage unchanged. */
  stage?: ProcessingStage
}

/**
 * Get all tours belonging to a user, newest first.
 * Excludes soft-deleted tours.
 */
export async function getToursByOwner(
  db: D1Database,
  ownerId: string,
): Promise<Tour[]> {
  const result = await db
    .prepare(
      'SELECT * FROM tours WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    )
    .bind(ownerId)
    .all<Tour>()
  return result.results
}

/**
 * Get all tours for a specific customer owned by this user, newest first.
 * Excludes soft-deleted tours.
 */
export async function getToursByCustomer(
  db: D1Database,
  customerId: string,
  ownerId: string,
): Promise<Tour[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tours
       WHERE customer_id = ? AND owner_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(customerId, ownerId)
    .all<Tour>()
  return result.results
}

export interface CustomerTourStats {
  total: number
  uploading: number
  uploaded: number
  ready: number
  failed: number
}

/** Aggregate tour status counts for one customer (owner-scoped). */
export async function getTourStatsByCustomer(
  db: D1Database,
  customerId: string,
  ownerId: string,
): Promise<CustomerTourStats> {
  const countsResult = await db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM tours
       WHERE customer_id = ? AND owner_id = ? AND deleted_at IS NULL
       GROUP BY status`,
    )
    .bind(customerId, ownerId)
    .all<{ status: string; count: number }>()

  const stats: CustomerTourStats = {
    total: 0,
    uploading: 0,
    uploaded: 0,
    ready: 0,
    failed: 0,
  }

  for (const row of countsResult.results) {
    stats.total += row.count
    if (row.status === 'uploading' || row.status === 'ingesting') stats.uploading += row.count
    if (row.status === 'uploaded' || row.status === 'processing') stats.uploaded += row.count
    if (row.status === 'ready' || row.status === 'completed') stats.ready += row.count
    if (row.status === 'failed') stats.failed += row.count
  }

  return stats
}

/**
 * Get a single tour by ID, enforcing ownership.
 * Returns null if the tour does not exist, is soft-deleted, or belongs to a different user.
 */
export async function getTourByIdForOwner(
  db: D1Database,
  tourId: string,
  ownerId: string,
): Promise<Tour | null> {
  const result = await db
    .prepare('SELECT * FROM tours WHERE tour_id = ? AND owner_id = ? AND deleted_at IS NULL')
    .bind(tourId, ownerId)
    .first<Tour>()
  return result ?? null
}

/**
 * Soft-delete a tour by setting deleted_at and renaming the id/slug.
 *
 * Renaming frees the original slug for a future upload of the same name
 * (soft-deleted rows would otherwise still collide on the PK).
 * R2 cleanup must use the original tourId as the object prefix — rename is
 * DB-only; object keys under tours/{originalId}/ are not moved.
 * media_links.entity_id is updated to the tombstone so a re-upload of the
 * same slug does not inherit the deleted tour's media links.
 */
export async function softDeleteTour(
  db: D1Database,
  tourId: string,
  ownerId: string,
): Promise<boolean> {
  const at = new Date()
  const now = at.toISOString()

  for (let attempt = 0; attempt < 3; attempt++) {
    const deletedId =
      attempt === 0
        ? buildDeletedTourId(tourId, at)
        : `${buildDeletedTourId(tourId, new Date())}-${Math.random().toString(36).slice(2, 6)}`

    try {
      // upload_sessions and tour_upload_history both reference tours(id)
      // with no ON UPDATE CASCADE. History must move to the tombstone id in
      // the same transaction as the PK rename. Immediate FK checks reject
      // that (new id does not exist yet) and the UI used to say "Tour not
      // found" while R2 was never touched. Defer checks until commit.
      const results = await db.batch([
        db.prepare(`PRAGMA defer_foreign_keys = ON`),
        db
          .prepare(`DELETE FROM upload_sessions WHERE tour_id = ?`)
          .bind(tourId),
        db
          .prepare(`UPDATE tour_upload_history SET tour_id = ? WHERE tour_id = ?`)
          .bind(deletedId, tourId),
        // Move tour-admin rows before/with tour_id rename (no ON UPDATE CASCADE)
        db
          .prepare(`UPDATE tour_admin_sessions SET tour_id = ? WHERE tour_id = ?`)
          .bind(deletedId, tourId),
        db
          .prepare(`UPDATE tour_admin_otp_requests SET tour_id = ? WHERE tour_id = ?`)
          .bind(deletedId, tourId),
        db
          .prepare(`UPDATE tour_admins SET tour_id = ? WHERE tour_id = ?`)
          .bind(deletedId, tourId),
        db
          .prepare(
            `UPDATE tours
                SET tour_id = ?, qr_code = ?, deleted_at = ?, updated_at = ?
              WHERE tour_id = ? AND owner_id = ? AND deleted_at IS NULL`,
          )
          .bind(deletedId, deletedId, now, now, tourId, ownerId),
        db
          .prepare(
            `UPDATE media_links
                SET entity_id = ?
              WHERE entity_type = 'tour' AND entity_id = ?`,
          )
          .bind(deletedId, tourId),
      ])

      // tours UPDATE is index 6 after the batch stretch
      if ((results[6]?.meta?.changes ?? 0) === 0) return false
      return true
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[delete] softDeleteTour attempt ${attempt} tour=${tourId}:`, message)
      // UNIQUE collision on tombstone id (same-second retry) — try again
    }
  }

  return false
}

/**
 * If a soft-deleted row still holds `tourId` (legacy delete without rename),
 * rename it to a tombstone so a new tour can reuse the slug.
 */
export async function releaseSoftDeletedTourId(
  db: D1Database,
  tourId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT tour_id, deleted_at FROM tours
       WHERE tour_id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(tourId)
    .first<{ tour_id: string; deleted_at: string }>()

  if (!row) return

  const baseAt = Number.isNaN(Date.parse(row.deleted_at))
    ? new Date()
    : new Date(row.deleted_at)

  for (let attempt = 0; attempt < 3; attempt++) {
    const at = attempt === 0 ? baseAt : new Date()
    const deletedId =
      attempt === 0
        ? buildDeletedTourId(tourId, at)
        : `${buildDeletedTourId(tourId, at)}-${Math.random().toString(36).slice(2, 6)}`

    try {
      await db.batch([
        db
          .prepare(
            `UPDATE tours SET tour_id = ?, qr_code = ? WHERE tour_id = ? AND deleted_at IS NOT NULL`,
          )
          .bind(deletedId, deletedId, tourId),
        db
          .prepare(
            `UPDATE media_links
                SET entity_id = ?
              WHERE entity_type = 'tour' AND entity_id = ?`,
          )
          .bind(deletedId, tourId),
      ])
      return
    } catch {
      // Tombstone id collision — retry with a fresher suffix
    }
  }
}

/**
 * Create a new tour record with status 'draft'.
 * Always assigns a QR code. Optional listing details are stored when provided.
 */
export async function createTour(
  db: D1Database,
  publicTourId: string,
  name: string,
  ownerId: string,
  details?: TourDetailsInput,
): Promise<Tour> {
  const now = new Date().toISOString()
  let qr: string
  const preferredQr = details?.qr_code?.trim().toLowerCase()
  if (preferredQr) {
    if (!QR_CODE_REGEX.test(preferredQr)) {
      throw Object.assign(new Error('QR code must be 8 letters or digits.'), { field: 'qr_code' })
    }
    if (!(await isQrCodeAvailable(db, preferredQr))) {
      throw Object.assign(new Error('This QR code is already in use.'), { field: 'qr_code' })
    }
    qr = preferredQr
  } else {
    qr = await generateUniqueQrCode(db)
  }
  const normalized = details ? await normalizeTourDetails(db, ownerId, details) : null

  await db
    .prepare(
      `INSERT INTO tours (
         tour_id, name, owner_id, status, qr_code,
         customer_id, listing_status, payment_status, owner_type, owner_type_details,
         property_category_id, property_sub_category_id, furnish_type, size_bhk,
         other_option_details, super_built_up_area, price, use_company_billing,
         billing_company_name, gst_no, house_no, building_name, society_name,
         area_locality, landmark, pin_code, country, state, city, full_address,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, 'draft', ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?
       )`,
    )
    .bind(
      publicTourId,
      normalized?.name ?? name,
      ownerId,
      qr,
      normalized?.customer_id ?? null,
      normalized?.listing_status ?? 'pending',
      normalized?.payment_status ?? 'unpaid',
      normalized?.owner_type ?? 'owner',
      normalized?.owner_type_details ?? null,
      normalized?.property_category_id ?? null,
      normalized?.property_sub_category_id ?? null,
      normalized?.furnish_type ?? null,
      normalized?.size_bhk ?? null,
      normalized?.other_option_details ?? null,
      normalized?.super_built_up_area ?? null,
      normalized?.price ?? null,
      normalized?.use_company_billing ? 1 : 0,
      normalized?.billing_company_name ?? null,
      normalized?.gst_no ?? null,
      normalized?.house_no ?? null,
      normalized?.building_name ?? null,
      normalized?.society_name ?? null,
      normalized?.area_locality ?? null,
      normalized?.landmark ?? null,
      normalized?.pin_code ?? null,
      normalized?.country ?? null,
      normalized?.state ?? null,
      normalized?.city ?? null,
      normalized?.full_address ?? null,
      now,
      now,
    )
    .run()

  const tour = await db
    .prepare('SELECT * FROM tours WHERE tour_id = ?')
    .bind(publicTourId)
    .first<Tour>()

  if (!tour) throw new Error('Failed to retrieve tour after creation')

  // Auto-create per-tour admin from master settings (no-op if disabled / exists)
  try {
    const { applyMasterToNewTour } = await import('./tour-admin-master')
    await applyMasterToNewTour(db, publicTourId)
  } catch (e) {
    console.error('[tours] applyMasterToNewTour failed (non-fatal):', e)
  }

  return tour
}

/**
 * Rename a tour primary key before any ZIP/R2 path exists.
 * Clears upload_sessions (none expected when identity is editable) and
 * re-points media_links that reference the old id.
 */
export async function renameTourId(
  db: D1Database,
  oldId: string,
  newId: string,
  ownerId: string,
): Promise<boolean> {
  if (oldId === newId) return true

  // Child FKs may block PK rename — clear sessions first (same as soft-delete).
  // Defer FK checks so history.tour_id can move to newId in the same batch.
  const results = await db.batch([
    db.prepare(`PRAGMA defer_foreign_keys = ON`),
    db.prepare(`DELETE FROM upload_sessions WHERE tour_id = ?`).bind(oldId),
    db
      .prepare(`UPDATE tour_upload_history SET tour_id = ? WHERE tour_id = ?`)
      .bind(newId, oldId),
    db
      .prepare(`UPDATE tour_admin_sessions SET tour_id = ? WHERE tour_id = ?`)
      .bind(newId, oldId),
    db
      .prepare(`UPDATE tour_admin_otp_requests SET tour_id = ? WHERE tour_id = ?`)
      .bind(newId, oldId),
    db
      .prepare(`UPDATE tour_admins SET tour_id = ? WHERE tour_id = ?`)
      .bind(newId, oldId),
    db
      .prepare(
        `UPDATE tours SET tour_id = ?, updated_at = ?
         WHERE tour_id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(newId, new Date().toISOString(), oldId, ownerId),
    db
      .prepare(
        `UPDATE media_links
            SET entity_id = ?
          WHERE entity_type = 'tour' AND entity_id = ?`,
      )
      .bind(newId, oldId),
  ])

  // tours UPDATE is index 6 after tour-admin rebinds
  return (results[6]?.meta?.changes ?? 0) > 0
}

/**
 * Update listing details. Processing status is left unchanged.
 * When `canEditIdentity` is true, slug (tour id) and QR code may change.
 * A missing QR code is filled once so older tours get one on first save.
 */
export async function updateTourDetails(
  db: D1Database,
  tourId: string,
  ownerId: string,
  details: TourDetailsInput,
  options?: { canEditIdentity?: boolean },
): Promise<Tour | null> {
  const existing = await getTourByIdForOwner(db, tourId, ownerId)
  if (!existing) return null

  const canEditIdentity = options?.canEditIdentity === true
  const normalized: NormalizedTourDetails = await normalizeTourDetails(db, ownerId, details)
  const now = new Date().toISOString()

  let effectiveId = tourId
  let qr = existing.qr_code ?? (await generateUniqueQrCode(db))

  if (canEditIdentity) {
    const preferredTourId = details.slug?.trim() ?? ''
    if (preferredTourId) {
      if (!TOUR_ID_REGEX.test(preferredTourId)) {
        throw Object.assign(new Error('Tour ID must be exactly 6 digits.'), { field: 'slug' })
      }
      if (!(await isSixDigitTourIdAvailable(db, preferredTourId, tourId))) {
        throw Object.assign(
          new Error('This tour ID is already in use. Enter another or click Regenerate.'),
          { field: 'slug' },
        )
      }
      if (preferredTourId !== tourId) {
        const renamed = await renameTourId(db, tourId, preferredTourId, ownerId)
        if (!renamed) throw new Error('Could not rename tour ID')
        effectiveId = preferredTourId
      }
    }

    if (details.regenerate_qr) {
      qr = await generateUniqueQrCode(db)
    } else if (details.qr_code != null) {
      const preferredQr = details.qr_code.trim().toLowerCase()
      if (preferredQr) {
        if (!QR_CODE_REGEX.test(preferredQr)) {
          throw Object.assign(
            new Error('QR code must be 8 letters or digits (lowercase).'),
            { field: 'qr_code' },
          )
        }
        if (!(await isQrCodeAvailable(db, preferredQr, tourId))) {
          throw Object.assign(new Error('This QR code is already in use.'), { field: 'qr_code' })
        }
        qr = preferredQr
      }
    }
  } else if (details.slug != null || details.qr_code != null || details.regenerate_qr) {
    // Ignore identity fields when locked — do not error so older clients still save details.
  }

  await db
    .prepare(
      `UPDATE tours SET
         name = ?,
         qr_code = ?,
         customer_id = ?,
         listing_status = ?,
         payment_status = ?,
         owner_type = ?,
         owner_type_details = ?,
         property_category_id = ?,
         property_sub_category_id = ?,
         furnish_type = ?,
         size_bhk = ?,
         other_option_details = ?,
         super_built_up_area = ?,
         price = ?,
         use_company_billing = ?,
         billing_company_name = ?,
         gst_no = ?,
         house_no = ?,
         building_name = ?,
         society_name = ?,
         area_locality = ?,
         landmark = ?,
         pin_code = ?,
         country = ?,
         state = ?,
         city = ?,
         full_address = ?,
         updated_at = ?
       WHERE tour_id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      normalized.name,
      qr,
      normalized.customer_id,
      normalized.listing_status,
      normalized.payment_status,
      normalized.owner_type,
      normalized.owner_type_details,
      normalized.property_category_id,
      normalized.property_sub_category_id,
      normalized.furnish_type,
      normalized.size_bhk,
      normalized.other_option_details,
      normalized.super_built_up_area,
      normalized.price,
      normalized.use_company_billing ? 1 : 0,
      normalized.billing_company_name,
      normalized.gst_no,
      normalized.house_no,
      normalized.building_name,
      normalized.society_name,
      normalized.area_locality,
      normalized.landmark,
      normalized.pin_code,
      normalized.country,
      normalized.state,
      normalized.city,
      normalized.full_address,
      now,
      effectiveId,
      ownerId,
    )
    .run()

  return getTourByIdForOwner(db, effectiveId, ownerId)
}

/**
 * Update a tour's status and optionally other fields.
 * Always updates updated_at.
 *
 * @param extra  - optional additional fields to update alongside status
 */
export async function updateTour(
  db: D1Database,
  tourId: string,
  status: TourStatus,
  extra?: Partial<
    Pick<
      Tour,
      | 'upload_id'
      | 'r2_key'
      | 'file_size'
      | 'original_filename'
      | 'viewer_url'
      | 'processing_error'
      | 'processed_at'
      | 'ready_at'
      | 'backup_completed_at'
      | 'cleanup_completed_at'
      | 'upload_session_id'
    >
  >,
): Promise<void> {
  const now = new Date().toISOString()

  if (!extra || Object.keys(extra).length === 0) {
    await db
      .prepare('UPDATE tours SET status = ?, updated_at = ? WHERE tour_id = ?')
      .bind(status, now, tourId)
      .run()
    return
  }

  // Build dynamic SET clause for optional fields
  const setClauses: string[] = ['status = ?', 'updated_at = ?']
  const values: unknown[] = [status, now]

  if (extra.upload_id !== undefined) {
    setClauses.push('upload_id = ?')
    values.push(extra.upload_id)
  }
  if (extra.r2_key !== undefined) {
    setClauses.push('r2_key = ?')
    values.push(extra.r2_key)
  }
  if (extra.file_size !== undefined) {
    setClauses.push('file_size = ?')
    values.push(extra.file_size)
  }
  if (extra.original_filename !== undefined) {
    setClauses.push('original_filename = ?')
    values.push(extra.original_filename)
  }
  if (extra.viewer_url !== undefined) {
    setClauses.push('viewer_url = ?')
    values.push(extra.viewer_url)
  }
  if (extra.processing_error !== undefined) {
    setClauses.push('processing_error = ?')
    values.push(extra.processing_error)
  }
  if (extra.processed_at !== undefined) {
    setClauses.push('processed_at = ?')
    values.push(extra.processed_at)
  }
  if (extra.ready_at !== undefined) {
    setClauses.push('ready_at = ?')
    values.push(extra.ready_at)
  }
  if (extra.backup_completed_at !== undefined) {
    setClauses.push('backup_completed_at = ?')
    values.push(extra.backup_completed_at)
  }
  if (extra.cleanup_completed_at !== undefined) {
    setClauses.push('cleanup_completed_at = ?')
    values.push(extra.cleanup_completed_at)
  }
  if (extra.upload_session_id !== undefined) {
    setClauses.push('upload_session_id = ?')
    values.push(extra.upload_session_id)
  }

  values.push(tourId)

  await db
    .prepare(`UPDATE tours SET ${setClauses.join(', ')} WHERE tour_id = ?`)
    .bind(...values)
    .run()
}

/**
 * Lightweight progress update issued ~every 2s by the Go processor.
 * Does NOT touch `status` — only the four progress counters.
 */
export async function updateTourProgress(
  db: D1Database,
  tourId: string,
  progress: TourProgressUpdate,
): Promise<void> {
  const now = new Date().toISOString()

  if (progress.stage) {
    await db
      .prepare(
        `UPDATE tours
            SET progress_current_files = ?,
                progress_total_files   = ?,
                progress_current_bytes = ?,
                progress_total_bytes   = ?,
                processing_stage       = ?,
                updated_at             = ?
          WHERE tour_id = ?`,
      )
      .bind(
        progress.currentFiles,
        progress.totalFiles,
        progress.currentBytes,
        progress.totalBytes,
        progress.stage,
        now,
        tourId,
      )
      .run()
    // Heal tours stuck at status=ingesting when Go already moved to extract/publish.
    const pastIngest = [
      'extracting',
      'publishing',
      'uploading_assets',
      'finalizing',
      'ready_pending_backup',
      'backing_up',
      'cleanup',
      'completed',
    ]
    if (pastIngest.includes(progress.stage)) {
      await db
        .prepare(
          `UPDATE tours
              SET status = 'processing',
                  processing_started_at = COALESCE(processing_started_at, ?)
            WHERE tour_id = ? AND status IN ('ingesting', 'uploading')`,
        )
        .bind(now, tourId)
        .run()
    }
    return
  }

  await db
    .prepare(
      `UPDATE tours
          SET progress_current_files = ?,
              progress_total_files   = ?,
              progress_current_bytes = ?,
              progress_total_bytes   = ?,
              updated_at             = ?
        WHERE tour_id = ?`,
    )
    .bind(
      progress.currentFiles,
      progress.totalFiles,
      progress.currentBytes,
      progress.totalBytes,
      now,
      tourId,
    )
    .run()
}

/**
 * Bump updated_at while a multipart upload is in flight so stale-upload
 * detection reflects recent part-url activity.
 */
export async function touchTourUploadActivity(
  db: D1Database,
  tourId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare('UPDATE tours SET updated_at = ? WHERE tour_id = ? AND status = ?')
    .bind(now, tourId, 'uploading')
    .run()
}

export async function setTourProcessingStarted(
  db: D1Database,
  tourId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE tours
          SET status                 = 'processing',
              upload_id              = NULL,
              processing_started_at  = ?,
              processing_stage       = 'queued',
              progress_current_files = 0,
              progress_total_files   = 0,
              progress_current_bytes = 0,
              progress_total_bytes   = 0,
              processing_error       = NULL,
              updated_at             = ?
        WHERE tour_id = ?`,
    )
    .bind(now, now, tourId)
    .run()
}

