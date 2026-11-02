import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import type { User } from '@/types'
import { can } from '@/components/shared/PermissionGate'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { buildTourPurgePrefixUrls } from '@/lib/viewer-url'
import { cn } from '@/lib/utils'

interface TourCachePurgeButtonProps {
  tourId: string
  user: User
  size?: 'sm' | 'default' | 'icon'
  variant?: 'outline' | 'secondary' | 'default'
  className?: string
  /** When false, hide unless user has permission (default true). */
  showWhenNotLive?: boolean
  isLive?: boolean
}

export function TourCachePurgeButton({
  tourId,
  user,
  size = 'sm',
  variant = 'outline',
  className,
  showWhenNotLive = true,
  isLive = true,
}: TourCachePurgeButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prefixes, setPrefixes] = useState<string[]>(() => buildTourPurgePrefixUrls(tourId))
  const [loadingPrefixes, setLoadingPrefixes] = useState(false)
  const [adminPurgeSkipped, setAdminPurgeSkipped] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingPrefixes(true)
    void api.tours
      .purgeCachePreview(tourId)
      .then((res) => {
        if (cancelled) return
        if (res.prefixes.length > 0) setPrefixes(res.prefixes)
        setAdminPurgeSkipped(Boolean(res.adminPurgeSkipped))
      })
      .catch(() => {
        if (!cancelled) setPrefixes(buildTourPurgePrefixUrls(tourId))
      })
      .finally(() => {
        if (!cancelled) setLoadingPrefixes(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tourId])

  if (!can(user, 'cache_purge_tour')) return null
  if (!showWhenNotLive && !isLive) return null

  async function handleConfirm() {
    setLoading(true)
    try {
      const result = await api.tours.purgeCache(tourId)
      if (result.warnings?.length) {
        for (const w of result.warnings) {
          toast.warning(w)
        }
      }
      toast.success(
        result.mode === 'files' && result.fileCount
          ? `CDN cache cleared (${result.fileCount} files)`
          : 'CDN cache cleared for this tour',
      )
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(className)}
        onClick={() => setOpen(true)}
      >
        <RefreshCw className="size-4" />
        Clear CDN cache
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Clear CDN cache for this tour?"
        description="Visitors may see old 360° content until Cloudflare edge cache is purged. R2 files are not deleted."
        confirmLabel="Purge cache"
        destructive={false}
        loading={loading}
        onConfirm={() => void handleConfirm()}
      >
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Tour ID: <span className="font-mono text-foreground">{tourId}</span>
          </p>
          <p className="font-medium text-foreground">Prefixes (from server):</p>
          {loadingPrefixes ? (
            <p className="text-xs text-muted-foreground">Loading purge targets…</p>
          ) : (
            <ul className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {prefixes.map((p) => (
                <li key={p} className="break-all">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {adminPurgeSkipped ? (
            <p className="text-xs text-muted-foreground">
              Tour-admin CDN purge skipped (set CLOUDFLARE_ADMIN_ZONE_ID on the server to include{' '}
              tour.proppik.cloud).
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  )
}
