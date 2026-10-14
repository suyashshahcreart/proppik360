// ============================================================
// Property classification routes (system master data)
//
//   GET            /api/system/property-categories?parent_id=
//   GET            /api/system/property-categories/tree
//   GET/POST       /api/system/property-categories
//   GET/PUT/DELETE /api/system/property-categories/:id
//
// All routes: authMiddleware + requireNotCustomer + property_type_*
// ============================================================
import { Hono } from 'hono'
import { authMiddleware, requirePermission, requireNotCustomer } from '../middleware/auth'
import {
  listPropertyCategories,
  getPropertyCategoryTree,
  getPropertyCategory,
  createPropertyCategory,
  updatePropertyCategory,
  deletePropertyCategory,
} from '../services/property-categories'
import { logActivity } from '../services/activity'
import { ok, err } from '../utils/response'
import { propertyCategoryBodySchema } from '../utils/validation'
import type { Env, Variables } from '../types'

const propertyTypes = new Hono<{ Bindings: Env; Variables: Variables }>()

propertyTypes.use('*', authMiddleware, requireNotCustomer)

async function parseJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return { body: (await c.req.json()) as unknown }
  } catch {
    return { error: true as const }
  }
}

propertyTypes.get('/property-categories/tree', requirePermission('property_type_view'), async (c) => {
  const tree = await getPropertyCategoryTree(c.env.DB)
  return c.json(ok(tree))
})

propertyTypes.get('/property-categories', requirePermission('property_type_view'), async (c) => {
  const parentId = c.req.query('parent_id')
  const rows = await listPropertyCategories(c.env.DB, parentId)
  return c.json(ok(rows))
})

propertyTypes.get('/property-categories/:id', requirePermission('property_type_view'), async (c) => {
  const row = await getPropertyCategory(c.env.DB, c.req.param('id'))
  if (!row) return c.json(err('NOT_FOUND', 'Property category not found'), 404)
  return c.json(ok(row))
})

propertyTypes.post('/property-categories', requirePermission('property_type_create'), async (c) => {
  const parsedBody = await parseJson(c)
  if ('error' in parsedBody) {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = propertyCategoryBodySchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  try {
    const result = await createPropertyCategory(c.env.DB, parsed.data)
    if ('error' in result) {
      return c.json(err('NOT_FOUND', result.error), 404)
    }

    const actor = c.get('user')
    await logActivity(c.env.DB, actor.id, 'created', 'property_category', result.id, {
      name: result.name,
      parent_id: result.parent_id,
    })
    return c.json(ok(result), 201)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create property category'
    if (message.includes('UNIQUE')) {
      return c.json(
        err('CONFLICT', 'A category with this slug already exists under the same parent'),
        409,
      )
    }
    throw e
  }
})

propertyTypes.put('/property-categories/:id', requirePermission('property_type_edit'), async (c) => {
  const parsedBody = await parseJson(c)
  if ('error' in parsedBody) {
    return c.json(err('INVALID_INPUT', 'Request body must be valid JSON'), 422)
  }

  const parsed = propertyCategoryBodySchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    return c.json(err('INVALID_INPUT', parsed.error.errors[0].message), 422)
  }

  const id = c.req.param('id')
  try {
    const result = await updatePropertyCategory(c.env.DB, id, parsed.data)
    if (!result) return c.json(err('NOT_FOUND', 'Property category not found'), 404)
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 409
      return c.json(err(status === 404 ? 'NOT_FOUND' : 'CONFLICT', result.error), status)
    }

    const actor = c.get('user')
    await logActivity(c.env.DB, actor.id, 'updated', 'property_category', id, {
      name: result.name,
      parent_id: result.parent_id,
    })
    return c.json(ok(result))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update property category'
    if (message.includes('UNIQUE')) {
      return c.json(
        err('CONFLICT', 'A category with this slug already exists under the same parent'),
        409,
      )
    }
    throw e
  }
})

propertyTypes.delete(
  '/property-categories/:id',
  requirePermission('property_type_delete'),
  async (c) => {
    const id = c.req.param('id')
    const error = await deletePropertyCategory(c.env.DB, id)
    if (error) {
      const status = error.error.includes('not found') ? 404 : 409
      return c.json(err(status === 404 ? 'NOT_FOUND' : 'CONFLICT', error.error), status)
    }

    const actor = c.get('user')
    await logActivity(c.env.DB, actor.id, 'deleted', 'property_category', id)
    return c.json(ok({ message: 'Property category deleted' }))
  },
)

export { propertyTypes as propertyTypeRoutes }
