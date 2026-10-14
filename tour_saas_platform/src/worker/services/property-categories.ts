// ============================================================
// Property classification master-data service (recursive hierarchy)
//
// Self-referential property_categories table — unlimited depth.
// Soft-delete via deleted_at; block delete when active children exist.
// ============================================================
import { slugify } from '../utils/slug'

export type PropertyStatus = 'active' | 'inactive'

export interface PropertyCategoryRow {
  id: string
  parent_id: string | null
  name: string
  slug: string | null
  icon: string | null
  status: PropertyStatus
  sort_order: number
  depth: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  children_count: number
  parent_name?: string
}

export interface PropertyCategoryTreeNode extends PropertyCategoryRow {
  children: PropertyCategoryTreeNode[]
}

export interface PropertyCategoryInput {
  name: string
  parent_id?: string | null
  slug?: string | null
  icon?: string | null
  status?: PropertyStatus
  sort_order?: number
}

function resolveSlug(name: string, slug?: string | null): string {
  const raw = (slug && slug.trim()) || name
  return slugify(raw)
}

const categorySelect = `
  SELECT pc.*,
         parent.name AS parent_name,
         (SELECT COUNT(*) FROM property_categories child
          WHERE child.parent_id = pc.id AND child.deleted_at IS NULL) AS children_count
  FROM property_categories pc
  LEFT JOIN property_categories parent ON parent.id = pc.parent_id AND parent.deleted_at IS NULL
`

function parseParentId(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'null') return null
  return raw
}

export async function listPropertyCategories(
  db: D1Database,
  parentId?: string | null,
): Promise<PropertyCategoryRow[]> {
  const parent = parseParentId(parentId)

  if (parent === null) {
    const rows = await db
      .prepare(
        `${categorySelect}
         WHERE pc.deleted_at IS NULL AND pc.parent_id IS NULL
         ORDER BY pc.sort_order ASC, pc.name ASC`,
      )
      .all<PropertyCategoryRow>()
    return rows.results
  }

  const rows = await db
    .prepare(
      `${categorySelect}
       WHERE pc.deleted_at IS NULL AND pc.parent_id = ?
       ORDER BY pc.sort_order ASC, pc.name ASC`,
    )
    .bind(parent)
    .all<PropertyCategoryRow>()

  return rows.results
}

export async function listAllPropertyCategories(
  db: D1Database,
): Promise<PropertyCategoryRow[]> {
  const rows = await db
    .prepare(
      `${categorySelect}
       WHERE pc.deleted_at IS NULL
       ORDER BY pc.depth ASC, pc.sort_order ASC, pc.name ASC`,
    )
    .all<PropertyCategoryRow>()

  return rows.results
}

export function buildPropertyCategoryTree(
  rows: PropertyCategoryRow[],
): PropertyCategoryTreeNode[] {
  const byId = new Map<string, PropertyCategoryTreeNode>()
  const roots: PropertyCategoryTreeNode[] = []

  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] })
  }

  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (nodes: PropertyCategoryTreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)

  return roots
}

export async function getPropertyCategoryTree(
  db: D1Database,
): Promise<PropertyCategoryTreeNode[]> {
  const rows = await listAllPropertyCategories(db)
  return buildPropertyCategoryTree(rows)
}

export async function getPropertyCategory(
  db: D1Database,
  id: string,
): Promise<PropertyCategoryRow | null> {
  return (
    (await db
      .prepare(`${categorySelect} WHERE pc.id = ? AND pc.deleted_at IS NULL`)
      .bind(id)
      .first<PropertyCategoryRow>()) ?? null
  )
}

async function getParentDepth(
  db: D1Database,
  parentId: string | null,
): Promise<number | { error: string }> {
  if (parentId === null) return -1

  const parent = await getPropertyCategory(db, parentId)
  if (!parent) return { error: 'Parent category not found' }

  return parent.depth
}

async function isDescendant(
  db: D1Database,
  ancestorId: string,
  nodeId: string,
): Promise<boolean> {
  let current = await getPropertyCategory(db, nodeId)
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true
    current = await getPropertyCategory(db, current.parent_id)
  }
  return false
}

async function updateDescendantDepths(
  db: D1Database,
  parentId: string,
  parentDepth: number,
): Promise<void> {
  const children = await listPropertyCategories(db, parentId)
  const now = new Date().toISOString()

  for (const child of children) {
    const depth = parentDepth + 1
    await db
      .prepare(
        `UPDATE property_categories SET depth = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(depth, now, child.id)
      .run()
    await updateDescendantDepths(db, child.id, depth)
  }
}

export async function createPropertyCategory(
  db: D1Database,
  input: PropertyCategoryInput,
): Promise<PropertyCategoryRow | { error: string }> {
  const parentId = parseParentId(input.parent_id ?? null)
  const parentDepth = await getParentDepth(db, parentId)
  if (typeof parentDepth === 'object') return parentDepth

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const slug = resolveSlug(input.name, input.slug)
  const depth = parentDepth + 1

  await db
    .prepare(
      `INSERT INTO property_categories
         (id, parent_id, name, slug, icon, status, sort_order, depth, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      parentId,
      input.name.trim(),
      slug,
      input.icon ?? null,
      input.status ?? 'active',
      input.sort_order ?? 0,
      depth,
      now,
      now,
    )
    .run()

  return (await getPropertyCategory(db, id))!
}

export async function updatePropertyCategory(
  db: D1Database,
  id: string,
  input: PropertyCategoryInput,
): Promise<PropertyCategoryRow | { error: string } | null> {
  const existing = await getPropertyCategory(db, id)
  if (!existing) return null

  const parentId = parseParentId(
    input.parent_id !== undefined ? input.parent_id : existing.parent_id,
  )

  if (parentId === id) {
    return { error: 'A category cannot be its own parent' }
  }

  if (parentId && (await isDescendant(db, id, parentId))) {
    return { error: 'Cannot move a category under one of its descendants' }
  }

  const parentDepth = await getParentDepth(db, parentId)
  if (typeof parentDepth === 'object') return parentDepth

  const now = new Date().toISOString()
  const slug = resolveSlug(input.name, input.slug)
  const depth = parentDepth + 1

  const icon =
    input.icon !== undefined ? input.icon : existing.icon

  await db
    .prepare(
      `UPDATE property_categories
       SET parent_id = ?, name = ?, slug = ?, icon = ?, status = ?, sort_order = ?, depth = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(
      parentId,
      input.name.trim(),
      slug,
      icon,
      input.status ?? existing.status,
      input.sort_order ?? existing.sort_order,
      depth,
      now,
      id,
    )
    .run()

  if (depth !== existing.depth) {
    await updateDescendantDepths(db, id, depth)
  }

  return getPropertyCategory(db, id)
}

export async function deletePropertyCategory(
  db: D1Database,
  id: string,
): Promise<{ error: string } | null> {
  const existing = await getPropertyCategory(db, id)
  if (!existing) return { error: 'Property category not found' }

  if (existing.children_count > 0) {
    return {
      error: `Cannot delete: ${existing.children_count} child categor${existing.children_count === 1 ? 'y' : 'ies'} still exist. Remove them first.`,
    }
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE property_categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, id)
    .run()

  return null
}
