import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'
import type { TourStatus } from '@/types'

export interface TourMultiOption {
  tourId: string
  name: string
  status: TourStatus
}

interface TourMultiSearchSelectProps {
  options: TourMultiOption[]
  value: string[]
  onValueChange: (tourIds: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TourMultiSearchSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Search and select tours…',
  disabled,
  className,
}: TourMultiSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedSet = useMemo(() => new Set(value), [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((t) => {
      const label = `${t.name} ${t.tourId}`.toLowerCase()
      return label.includes(q)
    })
  }, [options, query])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selectedSet.has(t.tourId))

  function toggleOne(tourId: string) {
    if (selectedSet.has(tourId)) {
      onValueChange(value.filter((id) => id !== tourId))
    } else {
      onValueChange([...value, tourId])
    }
  }

  function toggleAllFiltered(checked: boolean) {
    if (checked) {
      const merged = new Set(value)
      for (const t of filtered) merged.add(t.tourId)
      onValueChange([...merged])
    } else {
      const remove = new Set(filtered.map((t) => t.tourId))
      onValueChange(value.filter((id) => !remove.has(id)))
    }
  }

  function removeChip(tourId: string) {
    onValueChange(value.filter((id) => id !== tourId))
  }

  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.tourId)),
    [options, selectedSet],
  )

  return (
    <div className={cn('space-y-2', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-auto min-h-9 w-full justify-between bg-card px-3 py-2 font-normal shadow-sm"
          >
            <span className="truncate text-left text-sm text-muted-foreground">
              {value.length === 0 ? placeholder : `${value.length} tour(s) selected`}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or tour id…"
            className="mb-2 h-8 text-sm"
            autoFocus
          />
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/80"
            onClick={() => toggleAllFiltered(!allFilteredSelected)}
          >
            <Check
              className={cn('size-3.5', allFilteredSelected ? 'opacity-100' : 'opacity-30')}
            />
            Select all shown ({filtered.length})
          </button>
          <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matching tours</li>
            ) : (
              filtered.map((tour) => {
                const picked = selectedSet.has(tour.tourId)
                return (
                  <li key={tour.tourId}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/80',
                        picked && 'bg-primary/10',
                      )}
                      onClick={() => toggleOne(tour.tourId)}
                    >
                      <Check
                        className={cn('mt-0.5 size-3.5 shrink-0', picked ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{tour.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <code className="font-mono text-[10px] text-muted-foreground">
                            {tour.tourId}
                          </code>
                          <StatusBadge status={tour.status} />
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((t) => (
            <Badge key={t.tourId} variant="secondary" className="gap-1 pr-1 font-normal">
              <span className="max-w-[140px] truncate">{t.name}</span>
              <span className="font-mono text-[10px] opacity-70">{t.tourId}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-muted"
                aria-label={`Remove ${t.name}`}
                onClick={() => removeChip(t.tourId)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
