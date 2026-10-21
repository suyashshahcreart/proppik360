// ============================================================
// R2 multipart upload orchestration using the S3-compatible API
//
// WHY S3 API (not Workers R2 binding)?
//   The Workers binding method (env.TOUR_BUCKET.resumeMultipartUpload()
//   .uploadPart()) requires the Worker to receive each part's bytes,
//   meaning the Worker would have to proxy the entire multi-GB ZIP.
//   That violates the requirement.
//
//   Instead, we use the R2 S3-compatible endpoint to:
//     1. Create the multipart upload session (Worker calls R2)
//     2. Sign presigned URLs per part (Worker signs, browser uploads)
//     3. Complete or abort the upload (Worker calls R2)
//
//   The browser PUTs each part directly to R2 using the presigned URL.
//   The Worker never touches the ZIP file bytes.
//
// LIBRARY: aws4fetch
//   A small library for making signed AWS-compatible API requests.
//   Works inside Cloudflare Workers. Used to sign R2 S3 API calls.
//
// ENDPOINT FORMAT (path-style):
//   https://{accountId}.r2.cloudflarestorage.com/{bucketName}/{key}
// ============================================================
import { AwsClient } from 'aws4fetch'

export interface R2Config {
  accountId: string
  bucketName: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Build the base URL for a key in this R2 bucket.
 */
function makeObjectUrl(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`
}

/**
 * Create an AwsClient configured for R2.
 * No service/region needed — aws4fetch infers them from the URL.
 */
function makeClient(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  })
}

/**
 * Create a new multipart upload session in R2.
 *
 * Sends:  POST /{bucket}/{key}?uploads
 * Returns the uploadId string, which must be stored in D1 and used
 * for all subsequent part uploads and the final complete/abort call.
 */
export async function initiateMultipartUpload(
  config: R2Config,
  key: string,
): Promise<string> {
  const client = makeClient(config)
  const url = `${makeObjectUrl(config, key)}?uploads`

  const response = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`[R2] initiateMultipartUpload failed ${response.status}:`, body)
    throw new Error(`R2 initiate multipart upload failed: HTTP ${response.status}`)
  }

  const xml = await response.text()

  // R2 returns XML like:
  //   <InitiateMultipartUploadResult>
  //     <Bucket>my-bucket</Bucket>
  //     <Key>tours/abc/original.zip</Key>
  //     <UploadId>xxxxxxxx</UploadId>
  //   </InitiateMultipartUploadResult>
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/)
  if (!match?.[1]) {
    console.error('[R2] Could not parse UploadId from response:', xml)
    throw new Error('R2 response did not contain an UploadId')
  }

  return match[1]
}

/**
 * Generate a presigned URL for the browser to upload a single part directly to R2.
 *
 * The browser PUTs the part bytes to this URL — the Worker never sees the data.
 * Each URL is valid for 1 hour and is scoped to:
 *   - this exact object key
 *   - this exact uploadId
 *   - this exact partNumber
 *
 * After uploading, R2 returns an ETag header which the browser must collect
 * and send to /upload/complete.
 */
export async function getPresignedPartUrl(
  config: R2Config,
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const client = makeClient(config)

  const url = new URL(makeObjectUrl(config, key))
  url.searchParams.set('partNumber', String(partNumber))
  url.searchParams.set('uploadId', uploadId)
  // Tell R2 the URL expires in 1 hour (3600 seconds)
  url.searchParams.set('X-Amz-Expires', '3600')

  // sign() with signQuery:true puts the auth signature in the URL query string
  // instead of an Authorization header — this is how presigned URLs work.
  const signed = await client.sign(
    new Request(url.toString(), { method: 'PUT' }),
    { aws: { signQuery: true } },
  )

  return signed.url
}

/**
 * Complete the multipart upload by combining all uploaded parts into one object.
 *
 * Sends:  POST /{bucket}/{key}?uploadId={uploadId}
 * Body:   XML listing all parts and their ETags
 *
 * Parts MUST be sorted ascending by PartNumber before calling this.
 * R2 returns an error if they are out of order.
 */
export async function completeMultipartUpload(
  config: R2Config,
  key: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
): Promise<void> {
  const client = makeClient(config)
  const url = `${makeObjectUrl(config, key)}?uploadId=${encodeURIComponent(uploadId)}`

  // Sort parts by PartNumber ascending (R2/S3 requirement)
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CompleteMultipartUpload>',
    ...sorted.map(
      (p) =>
        `  <Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`,
    ),
    '</CompleteMultipartUpload>',
  ].join('\n')

  const response = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xmlBody,
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`[R2] completeMultipartUpload failed ${response.status}:`, body)
    throw new Error(`R2 complete multipart upload failed: HTTP ${response.status}`)
  }
}

export interface MultipartPartInfo {
  PartNumber: number
  ETag: string
  Size?: number
}

/**
 * List parts already uploaded for an in-progress multipart upload.
 *
 * Sends:  GET /{bucket}/{key}?uploadId={uploadId}&part-number-marker=…
 * Used by the browser (via Uppy) to resume after network loss or page refresh.
 */
export async function listMultipartUploadParts(
  config: R2Config,
  key: string,
  uploadId: string,
): Promise<MultipartPartInfo[]> {
  const client = makeClient(config)
  const parts: MultipartPartInfo[] = []
  let partNumberMarker: number | undefined

  do {
    const url = new URL(makeObjectUrl(config, key))
    url.searchParams.set('uploadId', uploadId)
    if (partNumberMarker != null) {
      url.searchParams.set('part-number-marker', String(partNumberMarker))
    }

    const response = await client.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      const body = await response.text()
      console.error(`[R2] listMultipartUploadParts failed ${response.status}:`, body)
      throw new Error(`R2 list parts failed: HTTP ${response.status}`)
    }

    const xml = await response.text()

    for (const match of xml.matchAll(
      /<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]+)<\/ETag>(?:\s*<Size>(\d+)<\/Size>)?\s*<\/Part>/g,
    )) {
      const partNumber = Number.parseInt(match[1], 10)
      const etag = match[2]
      const sizeRaw = match[3]
      parts.push({
        PartNumber: partNumber,
        ETag: etag,
        Size: sizeRaw != null ? Number.parseInt(sizeRaw, 10) : undefined,
      })
    }

    const truncatedMatch = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/)
    if (truncatedMatch?.[1] === 'true') {
      const markerMatch = xml.match(/<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/)
      partNumberMarker = markerMatch?.[1] ? Number.parseInt(markerMatch[1], 10) : undefined
      if (partNumberMarker == null) break
    } else {
      partNumberMarker = undefined
    }
  } while (partNumberMarker != null)

  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

/**
 * Abort a multipart upload, freeing the R2 storage reserved for parts.
 *
 * Should be called when a user cancels an upload to avoid paying for
 * orphaned parts. R2 also auto-aborts incomplete uploads after 7 days.
 *
 * Sends:  DELETE /{bucket}/{key}?uploadId={uploadId}
 */
export async function abortMultipartUpload(
  config: R2Config,
  key: string,
  uploadId: string,
): Promise<void> {
  const client = makeClient(config)
  const url = `${makeObjectUrl(config, key)}?uploadId=${encodeURIComponent(uploadId)}`

  const response = await client.fetch(url, { method: 'DELETE' })

  // 404 means the upload session no longer exists — treat as success
  if (!response.ok && response.status !== 404) {
    const body = await response.text()
    console.error(`[R2] abortMultipartUpload failed ${response.status}:`, body)
    throw new Error(`R2 abort multipart upload failed: HTTP ${response.status}`)
  }
}

/**
 * Abort every in-progress multipart upload under a prefix.
 * Completed objects are removed by purgePrefixS3; these "Ongoing Multipart
 * Upload" rows are not objects and stay in the R2 console until aborted.
 */
export async function abortMultipartUploadsUnderPrefix(
  config: R2Config,
  prefix: string,
): Promise<number> {
  const client = makeClient(config)
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`
  let keyMarker: string | null = null
  let uploadIdMarker: string | null = null
  let aborted = 0

  do {
    const url = new URL(baseUrl)
    url.searchParams.set('uploads', '')
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('max-uploads', '1000')
    if (keyMarker) url.searchParams.set('key-marker', keyMarker)
    if (uploadIdMarker) url.searchParams.set('upload-id-marker', uploadIdMarker)

    const response = await client.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`R2 list multipart uploads failed: HTTP ${response.status}: ${body.slice(0, 300)}`)
    }
    const xml = await response.text()

