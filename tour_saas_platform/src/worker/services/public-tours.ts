// ============================================================
// Open catalog of tours (no SaaS / tour-admin auth).
// Soft-deleted tours are excluded. Internal upload keys are stripped.
// ============================================================
import type { Tour } from '../types'
import { withPublicViewerUrl } from '../utils/viewer-url'

export interface PublicTourFilters {
  tourId?: string | null
  customerId?: string | null
  client?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  page?: number
  perPage?: number
}

export interface PublicTourCustomer {
  id: string
  first_name: string
  last_name: string
  name: string
  company_name: string | null
  email: string
  country_code: string
  mobile: string
  slug: string | null
}

export type PublicTour = Omit<
  Tour,
  'owner_id' | 'upload_id' | 'upload_session_id' | 'r2_key'
> & {
  customer: PublicTourCustomer | null
}

const DEFAULT_PAGE = 1
const DEFAULT_PER_PAGE = 50
const MAX_PER_PAGE = 200

function normalizeDateBound(raw: string | null | undefined, endOfDay: boolean): string | null {
  if (!raw?.trim()) return null
  const value = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function parsePage(raw: string | undefined, fallback: number, max?: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return max != null ? Math.min(n, max) : n
}

export function parsePublicTourFilters(query: {
  tour_id?: string
  customer_id?: string
  client?: string
  date_from?: string
  date_to?: string
  from?: string
  to?: string
  page?: string
  per_page?: string
}): { ok: true; filters: PublicTourFilters } | { ok: false; message: string } {
  const tourId = query.tour_id?.trim() || null
  if (tourId && !/^\d{6}$/.test(tourId)) {
    return { ok: false, message: 'tour_id must be exactly 6 digits' }
  }

  const customerId = query.customer_id?.trim() || null
  if (customerId && !/^[0-9a-f-]{36}$/i.test(customerId)) {
    return { ok: false, message: 'customer_id must be a UUID' }
  }

  const dateFromRaw = query.date_from?.trim() || query.from?.trim() || null
  const dateToRaw = query.date_to?.trim() || query.to?.trim() || null
  const dateFrom = dateFromRaw ? normalizeDateBound(dateFromRaw, false) : null
  const dateTo = dateToRaw ? normalizeDateBound(dateToRaw, true) : null
  if (dateFromRaw && !dateFrom) {
    return { ok: false, message: 'date_from must be YYYY-MM-DD or an ISO datetime' }
  }
  if (dateToRaw && !dateTo) {
    return { ok: false, message: 'date_to must be YYYY-MM-DD or an ISO datetime' }
  }

  return {
    ok: true,
    filters: {
      tourId,
      customerId,
      client: query.client?.trim() || null,
      dateFrom,
      dateTo,
      page: parsePage(query.page, DEFAULT_PAGE),
      perPage: parsePage(query.per_page, DEFAULT_PER_PAGE, MAX_PER_PAGE),
    },
  }
}

function stripInternal(tour: Tour, customer: PublicTourCustomer | null): PublicTour {
  const rest = { ...tour, customer } as PublicTour & {
    owner_id?: string
    upload_id?: string | null
    upload_session_id?: string | null
    r2_key?: string | null
  }
  delete rest.owner_id
  delete rest.upload_id
  delete rest.upload_session_id
  delete rest.r2_key
  return rest
}

export async function listPublicTours(
  db: D1Database,
  publicDomain: string,
  filters: PublicTourFilters,
): Promise<{
  items: PublicTour[]
  total: number
  page: number
  per_page: number
}> {
  const page = filters.page ?? DEFAULT_PAGE
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE
  const offset = (page - 1) * perPage

  const where: string[] = ['t.deleted_at IS NULL']
  const binds: Array<string | number> = []

  if (filters.tourId) {
    where.push('t.tour_id = ?')
    binds.push(filters.tourId)
  }
  if (filters.customerId) {
    where.push('t.customer_id = ?')
    binds.push(filters.customerId)
  }
  if (filters.client) {
    where.push(
      `(c.id = ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)`,
    )
    const like = `%${filters.client}%`
    binds.push(filters.client, like, like, like, like)
  }
  if (filters.dateFrom) {
    where.push('t.created_at >= ?')
    binds.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    where.push('t.created_at <= ?')
    binds.push(filters.dateTo)
  }

  const whereSql = where.join(' AND ')
  const joinSql = `FROM tours t
     LEFT JOIN customers c ON c.id = t.customer_id AND c.deleted_at IS NULL
    WHERE ${whereSql}`

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n ${joinSql}`)
    .bind(...binds)
    .first<{ n: number }>()
  const total = countRow?.n ?? 0

  const rows = await db
    .prepare(
      `SELECT t.*,
              c.id AS _c_id,
              c.first_name AS _c_first_name,
              c.last_name AS _c_last_name,
              c.company_name AS _c_company_name,
              c.email AS _c_email,
              c.country_code AS _c_country_code,
              c.mobile AS _c_mobile,
              c.slug AS _c_slug
         ${joinSql}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, perPage, offset)
    .all<
      Tour & {
        _c_id: string | null
        _c_first_name: string | null
        _c_last_name: string | null
        _c_company_name: string | null
        _c_email: string | null
        _c_country_code: string | null
        _c_mobile: string | null
        _c_slug: string | null
      }
    >()

  const items = (rows.results ?? []).map((row) => {
    const customer: PublicTourCustomer | null = row._c_id
      ? {
          id: row._c_id,
          first_name: row._c_first_name ?? '',
          last_name: row._c_last_name ?? '',
          name: `${row._c_first_name ?? ''} ${row._c_last_name ?? ''}`.trim(),
          company_name: row._c_company_name,
          email: row._c_email ?? '',
          country_code: row._c_country_code ?? '',
          mobile: row._c_mobile ?? '',
          slug: row._c_slug,
        }
      : null

    const tour = { ...row } as Tour & Record<string, unknown>
    for (const key of [
      '_c_id',
      '_c_first_name',
      '_c_last_name',
      '_c_company_name',
      '_c_email',
      '_c_country_code',
      '_c_mobile',
      '_c_slug',
    ]) {
      delete tour[key]
    }

    return stripInternal(withPublicViewerUrl(tour as Tour, publicDomain), customer)
  })

  return { items, total, page, per_page: perPage }
}
