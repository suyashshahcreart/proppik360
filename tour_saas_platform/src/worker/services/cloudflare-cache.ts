// ============================================================
// Cloudflare zone cache purge (tour prefixes + custom / bulk)
// ============================================================
import type { Env } from '../types'
import {
  adminWebPublishPrefix,
  isTourAdminVpsPublishConfigured,
} from './admin-paths'
import { tourR2Prefix } from '../utils/tour-storage'
import { listObjectsPage, type R2Config } from './r2'

export const PURGE_ALL_CONFIRM_PHRASE = 'PURGE ALL CACHE'
export const MAX_BULK_TOUR_PURGE = 50
const FILES_PER_REQUEST = 30

export type CloudflarePurgeBody =
  | { files?: string[]; prefixes?: string[]; tags?: string[]; hosts?: string[] }
  | { purge_everything: true }

export interface CloudflarePurgeApiResult {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  messages?: string[]
  result?: unknown
}

export interface TourPurgeResult {
  tourId: string
  mode: 'prefix' | 'files'
  prefixes: string[]
  fileCount?: number
  cloudflare: CloudflarePurgeApiResult
  /** Non-fatal issues (e.g. admin zone purge failed while main succeeded). */
  warnings?: string[]
}

/** Cap file-by-file fallback — listing/purging above this is too slow for one HTTP request. */
export const MAX_R2_FILE_PURGE = 500

export class CachePurgeNotConfiguredError extends Error {
  constructor() {
    super('Cloudflare cache purge is not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID)')
    this.name = 'CachePurgeNotConfiguredError'
  }
}

function normalizeHost(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function getAllowedPurgeHosts(env: Env): Set<string> {
  const hosts = new Set<string>()
  const main = env.R2_PUBLIC_DOMAIN?.trim()
  if (main) hosts.add(normalizeHost(main))
  if (isTourAdminVpsPublishConfigured(env)) {
    const vpsHost = env.TOUR_ADMIN_PUBLIC_HOST?.trim()
    if (vpsHost) hosts.add(normalizeHost(vpsHost))
  } else {
    const admin = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
    if (admin) hosts.add(normalizeHost(admin))
  }
  return hosts
}

function resolveZoneIdForHost(env: Env, host: string): string | undefined {
  const mainHost = env.R2_PUBLIC_DOMAIN?.trim()
    ? normalizeHost(env.R2_PUBLIC_DOMAIN)
    : ''
  const adminHost = isTourAdminVpsPublishConfigured(env)
    ? env.TOUR_ADMIN_PUBLIC_HOST?.trim()
      ? normalizeHost(env.TOUR_ADMIN_PUBLIC_HOST)
      : ''
    : env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
      ? normalizeHost(env.R2_ADMIN_PUBLIC_DOMAIN)
      : ''

  const defaultZone = env.CLOUDFLARE_ZONE_ID?.trim()
  const adminZoneDedicated = env.CLOUDFLARE_ADMIN_ZONE_ID?.trim()

  if (mainHost && host === mainHost) return defaultZone
  if (adminHost && host === adminHost) {
    if (isTourAdminVpsPublishConfigured(env)) {
      return adminZoneDedicated
    }
    return adminZoneDedicated || defaultZone
  }
  return defaultZone
}

/** VPS admin CDN purge only when a dedicated Cloudflare zone id is configured. */
export function canPurgeVpsAdminCdn(env: Env): boolean {
  if (!isTourAdminVpsPublishConfigured(env)) return false
  return Boolean(env.CLOUDFLARE_ADMIN_ZONE_ID?.trim())
}

function groupPrefixesByZone(
  env: Env,
  prefixes: string[],
): { ok: true; byZone: Map<string, string[]> } | { ok: false; message: string } {
  const byZone = new Map<string, string[]>()
  for (const p of prefixes) {
    const host = hostFromPurgePrefix(p)
    if (!host) {
      return { ok: false, message: `Invalid purge prefix: ${p}` }
    }
    const zoneId = resolveZoneIdForHost(env, host)
    if (!zoneId) {
      return { ok: false, message: `No Cloudflare zone for host ${host}` }
    }
    const list = byZone.get(zoneId) ?? []
    list.push(p)
    byZone.set(zoneId, list)
  }
  return { ok: true, byZone }
}

async function purgePrefixesAcrossZones(
  env: Env,
  prefixes: string[],
): Promise<CloudflarePurgeApiResult> {
  const grouped = groupPrefixesByZone(env, prefixes)
  if (!grouped.ok) {
    return { success: false, errors: [{ code: 0, message: grouped.message }] }
  }
  const { token } = assertCloudflarePurgeConfigured(env)
  let last: CloudflarePurgeApiResult = { success: true }
  for (const [zoneId, zonePrefixes] of grouped.byZone) {
    last = await callCloudflarePurge(zoneId, token, { prefixes: zonePrefixes })
    if (!last.success) return last
  }
  return last
}

function adminPurgeHost(env: Env): string {
  if (isTourAdminVpsPublishConfigured(env)) {
    const h = env.TOUR_ADMIN_PUBLIC_HOST?.trim()
    return h ? normalizeHost(h) : ''
  }
  const legacy = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
  return legacy ? normalizeHost(legacy) : ''
}

function splitMainAndAdminPrefixes(env: Env, prefixes: string[]): {
  main: string[]
  admin: string[]
} {
  const mainHost = env.R2_PUBLIC_DOMAIN?.trim() ? normalizeHost(env.R2_PUBLIC_DOMAIN) : ''
  const adminHost = adminPurgeHost(env)
  const main: string[] = []
  const admin: string[] = []
  for (const p of prefixes) {
    const h = hostFromPurgePrefix(p)
    if (adminHost && h === adminHost) admin.push(p)
    else if (mainHost && h === mainHost) main.push(p)
    else main.push(p)
  }
  return { main, admin }
}

function cloudflareErrorMessage(cf: CloudflarePurgeApiResult): string {
  return cf.errors?.[0]?.message ?? 'Cloudflare cache purge failed'
}

/** Cloudflare purge_cache `prefixes` value: `host/path/` — no `https://` (API requirement). */
export function buildCloudflarePurgePrefix(
  host: string,
  pathWithoutLeadingSlash: string,
): string {
  const hostNorm = normalizeHost(host)
  const path = pathWithoutLeadingSlash.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!path) return `${hostNorm}/`
  return `${hostNorm}/${path}/`
}

