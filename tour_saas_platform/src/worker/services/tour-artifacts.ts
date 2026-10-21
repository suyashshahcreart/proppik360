// ============================================================
// Per-tour artifact pointers (publish URL, last success, session).
// ============================================================
import {
  ARTIFACT_TYPE_TOUR_ADMIN,
  adminPublishPrefix,
  adminPublishUrl,
  type ArtifactType,
} from './admin-paths'

export interface TourArtifactRow {
  id: string
  tour_id: string
  artifact_type: string
  publish_url: string | null
  publish_prefix: string | null
  last_upload_at: string | null
  last_success_at: string | null
  upload_session_id: string | null
  backup_r2_key: string | null
  backup_version: string | null
  status: string | null
  created_at: string
  updated_at: string
}

export async function getTourArtifact(
  db: D1Database,
  tourId: string,
  artifactType: ArtifactType | string = ARTIFACT_TYPE_TOUR_ADMIN,
): Promise<TourArtifactRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM tour_artifacts WHERE tour_id = ? AND artifact_type = ?`)
      .bind(tourId, artifactType)
      .first<TourArtifactRow>()) ?? null
  )
}

export async function upsertTourArtifactSession(
  db: D1Database,
  input: {
    tourId: string
    artifactType: string
    uploadSessionId: string
    status: string
  },
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getTourArtifact(db, input.tourId, input.artifactType)
  if (existing) {
    await db
      .prepare(
        `UPDATE tour_artifacts
            SET upload_session_id = ?,
                status = ?,
                last_upload_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(input.uploadSessionId, input.status, now, now, existing.id)
      .run()
    return
  }
  await db
    .prepare(
      `INSERT INTO tour_artifacts (
         id, tour_id, artifact_type, publish_url, publish_prefix,
         last_upload_at, last_success_at, upload_session_id,
         backup_r2_key, backup_version, status, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.tourId,
      input.artifactType,
      adminPublishPrefix(input.tourId),
      now,
      input.uploadSessionId,
      input.status,
      now,
      now,
    )
    .run()
}

export async function markTourArtifactReady(
  db: D1Database,
  input: {
    tourId: string
    artifactType: string
    publicDomain: string
    layout?: string | null
  },
): Promise<{ publishUrl: string }> {
  const now = new Date().toISOString()
  const publishUrl = adminPublishUrl(input.publicDomain, input.tourId)
  const existing = await getTourArtifact(db, input.tourId, input.artifactType)
  if (existing) {
    await db
      .prepare(
        `UPDATE tour_artifacts
            SET publish_url = ?,
                publish_prefix = ?,
                status = 'ready',
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(publishUrl, adminPublishPrefix(input.tourId), now, existing.id)
      .run()
  } else {
    await db
      .prepare(
        `INSERT INTO tour_artifacts (
           id, tour_id, artifact_type, publish_url, publish_prefix,
           last_upload_at, last_success_at, upload_session_id,
           backup_r2_key, backup_version, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'ready', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.tourId,
        input.artifactType,
        publishUrl,
        adminPublishPrefix(input.tourId),
        now,
        now,
      )
      .run()
  }
  return { publishUrl }
}

export async function markTourArtifactCompleted(
  db: D1Database,
  input: {
    tourId: string
    artifactType: string
    backupKey?: string | null
    backupVersion?: string | null
  },
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getTourArtifact(db, input.tourId, input.artifactType)
  if (!existing) return
  await db
    .prepare(
      `UPDATE tour_artifacts
          SET status = 'completed',
              last_success_at = ?,
              upload_session_id = NULL,
              backup_r2_key = COALESCE(?, backup_r2_key),
              backup_version = COALESCE(?, backup_version),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      now,
      input.backupKey ?? null,
      input.backupVersion ?? null,
      now,
      existing.id,
    )
    .run()
}

export async function markTourArtifactFailed(
  db: D1Database,
  tourId: string,
  artifactType: string,
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getTourArtifact(db, tourId, artifactType)
  if (!existing) return
  await db
    .prepare(
      `UPDATE tour_artifacts
          SET status = 'failed',
              upload_session_id = NULL,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, existing.id)
    .run()
}

export async function patchTourArtifactBackup(
  db: D1Database,
  tourId: string,
  artifactType: string,
  backupKey: string,
  version?: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getTourArtifact(db, tourId, artifactType)
  if (!existing) return
  await db
    .prepare(
      `UPDATE tour_artifacts
          SET backup_r2_key = ?,
              backup_version = COALESCE(?, backup_version),
              status = 'cleanup',
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(backupKey, version ?? null, now, existing.id)
    .run()
}
