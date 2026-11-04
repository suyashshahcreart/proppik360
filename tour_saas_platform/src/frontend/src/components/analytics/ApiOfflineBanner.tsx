import { useAnalyticsApiStatus } from '@/hooks/useAnalyticsApiStatus'

export function ApiOfflineBanner() {
  const { status } = useAnalyticsApiStatus()
  if (status !== 'offline') return null
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <p className="font-medium">Analytics API is unavailable</p>
      <p className="mt-1 text-red-800">
        Check that analytics.proppik.cloud is reachable and ANALYTICS_API_BASE / ANALYTICS_SERVICE_KEY are set on
        the server. KPIs below may not be loaded.
      </p>
    </div>
  )
}