    const uploads = [...xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)]
    for (const match of uploads) {
      const block = match[1] ?? ''
      const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1]
      const uploadId = block.match(/<UploadId>([^<]*)<\/UploadId>/)?.[1]
      if (!key || !uploadId) continue
      await abortMultipartUpload(config, decodeXml(key), uploadId)
      aborted++
    }

    const truncated = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/)?.[1] === 'true'
    if (!truncated) break
    keyMarker = xml.match(/<NextKeyMarker>([^<]*)<\/NextKeyMarker>/)?.[1] ?? null
    uploadIdMarker = xml.match(/<NextUploadIdMarker>([^<]*)<\/NextUploadIdMarker>/)?.[1] ?? null
    if (!keyMarker && !uploadIdMarker) break
  } while (true)

  return aborted
}

export interface R2ObjectHead {
  exists: boolean
  contentLength: number | null
  lastModified: string | null
}

/**
 * HEAD an object in R2. Incomplete multipart uploads do NOT count as existing.
 *
 * Sends:  HEAD /{bucket}/{key}
 */
export async function headObject(
  config: R2Config,
  key: string,
): Promise<R2ObjectHead> {
  const client = makeClient(config)
  const response = await client.fetch(makeObjectUrl(config, key), {
    method: 'HEAD',
  })
  if (response.status === 404) {
    return { exists: false, contentLength: null, lastModified: null }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`[R2] headObject failed ${response.status}:`, body)
    throw new Error(`R2 HEAD failed: HTTP ${response.status}`)
  }

  const lenHeader = response.headers.get('Content-Length')
  const contentLength =
    lenHeader != null && lenHeader !== '' ? Number.parseInt(lenHeader, 10) : null

  return {
    exists: true,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    lastModified: response.headers.get('Last-Modified'),
  }
}

