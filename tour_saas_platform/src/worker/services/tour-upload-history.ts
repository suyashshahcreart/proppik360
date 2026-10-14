// ============================================================
// Durable per-ZIP upload / processing history for a tour.
// Survives re-uploads; Tour view History reads this table.
// ============================================================
import type { Tour } from '../types'

export type UploadHistoryStatus = 'in_progress' | 'success' | 'failed' | 'warning'

export interface UploadHistoryStageEvent {
  stage: string
  at: string
  detail?: string
}

export interface UploadHistoryReport {
  path: 'go_first' | 'legacy_multipart' | 'resume'
  stages: UploadHistoryStageEvent[]
  progress: {
    files: { current: number; total: number }
    bytes: { current: number; total: number }
  }
  viewer_url?: string | null
  layout?: string | null
  backup?: { key?: string | null; version?: string | null; verified?: boolean }
  warnings: string[]
  source_error?: string | null
  notes?: string[]
}

export interface TourUploadHistoryRow {
  id: string
  tour_id: string
  upload_session_id: string | null
  attempt_number: number
  status: UploadHistoryStatus
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

export interface TourUploadHistoryEntry extends Omit<TourUploadHistoryRow, 'report_json'> {
  report: UploadHistoryReport
}

function emptyReport(path: UploadHistoryReport['path']): UploadHistoryReport {
  return {
    path,
    stages: [],
    progress: { files: { current: 0, total: 0 }, bytes: { current: 0, total: 0 } },
    warnings: [],
    notes: [],
  }
}

function parseReport(raw: string | null | undefined): UploadHistoryReport {
  if (!raw) return emptyReport('go_first')
  try {
    const parsed = JSON.parse(raw) as Partial<UploadHistoryReport>
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

function toEntry(row: TourUploadHistoryRow): TourUploadHistoryEntry {
  const { report_json, ...rest } = row
  return { ...rest, report: parseReport(report_json) }
}

async function nextAttemptNumber(db: D1Database, tourId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(attempt_number), 0) AS n FROM tour_upload_history WHERE tour_id = ?`)
    .bind(tourId)
    .first<{ n: number }>()
  return (row?.n ?? 0) + 1
}

/** Active (in-progress) attempt for a tour, if any. */
export async function getActiveUploadHistory(
  db: D1Database,
  tourId: string,
): Promise<TourUploadHistoryRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM tour_upload_history
          WHERE tour_id = ? AND status = 'in_progress'
          ORDER BY started_at DESC
          LIMIT 1`,
      )
      .bind(tourId)
      .first<TourUploadHistoryRow>()) ?? null
  )
}

