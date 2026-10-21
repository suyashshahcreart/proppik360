// ============================================================
// Tour admin master templates (multiple default admins)
// ============================================================
import { hashPassword } from './auth'

export interface TourAdminTemplateRow {
  id: string
  label: string
  username_pattern: string
  password_mode: 'random' | 'fixed'
  password_hash: string | null
  country_code: string
  mobile: string | null
  password_enabled: number
  otp_enabled: number
  is_active: number
  sort_order: number
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface TourAdminTemplatePublic {
  id: string
  label: string
  username_pattern: string
  password_mode: 'random' | 'fixed'
  has_fixed_password: boolean
  country_code: string
  mobile: string | null
  password_enabled: boolean
  otp_enabled: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TourAdminTemplateInput {
  label: string
  username_pattern: string
  password_mode: 'random' | 'fixed'
  password?: string | null
  country_code?: string
  mobile?: string | null
  password_enabled?: boolean
  otp_enabled?: boolean
  is_active?: boolean
  sort_order?: number
}

export function templateToPublic(row: TourAdminTemplateRow): TourAdminTemplatePublic {
  return {
    id: row.id,
    label: row.label,
    username_pattern: row.username_pattern,
    password_mode: row.password_mode,
    has_fixed_password: Boolean(row.password_hash),
    country_code: row.country_code,
    mobile: row.mobile,
    password_enabled: Boolean(row.password_enabled),
    otp_enabled: Boolean(row.otp_enabled),
    is_active: Boolean(row.is_active),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listTemplates(db: D1Database): Promise<TourAdminTemplatePublic[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tour_admin_master_templates
       ORDER BY sort_order ASC, label ASC`,
    )
    .all<TourAdminTemplateRow>()
  return (result.results ?? []).map(templateToPublic)
}

export async function getTemplate(
  db: D1Database,
  id: string,
): Promise<TourAdminTemplateRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM tour_admin_master_templates WHERE id = ?`)
      .bind(id)
      .first<TourAdminTemplateRow>()) ?? null
  )
}

export async function listActiveTemplates(db: D1Database): Promise<TourAdminTemplateRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM tour_admin_master_templates
       WHERE is_active = 1
       ORDER BY sort_order ASC, label ASC`,
    )
    .all<TourAdminTemplateRow>()
  return result.results ?? []
}

function validateLoginFlags(passwordEnabled: boolean, otpEnabled: boolean) {
  if (!passwordEnabled && !otpEnabled) {
    throw Object.assign(
      new Error('Enable at least one of password or OTP login'),
      { field: 'password_enabled' },
    )
  }
}

export async function createTemplate(
  db: D1Database,
  input: TourAdminTemplateInput,
  userId: string,
): Promise<TourAdminTemplatePublic> {
  const label = input.label.trim()
  const pattern = input.username_pattern.trim()
  if (!label) throw Object.assign(new Error('Label is required'), { field: 'label' })
  if (!pattern) {
    throw Object.assign(new Error('Username pattern is required'), { field: 'username_pattern' })
  }

  const passwordEnabled = input.password_enabled ?? true
  const otpEnabled = input.otp_enabled ?? true
  validateLoginFlags(passwordEnabled, otpEnabled)

  const mode = input.password_mode
  let passwordHash: string | null = null
  if (mode === 'fixed') {
    const plain = input.password?.trim()
    if (!plain) {
      throw Object.assign(new Error('Fixed password is required'), { field: 'password' })
    }
    passwordHash = await hashPassword(plain)
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const sortOrder = input.sort_order ?? 0

  await db
    .prepare(
      `INSERT INTO tour_admin_master_templates (
         id, label, username_pattern, password_mode, password_hash,
         country_code, mobile, password_enabled, otp_enabled, is_active,
         sort_order, created_at, updated_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      label,
      pattern,
      mode,
      passwordHash,
      (input.country_code ?? '+91').trim() || '+91',
      input.mobile?.trim() || null,
      passwordEnabled ? 1 : 0,
      otpEnabled ? 1 : 0,
      (input.is_active ?? true) ? 1 : 0,
      sortOrder,
      now,
      now,
      userId,
    )
    .run()

  const row = await getTemplate(db, id)
  if (!row) throw new Error('Failed to create template')
  return templateToPublic(row)
}

export async function updateTemplate(
  db: D1Database,
  id: string,
  input: TourAdminTemplateInput,
  userId: string,
): Promise<TourAdminTemplatePublic> {
  const existing = await getTemplate(db, id)
  if (!existing) {
    throw Object.assign(new Error('Template not found'), { code: 'NOT_FOUND' })
  }

  const label = input.label.trim()
  const pattern = input.username_pattern.trim()
  if (!label) throw Object.assign(new Error('Label is required'), { field: 'label' })
  if (!pattern) {
    throw Object.assign(new Error('Username pattern is required'), { field: 'username_pattern' })
  }

  const passwordEnabled = input.password_enabled ?? Boolean(existing.password_enabled)
  const otpEnabled = input.otp_enabled ?? Boolean(existing.otp_enabled)
  validateLoginFlags(passwordEnabled, otpEnabled)

  const mode = input.password_mode
  let passwordHash = existing.password_hash
  if (mode === 'random') {
    passwordHash = null
  } else if (input.password != null && input.password.trim().length > 0) {
    passwordHash = await hashPassword(input.password.trim())
  } else if (mode === 'fixed' && !passwordHash) {
    throw Object.assign(new Error('Fixed password is required'), { field: 'password' })
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE tour_admin_master_templates SET
         label = ?, username_pattern = ?, password_mode = ?, password_hash = ?,
         country_code = ?, mobile = ?, password_enabled = ?, otp_enabled = ?,
         is_active = ?, sort_order = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    )
    .bind(
      label,
      pattern,
      mode,
      passwordHash,
      (input.country_code ?? existing.country_code).trim() || '+91',
      input.mobile === undefined ? existing.mobile : input.mobile?.trim() || null,
      passwordEnabled ? 1 : 0,
      otpEnabled ? 1 : 0,
      (input.is_active ?? Boolean(existing.is_active)) ? 1 : 0,
      input.sort_order ?? existing.sort_order,
      now,
      userId,
      id,
    )
    .run()

  const row = await getTemplate(db, id)
  if (!row) throw new Error('Failed to update template')
  return templateToPublic(row)
}

export async function deleteTemplate(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM tour_admin_master_templates WHERE id = ?`)
    .bind(id)
    .run()
  return (result.meta?.changes ?? 0) > 0
}
