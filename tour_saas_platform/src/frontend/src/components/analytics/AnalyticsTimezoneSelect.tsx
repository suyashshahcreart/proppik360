import { useEffect, useState } from 'react'
import { DEFAULT_TZ, TIMEZONE_OPTIONS, getTimezone, setTimezone } from '@/lib/analytics/timezone'

export function AnalyticsTimezoneSelect() {
  const [tz, setTz] = useState(DEFAULT_TZ)
  useEffect(() => {
    setTz(getTimezone())
    const onTz = () => setTz(getTimezone())
    window.addEventListener('ta-timezone', onTz)
    return () => window.removeEventListener('ta-timezone', onTz)
  }, [])
  return (
    <div className="mb-4 max-w-xs">
      <label className="mb-1 block text-xs text-muted-foreground">Timezone</label>
      <select
        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
        value={tz}
        onChange={(e) => setTimezone(e.target.value)}
      >
        {TIMEZONE_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
