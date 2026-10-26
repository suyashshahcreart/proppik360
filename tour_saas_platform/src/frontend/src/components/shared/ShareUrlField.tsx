import type { ReactNode } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Two-column row for tour + admin share links (stacks on small screens). */
export function ShareLinksRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 border-t border-border pt-3 sm:grid-cols-2 sm:items-start',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ShareUrlField({
  label,
  url,
  isLive,
  hintWhenDraft,
  onCopy,
  className,
}: {
  label: string
  url: string
  isLive: boolean
  hintWhenDraft?: string
  onCopy: () => Promise<void>
  className?: string
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-xs font-medium text-foreground">
        {label}
        {!isLive ? ' (preview)' : ''}
      </p>
      <div className="flex items-stretch gap-1.5">
        <div
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-2 font-mono text-xs leading-snug text-foreground break-all select-all"
          title={url}
        >
          {url}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void onCopy().catch(() => toast.error('Could not copy URL'))
          }}
        >
          <Copy className="size-3.5" />
        </Button>
        {isLive ? (
          <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`}>
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
      {!isLive && hintWhenDraft ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hintWhenDraft}</p>
      ) : null}
    </div>
  )
}
