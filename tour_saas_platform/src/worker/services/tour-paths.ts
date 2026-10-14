// ============================================================
// R2 key helpers for the Go-first pipeline.
//
// Publish:  {tourId}/index.html          (flat, no viewer/)
// Manifest: {tourId}/.manifest.json
// Backup:   {tourId}/backup_zip/{name}_{first|vN}_{ISO}.zip
// ============================================================
import { tourR2Prefix } from '../utils/tour-storage'

/** Default ingest chunk size — matches wrangler PART_SIZE_BYTES (25 MiB). */
export const DEFAULT_INGEST_CHUNK_BYTES = 25 * 1024 * 1024

/** Safe filename stem for backup objects. */
export function sanitizeZipBaseName(filename: string): string {
  const withoutExt = filename.replace(/\.zip$/i, '')
  let slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) slug = 'tour'
  if (slug.length > 40) {
    slug = slug.slice(0, 40).replace(/-+$/g, '')
  }
  return slug || 'tour'
}

/**
 * First successful-or-started upload is `first`. Later ones are `v2`, `v3`, …
 * `priorCount` is how many earlier sessions already claimed a version.
 */
export function backupVersionLabel(priorCount: number): string {
  if (priorCount <= 0) return 'first'
  return `v${priorCount + 1}`
}

/** `2026-09-18T103045Z` — no colons, safe in object keys. */
export function isoTimestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/:/g, '').replace(/\.\d{3}/, '')
}

export function buildBackupObjectName(
  zipBaseName: string,
  version: string,
  timestamp = isoTimestampForFilename(),
): string {
  return `${zipBaseName}_${version}_${timestamp}.zip`
}

export function buildBackupKey(
  tourId: string,
  zipBaseName: string,
  version: string,
  timestamp = isoTimestampForFilename(),
): string {
  return `${tourR2Prefix(tourId)}backup_zip/${buildBackupObjectName(zipBaseName, version, timestamp)}`
}

export function manifestKey(tourId: string): string {
  return `${tourR2Prefix(tourId)}.manifest.json`
}

export function tourPublishPrefix(tourId: string): string {
  return tourR2Prefix(tourId)
}
