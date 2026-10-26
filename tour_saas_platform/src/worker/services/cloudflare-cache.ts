// ============================================================
// Cloudflare zone cache purge (tour prefixes + custom / bulk)
// ============================================================
import type { Env } from '../types'
import { legacyTourDeletePrefix, tourR2Prefix } from '../utils/tour-storage'
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
}

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
  const admin = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
  if (admin) hosts.add(normalizeHost(admin))
  return hosts
}

function prefixUrl(host: string, pathWithoutLeadingSlash: string): string {
  const hostNorm = normalizeHost(host)
  const path = pathWithoutLeadingSlash.replace(/^\/+/, '').replace(/\/+$/, '')
  return `https://${hostNorm}/${path}/`
}

/** Public CDN prefixes cleared for one tour (main + legacy + optional admin). */
export function buildTourPurgePrefixes(tourId: string, env: Env): string[] {
  const pid = tourId.trim()
  if (!pid) return []

  const mainHost = env.R2_PUBLIC_DOMAIN?.trim()
  const prefixes: string[] = []
  if (mainHost) {
    prefixes.push(prefixUrl(mainHost, tourR2Prefix(pid)))
    prefixes.push(prefixUrl(mainHost, legacyTourDeletePrefix(pid)))
  }

  const adminHost = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
  if (adminHost) {
    prefixes.push(prefixUrl(adminHost, tourR2Prefix(pid)))
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
        prefixes.push(p)
      }
      return { ok: true, payload: { prefixes } }
    }
    default:
      return { ok: false, message: 'Invalid purge mode' }
  }
}

/** Purge one tour: prefix API first, R2 file list fallback on failure. */
export async function purgeTourCache(env: Env, tourId: string): Promise<TourPurgeResult> {
  const { token, zoneId } = assertCloudflarePurgeConfigured(env)
  const prefixes = buildTourPurgePrefixes(tourId, env)
  if (prefixes.length === 0) {
    throw new Error('No purge prefixes could be built (check R2_PUBLIC_DOMAIN)')
  }

  let cf = await callCloudflarePurge(zoneId, token, { prefixes })
  if (cf.success) {
    return { tourId, mode: 'prefix', prefixes, cloudflare: cf }
  }

  const mainHost = normalizeHost(env.R2_PUBLIC_DOMAIN)
  const config = r2ConfigFromEnv(env)
  const keys = await listAllObjectKeys(config, tourR2Prefix(tourId.trim()))
  const files = keys.map((key) => `https://${mainHost}/${key.replace(/^\/+/, '')}`)

  if (files.length === 0) {
    return { tourId, mode: 'prefix', prefixes, cloudflare: cf }
  }

  const { last } = await purgeFilesBatched(zoneId, token, files)
  return {
    tourId,
    mode: 'files',
    prefixes,
    fileCount: files.length,
    cloudflare: last,
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
