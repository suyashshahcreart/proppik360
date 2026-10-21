// ============================================================
// Per-tour admin credentials (multiple rows per tour_id)
// ============================================================
import { hashPassword } from './auth'

export interface TourAdminRow {
  id: string
  tour_id: string
  username: string
  password_hash: string | null
  country_code: string
  mobile: string | null
  password_enabled: number
  otp_enabled: number
  is_active: number
  source: string
  last_login_at: string | null
  created_at: string
  updated_at: string
}

/** Safe for SaaS UI / partner APIs — never includes password_hash. */
export interface TourAdminPublic {
  id: string
  tour_id: string
  username: string
  country_code: string
  mobile: string | null
  password_enabled: boolean
  otp_enabled: boolean
  is_active: boolean
  source: string
  has_password: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export function toPublic(row: TourAdminRow): TourAdminPublic {
  return {
    id: row.id,
    tour_id: row.tour_id,
    username: row.username,
    country_code: row.country_code,
    mobile: row.mobile,
    password_enabled: Boolean(row.password_enabled),
    otp_enabled: Boolean(row.otp_enabled),
    is_active: Boolean(row.is_active),
    source: row.source,
    has_password: Boolean(row.password_hash),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** @deprecated Prefer listTourAdmins — kept for callers that expect a single row. */
export async function getTourAdminByTourId(
  db: D1Database,
  tourId: string,
): Promise<TourAdminRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM tour_admins WHERE tour_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .bind(tourId)
      .first<TourAdminRow>()) ?? null
  )
}

export async function listTourAdmins(
  db: D1Database,
  tourId: string,
): Promise<TourAdminPublic[]> {
  const result = await db
    .prepare(`SELECT * FROM tour_admins WHERE tour_id = ? ORDER BY created_at ASC`)
    .bind(tourId)
    .all<TourAdminRow>()
  return (result.results ?? []).map(toPublic)
}

export async function getTourAdminById(
  db: D1Database,
  id: string,
): Promise<TourAdminRow | null> {
  return (
    (await db.prepare(`SELECT * FROM tour_admins WHERE id = ?`).bind(id).first<TourAdminRow>()) ??
    null
  )
}

export async function findTourAdminByUsername(
  db: D1Database,
  tourId: string,
  username: string,
): Promise<TourAdminRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM tour_admins
         WHERE tour_id = ? AND lower(username) = lower(?) AND is_active = 1`,
      )
      .bind(tourId, username.trim())
      .first<TourAdminRow>()) ?? null
  )
}

export async function listActiveTourAdmins(
  db: D1Database,
  tourId: string,
): Promise<TourAdminRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tour_admins WHERE tour_id = ? AND is_active = 1 ORDER BY created_at ASC`,
    )
    .bind(tourId)
    .all<TourAdminRow>()
  return result.results ?? []
}

export interface UpsertTourAdminInput {
  username: string
  password_hash?: string | null
  /** Plain password — hashed if provided (takes precedence over password_hash). */
  password?: string | null
  country_code?: string
  mobile?: string | null
  password_enabled?: boolean
  otp_enabled?: boolean
  is_active?: boolean
  source?: string
}

function validateLoginFlags(passwordEnabled: boolean, otpEnabled: boolean) {
  if (!passwordEnabled && !otpEnabled) {
    throw Object.assign(
      new Error('Enable at least one of password or OTP login'),
      { field: 'password_enabled' },
    )
  }
}

