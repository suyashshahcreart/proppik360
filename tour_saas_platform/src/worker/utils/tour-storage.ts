// ============================================================
// R2 object key layout — bucket root: {tourId}/index.html, etc.
// (Legacy uploads may still exist under tours/{tourId}/…)
// ============================================================

export function tourR2Prefix(tourId: string): string {
  return `${tourId}/`
}

export function tourZipObjectKey(tourId: string): string {
  return `${tourId}/original.zip`
}

/** Prefix used when deleting all objects for a tour (current layout). */
export function tourDeletePrefix(tourId: string): string {
  return tourR2Prefix(tourId)
}

/** Older layout — include when purging so legacy objects are removed. */
export function legacyTourDeletePrefix(tourId: string): string {
  return `tours/${tourId}/`
}
