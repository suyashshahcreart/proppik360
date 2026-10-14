import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'
import type { TourStatus } from '@/types'

export interface TourOption {
  id: string
  name: string
  status: TourStatus
}

interface TourSearchSelectProps {
  value: string
  onValueChange: (value: string) => void
  tours: TourOption[]
  placeholder?: string
  triggerClassName?: string
  disabled?: boolean
}

export function TourSearchSelect({
  value,
  onValueChange,
  tours,
  placeholder = 'Choose a tour…',
  triggerClassName,
  disabled,
}: TourSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = tours.find((tour) => tour.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tours
    return tours.filter((tour) => {
      const label = `${tour.name} ${tour.id}`.toLowerCase()
      return label.includes(q)
    })
  }, [tours, query])

  function formatLabel(tour: TourOption): string {
    return tour.name
  }

  return (
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
          className={cn(
            'h-9 w-full justify-between bg-card px-3 font-normal shadow-sm',
            !selected && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <span className="truncate">
            {selected ? (
              <>
                {formatLabel(selected)}
                <span className="ml-1.5 font-mono text-xs text-muted-foreground">({selected.id})</span>
              </>
            ) : (
              placeholder
            )}
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
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching tours</li>
          ) : (
            filtered.map((tour) => {
              const picked = tour.id === value
              return (
                <li key={tour.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/80',
                      picked && 'bg-primary/10 text-primary',
                    )}
                    onClick={() => {
                      onValueChange(tour.id)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <Check className={cn('mt-0.5 size-3.5 shrink-0', picked ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{tour.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <code className="font-mono text-[10px] text-muted-foreground">{tour.id}</code>
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
  )
}
