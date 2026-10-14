import { useState } from 'react'
import { ExternalLink, FileText, Loader2, Trash2 } from 'lucide-react'
import type { MediaListItem } from '@/types'
import { api } from '@/services/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { collectionLabel, collectionVariant } from './MediaCard'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface MediaPreviewDialogProps {
  item: MediaListItem | null
  onClose: () => void
  onDeleted: (id: string) => void
  canDelete: boolean
}

export function MediaPreviewDialog({ item, onClose, onDeleted, canDelete }: MediaPreviewDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!item) return null
  const isImage = item.mime.startsWith('image/')

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.media.delete(item.id)
      onDeleted(item.id)
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Media details</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center rounded-lg border border-border bg-secondary/40 p-4">
          {isImage ? (
            <img
              src={item.url}
              alt={item.original_name ?? 'preview'}
              className="max-h-56 rounded-md object-contain"
            />
          ) : (
            <FileText className="size-12 text-muted-foreground" />
          )}
        </div>

        <dl className="grid grid-cols-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Filename</dt>
          <dd className="col-span-2 truncate text-foreground">{item.original_name ?? '—'}</dd>

          <dt className="text-muted-foreground">Type</dt>
          <dd className="col-span-2 text-foreground">{item.mime}</dd>

          <dt className="text-muted-foreground">Size</dt>
          <dd className="col-span-2 text-foreground">{formatBytes(item.size)}</dd>

          <dt className="text-muted-foreground">Uploaded</dt>
          <dd className="col-span-2 text-foreground">{new Date(item.created_at).toLocaleString()}</dd>

          {item.links.length > 0 && (
            <>
              <dt className="text-muted-foreground">Collections</dt>
              <dd className="col-span-2 flex flex-wrap gap-1">
                {item.links.map((l) => (
                  <Badge key={l.id} variant={collectionVariant(l.collection)}>
                    {collectionLabel(l.collection)}
                  </Badge>
                ))}
              </dd>
            </>
          )}

          <dt className="text-muted-foreground">R2 key</dt>
          <dd className="col-span-2 truncate font-mono text-xs text-muted-foreground">{item.key}</dd>
        </dl>

        {confirmingDelete && (
          <div className="rounded-md bg-destructive-subtle p-3 text-sm text-destructive">
            Delete this file permanently? All links to it will be removed too.
          </div>
        )}

        <Separator />

        <DialogFooter className="!mx-0 !mb-0 !border-0 !px-0 !py-0">
          <Button variant="outline" size="sm" asChild className="mr-auto">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Open original
            </a>
          </Button>

          {canDelete && !confirmingDelete && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
          {canDelete && confirmingDelete && (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting && <Loader2 className="size-3.5 animate-spin" />}
                Yes, delete
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
