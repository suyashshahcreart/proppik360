import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react'
import { useCardFullscreen } from '@/hooks/useCardFullscreen'
import { SearchBox } from '@/components/shared/SearchBox'
import { Pagination } from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function ListBoxIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-full border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export interface ListBoxProps {
  title: string
  subtitle?: string
  /** Extra controls in the card header (e.g. view toggle) — placed before icon buttons */
  headerActions?: ReactNode
  /** Extra toolbar row items (filters) next to entries-per-page */
  toolbarExtra?: ReactNode
  children: ReactNode
  className?: string

  onRefresh?: () => void
  refreshing?: boolean
  collapsible?: boolean
  fullscreenable?: boolean
  /** Optional close control (hides card body / calls handler) */
  onClose?: () => void

  /** Search — omit to hide the search field */
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string

  /** Pagination — omit `totalItems` to hide footer controls */
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  pageSize?: number
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  totalItems?: number
  from?: number
  to?: number

  /** Hide entries-per-page selector while keeping footer count */
  hidePageSize?: boolean
  /** Hide search while keeping other toolbar items */
  hideSearch?: boolean
  /** Extra classes on the scroll/content region below the header */
  contentClassName?: string
}

export function ListBox({
  title,
  subtitle,
  headerActions,
  toolbarExtra,
  children,
  className,
  onRefresh,
  refreshing = false,
  collapsible = true,
  fullscreenable = true,
  onClose,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  page = 1,
  totalPages = 1,
  onPageChange,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  onPageSizeChange,
  totalItems,
  from,
  to,
  hidePageSize = false,
  hideSearch = false,
  contentClassName,
}: ListBoxProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { isFullscreen, toggle: toggleFullscreen } = useCardFullscreen()

  const showSearch = onSearchChange != null && !hideSearch
  const showToolbar = showSearch || toolbarExtra || (onPageSizeChange != null && !hidePageSize)
  const showFooter = totalItems != null

  const rangeFrom = from ?? (totalItems === 0 ? 0 : (page - 1) * pageSize + 1)
  const rangeTo = to ?? (totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems ?? 0))

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        isFullscreen && 'fixed inset-0 z-50 m-0 flex h-dvh flex-col overflow-hidden rounded-none shadow-none',
        className,
      )}
    >
      {/* Card header — title/subtitle left, optional extras + chrome icons right */}
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {headerActions}
          {onRefresh && (
            <ListBoxIconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            </ListBoxIconButton>
          )}
          {collapsible && (
            <ListBoxIconButton
              label={collapsed ? 'Expand content' : 'Collapse content'}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </ListBoxIconButton>
          )}
          {fullscreenable && (
            <ListBoxIconButton
              label={isFullscreen ? 'Exit card fullscreen' : 'Expand card fullscreen'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </ListBoxIconButton>
          )}
          {onClose && (
            <ListBoxIconButton label="Close" onClick={onClose}>
              <X className="size-3.5" />
            </ListBoxIconButton>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {showToolbar && (
            <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                {onPageSizeChange != null && !hidePageSize && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Show</span>
                    <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                      <SelectTrigger className="h-8 w-[4.5rem] bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pageSizeOptions.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">entries</span>
                  </div>
                )}
                {toolbarExtra}
              </div>
              {showSearch && (
                <SearchBox
                  value={search ?? ''}
                  onChange={onSearchChange}
                  placeholder={searchPlaceholder}
                  className="w-full sm:w-64"
                />
              )}
            </div>
          )}

          <div
            className={cn(
              isFullscreen && 'min-h-0 flex-1 overflow-auto',
              contentClassName,
            )}
          >
            {children}
          </div>

          {showFooter && (
            <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm text-muted-foreground">
                Showing {rangeFrom} to {rangeTo} of {totalItems} entr{totalItems === 1 ? 'y' : 'ies'}
              </p>
              {onPageChange && (
                <Pagination page={page} totalPages={Math.max(1, totalPages)} onPageChange={onPageChange} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
