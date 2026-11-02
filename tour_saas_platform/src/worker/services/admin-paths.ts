// ============================================================
// Tour admin artifact paths — legacy R2 bucket + VPS web host
//
// R2 publish:  {tourId}/index.html
// VPS publish: https://{host}/admin/{tourId}/index.html
// Backup:       {tourId}/backup_zip/…
// ============================================================
import type { Env } from '../types'
import {
  backupVersionLabel,
  buildBackupObjectName,
  isoTimestampForFilename,
  sanitizeZipBaseName,
} from './tour-paths'

export { backupVersionLabel, sanitizeZipBaseName, isoTimestampForFilename }

export const ARTIFACT_TYPE_TOUR_ADMIN = 'tour_admin' as const
export type ArtifactType = typeof ARTIFACT_TYPE_TOUR_ADMIN

export const DEFAULT_TOUR_ADMIN_PUBLIC_PATH_PREFIX = '/admin'

export function normalizeAdminPathPrefix(prefix?: string | null): string {
  const raw = (prefix?.trim() || DEFAULT_TOUR_ADMIN_PUBLIC_PATH_PREFIX).replace(/\/+$/, '')
  if (!raw.startsWith('/')) return `/${raw}`
  return raw || DEFAULT_TOUR_ADMIN_PUBLIC_PATH_PREFIX
}

export function adminR2Prefix(tourId: string): string {
  return `${tourId}/`
}

export function adminManifestKey(tourId: string): string {
  return `${adminR2Prefix(tourId)}.manifest.json`
}

/** Logical web prefix stored in tour_artifacts.publish_prefix (VPS mode). */
export function adminWebPublishPrefix(tourId: string, pathPrefix?: string | null): string {
  const seg = normalizeAdminPathPrefix(pathPrefix).replace(/^\//, '')
  return `${seg}/${tourId}/`
}

/** Legacy R2 flat prefix (unchanged for admin bucket layout). */
export function adminPublishPrefix(tourId: string, vpsWeb = false, pathPrefix?: string | null): string {
  if (vpsWeb) return adminWebPublishPrefix(tourId, pathPrefix)
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

/** Legacy R2 public URL: https://{host}/{tourId}/index.html */
export function adminPublishUrlLegacyR2(publicDomain: string, tourId: string): string {
  const host = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/${tourId}/index.html`
}

/** VPS / PHP host: https://{host}{prefix}/{tourId}/index.html */
export function adminPublishUrlVps(
  publicHost: string,
  tourId: string,
  pathPrefix?: string | null,
): string {
  const host = publicHost.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const prefix = normalizeAdminPathPrefix(pathPrefix)
  const path = `${prefix}/${tourId}/index.html`.replace(/\/+/g, '/')
  return `https://${host}${path}`
}

/** @deprecated Use adminPublishUrlLegacyR2 or adminPublishUrlVps */
export function adminPublishUrl(publicDomain: string, tourId: string): string {
  return adminPublishUrlLegacyR2(publicDomain, tourId)
}

export function adminPublishRootPath(publishRoot: string, tourId: string): string {
  const root = publishRoot.replace(/[/\\]+$/, '')
  return `${root}/${tourId}`
}

export function isTourAdminVpsPublishConfigured(
  env: Pick<Env, 'TOUR_ADMIN_PUBLISH_ROOT' | 'TOUR_ADMIN_PUBLIC_HOST'>,
): boolean {
  return Boolean(env.TOUR_ADMIN_PUBLISH_ROOT?.trim() && env.TOUR_ADMIN_PUBLIC_HOST?.trim())
}

export function isTourAdminR2PublishConfigured(
  env: Pick<Env, 'R2_ADMIN_BUCKET_NAME' | 'R2_ADMIN_PUBLIC_DOMAIN' | 'ADMIN_BUCKET'>,
): boolean {
  return Boolean(
    env.R2_ADMIN_BUCKET_NAME?.trim() &&
      env.R2_ADMIN_PUBLIC_DOMAIN?.trim() &&
      env.ADMIN_BUCKET,
  )
}

export function adminPublishConfigError(env: Env): string | null {
  if (isTourAdminVpsPublishConfigured(env) || isTourAdminR2PublishConfigured(env)) {
    return null
  }
  return (
    'Tour admin publish is not configured. Set TOUR_ADMIN_PUBLISH_ROOT + TOUR_ADMIN_PUBLIC_HOST ' +
    '(VPS), or R2_ADMIN_BUCKET_NAME + R2_ADMIN_PUBLIC_DOMAIN (legacy R2).'
  )
}

export function resolveAdminPublishUrlFromEnv(env: Env, tourId: string): string | null {
  if (isTourAdminVpsPublishConfigured(env)) {
    return adminPublishUrlVps(
      env.TOUR_ADMIN_PUBLIC_HOST!,
      tourId,
      env.TOUR_ADMIN_PUBLIC_PATH_PREFIX,
    )
  }
  const domain = env.R2_ADMIN_PUBLIC_DOMAIN?.trim()
  if (domain) return adminPublishUrlLegacyR2(domain, tourId)
  return null
}

export function usesVpsAdminPublish(env: Env): boolean {
  return isTourAdminVpsPublishConfigured(env)
}
