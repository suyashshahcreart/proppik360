/** Must match server default in src/server/env.ts when VITE_R2_PUBLIC_DOMAIN is unset. */
const DEFAULT_R2_PUBLIC_DOMAIN = 'pub-97f4aa1642a4429982a8583c0cf894c0.r2.dev'

export function getR2PublicDomain(): string {
  const raw = import.meta.env.VITE_R2_PUBLIC_DOMAIN as string | undefined
  return (raw?.trim() || DEFAULT_R2_PUBLIC_DOMAIN)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

/** Public viewer link after ZIP is published (same shape as API buildViewerUrl). */
export function buildExpectedViewerUrl(tourId: string): string {
  const domain = getR2PublicDomain()
  const path = `/${tourId}/index.html`.replace(/\/+/g, '/')
  return `https://${domain}${path}`
}

/** Live URL from API when ready; otherwise the URL that will be used after upload. */
export function resolveTourViewerUrl(
  tourId: string,
  viewerUrl: string | null | undefined,
): string {
  if (viewerUrl?.trim()) return viewerUrl.trim()
  return buildExpectedViewerUrl(tourId)
}
