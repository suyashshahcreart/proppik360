import { Badge, type BadgeProps } from '@/components/ui/badge'
import type { TourStatus } from '@/types'

const STATUS_CONFIG: Record<TourStatus, { label: string; variant: BadgeProps['variant'] }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  uploading: { label: 'Uploading', variant: 'warning' },
  ingesting: { label: 'Uploading', variant: 'warning' },
  uploaded: { label: 'Waiting for processor', variant: 'info' },
  processing: { label: 'Processing', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  archived: { label: 'Archived', variant: 'outline' },
}

export function StatusBadge({ status }: { status: TourStatus }) {
  const config = STATUS_CONFIG[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
