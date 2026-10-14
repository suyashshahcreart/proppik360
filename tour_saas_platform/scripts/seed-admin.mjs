/**

 * Insert default admin user + assign RBAC role_admin (required for sidebar/UI).

 */

import { DatabaseSync } from 'node:sqlite'

import { resolve, dirname } from 'node:path'

import { mkdirSync } from 'node:fs'

import { randomUUID } from 'node:crypto'



const dbPath = resolve(process.env.SQLITE_PATH || 'D:/Extra/proppik360/data/platform.sqlite')

mkdirSync(dirname(dbPath), { recursive: true })



const email = process.env.ADMIN_EMAIL || 'admin@example.com'

const password = process.argv[2] || process.env.ADMIN_PASSWORD || 'Proppik360Local!'

const name = process.env.ADMIN_NAME || 'Admin'



const ITERATIONS = 100_000

const KEY_BITS = 256

const SALT_BYTES = 16



async function hashPassword(pw) {

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))

  const keyMaterial = await crypto.subtle.importKey(

    'raw',

    new TextEncoder().encode(pw),

    'PBKDF2',

    false,

    ['deriveBits'],

  )

  const hashBuffer = await crypto.subtle.deriveBits(

    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },

    keyMaterial,

    KEY_BITS,

  )

  const combined = new Uint8Array(SALT_BYTES + KEY_BITS / 8)

  combined.set(salt, 0)

  combined.set(new Uint8Array(hashBuffer), SALT_BYTES)

  return btoa(String.fromCharCode(...combined))

}



function assignAdminRole(db, userId) {

  db.prepare(

    `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')`,

  ).run(userId)

}



function backfillAllAdminUsers(db) {
  const rows = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all()
  for (const row of rows) {
    assignAdminRole(db, row.id)
  }
  return rows.length
}



const db = new DatabaseSync(dbPath)



// Fix admins created before RBAC link (common after npm run seed:admin)

try {

  backfillAllAdminUsers(db)

} catch {

  db.prepare(

    `INSERT OR IGNORE INTO user_roles (user_id, role_id)

     SELECT id, 'role_admin' FROM users WHERE role = 'admin'`,

  ).run()

}



const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)

if (existing) {

  assignAdminRole(db, existing.id)

  console.log(`Admin already exists: ${email}`)

  console.log('RBAC role_admin ensured (log out and log in again if the menu was empty).')

  process.exit(0)

}



const id = randomUUID()

const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

const password_hash = await hashPassword(password)



db.prepare(

  `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)

   VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`,

).run(id, name, email, password_hash, now, now)



assignAdminRole(db, id)



console.log('Admin user created.')

console.log(`  Email:    ${email}`)

console.log(`  Password: ${password}`)

console.log(`  DB:       ${dbPath}`)


