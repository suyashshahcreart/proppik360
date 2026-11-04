import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnalyticsTourSubNav } from '@/components/analytics/AnalyticsTourSubNav'
import { DateRangeBar } from '@/components/analytics/DateRangeBar'
import { formatDuration } from '@/lib/analytics/format'
import {
  apiQuery,
  loadAudienceFilter,
  saveAudienceFilter,
  type AudienceFilter,
  type DatePreset,
} from '@/lib/analytics/query-params'
import { api, type AnalyticsUrlRow } from '@/services/api'

export function AnalyticsTourUrlsPage() {
  const { tourId = '' } = useParams()
  const [rows, setRows] = useState<AnalyticsUrlRow[]>([])
  const [preset, setPreset] = useState<DatePreset>('30d')
  const [audience, setAudience] = useState<AudienceFilter>('real')
  const q = useMemo(() => apiQuery(audience, preset), [audience, preset])

  useEffect(() => {
    setAudience(loadAudienceFilter())
  }, [])

  useEffect(() => {
    if (!tourId) return
    saveAudienceFilter(audience)
    void api.analytics.tour(tourId).urls(q).then(setRows).catch(() => setRows([]))
  }, [tourId, q, audience])

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/analytics" className="text-sm text-primary hover:underline">
        ← Overview
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">URLs</h1>
      <AnalyticsTourSubNav tourId={tourId} />
      <DateRangeBar preset={preset} onPreset={setPreset} audience={audience} onAudience={setAudience} />
      <table className="mt-6 w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="p-3 text-left">URL</th>
            <th className="p-3">Sessions</th>
            <th className="p-3">Visitors</th>
            <th className="p-3">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.url} className="border-t border-border">
              <td className="p-3 font-mono text-xs">{r.url}</td>
              <td className="p-3 text-center">{r.sessions}</td>
              <td className="p-3 text-center">{r.visitors}</td>
              <td className="p-3 text-center">{formatDuration(r.avg_session_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
