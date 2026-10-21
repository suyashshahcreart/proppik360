// ============================================================
// R2 key helpers for tour_admin artifact package (admin bucket).
//
// Publish:  {tourId}/index.html
// Manifest: {tourId}/.manifest.json
// Backup:   {tourId}/backup_zip/{name}_{first|vN}_{ISO}.zip
// ============================================================
import {
  backupVersionLabel,
  buildBackupObjectName,
  isoTimestampForFilename,
  sanitizeZipBaseName,
} from './tour-paths'

export { backupVersionLabel, sanitizeZipBaseName, isoTimestampForFilename }

export const ARTIFACT_TYPE_TOUR_ADMIN = 'tour_admin' as const
export type ArtifactType = typeof ARTIFACT_TYPE_TOUR_ADMIN

export function adminR2Prefix(tourId: string): string {
  return `${tourId}/`
}

export function adminManifestKey(tourId: string): string {
  return `${adminR2Prefix(tourId)}.manifest.json`
}

export function adminPublishPrefix(tourId: string): string {
  return adminR2Prefix(tourId)
}

export function buildAdminBackupKey(
  tourId: string,
  zipBaseName: string,
  version: string,
  timestamp = isoTimestampForFilename(),
): string {
  return `${adminR2Prefix(tourId)}backup_zip/${buildBackupObjectName(zipBaseName, version, timestamp)}`
}

/** Public admin site URL (no trailing slash on domain). */
export function adminPublishUrl(publicDomain: string, tourId: string): string {
  const host = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/${tourId}/`
}
