/** Deep-link path for upload page with optional tour id (survives refresh). */
export function uploadPagePath(tourId?: string | null): string {
  if (!tourId) return '/upload'
  return `/upload?tour=${encodeURIComponent(tourId)}`
}

/** Resolve tour id from path param, ?tour= query, or React Router location state. */
export function resolveUploadTourId(
  pathTourId: string | undefined,
  queryTourId: string | null,
  stateTourId?: string | null,
): string | null {
  return pathTourId ?? queryTourId ?? stateTourId ?? null
}
