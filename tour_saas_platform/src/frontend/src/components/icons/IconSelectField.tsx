import { useState } from 'react'
import { ImageIcon, X } from 'lucide-react'
import { formatCategoryIconLabel } from '@/lib/category-icons'
import { CategoryIcon } from '@/components/icons/CategoryIcon'
import { IconPickerDialog } from '@/components/icons/IconPickerDialog'
import { FormField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface IconSelectFieldProps {
  value: string | null
  onChange: (value: string | null) => void
  label?: string
  hint?: string
  className?: string
}

export function IconSelectField({
  value,
  onChange,
  label = 'Icon',
  hint,
  className,
}: IconSelectFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const openPicker = () => setPickerOpen(true)

  return (
    <>
      <FormField label={label} hint={hint} className={className}>
        <div
          role="button"
          tabIndex={0}
          aria-label={value ? `Icon: ${formatCategoryIconLabel(value)}. Click to change.` : 'No icon selected. Click to browse icons.'}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPicker()
            }
          }}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-md border border-input bg-card px-3 py-1.5 text-sm shadow-sm transition-colors',
            'hover:border-ring/50 hover:bg-accent/50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring',
          )}
        >
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary/60',
              !value && 'text-muted-foreground',
            )}
          >
            {value ? (
              <CategoryIcon icon={value} className="size-5" imgClassName="size-5" />
            ) : (
              <ImageIcon className="size-5" />
            )}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium text-foreground">
              {value ? formatCategoryIconLabel(value) : 'No icon selected'}
            </p>
            {value && (
              <p className="truncate text-xs text-muted-foreground">{value}</p>
            )}
          </div>

          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Clear icon"
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
            >
              <X className="size-4" />
            </Button>
          )}

          <span
            className={cn(
              'inline-flex h-8 shrink-0 items-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm',
              'pointer-events-none',
            )}
          >
            Browse
          </span>
        </div>
      </FormField>

      <IconPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={value}
        onSelect={onChange}
      />
    </>
  )
}
