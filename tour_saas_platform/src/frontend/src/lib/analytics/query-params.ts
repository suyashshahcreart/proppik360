export type DatePreset = 'today' | '7d' | '30d' | 'custom'

export type AudienceFilter = 'real' | 'preview' | 'test'

export function defaultAudienceFilter(): AudienceFilter {
  if (typeof window === 'undefined') return 'real'
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(window.location.origin)) {
    return 'preview'
  }
  return 'real'
}

export function parseAudienceFilter(raw: string | null): AudienceFilter {
  if (raw === 'preview' || raw === 'test') return raw
  return 'real'
}

export function loadAudienceFilter(): AudienceFilter {
  if (typeof window === 'undefined') return defaultAudienceFilter()
  const v = localStorage.getItem('ta_audience_filter')
  if (v) return parseAudienceFilter(v)
  return defaultAudienceFilter()
}

export function saveAudienceFilter(filter: AudienceFilter): void {
  localStorage.setItem('ta_audience_filter', filter)
}

export function rangeFromPreset(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date()
  const to = now.toISOString()
  if (preset === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: start.toISOString(), to }
  }
  if (preset === '7d') {
    const start = new Date(now.getTime() - 7 * 86400000)
    return { from: start.toISOString(), to }
  }
  if (preset === '30d') {
    const start = new Date(now.getTime() - 30 * 86400000)
    return { from: start.toISOString(), to }
  }
  return {}
}

export function apiQuery(audience: AudienceFilter, preset: DatePreset): string {
  const excludePreview = audience === 'real'
  const excludeSynthetic = audience !== 'test'
  const parts = [
    `exclude_synthetic=${excludeSynthetic ? 'true' : 'false'}`,
    `exclude_preview=${excludePreview ? 'true' : 'false'}`,
  ]
  const { from, to } = rangeFromPreset(preset)
  if (from) parts.push(`from=${encodeURIComponent(from)}`)
  if (to) parts.push(`to=${encodeURIComponent(to)}`)
  return parts.join('&')
}
