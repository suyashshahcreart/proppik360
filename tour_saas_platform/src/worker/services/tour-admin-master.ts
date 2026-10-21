// ============================================================
// Tour admin master defaults (singleton flags + multi templates)
// ============================================================
import { hashPassword } from './auth'
import { createTourAdmin, type TourAdminPublic } from './tour-admins'
import { listActiveTemplates } from './tour-admin-templates'

export interface TourAdminMaster {
  id: string
  auto_create_on_tour_create: number
  password_enabled_default: number
  otp_enabled_default: number
  default_username_pattern: string
  password_mode: 'random' | 'fixed'
  default_password_hash: string | null
  default_country_code: string
  default_mobile: string | null
  is_active_default: number
  updated_by: string | null
  updated_at: string
  created_at: string
}

export interface TourAdminMasterUpdate {
  auto_create_on_tour_create?: boolean
  /** @deprecated Prefer templates — kept for backward-compatible PUT. */
  password_enabled_default?: boolean
  otp_enabled_default?: boolean
  default_username_pattern?: string
  password_mode?: 'random' | 'fixed'
  default_password?: string | null
  default_country_code?: string
  default_mobile?: string | null
  is_active_default?: boolean
}

function boolToInt(v: boolean | undefined, current: number): number {
  if (v === undefined) return current
  return v ? 1 : 0
}

export async function getMaster(db: D1Database): Promise<TourAdminMaster> {
  const row = await db
    .prepare(`SELECT * FROM tour_admin_master_settings WHERE id = 'default'`)
    .first<TourAdminMaster>()

  if (row) return row

  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO tour_admin_master_settings (id, created_at, updated_at) VALUES ('default', ?, ?)`,
    )
    .bind(now, now)
    .run()

  const created = await db
    .prepare(`SELECT * FROM tour_admin_master_settings WHERE id = 'default'`)
    .first<TourAdminMaster>()
  if (!created) throw new Error('Failed to create tour_admin_master_settings')
  return created
}

/** Safe for API — never exposes password hash. */
export function masterToPublic(m: TourAdminMaster) {
  return {
    id: m.id,
    auto_create_on_tour_create: Boolean(m.auto_create_on_tour_create),
    password_enabled_default: Boolean(m.password_enabled_default),
    otp_enabled_default: Boolean(m.otp_enabled_default),
    default_username_pattern: m.default_username_pattern,
    password_mode: m.password_mode,
    has_fixed_password: Boolean(m.default_password_hash),
    default_country_code: m.default_country_code,
    default_mobile: m.default_mobile,
    is_active_default: Boolean(m.is_active_default),
    updated_at: m.updated_at,
  }
}

export async function updateMaster(
  db: D1Database,
  input: TourAdminMasterUpdate,
  userId: string,
): Promise<TourAdminMaster> {
  const current = await getMaster(db)
  const now = new Date().toISOString()

  let passwordHash = current.default_password_hash
  const mode = input.password_mode ?? current.password_mode
  if (mode === 'fixed' && input.default_password != null && input.default_password.length > 0) {
    passwordHash = await hashPassword(input.default_password)
  }
  if (mode === 'random') {
    passwordHash = null
  }

  await db
    .prepare(
      `UPDATE tour_admin_master_settings SET
         auto_create_on_tour_create = ?,
         password_enabled_default = ?,
         otp_enabled_default = ?,
         default_username_pattern = ?,
         password_mode = ?,
         default_password_hash = ?,
         default_country_code = ?,
         default_mobile = ?,
         is_active_default = ?,
         updated_by = ?,
         updated_at = ?
       WHERE id = 'default'`,
    )
    .bind(
      boolToInt(input.auto_create_on_tour_create, current.auto_create_on_tour_create),
      boolToInt(input.password_enabled_default, current.password_enabled_default),
      boolToInt(input.otp_enabled_default, current.otp_enabled_default),
      input.default_username_pattern?.trim() || current.default_username_pattern,
      mode,
      passwordHash,
      input.default_country_code?.trim() || current.default_country_code,
      input.default_mobile === undefined
        ? current.default_mobile
        : input.default_mobile?.trim() || null,
      boolToInt(input.is_active_default, current.is_active_default),
      userId,
      now,
    )
    .run()

  return getMaster(db)
}

function resolveUsername(pattern: string, tourId: string): string {
  return pattern.replace(/\{tour_id\}/gi, tourId).trim() || `admin-${tourId}`
}

function randomPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export interface ApplyMasterResult {
  admins: TourAdminPublic[]
  generated_passwords: Array<{ username: string; password: string }>
}

/**
 * Create tour_admins from all active master templates when auto_create is on.
 * Skips usernames that already exist for the tour.
 */
export async function applyMasterToNewTour(
  db: D1Database,
  tourId: string,
): Promise<ApplyMasterResult | null> {
  const master = await getMaster(db)
  if (!master.auto_create_on_tour_create) return null

  const templates = await listActiveTemplates(db)
  if (templates.length === 0) return null

  const admins: TourAdminPublic[] = []
  const generated_passwords: Array<{ username: string; password: string }> = []

  for (const tmpl of templates) {
    const username = resolveUsername(tmpl.username_pattern, tourId)
    let passwordHash: string | null = null
    let generatedPassword: string | undefined

    if (tmpl.password_enabled) {
      if (tmpl.password_mode === 'fixed' && tmpl.password_hash) {
        passwordHash = tmpl.password_hash
      } else {
        generatedPassword = randomPassword()
        passwordHash = await hashPassword(generatedPassword)
      }
    }

    try {
      const admin = await createTourAdmin(db, tourId, {
        username,
        password_hash: passwordHash,
        country_code: tmpl.country_code || '+91',
        mobile: tmpl.mobile,
        password_enabled: Boolean(tmpl.password_enabled),
        otp_enabled: Boolean(tmpl.otp_enabled),
        is_active: true,
        source: 'master_auto',
      })
      admins.push(admin)
      if (generatedPassword) {
        generated_passwords.push({ username, password: generatedPassword })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Skip duplicate username for this tour
      if (msg.includes('already exists')) continue
      throw e
    }
  }

  if (admins.length === 0) return null
  return { admins, generated_passwords }
}
