// ============================================================
// Viewer-bucket FS helpers for tour-admin public APIs.
// Effective key is always {tourId}/{relativePath} on TOUR_BUCKET.
// ============================================================
import { tourR2Prefix } from '../utils/tour-storage'
import type { R2Config } from './r2'
import type { Env } from '../types'

export const FS_MAX_PUT_BYTES = 5 * 1024 * 1024
export const FS_LIST_PAGE_SIZE = 200
export const FS_DELETE_KEY_CAP = 200
export const FS_KEEP_NAME = '.keep'

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const TOUR_ID_RE = /^\d{6}$/

const ALLOWED_EXTENSIONS = new Set([
  'html',
  'css',
  'js',
  'json',
  'xml',
  'txt',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'mp4',
  'webm',
  'mp3',
])

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
}

export type FsResolveOk = {
  ok: true
  relativePath: string
  key: string
  name: string
}

export type FsResolveErr = {
  ok: false
  code: 'INVALID_INPUT'
  message: string
}

export function isTourId(tourId: string): boolean {
  return TOUR_ID_RE.test(tourId)
}

export function viewerR2Config(env: Env): R2Config {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }
}

export function normalizePublicHost(publicDomain: string): string {
  return publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** Public viewer URL for a relative path under {tourId}/. */
export function viewerPublicUrl(
  publicDomain: string,
  tourId: string,
  relativePath: string,
): string {
  const host = normalizePublicHost(publicDomain)
  const leaf = relativePath.replace(/^\/+|\/+$/g, '')
  const path = leaf ? `/${tourId}/${leaf}` : `/${tourId}/`
  return `https://${host}${path}`
}

export function fileExtension(relativePath: string): string {
  const name = relativePath.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function isAllowedUploadExtension(relativePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(fileExtension(relativePath))
}

export function contentTypeForPath(relativePath: string, fallback?: string | null): string {
  const ext = fileExtension(relativePath)
  if (ext && CONTENT_TYPES[ext]) return CONTENT_TYPES[ext]
  const trimmed = fallback?.split(';')[0]?.trim()
  if (trimmed && trimmed !== 'application/octet-stream') return fallback!.trim()
  return 'application/octet-stream'
}

export function isProtectedWritePath(relativePath: string): boolean {
  const p = relativePath.replace(/\/+$/, '').toLowerCase()
  if (p === '.manifest.json') return true
  if (p === 'original.zip') return true
  if (p === 'backup_zip' || p.startsWith('backup_zip/')) return true
  return false
}

/** index.html at tour root may be overwritten but not deleted. */
export function isProtectedDeletePath(relativePath: string): boolean {
  if (isProtectedWritePath(relativePath)) return true
  return relativePath.replace(/\/+$/, '').toLowerCase() === 'index.html'
}

export function shouldHideFromList(relativePath: string, listRoot: string): boolean {
  const name = relativePath.split('/').pop() ?? ''
  if (name === FS_KEEP_NAME) return true
  if (listRoot === '' && (relativePath === 'backup_zip' || relativePath.startsWith('backup_zip/'))) {
    return true
  }
  return false
}

export function resolveViewerFsPath(
  tourId: string,
  rawPath: string | null | undefined,
  options?: { allowEmpty?: boolean },
): FsResolveOk | FsResolveErr {
  if (!isTourId(tourId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Tour ID must be 6 digits' }
  }

  const raw = (rawPath ?? '').trim()
  if (!raw) {
    if (options?.allowEmpty) {
      return { ok: true, relativePath: '', key: tourR2Prefix(tourId), name: '' }
    }
    return { ok: false, code: 'INVALID_INPUT', message: 'path is required' }
  }

  if (CONTROL_CHARS.test(raw) || raw.includes('\\') || raw.includes('//')) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  }
  if (raw.startsWith('/')) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Path must be relative (no leading slash)' }
  }
  if (raw.startsWith(`${tourId}/`)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Do not include the tour id in path' }
  }

  const segments = raw.replace(/\/+$/, '').split('/')
  if (segments.some((s) => !s || s === '.' || s === '..')) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  }
  if (segments.join('/').length > 512) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Path is too long' }
  }

  const relativePath = segments.join('/')
  return {
    ok: true,
    relativePath,
    key: `${tourR2Prefix(tourId)}${relativePath}`,
    name: segments[segments.length - 1] ?? relativePath,
  }
}

export function folderPrefix(resolved: FsResolveOk): string {
  if (!resolved.relativePath) return resolved.key
  return resolved.key.endsWith('/') ? resolved.key : `${resolved.key}/`
}

export function keepKey(resolved: FsResolveOk): string {
  return `${folderPrefix(resolved)}${FS_KEEP_NAME}`
}

export function relativeFromKey(tourId: string, key: string): string {
  const prefix = tourR2Prefix(tourId)
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}
