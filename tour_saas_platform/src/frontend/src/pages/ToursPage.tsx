import { useCallback, useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Compass,
  Plus,
  ExternalLink,
  Loader2,
  RotateCcw,
  AlertTriangle,
  Play,
  Workflow,
  Pencil,
  Upload,
  Package,
  Eye,
} from 'lucide-react'
import { api } from '../services/api'
import { formatBytes } from '../services/uploader'
import type { Tour, TourStatus, User } from '../types'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { can, PermissionGate } from '@/components/shared/PermissionGate'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { PageHeader } from '@/components/shared/PageHeader'
import { RowActions, RowActionButton } from '@/components/shared/RowActions'
import { useListControls } from '@/hooks/useListControls'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { uploadPagePath } from '@/lib/upload-routes'
import { copyTourViewerLink } from '@/lib/viewer-url'
// ── Constants ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2500
const ACTIVE_STATUSES: TourStatus[] = ['uploading', 'ingesting', 'uploaded', 'processing']

function ViewProcessButton({ tour }: { tour: Tour }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link
        to={uploadPagePath(tour.tour_id)}
        state={{ tourId: tour.tour_id, tourName: tour.name }}
      >
        <Workflow className="size-3.5" />
        View process
      </Link>
    </Button>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format seconds into "Xm Ys" or "Xs" */
function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '—'
  const s = Math.round(totalSeconds)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m === 0) return `${sec}s`
  return `${m}m ${sec}s`
}

// ── Processing progress sub-component ─────────────────────────

function ProcessingProgress({ tour }: { tour: Tour }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const currentFiles = tour.progress_current_files ?? 0
  const totalFiles = tour.progress_total_files ?? 0
  const currentBytes = tour.progress_current_bytes ?? 0
  const totalBytes = tour.progress_total_bytes ?? 0

  let pct = 0
  if (totalFiles > 0) {
    pct = Math.min(100, Math.round((currentFiles / totalFiles) * 100))
  } else if (totalBytes > 0) {
    pct = Math.min(100, Math.round((currentBytes / totalBytes) * 100))
  }

  const elapsedSeconds = tour.processing_started_at
    ? (now - new Date(tour.processing_started_at).getTime()) / 1000
    : 0

  let etaStr = '—'
  if (pct > 2 && elapsedSeconds > 0) {
    const totalEstimated = (elapsedSeconds / pct) * 100
    const remaining = totalEstimated - elapsedSeconds
    etaStr = formatDuration(remaining)
  }

  return (
    <div className="min-w-56">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-primary">{pct}%</span>
        <span className="text-xs text-muted-foreground">
          {totalFiles > 0 ? `${currentFiles} / ${totalFiles} files` : 'Preparing…'}
        </span>
      </div>
      <Progress value={Math.max(pct, 3)} className="h-1.5" />
      {totalBytes > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          {formatBytes(currentBytes)} / {formatBytes(totalBytes)}
        </div>
      )}
      <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
        <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
        <span>·</span>
        <span>ETA: {etaStr}</span>
      </div>
    </div>
  )
}

// ── Delete progress sub-component ─────────────────────────────

