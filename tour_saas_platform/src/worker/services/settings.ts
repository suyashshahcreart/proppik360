// ============================================================
// Flat key-value settings store with in-process cache
// ============================================================

const CACHE_TTL_MS = 60_000

let cache: Map<string, string | null> | null = null
let cacheExpiresAt = 0

function bustCache(): void {
  cache = null
  cacheExpiresAt = 0
}

async function loadAll(db: D1Database): Promise<Map<string, string | null>> {
  const now = Date.now()
  if (cache && now < cacheExpiresAt) return cache

  const result = await db.prepare('SELECT name, value FROM settings').all<{
    name: string
    value: string | null
  }>()

  const map = new Map<string, string | null>()
  for (const row of result.results ?? []) {
    map.set(row.name, row.value)
  }
  cache = map
  cacheExpiresAt = now + CACHE_TTL_MS
  return map
}

export async function getSetting(
  db: D1Database,
  name: string,
  fallback?: string,
): Promise<string | null> {
  const map = await loadAll(db)
  if (map.has(name)) {
    const v = map.get(name)
    return v === null || v === undefined ? (fallback ?? null) : v
  }
  return fallback ?? null
}

export async function getSettingsMap(
  db: D1Database,
  names?: string[],
): Promise<Record<string, string | null>> {
  const map = await loadAll(db)
  const out: Record<string, string | null> = {}
  if (names && names.length > 0) {
    for (const name of names) {
      out[name] = map.has(name) ? (map.get(name) ?? null) : null
    }
    return out
  }
  for (const [k, v] of map) {
    out[k] = v
  }
  return out
}

export async function upsertSettings(
  db: D1Database,
  pairs: Record<string, string | null | undefined>,
  userId: string,
): Promise<Record<string, string | null>> {
  const now = new Date().toISOString()
  const entries = Object.entries(pairs).filter(([, v]) => v !== undefined)

  for (const [name, value] of entries) {
    const existing = await db
      .prepare('SELECT id FROM settings WHERE name = ?')
      .bind(name)
      .first<{ id: string }>()

    if (existing) {
      await db
        .prepare(
          `UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE name = ?`,
        )
        .bind(value ?? null, userId, now, name)
        .run()
    } else {
      const id = crypto.randomUUID()
      await db
        .prepare(
          `INSERT INTO settings (id, name, value, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, name, value ?? null, userId, now, now)
        .run()
    }
  }

  bustCache()
  return getSettingsMap(db)
}

/** General + SMS setting keys exposed by the Settings UI. */
export const GENERAL_SETTING_KEYS = [
  'support_email',
  'support_phone',
  'tour_admin_api_base_url',
] as const

export const SMS_SETTING_KEYS = [
  'sms_msg91_enabled',
  'msg91_sender_id',
  'msg91_otp_template_id',
  'msg91_templates',
  'msg91_timeout_ms',
  'msg91_route',
  'otp_length',
  'otp_expiry_sec',
  'msg91_mock_mode',
] as const

export const ALL_SETTINGS_KEYS = [...GENERAL_SETTING_KEYS, ...SMS_SETTING_KEYS] as const
