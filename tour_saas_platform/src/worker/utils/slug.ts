// ============================================================
// Slug utility for generating human-readable tour IDs
// ============================================================
//
// Tour IDs serve as both database PKs and R2 key prefixes, so:
//   - They must be URL-safe and filesystem-safe
//   - They must be globally unique (not just per user)
//   - Collision is resolved with a numeric suffix (-1, -2, ...)
//   - Both hyphen (-) and underscore (_) are allowed
//
// Examples:
//   slugify("Avadhgreens VR Tour!")  → "avadhgreens-vr-tour"
//   slugify("  Hello   World  ")     → "hello-world"
//   slugify("wyndham_garden")        → "wyndham_garden"
//   slugify("wyndham-garden")        → "wyndham-garden"
//   slugify("123 Main St.")          → "123-main-st"
//   slugify("!!!!")                  → "tour"  (fallback)
//   slugify("")                      → "tour"  (fallback)
// ============================================================

const MAX_SLUG_LENGTH = 60
const FALLBACK_SLUG = 'tour'

/**
 * Convert an arbitrary string into a lowercase URL-safe slug.
 *
 * Rules:
 *   1. Lowercase everything
 *   2. Keep [a-z0-9_-]; replace other runs with a single hyphen
 *   3. Collapse repeated hyphens; trim leading/trailing - and _
 *   4. Cap at MAX_SLUG_LENGTH (trim at a -/_ boundary if possible)
 *   5. If empty, fall back to FALLBACK_SLUG
 */
export function slugify(input: string): string {
  if (!input || typeof input !== 'string') return FALLBACK_SLUG

  let slug = input
    .toLowerCase()
    // Keep letters, digits, hyphen, underscore; other runs → hyphen
    .replace(/[^a-z0-9_-]+/g, '-')
    // Collapse repeated hyphens only (leave underscores intact)
    .replace(/-{2,}/g, '-')
    // Trim leading/trailing separators
    .replace(/^[-_]+|[-_]+$/g, '')

  if (!slug) return FALLBACK_SLUG

  // Cap at MAX_SLUG_LENGTH — trim at a separator boundary when possible
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH)
    const lastSep = Math.max(slug.lastIndexOf('-'), slug.lastIndexOf('_'))
    if (lastSep > MAX_SLUG_LENGTH / 2) {
      slug = slug.slice(0, lastSep)
    }
    slug = slug.replace(/^[-_]+|[-_]+$/g, '')
  }

  return slug || FALLBACK_SLUG
}

/**
 * Build a tombstone tour ID used on soft-delete.
 *
 * Renaming the PK frees the original slug for re-upload while keeping the
 * soft-deleted row for audit (e.g. `sankalp` → `sankalp-deleted-20260315121400`).
 * Timestamp is UTC `YYYYMMDDHHmmss`.
 */
export function buildDeletedTourId(originalId: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`
  return `${originalId}-deleted-${ts}`
}
