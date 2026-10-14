// ============================================================
// Password hashing and verification using Web Crypto API
//
// Why PBKDF2?
//   Cloudflare Workers run in a V8 isolate — Node.js crypto modules
//   like bcrypt are not available. Web Crypto (crypto.subtle) is
//   natively supported and provides PBKDF2 which is appropriate
//   for password hashing in this environment.
//
// Parameters:
//   Algorithm: PBKDF2 with SHA-256
//   Iterations: 100,000
//   Salt: 16 random bytes (per password)
//   Output: 32 bytes (256 bits)
//
// Storage format:
//   base64(salt_16_bytes + hash_32_bytes)
// ============================================================

const ITERATIONS = 100_000
const KEY_BITS = 256 // 32 bytes
const SALT_BYTES = 16

/**
 * Hash a password with PBKDF2-SHA256 and a random salt.
 * Returns a base64-encoded string containing the salt + hash.
 * Store this string in the database — never the plain password.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
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

  // Combine: [16 bytes salt][32 bytes hash]
  const combined = new Uint8Array(SALT_BYTES + KEY_BITS / 8)
  combined.set(salt, 0)
  combined.set(new Uint8Array(hashBuffer), SALT_BYTES)

  return btoa(String.fromCharCode(...combined))
}

/**
 * Verify a plain-text password against a stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 * Returns true if the password matches, false otherwise.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(storedHash), (c) => c.charCodeAt(0))

    // The stored hash must be exactly SALT_BYTES + KEY_BYTES long
    if (combined.length !== SALT_BYTES + KEY_BITS / 8) return false

    const salt = combined.slice(0, SALT_BYTES)
    const expectedHash = combined.slice(SALT_BYTES)

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
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

    const actualHash = new Uint8Array(hashBuffer)

    // Constant-time comparison — prevents timing attacks
    if (actualHash.length !== expectedHash.length) return false
    let diff = 0
    for (let i = 0; i < actualHash.length; i++) {
      diff |= actualHash[i] ^ expectedHash[i]
    }
    return diff === 0
  } catch {
    return false
  }
}
