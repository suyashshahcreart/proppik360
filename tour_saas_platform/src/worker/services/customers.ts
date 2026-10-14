// ============================================================
// Customer database operations (D1 / SQLite)
// ============================================================
import type { Customer, CustomerSocialLink, CustomerWithLinks } from '../types'
import { slugify } from '../utils/slug'

export interface CustomerInput {
  first_name: string
  last_name: string
  email: string
  country_code: string
  mobile: string
  company_name?: string | null
  slug?: string | null
  company_website?: string | null
  tag_line?: string | null
  designation?: string | null
  social_links?: Array<{
    platform_name?: string
    url?: string
    icon_class?: string
  }>
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Normalize an optional slug. Empty → null. Otherwise slugify.
 */
export function normalizeCustomerSlug(raw: string | null | undefined): string | null {
  const emptied = emptyToNull(raw)
  if (!emptied) return null
  return slugify(emptied)
}

/**
 * Check whether a slug is already taken by another (non-deleted) customer.
 */
export async function isSlugTaken(
  db: D1Database,
  slug: string,
  excludeCustomerId?: string,
): Promise<boolean> {
  if (excludeCustomerId) {
    const row = await db
      .prepare(
        `SELECT id FROM customers
         WHERE slug = ? AND deleted_at IS NULL AND id != ?
         LIMIT 1`,
      )
      .bind(slug, excludeCustomerId)
      .first<{ id: string }>()
    return row != null
  }

  const row = await db
    .prepare(
      `SELECT id FROM customers
       WHERE slug = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(slug)
    .first<{ id: string }>()
  return row != null
}

export async function listCustomersByOwner(
  db: D1Database,
  ownerId: string,
): Promise<Customer[]> {
  const result = await db
    .prepare(
      `SELECT * FROM customers
       WHERE owner_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(ownerId)
    .all<Customer>()
  return result.results
}

export async function getCustomerByIdForOwner(
  db: D1Database,
  customerId: string,
  ownerId: string,
): Promise<Customer | null> {
  const result = await db
    .prepare(
      `SELECT * FROM customers
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(customerId, ownerId)
    .first<Customer>()
  return result ?? null
}

export async function getSocialLinks(
  db: D1Database,
  customerId: string,
): Promise<CustomerSocialLink[]> {
  const result = await db
    .prepare(
      `SELECT * FROM customer_social_links
       WHERE customer_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(customerId)
    .all<CustomerSocialLink>()
  return result.results
}

export async function getCustomerWithLinks(
  db: D1Database,
  customerId: string,
  ownerId: string,
): Promise<CustomerWithLinks | null> {
  const customer = await getCustomerByIdForOwner(db, customerId, ownerId)
  if (!customer) return null
  const social_links = await getSocialLinks(db, customerId)
  return { ...customer, social_links }
}

async function replaceSocialLinks(
  db: D1Database,
  customerId: string,
  links: Array<{ platform_name?: string; url?: string; icon_class?: string }>,
): Promise<void> {
  await db
    .prepare('DELETE FROM customer_social_links WHERE customer_id = ?')
    .bind(customerId)
    .run()

  const now = new Date().toISOString()
  let order = 0

  for (const link of links) {
    const platform = (link.platform_name ?? '').trim()
    const url = (link.url ?? '').trim()
    const icon = (link.icon_class ?? '').trim()

    // Skip completely empty rows
    if (!platform && !url && !icon) continue

    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO customer_social_links
           (id, customer_id, platform_name, url, icon_class, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, customerId, platform, url, icon, order, now)
      .run()
    order += 1
  }
}

export async function createCustomer(
  db: D1Database,
  ownerId: string,
  input: CustomerInput,
): Promise<CustomerWithLinks> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const slug = normalizeCustomerSlug(input.slug)

  if (slug && (await isSlugTaken(db, slug))) {
    throw new SlugConflictError('Slug is already in use')
  }

  await db
    .prepare(
      `INSERT INTO customers (
         id, owner_id, first_name, last_name, email,
         country_code, mobile, company_name, slug,
         company_website, tag_line, designation,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ownerId,
      input.first_name.trim(),
      input.last_name.trim(),
      input.email.trim().toLowerCase(),
      input.country_code.trim() || '+91',
      input.mobile.trim(),
      emptyToNull(input.company_name),
      slug,
      emptyToNull(input.company_website),
      emptyToNull(input.tag_line),
      emptyToNull(input.designation),
      now,
      now,
    )
    .run()

  await replaceSocialLinks(db, id, input.social_links ?? [])

  const created = await getCustomerWithLinks(db, id, ownerId)
  if (!created) throw new Error('Failed to retrieve customer after creation')
  return created
}

export async function updateCustomer(
  db: D1Database,
  customerId: string,
  ownerId: string,
  input: CustomerInput,
): Promise<CustomerWithLinks | null> {
  const existing = await getCustomerByIdForOwner(db, customerId, ownerId)
  if (!existing) return null

  const slug = normalizeCustomerSlug(input.slug)
  if (slug && (await isSlugTaken(db, slug, customerId))) {
    throw new SlugConflictError('Slug is already in use')
  }

  const now = new Date().toISOString()

  await db
    .prepare(
      `UPDATE customers SET
         first_name = ?,
         last_name = ?,
         email = ?,
         country_code = ?,
         mobile = ?,
         company_name = ?,
         slug = ?,
         company_website = ?,
         tag_line = ?,
         designation = ?,
         updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      input.first_name.trim(),
      input.last_name.trim(),
      input.email.trim().toLowerCase(),
      input.country_code.trim() || '+91',
      input.mobile.trim(),
      emptyToNull(input.company_name),
      slug,
      emptyToNull(input.company_website),
      emptyToNull(input.tag_line),
      emptyToNull(input.designation),
      now,
      customerId,
      ownerId,
    )
    .run()

  await replaceSocialLinks(db, customerId, input.social_links ?? [])

  return getCustomerWithLinks(db, customerId, ownerId)
}

export async function softDeleteCustomer(
  db: D1Database,
  customerId: string,
  ownerId: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE customers
         SET deleted_at = ?, updated_at = ?, slug = NULL
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, customerId, ownerId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function updateCustomerPhoto(
  db: D1Database,
  customerId: string,
  ownerId: string,
  kind: 'profile' | 'cover',
  key: string,
  url: string,
): Promise<Customer | null> {
  const existing = await getCustomerByIdForOwner(db, customerId, ownerId)
  if (!existing) return null

  const now = new Date().toISOString()
  if (kind === 'profile') {
    await db
      .prepare(
        `UPDATE customers
           SET profile_photo_key = ?, profile_photo_url = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(key, url, now, customerId, ownerId)
      .run()
  } else {
    await db
      .prepare(
        `UPDATE customers
           SET cover_photo_key = ?, cover_photo_url = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(key, url, now, customerId, ownerId)
      .run()
  }

  return getCustomerByIdForOwner(db, customerId, ownerId)
}

export class SlugConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlugConflictError'
  }
}