/** Human-readable URL for UI / docs (https with trailing slash). */
export function purgePrefixForDisplay(apiPrefix: string): string {
  const p = apiPrefix.trim()
  if (/^https?:\/\//i.test(p)) {
    return p.endsWith('/') ? p : `${p}/`
  }
  const body = p.replace(/^\/+/, '')
  return `https://${body.endsWith('/') ? body : `${body}/`}`
}

function httpsPrefixToCloudflareApiPrefix(url: string): string {
  let p = url.trim()
  if (!p.endsWith('/')) p += '/'
  return p.replace(/^https?:\/\//i, '')
}

function hostFromPurgePrefix(prefix: string): string | null {
  const p = prefix.trim()
  if (/^https?:\/\//i.test(p)) return hostFromUrl(p)
  const body = p.replace(/^\/+/, '')
  const slash = body.indexOf('/')
  const host = slash === -1 ? body : body.slice(0, slash)
  return host ? normalizeHost(host) : null
}

/** Public CDN prefixes cleared for one tour (flat viewer path + optional admin). */
export function buildTourPurgePrefixes(tourId: string, env: Env): string[] {
  const pid = tourId.trim()
  if (!pid) return []

  const mainHost = env.R2_PUBLIC_DOMAIN?.trim()
  const prefixes: string[] = []
  if (mainHost) {
    prefixes.push(buildCloudflarePurgePrefix(mainHost, tourR2Prefix(pid)))
  }

  if (isTourAdminVpsPublishConfigured(env)) {
    if (canPurgeVpsAdminCdn(env)) {
      const adminHost = env.TOUR_ADMIN_PUBLIC_HOST!.trim()
      const webPath = adminWebPublishPrefix(pid, env.TOUR_ADMIN_PUBLIC_PATH_PREFIX).replace(
        /\/$/,
        '',
      )
      prefixes.push(buildCloudflarePurgePrefix(adminHost, webPath))
    }
  } else {
    const adminHost = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
    if (adminHost) {
      prefixes.push(buildCloudflarePurgePrefix(adminHost, tourR2Prefix(pid)))
    }
  }

  return [...new Set(prefixes)]
}

export function assertCloudflarePurgeConfigured(env: Env): {
  token: string
  zoneId: string
} {
  const token = env.CLOUDFLARE_API_TOKEN?.trim()
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim()
  if (!token || !zoneId) {
    throw new CachePurgeNotConfiguredError()
  }
  return { token, zoneId }
}

export async function callCloudflarePurge(
  zoneId: string,
  token: string,
  body: CloudflarePurgeBody,
): Promise<CloudflarePurgeApiResult> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await response.json()) as CloudflarePurgeApiResult
  if (!response.ok && json.success !== false) {
    return {
      success: false,
      errors: [{ code: response.status, message: `HTTP ${response.status}` }],
    }
  }
  return json
}

