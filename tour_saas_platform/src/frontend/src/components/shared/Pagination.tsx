import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
  /** When true, render controls even for a single page (disabled ends). Default true for list-box footer. */
  alwaysShow?: boolean
}

function pageWindow(page: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  return Array.from({ length: 5 }, (_, i) => start + i)
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
  alwaysShow = true,
}: PaginationProps) {
  if (totalPages < 1) return null
  if (!alwaysShow && totalPages <= 1) return null

  const pages = pageWindow(page, totalPages)

  return (
    <nav className={cn('flex items-center justify-center gap-1', className)} aria-label="Pagination">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page <= 1}
        onClick={() => onPageChange(1)}
        aria-label="First page"
      >
        <ChevronsLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </Button>
      {pages.map((p) => (
        <Button
          key={p}
          variant={p === page ? 'default' : 'outline'}
          size="icon"
          className="size-8 text-sm"
          onClick={() => onPageChange(p)}
          aria-label={`Page ${p}`}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </Button>
      ))}
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page >= totalPages}
        onClick={() => onPageChange(totalPages)}
        aria-label="Last page"
      >
        <ChevronsRight className="size-4" />
      </Button>
    </nav>
  )
}
