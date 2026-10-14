import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PageBreadcrumb {
  label: string
  href?: string
}

interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: PageBreadcrumb[]
  /** Show a secondary Back button (uses history, or `backTo` when provided) */
  showBack?: boolean
  backTo?: string
  backClassName?: string
  /** Override default back navigation (e.g. unsaved-changes guard) */
  onBack?: () => void
  actions?: ReactNode
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  showBack = false,
  backTo,
  backClassName,
  onBack,
  actions,
}: PageHeaderProps) {
  const navigate = useNavigate()

  function handleBack() {
    if (onBack) {
      onBack()
      return
    }
    if (backTo) {
      navigate(backTo)
      return
    }
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  return (
    <div className="mb-4 flex flex-col gap-1">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb className="py-0">
          <BreadcrumbList className="py-0 leading-none">
            {breadcrumbs.flatMap((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              const item = (
                <BreadcrumbItem key={`crumb-${crumb.label}-${index}`}>
                  {isLast || !crumb.href ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              )
              if (index === 0) return [item]
              return [<BreadcrumbSeparator key={`sep-${crumb.label}-${index}`} />, item]
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {(showBack || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {showBack && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={cn(backClassName)}
                onClick={handleBack}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
