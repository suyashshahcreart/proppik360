import { getTimezone } from './timezone'

function parseInstant(ts: number | string | null | undefined): Date | null {
  if (ts == null || ts === '') return null
  if (typeof ts === 'number') {
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? null : d
  }
  let s = String(ts).trim()
  if (/^\d+$/.test(s)) {
    const d = new Date(parseInt(s, 10))
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (!s.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s += 'Z'
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatIst(ts: number | string | null | undefined): string {
  const d = parseInstant(ts)
  if (!d) return '—'
  const tz = typeof window !== 'undefined' ? getTimezone() : 'Asia/Kolkata'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

export function formatLocation(loc?: {
  location_label?: string
  city?: string
  country?: string
}): string {
  if (loc?.location_label) return loc.location_label
  if (loc?.city === 'Local' && loc?.country === 'Local') return 'Local (development)'
  const parts = [loc?.city, loc?.country].filter(Boolean)
  return parts.length ? parts.join(', ') : '—'
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return `${m}m ${r}s`
}
