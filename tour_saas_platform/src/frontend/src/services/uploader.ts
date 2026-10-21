// ============================================================
// Tour ZIP uploader — chunked upload to the Go processor.
//
// The browser sends chunks through the Worker. Progress is reported
// from bytes actually sent, and a refresh resumes from Go's chunk list
// after the same ZIP is selected again.
// ============================================================
import { api } from './api'

const DEFAULT_PART_SIZE = 25 * 1024 * 1024
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000] as const

export interface UploadProgress {
  uploadedBytes: number
  totalBytes: number
  percentage: number
  uploadedParts: number
  totalParts: number
  status:
    | 'idle'
    | 'creating'
    | 'uploading'
    | 'paused'
    | 'retrying'
    | 'completing'
    | 'done'
    | 'error'
    | 'aborted'
  error?: string
}

export type IngestArtifactType = 'tour_viewer' | 'tour_admin'

export interface UploaderConfig {
  tourId: string
  file: File
  onProgress: (progress: UploadProgress) => void
  onComplete: () => void
  onError: (message: string) => void
  concurrency?: number
  maxRetries?: number
  forceReupload?: boolean
  /** Resume an in-progress multipart session (e.g. tour.upload_id from D1). */
  resumeUploadId?: string | null
  resumeR2Key?: string | null
  /** When true, Go uploads a timestamped ZIP copy to R2 after publish. */
  saveBackupZip?: boolean
  /**
   * Default tour_viewer (existing ingest APIs).
   * tour_admin uses /artifacts/tour_admin/ingest/* and does not change tours.status.
   */
  artifactType?: IngestArtifactType
}

export function friendlyUploadError(message: string): string {
  const text = message.trim()
  if (/set state for uppy/i.test(text) || /file could have been removed/i.test(text)) {
    return 'The browser lost this ZIP before the upload started. Choose the file again and click Start Upload.'
  }
  if (/^network error/i.test(text)) {
    return 'The upload lost its connection. Check that the Worker and Go processor are running, then try again.'
  }
  return text
}

function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('online', onOnline)
      signal?.removeEventListener('abort', onAbort)
    }

    const onOnline = () => {
      cleanup()
      resolve()
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    window.addEventListener('online', onOnline)
    signal?.addEventListener('abort', onAbort)
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    if (signal?.aborted) {
      window.clearTimeout(timer)
      reject(new DOMException('Upload aborted', 'AbortError'))
      return
    }

    signal?.addEventListener('abort', onAbort)
  })
}

export class GoIngestUploader {
  private readonly config: UploaderConfig
  private readonly concurrency: number
  private readonly maxRetries: number
  private readonly artifactType: IngestArtifactType

  private uploadId: string | null = null
  private partSizeBytes = DEFAULT_PART_SIZE
  private totalParts = 0
  private completedParts: Array<{ PartNumber: number; ETag: string }> = []
  private uploadedBytes = 0
  private inflightBytes = new Map<number, number>()
  private lastEmitAt = 0
  private aborted = false
  private offlinePaused = false
  private retrying = false
  private abortController: AbortController | null = null

  constructor(config: UploaderConfig) {
    this.config = config
    this.concurrency = config.concurrency ?? 8
    this.maxRetries = config.maxRetries ?? RETRY_DELAYS_MS.length
    this.artifactType = config.artifactType ?? 'tour_viewer'
  }

  private get isAdminArtifact() {
    return this.artifactType === 'tour_admin'
  }

  async start(): Promise<void> {
    this.aborted = false
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const offlineHandler = () => {
      this.offlinePaused = true
      if (this.uploadId && !this.aborted) {
        this.emitProgress('paused')
      }
    }

    const onlineHandler = () => {
      if (this.offlinePaused) {
        this.offlinePaused = false
        if (this.uploadId && !this.aborted) {
          this.emitProgress('uploading')
        }
      }
    }

    window.addEventListener('offline', offlineHandler)
    window.addEventListener('online', onlineHandler)

    try {
      await this.run(signal)
    } catch (error) {
      if (this.aborted) return
      const raw = error instanceof Error ? error.message : 'Upload failed'
      const message = friendlyUploadError(raw)
      this.emitProgress('error', message)
      this.config.onError(message)
    } finally {
      window.removeEventListener('offline', offlineHandler)
      window.removeEventListener('online', onlineHandler)
    }
  }

  async abort(): Promise<void> {
    this.aborted = true
    this.abortController?.abort()

    if (this.uploadId) {
      try {
        if (this.isAdminArtifact) {
          await api.artifacts.tourAdmin.abort(this.config.tourId)
        } else {
          await api.ingest.abort(this.config.tourId)
        }
      } catch {
        // Upload may already be finalized or gone
      }
    }

    this.emitProgress('aborted')
  }

  // ── Upload engine ───────────────────────────────────────────

  private async run(signal: AbortSignal): Promise<void> {
    const totalBytes = this.config.file.size
    this.emitProgress('creating')

    const resumeUploadId = this.config.resumeUploadId
    const resumeR2Key = this.config.resumeR2Key

    if (resumeUploadId && resumeR2Key && !this.isAdminArtifact) {
      this.uploadId = resumeUploadId
      this.partSizeBytes = DEFAULT_PART_SIZE
      this.totalParts = Math.ceil(totalBytes / this.partSizeBytes)
      await this.syncPartsFromServer(signal)
    } else {
      const initData = this.isAdminArtifact
        ? await api.artifacts.tourAdmin.initiate(this.config.tourId, {
            filename: this.config.file.name,
            fileSize: totalBytes,
            saveBackupZip: this.config.saveBackupZip === true,
          })
        : await api.ingest.initiate(this.config.tourId, {
            filename: this.config.file.name,
            fileSize: totalBytes,
            saveBackupZip: this.config.saveBackupZip === true,
          })

      this.uploadId = initData.sessionId
      this.partSizeBytes = initData.chunkSizeBytes
      this.totalParts = initData.totalChunks
    }

    this.emitProgress('uploading')
    await this.uploadAllParts(signal)

    if (this.aborted) return

    this.emitProgress('completing')
    const completeResult = this.isAdminArtifact
      ? await api.artifacts.tourAdmin.complete(this.config.tourId)
      : await api.ingest.complete(this.config.tourId)
    this.emitProgress('done')
    this.config.onComplete()

    if (completeResult.enqueued === false) {
      this.config.onError(
        'ZIP reached the Go server, but processing did not start. It will resume automatically.',
      )
    }
  }

