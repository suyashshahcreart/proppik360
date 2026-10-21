// ============================================================
// Tour admin public auth: password login, OTP, sessions
// ============================================================
import { hashPassword, verifyPassword } from './auth'
import {
  findTourAdminByUsername,
  listActiveTourAdmins,
  touchLastLogin,
  type TourAdminRow,
} from './tour-admins'
import { getSetting } from './settings'
import { sendMsg91Otp } from './msg91'
import type { Env } from '../types'

const MAX_OTP_ATTEMPTS = 5
const SESSION_DAYS = 7

function normalizeMobileDigits(mobile: string): string {
  return mobile.replace(/\D/g, '')
}

function mobilesMatch(a: string, b: string): boolean {
  const da = normalizeMobileDigits(a)
  const db = normalizeMobileDigits(b)
  if (!da || !db) return false
  return da === db || da.endsWith(db) || db.endsWith(da)
}

async function ensureTourExists(db: D1Database, tourId: string): Promise<boolean> {
  const tour = await db
    .prepare(
      `SELECT tour_id FROM tours WHERE tour_id = ? AND deleted_at IS NULL`,
    )
    .bind(tourId)
    .first<{ tour_id: string }>()
  return Boolean(tour)
}

/** First active admin for the tour (legacy helpers). Prefer find by username/mobile. */
export async function getActiveTourAdmin(
  db: D1Database,
  tourId: string,
): Promise<TourAdminRow | null> {
  if (!(await ensureTourExists(db, tourId))) return null
  const admins = await listActiveTourAdmins(db, tourId)
  return admins[0] ?? null
}

function adminMobileMatches(admin: TourAdminRow, mobile: string): boolean {
  if (!admin.mobile) return false
  return (
    mobilesMatch(admin.mobile, mobile) ||
    mobilesMatch(`${admin.country_code}${admin.mobile}`, mobile)
  )
}

export async function findActiveTourAdminByMobile(
  db: D1Database,
  tourId: string,
  mobile: string,
): Promise<TourAdminRow | null> {
  if (!(await ensureTourExists(db, tourId))) return null
  const admins = await listActiveTourAdmins(db, tourId)
  return admins.find((a) => a.otp_enabled && adminMobileMatches(a, mobile)) ?? null
}

export async function createTourAdminSession(
  db: D1Database,
  tourId: string,
  tourAdminId: string,
  loginMethod: 'password' | 'otp',
): Promise<{ sessionId: string; expiresAt: string }> {
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO tour_admin_sessions (id, tour_id, tour_admin_id, login_method, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, tourId, tourAdminId, loginMethod, expiresAt, now)
    .run()
  await touchLastLogin(db, tourAdminId)
  return { sessionId, expiresAt }
}

export async function validateTourAdminSession(
  db: D1Database,
  sessionId: string,
  tourId: string,
): Promise<{
  valid: boolean
  tour_id?: string
  admin_id?: string
  expires_at?: string
  login_method?: string
}> {
  const row = await db
    .prepare(
      `SELECT id, tour_id, tour_admin_id, login_method, expires_at
       FROM tour_admin_sessions
       WHERE id = ? AND tour_id = ?`,
    )
    .bind(sessionId, tourId)
    .first<{
      id: string
      tour_id: string
      tour_admin_id: string
      login_method: string
      expires_at: string
    }>()

  if (!row) return { valid: false }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare(`DELETE FROM tour_admin_sessions WHERE id = ?`).bind(sessionId).run()
    return { valid: false }
  }

  return {
    valid: true,
    tour_id: row.tour_id,
    admin_id: row.tour_admin_id,
    expires_at: row.expires_at,
    login_method: row.login_method,
  }
}

export async function deleteTourAdminSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare(`DELETE FROM tour_admin_sessions WHERE id = ?`).bind(sessionId).run()
}

export async function loginWithPassword(
  db: D1Database,
  tourId: string,
  username: string,
  password: string,
): Promise<{ sessionId: string; expiresAt: string } | { error: string; status: number }> {
  if (!(await ensureTourExists(db, tourId))) {
    return { error: 'Tour admin not found or inactive', status: 404 }
  }
  const admin = await findTourAdminByUsername(db, tourId, username)
  if (!admin) return { error: 'Invalid username or password', status: 401 }
  if (!admin.password_enabled) return { error: 'Password login is disabled', status: 403 }
  if (!admin.password_hash) return { error: 'Invalid username or password', status: 401 }

  const ok = await verifyPassword(password, admin.password_hash)
  if (!ok) return { error: 'Invalid username or password', status: 401 }

  return createTourAdminSession(db, tourId, admin.id, 'password')
}