/**
 * Check whether an object exists in R2 (completed upload).
 * Incomplete multipart uploads do NOT count as existing objects.
 *
 * Sends:  HEAD /{bucket}/{key}
 */
export async function objectExists(
  config: R2Config,
  key: string,
): Promise<boolean> {
  const head = await headObject(config, key)
  return head.exists
}

/** Put a single object (used when TOUR_BUCKET binding is unavailable on Node). */
export async function putObject(
  config: R2Config,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  const client = makeClient(config)
  const url = makeObjectUrl(config, key)
  const response = await client.fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': contentType ?? 'application/octet-stream',
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`R2 putObject failed: HTTP ${response.status}: ${text}`)
  }
}

/**
 * List all object keys under a given prefix.
 *
 * Sends:  GET /{bucket}?list-type=2&prefix={prefix}&max-keys=1000
 * Handles pagination — fetches all pages until IsTruncated=false.
 */
export async function listObjects(
  config: R2Config,
  prefix: string,
): Promise<string[]> {
  const client = makeClient(config)
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`
  const keys: string[] = []
  let continuationToken: string | null = null

  do {
    const url = new URL(baseUrl)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('max-keys', '1000')
    if (continuationToken) {
      url.searchParams.set('continuation-token', continuationToken)
    }

    const response = await client.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`R2 listObjects failed: HTTP ${response.status}: ${body}`)
    }

    const xml = await response.text()

    // Extract keys from <Key>...</Key> tags
    const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g)
    for (const match of keyMatches) {
      keys.push(match[1])
    }

    // Check if there are more pages
    const truncatedMatch = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/)
    if (truncatedMatch?.[1] === 'true') {
      const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
      continuationToken = tokenMatch?.[1] ?? null
    } else {
      continuationToken = null
    }
  } while (continuationToken)

  return keys
}

export interface R2ListPageObject {
  key: string
  size: number
  lastModified: string | null
}

export interface R2ListPageResult {
  objects: R2ListPageObject[]
  delimitedPrefixes: string[]
  truncated: boolean
  cursor?: string
}

/**
 * One S3 ListObjectsV2 page. Use delimiter=/ for folder-style listings.
 */
export async function listObjectsPage(
  config: R2Config,
  options: {
    prefix?: string
    delimiter?: string
    limit?: number
    cursor?: string
  } = {},
): Promise<R2ListPageResult> {
  const client = makeClient(config)
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`
  const url = new URL(baseUrl)
  url.searchParams.set('list-type', '2')
  url.searchParams.set('max-keys', String(Math.min(1000, Math.max(1, options.limit ?? 200))))
  if (options.prefix) url.searchParams.set('prefix', options.prefix)
  if (options.delimiter) url.searchParams.set('delimiter', options.delimiter)
  if (options.cursor) url.searchParams.set('continuation-token', options.cursor)

  const response = await client.fetch(url.toString(), { method: 'GET' })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`R2 listObjectsPage failed: HTTP ${response.status}: ${body}`)
  }

  const xml = await response.text()
  const objects: R2ListPageObject[] = []
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1]
    const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1]
    if (!key) continue
    const size = Number(block.match(/<Size>([^<]+)<\/Size>/)?.[1] ?? 0)
    const lastModified = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? null
    objects.push({ key, size, lastModified })
  }

  const delimitedPrefixes: string[] = []
  for (const match of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
    const p = match[1].match(/<Prefix>([^<]+)<\/Prefix>/)?.[1]
    if (p) delimitedPrefixes.push(p)
  }

  const truncated = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/)?.[1] === 'true'
  const cursor = truncated
    ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
    : undefined

  return { objects, delimitedPrefixes, truncated, cursor }
}

