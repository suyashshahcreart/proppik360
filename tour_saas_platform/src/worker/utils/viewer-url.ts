// ============================================================
// Public tour viewer URL helpers
//
// New uploads: https://{R2_PUBLIC_DOMAIN}/{tourId}/index.html
// Legacy flat:  …/tours/{tourId}/index.html
// Legacy nested: …/tours/{tourId}/viewer/index.html
// ============================================================
import type { Tour } from '../types'

/** Path segment before tour id (empty for current bucket layout). */
export function getToursPathPrefix(_publicDomain: string): string {
  return ''
}

/** Legacy r2.dev layout included a /tours prefix before the tour id. */
export function getLegacyToursPathPrefix(publicDomain: string): string {
  return publicDomain.endsWith('.r2.dev') ? '/tours' : ''
}

function joinViewerPath(publicDomain: string, tourId: string, leaf: string, search = ''): string {
  const prefix = getToursPathPrefix(publicDomain)
  const path = `${prefix}/${tourId}/${leaf}`.replace(/\/+/g, '/')
  const query = search.startsWith('?') ? search : search ? `?${search}` : ''
  return `https://${publicDomain}${path}${query}`
}

/** Public URL for a Go-first tour (flat publish, no viewer/ folder). */
export function buildViewerUrl(
  publicDomain: string,
  tourId: string,
  search = '',
): string {
  return joinViewerPath(publicDomain, tourId, 'index.html', search)
}

/** Public URL for tours published before the flat-path change. */
export function buildLegacyViewerUrl(
  publicDomain: string,
  tourId: string,
  search = '',
): string {
  const prefix = getLegacyToursPathPrefix(publicDomain)
  const path = `${prefix}/${tourId}/viewer/index.html`.replace(/\/+/g, '/')
  const query = search.startsWith('?') ? search : search ? `?${search}` : ''
  return `https://${publicDomain}${path}${query}`
}

/** Preserve query params (e.g. ?node=...) from a stored or processor URL. */
export function extractSearchFromViewerUrl(viewerUrl: string): string {
  const qIndex = viewerUrl.indexOf('?')
  return qIndex >= 0 ? viewerUrl.slice(qIndex) : ''
}

/** Rewrite a tour's viewer_url to the current flat layout and public domain. */
export function withPublicViewerUrl(tour: Tour, publicDomain: string): Tour {
  if (!tour.viewer_url) return tour

  const pid = tour.tour_id ?? String(tour.id)
  const search = extractSearchFromViewerUrl(tour.viewer_url)
  const normalized = buildViewerUrl(publicDomain, pid, search)

  if (normalized === tour.viewer_url) return tour
  return { ...tour, viewer_url: normalized }
}