function r2ConfigFromEnv(env: Env): R2Config {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }
}

async function listAllObjectKeys(config: R2Config, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await listObjectsPage(config, { prefix, limit: 1000, cursor })
    for (const obj of page.objects) {
      keys.push(obj.key)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys
}

async function purgeFilesBatched(
  zoneId: string,
  token: string,
  files: string[],
): Promise<{ last: CloudflarePurgeApiResult; batches: number }> {
  let last: CloudflarePurgeApiResult = { success: true }
  let batches = 0
  for (let i = 0; i < files.length; i += FILES_PER_REQUEST) {
    const chunk = files.slice(i, i + FILES_PER_REQUEST)
    last = await callCloudflarePurge(zoneId, token, { files: chunk })
    batches += 1
    if (!last.success) break
  }
  return { last, batches }
}

function hostFromUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname)
  } catch {
    return null
  }
}

export function validateCustomPurgeValues(
  env: Env,
  mode: 'url' | 'hostname' | 'tag' | 'prefix',
  values: string[],
): { ok: true; payload: CloudflarePurgeBody } | { ok: false; message: string } {
  const trimmed = values.map((v) => v.trim()).filter(Boolean)
  if (trimmed.length === 0) {
    return { ok: false, message: 'At least one value is required' }
  }

  const allowedHosts = getAllowedPurgeHosts(env)
  if (allowedHosts.size === 0) {
    return { ok: false, message: 'R2_PUBLIC_DOMAIN is not configured' }
  }

  switch (mode) {
    case 'url': {
      for (const url of trimmed) {
        if (!/^https:\/\//i.test(url)) {
          return { ok: false, message: `URL must start with https://: ${url}` }
        }
        const host = hostFromUrl(url)
        if (!host || !allowedHosts.has(host)) {
          return { ok: false, message: `URL host not allowed: ${url}` }
        }
      }
      return { ok: true, payload: { files: trimmed } }
    }
    case 'hostname': {
      for (const h of trimmed) {
        const host = normalizeHost(h)
        if (!allowedHosts.has(host)) {
          return { ok: false, message: `Hostname not allowed: ${h}` }
        }
      }
      return { ok: true, payload: { hosts: trimmed.map(normalizeHost) } }
    }
    case 'tag':
      return { ok: true, payload: { tags: trimmed } }
    case 'prefix': {
      const prefixes: string[] = []
      for (const raw of trimmed) {
        let p = raw.trim()
        if (!/^https:\/\//i.test(p)) {
          return { ok: false, message: `Prefix must be a full https URL: ${raw}` }
        }
        if (!p.endsWith('/')) p += '/'
        const host = hostFromUrl(p)
        if (!host || !allowedHosts.has(host)) {
          return { ok: false, message: `Prefix host not allowed: ${raw}` }
        }
        prefixes.push(httpsPrefixToCloudflareApiPrefix(p))
      }
      return { ok: true, payload: { prefixes } }
    }
    default:
      return { ok: false, message: 'Invalid purge mode' }
  }
}

