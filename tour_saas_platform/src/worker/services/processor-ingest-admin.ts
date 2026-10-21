// ============================================================
// Relay chunked admin ZIP uploads to Go with artifact=tour_admin.
// Session key on Go is tourId:tour_admin — does not collide with viewer.
// ============================================================
import { processorBaseUrl } from './processor-ingest'
import type { Env } from '../types'
import { ARTIFACT_TYPE_TOUR_ADMIN } from './admin-paths'

export interface GoArtifactIngestInit {
  tourId: string
  sessionId: string
  totalChunks: number
  zipPath?: string
  artifactType?: string
}

export interface GoArtifactIngestStatus {
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
  artifactType?: string
}

function artifactIngestUrl(env: Env, tourId: string, suffix: string): string {
  const base = processorBaseUrl(env)
  const q = `artifact=${encodeURIComponent(ARTIFACT_TYPE_TOUR_ADMIN)}`
  return `${base}/ingest/${encodeURIComponent(tourId)}${suffix}?${q}`
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return text.slice(0, 300) || `HTTP ${res.status}`
}

export async function goAdminIngestInit(
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
): Promise<GoArtifactIngestInit> {
  const res = await fetch(artifactIngestUrl(env, tourId, '/init'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: JSON.stringify({ ...body, artifactType: ARTIFACT_TYPE_TOUR_ADMIN }),
  })
  if (!res.ok) {
    throw new Error(`Go admin ingest init failed: ${await readError(res)}`)
  }
  return (await res.json()) as GoArtifactIngestInit
}

export async function goAdminIngestChunk(
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

  const res = await fetch(artifactIngestUrl(env, tourId, `/chunk/${chunkNumber}`), {
    method: 'PUT',
    headers,
    body,
    duplex: 'half',
  } as RequestInit)
  if (!res.ok) {
    throw new Error(`Go admin ingest chunk ${chunkNumber} failed: ${await readError(res)}`)
  }
  return (await res.json()) as { bytesReceived: number; receivedChunks: number[] }
}

export async function goAdminIngestComplete(
  env: Env,
  tourId: string,
): Promise<{ assembled: boolean; zipPath?: string; enqueued: boolean }> {
  const res = await fetch(artifactIngestUrl(env, tourId, '/complete'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: JSON.stringify({ artifactType: ARTIFACT_TYPE_TOUR_ADMIN, phase: 'publish_admin' }),
  })
  if (!res.ok) {
    throw new Error(`Go admin ingest complete failed: ${await readError(res)}`)
  }
  return (await res.json()) as { assembled: boolean; zipPath?: string; enqueued: boolean }
}

export async function goAdminIngestStatus(
  env: Env,
  tourId: string,
): Promise<GoArtifactIngestStatus | null> {
  const res = await fetch(artifactIngestUrl(env, tourId, '/status'), {
    method: 'GET',
    headers: { 'X-Processor-Secret': env.PROCESSOR_SECRET },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Go admin ingest status failed: ${await readError(res)}`)
  }
  return (await res.json()) as GoArtifactIngestStatus
}

export async function goAdminIngestAbort(env: Env, tourId: string): Promise<void> {
  const res = await fetch(artifactIngestUrl(env, tourId, '/abort'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Processor-Secret': env.PROCESSOR_SECRET,
    },
    body: JSON.stringify({ artifactType: ARTIFACT_TYPE_TOUR_ADMIN }),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Go admin ingest abort failed: ${await readError(res)}`)
  }
}
