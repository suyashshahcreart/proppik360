// ============================================================
// Relay chunked ZIP uploads to the Go processor.
//
// The browser never talks to Go directly. The Worker checks the
// session cookie, then forwards each chunk with X-Processor-Secret.
// ============================================================
import { normalizeProcessorWebhookUrl } from './processor-notify'
import type { Env } from '../types'

export interface GoIngestInit {
  tourId: string
  sessionId: string
  totalChunks: number
  zipPath?: string
}

export interface GoIngestStatus {
  sessionId: string
  bytesReceived: number
  fileSize: number
  totalChunks: number
  receivedChunks: number[]
  missingChunks: number[]
  assembled: boolean
  zipPath?: string
  publishDone?: boolean
  backupVerified?: boolean
  backupKey?: string
}

export function processorBaseUrl(env: Env): string {
  if (env.PROCESSOR_INGEST_URL) {
    return normalizeProcessorWebhookUrl(env.PROCESSOR_INGEST_URL).replace(/\/$/, '')
  }
  const webhook = env.PROCESSOR_WEBHOOK_URL
    ? normalizeProcessorWebhookUrl(env.PROCESSOR_WEBHOOK_URL)
    : ''
  return webhook.replace(/\/jobs\/?$/, '').replace(/\/$/, '')
}

function ingestUrl(env: Env, tourId: string, suffix: string): string {
  return `${processorBaseUrl(env)}/ingest/${encodeURIComponent(tourId)}${suffix}`
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return text.slice(0, 300) || `HTTP ${res.status}`
}

export async function goIngestInit(
  env: Env,
  tourId: string,
  body: {
    sessionId: string
    filename: string
    fileSize: number
    chunkSize: number
    totalChunks: number
    backupVersion: string
    saveBackupZip?: boolean
  },
): Promise<GoIngestInit> {
  const res = await fetch(ingestUrl(env, tourId, '/init'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Go ingest init failed: ${await readError(res)}`)
  }
  return (await res.json()) as GoIngestInit
}

export async function goIngestChunk(
  env: Env,
  tourId: string,
  chunkNumber: number,
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
): Promise<{ bytesReceived: number; receivedChunks: number[] }> {
  const headers: Record<string, string> = {
    'X-Processor-Secret': env.PROCESSOR_SECRET,
    'Content-Type': 'application/octet-stream',
  }
  if (contentLength) headers['Content-Length'] = contentLength

  const res = await fetch(ingestUrl(env, tourId, `/chunk/${chunkNumber}`), {
    method: 'PUT',
    headers,
    body,
    duplex: 'half',
  } as RequestInit)
  if (!res.ok) {
    throw new Error(`Go ingest chunk ${chunkNumber} failed: ${await readError(res)}`)
  }
  return (await res.json()) as { bytesReceived: number; receivedChunks: number[] }
}

export async function goIngestComplete(
  env: Env,
  tourId: string,
): Promise<{ assembled: boolean; zipPath?: string; enqueued: boolean }> {
  const res = await fetch(ingestUrl(env, tourId, '/complete'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: '{}',
  })
  if (!res.ok) {
    throw new Error(`Go ingest complete failed: ${await readError(res)}`)
  }
  return (await res.json()) as { assembled: boolean; zipPath?: string; enqueued: boolean }
}

export async function goIngestStatus(env: Env, tourId: string): Promise<GoIngestStatus | null> {
  const res = await fetch(ingestUrl(env, tourId, '/status'), {
    method: 'GET',
    headers: { 'X-Processor-Secret': env.PROCESSOR_SECRET },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Go ingest status failed: ${await readError(res)}`)
  }
  return (await res.json()) as GoIngestStatus
}

export async function goIngestAbort(env: Env, tourId: string): Promise<void> {
  const res = await fetch(ingestUrl(env, tourId, '/abort'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: '{}',
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Go ingest abort failed: ${await readError(res)}`)
  }
}
