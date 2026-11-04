import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '@/services/api'

type Status = 'unknown' | 'online' | 'offline'

const AnalyticsApiStatusContext = createContext<{ status: Status; refresh: () => void }>({
  status: 'unknown',
  refresh: () => {},
})

export function AnalyticsApiStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('unknown')

  const refresh = useCallback(() => {
    void api.analytics
      .ping()
      .then((r) => setStatus(r.online ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const value = useMemo(() => ({ status, refresh }), [status, refresh])
  return (
    <AnalyticsApiStatusContext.Provider value={value}>{children}</AnalyticsApiStatusContext.Provider>
  )
}

export function useAnalyticsApiStatus() {
  return useContext(AnalyticsApiStatusContext)
}
