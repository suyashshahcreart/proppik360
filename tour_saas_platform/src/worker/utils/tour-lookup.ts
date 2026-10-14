/** Public 6-digit tour identifier used in URLs, R2, and processor webhooks. */
export type PublicTourId = string

/** Resolve the public tour id from a row (always prefer tour_id). */
export function publicTourId(row: { tour_id?: string | null; id?: string | number }): string {
  if (row.tour_id) return row.tour_id
  if (typeof row.id === 'string') return row.id
  return String(row.id ?? '')
}
