/**
 * R2Bucket binding shim using the S3-compatible API (no Wrangler / Workers binding).
 */
import { AwsClient } from 'aws4fetch'
import type { R2Bucket } from '@cloudflare/workers-types'
import { deleteObjects, putObject, type R2Config } from '../worker/services/r2'

interface ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
  delimiter?: string
}

interface ListPage {
  objects: Array<{ key: string; size?: number; uploaded?: Date }>
  truncated: boolean
  cursor?: string
  delimitedPrefixes?: string[]
}

function makeClient(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  })
}

async function listPage(config: R2Config, options: ListOptions): Promise<ListPage> {
  const client = makeClient(config)
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`
  const url = new URL(baseUrl)
  url.searchParams.set('list-type', '2')
  if (options.prefix) url.searchParams.set('prefix', options.prefix)
  url.searchParams.set('max-keys', String(options.limit ?? 1000))
  if (options.cursor) url.searchParams.set('continuation-token', options.cursor)
  if (options.delimiter) url.searchParams.set('delimiter', options.delimiter)

  const response = await client.fetch(url.toString(), { method: 'GET' })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`R2 list failed: HTTP ${response.status}: ${body}`)
  }

  const xml = await response.text()
  const objects: ListPage['objects'] = []
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1]
    const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1]
    if (!key) continue
    const size = Number(block.match(/<Size>([^<]+)<\/Size>/)?.[1] ?? 0)
    objects.push({ key, size })
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

  return { objects, truncated, cursor, delimitedPrefixes }
}

export function createS3R2Bucket(config: R2Config): R2Bucket {
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string | ReadableStream | null,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      let body: Uint8Array
      if (value == null) body = new Uint8Array(0)
      else if (typeof value === 'string') body = new Uint8Array(new TextEncoder().encode(value))
      else if (value instanceof ArrayBuffer) body = new Uint8Array(value)
      else if (ArrayBuffer.isView(value))
        body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      else if (value instanceof ReadableStream) {
        const buf = await new Response(value).arrayBuffer()
        body = new Uint8Array(buf)
      } else {
        body = new Uint8Array(0)
      }
      await putObject(config, key, body, options?.httpMetadata?.contentType)
    },

    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys]
      await deleteObjects(config, list)
    },

    async list(options?: ListOptions) {
      return listPage(config, options ?? {})
    },

    async head(_key: string) {
      throw new Error('R2Bucket.head not implemented in S3 shim — use headObject()')
    },

    async get(_key: string) {
      throw new Error('R2Bucket.get not implemented in S3 shim')
    },
  }

  return bucket as unknown as R2Bucket
}
