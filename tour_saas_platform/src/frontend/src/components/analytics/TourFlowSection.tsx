import type { FlowPath, FlowTransition } from '@/lib/analytics/flow'

export function TourFlowSection({
  topPaths,
  transitions,
}: {
  topPaths: FlowPath[]
  transitions: FlowTransition[]
}) {
  if (!topPaths.length && !transitions.length) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        No movement paths yet. Paths appear after visitors move between scenes or bunches.
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-6">
      {topPaths.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/50 px-4 py-3">
            <p className="text-sm font-medium">Top visitor paths</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Bunch-to-bunch flow (consecutive stops in the same bunch count once)
            </p>
          </div>
          <ul className="divide-y divide-border">
            {topPaths.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{p.count}×</span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {p.steps.map((step, j) => (
                    <span key={j} className="inline-flex items-center gap-1.5">
                      {j > 0 ? <span className="text-muted-foreground" aria-hidden>→</span> : null}
                      <span className="font-medium">{step}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {transitions.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/50 px-4 py-3">
            <p className="text-sm font-medium">Area transitions</p>
          </div>
          <table className="w-full min-w-[320px] text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-3 text-left">From</th>
                <th className="p-3 text-left">To</th>
                <th className="p-3 text-right">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-3 font-medium">{t.from}</td>
                  <td className="p-3">
                    <span className="mr-1 text-muted-foreground">→</span>
                    {t.to}
                  </td>
                  <td className="p-3 text-right tabular-nums">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
