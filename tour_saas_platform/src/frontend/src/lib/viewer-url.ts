/** Must match server default in src/server/env.ts when VITE_R2_PUBLIC_DOMAIN is unset. */
const DEFAULT_R2_PUBLIC_DOMAIN = 'pub-97f4aa1642a4429982a8583c0cf894c0.r2.dev'

export function getR2PublicDomain(): string {
  const raw = import.meta.env.VITE_R2_PUBLIC_DOMAIN as string | undefined
  return (raw?.trim() || DEFAULT_R2_PUBLIC_DOMAIN)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

function getAdminPublicDomain(): string | null {
  const raw = import.meta.env.VITE_R2_ADMIN_PUBLIC_DOMAIN as string | undefined
  const trimmed = raw?.trim()
  if (!trimmed) return null
  return trimmed.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** CDN prefix URLs cleared for one tour (mirrors server buildTourPurgePrefixes). */
export function buildTourPurgePrefixUrls(tourId: string): string[] {
  const pid = tourId.trim()
  if (!pid) return []
  const main = getR2PublicDomain()
  const prefixes = [
    `https://${main}/${pid}/`,
    `https://${main}/tours/${pid}/`,
  ]
  const admin = getAdminPublicDomain()
  if (admin) prefixes.push(`https://${admin}/${pid}/`)
  return [...new Set(prefixes)]
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

/** Copy only the public tour viewer URL (nothing else). */
export async function copyTourViewerLink(
  tourId: string,
  viewerUrl?: string | null,
): Promise<string> {
  const url = resolveTourViewerUrl(tourId, viewerUrl)
  await navigator.clipboard.writeText(url)
  return url
}

function normalizeAdminEntryUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (trimmed.endsWith('/index.html') || trimmed.includes('/index.html?')) return trimmed
  if (trimmed.endsWith('/')) return `${trimmed}index.html`
  return `${trimmed}/index.html`
}

/** Admin package public URL (separate R2 bucket / domain). */
export function buildExpectedAdminUrl(
  tourId: string,
  publicDomain?: string | null,
): string | null {
  const raw = publicDomain?.trim()
  if (!raw) return null
  const host = raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/${tourId}/index.html`
}

export function resolveAdminPublishUrl(
  tourId: string | null | undefined,
  publishUrl: string | null | undefined,
  publicDomain?: string | null,
): string | null {
  if (!tourId) return null
  if (publishUrl?.trim()) return normalizeAdminEntryUrl(publishUrl)
  return buildExpectedAdminUrl(tourId, publicDomain)
}
