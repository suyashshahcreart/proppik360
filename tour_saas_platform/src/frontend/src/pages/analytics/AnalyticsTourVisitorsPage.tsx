import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnalyticsTourSubNav } from '@/components/analytics/AnalyticsTourSubNav'
import { formatDuration, formatIst } from '@/lib/analytics/format'
import { api, type AnalyticsVisitorRow } from '@/services/api'

export function AnalyticsTourVisitorsPage() {
  const { tourId = '' } = useParams()
  const [rows, setRows] = useState<AnalyticsVisitorRow[]>([])

  useEffect(() => {
    if (!tourId) return
    void api.analytics
      .tour(tourId)
      .visitors('exclude_preview=false')
      .then(setRows)
      .catch(() => setRows([]))
  }, [tourId])

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/analytics" className="text-sm text-primary hover:underline">
        ← Overview
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Visitors</h1>
      <AnalyticsTourSubNav tourId={tourId} />
      <ul className="mt-6 space-y-3">
        {rows.map((v) => (
          <li key={v.vid} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-medium font-mono">{v.vid}</p>
            <p className="mt-1 text-muted-foreground">
              {v.visits} visits · {formatDuration(v.total_time_ms)} · First {formatIst(v.first_seen)} · Last{' '}
              {formatIst(v.last_seen)}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-primary">
              {v.sessions.map((sid) => (
                <li key={sid}>
                  <Link to={`/analytics/sessions/${encodeURIComponent(sid)}?tourId=${tourId}`}>{sid}</Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
