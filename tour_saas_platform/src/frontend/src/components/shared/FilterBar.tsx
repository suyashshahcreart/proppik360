import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  children: ReactNode
  className?: string
}

/** Consistent wrapper for filter/search toolbars above tables and grids. */
export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap', className)}>
      {children}
    </div>
  )
}
