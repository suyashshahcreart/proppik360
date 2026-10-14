// ============================================================
// Alphanumeric QR codes (labels / scanning — separate from tour_id)
// ============================================================

export const QR_CODE_REGEX = /^[0-9a-z]{8}$/

const QR_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function randomQrCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const byte of bytes) {
    code += QR_ALPHABET[byte % QR_ALPHABET.length]
  }
  return code
}

export async function isQrCodeAvailable(
  db: D1Database,
  code: string,
  excludeTourId?: string,
): Promise<boolean> {
  if (!QR_CODE_REGEX.test(code)) return false
  const row = await db
    .prepare(
      `SELECT tour_id FROM tours
       WHERE deleted_at IS NULL AND qr_code = ?
       LIMIT 1`,
    )
    .bind(code)
    .first<{ tour_id: string }>()
  if (!row) return true
  return Boolean(excludeTourId && row.tour_id === excludeTourId)
}

export async function generateUniqueQrCode(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = randomQrCode()
    if (await isQrCodeAvailable(db, code)) return code
  }
  throw new Error('Could not generate a unique QR code')
}
