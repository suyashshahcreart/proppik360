import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnalyticsTourSubNav } from '@/components/analytics/AnalyticsTourSubNav'
import { ApiOfflineBanner } from '@/components/analytics/ApiOfflineBanner'
import { DateRangeBar } from '@/components/analytics/DateRangeBar'
import { InteractionsBarChart } from '@/components/analytics/InteractionsBarChart'
import { KpiCard } from '@/components/analytics/KpiCard'
import { TourFlowSection } from '@/components/analytics/TourFlowSection'
import { isVisitorInteractionEvent, labelForEvent } from '@/lib/analytics/event-labels'
import { normalizeTopPaths, normalizeTransitions } from '@/lib/analytics/flow'
import { formatDuration, formatIst, formatLocation } from '@/lib/analytics/format'
import {
  apiQuery,
  loadAudienceFilter,
  rangeFromPreset,
  saveAudienceFilter,
  type AudienceFilter,
  type DatePreset,
} from '@/lib/analytics/query-params'
import { buildTourNodeUrl } from '@/lib/analytics/tour-node-link'
import { useAnalyticsApiStatus } from '@/hooks/useAnalyticsApiStatus'
import { api, type AnalyticsBreakdowns, type AnalyticsInsights } from '@/services/api'

type SceneChildRow = {
  scene_id: string
  display_name: string
  link_node?: string
  views: number
  avg_dwell_ms: number
  avg_active_ms: number
  rotation_drags?: number
}

type SceneRow = {
  scene_id: string
  display_name: string
  views: number
  avg_dwell_ms: number
  avg_active_ms: number
  rotation_drags?: number
  link_node?: string
  grouped?: boolean
  member_scene_ids?: string[]
  children?: SceneChildRow[]
}

type SessionRow = {
  sid: string
  summary_line?: string
  visitor_label?: string
  display_ts?: string
  duration_ms?: number
  location_label?: string
  city?: string
  country?: string
  device?: string
  browser?: string
  started_at?: string
}

function asSceneRows(raw: unknown): SceneRow[] {
  return Array.isArray(raw) ? (raw as SceneRow[]) : []
}

function asSessionRows(raw: unknown): SessionRow[] {
  if (Array.isArray(raw)) return raw as SessionRow[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { sessions?: unknown }).sessions)) {
    return (raw as { sessions: SessionRow[] }).sessions
  }
  return []
}

function tourNodeParam(row: SceneRow | SceneChildRow): string {
  const link = row.link_node?.trim()
  if (link) return link
  return row.scene_id
}

function sceneChildRows(row: SceneRow): SceneChildRow[] {
  if (row.children?.length) return row.children
  if (!row.grouped || !row.member_scene_ids?.length) return []
  return row.member_scene_ids.map((sceneId) => ({
    scene_id: sceneId,
    display_name: sceneId,
    link_node: sceneId,
    views: 0,
    avg_dwell_ms: 0,
    avg_active_ms: 0,
    rotation_drags: 0,
  }))
}

