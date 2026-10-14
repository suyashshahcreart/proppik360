import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info'
  hint?: string
}

const toneClasses: Record<Required<StatCardProps>['tone'], string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  destructive: 'bg-destructive-subtle text-destructive',
  info: 'bg-info-subtle text-info',
}

export function StatCard({ label, value, icon: Icon, tone = 'default', hint }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}>
          <Icon className="size-4.5" />
        </div>
      </div>
    </Card>
  )
}
