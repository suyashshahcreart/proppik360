// ============================================================
// Media Library routes — /api/system/media
//
//   GET    /                   — list + filter + paginate
//   GET    /:id                — detail with resolved URL + links
//   POST   /                   — multipart upload → R2 put + media row
//                                 optional immediate link if collection/entity_type/entity_id provided
//   DELETE /:id                — hard delete (all links + R2 + media row)
//   POST   /:id/link           — attach existing media to entity/collection
//   DELETE /media-links/:linkId — unlink with orphan refcount cleanup
//
// All routes require: authMiddleware + requireNotCustomer
// Per-route guards: media_view | media_upload | media_delete
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission, requireNotCustomer } from '../middleware/auth'
import {
  computeChecksum,
  buildMediaKey,
  extensionForMime,
  listMedia,
  getMediaById,
  createMediaRecord,
  linkMedia,
  unlinkMedia,
  deleteMediaHard,
} from '../services/media'
import { logActivity } from '../services/activity'
import { ok, err } from '../utils/response'
import { mediaCollectionSchema, linkMediaSchema, COLLECTION_RULES } from '../utils/validation'
import type { Env, Variables, MediaCollection, MediaEntityType } from '../types'

const media = new Hono<{ Bindings: Env; Variables: Variables }>()

media.use('*', authMiddleware)
media.use('*', requireNotCustomer)

// ── GET / — list ─────────────────────────────────────────────
media.get('/', requirePermission('media_view'), async (c) => {
  const { collection, mime, entity_type, entity_id, search, page, per_page } =
    c.req.query() as Record<string, string>

  const result = await listMedia(c.env.DB, c.env.R2_PUBLIC_DOMAIN, {
    collection,
    mimePrefix: mime,
    entityType: entity_type,
    entityId: entity_id,
    search,
    page: page ? parseInt(page, 10) : 1,
    perPage: per_page ? parseInt(per_page, 10) : 30,
  })

  return c.json(ok(result))
})

// ── GET /:id — detail ────────────────────────────────────────
media.get('/:id', requirePermission('media_view'), async (c) => {
  const id = c.req.param('id')
  const item = await getMediaById(c.env.DB, c.env.R2_PUBLIC_DOMAIN, id)
  if (!item) return c.json(err('NOT_FOUND', 'Media not found'), 404)
  return c.json(ok(item))
})

// ── POST / — upload ──────────────────────────────────────────
media.post('/', requirePermission('media_upload'), async (c) => {
  const user = c.get('user')

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(err('INVALID_INPUT', 'Expected multipart form data'), 422)
  }

  const fileEntry = form.get('file')
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json(err('INVALID_INPUT', 'No file provided'), 422)
  }
  const file = fileEntry as File

  // Optional immediate-link fields
  const rawCollection = form.get('collection')?.toString() ?? null
  const rawEntityType = form.get('entity_type')?.toString() ?? null
  const rawEntityId   = form.get('entity_id')?.toString() ?? null

  // If collection provided, validate it and check file rules
  let collection: MediaCollection | null = null
  if (rawCollection) {
    const collectionParse = mediaCollectionSchema.safeParse(rawCollection)
    if (!collectionParse.success) {
      return c.json(err('INVALID_INPUT', `Unknown collection: ${rawCollection}`), 422)
    }
    collection = collectionParse.data

    const rules = COLLECTION_RULES[collection]
    if (file.size > rules.maxBytes) {
      return c.json(
        err('INVALID_INPUT', `${rules.label} must be ${rules.maxBytes / (1024 * 1024)} MB or less`),
        422,
      )
    }
    const mime = file.type || 'application/octet-stream'
    if (!rules.allowedMimes.has(mime)) {
      return c.json(
        err('INVALID_INPUT', `${rules.label}: unsupported file type ${mime}`),
        422,
      )
    }
  }

  const entityType = rawEntityType as MediaEntityType | null
  const entityId   = rawEntityId

  const mime        = file.type || 'application/octet-stream'
  const bytes       = await file.arrayBuffer()
  const checksum    = await computeChecksum(bytes)
  const ext         = extensionForMime(mime)
  const mediaId     = crypto.randomUUID()
  const key         = buildMediaKey(entityType, entityId, collection, mediaId, ext)

  await c.env.TOUR_BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } })

  await createMediaRecord(
    c.env.DB,
    mediaId,
    key,
    mime,
    file.size,
    checksum,
    file.name || null,
    user.id,
  )

  let linkId: string | null = null
  if (collection && entityType && entityId) {
    linkId = crypto.randomUUID()
    const { orphanedKey } = await linkMedia(
      c.env.DB,
      linkId,
      mediaId,
      entityType,
      entityId,
      collection,
    )
    if (orphanedKey) {
      await c.env.TOUR_BUCKET.delete(orphanedKey)
    }
  }

  await logActivity(c.env.DB, user.id, 'media.upload', 'media', mediaId, {
    key,
    collection,
    entity_type: entityType,
    entity_id: entityId,
  })

  const item = await getMediaById(c.env.DB, c.env.R2_PUBLIC_DOMAIN, mediaId)
  return c.json(ok(item), 201)
})

// ── DELETE /:id — hard delete ────────────────────────────────
media.delete('/:id', requirePermission('media_delete'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const result = await deleteMediaHard(c.env.DB, id)
  if (!result) return c.json(err('NOT_FOUND', 'Media not found'), 404)

  await c.env.TOUR_BUCKET.delete(result.key)

  await logActivity(c.env.DB, user.id, 'media.delete', 'media', id, { key: result.key })

  return c.json(ok({ id, deleted: true }))
})

// ── POST /:id/link — attach to entity ────────────────────────
media.post('/:id/link', requirePermission('media_upload'), async (c) => {
  const user    = c.get('user')
  const mediaId = c.req.param('id')

  const existing = await getMediaById(c.env.DB, c.env.R2_PUBLIC_DOMAIN, mediaId)
  if (!existing) return c.json(err('NOT_FOUND', 'Media not found'), 404)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Expected JSON body'), 422)
  }

  const parsed = linkMediaSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0]?.message ?? 'Invalid input'), 422)
  }

  const { entity_type, entity_id, collection, sort, meta_json } = parsed.data

  const linkId = crypto.randomUUID()
  const { orphanedKey } = await linkMedia(
    c.env.DB,
    linkId,
    mediaId,
    entity_type as MediaEntityType,
    entity_id,
    collection as MediaCollection,
    sort,
    meta_json ?? null,
  )

  if (orphanedKey) {
    await c.env.TOUR_BUCKET.delete(orphanedKey)
  }

  await logActivity(c.env.DB, user.id, 'media.link', 'media_link', linkId, {
    media_id: mediaId,
    entity_type,
    entity_id,
    collection,
  })

  const item = await getMediaById(c.env.DB, c.env.R2_PUBLIC_DOMAIN, mediaId)
  return c.json(ok(item), 201)
})

// ── DELETE /media-links/:linkId — unlink ─────────────────────
media.delete('/media-links/:linkId', requirePermission('media_delete'), async (c) => {
  const user   = c.get('user')
  const linkId = c.req.param('linkId')

  const { orphanedKey, orphanedMediaId } = await unlinkMedia(c.env.DB, linkId)

  if (orphanedKey) {
    await c.env.TOUR_BUCKET.delete(orphanedKey)
  }

  await logActivity(c.env.DB, user.id, 'media.unlink', 'media_link', linkId, {
    orphaned_media_id: orphanedMediaId,
  })

  return c.json(ok({ id: linkId, deleted: true, orphaned: !!orphanedKey }))
})

export { media as mediaRoutes }
