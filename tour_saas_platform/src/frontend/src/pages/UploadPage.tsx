import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CheckCircle2,
  Circle,
  Loader2,
  UploadCloud,
  FileArchive,
  XCircle,
  AlertTriangle,
  ServerCrash,
  Clock,
  Copy,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../services/api'
import { GoIngestUploader, formatBytes } from '../services/uploader'
import type { UploadProgress } from '../services/uploader'
import type { Tour } from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { TourSearchSelect, type TourOption } from '@/components/shared/TourSearchSelect'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  resolveUploadArtifact,
  resolveUploadTourId,
  uploadPagePath,
} from '@/lib/upload-routes'
import { resolveTourViewerUrl } from '@/lib/viewer-url'

type PageState = 'form' | 'pipeline' | 'error'

interface LocationState {
  tourId?: string
  tourName?: string
}

interface AdminPublishInfo {
  tourId: string
  artifactType: string
  publishUrl: string | null
  status: string | null
  lastSuccessAt: string | null
  lastUploadAt: string | null
  backupKey: string | null
  backupVersion: string | null
  publicDomain: string | null
}

const ADMIN_ACTIVE_STATUSES = new Set([
  'ingesting',
  'uploading',
  'uploaded',
  'processing',
  'ready_pending_backup',
  'backing_up',
  'cleanup',
])

const ADMIN_DONE_STATUSES = new Set(['ready', 'completed'])

type StepKey =
  | 'go_upload'
  | 'extract'
  | 'assets'
  | 'ready'
  | 'backup'
  | 'cleanup'

type StepUiStatus = 'pending' | 'running' | 'success' | 'failed'

interface PipelineStep {
  key: StepKey
  title: string
  description: string
  status: StepUiStatus
  detail?: string
  percent?: number | null
  elapsedMs?: number | null
  remainingMs?: number | null
}

interface ProcessorHealth {
  connected: boolean
  message: string
  hint: string | null
  detail: string | null
  latencyMs: number | null
  checkedAt: string | null
  healthUrl: string | null
}

const POLL_MS = 2000
const HEALTH_POLL_MS = 15000
/** Avoid red banner on a single transient Worker→Go probe failure. */
const FAILURES_BEFORE_DISCONNECT = 2

const R2_STATUS_LABELS: Record<string, string> = {
  creating: 'Creating upload session…',
  uploading: 'Uploading ZIP chunks to Go…',
  paused: 'Paused — waiting for network…',
  retrying: 'Retrying failed chunk…',
  completing: 'Verifying ZIP on Go…',
  done: 'ZIP received by Go',
  error: 'Upload error',
  aborted: 'Cancelled',
}

const MIN_ETA_ELAPSED_MS = 3000