function DeleteProgressPanel({
  progress,
  startedAt,
  now,
}: {
  progress: {
    percent: number
    filesDeleted: number
    filesTotal: number
    elapsedMs: number
    message?: string
    stage: string
  }
  startedAt: number | null
  now: number
}) {
  const pct = Math.min(100, Math.max(0, progress.percent))
  const done = progress.stage === 'done' || pct >= 100
  const localElapsedMs = startedAt != null ? Math.max(0, now - startedAt) : 0
  const elapsedSeconds = Math.max(progress.elapsedMs, localElapsedMs) / 1000

  // Prefer file-based ETA once deletes are underway — more accurate than percent
  // for pipelined list+delete where percent can lag while totals grow.
  let etaStr = '—'
  if (done) {
    etaStr = '0s'
  } else if (
    progress.filesDeleted > 0 &&
    progress.filesTotal > progress.filesDeleted &&
    elapsedSeconds > 0
  ) {
    const rate = progress.filesDeleted / elapsedSeconds
    const remaining = (progress.filesTotal - progress.filesDeleted) / rate
    const pad = progress.stage === 'listing' ? 1.25 : 1
    etaStr = formatDuration(remaining * pad)
  } else if (pct > 2 && elapsedSeconds > 0 && pct < 100) {
    const totalEstimated = (elapsedSeconds / pct) * 100
    const remaining = totalEstimated - elapsedSeconds
    etaStr = formatDuration(remaining)
  }

  const fileLabel =
    progress.filesTotal > 0
      ? `${progress.filesDeleted.toLocaleString()} / ${progress.filesTotal.toLocaleString()} files`
      : progress.stage === 'soft_delete'
        ? 'Removing tour record…'
        : 'Preparing…'

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Progress</span>
        <span className={`font-medium ${done ? 'text-success' : 'text-foreground'}`}>{pct}%</span>
      </div>
      <Progress
        value={Math.max(pct, done ? 100 : 3)}
        className="h-2"
        indicatorClassName={done ? 'bg-success' : 'bg-destructive'}
      />
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{progress.message || (done ? 'Tour deleted' : 'Deleting…')}</span>
        <span className="shrink-0">{fileLabel}</span>
      </div>
      <div className="flex gap-2 text-xs text-muted-foreground">
        <span>Elapsed: {formatDuration(elapsedSeconds)}</span>
        <span>·</span>
        <span>ETA: {etaStr}</span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function ToursPage({ user }: { user: User }) {
  const [tours, setTours] = useState<Tour[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processorOnline, setProcessorOnline] = useState<boolean | null>(null)
  const [processorError, setProcessorError] = useState<string | null>(null)
  const [resumingId, setResumingId] = useState<string | null>(null)
  const wasOfflineRef = useRef(false)

  const [confirmTour, setConfirmTour] = useState<Tour | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteProgress, setDeleteProgress] = useState<{
    percent: number
    filesDeleted: number
    filesTotal: number
    elapsedMs: number
    message?: string
    stage: string
  } | null>(null)
  const [deleteStartedAt, setDeleteStartedAt] = useState<number | null>(null)
  const [deleteNow, setDeleteNow] = useState(Date.now())

  useEffect(() => {
    if (!deleting) return
    const id = setInterval(() => setDeleteNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deleting])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const filterTours = useCallback((tour: Tour, query: string) => {
    const haystack = [tour.name, tour.original_filename, tour.tour_id, tour.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  }, [])

  const list = useListControls({
    items: tours,
    filterFn: filterTours,
    defaultPageSize: 10,
  })

  async function copyTourLink(tour: Tour) {
    try {
      await copyTourViewerLink(tour.tour_id, tour.viewer_url)
      toast.success('Tour link copied')
    } catch {
      toast.error('Could not copy tour link')
    }
  }

  async function resumeStuckTours(current: Tour[]) {
    const stuck = current.filter((t) =>
      (['uploading', 'ingesting', 'uploaded', 'processing'] as string[]).includes(t.status),
    )
    for (const tour of stuck) {
      try {
        const result = await api.tours.resume(tour.tour_id)
        if (result.tour) {
          setTours((prev) => prev.map((t) => (t.id === result.tour!.id ? result.tour! : t)))
        }
      } catch {
        // Best-effort on connectivity restore
      }
    }
  }

  function checkProcessorHealth() {
    return api.tours
      .processorStatus()
      .then((status) => {
        const online = status.online
        setProcessorOnline(online)
        setProcessorError(status.error)
        if (online && wasOfflineRef.current) {
          // Processor just came back — kick pending tours
          void api.tours.list().then((data) => {
            setTours(data)
            void resumeStuckTours(data)
          })
        }
        wasOfflineRef.current = !online
      })
      .catch(() => {
        setProcessorOnline(false)
        setProcessorError('Could not reach Worker health probe')
        wasOfflineRef.current = true
      })
  }

  function loadTours() {
    setLoading(true)
    return api.tours
      .list()
      .then((data) => {
        setTours(data)
        if (hasActiveTours(data)) startPolling()
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  function hasActiveTours(list: Tour[]) {
    return list.some((t) => (ACTIVE_STATUSES as string[]).includes(t.status))
  }

  function startPolling() {
    if (pollRef.current) return
    pollRef.current = setInterval(() => {
      api.tours
        .list()
        .then((updated) => {
          setTours(updated)
          if (!hasActiveTours(updated)) {
            stopPolling()
          }
        })
        .catch(() => {
          // Silently swallow poll errors — don't disrupt the page
        })
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function handleResume(tour: Tour) {
    setResumingId(tour.tour_id)
    setError(null)
    try {
      const result = await api.tours.resume(tour.tour_id)
      if (result.tour) {
        setTours((prev) => prev.map((t) => (t.id === result.tour!.id ? result.tour! : t)))
      } else {
        await loadTours()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resume failed')
    } finally {
      setResumingId(null)
    }
  }

  useEffect(() => {
    loadTours()
    checkProcessorHealth()
    healthPollRef.current = setInterval(checkProcessorHealth, 15000)
    return () => {
      stopPolling()
      if (healthPollRef.current) clearInterval(healthPollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (hasActiveTours(tours)) {
      startPolling()
    } else {
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tours])

  function openConfirm(tour: Tour) {
    setConfirmTour(tour)
    setDeleteError(null)
    setDeleteProgress(null)
    setDeleteStartedAt(null)
  }

  function closeConfirm() {
    if (!deleting) {
      setConfirmTour(null)
      setDeleteError(null)
      setDeleteProgress(null)
      setDeleteStartedAt(null)
    }
  }

  async function confirmDelete() {
    if (!confirmTour) return
    setDeleting(true)
    setDeleteError(null)
    const startedAt = Date.now()
    setDeleteStartedAt(startedAt)
    setDeleteProgress({
      percent: 1,
      filesDeleted: 0,
      filesTotal: 0,
      elapsedMs: 0,
      message: 'Starting…',
      stage: 'soft_delete',
    })
    setDeleteNow(startedAt)
    try {
      await api.tours.delete(confirmTour.id, (progress) => {
        setDeleteProgress({
          percent: progress.percent,
          filesDeleted: progress.filesDeleted,
          filesTotal: progress.filesTotal,
          elapsedMs: progress.elapsedMs,
          message: progress.message,
          stage: progress.stage,
        })
      })
      setDeleteProgress((prev) =>
        prev
          ? { ...prev, percent: 100, stage: 'done', message: 'Tour deleted' }
          : prev,
      )
      await new Promise((resolve) => setTimeout(resolve, 400))
      setTours((prev) => prev.filter((t) => t.id !== confirmTour.id))
      setConfirmTour(null)
      setDeleteProgress(null)
      setDeleteStartedAt(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<Tour>[] = [
    {
      key: 'name',
      header: 'Tour',
      sortable: true,
      sortValue: (tour) => tour.name,
      render: (tour) => (
        <div>
          <Link
            to={`/tours/${tour.tour_id}`}
            className="font-medium text-foreground hover:underline"
          >
            {tour.name}
          </Link>
          {tour.original_filename && (
            <div className="text-xs text-muted-foreground">{tour.original_filename}</div>
          )}
          <div className="font-mono text-[10px] text-muted-foreground/70">{tour.tour_id}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (tour) => tour.status,
      render: (tour) => <StatusBadge status={tour.status} />,
    },
    {
      key: 'size',
      header: 'File Size',
      sortable: true,
      sortValue: (tour) => tour.file_size ?? 0,
      render: (tour) => (
        <span className="text-sm text-muted-foreground">
          {tour.file_size ? formatBytes(tour.file_size) : '—'}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      sortable: true,
      sortValue: (tour) => new Date(tour.created_at).getTime(),
      render: (tour) => <span className="text-sm text-muted-foreground">{formatDate(tour.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (tour) => (
        <div className="flex items-center justify-end gap-2">
          {tour.status === 'ingesting' && (
            <div className="flex items-center gap-2">
              <ViewProcessButton tour={tour} />
              <Button
                variant="outline"
                size="sm"
                disabled={resumingId === tour.tour_id}
                onClick={() => handleResume(tour)}
                title="If the browser upload finished but status is stuck, try Resume."
              >
                {resumingId === tour.tour_id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Resume
              </Button>
            </div>
          )}
          {tour.status === 'uploading' && (
            <div className="flex items-center gap-2">
              <ViewProcessButton tour={tour} />
              <Button
                variant="outline"
                size="sm"
                disabled={resumingId === tour.tour_id}
                onClick={() => handleResume(tour)}
                title="If the browser upload finished but status is stuck, try Resume. If the ZIP never completed, this marks the tour failed so you can re-upload."
              >
                {resumingId === tour.tour_id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Resume
              </Button>
            </div>
          )}
          {(tour.status === 'uploaded' || tour.status === 'processing') && (
            <div className="flex items-center gap-2">
              <ViewProcessButton tour={tour} />
              <ProcessingProgress tour={tour} />
              {(tour.progress_current_files ?? 0) === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resumingId === tour.tour_id || processorOnline === false}
                  onClick={() => handleResume(tour)}
                  title="Re-dispatch this tour to the Go processor"
                >
                  {resumingId === tour.tour_id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Retry
                </Button>
              )}
            </div>
          )}
          {(tour.status === 'ready' || tour.status === 'completed') && tour.viewer_url && (
            <RowActionButton label="View tour" tone="view" href={tour.viewer_url}>
              <ExternalLink className="size-3.5" />
            </RowActionButton>
          )}
          {tour.status === 'failed' && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <ViewProcessButton tour={tour} />
                {tour.canResumeProcessing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resumingId === tour.tour_id || processorOnline === false}
                    onClick={() => handleResume(tour)}
                    title="ZIP is in R2 — resume Go processing without re-uploading"
                  >
                    {resumingId === tour.tour_id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                    Resume
                  </Button>
                ) : (
                  <RowActionButton
                    label="Retry upload"
                    tone="neutral"
                    to={uploadPagePath(tour.tour_id)}
                    state={{ tourId: tour.tour_id, tourName: tour.name }}
                  >
                    <RotateCcw className="size-3.5" />
                  </RowActionButton>
                )}
              </div>
              {tour.processing_error && (
                <span className="max-w-48 truncate text-xs text-destructive" title={tour.processing_error}>
                  {tour.processing_error}
                </span>
              )}
            </div>
          )}

          <PermissionGate user={user} permission="tour_create">
            <RowActionButton
              label={
                tour.status === 'draft' || !tour.file_size
                  ? 'Upload tour'
                  : 'Re-upload tour'
              }
              tone="neutral"
              to={uploadPagePath(tour.tour_id)}
              state={{ tourId: tour.tour_id, tourName: tour.name }}
            >
              <Upload className="size-3.5" />
            </RowActionButton>
          </PermissionGate>

          <PermissionGate user={user} permission="tour_admin_upload">
            <RowActionButton
              label="Upload / re-upload admin package"
              tone="neutral"
              to={uploadPagePath(tour.tour_id, { artifact: 'tour_admin' })}
              state={{ tourId: tour.tour_id, tourName: tour.name }}
            >
              <Package className="size-3.5" />
            </RowActionButton>
          </PermissionGate>

          <RowActionButton label="View" tone="view" to={`/tours/${tour.tour_id}`}>
            <Eye className="size-3.5" />
          </RowActionButton>

          <PermissionGate user={user} permission="tour_edit">
            <RowActionButton label="Edit details" tone="edit" to={`/tours/${tour.tour_id}/edit`}>
              <Pencil className="size-3.5" />
            </RowActionButton>
          </PermissionGate>

          <RowActions
            onDelete={() => openConfirm(tour)}
            deleteDisabled={tour.status === 'uploading'}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Tours Management"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Tours' },
        ]}
        showBack
        backTo="/"
        actions={
          <div className="flex flex-wrap gap-2">
            {can(user, 'tour_create') && (
              <Button asChild size="sm" variant="outline">
                <Link to="/upload">
                  <Plus className="size-4" />
                  Upload Tour
                </Link>
              </Button>
            )}
            {can(user, 'tour_create') && (
              <Button asChild size="sm">
                <Link to="/tours/new">
                  <Plus className="size-4" />
                  New tour
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}

      {processorOnline === false && (
        <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <div className="font-medium">Tour processor is offline</div>
            <div className="text-muted-foreground">
              Uploads can still finish to R2, but processing will not start until the Go processor
              is reachable. Pending tours resume automatically when it comes back
              {processorError ? ` (${processorError})` : ''}.
            </div>
          </div>
        </div>
      )}

      <ListBox
        title="Tours List"
        subtitle="Double-click a tour to copy its public viewer link"
        onRefresh={loadTours}
        refreshing={loading}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search tours…"
        page={list.page}
        totalPages={list.totalPages}
        onPageChange={list.setPage}
        pageSize={list.pageSize}
        pageSizeOptions={list.pageSizeOptions}
        onPageSizeChange={list.setPageSize}
        totalItems={list.total}
        from={list.from}
        to={list.to}
      >
        <DataTable
          columns={columns}
          data={list.paginated}
          keyExtractor={(t) => t.id}
          loading={loading}
          onRowDoubleClick={(tour) => void copyTourLink(tour)}
          emptyState={
            <EmptyState
              icon={Compass}
              title={list.search ? 'No matching tours' : 'No tours yet'}
              description={
                list.search
                  ? 'Try a different search term.'
                  : 'Upload your first 360° tour to get started.'
              }
              action={
                !list.search ? (
                  <Button asChild size="sm">
                    <Link to="/upload">Upload Tour</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </ListBox>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!confirmTour}
        onOpenChange={(open) => !open && closeConfirm()}
        title="Delete Tour"
        description={
          <>
            Are you sure you want to delete <strong>"{confirmTour?.name}"</strong>? This will permanently delete all
            uploaded files and viewer files from R2 storage. This action cannot be undone.
          </>
        }
        confirmLabel={deleting ? `Deleting${deleteProgress ? ` ${deleteProgress.percent}%` : '…'}` : 'Yes, Delete'}
        loading={deleting}
        onConfirm={confirmDelete}
      >
        {deleteProgress && (
          <DeleteProgressPanel progress={deleteProgress} startedAt={deleteStartedAt} now={deleteNow} />
        )}
        {deleteError && (
          <div className="mt-3 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {deleteError}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
