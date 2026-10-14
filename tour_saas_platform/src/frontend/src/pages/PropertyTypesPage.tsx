import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { api } from '../services/api'
import type { PropertyCategoryTreeNode, PropertyStatus, User } from '../types'
import { can, PermissionGate } from '@/components/shared/PermissionGate'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { CategoryIcon } from '@/components/icons/CategoryIcon'
import { IconSelectField } from '@/components/icons/IconSelectField'
import { formatCategoryIconLabel } from '@/lib/category-icons'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type ModalMode = 'create' | 'edit' | null

interface PropertyTypesPageProps {
  user: User
}

interface FormState {
  name: string
  slug: string
  icon: string | null
  status: PropertyStatus
  sort_order: string
  parent_id: string | null
}

const emptyForm = (parentId: string | null = null): FormState => ({
  name: '',
  slug: '',
  icon: null,
  status: 'active',
  sort_order: '0',
  parent_id: parentId,
})

function StatusBadge({ status }: { status: PropertyStatus }) {
  return (
    <Badge variant={status === 'active' ? 'success' : 'secondary'}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </Badge>
  )
}

function findNodeById(
  nodes: PropertyCategoryTreeNode[],
  id: string,
): PropertyCategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}

function collectAncestorIds(
  nodes: PropertyCategoryTreeNode[],
  targetId: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail
    const found = collectAncestorIds(node.children, targetId, [...trail, node.id])
    if (found) return found
  }
  return null
}

function filterTree(
  nodes: PropertyCategoryTreeNode[],
  query: string,
): PropertyCategoryTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  const filterNode = (node: PropertyCategoryTreeNode): PropertyCategoryTreeNode | null => {
    const nameMatch = node.name.toLowerCase().includes(q)
    const slugMatch = node.slug?.toLowerCase().includes(q) ?? false
    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is PropertyCategoryTreeNode => n !== null)

    if (nameMatch || slugMatch || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren }
    }
    return null
  }

  return nodes.map(filterNode).filter((n): n is PropertyCategoryTreeNode => n !== null)
}

interface TreeNodeProps {
  node: PropertyCategoryTreeNode
  depth: number
  selectedId: string | null
  expandedIds: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}

