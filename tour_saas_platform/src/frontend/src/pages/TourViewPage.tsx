import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Building2,
  Calendar,
  CheckCircle2,
  Compass,
  Copy,
  ExternalLink,
  FileArchive,
  HardDrive,
  ImageIcon,
  IndianRupee,
  MapPin,
  Pencil,
  QrCode,
  Tag,
  Upload,
  User,
  AlertTriangle,
  Clock,
  Layers,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../services/api'
import { formatBytes } from '../services/uploader'
import { uploadPagePath } from '@/lib/upload-routes'
import type {
  FurnishType,
  ListingStatus,
  MediaListItem,
  OwnerType,
  PaymentStatus,
  PropertyCategoryTreeNode,
  SizeBhk,
  Tour,
  TourUploadHistoryEntry,
  TourUploadHistoryStatus,
  User as AuthUser,
} from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { ListBox } from '@/components/shared/ListBox'
import { PermissionGate, can } from '@/components/shared/PermissionGate'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

const LISTING_LABELS: Record<ListingStatus, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  cancelled: 'Cancelled',
  on_hold: 'On hold',
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  free: 'Free',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  partial: 'Half / partial',
}

const OWNER_LABELS: Record<OwnerType, string> = {
  owner: 'Owner',
  broker: 'Broker',
  other: 'Other',
}

const FURNISH_LABELS: Record<FurnishType, string> = {
  fully_furnished: 'Fully furnished',
  semi_furnished: 'Semi furnished',
  unfurnished: 'Unfurnished',
}