export function AnalyticsTourPage() {
  const { tourId = '' } = useParams()
  const { status: apiStatus, refresh } = useAnalyticsApiStatus()
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<DatePreset>('30d')
  const [audience, setAudience] = useState<AudienceFilter>('real')
  const [hidden, setHidden] = useState<{
    preview_sessions_hidden: number
    synthetic_sessions_hidden: number
  } | null>(null)
  const [overview, setOverview] = useState<{
    visitors: number
    session_count: number
    scenes_per_session: number
    cta_clicks: number
    lead_submits: number
    avg_session_ms: number
    by_type: Record<string, number>
  } | null>(null)
  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [breakdowns, setBreakdowns] = useState<AnalyticsBreakdowns | null>(null)
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null)
  const [expandedBunches, setExpandedBunches] = useState<Set<string>>(() => new Set())
  const [tourPageUrl, setTourPageUrl] = useState('')
  const [dataLoading, setDataLoading] = useState(false)

  const apiOnline = apiStatus === 'online'
  const q = useMemo(() => apiQuery(audience, preset), [audience, preset])
  const tourKey = tourId ? `TK_${tourId}` : ''

  const hiddenNote = useMemo(() => {
    if (!hidden) return null
    if (audience === 'real' && hidden.preview_sessions_hidden > 0) {
      return `${hidden.preview_sessions_hidden} preview session${hidden.preview_sessions_hidden === 1 ? '' : 's'} hidden — switch to Include preview`
    }
    if (audience === 'preview' && hidden.synthetic_sessions_hidden > 0) {
      return `${hidden.synthetic_sessions_hidden} test/demo session${hidden.synthetic_sessions_hidden === 1 ? '' : 's'} hidden — switch to Include test/demo`
    }
    return null
  }, [audience, hidden])

  useEffect(() => {
    setAudience(loadAudienceFilter())
  }, [])

  useEffect(() => {
    if (!tourId) return
    saveAudienceFilter(audience)
    const range = rangeFromPreset(preset)
    const rangeQ = [
      range.from ? `from=${encodeURIComponent(range.from)}` : '',
      range.to ? `to=${encodeURIComponent(range.to)}` : '',
    ]
      .filter(Boolean)
      .join('&')

    void api.analytics
      .tour(tourId)
      .meta()
      .then((m) => setName(m.name?.trim() || tourKey))
      .catch(() => setName(tourKey))

    if (apiStatus === 'unknown') return

    setDataLoading(true)
    const t = api.analytics.tour(tourId)
    void Promise.allSettled([
      t.overview(q),
      t.scenes(q),
      t.sessions(q),
      t.breakdowns(q),
      t.insights(q),
      t.audienceHidden(rangeQ),
      t.urls(q),
    ])
      .then(([ov, sc, sess, br, ins, hid, urls]) => {
        if (ov.status === 'fulfilled') {
          const o = ov.value
          setOverview({
            visitors: o.visitors,
            session_count: o.sessions,
            scenes_per_session: o.scenes_per_session,
            cta_clicks: o.cta_clicks,
            lead_submits: o.lead_submits,
            avg_session_ms: o.avg_session_ms,
            by_type: o.by_type || {},
          })
        }
        if (sc.status === 'fulfilled') setScenes(asSceneRows(sc.value))
        if (sess.status === 'fulfilled') setSessions(asSessionRows(sess.value))
        if (br.status === 'fulfilled') setBreakdowns(br.value)
        if (ins.status === 'fulfilled') setInsights(ins.value)
        if (hid.status === 'fulfilled') setHidden(hid.value)
        else setHidden(null)
        if (urls.status === 'fulfilled' && urls.value.length) {
          setTourPageUrl(urls.value[0]?.url || '')
        }
      })
      .finally(() => setDataLoading(false))
  }, [tourId, q, preset, audience, apiStatus, tourKey])

  function toggleBunch(sceneId: string) {
    setExpandedBunches((prev) => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })
  }

  const chartTypes = Object.entries(overview?.by_type || {})
    .filter(([t]) => isVisitorInteractionEvent(t))
    .map(([t, c]) => ({ label: labelForEvent(t), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  if (!tourId) {
    return <p className="text-muted-foreground">Missing tour id.</p>
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/analytics" className="text-sm text-primary hover:underline">
        ← Overview
      </Link>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{tourKey}</p>
      <h1 className="text-3xl font-semibold">{name}</h1>
      <AnalyticsTourSubNav tourId={tourId} />
      <ApiOfflineBanner />
      <DateRangeBar
        preset={preset}
        onPreset={setPreset}
        audience={audience}
        onAudience={setAudience}
        hiddenNote={hiddenNote}
        onRefresh={refresh}
        refreshing={dataLoading}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Visitors" value={overview?.visitors ?? '—'} />
        <KpiCard label="Sessions" value={overview?.session_count ?? '—'} />
        <KpiCard label="Avg session time" value={overview ? formatDuration(overview.avg_session_ms) : '—'} />
        <KpiCard label="Scenes per session" value={overview?.scenes_per_session ?? '—'} />
        <KpiCard label="CTA clicks" value={overview?.cta_clicks ?? '—'} />
        <KpiCard label="Lead form submits" value={overview?.lead_submits ?? '—'} />
      </div>

      {insights ? (
        <div className="mt-6 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <KpiCard label="Bounce rate" value={`${insights.bounce_rate}%`} />
          <KpiCard label="Engagement score" value={insights.avg_engagement_score} />
          <KpiCard label="Funnel: 3+ scenes" value={`${insights.funnel_pct?.scenes_3 ?? 0}%`} />
          <KpiCard label="Funnel: CTA" value={`${insights.funnel_pct?.cta ?? 0}%`} />
        </div>
      ) : null}

      <h2 className="mt-10 text-xl font-medium">Visitor flow</h2>
      <TourFlowSection
        topPaths={normalizeTopPaths(insights?.top_paths)}
        transitions={normalizeTransitions(insights?.transitions)}
      />

      <h2 className="mt-10 text-xl font-medium">Scenes</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 p-3" aria-label="Expand" />
              <th className="p-3">Scene</th>
              <th className="p-3">Views</th>
              <th className="p-3">Time on scene</th>
              <th className="p-3">Active time</th>
              <th className="p-3">Rotation drags</th>
            </tr>
          </thead>
          <tbody>
            {apiOnline && !scenes.length ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No scene views in this period.
                </td>
              </tr>
            ) : null}
            {scenes.map((s) => {
              const childRows = sceneChildRows(s)
              const isExpanded = expandedBunches.has(s.scene_id)
              const hasChildren = Boolean(s.grouped && childRows.length)
              return (
                <Fragment key={s.scene_id}>
                  <tr className="border-t border-border">
                    <td className="p-3 align-top">
                      {hasChildren ? (
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                          onClick={() => toggleBunch(s.scene_id)}
                        >
                          <span className={`text-xs ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        </button>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {s.grouped ? (
                        <span className="font-medium">{s.display_name}</span>
                      ) : (
                        <a
                          href={buildTourNodeUrl(tourPageUrl, tourNodeParam(s))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-primary hover:underline"
                        >
                          <span className="font-medium">{s.display_name}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{s.scene_id}</span>
                        </a>
                      )}
                    </td>
                    <td className="p-3">{s.views}</td>
                    <td className="p-3">{formatDuration(s.avg_dwell_ms)}</td>
                    <td className="p-3">{formatDuration(s.avg_active_ms)}</td>
                    <td className="p-3">{s.rotation_drags ?? '—'}</td>
                  </tr>
                  {isExpanded && hasChildren
                    ? childRows.map((child) => (
                        <tr key={`${s.scene_id}:${child.scene_id}`} className="border-t border-border bg-muted/30">
                          <td className="p-3" />
                          <td className="p-3 pl-2">
                            <a
                              href={buildTourNodeUrl(tourPageUrl, tourNodeParam(child))}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block border-l-2 border-border pl-4 text-primary hover:underline"
                            >
                              <span className="font-medium">{child.display_name}</span>
                            </a>
                          </td>
                          <td className="p-3">{child.views}</td>
                          <td className="p-3">{formatDuration(child.avg_dwell_ms)}</td>
                          <td className="p-3">{formatDuration(child.avg_active_ms)}</td>
                          <td className="p-3">{child.rotation_drags ?? '—'}</td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-medium">CTAs</h2>
      {(breakdowns?.ctas || []).length ? (
        <Table3
          cols={['CTA', 'Clicks', 'Unique visitors']}
          rows={(breakdowns?.ctas || []).map((r) => [r.label, r.clicks, r.unique_visitors])}
        />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No CTA clicks in this period.</p>
      )}

      <h2 className="mt-8 text-xl font-medium">Info points</h2>
      {(breakdowns?.info_points || []).length ? (
        <Table3
          cols={['Info point', 'Opens', 'Avg time open']}
          rows={(breakdowns?.info_points || []).map((r) => [r.label, r.opens, formatDuration(r.avg_open_ms)])}
        />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No info point opens in this period.</p>
      )}

      <h2 className="mt-8 text-xl font-medium">Controls used</h2>
      {(breakdowns?.controls || []).length ? (
        <Table3
          cols={['Control', 'Uses', 'Unique visitors']}
          rows={(breakdowns?.controls || []).map((r) => [r.action, r.count, r.unique_visitors])}
        />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No control usage in this period.</p>
      )}

      <h2 className="mt-10 text-xl font-medium">Top interactions</h2>
      <InteractionsBarChart data={chartTypes} />

      <h2 className="mt-10 text-xl font-medium">Sessions</h2>
      <ul className="mt-3 space-y-2">
        {sessions.map((s) => (
          <li key={s.sid} className="rounded-xl border border-border bg-card p-4 text-sm">
            <Link
              className="font-medium text-primary hover:underline"
              to={`/analytics/sessions/${encodeURIComponent(s.sid)}?tourId=${tourId}`}
            >
              {s.summary_line || s.visitor_label || s.sid}
            </Link>
            <p className="mt-1 text-muted-foreground">
              {formatLocation(s)} · {s.device} · {s.browser} · {formatDuration(s.duration_ms)} ·{' '}
              {formatIst(s.display_ts || s.started_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Table3({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {cols.map((c) => (
              <th key={c} className="p-3 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((cell, j) => (
                <td key={j} className="p-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
