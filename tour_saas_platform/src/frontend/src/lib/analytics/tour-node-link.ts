export function buildTourNodeUrl(tourPageUrl: string | undefined, nodeParam: string): string {
  const node = String(nodeParam || '').trim()
  if (!node) return ''
  const base = (tourPageUrl || '').trim()
  if (!base) return ''
  try {
    const u = new URL(base)
    u.searchParams.set('node', node)
    return u.toString()
  } catch {
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}node=${encodeURIComponent(node)}`
  }
}
