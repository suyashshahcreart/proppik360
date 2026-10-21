// ============================================================
// Open catalog of customers (no SaaS / tour-admin auth).
// Soft-deleted rows are excluded. owner_id is stripped.
// ============================================================
import type { Customer } from '../types'

export interface PublicCustomerFilters {
  customerId?: string | null
  client?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  page?: number
  perPage?: number
}

export type PublicCustomer = Omit<Customer, 'owner_id' | 'deleted_at'> & {
  name: string
  tour_count: number
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

export function parsePublicCustomerFilters(query: {
  customer_id?: string
  client?: string
  date_from?: string
  date_to?: string
  from?: string
  to?: string
  page?: string
  per_page?: string
}): { ok: true; filters: PublicCustomerFilters } | { ok: false; message: string } {
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
      customerId,
      client: query.client?.trim() || null,
      dateFrom,
      dateTo,
      page: parsePage(query.page, DEFAULT_PAGE),
      perPage: parsePage(query.per_page, DEFAULT_PER_PAGE, MAX_PER_PAGE),
    },
  }
}

export async function listPublicCustomers(
  db: D1Database,
  filters: PublicCustomerFilters,
): Promise<{
  items: PublicCustomer[]
  total: number
  page: number
  per_page: number
}> {
  const page = filters.page ?? DEFAULT_PAGE
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE
  const offset = (page - 1) * perPage

  const where: string[] = ['c.deleted_at IS NULL']
  const binds: Array<string | number> = []

  if (filters.customerId) {
    where.push('c.id = ?')
    binds.push(filters.customerId)
  }
  if (filters.client) {
    where.push(
      `(c.id = ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR c.email LIKE ? OR c.mobile LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)`,
    )
    const like = `%${filters.client}%`
    binds.push(filters.client, like, like, like, like, like, like)
  }
  if (filters.dateFrom) {
    where.push('c.created_at >= ?')
    binds.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    where.push('c.created_at <= ?')
    binds.push(filters.dateTo)
  }

  const whereSql = where.join(' AND ')

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM customers c WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>()
  const total = countRow?.n ?? 0

  const rows = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM tours t
                WHERE t.customer_id = c.id AND t.deleted_at IS NULL) AS tour_count
         FROM customers c
        WHERE ${whereSql}
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, perPage, offset)
    .all<Customer & { tour_count: number }>()

  const items = (rows.results ?? []).map((row) => {
    const rest = { ...row } as PublicCustomer & { owner_id?: string; deleted_at?: string | null }
    delete rest.owner_id
    delete rest.deleted_at
    rest.name = `${row.first_name} ${row.last_name}`.trim()
    rest.tour_count = Number(row.tour_count) || 0
    return rest
  })

  return { items, total, page, per_page: perPage }
}
