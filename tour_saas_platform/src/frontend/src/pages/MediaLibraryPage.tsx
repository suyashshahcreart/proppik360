// ============================================================
// Media Library Page — /system/media
//
// Cloud-file-manager style experience: grid/list toggle, filters,
// search, pagination, drag-and-drop upload, and a preview dialog
// with metadata + delete. Uses the existing /api/system/media
// endpoints (list/filter/paginate, get, upload, delete).
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { LayoutGrid, List, Plus, Images, FileText, ExternalLink } from 'lucide-react'
import type { MediaListItem, MediaCollection } from '../types'
import { api } from '../services/api'
import { EmptyState } from '@/components/shared/EmptyState'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { PageHeader } from '@/components/shared/PageHeader'
import { RowActions, RowActionButton } from '@/components/shared/RowActions'
import { MediaCard, collectionLabel, collectionVariant } from '@/components/media/MediaCard'
import { MediaPreviewDialog } from '@/components/media/MediaPreviewDialog'
import { FileDropzone } from '@/components/media/FileDropzone'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const COLLECTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Collections' },
  { value: 'tour_thumbnail', label: 'Tour Thumbnail' },
  { value: 'tour_logo', label: 'Tour Logo' },
  { value: 'tour_assets', label: 'Tour Assets' },
  { value: 'customer_profile', label: 'Customer Profile' },
  { value: 'customer_cover', label: 'Customer Cover' },
  { value: 'customer_seo', label: 'Customer SEO' },
]

const MIME_FILTERS = [
  { value: 'all', label: 'All Types' },
  { value: 'image/', label: 'Images' },
  { value: 'application/pdf', label: 'PDFs' },
]

