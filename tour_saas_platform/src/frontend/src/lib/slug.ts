const MAX_SLUG_LENGTH = 60
const FALLBACK_SLUG = 'tour'

/**
 * Match worker slugify — lowercase URL-safe tour id.
 * Allows both hyphen (-) and underscore (_).
 */
export function slugify(input: string): string {
  if (!input.trim()) return FALLBACK_SLUG

  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

  if (!slug) return FALLBACK_SLUG

  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH)
    const lastSep = Math.max(slug.lastIndexOf('-'), slug.lastIndexOf('_'))
    if (lastSep > MAX_SLUG_LENGTH / 2) slug = slug.slice(0, lastSep)
    slug = slug.replace(/^[-_]+|[-_]+$/g, '')
  }

  return slug || FALLBACK_SLUG
}
