// ============================================================
// Durable per-artifact ZIP upload / processing history.
// Mirrors tour-upload-history but scoped by (tour_id, artifact_type).
// Does NOT touch tours.status.
// ============================================================
import {
  ARTIFACT_TYPE_TOUR_ADMIN,
  type ArtifactType,
} from './admin-paths'

export type ArtifactUploadHistoryStatus = 'in_progress' | 'success' | 'failed' | 'warning'

export interface ArtifactUploadHistoryStageEvent {
  stage: string
  at: string
  detail?: string
}

export interface ArtifactUploadHistoryReport {
  path: 'go_first' | 'legacy_multipart' | 'resume'
  stages: ArtifactUploadHistoryStageEvent[]
  progress: {
    files: { current: number; total: number }
    bytes: { current: number; total: number }
  }
  /** Admin (or other artifact) public URL after publish. */
  publish_url?: string | null
  viewer_url?: string | null
  layout?: string | null
  backup?: { key?: string | null; version?: string | null; verified?: boolean }
  warnings: string[]
  source_error?: string | null
  notes?: string[]
}

export interface ArtifactUploadHistoryRow {
  id: string
  tour_id: string
  artifact_type: string
  upload_session_id: string | null
  attempt_number: number
  status: ArtifactUploadHistoryStatus
  stage: string | null
  original_filename: string | null
  file_size: number | null
  backup_version: string | null
  backup_r2_key: string | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  report_json: string
  created_at: string
  updated_at: string
}

export interface ArtifactUploadHistoryEntry extends Omit<ArtifactUploadHistoryRow, 'report_json'> {
  report: ArtifactUploadHistoryReport
}

function emptyReport(path: ArtifactUploadHistoryReport['path']): ArtifactUploadHistoryReport {
  return {
    path,
    stages: [],
    progress: { files: { current: 0, total: 0 }, bytes: { current: 0, total: 0 } },
    warnings: [],
    notes: [],
  }
}

function parseReport(raw: string | null | undefined): ArtifactUploadHistoryReport {
  if (!raw) return emptyReport('go_first')
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactUploadHistoryReport>
    return {
      path: parsed.path ?? 'go_first',
      stages: Array.isArray(parsed.stages) ? parsed.stages : [],
      progress: {
        files: {
          current: parsed.progress?.files?.current ?? 0,
          total: parsed.progress?.files?.total ?? 0,
        },
        bytes: {
          current: parsed.progress?.bytes?.current ?? 0,
          total: parsed.progress?.bytes?.total ?? 0,
        },
      },
      publish_url: parsed.publish_url ?? null,
      viewer_url: parsed.viewer_url ?? null,
      layout: parsed.layout ?? null,
      backup: parsed.backup,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      source_error: parsed.source_error ?? null,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    }
  } catch {
    return emptyReport('go_first')
  }
}

function toEntry(row: ArtifactUploadHistoryRow): ArtifactUploadHistoryEntry {
  const { report_json, ...rest } = row
  return { ...rest, report: parseReport(report_json) }
}

async function nextAttemptNumber(
  db: D1Database,
  tourId: string,
  artifactType: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(attempt_number), 0) AS n
         FROM artifact_upload_history
        WHERE tour_id = ? AND artifact_type = ?`,
    )
    .bind(tourId, artifactType)
    .first<{ n: number }>()
  return (row?.n ?? 0) + 1
}

export async function getActiveArtifactUploadHistory(
  db: D1Database,
  tourId: string,
  artifactType: string,
): Promise<ArtifactUploadHistoryRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM artifact_upload_history
          WHERE tour_id = ? AND artifact_type = ? AND status = 'in_progress'
          ORDER BY started_at DESC
          LIMIT 1`,
      )
      .bind(tourId, artifactType)
      .first<ArtifactUploadHistoryRow>()) ?? null
  )
}

