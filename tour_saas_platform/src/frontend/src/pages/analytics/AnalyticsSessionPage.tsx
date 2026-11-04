import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { formatDuration, formatIst } from '@/lib/analytics/format'
import { api, type AnalyticsTimelineBlock } from '@/services/api'

export function AnalyticsSessionPage() {
  const { sid = '' } = useParams()
  const [search] = useSearchParams()
  const tourId = search.get('tourId') ?? ''
  const [blocks, setBlocks] = useState<AnalyticsTimelineBlock[]>([])
  const [tourLabel, setTourLabel] = useState('')
  const [openDetail, setOpenDetail] = useState<string | null>(null)

  useEffect(() => {
    if (!sid || !/^\d{6}$/.test(tourId)) return
    void api.analytics.sessionTimeline(sid, tourId).then((r) => {
      setBlocks(r.blocks || [])
      const tk = r.tour_key || `TK_${tourId}`
      void api.analytics
        .tour(tourId)
        .meta()
        .then((m) => setTourLabel(m.name?.trim() || tk))
        .catch(() => setTourLabel(tk))
    })
  }, [sid, tourId])

  return (
    <div className="mx-auto max-w-6xl">
      {tourId ? (
        <Link to={`/analytics/tours/${tourId}`} className="text-sm text-primary hover:underline">
          ← {tourLabel || `Tour ${tourId}`}
        </Link>
      ) : null}
      <h1 className="mt-2 text-3xl font-semibold">Session timeline</h1>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{sid}</p>

      <div className="mt-8 space-y-4">
        {blocks.map((b, i) => (
          <section key={`${b.scene_id}-${i}`} className="rounded-xl border border-border bg-card p-4">
            <p className="font-semibold">{b.scene_name || b.scene_id}</p>
            <p className="text-xs font-mono text-muted-foreground">{b.scene_id}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatIst(b.entered_at)} · Time on scene {formatDuration(b.dwell_ms)} · Active{' '}
              {formatDuration(b.active_ms)}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {b.actions.map((a, j) => (
                <li key={j}>
                  {a.label}
                  <button
                    type="button"
                    className="ml-2 text-xs text-primary"
                    onClick={() => setOpenDetail(openDetail === `${i}-${j}` ? null : `${i}-${j}`)}
                  >
                    details
                  </button>
                  {openDetail === `${i}-${j}` ? (
                    <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {JSON.stringify(a.p, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
