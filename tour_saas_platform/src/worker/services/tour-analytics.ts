// ============================================================
// Tour analytics / tracking history (upsert by tour + source + key + version)
// ============================================================

export type AnalyticsSource = 'main_tour' | 'tour_admin'

export const MAX_ANALYTICS_PAYLOAD_BYTES = 512 * 1024
export const MAX_ANALYTICS_LIST = 200

export interface TourAnalyticsRow {
  id: string
  tour_id: string
  source: AnalyticsSource
  tracking_key: string
  publish_version: number
  label: string | null
  payload_json: string
  recorded_at: string
  created_at: string
  updated_at: string
}

export interface TourAnalyticsEntry extends Omit<TourAnalyticsRow, 'payload_json'> {
  payload: Record<string, unknown>
}

export interface UpsertAnalyticsInput {
  tourId: string
  source: AnalyticsSource
  trackingKey: string
  publishVersion: number
  label?: string | null
  payload: Record<string, unknown>
  recordedAt?: string
}

export interface ListAnalyticsFilters {
  source?: AnalyticsSource
  trackingKey?: string
  publishVersion?: number
  limit?: number
}

export async function tourExistsByPublicId(db: D1Database, tourId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM tours WHERE tour_id = ? AND deleted_at IS NULL')
    .bind(tourId)
    .first<{ ok: number }>()
  return row != null
}

export async function resolvePublishVersion(
  db: D1Database,
  tourId: string,
  source: AnalyticsSource,
  explicit?: number,
): Promise<number> {
  if (explicit != null && explicit >= 1) {
    return Math.floor(explicit)
  }

  if (source === 'main_tour') {
    const row = await db
      .prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) AS n FROM tour_upload_history WHERE tour_id = ?`,
      )
      .bind(tourId)
      .first<{ n: number }>()
    const n = row?.n ?? 0
    return n >= 1 ? n : 1
  }

  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(attempt_number), 0) AS n
         FROM artifact_upload_history
        WHERE tour_id = ? AND artifact_type = 'tour_admin'`,
    )
    .bind(tourId)
    .first<{ n: number }>()
  const n = row?.n ?? 0
  return n >= 1 ? n : 1
}

function toEntry(row: TourAnalyticsRow): TourAnalyticsEntry {
  let payload: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.payload_json) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>
    }
  } catch {
    payload = { _parseError: true }
  }
  const { payload_json: _raw, ...rest } = row
  return { ...rest, payload }
}

export async function upsertAnalyticsSnapshot(
  db: D1Database,
  input: UpsertAnalyticsInput,
): Promise<{ entry: TourAnalyticsEntry; created: boolean }> {
  const trackingKey = input.trackingKey.trim()
  if (!trackingKey) {
    throw new Error('tracking_key is required')
  }

  const payloadJson = JSON.stringify(input.payload ?? {})
  if (payloadJson.length > MAX_ANALYTICS_PAYLOAD_BYTES) {
    throw new Error(`payload exceeds ${MAX_ANALYTICS_PAYLOAD_BYTES} bytes`)
  }

  const now = new Date().toISOString()
  const recordedAt = input.recordedAt?.trim() || now
  const publishVersion = input.publishVersion

  const existing = await db
    .prepare(
      `SELECT id FROM tour_analytics_history
        WHERE tour_id = ? AND source = ? AND tracking_key = ? AND publish_version = ?`,
    )
    .bind(input.tourId, input.source, trackingKey, publishVersion)
    .first<{ id: string }>()

  if (existing) {
    await db
      .prepare(
        `UPDATE tour_analytics_history
            SET label = ?, payload_json = ?, recorded_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(input.label ?? null, payloadJson, recordedAt, now, existing.id)
      .run()

    const row = await db
      .prepare('SELECT * FROM tour_analytics_history WHERE id = ?')
      .bind(existing.id)
      .first<TourAnalyticsRow>()
    if (!row) throw new Error('Failed to load updated analytics row')
    return { entry: toEntry(row), created: false }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO tour_analytics_history (
         id, tour_id, source, tracking_key, publish_version, label,
         payload_json, recorded_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.tourId,
      input.source,
      trackingKey,
      publishVersion,
      input.label ?? null,
      payloadJson,
      recordedAt,
      now,
      now,
    )
    .run()

  const row = await db
    .prepare('SELECT * FROM tour_analytics_history WHERE id = ?')
    .bind(id)
    .first<TourAnalyticsRow>()
  if (!row) throw new Error('Failed to load new analytics row')
  return { entry: toEntry(row), created: true }
}

export async function listAnalyticsHistory(
  db: D1Database,
  tourId: string,
  filters: ListAnalyticsFilters = {},
): Promise<TourAnalyticsEntry[]> {
  const limit = Math.min(
    MAX_ANALYTICS_LIST,
    Math.max(1, filters.limit ?? MAX_ANALYTICS_LIST),
  )

  let sql = `SELECT * FROM tour_analytics_history WHERE tour_id = ?`
  const binds: (string | number)[] = [tourId]

  if (filters.source) {
    sql += ` AND source = ?`
    binds.push(filters.source)
  }
  if (filters.trackingKey?.trim()) {
    sql += ` AND tracking_key = ?`
    binds.push(filters.trackingKey.trim())
  }
  if (filters.publishVersion != null && filters.publishVersion >= 1) {
    sql += ` AND publish_version = ?`
    binds.push(filters.publishVersion)
  }

  sql += ` ORDER BY publish_version DESC, updated_at DESC LIMIT ?`
  binds.push(limit)

  const result = await db.prepare(sql).bind(...binds).all<TourAnalyticsRow>()
  return result.results.map(toEntry)
}
