import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type ActionTone = 'view' | 'edit' | 'delete' | 'neutral'

const toneClass: Record<ActionTone, string> = {
  view: 'border-transparent bg-info-subtle text-info hover:bg-info/15 hover:text-info',
  edit: 'border-transparent bg-accent text-accent-foreground hover:bg-primary/15 hover:text-primary',
  delete: 'border-transparent bg-destructive-subtle text-destructive hover:bg-destructive/15 hover:text-destructive',
  neutral: 'border-transparent bg-secondary text-muted-foreground hover:bg-secondary hover:text-foreground',
}

export function RowActionButton({
  label,
  tone = 'neutral',
  onClick,
  disabled,
  href,
  to,
  state,
  children,
}: {
  label: string
  tone?: ActionTone
  onClick?: () => void
  disabled?: boolean
  href?: string
  /** In-app route. Shows the label in a tooltip, same as the other row icons. */
  to?: string
  state?: unknown
  children: ReactNode
}) {
  const className = cn('size-8 shrink-0', toneClass[tone])

  const button = to ? (
    <Button variant="outline" size="icon" className={className} asChild>
      <Link to={to} state={state} aria-label={label}>
        {children}
      </Link>
    </Button>
  ) : href ? (
    <Button variant="outline" size="icon" className={className} asChild>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
        {children}
      </a>
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

interface RowActionsProps {
  onView?: () => void
  onEdit?: () => void
  onDelete?: () => void
  viewHref?: string
  /** In-app route for View (preferred over viewHref for SPA navigation). */
  viewTo?: string
  viewDisabled?: boolean
  editDisabled?: boolean
  deleteDisabled?: boolean
  /** Extra action buttons rendered before the standard set */
  children?: ReactNode
  className?: string
}

/** Soft tinted icon buttons for table action columns (View / Edit / Delete). */
export function RowActions({
  onView,
  onEdit,
  onDelete,
  viewHref,
  viewTo,
  viewDisabled,
  editDisabled,
  deleteDisabled,
  children,
  className,
}: RowActionsProps) {
  return (
    <div className={cn('flex items-center justify-end gap-1.5', className)}>
      {children}
      {(onView || viewHref || viewTo) && (
        <RowActionButton
          label="View"
          tone="view"
          onClick={onView}
          href={viewHref}
          to={viewTo}
          disabled={viewDisabled}
        >
          <Eye className="size-3.5" />
        </RowActionButton>
      )}
      {onEdit && (
        <RowActionButton label="Edit" tone="edit" onClick={onEdit} disabled={editDisabled}>
          <Pencil className="size-3.5" />
        </RowActionButton>
      )}
      {onDelete && (
        <RowActionButton label="Delete" tone="delete" onClick={onDelete} disabled={deleteDisabled}>
          <Trash2 className="size-3.5" />
        </RowActionButton>
      )}
    </div>
  )
}
