import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

/** BrokerX-style uppercase field label + hint under the control. */
export function SettingsField({
  label,
  htmlFor,
  required,
  hint,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label
        htmlFor={htmlFor}
        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** White card panel: title + optional enable switch, body, footer actions. */
export function SettingsPanel({
  title,
  description,
  enabled,
  onEnabledChange,
  enableLabel = 'Enabled',
  enableDisabled,
  children,
  footer,
  className,
}: {
  title: string
  description?: string
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
  enableLabel?: string
  enableDisabled?: boolean
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {onEnabledChange != null && enabled != null ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <Label htmlFor={`switch-${title}`} className="sr-only">
              {enableLabel}
            </Label>
            <Switch
              id={`switch-${title}`}
              checked={enabled}
              disabled={enableDisabled}
              onCheckedChange={onEnabledChange}
            />
          </div>
        ) : null}
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3.5">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
