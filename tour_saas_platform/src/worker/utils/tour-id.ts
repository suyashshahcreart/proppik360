// ============================================================
// Six-digit public tour_id (R2 folder, URLs — not the QR code)
// ============================================================

export const TOUR_ID_REGEX = /^\d{6}$/

export function randomSixDigitTourId(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 900_000) + 100_000
  return String(n)
}

export async function isSixDigitTourIdAvailable(
  db: D1Database,
  id: string,
  excludeTourId?: string,
): Promise<boolean> {
  if (!TOUR_ID_REGEX.test(id)) return false
  const row = await db
    .prepare(
      `SELECT tour_id FROM tours
       WHERE deleted_at IS NULL AND tour_id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{ tour_id: string }>()
  if (!row) return true
  return row.tour_id === excludeTourId
}

export async function generateUniqueSixDigitTourId(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = randomSixDigitTourId()
    if (await isSixDigitTourIdAvailable(db, id)) return id
  }
  throw new Error('Could not generate a unique tour ID')
}

/** Create flow: use preferred 6-digit id when provided and free, else auto-generate. */
export async function resolveTourIdForCreate(
  db: D1Database,
  preferred?: string | null,
): Promise<string> {
  const trimmed = (preferred ?? '').trim()
  if (trimmed) {
    if (!TOUR_ID_REGEX.test(trimmed)) {
      throw Object.assign(new Error('Tour ID must be exactly 6 digits.'), { field: 'slug' })
    }
    if (!(await isSixDigitTourIdAvailable(db, trimmed))) {
      throw Object.assign(
        new Error('This tour ID is already in use. Enter another or click Regenerate.'),
        { field: 'slug' },
      )
    }
    return trimmed
  }
  return generateUniqueSixDigitTourId(db)
}
