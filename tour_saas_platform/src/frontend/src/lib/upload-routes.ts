/** Deep-link path for upload page with optional tour id (survives refresh). */
export function uploadPagePath(
  tourId?: string | null,
  options?: { artifact?: 'tour_admin' | 'tour_viewer' | null },
): string {
  const params = new URLSearchParams()
  if (tourId) params.set('tour', tourId)
  if (options?.artifact === 'tour_admin') {
    params.set('artifact', 'tour_admin')
  }
  const qs = params.toString()
  return qs ? `/upload?${qs}` : '/upload'
}

/** Resolve tour id from path param, ?tour= query, or React Router location state. */
export function resolveUploadTourId(
  pathTourId: string | undefined,
  queryTourId: string | null,
  stateTourId?: string | null,
): string | null {
  return pathTourId ?? queryTourId ?? stateTourId ?? null
}

export function resolveUploadArtifact(
  queryArtifact: string | null,
): 'tour_admin' | 'tour_viewer' {
  return queryArtifact === 'tour_admin' ? 'tour_admin' : 'tour_viewer'
}