function TreeNodeRow({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id

  return (
    <Collapsible open={isExpanded} onOpenChange={() => onToggle(node.id)}>
      <div className="flex flex-col">
        <div
          className={cn(
            'flex items-center gap-1 rounded-md py-1 pr-2 transition-colors hover:bg-secondary/60',
            isSelected && 'bg-primary/10 ring-1 ring-inset ring-primary/20',
          )}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="size-6 shrink-0" />
          )}

          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
            onClick={() => onSelect(node.id)}
          >
            <CategoryIcon
              icon={node.icon}
              className="size-4 shrink-0 text-muted-foreground"
              imgClassName="size-4"
            />
            <span className={cn('truncate font-medium', isSelected && 'text-primary')}>
              {node.name}
            </span>
            {node.children_count > 0 && (
              <Badge variant="info" className="shrink-0 text-[10px]">
                {node.children_count}
              </Badge>
            )}
            <StatusBadge status={node.status} />
          </button>
        </div>

        {hasChildren && (
          <CollapsibleContent>
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  )
}

export function PropertyTypesPage({ user }: PropertyTypesPageProps) {
  const [tree, setTree] = useState<PropertyCategoryTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
    childrenCount: number
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search])

  const selectedNode = useMemo(
    () => (selectedId ? findNodeById(tree, selectedId) : null),
    [tree, selectedId],
  )

  const breadcrumb = useMemo(() => {
    if (!selectedId) return []
    const ids = collectAncestorIds(tree, selectedId) ?? []
    return ids.map((id) => findNodeById(tree, id)).filter(Boolean) as PropertyCategoryTreeNode[]
  }, [tree, selectedId])

  const loadTree = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.system.propertyCategories.tree()
      setTree(data)
      setSelectedId((prev) => (prev && findNodeById(data, prev) ? prev : data[0]?.id ?? null))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    if (!selectedId) return
    const ancestors = collectAncestorIds(tree, selectedId) ?? []
    setExpandedIds((prev) => {
      const next = new Set(prev)
      ancestors.forEach((id) => next.add(id))
      if (selectedId) next.add(selectedId)
      return next
    })
  }, [selectedId, tree])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => {
    const ids = new Set<string>()
    const walk = (nodes: PropertyCategoryTreeNode[]) => {
      nodes.forEach((n) => {
        if (n.children.length > 0) {
          ids.add(n.id)
          walk(n.children)
        }
      })
    }
    walk(tree)
    setExpandedIds(ids)
  }

  const collapseAll = () => setExpandedIds(new Set())

  const openCreate = (parentId: string | null) => {
    setModalMode('create')
    setEditId(null)
    setFormError(null)
    setForm(emptyForm(parentId))
  }

  const openEdit = (node: PropertyCategoryTreeNode) => {
    setModalMode('edit')
    setEditId(node.id)
    setFormError(null)
    setForm({
      name: node.name,
      slug: node.slug ?? '',
      icon: node.icon ?? null,
      status: node.status,
      sort_order: String(node.sort_order ?? 0),
      parent_id: node.parent_id,
    })
  }

  const closeModal = () => {
    setModalMode(null)
    setEditId(null)
    setForm(emptyForm())
    setFormError(null)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!modalMode) return
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }

    const sortOrder = Number.parseInt(form.sort_order || '0', 10)
    if (Number.isNaN(sortOrder) || sortOrder < 0) {
      setFormError('Sort order must be a non-negative integer')
      return
    }

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || null,
      icon: form.icon,
      status: form.status,
      sort_order: sortOrder,
      parent_id: form.parent_id,
    }

    setSaving(true)
    setFormError(null)
    try {
      if (modalMode === 'create') {
        const created = await api.system.propertyCategories.create(payload)
        closeModal()
        await loadTree()
        setSelectedId(created.id)
      } else if (editId) {
        await api.system.propertyCategories.update(editId, payload)
        closeModal()
        await loadTree()
      }
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    try {
      await api.system.propertyCategories.delete(deleteTarget.id)
      if (selectedId === deleteTarget.id) setSelectedId(null)
      setDeleteTarget(null)
      await loadTree()
    } catch (e) {
      setError((e as Error).message)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const modalTitle =
    modalMode === 'create'
      ? form.parent_id
        ? 'Add Child Category'
        : 'Add Root Category'
      : 'Edit Category'

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Property Categories"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Masters' },
          { label: 'Property Categories' },
        ]}
        showBack
        backTo="/"
        actions={
          <PermissionGate user={user} permission="property_type_create">
            <Button size="sm" onClick={() => openCreate(null)}>
              <Plus className="size-4" />
              New Root Category
            </Button>
          </PermissionGate>
        }
      />

      {error && (
        <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1.2fr)]">
        {/* Tree panel */}
        <div className="flex flex-col rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <FolderTree className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Category Tree</h2>
            <div className="ml-auto flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={collapseAll}>
                Collapse
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={expandAll}>
                Expand
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => void loadTree()}
                disabled={loading}
                aria-label="Refresh tree"
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="border-b border-border px-4 py-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
            />
          </div>

          <div className="min-h-[320px] flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : filteredTree.length === 0 ? (
              <EmptyState
                icon={Building2}
                title={search ? 'No matching categories' : 'No categories yet'}
                description={
                  search ? undefined : 'Create a root category to start building your hierarchy.'
                }
              />
            ) : (
              filteredTree.map((node) => (
                <TreeNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onSelect={setSelectedId}
                  onToggle={toggleExpanded}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
          </div>

          {!selectedNode ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                icon={Building2}
                title="Select a category"
                description="Choose a node from the tree to view details and manage children."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              {breadcrumb.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {breadcrumb.map((node, i) => (
                    <span key={node.id} className="flex items-center gap-1">
                      {i > 0 && <span>→</span>}
                      <button
                        type="button"
                        className="rounded px-1 hover:text-primary"
                        onClick={() => setSelectedId(node.id)}
                      >
                        {node.name}
                      </button>
                    </span>
                  ))}
                  <span>→</span>
                  <span className="font-medium text-foreground">{selectedNode.name}</span>
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40">
                  <CategoryIcon
                    icon={selectedNode.icon}
                    className="size-6 text-muted-foreground"
                    imgClassName="size-6"
                  />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{selectedNode.name}</h3>
                  {selectedNode.slug && (
                    <p className="text-sm text-muted-foreground">/{selectedNode.slug}</p>
                  )}
                  {selectedNode.icon && (
                    <p className="text-xs text-muted-foreground">
                      {formatCategoryIconLabel(selectedNode.icon)}
                    </p>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={selectedNode.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Depth</dt>
                  <dd className="mt-1 font-medium">{selectedNode.depth + 1}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sort order</dt>
                  <dd className="mt-1 font-medium">{selectedNode.sort_order}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Children</dt>
                  <dd className="mt-1 font-medium">{selectedNode.children_count}</dd>
                </div>
                {selectedNode.parent_name && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Parent</dt>
                    <dd className="mt-1 font-medium">{selectedNode.parent_name}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
                <PermissionGate user={user} permission="property_type_create">
                  <Button size="sm" variant="outline" onClick={() => openCreate(selectedNode.id)}>
                    <Plus className="size-4" />
                    Add Child
                  </Button>
                </PermissionGate>
                {can(user, 'property_type_edit') && (
                  <Button size="sm" variant="outline" onClick={() => openEdit(selectedNode)}>
                    Edit
                  </Button>
                )}
                {can(user, 'property_type_delete') && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      setDeleteTarget({
                        id: selectedNode.id,
                        name: selectedNode.name,
                        childrenCount: selectedNode.children_count,
                      })
                    }
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave} noValidate>
            <DialogHeader>
              <DialogTitle>{modalTitle}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              {formError && (
                <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              )}

              {modalMode === 'create' && form.parent_id && (
                <FormField label="Parent">
                  <Input
                    value={findNodeById(tree, form.parent_id)?.name ?? 'Selected parent'}
                    disabled
                  />
                </FormField>
              )}

              <FormField label="Name" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Residential"
                  required
                  autoFocus
                />
              </FormField>

              <FormField label="Slug" hint="Optional — auto-generated from name if empty">
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="e.g. residential"
                />
              </FormField>

              <IconSelectField
                value={form.icon}
                onChange={(icon) => setForm((f) => ({ ...f, icon }))}
                hint="Optional — shown in the category tree and detail panel"
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Status">
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, status: v as PropertyStatus }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Sort order">
                  <Input
                    type="number"
                    min={0}
                    value={form.sort_order}
                    onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                  />
                </FormField>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? 'Saving…' : modalMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete category"
        description={
          <>
            Delete <strong>{deleteTarget?.name}</strong>?
          </>
        }
        loading={deleting}
        confirmLabel={
          deleting
            ? 'Deleting…'
            : (deleteTarget?.childrenCount ?? 0) > 0
              ? 'Understood'
              : 'Delete'
        }
        destructive={(deleteTarget?.childrenCount ?? 0) === 0}
        onConfirm={() => {
          if ((deleteTarget?.childrenCount ?? 0) > 0) {
            setDeleteTarget(null)
            return
          }
          void handleDelete()
        }}
      >
        {deleteTarget && (deleteTarget.childrenCount ?? 0) > 0 && (
          <div className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
            This category has {deleteTarget.childrenCount} child
            {deleteTarget.childrenCount === 1 ? '' : 'ren'}. Remove children first before
            deleting.
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
