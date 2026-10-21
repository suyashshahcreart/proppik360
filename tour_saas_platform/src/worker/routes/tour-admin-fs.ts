// ============================================================
// Public tour-admin viewer FS (TOUR_BUCKET / {tourId}/ only)
//
//   GET    /api/tour-admin/:tourId/fs/list
//   GET    /api/tour-admin/:tourId/fs/object
//   PUT    /api/tour-admin/:tourId/fs/object
//   POST   /api/tour-admin/:tourId/fs/mkdir
//   DELETE /api/tour-admin/:tourId/fs/object
// ============================================================
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ok, err } from '../utils/response'
import { tourAdminFsMkdirSchema } from '../utils/validation'
import { validateTourAdminSession } from '../services/tour-admin-auth'
import {
  deleteObjects,
  getPresignedDownloadUrl,
  headObject,
  listObjectsPage,
  putObject,
} from '../services/r2'
import {
  FS_DELETE_KEY_CAP,
  FS_LIST_PAGE_SIZE,
  FS_MAX_PUT_BYTES,
  contentTypeForPath,
  folderPrefix,
  isAllowedUploadExtension,
  isProtectedDeletePath,
  isProtectedWritePath,
  isTourId,
  keepKey,
  relativeFromKey,
  resolveViewerFsPath,
  shouldHideFromList,
  viewerPublicUrl,
  viewerR2Config,
} from '../services/tour-admin-fs'
import { requireTourAdminApiKey } from './tour-admin-public'
import type { Env, Variables } from '../types'

const tourAdminFs = new Hono<{ Bindings: Env; Variables: Variables }>()

tourAdminFs.use('*', requireTourAdminApiKey)

function tourIdFromRequest(c: {
  req: { param: (k: string) => string | undefined; path: string }
}): string {
  const fromParam = c.req.param('tourId') ?? ''
  if (isTourId(fromParam)) return fromParam
  const fromPath = c.req.path.match(/\/api\/tour-admin\/(\d{6})\/fs(?:\/|$)/)?.[1] ?? ''
  return fromPath
}

const requireTourAdminSession = createMiddleware<{
  Bindings: Env
  Variables: Variables
}>(async (c, next) => {
  const tourId = tourIdFromRequest(c)
  if (!isTourId(tourId)) {
    return c.json(err('INVALID_INPUT', 'Tour ID must be 6 digits'), 422)
  }

  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) {
    return c.json(err('UNAUTHORIZED', 'Bearer token required'), 401)
  }

  const session = await validateTourAdminSession(c.env.DB, token, tourId)
  if (!session.valid || session.tour_id !== tourId) {
    return c.json(err('UNAUTHORIZED', 'Invalid or expired session'), 401)
  }

  c.set('tourAdminId', session.admin_id)
  c.set('tourAdminTourId', session.tour_id)
  await next()
})

tourAdminFs.use('*', requireTourAdminSession)

