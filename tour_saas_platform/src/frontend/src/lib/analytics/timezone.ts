const KEY = 'ta_timezone'
export const DEFAULT_TZ = 'Asia/Kolkata'

export function getTimezone(): string {
  if (typeof window === 'undefined') return DEFAULT_TZ
  return localStorage.getItem(KEY) || DEFAULT_TZ
}

export function setTimezone(tz: string): void {
  localStorage.setItem(KEY, tz)
  window.dispatchEvent(new Event('ta-timezone'))
}

export const TIMEZONE_OPTIONS = [
  { id: 'Asia/Kolkata', label: 'IST (Asia/Kolkata)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'US Eastern' },
  { id: 'Europe/London', label: 'London' },
]
