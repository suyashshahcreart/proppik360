// ============================================================
// MSG91 Flow template map helpers (settings.msg91_templates JSON)
// ============================================================
import { getSetting } from './settings'

/** Well-known keys used by this platform (others allowed via UI). */
export const MSG91_KNOWN_TEMPLATE_KEYS = [
  'login_otp',
  'tour_access_otp',
  'registration_otp',
] as const

export type Msg91TemplateMap = Record<string, string>

export function parseMsg91Templates(raw: string | null | undefined): Msg91TemplateMap {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Msg91TemplateMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = k.trim()
      if (!key) continue
      out[key] = typeof v === 'string' ? v.trim() : String(v ?? '').trim()
    }
    return out
  } catch {
    return {}
  }
}

export function serializeMsg91Templates(map: Msg91TemplateMap): string {
  const cleaned: Msg91TemplateMap = {}
  for (const [k, v] of Object.entries(map)) {
    const key = k.trim()
    if (!key) continue
    cleaned[key] = (v ?? '').trim()
  }
  return JSON.stringify(cleaned)
}

/**
 * Resolve a Flow template id by key.
 * Fallbacks: tour_access_otp → login_otp → legacy msg91_otp_template_id.
 */
export async function resolveMsg91TemplateId(
  db: D1Database,
  preferredKey: string = 'tour_access_otp',
): Promise<{ key: string; templateId: string } | null> {
  const map = parseMsg91Templates(await getSetting(db, 'msg91_templates', '{}'))
  const legacy = ((await getSetting(db, 'msg91_otp_template_id', '')) ?? '').trim()

  const tryKeys = [preferredKey, 'tour_access_otp', 'login_otp']
  const seen = new Set<string>()
  for (const key of tryKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    const id = (map[key] ?? '').trim()
    if (id) return { key, templateId: id }
  }

  if (legacy) return { key: 'msg91_otp_template_id', templateId: legacy }
  return null
}
