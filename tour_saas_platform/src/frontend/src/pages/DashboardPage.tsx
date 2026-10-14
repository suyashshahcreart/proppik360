import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { Compass, UploadCloud, CheckCircle2, XCircle, Clock, Plus } from 'lucide-react'
import { api } from '../services/api'
import { formatBytes } from '../services/uploader'
import type { DashboardStats, TourStatus } from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type RecentTour = DashboardStats['recentTours'][number]

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function DashboardPage() {
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
  const chartData = stats
    ? [
        { name: 'Uploading', value: stats.uploading },
        { name: 'Uploaded', value: stats.uploaded },
        { name: 'Ready', value: stats.ready },
        { name: 'Failed', value: stats.failed },
      ].filter((d) => d.value > 0)
    : []

  const columns: DataTableColumn<RecentTour>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (tour) => tour.name,
      render: (tour) => (
        <div>
          <div className="font-medium text-foreground">{tour.name}</div>
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
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Dashboard"
        breadcrumbs={[{ label: 'Home' }]}
        description="Overview of your tours"
        actions={
          <Button asChild size="sm">
            <Link to="/upload">
              <Plus className="size-4" />
              Upload Tour
            </Link>
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Status breakdown chart — only rendered when there's something to show */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : chartData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No active tours yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {!loading && chartData.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {chartData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent tours */}
        <div className="lg:col-span-2">
          <ListBox
            title="Recent Tours"
            subtitle="Latest tour activity across your account"
            headerActions={
              <Button variant="outline" size="sm" asChild>
                <Link to="/tours">View all</Link>
              </Button>
            }
            onRefresh={loadDashboard}
            refreshing={loading}
            hideSearch
            hidePageSize
            totalItems={data?.recentTours.length ?? 0}
            from={data?.recentTours.length ? 1 : 0}
            to={data?.recentTours.length ?? 0}
          >
            <DataTable
              columns={columns}
              data={data?.recentTours ?? []}
              keyExtractor={(t) => t.id}
              loading={loading}
              skeletonRows={4}
              emptyState={
                <EmptyState
                  icon={Compass}
                  title="No tours yet"
                  description="Upload your first 360° tour to get started."
                  action={
                    <Button asChild size="sm">
                      <Link to="/upload">Upload your first tour</Link>
                    </Button>
                  }
                />
              }
            />
          </ListBox>
        </div>
      </div>
    </div>
  )
}