function generateOtp(length: number): string {
  const len = Math.min(8, Math.max(4, length))
  const max = 10 ** len
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max
  return String(n).padStart(len, '0')
}

export async function sendOtp(
  env: Env,
  tourId: string,
  mobile: string,
): Promise<{ ok: true; expiresInSec: number } | { error: string; status: number }> {
  const admin = await findActiveTourAdminByMobile(env.DB, tourId, mobile)
  if (!admin) return { error: 'Tour admin not found for this mobile', status: 404 }
  if (!admin.otp_enabled) return { error: 'OTP login is disabled', status: 403 }
  if (!admin.mobile) return { error: 'No mobile configured for this tour admin', status: 400 }

  const length = Number((await getSetting(env.DB, 'otp_length', '6')) || 6)
  const expirySec = Number((await getSetting(env.DB, 'otp_expiry_sec', '300')) || 300)
  const otp = generateOtp(length)
  const otpHash = await hashPassword(otp)
  const id = crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expirySec * 1000).toISOString()

  // Invalidate previous unverified OTPs for this tour+mobile
  await env.DB
    .prepare(
      `DELETE FROM tour_admin_otp_requests
       WHERE tour_id = ? AND verified_at IS NULL AND mobile = ?`,
    )
    .bind(tourId, normalizeMobileDigits(mobile))
    .run()

  const send = await sendMsg91Otp(env, {
    countryCode: admin.country_code,
    mobile: admin.mobile,
    otp,
  })
  if (!send.ok) {
    return { error: send.error || 'Failed to send OTP', status: 502 }
  }

  await env.DB
    .prepare(
      `INSERT INTO tour_admin_otp_requests (
         id, tour_id, tour_admin_id, mobile, otp_hash, expires_at, attempts, msg91_request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      tourId,
      admin.id,
      normalizeMobileDigits(mobile),
      otpHash,
      expiresAt,
      send.requestId ?? null,
      now.toISOString(),
    )
    .run()

  return { ok: true, expiresInSec: expirySec }
}

export async function verifyOtp(
  db: D1Database,
  tourId: string,
  mobile: string,
  otp: string,
): Promise<{ sessionId: string; expiresAt: string } | { error: string; status: number }> {
  if (!(await ensureTourExists(db, tourId))) {
    return { error: 'Tour admin not found or inactive', status: 404 }
  }

  const row = await db
    .prepare(
      `SELECT * FROM tour_admin_otp_requests
       WHERE tour_id = ? AND verified_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(tourId)
    .first<{
      id: string
      tour_admin_id: string
      mobile: string
      otp_hash: string
      expires_at: string
      attempts: number
    }>()

  if (!row) return { error: 'No OTP request found — send OTP first', status: 400 }
  if (!mobilesMatch(row.mobile, mobile)) {
    return { error: 'Mobile does not match OTP request', status: 403 }
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: 'OTP expired', status: 400 }
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    return { error: 'Too many OTP attempts', status: 429 }
  }

  await db
    .prepare(`UPDATE tour_admin_otp_requests SET attempts = attempts + 1 WHERE id = ?`)
    .bind(row.id)
    .run()

  const match = await verifyPassword(otp.trim(), row.otp_hash)
  if (!match) return { error: 'Invalid OTP', status: 401 }

  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE tour_admin_otp_requests SET verified_at = ? WHERE id = ?`)
    .bind(now, row.id)
    .run()

  return createTourAdminSession(db, tourId, row.tour_admin_id, 'otp')
}

export async function getTourAdminPublicConfig(db: D1Database, tourId: string) {
  if (!(await ensureTourExists(db, tourId))) return null
  const admins = await listActiveTourAdmins(db, tourId)
  if (admins.length === 0) return null
  return {
    tour_id: tourId,
    password_enabled: admins.some((a) => a.password_enabled),
    otp_enabled: admins.some((a) => a.otp_enabled),
    is_active: true,
    admin_count: admins.length,
  }
}
