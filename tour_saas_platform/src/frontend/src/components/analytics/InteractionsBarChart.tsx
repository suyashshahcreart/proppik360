import { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function InteractionsBarChart({
  data,
}: {
  data: { label: string; count: number }[]
}) {
  const chartData = useMemo(() => data.slice(0, 10), [data])
  if (!chartData.length) {
    return <p className="mt-2 text-sm text-muted-foreground">No interaction data yet.</p>
  }
  return (
    <div className="mt-3 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
