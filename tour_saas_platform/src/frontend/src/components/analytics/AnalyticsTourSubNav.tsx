import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function AnalyticsTourSubNav({ tourId }: { tourId: string }) {
  const base = `/analytics/tours/${tourId}`
  const links = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/urls`, label: 'URLs', end: true },
    { to: `${base}/visitors`, label: 'Visitors', end: true },
  ]
  return (
    <nav className="mt-4 flex flex-wrap gap-2 border-b border-border pb-2">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