/** Create a new tour admin row (does not replace existing admins). */
export async function createTourAdmin(
  db: D1Database,
  tourId: string,
  input: UpsertTourAdminInput,
): Promise<TourAdminPublic> {
  const now = new Date().toISOString()
  const username = input.username.trim()
  if (!username) throw Object.assign(new Error('Username is required'), { field: 'username' })

  let passwordHash = input.password_hash ?? null
  if (input.password != null && input.password.length > 0) {
    passwordHash = await hashPassword(input.password)
  }

  const passwordEnabled = input.password_enabled ?? true
  const otpEnabled = input.otp_enabled ?? false
  validateLoginFlags(passwordEnabled, otpEnabled)

  const id = crypto.randomUUID()
  try {
    await db
      .prepare(
        `INSERT INTO tour_admins (
           id, tour_id, username, password_hash, country_code, mobile,
           password_enabled, otp_enabled, is_active, source, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        tourId,
        username,
        passwordHash,
        (input.country_code ?? '+91').trim() || '+91',
        input.mobile?.trim() || null,
        passwordEnabled ? 1 : 0,
        otpEnabled ? 1 : 0,
        (input.is_active ?? true) ? 1 : 0,
        input.source ?? 'manual',
        now,
        now,
      )
      .run()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('UNIQUE')) {
      throw Object.assign(new Error('Username already exists for this tour'), {
        field: 'username',
      })
    }
    throw e
  }

  const row = await getTourAdminById(db, id)
  if (!row) throw new Error('Failed to create tour admin')
  return toPublic(row)
}

/**
 * Update an existing admin when `adminId` is provided.
 * When omitted, always creates a new admin row for the tour.
 */
export async function upsertTourAdmin(
  db: D1Database,
  tourId: string,
  input: UpsertTourAdminInput,
  adminId?: string | null,
): Promise<TourAdminPublic> {
  const now = new Date().toISOString()

  if (!adminId) {
    return createTourAdmin(db, tourId, input)
  }

  const existing = await getTourAdminById(db, adminId)

  if (!existing || existing.tour_id !== tourId) {
    throw Object.assign(new Error('Tour admin not found'), { code: 'NOT_FOUND' })
  }

  let passwordHash =
    input.password_hash !== undefined
      ? input.password_hash
      : (existing.password_hash ?? null)

  if (input.password != null && input.password.length > 0) {
    passwordHash = await hashPassword(input.password)
  }

  const username = input.username.trim()
  if (!username) throw Object.assign(new Error('Username is required'), { field: 'username' })

  const countryCode = (input.country_code ?? existing.country_code ?? '+91').trim() || '+91'
  const mobile =
    input.mobile === undefined ? (existing.mobile ?? null) : input.mobile?.trim() || null

  const passwordEnabled =
    input.password_enabled === undefined
      ? Boolean(existing.password_enabled)
      : input.password_enabled
  const otpEnabled =
    input.otp_enabled === undefined ? Boolean(existing.otp_enabled) : input.otp_enabled
  const isActive =
    input.is_active === undefined ? Boolean(existing.is_active) : input.is_active
  const source = input.source ?? existing.source ?? 'manual'

  validateLoginFlags(passwordEnabled, otpEnabled)

  try {
    await db
      .prepare(
        `UPDATE tour_admins SET
           username = ?, password_hash = ?, country_code = ?, mobile = ?,
           password_enabled = ?, otp_enabled = ?, is_active = ?, source = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        username,
        passwordHash,
        countryCode,
        mobile,
        passwordEnabled ? 1 : 0,
        otpEnabled ? 1 : 0,
        isActive ? 1 : 0,
        source,
        now,
        existing.id,
      )
      .run()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('UNIQUE')) {
      throw Object.assign(new Error('Username already exists for this tour'), {
        field: 'username',
      })
    }
    throw e
  }

  const row = await getTourAdminById(db, existing.id)
  if (!row) throw new Error('Failed to save tour admin')
  return toPublic(row)
}

export async function deleteTourAdmin(db: D1Database, tourId: string, adminId: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM tour_admins WHERE id = ? AND tour_id = ?`)
    .bind(adminId, tourId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

export async function resetTourAdminPassword(
  db: D1Database,
  tourId: string,
  password?: string | null,
  adminId?: string | null,
): Promise<{ admin: TourAdminPublic; generated_password?: string }> {
  const existing = adminId
    ? await getTourAdminById(db, adminId)
    : await getTourAdminByTourId(db, tourId)

  if (!existing || existing.tour_id !== tourId) {
    throw Object.assign(new Error('Tour admin not found'), { code: 'NOT_FOUND' })
  }

  let plain = password?.trim() || null
  if (!plain) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    plain = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  }

  const hash = await hashPassword(plain)
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE tour_admins SET password_hash = ?, password_enabled = 1, updated_at = ? WHERE id = ?`,
    )
    .bind(hash, now, existing.id)
    .run()

  const row = await getTourAdminById(db, existing.id)
  if (!row) throw new Error('Failed to reset password')
  return {
    admin: toPublic(row),
    generated_password: password?.trim() ? undefined : plain,
  }
}

export async function touchLastLogin(db: D1Database, tourAdminId: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE tour_admins SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, tourAdminId)
    .run()
}