export async function startUploadHistory(
  db: D1Database,
  input: {
    tourId: string
    uploadSessionId?: string | null
    originalFilename?: string | null
    fileSize?: number | null
    backupVersion?: string | null
    path: UploadHistoryReport['path']
    stage?: string
    note?: string
  },
): Promise<TourUploadHistoryRow> {
  // Close any stale in-progress attempt (e.g. abandoned browser tab).
  const active = await getActiveUploadHistory(db, input.tourId)
  if (active) {
    await finalizeUploadHistory(db, {
      tourId: input.tourId,
      historyId: active.id,
      status: 'failed',
      stage: active.stage ?? 'aborted',
      errorMessage: 'Superseded by a new upload attempt',
      warning: 'Previous attempt was still in progress when a new upload started',
    })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const attempt = await nextAttemptNumber(db, input.tourId)
  const report = emptyReport(input.path)
  const stage = input.stage ?? (input.path === 'resume' ? 'queued' : 'ingesting')
  report.stages.push({ stage, at: now, detail: input.note })
  if (input.note) report.notes!.push(input.note)

  await db
    .prepare(
      `INSERT INTO tour_upload_history (
         id, tour_id, upload_session_id, attempt_number, status, stage,
         original_filename, file_size, backup_version, backup_r2_key,
         error_message, started_at, finished_at, duration_ms,
         report_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      input.tourId,
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
    .prepare(`SELECT * FROM tour_upload_history WHERE id = ?`)
    .bind(id)
    .first<TourUploadHistoryRow>()
  if (!row) throw new Error('Failed to create upload history row')
  return row
}

export async function appendUploadHistoryStage(
  db: D1Database,
  tourId: string,
  stage: string,
  detail?: string,
  progress?: {
    currentFiles?: number
    totalFiles?: number
    currentBytes?: number
    totalBytes?: number
  },
): Promise<void> {
  const active = await getActiveUploadHistory(db, tourId)
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
      `UPDATE tour_upload_history
          SET stage = ?, report_json = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(stage, JSON.stringify(report), now, active.id)
    .run()
}

export async function finalizeUploadHistory(
  db: D1Database,
  input: {
    tourId: string
    historyId?: string
    status: Exclude<UploadHistoryStatus, 'in_progress'>
    stage?: string
    errorMessage?: string | null
    viewerUrl?: string | null
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
        .prepare(`SELECT * FROM tour_upload_history WHERE id = ?`)
        .bind(input.historyId)
        .first<TourUploadHistoryRow>()
    : await getActiveUploadHistory(db, input.tourId)

  if (!active) return

  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  const stage = input.stage ?? active.stage ?? input.status

  if (input.viewerUrl !== undefined) report.viewer_url = input.viewerUrl
  if (input.layout !== undefined) report.layout = input.layout
  if (input.backupKey || input.backupVersion) {
    report.backup = {
      key: input.backupKey ?? report.backup?.key ?? null,
      version: input.backupVersion ?? report.backup?.version ?? null,
      verified: input.status === 'success' || Boolean(input.backupKey),
    }
  }
  if (input.errorMessage) {
    report.source_error = input.errorMessage
  }
  if (input.warning) {
    if (!report.warnings.includes(input.warning)) report.warnings.push(input.warning)
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
      `UPDATE tour_upload_history
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

/** Patch ready/backup fields without closing the attempt (still awaiting cleanup). */
export async function patchUploadHistoryReady(
  db: D1Database,
  tourId: string,
  input: {
    viewerUrl?: string | null
    layout?: string | null
    stage?: string
    warning?: string
  },
): Promise<void> {
  const active = await getActiveUploadHistory(db, tourId)
  if (!active) return
  const report = parseReport(active.report_json)
  const now = new Date().toISOString()
  if (input.viewerUrl !== undefined) report.viewer_url = input.viewerUrl
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
      `UPDATE tour_upload_history
          SET stage = ?, report_json = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(stage, JSON.stringify(report), now, active.id)
    .run()
}

export async function patchUploadHistoryBackup(
  db: D1Database,
  tourId: string,
  backupKey: string,
  version?: string | null,
): Promise<void> {
  const active = await getActiveUploadHistory(db, tourId)
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
      `UPDATE tour_upload_history
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

/**
 * Backfill history from upload_sessions when the table is empty for this tour
 * (tours created before migration 0015).
 */
export async function backfillUploadHistoryFromSessions(
  db: D1Database,
  tourId: string,
): Promise<void> {
  const existing = await db
    .prepare(`SELECT COUNT(*) AS n FROM tour_upload_history WHERE tour_id = ?`)
    .bind(tourId)
    .first<{ n: number }>()
  if ((existing?.n ?? 0) > 0) return

  const sessions = await db
    .prepare(
      `SELECT * FROM upload_sessions WHERE tour_id = ? ORDER BY started_at ASC`,
    )
    .bind(tourId)
    .all<{
      id: string
      original_filename: string
      file_size: number
      backup_version: string | null
      backup_r2_key: string | null
      stage: string
      error: string | null
      started_at: string
      completed_at: string | null
      updated_at: string
    }>()

  let attempt = 0
  for (const s of sessions.results) {
    attempt += 1
    const status: UploadHistoryStatus =
      s.stage === 'completed'
        ? 'success'
        : s.stage === 'aborted' || s.error
          ? 'failed'
          : s.stage === 'ready_pending_backup' || s.stage === 'cleanup'
            ? 'warning'
            : s.stage === 'ingesting' || s.stage === 'extracting' || s.stage === 'publishing'
              ? 'in_progress'
              : 'warning'

    const report = emptyReport('go_first')
    report.stages.push({ stage: s.stage, at: s.started_at })
    if (s.completed_at) report.stages.push({ stage: 'completed', at: s.completed_at })
    if (s.error) report.source_error = s.error
    if (s.backup_r2_key) {
      report.backup = { key: s.backup_r2_key, version: s.backup_version, verified: true }
    }

    const finished = s.completed_at ?? (status === 'in_progress' ? null : s.updated_at)
    const durationMs =
      finished && Number.isFinite(Date.parse(s.started_at))
        ? Math.max(0, Date.parse(finished) - Date.parse(s.started_at))
        : null

    await db
      .prepare(
        `INSERT INTO tour_upload_history (
           id, tour_id, upload_session_id, attempt_number, status, stage,
           original_filename, file_size, backup_version, backup_r2_key,
           error_message, started_at, finished_at, duration_ms,
           report_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        tourId,
        s.id,
        attempt,
        status === 'in_progress' ? 'failed' : status, // don't leave ghost in_progress from old sessions
        s.stage,
        s.original_filename,
        s.file_size,
        s.backup_version,
        s.backup_r2_key,
        s.error ?? (status === 'in_progress' ? 'Incomplete session (backfilled)' : null),
        s.started_at,
        finished ?? s.updated_at,
        durationMs,
        JSON.stringify(report),
        s.started_at,
        s.updated_at,
      )
      .run()
  }
}

export async function listUploadHistory(
  db: D1Database,
  tourId: string,
): Promise<TourUploadHistoryEntry[]> {
  await backfillUploadHistoryFromSessions(db, tourId)
  const result = await db
    .prepare(
      `SELECT * FROM tour_upload_history
        WHERE tour_id = ?
        ORDER BY started_at DESC, attempt_number DESC`,
    )
    .bind(tourId)
    .all<TourUploadHistoryRow>()
  return result.results.map(toEntry)
}

/** Re-point history rows when a tour primary key is renamed / soft-deleted. */
export function rebindUploadHistoryStatements(
  db: D1Database,
  oldTourId: string,
  newTourId: string,
) {
  return db
    .prepare(`UPDATE tour_upload_history SET tour_id = ? WHERE tour_id = ?`)
    .bind(newTourId, oldTourId)
}

/** Best-effort resume attempt when processing restarts without a new ZIP ingest. */
export async function startResumeHistoryIfNeeded(
  db: D1Database,
  tour: Pick<Tour, 'tour_id' | 'original_filename' | 'file_size' | 'upload_session_id'>,
  detail: string,
): Promise<void> {
  const active = await getActiveUploadHistory(db, tour.tour_id)
  if (active) {
    await appendUploadHistoryStage(db, tour.tour_id, 'queued', detail)
    return
  }
  await startUploadHistory(db, {
    tourId: tour.tour_id,
    uploadSessionId: tour.upload_session_id,
    originalFilename: tour.original_filename,
    fileSize: tour.file_size,
    path: 'resume',
    stage: 'queued',
    note: detail,
  })
}
