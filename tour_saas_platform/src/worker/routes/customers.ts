// ============================================================
// Customer management routes
//
//   GET    /api/customers              — list current user's customers
//   POST   /api/customers              — create a customer (+ social links)
//   GET    /api/customers/:id          — get one customer with social links
//   GET    /api/customers/:id/tours     — customer + tour list + status stats
//   PUT    /api/customers/:id          — update customer (+ replace social links)
//   DELETE /api/customers/:id          — soft-delete customer
//   POST   /api/customers/:id/photos   — upload profile and/or cover photo to R2
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission } from '../middleware/auth'
import {
  listCustomersByOwner,
  getCustomerWithLinks,
  createCustomer,
  updateCustomer,
  softDeleteCustomer,
  updateCustomerPhoto,
  SlugConflictError,
  type CustomerInput,
} from '../services/customers'
import { getToursByCustomer, getTourStatsByCustomer } from '../services/tours'
import {
  computeChecksum,
  buildMediaKey,
  extensionForMime,
  createMediaRecord,
  linkMedia,
  upsertMediaForKey,
} from '../services/media'
import { ok, err } from '../utils/response'
import { customerBodySchema, mediaCollectionSchema, COLLECTION_RULES } from '../utils/validation'
import type { Env, Variables, MediaCollection } from '../types'

const customers = new Hono<{ Bindings: Env; Variables: Variables }>()

// Tightened to match COLLECTION_RULES: 2 MB for profile, 4 MB for cover
const PROFILE_PHOTO_MAX_BYTES = COLLECTION_RULES.customer_profile.maxBytes // 2 MB
const COVER_PHOTO_MAX_BYTES   = COLLECTION_RULES.customer_cover.maxBytes   // 4 MB
const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function extensionForType(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'jpg'
  }
}