  private async syncPartsFromServer(signal?: AbortSignal): Promise<void> {
    if (!this.uploadId) return

    signal?.throwIfAborted()

    const status = this.isAdminArtifact
      ? await api.artifacts.tourAdmin.status(this.config.tourId)
      : await api.ingest.status(this.config.tourId)
    if (status.chunkSize && status.chunkSize > 0) this.partSizeBytes = status.chunkSize
    if (status.totalChunks && status.totalChunks > 0) this.totalParts = status.totalChunks
    if (status.fileSize && status.fileSize > 0 && status.fileSize !== this.config.file.size) {
      throw new Error(
        `This ZIP is ${formatBytes(this.config.file.size)}, but the upload in progress expects ${formatBytes(status.fileSize)}. Choose the same file.`,
      )
    }
    const received = new Set(status.receivedChunks ?? [])
    this.completedParts = [...received].map((n) => ({
      PartNumber: n,
      ETag: 'ingested',
    }))

    this.uploadedBytes = 0
    for (const partNumber of received) {
      const start = (partNumber - 1) * this.partSizeBytes
      const end = Math.min(start + this.partSizeBytes, this.config.file.size)
      this.uploadedBytes += end - start
    }
    if (status.bytesReceived > this.uploadedBytes) {
      this.uploadedBytes = status.bytesReceived
    }
  }

  private async uploadAllParts(signal?: AbortSignal): Promise<void> {
    const pending = Array.from({ length: this.totalParts }, (_, i) => i + 1).filter(
      (partNumber) => !this.completedParts.some((p) => p.PartNumber === partNumber),
    )

    const worker = async (): Promise<void> => {
      while (pending.length > 0 && !this.aborted) {
        const partNumber = pending.shift()!
        await this.uploadOnePart(partNumber, signal)
      }
    }

    const workers: Promise<void>[] = []
    for (let i = 0; i < Math.min(this.concurrency, pending.length || 1); i++) {
      workers.push(worker())
    }

    await Promise.all(workers)

    if (!this.aborted && this.completedParts.length !== this.totalParts) {
      throw new Error(
        `Only ${this.completedParts.length} of ${this.totalParts} parts completed`,
      )
    }
  }

  private async uploadOnePart(
    partNumber: number,
    signal?: AbortSignal,
    attempt = 0,
  ): Promise<void> {
    if (this.aborted) return

    signal?.throwIfAborted()
    await waitForOnline(signal)

    if (this.offlinePaused) {
      this.offlinePaused = false
    }

    const start = (partNumber - 1) * this.partSizeBytes
    const end = Math.min(start + this.partSizeBytes, this.config.file.size)
    const chunk = this.config.file.slice(start, end)
    const chunkSize = end - start

    try {
      const putChunk = this.isAdminArtifact
        ? api.artifacts.tourAdmin.putChunk
        : api.ingest.putChunk
      await putChunk(
        this.config.tourId,
        this.uploadId!,
        partNumber,
        chunk,
        (loaded) => {
          this.inflightBytes.set(partNumber, loaded)
          this.emitProgress(this.retrying ? 'retrying' : 'uploading')
        },
        signal,
      )

      this.inflightBytes.delete(partNumber)
      this.completedParts.push({ PartNumber: partNumber, ETag: 'ingested' })
      this.uploadedBytes += chunkSize
      this.retrying = false
      this.emitProgress('uploading')
    } catch (error) {
      if (this.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return
      }

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (isOffline) {
        this.offlinePaused = true
        this.emitProgress('paused')
        await waitForOnline(signal)
        this.offlinePaused = false
        this.emitProgress('uploading')
        return this.uploadOnePart(partNumber, signal, attempt)
      }

      if (attempt < this.maxRetries - 1) {
        this.retrying = true
        this.emitProgress('retrying')
        const delayMs = RETRY_DELAYS_MS[Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1)]
        console.warn(
          `[uploader] Part ${partNumber} failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delayMs}ms…`,
          error,
        )
        await sleep(delayMs, signal)
        return this.uploadOnePart(partNumber, signal, attempt + 1)
      }

      throw new Error(
        `Part ${partNumber} failed after ${this.maxRetries} retries: ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  private emitProgress(status: UploadProgress['status'], error?: string): void {
    const totalBytes = this.config.file.size
    const inflight = [...this.inflightBytes.values()].reduce((sum, n) => sum + n, 0)
    const sent = Math.min(totalBytes, this.uploadedBytes + inflight)
    const now = Date.now()
    const quiet = status === 'uploading' || status === 'retrying'
    if (quiet && now - this.lastEmitAt < 150) return
    this.lastEmitAt = now
    const percentage =
      totalBytes > 0 ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 0

    this.config.onProgress({
      uploadedBytes: sent,
      totalBytes,
      percentage,
      uploadedParts: this.completedParts.length,
      totalParts: this.totalParts,
      status,
      error,
    })
  }
}

/** @deprecated Use GoIngestUploader. Kept so older imports still compile. */
export { GoIngestUploader as MultipartUploader }
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
