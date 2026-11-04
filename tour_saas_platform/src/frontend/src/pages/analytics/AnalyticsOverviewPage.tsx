import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { ApiOfflineBanner } from '@/components/analytics/ApiOfflineBanner'
import { AnalyticsTimezoneSelect } from '@/components/analytics/AnalyticsTimezoneSelect'
import { DateRangeBar } from '@/components/analytics/DateRangeBar'
import { KpiCard } from '@/components/analytics/KpiCard'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDuration, formatIst } from '@/lib/analytics/format'
import {
  apiQuery,
  loadAudienceFilter,
  saveAudienceFilter,
  type AudienceFilter,
  type DatePreset,
} from '@/lib/analytics/query-params'
import { useAnalyticsApiStatus } from '@/hooks/useAnalyticsApiStatus'
import { api, type AnalyticsProjectRow } from '@/services/api'

type ProjectSortKey =
  | 'tour_key'
  | 'visitors'
  | 'sessions'
  | 'avg_session_ms'
  | 'cta_rate'
  | 'last_visited_at'

function sortProjects(rows: AnalyticsProjectRow[], key: ProjectSortKey, asc: boolean): AnalyticsProjectRow[] {
  const copy = [...rows]
  const dir = asc ? 1 : -1
  copy.sort((a, b) => {
    if (key === 'tour_key') return dir * a.tour_key.localeCompare(b.tour_key)
    if (key === 'last_visited_at') {
      const at = a.last_visited_at ? Date.parse(a.last_visited_at) : 0
      const bt = b.last_visited_at ? Date.parse(b.last_visited_at) : 0
      if (at === bt) return a.tour_key.localeCompare(b.tour_key)
      return dir * (at - bt)
    }
    const av = a[key] as number
    const bv = b[key] as number
    if (av === bv) return a.tour_key.localeCompare(b.tour_key)
    return dir * (av - bv)
  })
  return copy
}

function tourIdFromKey(tourKey: string): string {
  const m = /^TK_(\d{6})$/.exec(tourKey)
  return m?.[1] ?? tourKey
}

export function AnalyticsOverviewPage() {
  const { status: apiStatus, refresh } = useAnalyticsApiStatus()
  const [preset, setPreset] = useState<DatePreset>('30d')
  const [audience, setAudience] = useState<AudienceFilter>('real')
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [projects, setProjects] = useState<AnalyticsProjectRow[]>([])
  const [sortKey, setSortKey] = useState<ProjectSortKey>('last_visited_at')
  const [sortAsc, setSortAsc] = useState(false)

  const q = useMemo(() => apiQuery(audience, preset), [audience, preset])
  const sortedProjects = useMemo(
    () => sortProjects(projects, sortKey, sortAsc),
    [projects, sortKey, sortAsc],
  )

  useEffect(() => {
    setAudience(loadAudienceFilter())
  }, [])

  useEffect(() => {
    saveAudienceFilter(audience)
    if (apiStatus === 'unknown') return
    void Promise.allSettled([api.analytics.overview(q), api.analytics.projects(q)]).then(([ov, pr]) => {
      if (ov.status === 'fulfilled') setData(ov.value)
      if (pr.status === 'fulfilled') setProjects(pr.value.projects || [])
    })
  }, [q, audience, apiStatus])

  function onSortColumn(key: ProjectSortKey) {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(key === 'tour_key')
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Tour analytics" description="Visitor metrics for your tours (read-only)." />
      <AnalyticsTimezoneSelect />
      <ApiOfflineBanner />
      <DateRangeBar
        preset={preset}
        onPreset={setPreset}
        audience={audience}
        onAudience={setAudience}
        onRefresh={refresh}
      />

      <h2 className="mt-10 text-lg font-medium">Your tours</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Last visited respects audience filter; other columns use the selected date range.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="cursor-pointer p-3 text-left" onClick={() => onSortColumn('tour_key')}>
                Tour
              </th>
              <th className="cursor-pointer p-3 text-center" onClick={() => onSortColumn('last_visited_at')}>
                Last visited
              </th>
              <th className="cursor-pointer p-3 text-center" onClick={() => onSortColumn('visitors')}>
                Visitors
              </th>
              <th className="cursor-pointer p-3 text-center" onClick={() => onSortColumn('sessions')}>
                Sessions
              </th>
              <th className="cursor-pointer p-3 text-center" onClick={() => onSortColumn('avg_session_ms')}>
                Avg time
              </th>
              <th className="cursor-pointer p-3 text-center" onClick={() => onSortColumn('cta_rate')}>
                CTA rate
              </th>
            </tr>
          </thead>
          <tbody>
            {!sortedProjects.length && apiStatus === 'online' ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No analytics data for your tours yet.
                </td>
              </tr>
            ) : null}
            {sortedProjects.map((p) => (
              <tr key={p.tour_key} className="border-t border-border">
                <td className="p-3">
                  <Link
                    to={`/analytics/tours/${tourIdFromKey(p.tour_key)}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {p.tour_key}
                  </Link>
                </td>
                <td className="whitespace-nowrap p-3 text-center">{formatIst(p.last_visited_at)}</td>
                <td className="p-3 text-center">{p.visitors}</td>
                <td className="p-3 text-center">{p.sessions}</td>
                <td className="p-3 text-center">{formatDuration(p.avg_session_ms)}</td>
                <td className="p-3 text-center">{p.cta_rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Visitors" value={(data?.visitors as number | undefined) ?? '—'} />
        <KpiCard label="Sessions" value={(data?.sessions as number | undefined) ?? '—'} />
        <KpiCard
          label="Avg session time"
          value={
            typeof data?.avg_session_ms === 'number' ? formatDuration(data.avg_session_ms as number) : '—'
          }
        />
        <KpiCard label="Scenes per session" value={(data?.scenes_per_session as number | undefined) ?? '—'} />
        <KpiCard label="CTA clicks" value={(data?.cta_clicks as number | undefined) ?? '—'} />
        <KpiCard label="Lead form submits" value={(data?.lead_submits as number | undefined) ?? '—'} />
      </div>
    </div>
  )
}