const BHK_LABELS: Record<SizeBhk, string> = {
  '1_bhk': '1 BHK',
  '1_rk': '1 RK',
  '1_5_bhk': '1.5 BHK',
  '2_bhk': '2 BHK',
  '2_5_bhk': '2.5 BHK',
  '3_bhk': '3 BHK',
  '3_5_bhk': '3.5 BHK',
  '4_bhk': '4 BHK',
  '4_5_bhk': '4.5 BHK',
  '5_bhk': '5 BHK',
  '5_plus_bhk': '5+ BHK',
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function findCategoryName(nodes: PropertyCategoryTreeNode[], id: string | null | undefined): string | null {
  if (!id) return null
  for (const node of nodes) {
    if (node.id === id) return node.name
    const nested = findCategoryName(node.children, id)
    if (nested) return nested
  }
  return null
}

function progressPercent(tour: Tour): number | null {
  const total = tour.progress_total_files
  const current = tour.progress_current_files
  if (total == null || total <= 0 || current == null) return null
  return Math.min(100, Math.round((current / total) * 100))
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem ? `${min}m ${rem}s` : `${min}m`
}

const HISTORY_STATUS: Record<
  TourUploadHistoryStatus,
  { label: string; tone: 'default' | 'success' | 'warning' | 'destructive' | 'info' }
> = {
  in_progress: { label: 'In progress', tone: 'info' },
  success: { label: 'Success', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  warning: { label: 'Warning', tone: 'warning' },
}

const PATH_LABEL: Record<TourUploadHistoryEntry['report']['path'], string> = {
  go_first: 'Go ingest',
  legacy_multipart: 'R2 multipart',
  resume: 'Resume',
}

const toneDot: Record<(typeof HISTORY_STATUS)[TourUploadHistoryStatus]['tone'], string> = {
  default: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ')
}

export function TourViewPage({ user }: { user: AuthUser }) {
  const { tourId } = useParams<{ tourId: string }>()
  const [tour, setTour] = useState<Tour | null>(null)
  const [customers, setCustomers] = useState<
    Array<{ id: string; name: string; company_name: string | null }>
  >([])
  const [categories, setCategories] = useState<PropertyCategoryTreeNode[]>([])
  const [media, setMedia] = useState<MediaListItem[]>([])
  const [history, setHistory] = useState<TourUploadHistoryEntry[]>([])
  const [adminHistory, setAdminHistory] = useState<TourUploadHistoryEntry[]>([])
  const [adminPublishUrl, setAdminPublishUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tourId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const [tourData, options, historyData, adminHistoryData, adminInfo] = await Promise.all([
          api.tours.get(tourId),
          api.tours.formOptions(),
          api.tours.history(tourId).catch(() => ({ tourId, history: [] as TourUploadHistoryEntry[] })),
          api.artifacts.tourAdmin
            .history(tourId)
            .catch(() => ({ tourId, artifactType: 'tour_admin', history: [] as TourUploadHistoryEntry[] })),
          api.artifacts.tourAdmin.publishInfo(tourId).catch(() => null),
        ])
        if (cancelled) return
        setTour(tourData)
        setCustomers(options.customers)
        setCategories(options.categories)
        setHistory(historyData.history)
        setAdminHistory(adminHistoryData.history)
        setAdminPublishUrl(adminInfo?.publishUrl ?? null)

        try {
          const mediaRes = await api.media.list({
            entity_type: 'tour',
            entity_id: tourId,
            per_page: 50,
          })
          if (!cancelled) setMedia(mediaRes.items)
        } catch {
          if (!cancelled) setMedia([])
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tour')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tourId])

  const customer = useMemo(() => {
    if (!tour?.customer_id) return null
    return customers.find((c) => c.id === tour.customer_id) ?? null
  }, [tour, customers])

  const categoryName = useMemo(
    () => findCategoryName(categories, tour?.property_category_id),
    [categories, tour?.property_category_id],
  )
  const subCategoryName = useMemo(
    () => findCategoryName(categories, tour?.property_sub_category_id),
    [categories, tour?.property_sub_category_id],
  )

  const thumbnail = media.find((m) => m.links.some((l) => l.collection === 'tour_thumbnail'))
  const logo = media.find((m) => m.links.some((l) => l.collection === 'tour_logo'))
  const assets = media.filter((m) => m.links.some((l) => l.collection === 'tour_assets'))
  const pct = tour ? progressPercent(tour) : null

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Tour"
          breadcrumbs={[
            { label: 'Home', href: '/' },
            { label: 'Tours', href: '/tours' },
            { label: 'View' },
          ]}
          showBack
        />
        <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title={loading || !tour ? 'Tour' : tour.name}
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Tours', href: '/tours' },
          { label: loading || !tour ? '…' : tour.name },
        ]}
        description={
          tour
            ? [tour.original_filename, tour.status === 'failed' ? 'Needs attention' : null]
                .filter(Boolean)
                .join(' · ') || undefined
            : undefined
        }
        showBack
        actions={
          tour ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={tour.status} />
              {can(user, 'tour_create') && tour.status === 'draft' && (
                <Button asChild size="sm" variant="outline">
                  <Link to={uploadPagePath(tour.tour_id)}>
                    <Upload className="size-4" />
                    Upload ZIP
                  </Link>
                </Button>
              )}
              {can(user, 'tour_admin_upload') && (
                <Button asChild size="sm" variant="outline">
                  <Link to={uploadPagePath(tour.tour_id, { artifact: 'tour_admin' })}>
                    <Upload className="size-4" />
                    Upload admin package
                  </Link>
                </Button>
              )}
              {(tour.status === 'ready' || tour.status === 'completed') && tour.viewer_url && (
                <Button asChild size="sm" variant="outline">
                  <a href={tour.viewer_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Open viewer
                  </a>
                </Button>
              )}
              {adminPublishUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={adminPublishUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Open admin
                  </a>
                </Button>
              )}
              <PermissionGate user={user} permission="tour_edit">
                <Button asChild size="sm">
                  <Link to={`/tours/${tour.tour_id}/edit`}>
                    <Pencil className="size-4" />
                    Edit
                  </Link>
                </Button>
              </PermissionGate>
            </div>
          ) : null
        }
      />

      {/* Hero */}
      {loading || !tour ? (
        <Card className="overflow-hidden">
          <Skeleton className="h-48 w-full rounded-none" />
          <CardContent className="space-y-3 pt-5">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96" />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div
            className={cn(
              'relative flex h-48 w-full items-center justify-center bg-muted bg-cover bg-center',
              !thumbnail && 'bg-gradient-to-br from-muted to-secondary',
            )}
            style={thumbnail ? { backgroundImage: `url(${thumbnail.url})` } : undefined}
          >
            {!thumbnail && (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageIcon className="size-10 opacity-40" />
                <span className="text-xs">No thumbnail</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3">
              <StatusBadge status={tour.status} />
            </div>
          </div>
          <CardContent className="space-y-4 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                  {tour.name}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{tour.tour_id}</p>
                {customer && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Customer:{' '}
                    <Link
                      to={`/customers/${customer.id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {customer.name}
                      {customer.company_name ? ` · ${customer.company_name}` : ''}
                    </Link>
                  </p>
                )}
              </div>
              {logo && (
                <img
                  src={logo.url}
                  alt="Tour logo"
                  className="h-12 w-auto max-w-[140px] rounded-md border border-border object-contain bg-card p-1"
                />
              )}
            </div>

            {tour.processing_error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{tour.processing_error}</span>
              </div>
            )}

            {pct != null && (tour.status === 'processing' || tour.status === 'uploaded') && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Processing progress</span>
                  <span>
                    {tour.progress_current_files}/{tour.progress_total_files} files · {pct}%
                  </span>
                </div>
                <Progress value={pct} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !tour ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Status"
              value={tour.status.replace(/_/g, ' ')}
              icon={Compass}
              tone={
                tour.status === 'failed'
                  ? 'destructive'
                  : tour.status === 'ready' || tour.status === 'completed'
                    ? 'success'
                    : tour.status === 'uploading' || tour.status === 'ingesting'
                      ? 'warning'
                      : 'info'
              }
            />
            <StatCard
              label="Stage"
              value={tour.processing_stage?.replace(/_/g, ' ') || '—'}
              icon={Layers}
              tone="info"
            />
            <StatCard
              label="File size"
              value={tour.file_size ? formatBytes(tour.file_size) : '—'}
              icon={HardDrive}
            />
            <StatCard
              label="ZIP on R2"
              value={tour.zipOnR2 ? 'Yes' : 'No'}
              icon={FileArchive}
              tone={tour.zipOnR2 ? 'success' : 'default'}
              hint={tour.uploadComplete ? 'Upload complete' : undefined}
            />
            <StatCard
              label="Created"
              value={formatDate(tour.created_at)}
              icon={Calendar}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Details column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ListBox title="Basic information" subtitle="Identity, listing, and customer">
            {loading || !tour ? (
              <DetailSkeleton />
            ) : (
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <InfoRow icon={Tag} label="Tour name" value={tour.name} />
                <InfoRow
                  icon={Compass}
                  label="Tour ID"
                  value={tour.tour_id}
                  mono
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => copyText(tour.tour_id, 'Tour ID')}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  }
                />
                <InfoRow
                  icon={User}
                  label="Customer"
                  value={customer?.name ?? '—'}
                  href={customer ? `/customers/${customer.id}` : undefined}
                  linkTo
                />
                <InfoRow
                  icon={CheckCircle2}
                  label="Listing status"
                  value={
                    tour.listing_status
                      ? LISTING_LABELS[tour.listing_status as ListingStatus] ?? tour.listing_status
                      : '—'
                  }
                />
                <InfoRow
                  icon={IndianRupee}
                  label="Payment status"
                  value={
                    tour.payment_status
                      ? PAYMENT_LABELS[tour.payment_status as PaymentStatus] ?? tour.payment_status
                      : '—'
                  }
                />
                <InfoRow
                  icon={QrCode}
                  label="QR code"
                  value={tour.qr_code ?? '—'}
                  mono
                  action={
                    tour.qr_code ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => copyText(tour.qr_code!, 'QR code')}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </ListBox>

          <ListBox title="Property details" subtitle="Type, size, pricing, and billing">
            {loading || !tour ? (
              <DetailSkeleton />
            ) : (
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <InfoRow
                  icon={Building2}
                  label="Owner type"
                  value={
                    tour.owner_type
                      ? OWNER_LABELS[tour.owner_type as OwnerType] ?? tour.owner_type
                      : '—'
                  }
                />
                {tour.owner_type_details && (
                  <InfoRow icon={User} label="Owner details" value={tour.owner_type_details} />
                )}
                <InfoRow icon={Layers} label="Property type" value={categoryName ?? '—'} />
                <InfoRow icon={Layers} label="Sub type" value={subCategoryName ?? '—'} />
                <InfoRow
                  icon={Tag}
                  label="Furnish"
                  value={
                    tour.furnish_type
                      ? FURNISH_LABELS[tour.furnish_type as FurnishType] ?? tour.furnish_type
                      : '—'
                  }
                />
                <InfoRow
                  icon={Tag}
                  label="Size"
                  value={
                    tour.size_bhk ? BHK_LABELS[tour.size_bhk as SizeBhk] ?? tour.size_bhk : '—'
                  }
                />
                <InfoRow
                  icon={HardDrive}
                  label="Super built-up area"
                  value={
                    tour.super_built_up_area != null
                      ? `${tour.super_built_up_area.toLocaleString()} sq.ft`
                      : '—'
                  }
                />
                <InfoRow
                  icon={IndianRupee}
                  label="Price"
                  value={tour.price != null ? `₹ ${tour.price.toLocaleString()}` : '—'}
                />
                {tour.other_option_details && (
                  <InfoRow icon={Tag} label="Other details" value={tour.other_option_details} />
                )}
                <InfoRow
                  icon={Building2}
                  label="Company billing"
                  value={tour.use_company_billing ? 'Yes' : 'No'}
                />
                {tour.billing_company_name && (
                  <InfoRow icon={Building2} label="Billing company" value={tour.billing_company_name} />
                )}
                {tour.gst_no && <InfoRow icon={Tag} label="GST no." value={tour.gst_no} mono />}
              </div>
            )}
          </ListBox>

          <ListBox title="Address" subtitle="Property location">
            {loading || !tour ? (
              <DetailSkeleton />
            ) : (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InfoRow icon={MapPin} label="House no." value={tour.house_no || '—'} />
                  <InfoRow icon={Building2} label="Building" value={tour.building_name || '—'} />
                  <InfoRow icon={Building2} label="Society" value={tour.society_name || '—'} />
                  <InfoRow icon={MapPin} label="Area / locality" value={tour.area_locality || '—'} />
                  <InfoRow icon={MapPin} label="Landmark" value={tour.landmark || '—'} />
                  <InfoRow icon={MapPin} label="PIN code" value={tour.pin_code || '—'} mono />
                  <InfoRow icon={MapPin} label="City" value={tour.city || '—'} />
                  <InfoRow icon={MapPin} label="State" value={tour.state || '—'} />
                  <InfoRow icon={MapPin} label="Country" value={tour.country || '—'} />
                </div>
                {tour.full_address && (
                  <>
                    <Separator />
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Full address</p>
                      <p className="whitespace-pre-line text-sm text-foreground">{tour.full_address}</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </ListBox>

          <ListBox title="Media" subtitle="Thumbnail, logo, and assets">
            {loading ? (
              <DetailSkeleton />
            ) : !thumbnail && !logo && assets.length === 0 ? (
              <EmptyState
                icon={ImageIcon}
                title="No media yet"
                description="Upload a thumbnail or assets from the tours list or edit flow."
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4">
                {thumbnail && <MediaTile item={thumbnail} label="Thumbnail" />}
                {logo && <MediaTile item={logo} label="Logo" />}
                {assets.map((item) => (
                  <MediaTile key={item.id} item={item} label="Asset" />
                ))}
              </div>
            )}
          </ListBox>
        </div>

        {/* Sidebar: pipeline + history */}
        <div className="flex flex-col gap-4">
          <ListBox title="Pipeline" subtitle="Upload and processing state">
            {loading || !tour ? (
              <DetailSkeleton rows={4} />
            ) : (
              <div className="grid grid-cols-1 gap-4 p-4">
                <InfoRow
                  icon={FileArchive}
                  label="Original file"
                  value={tour.original_filename || '—'}
                />
                <InfoRow
                  icon={HardDrive}
                  label="Stored size"
                  value={tour.file_size ? formatBytes(tour.file_size) : '—'}
                />
                <InfoRow
                  icon={Upload}
                  label="Upload complete"
                  value={tour.uploadComplete ? 'Yes' : 'No'}
                />
                <InfoRow
                  icon={Layers}
                  label="Can resume processing"
                  value={tour.canResumeProcessing ? 'Yes' : 'No'}
                />
                <InfoRow
                  icon={Clock}
                  label="Progress"
                  value={
                    tour.progress_total_files != null
                      ? `${tour.progress_current_files ?? 0} / ${tour.progress_total_files} files`
                      : '—'
                  }
                />
                {(tour.status === 'ready' || tour.status === 'completed') && tour.viewer_url && (
                  <InfoRow
                    icon={ExternalLink}
                    label="Viewer URL"
                    value={tour.viewer_url.replace(/^https?:\/\//, '')}
                    href={tour.viewer_url}
                    external
                  />
                )}
              </div>
            )}
          </ListBox>

          <ListBox
            title="History"
            subtitle={
              loading
                ? 'Loading…'
                : history.length === 0
                  ? 'No ZIP uploads yet'
                  : `${history.length} upload attempt${history.length === 1 ? '' : 's'} (full report)`
            }
          >
            {loading ? (
              <DetailSkeleton rows={5} />
            ) : history.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No upload history yet"
                description="Each ZIP upload and resume will appear here with stages, errors, and warnings."
              />
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {history.map((entry, index) => (
                  <UploadHistoryCard
                    key={entry.id}
                    entry={entry}
                    defaultOpen={index === 0}
                  />
                ))}
              </div>
            )}
          </ListBox>

          <ListBox
            title="Admin package uploads"
            subtitle={
              loading
                ? 'Loading…'
                : adminHistory.length === 0
                  ? 'No admin ZIP uploads yet'
                  : `${adminHistory.length} attempt${adminHistory.length === 1 ? '' : 's'}`
            }
            headerActions={
              can(user, 'tour_admin_upload') && tour ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={uploadPagePath(tour.tour_id, { artifact: 'tour_admin' })}>
                    <Upload className="size-4" />
                    Upload
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {loading ? (
              <DetailSkeleton rows={3} />
            ) : adminHistory.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No admin package history"
                description="Upload a tour-admin ZIP to publish the admin site for this tour (separate R2 bucket)."
              />
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {adminPublishUrl && (
                  <p className="text-xs text-muted-foreground">
                    Admin URL:{' '}
                    <a
                      href={adminPublishUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {adminPublishUrl}
                    </a>
                  </p>
                )}
                {adminHistory.map((entry, index) => (
                  <UploadHistoryCard
                    key={entry.id}
                    entry={entry}
                    defaultOpen={index === 0}
                  />
                ))}
              </div>
            )}
          </ListBox>
        </div>
      </div>
    </div>
  )
}

function DetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function UploadHistoryCard({
  entry,
  defaultOpen,
}: {
  entry: TourUploadHistoryEntry
  defaultOpen?: boolean
}) {
  const meta = HISTORY_STATUS[entry.status]
  const stages = entry.report.stages
  const progress = entry.report.progress
  const hasFiles = progress.files.total > 0

  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/40">
        <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', toneDot[meta.tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              Attempt #{entry.attempt_number}
            </p>
            <Badge
              variant={
                entry.status === 'success'
                  ? 'success'
                  : entry.status === 'failed'
                    ? 'destructive'
                    : entry.status === 'warning'
                      ? 'warning'
                      : 'info'
              }
            >
              {meta.label}
            </Badge>
            <Badge variant="outline">{PATH_LABEL[entry.report.path]}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {entry.original_filename || 'ZIP upload'}
            {entry.file_size != null ? ` · ${formatBytes(entry.file_size)}` : ''}
            {entry.backup_version ? ` · ${entry.backup_version}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDateTime(entry.started_at)}
            {entry.finished_at ? ` → ${formatDateTime(entry.finished_at)}` : ''}
            {' · '}
            {formatDuration(entry.duration_ms)}
          </p>
        </div>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 border-t border-border px-3 py-3">
          {(entry.error_message || entry.report.source_error) && (
            <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive">
              <span className="font-medium">Error: </span>
              {entry.error_message || entry.report.source_error}
            </div>
          )}

          {entry.report.warnings.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <p className="font-medium text-warning">Warnings</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {entry.report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {hasFiles && (
            <p className="text-xs text-muted-foreground">
              Progress: {progress.files.current}/{progress.files.total} files
              {progress.bytes.total > 0
                ? ` · ${formatBytes(progress.bytes.current)} / ${formatBytes(progress.bytes.total)}`
                : ''}
            </p>
          )}

          {entry.report.viewer_url && (
            <a
              href={entry.report.viewer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-2 hover:underline"
            >
              <ExternalLink className="size-3" />
              Viewer from this attempt
            </a>
          )}

          {entry.report.backup?.key && (
            <p className="font-mono text-[11px] text-muted-foreground">
              Backup: {entry.report.backup.key}
              {entry.report.backup.version ? ` (${entry.report.backup.version})` : ''}
            </p>
          )}

          {stages.length > 0 ? (
            <ol className="relative space-y-0">
              {stages.map((event, index) => (
                <li key={`${event.stage}-${event.at}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
                  {index < stages.length - 1 && (
                    <span className="absolute left-[7px] top-3 h-full w-px bg-border" aria-hidden />
                  )}
                  <span
                    className={cn(
                      'relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card',
                      event.stage.includes('fail') || event.stage === 'aborted'
                        ? toneDot.destructive
                        : event.stage.includes('complet') || event.stage === 'ready_pending_backup'
                          ? toneDot.success
                          : toneDot.info,
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <p className="text-sm font-medium capitalize text-foreground">
                        {stageLabel(event.stage)}
                      </p>
                      <time className="text-xs text-muted-foreground">{formatDateTime(event.at)}</time>
                    </div>
                    {event.detail && (
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">{event.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">No stage events recorded.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
  external,
  linkTo,
  mono,
  action,
}: {
  icon: typeof Tag
  label: string
  value: string
  href?: string
  external?: boolean
  linkTo?: boolean
  mono?: boolean
  action?: ReactNode
}) {
  const valueClass = cn('text-sm text-foreground', mono && 'font-mono')

  let valueNode: ReactNode
  if (href && linkTo) {
    valueNode = (
      <Link to={href} className={cn(valueClass, 'truncate underline-offset-2 hover:underline')}>
        {value}
      </Link>
    )
  } else if (href) {
    valueNode = (
      <a
        href={href}
        className={cn(valueClass, 'truncate underline-offset-2 hover:underline')}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {value}
      </a>
    )
  } else {
    valueNode = <p className={cn(valueClass, 'truncate')}>{value}</p>
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{valueNode}</div>
          {action}
        </div>
      </div>
    </div>
  )
}

function MediaTile({ item, label }: { item: MediaListItem; label: string }) {
  const isImage = item.mime?.startsWith('image/')
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="aspect-square overflow-hidden bg-muted">
        {isImage ? (
          <img
            src={item.url}
            alt={item.original_name ?? label}
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <FileArchive className="size-6" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {label}
        </Badge>
        <span className="truncate text-[10px] text-muted-foreground">
          {item.original_name || item.id}
        </span>
      </div>
    </a>
  )
}
