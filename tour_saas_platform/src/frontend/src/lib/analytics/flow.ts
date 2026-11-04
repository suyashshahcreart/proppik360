export type FlowPath = { steps: string[]; count: number }
export type FlowTransition = { from: string; to: string; count: number }

export function normalizeTopPaths(raw: unknown): FlowPath[] {
  if (!Array.isArray(raw)) return []
  const out: FlowPath[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as { steps?: unknown; path?: unknown; count?: unknown }
    const stepsRaw = Array.isArray(o.steps) ? o.steps : Array.isArray(o.path) ? o.path : []
    const steps = stepsRaw.map((s) => String(s)).filter(Boolean)
    if (!steps.length) continue
    out.push({ steps, count: Number(o.count) || 0 })
  }
  return out
}

export function normalizeTransitions(raw: unknown): FlowTransition[] {
  if (!Array.isArray(raw)) return []
  const out: FlowTransition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as { from?: unknown; to?: unknown; count?: unknown }
    const from = String(o.from ?? '').trim()
    const to = String(o.to ?? '').trim()
    if (!from || !to) continue
    out.push({ from, to, count: Number(o.count) || 0 })
  }
  return out
}
