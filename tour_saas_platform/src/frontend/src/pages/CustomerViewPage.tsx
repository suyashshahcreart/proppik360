import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  Globe,
  Mail,
  Pencil,
  Phone,
  Plus,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { api } from '../services/api'
import { formatBytes } from '../services/uploader'
import type { CustomerToursResponse, Tour, TourStatus } from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { RowActionButton } from '@/components/shared/RowActions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function CustomerViewPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const [data, setData] = useState<CustomerToursResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    setError(null)
    api.customers
      .tours(customerId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load customer'))
      .finally(() => setLoading(false))
  }, [customerId])

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Customer"
          breadcrumbs={[
            { label: 'Home', href: '/' },
            { label: 'Customers', href: '/customers' },
            { label: 'View' },
          ]}
          showBack
          backTo="/customers"
        />
        <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>
      </div>
    )
  }

  const customer = data?.customer
  const stats = data?.stats
  const tours = data?.tours ?? []
  const fullName = customer ? `${customer.first_name} ${customer.last_name}` : 'Customer'

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
          <RowActionButton label="View" tone="view" to={`/tours/${tour.tour_id}`}>
            <Eye className="size-3.5" />
          </RowActionButton>
          <RowActionButton label="Edit details" tone="edit" to={`/tours/${tour.tour_id}/edit`}>
            <Pencil className="size-3.5" />
          </RowActionButton>
          {(tour.status === 'ready' || tour.status === 'completed') && tour.viewer_url && (
            <RowActionButton label="Open viewer" tone="neutral" href={tour.viewer_url}>
              <ExternalLink className="size-3.5" />
            </RowActionButton>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title={loading ? 'Customer' : fullName}
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Customers', href: '/customers' },
          { label: loading ? '…' : fullName },
        ]}
        description={customer?.company_name || customer?.designation || undefined}
        showBack
        backTo="/customers"
        actions={
          customerId ? (
            <Button asChild size="sm">
              <Link to="/tours/new" state={{ customerId }}>
                <Plus className="size-4" />
                New tour
              </Link>
            </Button>
          ) : null
        }
      />

      {/* Profile */}
      {loading || !customer ? (
        <Card className="overflow-hidden">
          <Skeleton className="h-36 w-full rounded-none" />
          <CardContent className="flex gap-4 pt-0">
            <Skeleton className="size-20 -mt-10 rounded-full" />
            <div className="mt-4 flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div
            className="h-36 w-full bg-muted bg-cover bg-center"
            style={
              customer.cover_photo_url
                ? { backgroundImage: `url(${customer.cover_photo_url})` }
                : undefined
            }
          />
          <CardContent className="relative pb-6 pt-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
              <Avatar className="size-20 -mt-10 border-4 border-card shadow-sm">
                {customer.profile_photo_url && (
                  <AvatarImage src={customer.profile_photo_url} alt="" />
                )}
                <AvatarFallback className="text-xl">
                  {customer.first_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 sm:pb-1">
                <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                  {fullName}
                </h2>
                {(customer.designation || customer.company_name) && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {[customer.designation, customer.company_name].filter(Boolean).join(' · ')}
                  </p>
                )}
                {customer.tag_line && (
                  <p className="mt-1 text-sm text-muted-foreground/80">{customer.tag_line}</p>
                )}
              </div>
            </div>

            <Separator className="my-5" />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <InfoRow icon={Mail} label="Email" value={customer.email} href={`mailto:${customer.email}`} />
              <InfoRow
                icon={Phone}
                label="Mobile"
                value={`${customer.country_code} ${customer.mobile}`}
                href={`tel:${customer.country_code}${customer.mobile}`}
              />
              {customer.company_name && (
                <InfoRow icon={Building2} label="Company" value={customer.company_name} />
              )}
              {customer.company_website && (
                <InfoRow
                  icon={Globe}
                  label="Website"
                  value={customer.company_website.replace(/^https?:\/\//, '')}
                  href={customer.company_website}
                  external
                />
              )}
              {customer.slug && (
                <InfoRow icon={Compass} label="Slug" value={customer.slug} mono />
              )}
            </div>

            {customer.social_links.length > 0 && (
              <>
                <Separator className="my-5" />
                <div className="flex flex-wrap gap-2">
                  {customer.social_links.map((link) => (
                    <Button key={link.id} variant="outline" size="sm" asChild>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.icon_class ? (
                          <i className={`${link.icon_class} text-sm`} aria-hidden />
                        ) : (
                          <ExternalLink className="size-3.5" />
                        )}
                        {link.platform_name || 'Link'}
                      </a>
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tour stats */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !stats ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard label="Total Tours" value={stats.total} icon={Compass} />
            <StatCard label="Uploading" value={stats.uploading} icon={UploadCloud} tone="warning" />
            <StatCard label="Uploaded" value={stats.uploaded} icon={Clock} tone="info" />
            <StatCard label="Ready" value={stats.ready} icon={CheckCircle2} tone="success" />
            <StatCard label="Failed" value={stats.failed} icon={XCircle} tone="destructive" />
          </>
        )}
      </div>

      {/* Tours table */}
      <div className="mt-4">
        <ListBox
          title="Tours"
          subtitle={
            loading
              ? 'Loading…'
              : `${tours.length} tour${tours.length === 1 ? '' : 's'} for this customer`
          }
        >
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : tours.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No tours yet"
              description="This customer does not have any tours. Create one to get started."
              action={
                <Button asChild size="sm">
                  <Link to="/tours/new" state={{ customerId }}>
                    <Plus className="size-4" />
                    New tour
                  </Link>
                </Button>
              }
            />
          ) : (
            <DataTable columns={columns} data={tours} keyExtractor={(t) => t.id} />
          )}
        </ListBox>
      </div>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
  external,
  mono,
}: {
  icon: typeof Mail
  label: string
  value: string
  href?: string
  external?: boolean
  mono?: boolean
}) {
  const valueClass = mono
    ? 'font-mono text-sm text-foreground'
    : 'text-sm text-foreground'

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {href ? (
          <a
            href={href}
            className={`${valueClass} truncate underline-offset-2 hover:underline`}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {value}
          </a>
        ) : (
          <p className={`${valueClass} truncate`}>{value}</p>
        )}
      </div>
    </div>
  )
}