function publicUrlForKey(publicDomain: string, key: string): string {
  const host = publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/${key}`
}

function toInput(data: ReturnType<typeof customerBodySchema.parse>): CustomerInput {
  return {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    country_code: data.country_code,
    mobile: data.mobile,
    company_name: data.company_name,
    slug: data.slug,
    company_website: data.company_website,
    tag_line: data.tag_line,
    designation: data.designation,
    social_links: data.social_links,
  }
}

// ─── GET /api/customers ───────────────────────────────────────────────────────
customers.get('/', authMiddleware, requirePermission('customer_view'), async (c) => {
  const user = c.get('user')
  const list = await listCustomersByOwner(c.env.DB, user.id)
  return c.json(ok(list))
})

// ─── POST /api/customers ──────────────────────────────────────────────────────
customers.post('/', authMiddleware, requirePermission('customer_create'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = customerBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const user = c.get('user')
  try {
    const customer = await createCustomer(c.env.DB, user.id, toInput(parsed.data))
    return c.json(ok(customer), 201)
  } catch (e) {
    if (e instanceof SlugConflictError) {
      return c.json(err('CONFLICT', e.message), 409)
    }
    throw e
  }
})

// ─── GET /api/customers/:id/tours ─────────────────────────────────────────────
// Customer-scoped tour list + status stats (for the customer view page).
customers.get('/:id/tours', authMiddleware, requirePermission('customer_view'), async (c) => {
  const user = c.get('user')
  const customerId = c.req.param('id')

  const customer = await getCustomerWithLinks(c.env.DB, customerId, user.id)
  if (!customer) {
    return c.json(err('NOT_FOUND', 'Customer not found'), 404)
  }

  const [tours, stats] = await Promise.all([
    getToursByCustomer(c.env.DB, customerId, user.id),
    getTourStatsByCustomer(c.env.DB, customerId, user.id),
  ])

  return c.json(ok({ customer, tours, stats }))
})

// ─── GET /api/customers/:id ───────────────────────────────────────────────────
customers.get('/:id', authMiddleware, requirePermission('customer_view'), async (c) => {
  const user = c.get('user')
  const customerId = c.req.param('id')

  const customer = await getCustomerWithLinks(c.env.DB, customerId, user.id)
  if (!customer) {
    return c.json(err('NOT_FOUND', 'Customer not found'), 404)
  }

  return c.json(ok(customer))
})

// ─── PUT /api/customers/:id ───────────────────────────────────────────────────
customers.put('/:id', authMiddleware, requirePermission('customer_edit'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = customerBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const user = c.get('user')
  const customerId = c.req.param('id')

  try {
    const customer = await updateCustomer(
      c.env.DB,
      customerId,
      user.id,
      toInput(parsed.data),
    )
    if (!customer) {
      return c.json(err('NOT_FOUND', 'Customer not found'), 404)
    }
    return c.json(ok(customer))
  } catch (e) {
    if (e instanceof SlugConflictError) {
      return c.json(err('CONFLICT', e.message), 409)
    }
    throw e
  }
})

// ─── DELETE /api/customers/:id ────────────────────────────────────────────────
customers.delete('/:id', authMiddleware, requirePermission('customer_delete'), async (c) => {
  const user = c.get('user')
  const customerId = c.req.param('id')

  const deleted = await softDeleteCustomer(c.env.DB, customerId, user.id)
  if (!deleted) {
    return c.json(err('NOT_FOUND', 'Customer not found'), 404)
  }

  // Best-effort R2 cleanup for photos (non-fatal if missing)
  try {
    const prefix = `customers/${customerId}/`
    const listed = await c.env.TOUR_BUCKET.list({ prefix })
    await Promise.all(listed.objects.map((obj) => c.env.TOUR_BUCKET.delete(obj.key)))
  } catch (e) {
    console.error(`[customers] R2 photo cleanup failed for ${customerId}:`, e)
  }

  return c.json(ok({ message: 'Customer deleted' }))
})

// ─── POST /api/customers/:id/photos ───────────────────────────────────────────
//
// multipart/form-data with optional fields:
//   profile_photo — image file
//   cover_photo   — image file
//
// Small images go through the Worker via the R2 binding (not multipart S3),
// which is appropriate for profile/cover photos under MAX_PHOTO_BYTES.
customers.post('/:id/photos', authMiddleware, requirePermission('customer_edit'), async (c) => {
  const user = c.get('user')
  const customerId = c.req.param('id')

  const existing = await getCustomerWithLinks(c.env.DB, customerId, user.id)
  if (!existing) {
    return c.json(err('NOT_FOUND', 'Customer not found'), 404)
  }

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(err('INVALID_INPUT', 'Expected multipart form data'), 422)
  }

  const kinds: Array<{
    field: string
    kind: 'profile' | 'cover'
    collection: MediaCollection
    maxBytes: number
  }> = [
    { field: 'profile_photo', kind: 'profile', collection: 'customer_profile', maxBytes: PROFILE_PHOTO_MAX_BYTES },
    { field: 'cover_photo',   kind: 'cover',   collection: 'customer_cover',   maxBytes: COVER_PHOTO_MAX_BYTES   },
  ]

  let uploaded = 0

  for (const { field, kind, collection, maxBytes } of kinds) {
    const entry = form.get(field)
    if (!entry || typeof entry === 'string') continue

    const file = entry as File
    if (!file.size) continue

    if (file.size > maxBytes) {
      return c.json(
        err('INVALID_INPUT', `${kind} photo must be ${maxBytes / (1024 * 1024)} MB or less`),
        422,
      )
    }

    const contentType = file.type || 'application/octet-stream'
    if (!ALLOWED_PHOTO_TYPES.has(contentType)) {
      return c.json(
        err('INVALID_INPUT', `${kind} photo must be JPEG, PNG, WebP, or GIF`),
        422,
      )
    }

    const ext = extensionForType(contentType)
    const key = `customers/${customerId}/${kind}.${ext}`
    const bytes = await file.arrayBuffer()

    await c.env.TOUR_BUCKET.put(key, bytes, { httpMetadata: { contentType } })

    const url = publicUrlForKey(c.env.R2_PUBLIC_DOMAIN, key)
    await updateCustomerPhoto(c.env.DB, customerId, user.id, kind, key, url)

    // Dual-write: make this upload visible in the Media Library
    const checksum = await computeChecksum(bytes)
    await upsertMediaForKey(
      c.env.DB,
      key,
      contentType,
      file.size,
      checksum,
      file.name || null,
      user.id,
      'customer',
      customerId,
      collection,
    )

    uploaded += 1
  }

  if (uploaded === 0) {
    return c.json(err('INVALID_INPUT', 'No photo files provided'), 422)
  }

  const customer = await getCustomerWithLinks(c.env.DB, customerId, user.id)
  return c.json(ok(customer))
})

// ── POST /:id/media — upload customer media (SEO image, etc.) ──────────────
customers.post(
  '/:id/media',
  authMiddleware,
  requirePermission('customer_edit'),
  requirePermission('media_upload'),
  async (c) => {
    const user = c.get('user')
    const customerId = c.req.param('id')

    const existing = await getCustomerWithLinks(c.env.DB, customerId, user.id)
    if (!existing) {
      return c.json(err('NOT_FOUND', 'Customer not found'), 404)
    }

    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return c.json(err('INVALID_INPUT', 'Expected multipart form data'), 422)
    }

    const rawCollection = form.get('collection')?.toString() ?? ''
    const collectionParse = mediaCollectionSchema.safeParse(rawCollection)
    if (!collectionParse.success) {
      return c.json(err('INVALID_INPUT', `Unknown collection: ${rawCollection}`), 422)
    }
    const collection = collectionParse.data

    // Only customer collections allowed via this endpoint
    if (!collection.startsWith('customer_')) {
      return c.json(err('INVALID_INPUT', 'This endpoint only accepts customer_ collections'), 422)
    }

    const fileEntry = form.get('file')
    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json(err('INVALID_INPUT', 'No file provided'), 422)
    }
    const file = fileEntry as File

    const rules = COLLECTION_RULES[collection]
    if (file.size > rules.maxBytes) {
      return c.json(
        err('INVALID_INPUT', `${rules.label} must be ${rules.maxBytes / (1024 * 1024)} MB or less`),
        422,
      )
    }

    const mime = file.type || 'application/octet-stream'
    if (!rules.allowedMimes.has(mime)) {
      return c.json(err('INVALID_INPUT', `${rules.label}: unsupported file type ${mime}`), 422)
    }

    const bytes    = await file.arrayBuffer()
    const checksum = await computeChecksum(bytes)
    const ext      = extensionForMime(mime)
    const mediaId  = crypto.randomUUID()
    const key      = buildMediaKey('customer', customerId, collection, mediaId, ext)

    await c.env.TOUR_BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } })

    const mediaRow = await createMediaRecord(
      c.env.DB,
      mediaId,
      key,
      mime,
      file.size,
      checksum,
      file.name || null,
      user.id,
    )

    const linkId = crypto.randomUUID()
    const { orphanedKey } = await linkMedia(
      c.env.DB,
      linkId,
      mediaId,
      'customer',
      customerId,
      collection,
    )

    if (orphanedKey) {
      await c.env.TOUR_BUCKET.delete(orphanedKey)
    }

    return c.json(ok({ ...mediaRow, url: publicUrlForKey(c.env.R2_PUBLIC_DOMAIN, key), link_id: linkId }), 201)
  },
)

export { customers as customerRoutes }
