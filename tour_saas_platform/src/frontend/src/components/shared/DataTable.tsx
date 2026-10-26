import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface DataTableColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  headerClassName?: string
  /** Enable header click sorting for this column */
  sortable?: boolean
  /** Value used for sorting; defaults to stringifying render output (prefer providing this) */
  sortValue?: (row: T) => string | number | null | undefined
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  loading?: boolean
  skeletonRows?: number
  emptyState?: ReactNode
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
}

type SortDir = 'asc' | 'desc'

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  loading = false,
  skeletonRows = 5,
  emptyState,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sortedData = useMemo(() => {
    if (!sortKey) return data
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortable) return data

    const copy = [...data]
    copy.sort((a, b) => {
      const av = col.sortValue?.(a)
      const bv = col.sortValue?.(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      if (as < bs) return sortDir === 'asc' ? -1 : 1
      if (as > bs) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [columns, data, sortDir, sortKey])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (!loading && data.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-border hover:bg-transparent">
          {columns.map((col) => {
            const active = sortKey === col.key
            return (
              <TableHead
                key={col.key}
                className={cn(
                  'bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  col.sortable && 'cursor-pointer select-none',
                  col.headerClassName,
                )}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                aria-sort={
                  col.sortable && active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {col.sortable ? (
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {active ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="size-3.5 opacity-70" />
                      ) : (
                        <ArrowDown className="size-3.5 opacity-70" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3.5 opacity-40" />
                    )}
                  </span>
                ) : (
                  col.header
                )}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : sortedData.map((row) => (
              <TableRow
                key={keyExtractor(row)}
                title={onRowDoubleClick ? 'Double-click to copy the tour link' : undefined}
                onClick={() => onRowClick?.(row)}
                onDoubleClick={(event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('a, button, input, textarea, [role="menuitem"]')) return
                  onRowDoubleClick?.(row)
                }}
                className={cn((onRowClick || onRowDoubleClick) && 'cursor-pointer', rowClassName?.(row))}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}