const DEFAULT_PAGE_SIZE = 30
const PAGE_SIZE_OPTIONS = [10, 25, 30, 50, 100]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Upload dialog ────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (item: MediaListItem) => void
}) {
  const [collection, setCollection] = useState<MediaCollection>('tour_thumbnail')

  const maxBytes =
    collection === 'tour_assets'
      ? 10 * 1024 * 1024
      : collection.includes('thumbnail') || collection.includes('logo')
        ? 5 * 1024 * 1024
        : collection === 'customer_cover'
          ? 4 * 1024 * 1024
          : 2 * 1024 * 1024

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Collection</label>
            <Select value={collection} onValueChange={(v) => setCollection(v as MediaCollection)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTIONS.filter((c) => c.value !== 'all').map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FileDropzone
            collection={collection}
            accept={collection === 'tour_assets' ? 'image/*,application/pdf' : 'image/*'}
            maxBytes={maxBytes}
            uploadFn={(file, onProgress) => api.media.upload(file, { collection }, onProgress)}
            onUploaded={async (result) => {
              try {
                const full = await api.media.get(result.id)
                onUploaded(full)
              } catch {
                onUploaded({ ...result, links: [] } as MediaListItem)
              }
              onOpenChange(false)
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────

interface MediaLibraryPageProps {
  canUpload: boolean
  canDelete: boolean
}

export function MediaLibraryPage({ canUpload, canDelete }: MediaLibraryPageProps) {
  const [items, setItems] = useState<MediaListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterCollection, setFilterCollection] = useState('all')
  const [filterMime, setFilterMime] = useState('all')
  const [search, setSearch] = useState('')

  const [detailItem, setDetailItem] = useState<MediaListItem | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.media.list({
        collection: filterCollection !== 'all' ? (filterCollection as MediaCollection) : undefined,
        mime: filterMime !== 'all' ? filterMime : undefined,
        search: search || undefined,
        page,
        per_page: pageSize,
      })
      setItems(result.items)
      setTotal(result.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load media')
    } finally {
      setLoading(false)
    }
  }, [filterCollection, filterMime, search, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [filterCollection, filterMime, search, pageSize])

  const handleDeleted = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setTotal((prev) => prev - 1)
  }

  const handleUploaded = (item: MediaListItem) => {
    setItems((prev) => [item, ...prev])
    setTotal((prev) => prev + 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = total === 0 ? 0 : Math.min(page * pageSize, total)

  const listColumns: DataTableColumn<MediaListItem>[] = [
    {
      key: 'preview',
      header: '',
      className: 'w-14',
      render: (item) =>
        item.mime.startsWith('image/') ? (
          <img
            src={item.url}
            alt=""
            className="size-10 cursor-pointer rounded-md object-cover"
            onClick={() => setDetailItem(item)}
          />
        ) : (
          <FileText className="size-8 text-muted-foreground" />
        ),
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (item) => item.original_name ?? item.key,
      render: (item) => (
        <div>
          <button
            className="truncate text-left text-sm font-medium text-primary hover:underline"
            onClick={() => setDetailItem(item)}
          >
            {item.original_name ?? item.key.split('/').pop()}
          </button>
          <div className="font-mono text-[10px] text-muted-foreground">{item.id}</div>
        </div>
      ),
    },
    {
      key: 'collection',
      header: 'Collection(s)',
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.links.map((l) => (
            <Badge key={l.id} variant={collectionVariant(l.collection)}>
              {collectionLabel(l.collection)}
            </Badge>
          ))}
          {item.links.length === 0 && <Badge variant="warning">Unlinked</Badge>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      sortValue: (item) => item.mime,
      render: (item) => <Badge variant="outline">{item.mime}</Badge>,
    },
    {
      key: 'size',
      header: 'Size',
      sortable: true,
      sortValue: (item) => item.size,
      render: (item) => <span className="text-sm text-muted-foreground">{formatBytes(item.size)}</span>,
    },
    {
      key: 'created',
      header: 'Uploaded',
      sortable: true,
      sortValue: (item) => new Date(item.created_at).getTime(),
      render: (item) => (
        <span className="text-sm text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (item) => (
        <RowActions
          onView={() => setDetailItem(item)}
          onDelete={canDelete ? () => setDetailItem(item) : undefined}
        >
          <RowActionButton label="Open file" tone="neutral" href={item.url}>
            <ExternalLink className="size-3.5" />
          </RowActionButton>
        </RowActions>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Media Library"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'System', href: '/system/users' },
          { label: 'Media' },
        ]}
        showBack
        backTo="/"
        actions={
          canUpload ? (
            <Button size="sm" onClick={() => setShowUpload(true)}>
              <Plus className="size-4" />
              Upload
            </Button>
          ) : undefined
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}

      <ListBox
        title="Media List"
        subtitle="Browse, filter, and manage uploaded media files"
        headerActions={
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'grid' | 'list')}>
            <TabsList>
              <TabsTrigger value="grid">
                <LayoutGrid className="size-4" />
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="size-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
        toolbarExtra={
          <>
            <Select value={filterCollection} onValueChange={setFilterCollection}>
              <SelectTrigger className="h-8 w-full bg-background sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterMime} onValueChange={setFilterMime}>
              <SelectTrigger className="h-8 w-full bg-background sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIME_FILTERS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        onRefresh={load}
        refreshing={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by filename…"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={setPageSize}
        totalItems={total}
        from={from}
        to={to}
      >
        {loading ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 md:grid-cols-6 sm:px-5">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : (
            <Skeleton className="mx-4 mb-4 h-64 w-auto sm:mx-5" />
          )
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title="No media found"
            description="Upload a file or adjust your filters."
            action={
              canUpload ? (
                <Button size="sm" onClick={() => setShowUpload(true)}>
                  Upload your first file
                </Button>
              ) : undefined
            }
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 md:grid-cols-6 sm:px-5">
            {items.map((item) => (
              <MediaCard key={item.id} item={item} onClick={() => setDetailItem(item)} />
            ))}
          </div>
        ) : (
          <DataTable columns={listColumns} data={items} keyExtractor={(i) => i.id} />
        )}
      </ListBox>

      <MediaPreviewDialog item={detailItem} onClose={() => setDetailItem(null)} onDeleted={handleDeleted} canDelete={canDelete} />

      <UploadDialog open={showUpload} onOpenChange={setShowUpload} onUploaded={handleUploaded} />
    </div>
  )
}