/** Purge one tour: prefix API per zone; R2 file fallback only when main viewer prefixes fail. */
export async function purgeTourCache(env: Env, tourId: string): Promise<TourPurgeResult> {
  const prefixes = buildTourPurgePrefixes(tourId, env)
  if (prefixes.length === 0) {
    throw new Error('No purge prefixes could be built (check R2_PUBLIC_DOMAIN)')
  }

  const warnings: string[] = []
  const { main: mainPrefixes, admin: adminPrefixes } = splitMainAndAdminPrefixes(env, prefixes)

  const mainCf =
    mainPrefixes.length > 0
      ? await purgePrefixesAcrossZones(env, mainPrefixes)
      : ({ success: true } as CloudflarePurgeApiResult)

  let adminCf: CloudflarePurgeApiResult | null = null
  if (adminPrefixes.length > 0) {
    adminCf = await purgePrefixesAcrossZones(env, adminPrefixes)
    if (!adminCf.success) {
      const hint = env.CLOUDFLARE_ADMIN_ZONE_ID?.trim()
        ? ''
        : ' Set CLOUDFLARE_ADMIN_ZONE_ID if tour.proppik.cloud uses a separate Cloudflare zone.'
      warnings.push(`Admin CDN purge failed: ${cloudflareErrorMessage(adminCf)}.${hint}`)
    }
  }

  if (mainCf.success) {
    return {
      tourId,
      mode: 'prefix',
      prefixes,
      cloudflare: mainCf,
      warnings: warnings.length ? warnings : undefined,
    }
  }

  const { token, zoneId } = assertCloudflarePurgeConfigured(env)
  const mainHost = normalizeHost(env.R2_PUBLIC_DOMAIN)
  const config = r2ConfigFromEnv(env)
  const keys = await listAllObjectKeys(config, tourR2Prefix(tourId.trim()))

  if (keys.length > MAX_R2_FILE_PURGE) {
    throw new Error(
      `Prefix purge failed and tour has ${keys.length} R2 files (limit ${MAX_R2_FILE_PURGE} for file purge). ` +
        `Check CLOUDFLARE_ZONE_ID and prefix URLs. ${cloudflareErrorMessage(mainCf)}`,
    )
  }

  const files = keys.map((key) => `https://${mainHost}/${key.replace(/^\/+/, '')}`)

  if (files.length === 0) {
    return { tourId, mode: 'prefix', prefixes, cloudflare: mainCf, warnings }
  }

  const { last } = await purgeFilesBatched(zoneId, token, files)
  if (last.success && adminCf && !adminCf.success) {
    warnings.push(`Admin CDN purge failed: ${cloudflareErrorMessage(adminCf)}`)
  }

  return {
    tourId,
    mode: 'files',
    prefixes,
    fileCount: files.length,
    cloudflare: last,
    warnings: warnings.length ? warnings : undefined,
  }
}

export async function purgeEverything(env: Env): Promise<CloudflarePurgeApiResult> {
  const { token, zoneId } = assertCloudflarePurgeConfigured(env)
  return callCloudflarePurge(zoneId, token, { purge_everything: true })
}

export async function purgeCustom(
  env: Env,
  mode: 'url' | 'hostname' | 'tag' | 'prefix',
  values: string[],
): Promise<CloudflarePurgeApiResult> {
  const { token, zoneId } = assertCloudflarePurgeConfigured(env)
  const validated = validateCustomPurgeValues(env, mode, values)
  if (!validated.ok) {
    throw new Error(validated.message)
  }

  const payload = validated.payload
  if ('files' in payload && payload.files && payload.files.length > FILES_PER_REQUEST) {
    const { last } = await purgeFilesBatched(zoneId, token, payload.files)
    return last
  }
  return callCloudflarePurge(zoneId, token, payload)
}
