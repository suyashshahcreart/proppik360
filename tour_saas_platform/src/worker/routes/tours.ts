// ============================================================
// Tour management routes
//
//   GET    /api/tours      — list current user's tours
//   POST   /api/tours      — create a new tour
//   GET    /api/tours/:id  — get a single tour (must be owner)
//   DELETE /api/tours/:id  — soft-delete tour + stream R2 cleanup progress
// ============================================================
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { authMiddleware, requirePermission } from '../middleware/auth'
import {
  getToursByOwner,
  getTourByIdForOwner,
  createTour,
  updateTourDetails,
  softDeleteTour,
} from '../services/tours'
import { resolveTourIdForCreate } from '../utils/tour-id'
import { legacyTourDeletePrefix, tourDeletePrefix } from '../utils/tour-storage'
import { listCustomersByOwner } from '../services/customers'
import { getPropertyCategoryTree, type PropertyCategoryTreeNode } from '../services/property-categories'
import { resumeTour } from '../services/reconcile'
import { enrichTourWithZipState, enrichToursWithZipState } from '../services/tour-zip-state'
import { checkProcessorHealth } from '../services/processor-notify'
import {
  computeChecksum,
  buildMediaKey,
  extensionForMime,
  createMediaRecord,
  linkMedia,
} from '../services/media'
import { purgePrefix, purgePrefixS3, type R2Config } from '../services/r2'
import { goIngestAbort } from '../services/processor-ingest'
import { CachePurgeNotConfiguredError, purgeTourCache } from '../services/cloudflare-cache'
import { logActivity } from '../services/activity'
import { ok, err } from '../utils/response'
import {
  createTourSchema,
  tourDetailsSchema,
  mediaCollectionSchema,
  COLLECTION_RULES,
  tourAdminPutSchema,
  tourAdminResetPasswordSchema,
} from '../utils/validation'
import { withPublicViewerUrl } from '../utils/viewer-url'
import {
  listTourAdmins,
  upsertTourAdmin,
  resetTourAdminPassword,
  deleteTourAdmin,
} from '../services/tour-admins'
import type { Env, Variables, MediaCollection } from '../types'

/** NDJSON progress events emitted by DELETE /api/tours/:id */
export interface TourDeleteProgressEvent {
  stage: 'soft_delete' | 'listing' | 'deleting' | 'done' | 'error'
  percent: number
  filesDeleted: number
  filesTotal: number
  elapsedMs: number
  message?: string
  r2Warning?: string | null
}

const tours = new Hono<{ Bindings: Env; Variables: Variables }>()

// ── GET /api/tours ────────────────────────────────────────────
tours.get('/', authMiddleware, requirePermission('tour_view'), async (c) => {
  const user = c.get('user')
  const tourList = await getToursByOwner(c.env.DB, user.id)
  const enriched = await enrichToursWithZipState(c.env, tourList)
  return c.json(
    ok(enriched.map((tour) => withPublicViewerUrl(tour, c.env.R2_PUBLIC_DOMAIN))),
  )
})

// ── GET /api/tours/processor-status ───────────────────────────
//
// Lightweight probe of the Go processor (via PROCESSOR_WEBHOOK_URL → /health).
// Used by Tours / Upload UI to warn when the processor is offline.
tours.get('/processor-status', authMiddleware, requirePermission('tour_view'), async (c) => {
  const health = await checkProcessorHealth(c.env)
  return c.json(
    ok({
      online: health.online,
      latencyMs: health.latencyMs,
      error: health.error ?? null,
      checkedAt: health.checkedAt,
      attempts: health.attempts,
      healthUrl: health.healthUrl,
      webhookConfigured: Boolean(c.env.PROCESSOR_WEBHOOK_URL),
    }),
  )
})

function activeCategoryTree(nodes: PropertyCategoryTreeNode[]): PropertyCategoryTreeNode[] {
  return nodes
    .filter((node) => node.status === 'active' && !node.deleted_at)
    .map((node) => ({ ...node, children: activeCategoryTree(node.children) }))
}

