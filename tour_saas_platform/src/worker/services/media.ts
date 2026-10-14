// ============================================================
// Media Library — D1 service layer
//
// R2 operations (put/delete) are NOT done here; they live in
// the route handler so it can access c.env.TOUR_BUCKET directly.
// This module is responsible for all D1 state.
// ============================================================
import type { Media, MediaLink, MediaListItem, MediaCollection, MediaEntityType } from '../types'

// Collections where only one media item is allowed per entity
const SINGLETON_COLLECTIONS = new Set<MediaCollection>([
  'tour_thumbnail',
  'tour_logo',
  'customer_profile',
  'customer_cover',
  'customer_seo',
])

// ── Utility ────────────────────────────────────────────────

export async function computeChecksum(bytes: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function buildMediaKey(
  entityType: MediaEntityType | null,
  entityId: string | null,
  collection: MediaCollection | null,
  mediaId: string,
  ext: string,
): string {
  if (entityType === 'tour' && entityId && collection) {
    return `${entityId}/media/${collection}/${mediaId}.${ext}`
  }
  if (entityType === 'customer' && entityId && collection) {
    return `customers/${entityId}/media/${collection}/${mediaId}.${ext}`
  }
  return `media/unlinked/${mediaId}.${ext}`
}

export function resolveMediaUrl(publicDomain: string, key: string): string {
  const host = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/${key}`
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':  return 'png'
    case 'image/webp': return 'webp'
    case 'image/gif':  return 'gif'
    case 'application/pdf': return 'pdf'
    default:           return 'jpg'
  }
}

// ── Read ────────────────────────────────────────────────────

export interface MediaListParams {
  collection?: string
  mimePrefix?: string
  entityType?: string
  entityId?: string
  search?: string
  page?: number
  perPage?: number
}

export async function listMedia(
  db: D1Database,
  publicDomain: string,
  params: MediaListParams,
): Promise<{ items: MediaListItem[]; total: number }> {
  const {
    collection,
    mimePrefix,
    entityType,
    entityId,
    search,
    page = 1,
    perPage = 30,
  } = params

  const conditions: string[] = []
  const bindings: unknown[] = []

  if (collection) {
    conditions.push('EXISTS (SELECT 1 FROM media_links ml2 WHERE ml2.media_id = m.id AND ml2.collection = ?)')
    bindings.push(collection)
  }
  if (mimePrefix) {
    conditions.push("m.mime LIKE ? || '%'")
    bindings.push(mimePrefix)
  }
  if (entityType) {
    conditions.push('EXISTS (SELECT 1 FROM media_links ml3 WHERE ml3.media_id = m.id AND ml3.entity_type = ?)')
    bindings.push(entityType)
  }
  if (entityId) {
    conditions.push('EXISTS (SELECT 1 FROM media_links ml4 WHERE ml4.media_id = m.id AND ml4.entity_id = ?)')
    bindings.push(entityId)
  }
  if (search) {
    conditions.push("m.original_name LIKE '%' || ? || '%'")
    bindings.push(search)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM media m ${where}`)
    .bind(...bindings)
    .first<{ cnt: number }>()

  const total = countRow?.cnt ?? 0
  const offset = (page - 1) * perPage

  const rows = await db
    .prepare(
      `SELECT m.*
         FROM media m
         ${where}
         ORDER BY m.created_at DESC
         LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, perPage, offset)
    .all<Media>()

  const items: MediaListItem[] = await Promise.all(
    (rows.results ?? []).map(async (m) => {
      const linkRows = await db
        .prepare('SELECT * FROM media_links WHERE media_id = ? ORDER BY sort ASC')
        .bind(m.id)
        .all<MediaLink>()
      return {
        ...m,
        url: resolveMediaUrl(publicDomain, m.key),
        links: linkRows.results ?? [],
      }
    }),
  )

  return { items, total }
}

export async function getMediaById(
  db: D1Database,
  publicDomain: string,
  id: string,
): Promise<MediaListItem | null> {
  const m = await db
    .prepare('SELECT * FROM media WHERE id = ?')
    .bind(id)
    .first<Media>()
  if (!m) return null

  const linkRows = await db
    .prepare('SELECT * FROM media_links WHERE media_id = ? ORDER BY sort ASC')
    .bind(id)
    .all<MediaLink>()

  return {
    ...m,
    url: resolveMediaUrl(publicDomain, m.key),
    links: linkRows.results ?? [],
  }
}

export async function countLinksForMedia(db: D1Database, mediaId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM media_links WHERE media_id = ?')
    .bind(mediaId)
    .first<{ cnt: number }>()
  return row?.cnt ?? 0
}

// ── Write ───────────────────────────────────────────────────

export async function createMediaRecord(
  db: D1Database,
  id: string,
  key: string,
  mime: string,
  size: number,
  checksum: string | null,
  originalName: string | null,
  createdBy: string | null,
): Promise<Media> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO media (id, key, disk, mime, size, checksum, original_name, created_by, created_at, updated_at)
       VALUES (?, ?, 'r2', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, key, mime, size, checksum, originalName, createdBy, now, now)
    .run()

  return {
    id,
    key,
    disk: 'r2',
    mime,
    size,
    checksum,
    original_name: originalName,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  }
}

/**
 * Link an existing media record to an entity/collection.
 *
 * For singleton collections, the previous link (and its media row if orphaned)
 * are removed. Returns the key of any orphaned media row so the caller can
 * delete it from R2, or null if nothing was orphaned.
 */
export async function linkMedia(
  db: D1Database,
  linkId: string,
  mediaId: string,
  entityType: MediaEntityType,
  entityId: string,
  collection: MediaCollection,
  sort = 0,
  metaJson: string | null = null,
): Promise<{ orphanedKey: string | null }> {
  let orphanedKey: string | null = null

  if (SINGLETON_COLLECTIONS.has(collection)) {
    const oldLink = await db
      .prepare(
        `SELECT ml.id, ml.media_id, m.key
           FROM media_links ml
           JOIN media m ON m.id = ml.media_id
          WHERE ml.entity_type = ? AND ml.entity_id = ? AND ml.collection = ?
          LIMIT 1`,
      )
      .bind(entityType, entityId, collection)
      .first<{ id: string; media_id: string; key: string }>()

    if (oldLink) {
      await db.prepare('DELETE FROM media_links WHERE id = ?').bind(oldLink.id).run()

      const remaining = await countLinksForMedia(db, oldLink.media_id)
      if (remaining === 0) {
        orphanedKey = oldLink.key
        await db.prepare('DELETE FROM media WHERE id = ?').bind(oldLink.media_id).run()
      }
    }
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO media_links (id, media_id, entity_type, entity_id, collection, sort, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(linkId, mediaId, entityType, entityId, collection, sort, metaJson, now)
    .run()

  return { orphanedKey }
}

/**
 * Remove a media_link by ID.
 * Returns the key of the media row if it is now orphaned (zero remaining links),
 * plus the media row id — so the caller can delete from R2 + media table.
 */
export async function unlinkMedia(
  db: D1Database,
  linkId: string,
): Promise<{ orphanedKey: string | null; orphanedMediaId: string | null }> {
  const link = await db
    .prepare(
      `SELECT ml.media_id, m.key
         FROM media_links ml
         JOIN media m ON m.id = ml.media_id
        WHERE ml.id = ?`,
    )
    .bind(linkId)
    .first<{ media_id: string; key: string }>()

  if (!link) return { orphanedKey: null, orphanedMediaId: null }

  await db.prepare('DELETE FROM media_links WHERE id = ?').bind(linkId).run()

  const remaining = await countLinksForMedia(db, link.media_id)
  if (remaining === 0) {
    await db.prepare('DELETE FROM media WHERE id = ?').bind(link.media_id).run()
    return { orphanedKey: link.key, orphanedMediaId: link.media_id }
  }

  return { orphanedKey: null, orphanedMediaId: null }
}

/**
 * Hard-delete: remove all links, then R2 key + media row.
 * Returns the key so the caller can delete from R2.
 */
export async function deleteMediaHard(
  db: D1Database,
  id: string,
): Promise<{ key: string } | null> {
  const m = await db
    .prepare('SELECT key FROM media WHERE id = ?')
    .bind(id)
    .first<{ key: string }>()

  if (!m) return null

  await db.prepare('DELETE FROM media_links WHERE media_id = ?').bind(id).run()
  await db.prepare('DELETE FROM media WHERE id = ?').bind(id).run()

  return { key: m.key }
}

/**
 * Upsert a media record for an existing R2 key (e.g. legacy customer photo).
 * If a media row already exists for this key, returns the existing id.
 * Otherwise, creates a new row and links it.
 *
 * The link is inserted via the normal singleton-replace logic.
 * Returns the new or existing media id.
 */
export async function upsertMediaForKey(
  db: D1Database,
  key: string,
  mime: string,
  size: number,
  checksum: string | null,
  originalName: string | null,
  createdBy: string | null,
  entityType: MediaEntityType,
  entityId: string,
  collection: MediaCollection,
): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM media WHERE key = ?')
    .bind(key)
    .first<{ id: string }>()

  let mediaId: string
  if (existing) {
    mediaId = existing.id
  } else {
    mediaId = crypto.randomUUID()
    await createMediaRecord(db, mediaId, key, mime, size, checksum, originalName, createdBy)
  }

  const linkId = crypto.randomUUID()
  await linkMedia(db, linkId, mediaId, entityType, entityId, collection)

  return mediaId
}

/**
 * Return all media links for a given entity (e.g. a customer's media items).
 */
export async function getLinksForEntity(
  db: D1Database,
  publicDomain: string,
  entityType: MediaEntityType,
  entityId: string,
  collection?: MediaCollection,
): Promise<Array<MediaLink & { media: Media; url: string }>> {
  const q = collection
    ? `SELECT ml.*, m.key, m.mime, m.size, m.original_name, m.checksum, m.disk, m.created_by, m.created_at as media_created_at, m.updated_at as media_updated_at
         FROM media_links ml
         JOIN media m ON m.id = ml.media_id
        WHERE ml.entity_type = ? AND ml.entity_id = ? AND ml.collection = ?
        ORDER BY ml.sort ASC`
    : `SELECT ml.*, m.key, m.mime, m.size, m.original_name, m.checksum, m.disk, m.created_by, m.created_at as media_created_at, m.updated_at as media_updated_at
         FROM media_links ml
         JOIN media m ON m.id = ml.media_id
        WHERE ml.entity_type = ? AND ml.entity_id = ?
        ORDER BY ml.collection ASC, ml.sort ASC`

  const stmt = collection
    ? db.prepare(q).bind(entityType, entityId, collection)
    : db.prepare(q).bind(entityType, entityId)

  const rows = await stmt.all<Record<string, unknown>>()

  return (rows.results ?? []).map((row) => ({
    id: row.id as string,
    media_id: row.media_id as string,
    entity_type: row.entity_type as MediaEntityType,
    entity_id: row.entity_id as string,
    collection: row.collection as MediaCollection,
    sort: row.sort as number,
    meta_json: row.meta_json as string | null,
    created_at: row.created_at as string,
    media: {
      id: row.media_id as string,
      key: row.key as string,
      disk: row.disk as string,
      mime: row.mime as string,
      size: row.size as number,
      checksum: row.checksum as string | null,
      original_name: row.original_name as string | null,
      created_by: row.created_by as string | null,
      created_at: row.media_created_at as string,
      updated_at: row.media_updated_at as string,
    },
    url: resolveMediaUrl(publicDomain, row.key as string),
  }))
}