function truthyQuery(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

function resolvedOrError(tourId: string, raw: string | null | undefined, allowEmpty = false) {
  return resolveViewerFsPath(tourId, raw, { allowEmpty })
}

tourAdminFs.get('/list', async (c) => {
  const tourId = tourIdFromRequest(c)
  const resolved = resolvedOrError(tourId, c.req.query('path'), true)
  if (!resolved.ok) return c.json(err(resolved.code, resolved.message), 422)

  const prefix = folderPrefix(resolved)
  const page = await listObjectsPage(viewerR2Config(c.env), {
    prefix,
    delimiter: '/',
    limit: FS_LIST_PAGE_SIZE,
    cursor: c.req.query('cursor') || undefined,
  })

  const folders: Array<{ name: string; path: string }> = []
  for (const rawPrefix of page.delimitedPrefixes) {
    const rel = relativeFromKey(tourId, rawPrefix).replace(/\/+$/, '')
    if (!rel || shouldHideFromList(rel, resolved.relativePath)) continue
    folders.push({ name: rel.split('/').pop() ?? rel, path: rel })
  }

  const files: Array<{
    name: string
    path: string
    size: number
    updatedAt: string | null
    url: string
  }> = []
  for (const obj of page.objects) {
    const rel = relativeFromKey(tourId, obj.key)
    if (!rel || rel.endsWith('/') || shouldHideFromList(rel, resolved.relativePath)) continue
    files.push({
      name: rel.split('/').pop() ?? rel,
      path: rel,
      size: obj.size,
      updatedAt: obj.lastModified,
      url: viewerPublicUrl(c.env.R2_PUBLIC_DOMAIN, tourId, rel),
    })
  }

  return c.json(
    ok({
      tourId,
      path: resolved.relativePath,
      folders,
      files,
      cursor: page.cursor ?? null,
      truncated: page.truncated,
    }),
  )
})

tourAdminFs.get('/object', async (c) => {
  const tourId = tourIdFromRequest(c)
  const resolved = resolvedOrError(tourId, c.req.query('path'))
  if (!resolved.ok) return c.json(err(resolved.code, resolved.message), 422)

  const config = viewerR2Config(c.env)
  const head = await headObject(config, resolved.key)
  if (!head.exists) {
    return c.json(err('NOT_FOUND', 'File not found'), 404)
  }

  const url = viewerPublicUrl(c.env.R2_PUBLIC_DOMAIN, tourId, resolved.relativePath)
  const data: Record<string, unknown> = {
    tourId,
    path: resolved.relativePath,
    name: resolved.name,
    size: head.contentLength,
    updatedAt: head.lastModified,
    contentType: contentTypeForPath(resolved.relativePath),
    url,
    exists: true,
  }

  if (truthyQuery(c.req.query('download'))) {
    data.downloadUrl = await getPresignedDownloadUrl(config, resolved.key, 900)
    data.downloadExpiresInSec = 900
  }

  return c.json(ok(data))
})

tourAdminFs.put('/object', async (c) => {
  const tourId = tourIdFromRequest(c)
  const resolved = resolvedOrError(tourId, c.req.query('path'))
  if (!resolved.ok) return c.json(err(resolved.code, resolved.message), 422)
  if (isProtectedWritePath(resolved.relativePath)) {
    return c.json(err('FORBIDDEN', 'This path cannot be modified'), 403)
  }
  if (!isAllowedUploadExtension(resolved.relativePath)) {
    return c.json(err('INVALID_INPUT', 'File type is not allowed'), 422)
  }

  const body = await c.req.arrayBuffer()
  if (body.byteLength > FS_MAX_PUT_BYTES) {
    return c.json(err('TOO_LARGE', `File exceeds ${FS_MAX_PUT_BYTES} bytes`), 413)
  }

  const config = viewerR2Config(c.env)
  const existing = await headObject(config, resolved.key)
  const contentType = contentTypeForPath(resolved.relativePath, c.req.header('Content-Type'))
  await putObject(config, resolved.key, body, contentType)

  return c.json(
    ok({
      path: resolved.relativePath,
      key: resolved.key,
      size: body.byteLength,
      url: viewerPublicUrl(c.env.R2_PUBLIC_DOMAIN, tourId, resolved.relativePath),
      op: existing.exists ? 'updated' : 'created',
    }),
  )
})

tourAdminFs.post('/mkdir', async (c) => {
  const tourId = tourIdFromRequest(c)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }
  const parsed = tourAdminFsMkdirSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const resolved = resolvedOrError(tourId, parsed.data.path)
  if (!resolved.ok) return c.json(err(resolved.code, resolved.message), 422)
  if (isProtectedWritePath(resolved.relativePath)) {
    return c.json(err('FORBIDDEN', 'This path cannot be modified'), 403)
  }

  const config = viewerR2Config(c.env)
  const marker = keepKey(resolved)
  const existing = await headObject(config, marker)
  if (!existing.exists) {
    await putObject(config, marker, new Uint8Array(0), 'application/octet-stream')
  }

  return c.json(
    ok({
      path: resolved.relativePath,
      created: !existing.exists,
    }),
  )
})

tourAdminFs.delete('/object', async (c) => {
  const tourId = tourIdFromRequest(c)
  const resolved = resolvedOrError(tourId, c.req.query('path'))
  if (!resolved.ok) return c.json(err(resolved.code, resolved.message), 422)
  if (isProtectedDeletePath(resolved.relativePath)) {
    return c.json(err('FORBIDDEN', 'This path cannot be deleted'), 403)
  }

  const recursive = truthyQuery(c.req.query('recursive'))
  const config = viewerR2Config(c.env)
  const head = await headObject(config, resolved.key)

  if (head.exists) {
    await deleteObjects(config, [resolved.key])
    return c.json(ok({ path: resolved.relativePath, deleted: 1, truncated: false }))
  }

  const prefix = folderPrefix(resolved)
  const page = await listObjectsPage(config, {
    prefix,
    limit: FS_DELETE_KEY_CAP,
  })
  if (page.objects.length === 0) {
    return c.json(err('NOT_FOUND', 'File or folder not found'), 404)
  }
  if (!recursive) {
    return c.json(err('CONFLICT', 'Folder is not empty. Pass recursive=true to delete it.'), 409)
  }

  const keys = page.objects.map((o) => o.key)
  await deleteObjects(config, keys)
  return c.json(
    ok({
      path: resolved.relativePath,
      deleted: keys.length,
      truncated: page.truncated,
    }),
  )
})

export { tourAdminFs as tourAdminFsRoutes }