/** Short-lived presigned GET for a single object. Keys never leave the server. */
export async function getPresignedDownloadUrl(
  config: R2Config,
  r2Key: string,
  expiresSec = 3600,
): Promise<string> {
  const client = makeClient(config)
  const url = new URL(makeObjectUrl(config, r2Key))
  url.searchParams.set('X-Amz-Expires', String(expiresSec))
  const signed = await client.sign(new Request(url.toString(), { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return signed.url
}

/**
 * Delete multiple R2 objects via S3 DeleteObjects.
 *
 * Defaults use max batch size (1000) and high concurrency so large tours
 * finish quickly. Quiet mode ignores missing keys.
 */
export async function deleteObjects(
  config: R2Config,
  keys: string[],
  options: {
    /** Keys per DeleteObjects call (R2 max 1000). Default 1000. */
    batchSize?: number
    /** Concurrent DeleteObjects requests. Default 20. */
    concurrency?: number
    onProgress?: (deleted: number) => void | Promise<void>
  } = {},
): Promise<void> {
  if (keys.length === 0) return

  const client = makeClient(config)
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}?delete`
  const batchSize = Math.min(1000, Math.max(1, options.batchSize ?? 1000))
  const concurrency = options.concurrency ?? 20

  const batches: string[][] = []
  for (let i = 0; i < keys.length; i += batchSize) {
    batches.push(keys.slice(i, i + batchSize))
  }

  let deleted = 0

  const deleteBatch = async (batch: string[]) => {
    const xmlBody = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Delete><Quiet>true</Quiet>',
      ...batch.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`),
      '</Delete>',
    ].join('')

    const response = await client.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlBody,
    })

    const body = await response.text()
    if (!response.ok) {
      console.error(`[R2] deleteObjects failed ${response.status}:`, body)
      throw new Error(`R2 deleteObjects failed: HTTP ${response.status}`)
    }
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const window = batches.slice(i, i + concurrency)
    await Promise.all(window.map((batch) => deleteBatch(batch)))
    deleted += window.reduce((sum, batch) => sum + batch.length, 0)
    await options.onProgress?.(deleted)
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

interface S3ListPage {
  keys: string[]
  prefixes: string[]
  next: string | null
}

/**
 * One ListObjectsV2 page. `delimiter` returns only the current folder's files
 * plus child folder names, so a tour tree can be cleared in parallel.
 */
