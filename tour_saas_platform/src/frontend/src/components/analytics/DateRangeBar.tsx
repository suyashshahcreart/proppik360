import type { AudienceFilter, DatePreset } from '@/lib/analytics/query-params'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

const AUDIENCE: { id: AudienceFilter; label: string }[] = [
  { id: 'real', label: 'Real only' },
  { id: 'preview', label: 'Include preview' },
  { id: 'test', label: 'Include test/demo' },
]

export function DateRangeBar({
  preset,
  onPreset,
  audience,
  onAudience,
  hiddenNote,
  onRefresh,
  refreshing,
}: {
  preset: DatePreset
  onPreset: (p: DatePreset) => void
  audience: AudienceFilter
  onAudience: (a: AudienceFilter) => void
  hiddenNote?: string | null
  onRefresh?: () => void
  refreshing?: boolean
}) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={preset === p.id ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => onPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 lg:ml-auto">
          {AUDIENCE.map((a) => (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={audience === a.id ? 'default' : 'outline'}
              className={cn('text-xs sm:text-sm', audience === a.id && 'bg-foreground text-background')}
              onClick={() => onAudience(a.id)}
            >
              {a.label}
            </Button>
          ))}
          {onRefresh ? (
            <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null}
        </div>
      </div>
      {hiddenNote ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {hiddenNote}
        </p>
      ) : null}
    </div>
  )
}
