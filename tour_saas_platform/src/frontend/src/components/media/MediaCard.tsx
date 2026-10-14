import { FileText, ImageOff } from 'lucide-react'
import type { MediaListItem } from '@/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COLLECTION_LABELS: Record<string, string> = {
  tour_thumbnail: 'Tour Thumbnail',
  tour_logo: 'Tour Logo',
  tour_assets: 'Tour Assets',
  customer_profile: 'Customer Profile',
  customer_cover: 'Customer Cover',
  customer_seo: 'Customer SEO',
}

function collectionLabel(col: string): string {
  return COLLECTION_LABELS[col] ?? col
}

function collectionVariant(col: string): 'default' | 'success' {
  return col.startsWith('tour_') ? 'default' : 'success'
}

interface MediaCardProps {
  item: MediaListItem
  selected?: boolean
  onClick?: () => void
}

export function MediaCard({ item, selected, onClick }: MediaCardProps) {
  const isImage = item.mime.startsWith('image/')

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-all hover:shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-secondary/50">
        {isImage ? (
          <img
            src={item.url}
            alt={item.original_name ?? 'media'}
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <FileText className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <p className="truncate text-xs font-medium text-foreground" title={item.original_name ?? item.key}>
          {item.original_name ?? item.key.split('/').pop()}
        </p>
        <div className="flex flex-wrap gap-1">
          {item.links.slice(0, 1).map((l) => (
            <Badge key={l.id} variant={collectionVariant(l.collection)} className="px-1.5 py-0 text-[10px]">
              {collectionLabel(l.collection)}
            </Badge>
          ))}
          {item.links.length === 0 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
              <ImageOff className="size-2.5" />
              Unlinked
            </Badge>
          )}
          {item.links.length > 1 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              +{item.links.length - 1}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}

export { collectionLabel, collectionVariant }
