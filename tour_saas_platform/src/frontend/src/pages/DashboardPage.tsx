import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Compass,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Upload,
  Package,
  Eye,
  Pencil,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  FolderOpen,
} from 'lucide-react'
import { api } from '../services/api'
import { formatBytes } from '../services/uploader'
import type { DashboardStats, TourStatus, User } from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { can, PermissionGate } from '@/components/shared/PermissionGate'
import { RowActionButton } from '@/components/shared/RowActions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { uploadPagePath } from '@/lib/upload-routes'
import { copyTourViewerLink } from '@/lib/viewer-url'
import { cn } from '@/lib/utils'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

type RecentTour = DashboardStats['recentTours'][number]

const PIPELINE: Array<{
  key: keyof DashboardStats['stats']
  label: string
  hint: string
  barClass: string
  dotClass: string
}> = [
  { key: 'uploading', label: 'Uploading', hint: 'ZIP is still going to the server', barClass: 'bg-warning', dotClass: 'bg-warning' },
  { key: 'uploaded', label: 'Processing', hint: 'Extracting and publishing files', barClass: 'bg-info', dotClass: 'bg-info' },
  { key: 'ready', label: 'Live', hint: 'Viewer is ready to open', barClass: 'bg-success', dotClass: 'bg-success' },
  { key: 'failed', label: 'Needs help', hint: 'Upload or processing stopped', barClass: 'bg-destructive', dotClass: 'bg-destructive' },
]

export function DashboardPage({ user }: { user: User }) {
  const [data, setData] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function loadDashboard() {
    setLoading(true)
    return api.dashboard
      .stats()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  if (error) {
    return (
      <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>
    )
  }

  const stats = data?.stats
  const firstName = user.name.trim().split(/\s+/)[0] || user.name
  const pipelineTotal = stats
    ? stats.uploading + stats.uploaded + stats.ready + stats.failed
    : 0

  const columns: DataTableColumn<RecentTour>[] = [
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
      render: (tour) => <StatusBadge status={tour.status as TourStatus} />,
    },
    {
      key: 'size',
      header: 'Size',
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
        <div className="flex items-center justify-end gap-1.5">
          {(tour.status === 'ready' || tour.status === 'completed') && tour.viewer_url && (
            <RowActionButton label="Open viewer" tone="view" href={tour.viewer_url}>
              <ExternalLink className="size-3.5" />
            </RowActionButton>
          )}
          <PermissionGate user={user} permission="tour_create">
            <RowActionButton
              label={
                tour.status === 'draft' || !tour.file_size ? 'Upload tour' : 'Re-upload tour'
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
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${greetingForHour(new Date().getHours())}, ${firstName}`}
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }]}
        description="A quick look at tour status, what needs attention, and your latest work."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(user, 'tour_create') && (
              <Button asChild size="sm" variant="outline">
                <Link to="/upload">
                  <Upload className="size-4" />
                  Upload tour
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

      {stats && stats.failed > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {stats.failed} tour{stats.failed === 1 ? '' : 's'} need attention
            </p>
            <p className="text-muted-foreground">
              Open the tours list and use Resume or Re-upload to finish them.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/tours">Review failed</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading || !stats ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <Link to="/tours" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <StatCard label="All tours" value={stats.total} icon={Compass} hint="Everything in your account" />
            </Link>
            <StatCard
              label="Uploading"
              value={stats.uploading}
              icon={UploadCloud}
              tone="warning"
              hint="ZIP still transferring"
            />
            <StatCard
              label="Processing"
              value={stats.uploaded}
              icon={Clock}
              tone="info"
              hint="Publishing to the viewer"
            />
            <StatCard
              label="Live"
              value={stats.ready}
              icon={CheckCircle2}
              tone="success"
              hint="Ready to share"
            />
            <StatCard
              label="Needs help"
              value={stats.failed}
              icon={XCircle}
              tone="destructive"
              hint="Failed or stuck"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How tours are doing</CardTitle>
            <CardDescription>Read left to right: upload, process, live, or stuck.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading || !stats ? (
              <Skeleton className="h-36 w-full" />
            ) : pipelineTotal === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No tour activity yet. Create a tour, then upload its ZIP.
              </p>
            ) : (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  {PIPELINE.map((item) => {
                    const value = stats[item.key]
                    if (!value) return null
                    return (
                      <div
                        key={item.key}
                        className={cn('h-full min-w-1 transition-all', item.barClass)}
                        style={{ width: `${(value / pipelineTotal) * 100}%` }}
                        title={`${item.label}: ${value}`}
                      />
                    )
                  })}
                </div>
                <ul className="space-y-2.5">
                  {PIPELINE.map((item) => (
                    <li key={item.key} className="flex items-start justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.dotClass)} />
                        <div>
                          <p className="font-medium text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.hint}</p>
                        </div>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{stats[item.key]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What you can do next</CardTitle>
            <CardDescription>Common steps — pick one and go.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {can(user, 'tour_create') && (
              <QuickLink
                to="/tours/new"
                icon={Plus}
                title="Create a tour"
                text="Name and details first. The 6-digit id becomes the folder."
              />
            )}
            {can(user, 'tour_create') && (
              <QuickLink
                to="/upload"
                icon={Upload}
                title="Upload a ZIP"
                text="Send the tour package. Re-upload from the list if you need a new file."
              />
            )}
            <QuickLink
              to="/tours"
              icon={FolderOpen}
              title="Open all tours"
              text="View, edit, re-upload tour or admin package, or open the live viewer."
            />
          </CardContent>
        </Card>
      </div>

      <ListBox
        title="Recent tours"
        subtitle="Double-click a tour to copy its public viewer link"
        headerActions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/tours">
              View all
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
        onRefresh={loadDashboard}
        refreshing={loading}
        hideSearch
        hidePageSize
        contentClassName="overflow-x-auto"
        totalItems={data?.recentTours.length ?? 0}
        from={data?.recentTours.length ? 1 : 0}
        to={data?.recentTours.length ?? 0}
      >
        <DataTable
          columns={columns}
          data={data?.recentTours ?? []}
          keyExtractor={(t) => String(t.tour_id || t.id)}
          loading={loading}
          skeletonRows={5}
          onRowDoubleClick={(tour) => {
            void copyTourViewerLink(tour.tour_id, tour.viewer_url)
              .then(() => toast.success('Tour link copied'))
              .catch(() => toast.error('Could not copy tour link'))
          }}
          emptyState={
            <EmptyState
              icon={Compass}
              title="No tours yet"
              description="Create a tour, then upload its ZIP. It will show up here."
              action={
                can(user, 'tour_create') ? (
                  <Button asChild size="sm">
                    <Link to="/tours/new">Create your first tour</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </ListBox>
    </div>
  )
}

function QuickLink({
  to,
  icon: Icon,
  title,
  text,
}: {
  to: string
  icon: typeof Plus
  title: string
  text: string
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-secondary/30 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <p className="font-medium text-foreground group-hover:text-primary">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
    </Link>
  )
}
