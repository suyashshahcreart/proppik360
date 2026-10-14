import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface CustomerOption {
  id: string
  name: string
  company_name: string | null
}

interface CustomerSearchSelectProps {
  value: string
  onValueChange: (value: string) => void
  customers: CustomerOption[]
  placeholder?: string
  triggerClassName?: string
  disabled?: boolean
}

export function CustomerSearchSelect({
  value,
  onValueChange,
  customers,
  placeholder = 'Choose a customer…',
  triggerClassName,
  disabled,
}: CustomerSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = customers.find((customer) => customer.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((customer) => {
      const label = `${customer.name} ${customer.company_name ?? ''}`.toLowerCase()
      return label.includes(q)
    })
  }, [customers, query])

  function formatLabel(customer: CustomerOption): string {
    return customer.company_name ? `${customer.name} · ${customer.company_name}` : customer.name
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
            'flex h-8 min-h-8 max-h-8 w-full min-w-0 max-w-full justify-between overflow-hidden bg-card px-3 py-0 font-normal leading-none shadow-sm',
            !selected && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selected ? formatLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customers…"
          className="mb-2 h-8 text-sm"
          autoFocus
        />
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching customers</li>
          ) : (
            filtered.map((customer) => {
              const picked = customer.id === value
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/80',
                      picked && 'bg-primary/10 text-primary',
                    )}
                    onClick={() => {
                      onValueChange(customer.id)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <Check className={cn('size-3.5 shrink-0', picked ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{formatLabel(customer)}</span>
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
