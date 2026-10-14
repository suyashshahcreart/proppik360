// ============================================================
// Server-side session management backed by D1
//
// Sessions are opaque UUIDs stored in D1.
// The session ID is set as an HTTP-only cookie.
// On every protected request, the session is validated by
// querying D1 — no JWT decoding, no shared secrets needed.
// ============================================================
import type { User } from '../types'

const SESSION_DURATION_DAYS = 7

/**
 * Create a new session for a user. Returns the session ID,
 * which is set as a cookie in the HTTP response.
 */
export async function createSession(
  db: D1Database,
  userId: string,
): Promise<string> {
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    )
    .bind(sessionId, userId, expiresAt)
    .run()

  return sessionId
}

/**
 * Validate a session ID from a cookie.
 * Returns the associated User row if valid, null otherwise.
 *
 * A session is invalid if:
 *   - it does not exist in the database
 *   - it is expired (expires_at <= now)
 *   - the associated user is not active
 */
export async function validateSession(
  db: D1Database,
  sessionId: string,
): Promise<User | null> {
  const result = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.updated_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?
         AND s.expires_at > datetime('now')
         AND u.status = 'active'`,
    )
    .bind(sessionId)
    .first<User>()

  return result ?? null
}

/**
 * Delete a session from D1. Called on logout.
 */
export async function deleteSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE id = ?')
    .bind(sessionId)
    .run()
}

/**
 * Build the Set-Cookie header value for setting the session cookie.
 * - HttpOnly:   JavaScript cannot access this cookie (XSS protection)
 * - Secure:     Only sent over HTTPS (production only)
 * - SameSite=Lax: Protects against CSRF while allowing normal navigation
 */
export function buildSessionCookie(
  sessionId: string,
  isProduction: boolean,
): string {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60
  const secure = isProduction ? '; Secure' : ''
  return `session=${sessionId}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/**
 * Build the Set-Cookie header value for clearing the session cookie.
 * Sets Max-Age=0 to immediately expire the cookie.
 */
export function clearSessionCookie(isProduction: boolean): string {
  const secure = isProduction ? '; Secure' : ''
  return `session=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`
}

/**
 * Parse a specific cookie value from the Cookie request header.
 * Example: parseCookieHeader("session=abc123; other=xyz", "session") → "abc123"
 */
export function parseCookieHeader(
  cookieHeader: string,
  name: string,
): string | null {
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    const eqIndex = cookie.indexOf('=')
    if (eqIndex === -1) continue
    const key = cookie.slice(0, eqIndex).trim()
    const value = cookie.slice(eqIndex + 1).trim()
    if (key === name) return value
  }
  return null
}
