/** Must match server default in src/server/env.ts when VITE_R2_PUBLIC_DOMAIN is unset. */
const DEFAULT_R2_PUBLIC_DOMAIN = 'pub-97f4aa1642a4429982a8583c0cf894c0.r2.dev'

const DEFAULT_ADMIN_PUBLIC_PATH_PREFIX = '/admin'

export function getR2PublicDomain(): string {
  const raw = import.meta.env.VITE_R2_PUBLIC_DOMAIN as string | undefined
  return (raw?.trim() || DEFAULT_R2_PUBLIC_DOMAIN)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}

function normalizeAdminPathPrefix(prefix?: string | null): string {
  const raw = (prefix?.trim() || DEFAULT_ADMIN_PUBLIC_PATH_PREFIX).replace(/\/+$/, '')
  if (!raw.startsWith('/')) return `/${raw}`
  return raw || DEFAULT_ADMIN_PUBLIC_PATH_PREFIX
}

function getAdminPublicHost(): string | null {
  const vps = import.meta.env.VITE_TOUR_ADMIN_PUBLIC_HOST as string | undefined
  if (vps?.trim()) {
    return vps.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
  const legacy = import.meta.env.VITE_R2_ADMIN_PUBLIC_DOMAIN as string | undefined
  if (legacy?.trim()) {
    return legacy.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
  return null
}

function getAdminPathPrefix(): string | null {
  const vpsRoot = import.meta.env.VITE_TOUR_ADMIN_PUBLISH_ROOT as string | undefined
  const vpsHost = import.meta.env.VITE_TOUR_ADMIN_PUBLIC_HOST as string | undefined
  if (vpsRoot?.trim() && vpsHost?.trim()) {
    const raw = import.meta.env.VITE_TOUR_ADMIN_PUBLIC_PATH_PREFIX as string | undefined
    return normalizeAdminPathPrefix(raw)
  }
  if (import.meta.env.VITE_R2_ADMIN_PUBLIC_DOMAIN?.trim()) {
    return null
  }
  return null
}

function usesVpsAdminPreview(): boolean {
  return Boolean(
    import.meta.env.VITE_TOUR_ADMIN_PUBLISH_ROOT?.trim() &&
      import.meta.env.VITE_TOUR_ADMIN_PUBLIC_HOST?.trim(),
  )
}

function buildAdminPurgePrefixUrl(tourId: string): string | null {
  const host = getAdminPublicHost()
  if (!host) return null
  if (usesVpsAdminPreview()) {
    const prefix = getAdminPathPrefix() ?? DEFAULT_ADMIN_PUBLIC_PATH_PREFIX
    const path = `${prefix}/${tourId}/`.replace(/\/+/g, '/')
    return `https://${host}${path}`
  }
  return `https://${host}/${tourId}/`
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
  const adminPrefix = buildAdminPurgePrefixUrl(pid)
  if (adminPrefix) prefixes.push(adminPrefix)
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

/** Expected admin entry URL from Vite env (VPS or legacy R2). */
export function buildExpectedAdminUrl(
  tourId: string,
  publicDomain?: string | null,
): string | null {
  const hostFromArg = publicDomain?.trim()
    ? publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : null
  const host = hostFromArg || getAdminPublicHost()
  if (!host) return null

  if (usesVpsAdminPreview() || (hostFromArg && getAdminPathPrefix())) {
    const prefix = getAdminPathPrefix() ?? DEFAULT_ADMIN_PUBLIC_PATH_PREFIX
    const path = `${prefix}/${tourId}/index.html`.replace(/\/+/g, '/')
    return `https://${host}${path}`
  }

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