const STAGE_WEIGHTS: Record<StepKey, number> = {
  go_upload: 20,
  extract: 10,
  assets: 45,
  ready: 5,
  backup: 15,
  cleanup: 5,
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '—'
  const sec = ms / 1000
  if (sec < 60) {
    const rounded = Math.round(sec)
    if (sec >= 10 || Math.abs(sec - rounded) < 0.05) return `${rounded}s`
    return `${sec.toFixed(1)}s`
  }
  const m = Math.floor(sec / 60)
  const rem = Math.round(sec % 60)
  return `${m}m ${rem}s`
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

function msBetween(
  isoStart: string | null | undefined,
  isoEnd: string | null | undefined,
): number | null {
  const start = parseIsoMs(isoStart)
  const end = parseIsoMs(isoEnd)
  if (start == null || end == null) return null
  const d = end - start
  return d >= 0 ? d : null
}

interface StageMarkers {
  assetsStartMs?: number
  finalizingStartMs?: number
}

const PIPELINE_ELAPSED_KEY = (tourId: string) => `pipeline-elapsed:${tourId}`
const PIPELINE_MARKERS_KEY = (tourId: string) => `pipeline-markers:${tourId}`

function resolveStepElapsedMs(
  key: StepKey,
  status: StepUiStatus,
  opts: {
    nowMs: number
    frozen: Partial<Record<StepKey, number>>
    markers: StageMarkers
    tour: Tour | null
    r2ElapsedMs: number | null
  },
): number | null {
  const { nowMs, frozen, markers, tour, r2ElapsedMs } = opts
  const procStartMs = parseIsoMs(tour?.processing_started_at)

  if (key === 'go_upload') {
    if (r2ElapsedMs != null) return r2ElapsedMs
    if (frozen.go_upload != null) return frozen.go_upload

    const uploadStartMs =
      parseIsoMs(tour?.upload_started_at) ?? parseIsoMs(tour?.created_at)
    const uploadEndMs = procStartMs

    if (status === 'success' || status === 'failed') {
      if (uploadStartMs != null && uploadEndMs != null) {
        return Math.max(0, uploadEndMs - uploadStartMs)
      }
      return null
    }

    if (status === 'running' && uploadStartMs != null) {
      return nowMs - uploadStartMs
    }

    return null
  }

  if (status === 'pending') return null

  if (status === 'success' || status === 'failed') {
    if (frozen[key] != null) return frozen[key]!

    if (key === 'backup') return msBetween(tour?.ready_at, tour?.backup_completed_at)
    if (key === 'cleanup') return msBetween(tour?.backup_completed_at, tour?.cleanup_completed_at)

    if (key === 'ready') {
      const readyMs = parseIsoMs(tour?.ready_at)
      if (readyMs != null && markers.finalizingStartMs != null) {
        return Math.max(0, readyMs - markers.finalizingStartMs)
      }
      return msBetween(tour?.processed_at, tour?.ready_at) ?? 0
    }

    if (key === 'extract') {
      if (procStartMs != null && markers.assetsStartMs != null) {
        return Math.max(0, markers.assetsStartMs - procStartMs)
      }
      return null
    }

    if (key === 'assets') {
      const readyMs = parseIsoMs(tour?.ready_at)
      if (markers.assetsStartMs != null && readyMs != null) {
        return Math.max(0, readyMs - markers.assetsStartMs)
      }
      if (procStartMs != null && readyMs != null) {
        return Math.max(0, readyMs - procStartMs)
      }
      return null
    }

    return null
  }

  // running
  if (key === 'extract' && procStartMs != null) return nowMs - procStartMs

  if (key === 'assets') {
    const start = markers.assetsStartMs ?? procStartMs
    if (start != null) return nowMs - start
  }

  if (key === 'ready') {
    const start = markers.finalizingStartMs
    if (start != null) return nowMs - start
  }

  if (key === 'backup') {
    const start = parseIsoMs(tour?.ready_at)
    if (start != null) return nowMs - start
  }

  if (key === 'cleanup') {
    const start = parseIsoMs(tour?.backup_completed_at)
    if (start != null) return nowMs - start
  }

  return null
}

/** ETA remaining in ms, or null when unknown. */
function etaFromRate(
  completed: number,
  total: number,
  elapsedMs: number,
  pad = 1,
): number | null {
  if (elapsedMs < MIN_ETA_ELAPSED_MS || completed <= 0 || total <= completed) return null
  const elapsedSec = elapsedMs / 1000
  const rate = completed / elapsedSec
  if (rate <= 0) return null
  const remainingSec = ((total - completed) / rate) * pad
  return Math.max(0, remainingSec * 1000)
}

function etaFromPercent(pct: number, elapsedMs: number): number | null {
  if (elapsedMs < MIN_ETA_ELAPSED_MS || pct <= 2 || pct >= 100) return null
  const elapsedSec = elapsedMs / 1000
  const totalEstimated = (elapsedSec / pct) * 100
  const remainingSec = totalEstimated - elapsedSec
  return Math.max(0, remainingSec * 1000)
}

/** Rough ETA when no granular progress (assume fraction complete). */
function etaFromElapsedRough(elapsedMs: number, assumedFractionDone = 0.35): number | null {
  if (elapsedMs < MIN_ETA_ELAPSED_MS || assumedFractionDone <= 0 || assumedFractionDone >= 1)
    return null
  const elapsedSec = elapsedMs / 1000
  const totalEstimated = elapsedSec / assumedFractionDone
  return Math.max(0, (totalEstimated - elapsedSec) * 1000)
}

function computeStageRemainingMs(
  step: Pick<PipelineStep, 'key' | 'status' | 'percent' | 'elapsedMs'>,
  ctx: {
    r2: UploadProgress | null
    currentFiles: number
    totalFiles: number
    currentBytes: number
    totalBytes: number
    stage: string | null
  },
): number | null {
  if (step.status !== 'running' || step.elapsedMs == null) return null
  const elapsed = step.elapsedMs

  switch (step.key) {
    case 'go_upload': {
      const total = ctx.r2?.totalBytes ?? 0
      const uploaded = ctx.r2?.uploadedBytes ?? 0
      if (total > uploaded && uploaded > 0) {
        return etaFromRate(uploaded, total, elapsed)
      }
      const pct = step.percent
      if (pct != null) return etaFromPercent(pct, elapsed)
      return null
    }
    case 'extract':
      return etaFromElapsedRough(elapsed, 0.4)
    case 'backup':
      return etaFromElapsedRough(elapsed, 0.4)
    case 'cleanup':
      return etaFromElapsedRough(elapsed, 0.6)
    case 'assets': {
      if (ctx.totalFiles > 0 && ctx.currentFiles > 0) {
        const pad = ctx.stage === 'uploading_assets' ? 1 : 1.1
        return etaFromRate(ctx.currentFiles, ctx.totalFiles, elapsed, pad)
      }
      if (ctx.totalBytes > 0 && ctx.currentBytes > 0) {
        return etaFromRate(ctx.currentBytes, ctx.totalBytes, elapsed)
      }
      const pct = step.percent
      if (pct != null) return etaFromPercent(pct, elapsed)
      return etaFromElapsedRough(elapsed, 0.2)
    }
    case 'ready':
      return etaFromElapsedRough(elapsed, 0.5)
    default:
      return null
  }
}

function computeOverallWeightedProgress(steps: PipelineStep[]): number {
  let total = 0
  for (const step of steps) {
    const weight = STAGE_WEIGHTS[step.key]
    if (step.status === 'success') total += weight
    else if (step.status === 'running') {
      if (step.percent != null && step.percent > 0) total += weight * (step.percent / 100)
      else total += weight * 0.35
    }
  }
  return Math.min(100, total)
}

function computeOverallRemainingMs(
  steps: PipelineStep[],
  overallElapsedMs: number,
  showEta: boolean,
): number | null {
  if (!showEta || overallElapsedMs < MIN_ETA_ELAPSED_MS) return null
  if (steps.some((s) => s.status === 'failed')) return null
  if (steps.every((s) => s.status === 'success')) return null

  const pct = computeOverallWeightedProgress(steps)
  if (pct <= 2 || pct >= 100) return null
  return etaFromPercent(pct, overallElapsedMs)
}

function shouldShowPipeline(tour: Tour): boolean {
  if (['uploading', 'ingesting', 'uploaded', 'processing', 'ready', 'completed', 'failed'].includes(tour.status)) {
    return true
  }
  return false
}

function shouldPollTour(tour: Tour): boolean {
  return ['uploading', 'ingesting', 'uploaded', 'processing', 'ready'].includes(tour.status)
}

function tourWantsBackupZip(tour: Tour | null | undefined): boolean {
  if (!tour) return false
  return tour.save_backup_zip === true || tour.save_backup_zip === 1
}

function formatZipDate(isoOrHttpDate: string | null | undefined): string {
  if (!isoOrHttpDate) return '—'
  const d = new Date(isoOrHttpDate)
  if (Number.isNaN(d.getTime())) return isoOrHttpDate
  return d.toLocaleString()
}

interface ServerIngest {
  bytesReceived: number
  fileSize: number
  totalChunks: number
  receivedChunks: number
}

/** True when the ZIP is fully on Go (or processing already started) — not a browser stall. */
function ingestZipReceived(
  tour: Tour | null | undefined,
  serverIngest: ServerIngest | null | undefined,
  r2: UploadProgress | null | undefined,
  uploadComplete?: boolean,
): boolean {
  if (uploadComplete || tour?.uploadComplete || tour?.zipOnR2) return true
  if (r2?.status === 'done' || r2?.status === 'completing') return true
  if (tour?.status && !['draft', 'ingesting', 'uploading'].includes(tour.status)) return true
  if ((tour?.progress_total_files ?? 0) > 0) return true
  const stage = tour?.processing_stage
  if (stage && stage !== 'ingesting') return true

  const total = serverIngest?.totalChunks ?? 0
  const received = serverIngest?.receivedChunks ?? 0
  if (total > 0 && received >= total) return true

  const fileSize = serverIngest?.fileSize || tour?.file_size || 0
  const bytes = serverIngest?.bytesReceived ?? 0
  if (fileSize > 0 && bytes >= fileSize) return true

  return false
}

function buildSteps(opts: {
  pageState: PageState
  r2: UploadProgress | null
  tour: Tour | null
  r2ElapsedMs: number | null
  nowMs: number
  frozenStepElapsed: Partial<Record<StepKey, number>>
  stageMarkers: StageMarkers
  pipelineError: string | null
  uploadComplete?: boolean
  serverIngest?: ServerIngest | null
  clientUploading?: boolean
  ingestPollError?: string | null
  uploadStalled?: boolean
  /** Checkbox on upload form when tour row has not loaded save_backup_zip yet. */
  saveBackupZip?: boolean
}): PipelineStep[] {
  const {
    pageState,
    r2,
    tour,
    r2ElapsedMs,
    nowMs,
    frozenStepElapsed,
    stageMarkers,
    pipelineError,
    uploadComplete,
    serverIngest,
    clientUploading,
    ingestPollError,
    uploadStalled: uploadStalledFlag,
    saveBackupZip: saveBackupZipForm,
  } = opts
  const stage = tour?.processing_stage ?? null
  const status = tour?.status

  const currentFiles = tour?.progress_current_files ?? 0
  const totalFiles = tour?.progress_total_files ?? 0
  const currentBytes = tour?.progress_current_bytes ?? 0
  const totalBytes = tour?.progress_total_bytes ?? 0

  let assetsPct: number | null = null
  if (totalFiles > 0) {
    assetsPct = Math.min(100, Math.round((currentFiles / totalFiles) * 100))
  } else if (totalBytes > 0) {
    assetsPct = Math.min(100, Math.round((currentBytes / totalBytes) * 100))
  }

  const elapsedOpts = {
    nowMs,
    frozen: frozenStepElapsed,
    markers: stageMarkers,
    tour,
    r2ElapsedMs,
  }

  const ingestDone =
    uploadComplete ||
    tour?.uploadComplete ||
    (status != null && !['draft', 'ingesting', 'uploading'].includes(status))

  const clientLive = clientUploading === true
  const uploadStalled =
    uploadStalledFlag ??
    (status === 'ingesting' &&
      !clientLive &&
      pageState !== 'form' &&
      !ingestZipReceived(tour, serverIngest, r2, uploadComplete))

  const serverTotal = serverIngest?.fileSize || tour?.file_size || 0
  const serverBytes = serverIngest?.bytesReceived ?? 0
  const serverPct =
    serverTotal > 0 ? Math.min(100, Math.round((serverBytes / serverTotal) * 100)) : 0
  const serverChunks = serverIngest?.receivedChunks ?? 0
  const serverChunkTotal = serverIngest?.totalChunks ?? 0

  let ingestStatus: StepUiStatus = 'pending'
  if (r2?.status === 'error' || r2?.status === 'aborted' || Boolean(ingestPollError && !clientLive)) {
    ingestStatus = 'failed'
  } else if (uploadStalled) ingestStatus = 'failed'
  else if (r2?.status === 'done' || ingestDone) ingestStatus = 'success'
  else if (
    r2 &&
    ['creating', 'uploading', 'paused', 'retrying', 'completing'].includes(r2.status)
  )
    ingestStatus = 'running'
  else if (status === 'ingesting' || status === 'uploading') ingestStatus = 'running'

  const afterIngest = ingestStatus === 'success'
  const failed = status === 'failed' || pageState === 'error'
  const live = status === 'ready' || status === 'completed'
  const finished = status === 'completed' || Boolean(tour?.cleanup_completed_at)
  const backedUp = Boolean(tour?.backup_completed_at) || finished

  function stageStatus(match: boolean, doneWhen: boolean): StepUiStatus {
    if (!afterIngest) return 'pending'
    if (failed && match) return 'failed'
    if (failed && !doneWhen && !match) return 'pending'
    if (doneWhen) return 'success'
    if (match) return 'running'
    return 'pending'
  }

  const isExtracting = stage === 'extracting' || stage === 'queued'
  const isPublishing =
    stage === 'publishing' ||
    stage === 'uploading_assets' ||
    (status === 'processing' && totalFiles > 0)
  const isFinalizing = stage === 'finalizing' || stage === 'ready_pending_backup'

  const extractDone = live || isPublishing || isFinalizing || backedUp
  const assetsDone = live || isFinalizing || backedUp

  const extractStatus = stageStatus(isExtracting && !isPublishing, extractDone)
  const assetsStatus = stageStatus(isPublishing, assetsDone)

  let readyStatus: StepUiStatus = 'pending'
  if (live) readyStatus = 'success'
  else if (failed && afterIngest && !isExtracting && !isPublishing) readyStatus = 'failed'
  else if (isFinalizing) readyStatus = 'running'

  const wantsBackup =
    tour != null && tour.save_backup_zip != null && tour.save_backup_zip !== undefined
      ? tourWantsBackupZip(tour)
      : saveBackupZipForm === true

  let backupStatus: StepUiStatus = 'pending'
  if (!wantsBackup) {
    if (live || finished || stage === 'cleanup') backupStatus = 'success'
    else if (afterIngest && isFinalizing) backupStatus = 'success'
  } else if (!live && !backedUp) backupStatus = 'pending'
  else if (backedUp) backupStatus = 'success'
  else if (stage === 'backing_up') backupStatus = 'running'
  else if (live) backupStatus = 'running'

  let cleanupStatus: StepUiStatus = 'pending'
  if (finished) cleanupStatus = 'success'
  else if (stage === 'cleanup') cleanupStatus = 'running'
  else if (wantsBackup && backedUp) cleanupStatus = 'running'
  else if (!wantsBackup && live) cleanupStatus = 'running'

  const etaCtx = {
    r2,
    currentFiles,
    totalFiles,
    currentBytes,
    totalBytes,
    stage,
  }

  const steps: PipelineStep[] = [
    {
      key: 'go_upload',
      title: 'Upload ZIP to Go',
      description: 'Chunked upload through the Worker to the Go processor',
      status: ingestStatus,
      percent:
        r2?.percentage ??
        (ingestStatus === 'success' ? 100 : ingestStatus === 'pending' ? null : serverPct),
      elapsedMs: resolveStepElapsedMs('go_upload', ingestStatus, elapsedOpts),
      detail:
        ingestStatus === 'failed'
          ? uploadStalled
            ? `${formatBytes(serverBytes)} / ${formatBytes(serverTotal || 0)} received${serverChunkTotal > 0 ? ` · ${serverChunks}/${serverChunkTotal} chunks` : ''}`
            : r2?.error ?? ingestPollError ?? pipelineError ?? 'Upload failed'
          : r2
            ? `${formatBytes(r2.uploadedBytes)} / ${formatBytes(r2.totalBytes)} · ${r2.uploadedParts}/${r2.totalParts} chunks · ${R2_STATUS_LABELS[r2.status] ?? r2.status}`
            : serverIngest && ingestStatus === 'running'
              ? `${formatBytes(serverBytes)} / ${formatBytes(serverTotal)} · ${serverChunks}/${serverChunkTotal} chunks`
            : ingestDone
              ? `ZIP received by Go${tour?.original_filename ? ` · ${tour.original_filename}` : ''}`
              : undefined,
    },
    {
      key: 'extract',
      title: 'Extract ZIP',
      description: 'Open archive, analyze files, prepare upload tasks',
      status: extractStatus,
      elapsedMs: resolveStepElapsedMs('extract', extractStatus, elapsedOpts),
      detail:
        extractStatus === 'running'
          ? 'Analyzing archive contents…'
          : extractStatus === 'success' && totalFiles > 0
            ? `${totalFiles.toLocaleString()} files · ${formatBytes(totalBytes)}`
            : undefined,
    },
    {
      key: 'assets',
      title: 'Publish assets to R2',
      description: 'Merge overlay — only files inside this ZIP are written to {tourId}/ on R2',
      status: assetsStatus,
      percent: assetsStatus === 'pending' ? null : assetsPct,
      elapsedMs: resolveStepElapsedMs('assets', assetsStatus, elapsedOpts),
      detail:
        assetsStatus === 'failed'
          ? tour?.processing_error ?? pipelineError ?? undefined
          : totalFiles > 0
            ? `${currentFiles.toLocaleString()} / ${totalFiles.toLocaleString()} files · ${formatBytes(currentBytes)} / ${formatBytes(totalBytes)}`
            : assetsStatus === 'running'
              ? 'Starting asset uploads…'
              : undefined,
    },
    {
      key: 'ready',
      title: live ? 'Tour ready' : failed ? 'Tour failed' : 'Tour ready',
      description: live
        ? 'Viewer URL is available'
        : failed
          ? 'Processing stopped with an error'
          : 'Finalizing viewer URL after asset uploads',
      status: readyStatus,
      elapsedMs: resolveStepElapsedMs('ready', readyStatus, elapsedOpts),
      detail:
        live && tour?.viewer_url
          ? tour.viewer_url
          : failed
            ? tour?.processing_error ?? pipelineError ?? 'Processing failed'
            : isFinalizing
              ? 'Building viewer URL…'
              : undefined,
    },
    {
      key: 'backup',
      title: 'Backup ZIP to R2',
      description: 'Stores a timestamped copy under backup_zip/ after the tour is live',
      status: backupStatus,
      elapsedMs: resolveStepElapsedMs('backup', backupStatus, elapsedOpts),
      detail: backedUp
        ? 'Backup verified'
        : backupStatus === 'running'
          ? 'Uploading backup ZIP…'
          : undefined,
    },
    {
      key: 'cleanup',
      title: 'Cleanup complete',
      description: wantsBackup
        ? 'Go deletes the temp ZIP only after the backup is verified'
        : 'Go deletes the temp ZIP on the processor after publish (always runs)',
      status: cleanupStatus,
      elapsedMs: resolveStepElapsedMs('cleanup', cleanupStatus, elapsedOpts),
      detail: finished
        ? 'Temp files removed'
        : cleanupStatus === 'running'
          ? wantsBackup
            ? 'Verifying backup, then deleting temp files…'
            : 'Removing temp ZIP and ingest files…'
          : undefined,
    },
  ]

  const visibleSteps = wantsBackup ? steps : steps.filter((step) => step.key !== 'backup')

  return visibleSteps.map((step) => ({
    ...step,
    remainingMs: computeStageRemainingMs(step, etaCtx),
  }))
}

function StepIcon({ status }: { status: StepUiStatus }) {
  if (status === 'success') return <CheckCircle2 className="size-5 text-success" />
  if (status === 'failed') return <XCircle className="size-5 text-destructive" />
  if (status === 'running') return <Loader2 className="size-5 animate-spin text-primary" />
  return <Circle className="size-5 text-muted-foreground/50" />
}

export function UploadPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { tourId: pathTourId } = useParams<{ tourId?: string }>()
  const [searchParams] = useSearchParams()
  const locationState = location.state as LocationState | null
  const urlTourId = resolveUploadTourId(
    pathTourId,
    searchParams.get('tour'),
    locationState?.tourId,
  )
  const uploadArtifact = resolveUploadArtifact(searchParams.get('artifact'))
  const isAdminArtifact = uploadArtifact === 'tour_admin'

  const [tours, setTours] = useState<TourOption[]>([])
  const [loadingTours, setLoadingTours] = useState(true)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pageState, setPageState] = useState<PageState>('form')
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [serverIngest, setServerIngest] = useState<ServerIngest | null>(null)
  const [ingestPollError, setIngestPollError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [tourId, setTourId] = useState<string | null>(urlTourId)
  const [tour, setTour] = useState<Tour | null>(null)
  const [health, setHealth] = useState<ProcessorHealth | null>(null)
  const [healthChecking, setHealthChecking] = useState(true)
  const [failureStreak, setFailureStreak] = useState(0)
  const [pipelineStartedAt, setPipelineStartedAt] = useState<number | null>(null)
  const [r2StartedAt, setR2StartedAt] = useState<number | null>(null)
  const [r2FinishedAt, setR2FinishedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [frozenStepElapsed, setFrozenStepElapsed] = useState<Partial<Record<StepKey, number>>>({})
  const [showReupload, setShowReupload] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [loadingTour, setLoadingTour] = useState(false)
  const [saveBackupZip, setSaveBackupZip] = useState(false)
  const [adminPublishInfo, setAdminPublishInfo] = useState<AdminPublishInfo | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploaderRef = useRef<GoIngestUploader | null>(null)
  const pollRef = useRef<number | null>(null)
  const pageStateRef = useRef(pageState)
  const progressRef = useRef(progress)
  const stageMarkersRef = useRef<StageMarkers>({})
  const frozenStepElapsedRef = useRef<Partial<Record<StepKey, number>>>({})

  useEffect(() => {
    pageStateRef.current = pageState
  }, [pageState])

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  const refreshHealth = useCallback(async (opts?: { manual?: boolean }): Promise<boolean> => {
    try {
      const result = await api.tours.processorStatus()
      const connected = result.online
      setHealth({
        connected,
        message: connected
          ? 'Upload worker server (Go) is connected'
          : 'Upload worker server (Go) is not connected',
        hint: connected
          ? null
          : 'Start tour_processor so it listens on PROCESSOR_WEBHOOK_URL (default http://127.0.0.1:9000), then refresh this page.',
        detail: result.error,
        latencyMs: result.latencyMs,
        checkedAt: result.checkedAt,
        healthUrl: result.healthUrl,
      })
      if (connected) {
        setFailureStreak(0)
      } else if (opts?.manual) {
        setFailureStreak(FAILURES_BEFORE_DISCONNECT)
      } else {
        setFailureStreak((prev) => prev + 1)
      }
      if (!connected && result.error) {
        console.warn('[upload] processor health:', result.error)
      }
      return connected
    } catch (err) {
      console.warn('[upload] processor health check failed', err)
      const detail = err instanceof Error ? err.message : String(err)
      setHealth({
        connected: false,
        message: 'Upload worker server (Go) is not connected',
        hint: 'Could not reach the health check. Confirm the Worker is running and tour_processor is up.',
        detail,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        healthUrl: null,
      })
      if (opts?.manual) {
        setFailureStreak(FAILURES_BEFORE_DISCONNECT)
      } else {
        setFailureStreak((prev) => prev + 1)
      }
      return false
    } finally {
      setHealthChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshHealth()
    const id = window.setInterval(() => void refreshHealth(), HEALTH_POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshHealth])

  useEffect(() => {
    let cancelled = false
    setLoadingTours(true)
    void api.tours
      .list()
      .then((items) => {
        if (cancelled) return
        setTours(
          items
            .map((item) => ({ id: item.tour_id, name: item.name, status: item.status }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[upload] failed to load tours list', err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTours(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (pageState !== 'pipeline') return
    if (tour?.status === 'completed' || tour?.status === 'failed') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [pageState, tour?.status])

  useEffect(() => {
    const endMs = parseIsoMs(tour?.cleanup_completed_at)
    if (endMs != null) setNow(endMs)
  }, [tour?.cleanup_completed_at])

  useEffect(() => {
    if (!tourId) return
    try {
      const storedElapsed = sessionStorage.getItem(PIPELINE_ELAPSED_KEY(tourId))
      const storedMarkers = sessionStorage.getItem(PIPELINE_MARKERS_KEY(tourId))
      if (storedElapsed) {
        const parsed = JSON.parse(storedElapsed) as Partial<Record<StepKey, number>>
        frozenStepElapsedRef.current = parsed
        setFrozenStepElapsed(parsed)
      }
      if (storedMarkers) {
        stageMarkersRef.current = JSON.parse(storedMarkers) as StageMarkers
      }
    } catch {
      // ignore corrupt session storage
    }
  }, [tourId])

  useEffect(() => {
    if (!tour) return

    const stage = tour.processing_stage
    const procStartMs = parseIsoMs(tour.processing_started_at)
    const readyMs = parseIsoMs(tour.ready_at)
    const backupMs = parseIsoMs(tour.backup_completed_at)
    const cleanupMs = parseIsoMs(tour.cleanup_completed_at)

    const markers = { ...stageMarkersRef.current }
    const frozen = { ...frozenStepElapsedRef.current }
    let dirty = false

    const isPublishing =
      stage === 'publishing' ||
      stage === 'uploading_assets' ||
      (tour.status === 'processing' && (tour.progress_total_files ?? 0) > 0)

    if (isPublishing && markers.assetsStartMs == null) {
      markers.assetsStartMs = Date.now()
      dirty = true
      if (procStartMs != null && frozen.extract == null) {
        frozen.extract = Math.max(0, markers.assetsStartMs - procStartMs)
        dirty = true
      }
    }

    const isFinalizing = stage === 'finalizing' || stage === 'ready_pending_backup'
    if (isFinalizing && markers.finalizingStartMs == null) {
      markers.finalizingStartMs = Date.now()
      dirty = true
    }

    if (readyMs != null) {
      if (frozen.extract == null && procStartMs != null && markers.assetsStartMs != null) {
        frozen.extract = Math.max(0, markers.assetsStartMs - procStartMs)
        dirty = true
      }
      if (frozen.assets == null) {
        if (markers.assetsStartMs != null) {
          frozen.assets = Math.max(0, readyMs - markers.assetsStartMs)
          dirty = true
        } else if (procStartMs != null) {
          // Reload without live markers — total processing time on assets step.
          frozen.assets = Math.max(0, readyMs - procStartMs)
          dirty = true
        }
      }
      if (frozen.ready == null) {
        const finStart = markers.finalizingStartMs ?? readyMs
        frozen.ready = Math.max(0, readyMs - finStart)
        dirty = true
      }
    }

    if (backupMs != null && frozen.backup == null) {
      const backupElapsed = msBetween(tour.ready_at, tour.backup_completed_at)
      if (backupElapsed != null) {
        frozen.backup = backupElapsed
        dirty = true
      }
    }

    if (cleanupMs != null && frozen.cleanup == null) {
      const cleanupElapsed = msBetween(tour.backup_completed_at, tour.cleanup_completed_at)
      if (cleanupElapsed != null) {
        frozen.cleanup = cleanupElapsed
        dirty = true
      }
    }

    if (frozen.go_upload == null && procStartMs != null) {
      const uploadStartMs =
        parseIsoMs(tour.upload_started_at) ?? parseIsoMs(tour.created_at)
      if (uploadStartMs != null) {
        frozen.go_upload = Math.max(0, procStartMs - uploadStartMs)
        dirty = true
      }
    }

    if (dirty) {
      stageMarkersRef.current = markers
      frozenStepElapsedRef.current = frozen
      setFrozenStepElapsed(frozen)
      if (tourId) {
        try {
          sessionStorage.setItem(PIPELINE_MARKERS_KEY(tourId), JSON.stringify(markers))
          sessionStorage.setItem(PIPELINE_ELAPSED_KEY(tourId), JSON.stringify(frozen))
        } catch {
          // ignore quota errors
        }
      }
    }
  }, [tour, tourId])

  useEffect(() => {
    if (r2StartedAt == null || r2FinishedAt == null) return
    if (frozenStepElapsedRef.current.go_upload != null) return
    const elapsed = Math.max(0, r2FinishedAt - r2StartedAt)
    const frozen = { ...frozenStepElapsedRef.current, go_upload: elapsed }
    frozenStepElapsedRef.current = frozen
    setFrozenStepElapsed(frozen)
    if (tourId) {
      try {
        sessionStorage.setItem(PIPELINE_ELAPSED_KEY(tourId), JSON.stringify(frozen))
      } catch {
        // ignore quota errors
      }
    }
  }, [r2StartedAt, r2FinishedAt, tourId])

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      const tick = async () => {
        try {
          const next = await api.tours.get(id)
          setTour(next)
          setSaveBackupZip(tourWantsBackupZip(next))
          if (next.status === 'ingesting') {
            try {
              const ingest = await api.ingest.status(id)
              setServerIngest({
                bytesReceived: ingest.bytesReceived ?? 0,
                fileSize: ingest.fileSize ?? next.file_size ?? 0,
                totalChunks: ingest.totalChunks ?? 0,
                receivedChunks: ingest.receivedChunks?.length ?? 0,
              })
              setIngestPollError(null)
            } catch (err) {
              setIngestPollError(err instanceof Error ? err.message : 'Could not read upload progress')
            }
          }
          if (next.status === 'completed' || next.status === 'failed') {
            stopPolling()
            if (next.status === 'failed') {
              setErrorMessage(
                next.processing_error ??
                  'Processing failed. Check that tour_processor is running and try again.',
              )
              setPageState('error')
            }
          }
        } catch (err) {
          console.warn('[upload] tour poll failed', err)
        }
      }
      void tick()
      pollRef.current = window.setInterval(() => void tick(), POLL_MS)
    },
    [stopPolling],
  )

  useEffect(() => () => stopPolling(), [stopPolling])

  // Keep URL in sync so refresh / deep link restores pipeline state.
  useEffect(() => {
    if (!tourId) return
    const current = resolveUploadTourId(pathTourId, searchParams.get('tour'), null)
    const currentArtifact = resolveUploadArtifact(searchParams.get('artifact'))
    if (current === tourId && currentArtifact === uploadArtifact) return
    navigate(
      uploadPagePath(tourId, isAdminArtifact ? { artifact: 'tour_admin' } : undefined),
      {
        replace: true,
        state: locationState ?? { tourId, tourName: tour?.name },
      },
    )
  }, [
    tourId,
    pathTourId,
    searchParams,
    navigate,
    locationState,
    tour?.name,
    uploadArtifact,
    isAdminArtifact,
  ])

  // Load existing tour from URL or Tours list navigation (resume / reload).
  useEffect(() => {
    const id = urlTourId
    if (!id) return

    let cancelled = false
    setLoadingTour(true)
    if (isAdminArtifact) setAdminPublishInfo(null)

    void api.tours
      .get(id)
      .then(async (fetched) => {
        if (cancelled) return
        setTour(fetched)
        setSaveBackupZip(tourWantsBackupZip(fetched))
        setTourId(id)
        setTours((current) => {
          const next = current.filter((item) => item.id !== fetched.tour_id)
          next.push({ id: fetched.tour_id, name: fetched.name, status: fetched.status })
          return next.sort((a, b) => a.name.localeCompare(b.name))
        })

        const activeClientUpload =
          pageStateRef.current === 'pipeline' &&
          (uploaderRef.current != null ||
            (progressRef.current != null &&
              !['done', 'error', 'aborted'].includes(progressRef.current.status)))

        if (activeClientUpload) {
          return
        }

        // Admin package uses tour_artifacts — never inherit viewer ZIP / tours.status pipeline.
        if (isAdminArtifact) {
          try {
            const info = await api.artifacts.tourAdmin.publishInfo(id)
            if (cancelled) return
            setAdminPublishInfo(info)
            const adminStatus = info.status ?? null
            if (adminStatus && ADMIN_ACTIVE_STATUSES.has(adminStatus)) {
              setPageState(adminStatus === 'failed' ? 'error' : 'pipeline')
              setPipelineStartedAt(Date.now())
              setErrorMessage(null)
            } else if (adminStatus === 'failed') {
              setPageState('form')
              setErrorMessage('Admin package processing failed. Upload a new ZIP to retry.')
            } else {
              // No admin upload yet (or already published) → fresh upload form.
              setPageState('form')
              setErrorMessage(null)
              setShowReupload(false)
              setProgress(null)
              setR2FinishedAt(null)
              setPipelineStartedAt(null)
            }
          } catch (err) {
            if (cancelled) return
            console.warn('[upload] failed to load admin publish info', err)
            setAdminPublishInfo(null)
            setPageState('form')
            setErrorMessage(null)
          }
          return
        }

        const zipDone = fetched.uploadComplete ?? fetched.zipOnR2 ?? false
        const startedAt = fetched.processing_started_at
          ? new Date(fetched.processing_started_at).getTime()
          : new Date(fetched.created_at).getTime()

        if (shouldShowPipeline(fetched)) {
          setPageState(fetched.status === 'failed' ? 'error' : 'pipeline')
          if (zipDone || fetched.status !== 'uploading') {
            setR2FinishedAt(Date.now())
          }
          setPipelineStartedAt(startedAt)

          if (shouldPollTour(fetched)) {
            startPolling(id)
          }

          if (fetched.status === 'ingesting') {
            setErrorMessage(null)
          } else if (fetched.status === 'failed') {
            setErrorMessage(
              fetched.processing_error ??
                (fetched.canResumeProcessing
                  ? 'Processing failed. Resume to retry from the server without re-uploading the ZIP.'
                  : zipDone
                    ? 'Processing failed.'
                    : 'Upload incomplete — select a ZIP and upload again.'),
            )
          } else if (fetched.status === 'uploading' && fetched.upload_id && !zipDone) {
            setErrorMessage(
              'Multipart upload in progress. Re-select the same ZIP and click Start Upload to resume, or wait for the other session to finish.',
            )
          }
        } else if (fetched.status === 'draft') {
          setPageState('form')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[upload] failed to load tour', err)
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load tour')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTour(false)
      })

    return () => {
      cancelled = true
    }
  }, [urlTourId, startPolling, isAdminArtifact])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file && !file.name.toLowerCase().endsWith('.zip')) {
      setErrorMessage('Only ZIP files are allowed.')
      setSelectedFile(null)
      return
    }
    setErrorMessage(null)
    setSelectedFile(file)
  }

  const handleResumeProcessing = async () => {
    const id = tourId ?? urlTourId
    if (!id) return

    setHealthChecking(true)
    const online = await refreshHealth({ manual: true })
    if (!online) return

    setPageState('pipeline')
    setErrorMessage(null)
    setResuming(true)
    const started = pipelineStartedAt ?? Date.now()
    if (!pipelineStartedAt) setPipelineStartedAt(started)
    if (!r2FinishedAt) setR2FinishedAt(Date.now())

    try {
      const result = await api.tours.resume(id)
      if (result.tour) {
        setTour(result.tour)
        if (result.tour.status === 'completed' || result.tour.status === 'ready') {
          stopPolling()
        } else if (result.tour.status === 'failed') {
          setErrorMessage(
            result.tour.processing_error ??
              result.action.detail ??
              'Processing failed. Check tour_processor and try Resume again.',
          )
          setPageState('error')
          stopPolling()
        } else {
          startPolling(id)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resume processing'
      setErrorMessage(msg)
      setPageState('error')
    } finally {
      setResuming(false)
      setHealthChecking(false)
    }
  }

  const handleTourSelect = (id: string) => {
    if (!id || id === tourId) return
    setErrorMessage(null)
    setTourId(id)
    setAdminPublishInfo(null)
    navigate(uploadPagePath(id, isAdminArtifact ? { artifact: 'tour_admin' } : undefined), {
      replace: true,
      state: { tourId: id, tourName: tours.find((item) => item.id === id)?.name },
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const id = urlTourId ?? tourId
    if (!id) {
      setErrorMessage('Select a tour before uploading. Create one first if you have none.')
      return
    }
    if (!selectedFile) return

    // Fresh health check before starting — treat failure as immediate (not debounced).
    setHealthChecking(true)
    const online = await refreshHealth({ manual: true })
    if (!online) return

    setPageState('pipeline')
    setErrorMessage(null)
    setTour(null)
    setProgress(null)
    const started = Date.now()
    setPipelineStartedAt(started)
    setR2StartedAt(started)
    setR2FinishedAt(null)

    try {
      setTourId(id)

      const resumeSession =
        tour?.status === 'ingesting' && tour.upload_session_id ? tour.upload_session_id : null

      const uploader = new GoIngestUploader({
        tourId: id,
        file: selectedFile,
        artifactType: uploadArtifact,
        saveBackupZip,
        forceReupload:
          !isAdminArtifact &&
          showReupload &&
          (tour?.uploadComplete ?? tour?.zipOnR2 ?? false),
        resumeUploadId: isAdminArtifact
          ? undefined
          : (resumeSession ?? tour?.upload_id ?? undefined),
        resumeR2Key: isAdminArtifact ? undefined : (resumeSession ?? tour?.r2_key ?? undefined),
        onProgress: (p) => setProgress(p),
        onComplete: () => {
          setR2FinishedAt(Date.now())
          if (isAdminArtifact) {
            void (async () => {
              // Poll publish-info until ready/completed (does not touch tours.status).
              for (let i = 0; i < 90; i++) {
                try {
                  const info = await api.artifacts.tourAdmin.publishInfo(id!)
                  setAdminPublishInfo(info)
                  if (info.status === 'completed' || info.status === 'ready') {
                    setErrorMessage(null)
                    toast.success(
                      info.publishUrl
                        ? `Admin package ready: ${info.publishUrl}`
                        : 'Admin package published',
                    )
                    return
                  }
                  if (info.status === 'failed') {
                    setErrorMessage('Admin package processing failed')
                    setPageState('error')
                    return
                  }
                } catch {
                  /* keep polling */
                }
                await new Promise((r) => setTimeout(r, 2000))
              }
            })()
          } else {
            startPolling(id!)
          }
        },
        onError: (msg) => {
          console.error('[upload] pipeline error', msg)
          const friendly =
            msg.toLowerCase().includes('not connected') ||
            msg.toLowerCase().includes('processor')
              ? msg
              : msg
          setErrorMessage(friendly)
          setPageState('error')
          stopPolling()
          void refreshHealth()
        },
      })

      uploaderRef.current = uploader
      await uploader.start()
      // If complete succeeded, MultipartUploader already called onComplete.
      // If processor dispatch failed, onError was called with PROCESSOR_UNAVAILABLE message.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start upload'
      console.error('[upload] start failed', err)
      setErrorMessage(msg)
      setPageState('error')
      void refreshHealth()
    }
  }

  const handleAbort = async () => {
    if (uploaderRef.current) {
      await uploaderRef.current.abort()
    }
    stopPolling()
    setPageState('error')
    setErrorMessage('Upload cancelled.')
  }

  const clearPipelineTiming = (id: string | null) => {
    if (!id) return
    sessionStorage.removeItem(PIPELINE_ELAPSED_KEY(id))
    sessionStorage.removeItem(PIPELINE_MARKERS_KEY(id))
  }

  const handleReset = () => {
    stopPolling()
    setPageState('form')
    setProgress(null)
    setErrorMessage(null)
    setSelectedFile(null)
    setTour(null)
    setTourId(urlTourId)
    setAdminPublishInfo(null)
    setPipelineStartedAt(null)
    setR2StartedAt(null)
    setR2FinishedAt(null)
    setFrozenStepElapsed({})
    frozenStepElapsedRef.current = {}
    stageMarkersRef.current = {}
    clearPipelineTiming(tourId)
    setShowReupload(false)
    setResuming(false)
    uploaderRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleNewTour = () => {
    stopPolling()
    setPageState('form')
    setProgress(null)
    setErrorMessage(null)
    setSelectedFile(null)
    setTour(null)
    setTourId(null)
    setAdminPublishInfo(null)
    setPipelineStartedAt(null)
    setR2StartedAt(null)
    setR2FinishedAt(null)
    setFrozenStepElapsed({})
    frozenStepElapsedRef.current = {}
    stageMarkersRef.current = {}
    clearPipelineTiming(tourId)
    clearPipelineTiming(urlTourId)
    setShowReupload(false)
    setResuming(false)
    uploaderRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    navigate(uploadPagePath(null, isAdminArtifact ? { artifact: 'tour_admin' } : undefined), {
      replace: true,
    })
  }

  const r2ElapsedMs =
    r2StartedAt == null
      ? null
      : (r2FinishedAt ?? (progress && progress.status !== 'done' ? now : r2FinishedAt ?? now)) -
        r2StartedAt

  const pipelineEndMs =
    parseIsoMs(tour?.cleanup_completed_at) ??
    (tour?.status === 'failed' ? parseIsoMs(tour.updated_at) : null)

  const clockMs = pipelineEndMs ?? now

  const pipelineStartMs =
    pipelineStartedAt ??
    parseIsoMs(tour?.created_at) ??
    r2StartedAt

  const overallElapsedMs =
    pipelineStartMs != null ? Math.max(0, clockMs - pipelineStartMs) : 0

  // Admin ZIP is separate from viewer tour ZIP — never treat tours.zipOnR2 as admin done.
  const uploadComplete = isAdminArtifact
    ? false
    : (tour?.uploadComplete ?? tour?.zipOnR2 ?? false)
  const canResume =
    !isAdminArtifact &&
    (tour?.canResumeProcessing ?? uploadComplete) &&
    tour?.status !== 'ready' &&
    !tour?.upload_id

  const clientUploading =
    progress != null && !['done', 'error', 'aborted', 'idle'].includes(progress.status)
  const zipOnGo = isAdminArtifact
    ? progress?.status === 'done' || progress?.status === 'completing'
    : ingestZipReceived(tour, serverIngest, progress, uploadComplete)
  const uploadStalled =
    pageState === 'pipeline' &&
    !isAdminArtifact &&
    tour?.status === 'ingesting' &&
    !clientUploading &&
    !errorMessage &&
    progress?.status !== 'error' &&
    !zipOnGo

  const selectedTourId = urlTourId ?? tourId
  const adminStatus = adminPublishInfo?.status ?? null
  const adminLive =
    isAdminArtifact && adminStatus != null && ADMIN_DONE_STATUSES.has(adminStatus)
  const liveTour = isAdminArtifact
    ? adminLive
    : tour?.status === 'ready' || tour?.status === 'completed'
  const pipelineDone = isAdminArtifact
    ? adminLive
    : tour?.status === 'completed'

  const pipelineTour: Tour | null =
    isAdminArtifact && adminLive
      ? ({
          ...(tour ?? ({ tour_id: selectedTourId ?? '', name: '', status: 'completed' } as Tour)),
          status: 'completed',
          processing_stage: 'completed',
          cleanup_completed_at:
            adminPublishInfo?.lastSuccessAt ?? tour?.cleanup_completed_at ?? new Date().toISOString(),
          ready_at: adminPublishInfo?.lastSuccessAt ?? tour?.ready_at ?? null,
          viewer_url: adminPublishInfo?.publishUrl ?? null,
          uploadComplete: true,
          zipOnR2: true,
        } as Tour)
      : isAdminArtifact
        ? // Keep tour name/id for display, but strip viewer pipeline signals from step builder.
          tour
          ? ({
              ...tour,
              status: zipOnGo || pageState === 'pipeline' ? 'processing' : 'draft',
              processing_stage:
                zipOnGo || pageState === 'pipeline'
                  ? (adminStatus && ADMIN_ACTIVE_STATUSES.has(adminStatus)
                      ? adminStatus
                      : 'publishing')
                  : null,
              uploadComplete: false,
              zipOnR2: false,
              canResumeProcessing: false,
              progress_total_files: null,
              progress_current_files: null,
              progress_total_bytes: null,
              progress_current_bytes: null,
              ready_at: null,
              backup_completed_at: null,
              cleanup_completed_at: null,
              viewer_url: adminPublishInfo?.publishUrl ?? null,
              processing_error: null,
            } as Tour)
          : null
        : tour

  const steps = buildSteps({
    pageState,
    r2: progress,
    tour: pipelineTour,
    r2ElapsedMs,
    nowMs: clockMs,
    frozenStepElapsed,
    stageMarkers: stageMarkersRef.current,
    pipelineError: errorMessage,
    uploadComplete: isAdminArtifact ? zipOnGo || adminLive : uploadComplete,
    serverIngest: isAdminArtifact ? null : serverIngest,
    clientUploading,
    ingestPollError,
    uploadStalled,
    saveBackupZip,
  })

  const processorDown =
    health != null &&
    !health.connected &&
    failureStreak >= FAILURES_BEFORE_DISCONNECT
  const showCheckingBanner = healthChecking && (!health || processorDown)
  const showDisconnectedBanner = processorDown && !healthChecking
  const needsNewUpload = !uploadComplete || showReupload
  const canStart =
    !!selectedFile &&
    !!selectedTourId &&
    (pageState === 'form' || uploadStalled) &&
    !processorDown &&
    needsNewUpload &&
    !clientUploading &&
    !loadingTours &&
    !loadingTour

  const selectedTourMeta = selectedTourId
    ? tours.find((item) => item.id === selectedTourId)
    : undefined
  const displayTourName =
    tour?.name ?? selectedTourMeta?.name ?? locationState?.tourName ?? null
  const displayTourStatus = isAdminArtifact
    ? (adminStatus as Tour['status'] | null) ?? null
    : (tour?.status ?? selectedTourMeta?.status)
  const tourViewerUrl = isAdminArtifact
    ? adminPublishInfo?.publishUrl ??
      (selectedTourId && adminPublishInfo?.publicDomain
        ? `https://${adminPublishInfo.publicDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/${selectedTourId}/`
        : null)
    : selectedTourId
      ? resolveTourViewerUrl(selectedTourId, tour?.viewer_url)
      : null
  const tourUrlIsLive = isAdminArtifact
    ? adminLive && !!tourViewerUrl
    : liveTour && !!tour?.viewer_url

  async function copyTourUrl() {
    if (!tourViewerUrl) return
    try {
      await navigator.clipboard.writeText(tourViewerUrl)
      toast.success(isAdminArtifact ? 'Admin URL copied' : 'Tour URL copied')
    } catch {
      toast.error('Could not copy URL')
    }
  }

  const showOverallEta =
    pageState === 'pipeline' &&
    !pipelineDone &&
    (isAdminArtifact ? adminStatus !== 'failed' : tour?.status !== 'failed') &&
    progress?.status !== 'error' &&
    progress?.status !== 'aborted'

  const overallRemainingMs = computeOverallRemainingMs(steps, overallElapsedMs, showOverallEta)

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title={isAdminArtifact ? 'Upload Admin Package' : 'Upload Tour'}
        description={
          isAdminArtifact
            ? 'Upload the tour-admin ZIP package for this tour. Stored in a separate R2 bucket; does not change tour viewer status.'
            : 'Select an existing tour, then upload its ZIP. Tours must be created first — the upload uses the tour id as the storage folder.'
        }
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Tours', href: '/tours' },
          { label: isAdminArtifact ? 'Admin package' : 'Upload' },
        ]}
      />

      {(showCheckingBanner || showDisconnectedBanner) && (
        <div
          role="alert"
          className={cn(
            'flex gap-3 rounded-lg border px-4 py-3 text-sm',
            showDisconnectedBanner
              ? 'border-destructive/40 bg-destructive-subtle text-destructive'
              : 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          <ServerCrash className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">
              {showCheckingBanner
                ? 'Checking upload worker server…'
                : health?.message ?? 'Upload worker server (Go) is not connected'}
            </p>
            {showDisconnectedBanner && (
              <>
                <p className="text-destructive/90">
                  {health?.hint ??
                    'Start tour_processor (default http://127.0.0.1:9000), then refresh.'}
                </p>
                {health?.detail && (
                  <p className="break-all text-xs text-destructive/80">{health.detail}</p>
                )}
                {health?.checkedAt && (
                  <p className="text-xs text-destructive/70">
                    Last checked {new Date(health.checkedAt).toLocaleString()}
                    {health.latencyMs != null ? ` · ${health.latencyMs}ms` : ''}
                    {health.healthUrl ? ` · ${health.healthUrl}` : ''}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  disabled={healthChecking}
                  onClick={() => {
                    setHealthChecking(true)
                    void refreshHealth({ manual: true })
                  }}
                >
                  {healthChecking ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    'Recheck connection'
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tour package</CardTitle>
            <CardDescription>
              Pick a tour you already created, then upload its ZIP. Files are stored under the 6-digit tour ID.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorMessage && pageState === 'form' && (
              <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2.5 text-sm text-destructive">
                <div className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Upload pipeline error</p>
                    <p className="mt-0.5">{errorMessage}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={handleReset}>
                  Try again
                </Button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tourSelect">Select tour</Label>
                {loadingTours ? (
                  <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading tours…
                  </div>
                ) : tours.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-sm">
                    <p className="text-muted-foreground">No tours yet. Create a tour before uploading a ZIP.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-2" asChild>
                      <Link to="/tours/new">Create tour</Link>
                    </Button>
                  </div>
                ) : (
                  <TourSearchSelect
                    value={selectedTourId ?? ''}
                    onValueChange={handleTourSelect}
                    tours={tours}
                    disabled={pageState === 'pipeline'}
                    placeholder="Choose a tour to upload…"
                  />
                )}
                {!selectedTourId && tours.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Create a tour on{' '}
                    <Link to="/tours/new" className="text-primary hover:underline">
                      Create tour
                    </Link>{' '}
                    if it is not listed here.
                  </p>
                )}
                {selectedTourId && (
                  <div className="space-y-2.5 rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-foreground/90">Selected tour</span>
                      {loadingTour && !tour ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    {displayTourName && (
                      <p>
                        Name: <span className="font-medium text-foreground">{displayTourName}</span>
                        {displayTourStatus ? (
                          <>
                            {' '}
                            · <StatusBadge status={displayTourStatus} />
                          </>
                        ) : null}
                      </p>
                    )}
                    <p>
                      Upload folder (R2):{' '}
                      <code className="font-mono text-foreground">{selectedTourId}</code>
                    </p>
                    {tourViewerUrl && (
                      <div className="space-y-1 border-t border-border/60 pt-2">
                        <p className="font-medium text-foreground/90">
                          {isAdminArtifact ? 'Admin URL' : 'Tour URL'}
                          {tourUrlIsLive ? '' : ' (after upload)'}
                        </p>
                        <div className="flex items-stretch gap-1.5">
                          <div
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground break-all select-all"
                            title={tourViewerUrl}
                          >
                            {tourViewerUrl}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8 shrink-0"
                            onClick={() => void copyTourUrl()}
                            aria-label="Copy tour URL"
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          {tourUrlIsLive ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8 shrink-0"
                              asChild
                            >
                              <a href={tourViewerUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="size-3.5" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                        {!tourUrlIsLive && (
                          <p className="text-[10px] leading-relaxed">
                            {isAdminArtifact
                              ? 'Public admin package URL for this tour ID. It works once admin processing finishes.'
                              : 'This is the public viewer link for this tour ID. It works once processing finishes — copy it now to share with your team.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {uploadComplete && !showReupload && (
                <div className="rounded-md border border-success/30 bg-success-subtle/40 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-foreground">ZIP already uploaded</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(tour?.zipSize ?? tour?.file_size ?? 0)}
                        {tour?.original_filename ? ` · ${tour.original_filename}` : ''}
                        {' · '}
                        {formatZipDate(tour?.zipLastModified ?? tour?.updated_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Step 1 is complete. Continue processing to download, extract, and publish
                        assets — no re-upload needed.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {(needsNewUpload || pageState === 'pipeline') && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
                  <Checkbox
                    id="saveBackupZip"
                    checked={saveBackupZip}
                    onCheckedChange={(checked) => setSaveBackupZip(checked === true)}
                    disabled={
                      pageState === 'pipeline' &&
                      !showReupload &&
                      !uploadStalled
                    }
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="saveBackupZip" className="cursor-pointer text-sm font-medium">
                      Save backup ZIP to R2
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Optional. Stores a timestamped copy under{' '}
                      <code className="font-mono text-[11px]">{selectedTourId ?? '{tourId}'}/backup_zip/</code>.
                      Cleanup of temp files on the processor always runs.
                    </p>
                  </div>
                </div>
              )}

              {(needsNewUpload || pageState === 'pipeline') && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="zipFile">
                    {showReupload ? 'Replacement ZIP file' : 'ZIP file'}
                  </Label>
                  <Input
                    id="zipFile"
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    onChange={handleFileChange}
                    required={(needsNewUpload && pageState === 'form') || uploadStalled}
                    disabled={
                      !selectedTourId ||
                      (pageState === 'pipeline' && !showReupload && !uploadStalled)
                    }
                    className="file:mr-3 file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-1 file:text-xs file:font-medium file:text-foreground"
                  />
                  {selectedFile && (
                    <div className="rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                          <FileArchive className="size-4 shrink-0 text-muted-foreground" />
                          {selectedFile.name}
                        </span>
                        <Badge variant={selectedFile.size > 1024 * 1024 * 1024 ? 'warning' : 'success'}>
                          {formatBytes(selectedFile.size)}
                        </Badge>
                      </div>
                      {selectedFile.size > 1024 * 1024 * 1024 && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Large file — uploaded to Go in{' '}
                          {Math.ceil(selectedFile.size / (25 * 1024 * 1024))} chunks of about 25 MB.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {processorDown && pageState === 'form' && (
                <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Start Upload is disabled until the Go upload worker server is connected. You can still
                  select a tour and file.
                </p>
              )}

              {!selectedTourId && tours.length > 0 && pageState === 'form' && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Select a tour above before starting the upload.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {canResume && pageState === 'form' && !showReupload && (
                  <Button
                    type="button"
                    disabled={resuming || processorDown || loadingTour}
                    onClick={() => void handleResumeProcessing()}
                  >
                    {resuming ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UploadCloud className="size-4" />
                    )}
                    {tour?.status === 'failed' ? 'Resume pipeline' : 'Continue processing'}
                  </Button>
                )}
                {canResume && pageState === 'pipeline' && tour?.status === 'failed' && (
                  <Button
                    type="button"
                    disabled={resuming || processorDown}
                    onClick={() => void handleResumeProcessing()}
                  >
                    {resuming ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UploadCloud className="size-4" />
                    )}
                    Resume pipeline
                  </Button>
                )}
                {canResume && !showReupload && pageState === 'form' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowReupload(true)
                      setSelectedFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    Upload different ZIP
                  </Button>
                )}
                {needsNewUpload && (
                  <Button type="submit" disabled={!canStart || loadingTour}>
                    <UploadCloud className="size-4" />
                    {uploadStalled ? 'Resume upload' : 'Start Upload'}
                  </Button>
                )}
                {pageState === 'pipeline' && progress && progress.status !== 'done' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
                    onClick={handleAbort}
                  >
                    Cancel upload
                  </Button>
                )}
                {(pageState === 'error' || pipelineDone) && (
                  <>
                    <Button type="button" variant="outline" onClick={handleReset}>
                      Upload another
                    </Button>
                    <Button type="button" variant="outline" onClick={handleNewTour}>
                      Choose another tour
                    </Button>
                  </>
                )}
                {urlTourId && pageState === 'form' && !pipelineDone && (
                    <Button type="button" variant="outline" onClick={handleNewTour}>
                      Choose another tour
                    </Button>
                  )}
              </div>
            </form>

            <Separator />

            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>1. Browser uploads ZIP chunks to the Go processor (via the Worker).</li>
              <li>2. Go extracts the ZIP and merge-publishes files to R2.</li>
              <li>3. The tour goes live, then the ZIP is backed up and temp files are deleted.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Processing pipeline</CardTitle>
              <CardDescription>
                Live status for every stage after you click Start Upload.
              </CardDescription>
            </div>
            {!isAdminArtifact && tour ? (
              <StatusBadge status={tour.status} />
            ) : isAdminArtifact &&
              adminStatus &&
              (ADMIN_ACTIVE_STATUSES.has(adminStatus) || ADMIN_DONE_STATUSES.has(adminStatus)) ? (
              <StatusBadge
                status={
                  (ADMIN_DONE_STATUSES.has(adminStatus)
                    ? 'completed'
                    : adminStatus === 'ingesting' || adminStatus === 'uploading'
                      ? 'ingesting'
                      : 'processing') as Tour['status']
                }
              />
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingTour ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading tour state…
              </div>
            ) : pageState === 'form' && !progress && !uploadComplete ? (
              <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                {selectedTourId
                  ? isAdminArtifact
                    ? 'Admin package pipeline will appear here once upload starts. Viewer tour ZIP status is ignored.'
                    : 'Pipeline progress will appear here once upload starts.'
                  : 'Select a tour on the left, then upload its ZIP to see pipeline progress here.'}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    Overall elapsed: {formatDuration(overallElapsedMs)}
                    {overallRemainingMs != null && (
                      <>
                        {' '}
                        · Est. remaining: ~{formatDuration(overallRemainingMs)}
                      </>
                    )}
                  </span>
                  {tourId && (
                    <span>
                      Tour ID: <code className="text-foreground">{tourId}</code>
                    </span>
                  )}
                </div>

                {(errorMessage || ingestPollError || uploadStalled) && (
                  <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2.5 text-sm text-destructive">
                    <p className="font-medium">{errorMessage || ingestPollError ? 'Upload error' : 'Upload stopped'}</p>
                    <p className="mt-0.5">
                      {errorMessage ||
                        ingestPollError ||
                        'This page is not sending the ZIP. Choose the same file and click Resume upload.'}
                    </p>
                    {(errorMessage || ingestPollError) && (
                      <Button variant="outline" size="sm" className="mt-2" onClick={handleReset}>
                        Try again
                      </Button>
                    )}
                  </div>
                )}

                <ol className="space-y-3">
                  {steps.map((step, index) => (
                    <li
                      key={step.key}
                      className={cn(
                        'rounded-lg border px-3 py-3 transition-colors',
                        step.status === 'running' && 'border-primary/40 bg-primary/5',
                        step.status === 'success' && 'border-success/30 bg-success-subtle/40',
                        step.status === 'failed' && 'border-destructive/40 bg-destructive-subtle/50',
                        step.status === 'pending' && 'border-border bg-card',
                      )}
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5 shrink-0">
                          <StepIcon status={step.status} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                                {step.title}
                              </p>
                              <p className="text-xs text-muted-foreground">{step.description}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <Badge
                                variant={
                                  step.status === 'success'
                                    ? 'success'
                                    : step.status === 'failed'
                                      ? 'destructive'
                                      : step.status === 'running'
                                        ? 'info'
                                        : 'secondary'
                                }
                              >
                                {step.status}
                              </Badge>
                              {step.status === 'running' && (
                                <>
                                  {step.elapsedMs != null && (
                                    <span>{formatDuration(step.elapsedMs)}</span>
                                  )}
                                  {step.remainingMs != null && (
                                    <>
                                      {step.elapsedMs != null && <span>·</span>}
                                      <span>~{formatDuration(step.remainingMs)} left</span>
                                    </>
                                  )}
                                </>
                              )}
                              {step.status !== 'running' && step.elapsedMs != null && (
                                <span>{formatDuration(step.elapsedMs)}</span>
                              )}
                            </div>
                          </div>

                          {typeof step.percent === 'number' && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Progress</span>
                                <span className="font-medium text-foreground">{step.percent}%</span>
                              </div>
                              <Progress
                                value={Math.max(step.percent, step.status === 'running' ? 3 : 0)}
                                className="h-1.5"
                                indicatorClassName={
                                  step.status === 'success' || step.percent >= 100
                                    ? 'bg-success'
                                    : step.status === 'failed'
                                      ? 'bg-destructive'
                                      : undefined
                                }
                              />
                            </div>
                          )}

                          {step.detail && (
                            <p
                              className={cn(
                                'break-all text-xs',
                                step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                              )}
                            >
                              {step.key === 'ready' && liveTour && tour?.viewer_url ? (
                                <a
                                  href={tour.viewer_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline-offset-2 hover:underline"
                                >
                                  {step.detail}
                                </a>
                              ) : (
                                step.detail
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>

                {canResume &&
                  pageState === 'pipeline' &&
                  tour?.status !== 'ready' &&
                  (tour?.status === 'failed' ||
                    tour?.status === 'uploading' ||
                    tour?.status === 'uploaded' ||
                    (tour?.status === 'processing' &&
                      (tour.progress_current_files ?? 0) === 0 &&
                      !tour.processing_stage)) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={resuming || processorDown}
                        onClick={() => void handleResumeProcessing()}
                      >
                        {resuming ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="size-3.5" />
                        )}
                        Resume pipeline
                      </Button>
                      {!showReupload && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setShowReupload(true)
                            setPageState('form')
                          }}
                        >
                          Upload different ZIP
                        </Button>
                      )}
                    </div>
                  )}

                {liveTour && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm">
                      <Link to="/tours">Back to tours</Link>
                    </Button>
                    {(isAdminArtifact ? adminPublishInfo?.publishUrl : tour?.viewer_url) && (
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={
                            (isAdminArtifact
                              ? adminPublishInfo?.publishUrl
                              : tour?.viewer_url) ?? undefined
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {isAdminArtifact ? 'Open admin site' : 'Open viewer'}
                        </a>
                      </Button>
                    )}
                  </div>
                )}

              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
