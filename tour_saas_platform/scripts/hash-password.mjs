/**
 * hash-password.mjs
 *
 * Generates a PBKDF2-SHA256 password hash compatible with the Worker's
 * services/auth.ts implementation.
 *
 * Run with Node.js 18+ (no dependencies required):
 *   node scripts/hash-password.mjs yourPassword123
 *
 * Prefer: npm run seed:admin
 * This script only prints a hash or manual SQL for advanced use.
 *
 * You can change the name and email in the printed command.
 */

import { randomUUID } from 'crypto'

const password = process.argv[2]

if (!password || password === '--help' || password === '-h') {
  console.log(`
Usage: node scripts/hash-password.mjs <password>

Generates a PBKDF2-SHA256 password hash. Use npm run seed:admin to create the admin user.

Example:
  node scripts/hash-password.mjs MySecurePassword123!
`)
  process.exit(password ? 0 : 1)
}

// These constants MUST match services/auth.ts exactly
const ITERATIONS = 100_000
const KEY_BITS = 256 // 32 bytes
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
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BITS,
  )

  const combined = new Uint8Array(SALT_BYTES + KEY_BITS / 8)
  combined.set(salt, 0)
  combined.set(new Uint8Array(hashBuffer), SALT_BYTES)

  return btoa(String.fromCharCode(...combined))
}

const hash = await hashPassword(password)
const userId = randomUUID()
const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

console.log('\n✅ Password hash generated.\n')
console.log('='.repeat(70))
console.log('To create admin in the local DB, run:')
console.log('  npm run seed:admin')
console.log('')
console.log('Hash (for manual SQL):')
console.log(hash)
console.log('')
