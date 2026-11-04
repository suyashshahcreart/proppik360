import type { Env } from '../types'

const SERVICE_KEY_HEADER = 'X-Analytics-Service-Key'

export class AnalyticsNotConfiguredError extends Error {
  constructor() {
    super('Analytics API is not configured')
    this.name = 'AnalyticsNotConfiguredError'
  }
}

export class AnalyticsUpstreamError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Analytics upstream ${status}`)
    this.name = 'AnalyticsUpstreamError'
    this.status = status
    this.body = body
  }
}

export function toTourKey(tourId: string): string | null {
  const id = tourId.trim()
  if (!/^\d{6}$/.test(id)) return null
  return `TK_${id}`
}

export function tourIdFromTourKey(tourKey: string): string | null {
  const m = /^TK_(\d{6})$/.exec(tourKey.trim())
  return m?.[1] ?? null
}

function analyticsBase(env: Env): string {
  const base = env.ANALYTICS_API_BASE?.trim()
  if (!base) throw new AnalyticsNotConfiguredError()
  return base.replace(/\/$/, '')
}

export async function fetchAnalyticsJson<T>(
  env: Env,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const base = analyticsBase(env)
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = env.ANALYTICS_SERVICE_KEY?.trim()
  if (key) headers[SERVICE_KEY_HEADER] = key

  let res: Response
  try {
    res = await fetch(url.toString(), { method: 'GET', headers })
  } catch {
    throw new AnalyticsUpstreamError(502, 'Analytics API unreachable')
  }

  const text = await res.text()
  if (!res.ok) {
    throw new AnalyticsUpstreamError(res.status, text.slice(0, 500))
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new AnalyticsUpstreamError(502, 'Invalid JSON from analytics API')
  }
}

export async function fetchAnalyticsHealth(env: Env): Promise<boolean> {
  try {
    const base = analyticsBase(env)
    const res = await fetch(`${base}/healthz`, { method: 'GET' })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

export function mergeTourKeysQuery(
  search: string,
  tourKeys: string[],
): Record<string, string | undefined> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const out: Record<string, string | undefined> = {}
  params.forEach((value, key) => {
    out[key] = value
  })
  if (tourKeys.length > 0) {
    out.tour_keys = tourKeys.join(',')
  }
  return out
}