async function s3ListPage(
  client: AwsClient,
  config: R2Config,
  prefix: string,
  continuationToken: string | null,
  delimiter: boolean,
): Promise<S3ListPage> {
  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`,
  )
  url.searchParams.set('list-type', '2')
  url.searchParams.set('prefix', prefix)
  url.searchParams.set('max-keys', '1000')
  if (delimiter) url.searchParams.set('delimiter', '/')
  if (continuationToken) url.searchParams.set('continuation-token', continuationToken)

  const response = await client.fetch(url.toString(), { method: 'GET' })
  const xml = await response.text()
  if (!response.ok) {
    throw new Error(`R2 listObjects failed: HTTP ${response.status}: ${xml.slice(0, 300)}`)
  }

  const keys: string[] = []
  for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
    keys.push(decodeXml(match[1]))
  }

  const prefixes: string[] = []
  if (delimiter) {
    for (const block of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
      const prefixMatch = block[1].match(/<Prefix>([^<]+)<\/Prefix>/)
      if (prefixMatch?.[1]) prefixes.push(decodeXml(prefixMatch[1]))
    }
  }

  const truncated = xml.match(/<IsTruncated>([^<]+)<\/IsTruncated>/)?.[1] === 'true'
  const token = truncated
    ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
    : null

  return {
    keys,
    prefixes,
    next: token ? decodeXml(token) : null,
  }
}

/** Delete up to 1000 keys in one R2 call. R2 has no prefix/folder delete. */
async function deleteObjectBatch(
  client: AwsClient,
  config: R2Config,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}?delete`
  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Delete><Quiet>true</Quiet>',
    ...keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`),
    '</Delete>',
  ].join('')

  const response = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xmlBody,
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`R2 deleteObjects failed: HTTP ${response.status}: ${body.slice(0, 300)}`)
  }
}

/**
 * Clear every object under a prefix (the tour folder) using the R2 S3 API.
 *
 * R2 has no "delete folder" operation. This still removes `tours/{id}/` as a
 * unit, but in parallel 1000-key batches, with subfolders listed at the same
 * time. Local wrangler R2 bindings are an empty preview bucket, so deletes
 * must use these credentials to hit the real bucket.
 */
export async function purgePrefixS3(
  config: R2Config,
  prefix: string,
  options: {
    onProgress?: (progress: PurgePrefixProgress) => void | Promise<void>
  } = {},
): Promise<PurgePrefixResult> {
  const client = makeClient(config)
  const deleteConcurrency = 24
  const listConcurrency = 12
  let listed = 0
  let deleted = 0
  let listingDone = false
  let lastEmitAt = 0
  let emitChain: Promise<void> = Promise.resolve()
  const inflightDeletes = new Set<Promise<void>>()
  let deleteError: unknown = null

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmitAt < 300) return
    lastEmitAt = now
    const snap: PurgePrefixProgress = { listed, deleted, listingDone }
    emitChain = emitChain
      .then(() => options.onProgress?.(snap))
      .then(() => undefined)
      .catch(() => undefined)
  }

  const enqueueDelete = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      while (inflightDeletes.size >= deleteConcurrency) {
        await Promise.race(inflightDeletes)
        if (deleteError) throw deleteError
      }
      const task = deleteObjectBatch(client, config, batch)
        .then(() => {
          deleted += batch.length
          emit()
        })
        .catch((e: unknown) => {
          deleteError ??= e
        })
        .finally(() => {
          inflightDeletes.delete(task)
        })
      inflightDeletes.add(task)
    }
  }

  const purgeFlat = async (branchPrefix: string): Promise<void> => {
    let token: string | null = null
    do {
      if (deleteError) throw deleteError
      const page = await s3ListPage(client, config, branchPrefix, token, false)
      token = page.next
      if (page.keys.length > 0) {
        listed += page.keys.length
        emit()
        await enqueueDelete(page.keys)
      }
    } while (token)
  }

  const splitFolder = async (branchPrefix: string, depth: number): Promise<void> => {
    if (deleteError) throw deleteError
    if (depth >= 2) {
      await purgeFlat(branchPrefix)
      return
    }

    const childPrefixes: string[] = []
    const rootKeys: string[] = []
    let token: string | null = null
    do {
      const page = await s3ListPage(client, config, branchPrefix, token, true)
      token = page.next
      childPrefixes.push(...page.prefixes)
      rootKeys.push(...page.keys)
    } while (token)

    if (rootKeys.length > 0) {
      listed += rootKeys.length
      emit()
      await enqueueDelete(rootKeys)
    }

    if (childPrefixes.length === 0) return
    // One extra split when a folder has a handful of children (tiles/node-1, …).
    // Thousands of children stay as parallel flat lists so we don't blow the
    // Worker subrequest cap.
    if (depth >= 1 || childPrefixes.length > 48) {
      await mapPool(childPrefixes, listConcurrency, (child) => purgeFlat(child))
      return
    }
    await mapPool(childPrefixes, listConcurrency, (child) => splitFolder(child, depth + 1))
  }

  await splitFolder(prefix, 0)
  listingDone = true
  await Promise.all([...inflightDeletes])
  if (deleteError) throw deleteError

  try {
    const aborted = await abortMultipartUploadsUnderPrefix(config, prefix)
    if (aborted > 0) {
      listed += aborted
      deleted += aborted
      console.log(`[R2] aborted ${aborted} incomplete multipart upload(s) under ${prefix}`)
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[R2] abort incomplete uploads under ${prefix}:`, message)
    throw e
  }

  emit(true)
  await emitChain
  return { listed, deleted }
}

export interface PurgePrefixProgress {
  /** Keys discovered so far (grows until listing finishes). */
  listed: number
  /** Keys successfully deleted so far. */
  deleted: number
  /** True once every prefix page has been listed (deletes may still be in flight). */
  listingDone: boolean
}

export interface PurgePrefixResult {
  listed: number
  deleted: number
}

