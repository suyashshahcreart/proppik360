// ============================================================
// MediaPickerModal — browse & select an existing media library item
//
// For future use when a feature needs to attach an existing media
// item to an entity/collection instead of uploading a new file.
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { FileText, Search } from 'lucide-react'
import type { MediaListItem, MediaCollection } from '@/types'
import { api } from '@/services/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { cn } from '@/lib/utils'

interface MediaPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (item: MediaListItem) => void
  /** Restrict picker to a specific collection */
  collection?: MediaCollection
  title?: string
}

const PER_PAGE = 24

export function MediaPickerModal({ open, onOpenChange, onSelect, collection, title = 'Select Media' }: MediaPickerModalProps) {
  const [items, setItems] = useState<MediaListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.media.list({ collection, search: search || undefined, page, per_page: PER_PAGE })
      setItems(result.items)
      setTotal(result.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load media')
    } finally {
      setLoading(false)
    }
  }, [open, collection, search, page])

  useEffect(() => {
    if (open) {
      setSelected(null)
      load()
    }
  }, [open, load])

  useEffect(() => {
    setPage(1)
  }, [search])

  const totalPages = Math.ceil(total / PER_PAGE)

  const handleSelect = () => {
    const item = items.find((i) => i.id === selected)
    if (item) onSelect(item)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by filename…" className="pl-8" />
        </div>

        {error && <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={FileText} title="No media found" />
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={cn(
                    'flex flex-col overflow-hidden rounded-lg border-2 bg-card text-left transition-colors',
                    selected === item.id ? 'border-primary' : 'border-border',
                  )}
                >
                  <div className="flex aspect-square items-center justify-center bg-secondary/50">
                    {item.mime.startsWith('image/') ? (
                      <img src={item.url} alt="" className="size-full object-cover" />
                    ) : (
                      <FileText className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <p className="truncate p-1.5 text-[11px] text-foreground">
                    {item.original_name ?? item.key.split('/').pop()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {total} item{total !== 1 ? 's' : ''} total
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!selected} onClick={handleSelect}>
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