// ── GET /api/tours/form-options ───────────────────────────────
// Customers and property types for the details form (tour users, not system admins).
tours.get('/form-options', authMiddleware, async (c) => {
  const user = c.get('user')
  const perms = c.get('userPermissions')
  if (!perms.has('tour_view') && !perms.has('tour_create') && !perms.has('tour_edit')) {
    return c.json(err('FORBIDDEN', 'Insufficient permissions'), 403)
  }

  const [customers, tree] = await Promise.all([
    listCustomersByOwner(c.env.DB, user.id),
    getPropertyCategoryTree(c.env.DB),
  ])

  return c.json(
    ok({
      customers: customers.map((customer) => ({
        id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`.trim(),
        company_name: customer.company_name,
      })),
      categories: activeCategoryTree(tree),
    }),
  )
})

// ── POST /api/tours ───────────────────────────────────────────
tours.post('/', authMiddleware, requirePermission('tour_create'), async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const user = c.get('user')
  const withDetails =
    body !== null && typeof body === 'object' && 'customer_id' in (body as object)

  if (withDetails) {
    const parsed = tourDetailsSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path?.[0]
      return c.json(
        err('INVALID_INPUT', issue?.message ?? 'Check the highlighted fields', {
          field: field != null ? String(field) : undefined,
        }),
        422,
      )
    }
    const tourId = await resolveTourIdForCreate(c.env.DB, parsed.data.slug)
    try {
      const tour = await createTour(c.env.DB, tourId, parsed.data.name, user.id, parsed.data)
      const enriched = await enrichTourWithZipState(c.env, tour)
      return c.json(ok(withPublicViewerUrl(enriched, c.env.R2_PUBLIC_DOMAIN)), 201)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save tour'
      return c.json(err('INVALID_INPUT', message), 422)
    }
  }

  const parsed = createTourSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path?.[0]
    return c.json(
      err('INVALID_INPUT', issue?.message ?? 'Check the highlighted fields', {
        field: field != null ? String(field) : undefined,
      }),
      422,
    )
  }

  try {
    const tourId = await resolveTourIdForCreate(c.env.DB, parsed.data.slug)
    const tour = await createTour(c.env.DB, tourId, parsed.data.name, user.id)
    const enriched = await enrichTourWithZipState(c.env, tour)
    return c.json(ok(withPublicViewerUrl(enriched, c.env.R2_PUBLIC_DOMAIN)), 201)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not create tour'
    const field = e && typeof e === 'object' && 'field' in e ? String((e as { field: unknown }).field) : undefined
    return c.json(err('INVALID_INPUT', message, field ? { field } : undefined), 422)
  }
})

// ── PATCH /api/tours/:id ──────────────────────────────────────
tours.patch('/:id', authMiddleware, requirePermission('tour_edit'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('id')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = tourDetailsSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path?.[0]
    return c.json(
      err('INVALID_INPUT', issue?.message ?? 'Check the highlighted fields', {
        field: field != null ? String(field) : undefined,
      }),
      422,
    )
  }

  try {
    const existing = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!existing) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const zipState = await enrichTourWithZipState(c.env, existing)
    const tour = await updateTourDetails(c.env.DB, tourId, user.id, parsed.data, {
      canEditIdentity: zipState.canEditIdentity,
    })
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)
    const enriched = await enrichTourWithZipState(c.env, tour)
    return c.json(ok(withPublicViewerUrl(enriched, c.env.R2_PUBLIC_DOMAIN)))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update tour'
    const field = e && typeof e === 'object' && 'field' in e ? String((e as { field: unknown }).field) : undefined
    return c.json(err('INVALID_INPUT', message, field ? { field } : undefined), 422)
  }
})

// ── GET /api/tours/:id ────────────────────────────────────────
tours.get('/:id', authMiddleware, requirePermission('tour_view'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('id')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  const enriched = await enrichTourWithZipState(c.env, tour)
  return c.json(ok(withPublicViewerUrl(enriched, c.env.R2_PUBLIC_DOMAIN)))
})

// ── GET /api/tours/:id/history ────────────────────────────────
// Full ZIP upload / processing report for every attempt (survives re-uploads).
tours.get('/:id/history', authMiddleware, requirePermission('tour_view'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('id')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  const { listUploadHistory } = await import('../services/tour-upload-history')
  const history = await listUploadHistory(c.env.DB, tourId)
  return c.json(ok({ tourId, history }))
})

// ── GET /api/tours/:id/tour-admin ─────────────────────────────
// Returns { admins: TourAdmin[] }. Legacy clients: use admins[0].
tours.get(
  '/:id/tour-admin',
  authMiddleware,
  requirePermission('tour_view'),
  requirePermission('tour_admin_view'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('id')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const admins = await listTourAdmins(c.env.DB, tour.tour_id)
    return c.json(ok({ admins, admin: admins[0] ?? null }))
  },
)

// ── PUT /api/tours/:id/tour-admin ─────────────────────────────
tours.put(
  '/:id/tour-admin',
  authMiddleware,
  requirePermission('tour_edit'),
  requirePermission('tour_admin_edit'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('id')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
    }

    const parsed = tourAdminPutSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
    }

    try {
      const { id: adminId, ...rest } = parsed.data
      const admin = await upsertTourAdmin(
        c.env.DB,
        tour.tour_id,
        { ...rest, source: 'manual' },
        adminId,
      )
      return c.json(ok(admin))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save tour admin'
      const field =
        e && typeof e === 'object' && 'field' in e
          ? String((e as { field: unknown }).field)
          : undefined
      return c.json(err('INVALID_INPUT', message, field ? { field } : undefined), 422)
    }
  },
)

// ── DELETE /api/tours/:id/tour-admin/:adminId ─────────────────
tours.delete(
  '/:id/tour-admin/:adminId',
  authMiddleware,
  requirePermission('tour_edit'),
  requirePermission('tour_admin_edit'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('id')
    const adminId = c.req.param('adminId')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    const deleted = await deleteTourAdmin(c.env.DB, tour.tour_id, adminId)
    if (!deleted) return c.json(err('NOT_FOUND', 'Tour admin not found'), 404)
    return c.json(ok({ message: 'Tour admin deleted' }))
  },
)

// ── POST /api/tours/:id/tour-admin/reset-password ─────────────
tours.post(
  '/:id/tour-admin/reset-password',
  authMiddleware,
  requirePermission('tour_edit'),
  requirePermission('tour_admin_edit'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('id')
    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    const parsed = tourAdminResetPasswordSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
    }

    try {
      const result = await resetTourAdminPassword(
        c.env.DB,
        tour.tour_id,
        parsed.data.password,
        parsed.data.id,
      )
      return c.json(ok(result))
    } catch (e) {
      const code =
        e && typeof e === 'object' && 'code' in e
          ? String((e as { code: unknown }).code)
          : 'INVALID_INPUT'
      const message = e instanceof Error ? e.message : 'Could not reset password'
      return c.json(err(code, message), code === 'NOT_FOUND' ? 404 : 422)
    }
  },
)

// ── POST /api/tours/:id/cache/purge ───────────────────────────
tours.post(
  '/:id/cache/purge',
  authMiddleware,
  requirePermission('cache_purge_tour'),
  async (c) => {
    const user = c.get('user')
    const tourId = c.req.param('id')

    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) {
      return c.json(err('NOT_FOUND', 'Tour not found'), 404)
    }

    const publicId = tour.tour_id ?? tourId

    try {
      const result = await purgeTourCache(c.env, publicId)
      await logActivity(c.env.DB, user.id, 'cache_purge_tour', 'tour', String(tour.id), {
        tour_id: publicId,
        mode: result.mode,
        prefixes: result.prefixes,
        fileCount: result.fileCount,
        cloudflareSuccess: result.cloudflare.success,
      })

      if (!result.cloudflare.success) {
        const msg =
          result.cloudflare.errors?.[0]?.message ?? 'Cloudflare cache purge failed'
        return c.json(
          err('UPSTREAM_ERROR', msg, {
            prefixes: result.prefixes,
            mode: result.mode,
            cloudflare: result.cloudflare,
          }),
          502,
        )
      }

      return c.json(
        ok({
          tourId: publicId,
          mode: result.mode,
          purgedPrefixes: result.prefixes,
          fileCount: result.fileCount,
        }),
      )
    } catch (e) {
      if (e instanceof CachePurgeNotConfiguredError) {
        return c.json(err('SERVICE_UNAVAILABLE', e.message), 503)
      }
      const message = e instanceof Error ? e.message : 'Cache purge failed'
      return c.json(err('INTERNAL_ERROR', message), 500)
    }
  },
)

// ── POST /api/tours/:id/resume ────────────────────────────────
//
// Recover a stuck tour:
//   - uploading + ZIP in R2 → start processing
//   - uploading + no ZIP → mark failed (user can re-upload)
//   - processing / uploaded / failed(with ZIP) → re-dispatch to Go
tours.post('/:id/resume', authMiddleware, requirePermission('tour_create'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('id')

  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  const action = await resumeTour(c.env, tour, {
    forceNotify: true,
    failIncompleteUploadNow: true,
  })

  const updated = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  const enriched = updated
    ? withPublicViewerUrl(await enrichTourWithZipState(c.env, updated), c.env.R2_PUBLIC_DOMAIN)
    : null
  return c.json(
    ok({
      action,
      tour: enriched,
    }),
  )
})

// ── DELETE /api/tours/:id ─────────────────────────────────────
//
// Streams NDJSON progress events (application/x-ndjson):
//   1. Soft-delete + rename slug (frees original id for re-upload)
//   2. List R2 objects under tours/{originalId}/
//   3. Parallel batch-delete R2 objects
//
// R2 cleanup uses the original tour id as the key prefix (rename is DB-only).
// Purges via the Workers R2 binding with pipelined list+bulk-delete for speed.
tours.delete('/:id', authMiddleware, requirePermission('tour_delete'), async (c) => {
  const user = c.get('user')
  const tourId = c.req.param('id')

  // Verify ownership before opening the stream
  const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
  if (!tour) {
    return c.json(err('NOT_FOUND', 'Tour not found'), 404)
  }

  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-store')

  return stream(c, async (out) => {
    const started = Date.now()
    let softDeleted = false

    const write = async (
      event: Omit<TourDeleteProgressEvent, 'elapsedMs'> & { elapsedMs?: number },
    ) => {
      const payload: TourDeleteProgressEvent = {
        ...event,
        elapsedMs: event.elapsedMs ?? Date.now() - started,
      }
      await out.write(JSON.stringify(payload) + '\n')
    }

    try {
      // 1. Soft-delete + rename slug (tombstone id) so the original id is reusable immediately.
      //    R2 cleanup below still uses the original tourId prefix — DB rename does not move objects.
      softDeleted = await softDeleteTour(c.env.DB, tourId, user.id)
      if (!softDeleted) {
        await write({
          stage: 'error',
          percent: 0,
          filesDeleted: 0,
          filesTotal: 0,
          message:
            'Could not remove the tour record, so R2 files were left in place. Try delete again.',
        })
        return
      }

      await write({
        stage: 'soft_delete',
        percent: 5,
        filesDeleted: 0,
        filesTotal: 0,
        message: 'Tour record removed',
      })

      // Best-effort: drop any Go temp ZIP / chunks. Completed tours already
      // cleaned these; in-flight deletes still need the abort.
      try {
        await goIngestAbort(c.env, tourId)
      } catch (e: unknown) {
        console.error(`[delete] Go abort failed tour=${tourId}:`, e instanceof Error ? e.message : e)
      }

      // 2. List + bulk delete published files, backups, and the manifest.
      const prefix = tourDeletePrefix(tourId)
      const legacyPrefix = legacyTourDeletePrefix(tourId)
      await write({
        stage: 'listing',
        percent: 8,
        filesDeleted: 0,
        filesTotal: 0,
        message: 'Clearing folder…',
      })

      let filesDeleted = 0
      let filesTotal = 0
      let r2Warning: string | null = null
      let lastProgressAt = 0

      const onProgress = async ({
        listed,
        deleted,
        listingDone,
      }: {
        listed: number
        deleted: number
        listingDone: boolean
      }) => {
        filesDeleted = deleted
        filesTotal = listed

        const now = Date.now()
        if (!listingDone && deleted < listed && now - lastProgressAt < 200) {
          return
        }
        lastProgressAt = now

        const ratio = listed > 0 ? deleted / listed : 0
        const pct = listingDone
          ? Math.min(99, 8 + Math.round(ratio * 91))
          : Math.min(90, 8 + Math.round(ratio * 70))

        const stage = deleted > 0 || listingDone ? 'deleting' : 'listing'
        await write({
          stage,
          percent: pct,
          filesDeleted: deleted,
          filesTotal: listed,
          message: listingDone
          ? `Deleting remaining files in ${tourId}/`
          : `Clearing folder ${tourId}/`,
        })
      }

      try {
        const hasRemoteCreds = Boolean(
          c.env.R2_ACCESS_KEY_ID &&
            c.env.R2_SECRET_ACCESS_KEY &&
            c.env.R2_ACCOUNT_ID &&
            c.env.R2_BUCKET_NAME,
        )
        const result = hasRemoteCreds
          ? await purgePrefixS3(
              {
                accountId: c.env.R2_ACCOUNT_ID,
                bucketName: c.env.R2_BUCKET_NAME,
                accessKeyId: c.env.R2_ACCESS_KEY_ID,
                secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
              } satisfies R2Config,
              prefix,
              { onProgress },
            )
          : await purgePrefix(c.env.TOUR_BUCKET, prefix, {
              deleteConcurrency: 24,
              listConcurrency: 12,
              onProgress,
            })

        filesDeleted = result.deleted
        filesTotal = result.listed
        console.log(
          `[delete] tour=${tourId} listed=${result.listed} deleted=${result.deleted} ms=${Date.now() - started}`,
        )

        if (legacyPrefix !== prefix) {
          try {
            const legacyResult = hasRemoteCreds
              ? await purgePrefixS3(
                  {
                    accountId: c.env.R2_ACCOUNT_ID,
                    bucketName: c.env.R2_BUCKET_NAME,
                    accessKeyId: c.env.R2_ACCESS_KEY_ID,
                    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
                  } satisfies R2Config,
                  legacyPrefix,
                )
              : await purgePrefix(c.env.TOUR_BUCKET, legacyPrefix, {
                  deleteConcurrency: 24,
                  listConcurrency: 12,
                })
            filesDeleted += legacyResult.deleted
            filesTotal += legacyResult.listed
          } catch (legacyErr: unknown) {
            console.error(
              `[delete] legacy R2 purge error for ${legacyPrefix}:`,
              legacyErr instanceof Error ? legacyErr.message : legacyErr,
            )
          }
        }
      } catch (e: unknown) {
        r2Warning = e instanceof Error ? e.message : 'R2 purge failed'
        console.error(`[delete] R2 purgePrefix error for ${prefix}:`, r2Warning)
      }

      await write({
        stage: 'done',
        percent: 100,
        filesDeleted,
        filesTotal,
        message: 'Tour deleted',
        r2Warning,
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Delete failed'
      console.error(`[delete] error tour=${tourId}:`, message)
      // If DB soft-delete already committed, surface done+warning so the UI can close
      if (softDeleted) {
        await write({
          stage: 'done',
          percent: 100,
          filesDeleted: 0,
          filesTotal: 0,
          message: 'Tour deleted',
          r2Warning: message,
        })
      } else {
        await write({
          stage: 'error',
          percent: 0,
          filesDeleted: 0,
          filesTotal: 0,
          message,
        })
      }
    }
  })
})

// ── POST /api/tours/:id/media — upload tour media ────────────
//
// Handles: tour_thumbnail | tour_logo | tour_assets
// Guards:  tour_edit + media_upload
tours.post(
  '/:id/media',
  authMiddleware,
  requirePermission('tour_edit'),
  requirePermission('media_upload'),
  async (c) => {
    const user   = c.get('user')
    const tourId = c.req.param('id')

    const tour = await getTourByIdForOwner(c.env.DB, tourId, user.id)
    if (!tour) return c.json(err('NOT_FOUND', 'Tour not found'), 404)

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
    const collection = collectionParse.data as MediaCollection

    if (!collection.startsWith('tour_')) {
      return c.json(err('INVALID_INPUT', 'This endpoint only accepts tour_ collections'), 422)
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
    const key      = buildMediaKey('tour', tourId, collection, mediaId, ext)

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
      'tour',
      tourId,
      collection,
    )

    if (orphanedKey) {
      await c.env.TOUR_BUCKET.delete(orphanedKey)
    }

    const host = c.env.R2_PUBLIC_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const url  = `https://${host}/${key}`

    return c.json(ok({ ...mediaRow, url, link_id: linkId }), 201)
  },
)

export { tours as tourRoutes }