/**
 * Aggressively purge all objects under a prefix using the Workers R2 binding.
 *
 * Strategy (tuned for ~100k+ object tours under ~2 minutes):
 *  1. Shallow delimiter split at the root — fan out a few top-level prefixes
 *     (e.g. viewer/, media/) so independent trees list in parallel
 *  2. Flat paginated list per branch (no deep recursion — avoids exploding
 *     subrequest count on deep tile folder trees)
 *  3. Pipeline: enqueue bulk delete (≤1000 keys) as soon as each page lists
 *  4. Bounded delete concurrency
 *
 * Subrequest budget (paid Workers ≈ 1000/invocation): ~1 list + ~1 delete per
 * 1000 objects. A 112k-object tour ≈ 230 subrequests — safely under the limit.
 * (Deep recursive delimiter listing is intentionally avoided; thousands of
 * tile folders would exceed the subrequest cap.)
 */
export async function purgePrefix(
  bucket: R2Bucket,
  prefix: string,
  options: {
    /** Concurrent R2 delete() calls. Default 24. */
    deleteConcurrency?: number
    /** Concurrent top-level prefix branches. Default 8. */
    listConcurrency?: number
    onProgress?: (progress: PurgePrefixProgress) => void | Promise<void>
  } = {},
): Promise<PurgePrefixResult> {
  const deleteConcurrency = Math.max(1, options.deleteConcurrency ?? 24)
  const listConcurrency = Math.max(1, options.listConcurrency ?? 8)

  let listed = 0
  let deleted = 0
  let listingDone = false

  const inflightDeletes = new Set<Promise<void>>()
  let deleteError: unknown = null

  const emit = async () => {
    await options.onProgress?.({ listed, deleted, listingDone })
  }

  const runDelete = async (keys: string[]) => {
    if (keys.length === 0) return
    try {
      await bucket.delete(keys)
      deleted += keys.length
      await emit()
    } catch (e) {
      deleteError ??= e
      throw e
    }
  }

  const enqueueDelete = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      while (inflightDeletes.size >= deleteConcurrency) {
        await Promise.race(inflightDeletes)
        if (deleteError) throw deleteError
      }
      const task = runDelete(batch).finally(() => {
        inflightDeletes.delete(task)
      })
      inflightDeletes.add(task)
    }
  }

  /** Flat list (no delimiter) + pipelined delete for one prefix. */
  const purgeFlat = async (branchPrefix: string): Promise<void> => {
    let cursor: string | undefined
    do {
      if (deleteError) throw deleteError

      const page = await bucket.list({
        prefix: branchPrefix,
        limit: 1000,
        cursor,
      })

      const keys = page.objects.map((obj) => obj.key)
      if (keys.length > 0) {
        listed += keys.length
        await emit()
        await enqueueDelete(keys)
      }

      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }

  /**
   * One-level delimiter split so tours/{id}/viewer/ and tours/{id}/media/
   * can list in parallel. Falls back to flat purge of `prefix` when there
   * are no child prefixes (or only keys at this level).
   */
  const discoverBranches = async (): Promise<string[]> => {
    const branches: string[] = []
    let cursor: string | undefined
    let sawChildPrefix = false

    do {
      const page = await bucket.list({
        prefix,
        delimiter: '/',
        limit: 1000,
        cursor,
      })

      const keys = page.objects.map((obj) => obj.key)
      if (keys.length > 0) {
        listed += keys.length
        await emit()
        await enqueueDelete(keys)
      }

      for (const child of page.delimitedPrefixes ?? []) {
        sawChildPrefix = true
        branches.push(child)
      }

      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)

    // No folder children → everything was already handled as root keys,
    // OR delimiter returned nothing useful; flat-purge whole prefix once.
    if (!sawChildPrefix && listed === 0) {
      return [prefix]
    }
    return branches
  }

  try {
    const branches = await discoverBranches()
    if (branches.length > 0) {
      await mapPool(branches, listConcurrency, purgeFlat)
    }

    listingDone = true
    await emit()
    await Promise.all([...inflightDeletes])
    if (deleteError) throw deleteError
    await emit()
    return { listed, deleted }
  } catch (e) {
    // Wait for in-flight deletes so we don't leave the Worker mid-flight
    await Promise.allSettled([...inflightDeletes])
    throw e
  }
}

/** Run async work over items with a concurrency cap. */
async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const executing = new Set<Promise<void>>()
  for (const item of items) {
    const task = fn(item).finally(() => {
      executing.delete(task)
    })
    executing.add(task)
    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }
  await Promise.all([...executing])
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