export async function startArtifactUploadHistory(
  db: D1Database,
  input: {
    tourId: string
    artifactType: ArtifactType | string
    uploadSessionId?: string | null
    originalFilename?: string | null
    fileSize?: number | null
    backupVersion?: string | null
    path?: ArtifactUploadHistoryReport['path']
    stage?: string
    note?: string
  },
): Promise<ArtifactUploadHistoryRow> {
  const artifactType = input.artifactType || ARTIFACT_TYPE_TOUR_ADMIN
  const active = await getActiveArtifactUploadHistory(db, input.tourId, artifactType)
  if (active) {
    await finalizeArtifactUploadHistory(db, {
      tourId: input.tourId,
      artifactType,
      historyId: active.id,
      status: 'failed',
      stage: active.stage ?? 'aborted',
      errorMessage: 'Superseded by a new upload attempt',
      warning: 'Previous attempt was still in progress when a new upload started',
    })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const attempt = await nextAttemptNumber(db, input.tourId, artifactType)
  const report = emptyReport(input.path ?? 'go_first')
  const stage = input.stage ?? 'ingesting'
  report.stages.push({ stage, at: now, detail: input.note })
  if (input.note) report.notes!.push(input.note)

  await db
    .prepare(
      `INSERT INTO artifact_upload_history (
         id, tour_id, artifact_type, upload_session_id, attempt_number, status, stage,
         original_filename, file_size, backup_version, backup_r2_key,
         error_message, started_at, finished_at, duration_ms,
         report_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      input.tourId,
      artifactType,
      input.uploadSessionId ?? null,
      attempt,
      stage,
      input.originalFilename ?? null,
      input.fileSize ?? null,
      input.backupVersion ?? null,
      now,
      JSON.stringify(report),
      now,
      now,
    )
    .run()

  const row = await db
    .prepare(`SELECT * FROM artifact_upload_history WHERE id = ?`)
    .bind(id)
    .first<ArtifactUploadHistoryRow>()
  if (!row) throw new Error('Failed to create artifact upload history row')
  return row
}

export async function appendArtifactUploadHistoryStage(
  db: D1Database,
  tourId: string,
  artifactType: string,
  stage: string,
  detail?: string,
  progress?: {
    currentFiles?: number
    totalFiles?: number
    currentBytes?: number
    totalBytes?: number
  },
): Promise<void> {
  const active = await getActiveArtifactUploadHistory(db, tourId, artifactType)
  if (!active) return

  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  const last = report.stages[report.stages.length - 1]
  if (!last || last.stage !== stage) {
    report.stages.push({ stage, at: now, detail })
  } else if (detail && last.detail !== detail) {
    last.detail = detail
  }

  if (progress) {
    if (typeof progress.currentFiles === 'number') report.progress.files.current = progress.currentFiles
    if (typeof progress.totalFiles === 'number') report.progress.files.total = progress.totalFiles
    if (typeof progress.currentBytes === 'number') report.progress.bytes.current = progress.currentBytes
    if (typeof progress.totalBytes === 'number') report.progress.bytes.total = progress.totalBytes
  }

  await db
    .prepare(
      `UPDATE artifact_upload_history
          SET stage = ?, report_json = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(stage, JSON.stringify(report), now, active.id)
    .run()
}

export async function finalizeArtifactUploadHistory(
  db: D1Database,
  input: {
    tourId: string
    artifactType: string
    historyId?: string
    status: Exclude<ArtifactUploadHistoryStatus, 'in_progress'>
    stage?: string
    errorMessage?: string | null
    publishUrl?: string | null
    layout?: string | null
    backupKey?: string | null
    backupVersion?: string | null
    warning?: string
    progress?: {
      currentFiles?: number
      totalFiles?: number
      currentBytes?: number
      totalBytes?: number
    }
  },
): Promise<void> {
  const active = input.historyId
    ? await db
        .prepare(`SELECT * FROM artifact_upload_history WHERE id = ?`)
        .bind(input.historyId)
        .first<ArtifactUploadHistoryRow>()
    : await getActiveArtifactUploadHistory(db, input.tourId, input.artifactType)

  if (!active) return

  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  const stage = input.stage ?? active.stage ?? input.status

  if (input.publishUrl !== undefined) {
    report.publish_url = input.publishUrl
    report.viewer_url = input.publishUrl
  }
  if (input.layout !== undefined) report.layout = input.layout
  if (input.backupKey || input.backupVersion) {
    report.backup = {
      key: input.backupKey ?? report.backup?.key ?? null,
      version: input.backupVersion ?? report.backup?.version ?? null,
      verified: input.status === 'success' || Boolean(input.backupKey),
    }
  }
  if (input.errorMessage) report.source_error = input.errorMessage
  if (input.warning && !report.warnings.includes(input.warning)) {
    report.warnings.push(input.warning)
  }
  if (input.progress) {
    if (typeof input.progress.currentFiles === 'number')
      report.progress.files.current = input.progress.currentFiles
    if (typeof input.progress.totalFiles === 'number')
      report.progress.files.total = input.progress.totalFiles
    if (typeof input.progress.currentBytes === 'number')
      report.progress.bytes.current = input.progress.currentBytes
    if (typeof input.progress.totalBytes === 'number')
      report.progress.bytes.total = input.progress.totalBytes
  }

  const last = report.stages[report.stages.length - 1]
  if (!last || last.stage !== stage) {
    report.stages.push({
      stage,
      at: now,
      detail: input.errorMessage ?? input.warning,
    })
  }

  const startedMs = Date.parse(active.started_at)
  const durationMs = Number.isFinite(startedMs) ? Math.max(0, Date.parse(now) - startedMs) : null

  await db
    .prepare(
      `UPDATE artifact_upload_history
          SET status = ?,
              stage = ?,
              error_message = ?,
              backup_r2_key = COALESCE(?, backup_r2_key),
              backup_version = COALESCE(?, backup_version),
              finished_at = ?,
              duration_ms = ?,
              report_json = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.status,
      stage,
      input.errorMessage ?? active.error_message,
      input.backupKey ?? null,
      input.backupVersion ?? null,
      now,
      durationMs,
      JSON.stringify(report),
      now,
      active.id,
    )
    .run()
}

export async function patchArtifactUploadHistoryReady(
  db: D1Database,
  tourId: string,
  artifactType: string,
  input: {
    publishUrl?: string | null
    layout?: string | null
    stage?: string
    warning?: string
  },
): Promise<void> {
  const active = await getActiveArtifactUploadHistory(db, tourId, artifactType)
  if (!active) return
  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  if (input.publishUrl !== undefined) {
    report.publish_url = input.publishUrl
    report.viewer_url = input.publishUrl
  }
  if (input.layout !== undefined) report.layout = input.layout
  if (input.warning && !report.warnings.includes(input.warning)) {
    report.warnings.push(input.warning)
  }
  const stage = input.stage ?? 'ready_pending_backup'
  const last = report.stages[report.stages.length - 1]
  if (!last || last.stage !== stage) {
    report.stages.push({ stage, at: now })
  }
  await db
    .prepare(
      `UPDATE artifact_upload_history
          SET stage = ?, report_json = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(stage, JSON.stringify(report), now, active.id)
    .run()
}

export async function patchArtifactUploadHistoryBackup(
  db: D1Database,
  tourId: string,
  artifactType: string,
  backupKey: string,
  version?: string | null,
): Promise<void> {
  const active = await getActiveArtifactUploadHistory(db, tourId, artifactType)
  if (!active) return
  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  report.backup = { key: backupKey, version: version ?? report.backup?.version ?? null, verified: true }
  const stage = 'cleanup'
  const last = report.stages[report.stages.length - 1]
  if (!last || last.stage !== stage) {
    report.stages.push({ stage, at: now, detail: backupKey })
  }
  await db
    .prepare(
      `UPDATE artifact_upload_history
          SET stage = ?,
              backup_r2_key = ?,
              backup_version = COALESCE(?, backup_version),
              report_json = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(stage, backupKey, version ?? null, JSON.stringify(report), now, active.id)
    .run()
}

export async function listArtifactUploadHistory(
  db: D1Database,
  tourId: string,
  artifactType: string,
): Promise<ArtifactUploadHistoryEntry[]> {
  const result = await db
    .prepare(
      `SELECT * FROM artifact_upload_history
        WHERE tour_id = ? AND artifact_type = ?
        ORDER BY started_at DESC, attempt_number DESC`,
    )
    .bind(tourId, artifactType)
    .all<ArtifactUploadHistoryRow>()
  return result.results.map(toEntry)
}
