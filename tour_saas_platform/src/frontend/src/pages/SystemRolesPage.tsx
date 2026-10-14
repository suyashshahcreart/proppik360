import { useCallback, useState, useEffect, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { api } from '../services/api'
import type { Role, Permission } from '../types'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ListBox } from '@/components/shared/ListBox'
import { PageHeader } from '@/components/shared/PageHeader'
import { RowActions } from '@/components/shared/RowActions'
import { useListControls } from '@/hooks/useListControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// ── Helpers ────────────────────────────────────────────────────

/** Group permissions by their first underscore-separated segment. */
function groupPermissions(permissions: Permission[]): Map<string, Permission[]> {
  const groups = new Map<string, Permission[]>()
  for (const p of permissions) {
    const key = p.name.split('_')[0]
    const label = key.charAt(0).toUpperCase() + key.slice(1)
    const arr = groups.get(label) ?? []
    arr.push(p)
    groups.set(label, arr)
  }
  return groups
}

// ── Grouped Picker Component ──────────────────────────────────

interface PermissionPickerProps {
  allPermissions: Permission[]
  selectedIds: Set<string>
  onChange: (ids: Set<string>) => void
  disabled?: boolean
}

function PermissionPicker({ allPermissions, selectedIds, onChange, disabled }: PermissionPickerProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(groupPermissions(allPermissions).keys()))
  const groups = groupPermissions(allPermissions)
  const groupEntries = Array.from(groups.entries())

  const toggleAll = () => {
    onChange(selectedIds.size === allPermissions.length ? new Set() : new Set(allPermissions.map((p) => p.id)))
  }

  const collapseAll = () => setOpenGroups(new Set())
  const expandAll = () => setOpenGroups(new Set(groups.keys()))

  const toggleGroup = (perms: Permission[]) => {
    const groupIds = perms.map((p) => p.id)
    const allSelected = groupIds.every((id) => selectedIds.has(id))
    const next = new Set(selectedIds)
    if (allSelected) {
      groupIds.forEach((id) => next.delete(id))
    } else {
      groupIds.forEach((id) => next.add(id))
    }
    onChange(next)
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const toggleOpen = (label: string) => {
    const next = new Set(openGroups)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setOpenGroups(next)
  }

  const allChecked = selectedIds.size === allPermissions.length && allPermissions.length > 0

  const half = Math.ceil(groupEntries.length / 2)
  const columns = [groupEntries.slice(0, half), groupEntries.slice(half)]

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={disabled} />
          Select All Permissions
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={collapseAll}>
            Collapse All
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={expandAll}>
            Expand All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-2">
            {col.map(([label, perms]) => {
              const groupIds = perms.map((p) => p.id)
              const selectedCount = groupIds.filter((id) => selectedIds.has(id)).length
              const allSel = selectedCount === groupIds.length
              const isOpen = openGroups.has(label)

              return (
                <Collapsible key={label} open={isOpen} onOpenChange={() => toggleOpen(label)}>
                  <div className="overflow-hidden rounded-md border border-border bg-card">
                    <div className="flex items-center gap-2 bg-secondary px-3 py-2">
                      <Checkbox
                        checked={allSel}
                        onCheckedChange={() => toggleGroup(perms)}
                        disabled={disabled}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <CollapsibleTrigger asChild>
                        <button type="button" className="flex flex-1 items-center gap-1.5 text-left text-sm font-semibold text-foreground">
                          {label}
                          <span className="text-xs font-normal text-muted-foreground">
                            ({selectedCount}/{groupIds.length})
                          </span>
                          {isOpen ? (
                            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-1.5 px-3 py-2.5">
                        {perms.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={selectedIds.has(p.id)}
                              onCheckedChange={() => toggleOne(p.id)}
                              disabled={disabled}
                            />
                            <code className="text-xs text-foreground">{p.name}</code>
                          </label>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────

type ModalMode = 'create' | 'edit' | null

export function SystemRolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [allPermissions, setAllPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [formName, setFormName] = useState('')
  const [selectedPermIds, setSelectedPermIds] = useState<Set<string>>(new Set())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [deleting, setDeleting] = useState(false)

  const filterRoles = useCallback((r: Role, query: string) => {
    const haystack = [r.name, ...r.permission_names].join(' ').toLowerCase()
    return haystack.includes(query)
  }, [])

  const list = useListControls({
    items: roles,
    filterFn: filterRoles,
    defaultPageSize: 10,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rolesData, permsData] = await Promise.all([api.system.roles.list(), api.system.permissions.list()])
      setRoles(rolesData)
      setAllPermissions(permsData)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditTarget(null)
    setFormName('')
    setSelectedPermIds(new Set())
    setFormError(null)
    setModalMode('create')
  }

  const openEdit = (r: Role) => {
    setEditTarget(r)
    setFormName(r.name)
    setSelectedPermIds(new Set(r.permission_ids))
    setFormError(null)
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditTarget(null)
    setFormName('')
    setSelectedPermIds(new Set())
    setFormError(null)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const permIds = Array.from(selectedPermIds)
      if (modalMode === 'create') {
        await api.system.roles.create(formName.trim(), permIds)
      } else if (editTarget) {
        await api.system.roles.update(editTarget.id, formName.trim(), permIds)
      }
      closeModal()
      await load()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.system.roles.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<Role>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-semibold text-foreground">{r.name}</span>,
    },
    {
      key: 'permissions',
      header: 'Permissions',
      render: (r) => {
        const visible = r.permission_names.slice(0, 3)
        const extra = r.permission_names.length - 3
        return (
          <div className="flex flex-wrap gap-1">
            {visible.map((n) => (
              <Badge key={n} variant="default">
                {n}
              </Badge>
            ))}
            {extra > 0 && <Badge variant="outline">+{extra} more</Badge>}
          </div>
        )
      },
    },
    {
      key: 'users',
      header: 'Users',
      sortable: true,
      sortValue: (r) => r.users_count,
      render: (r) => <Badge variant="info">{r.users_count}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (r) => (
        <RowActions onEdit={() => openEdit(r)} onDelete={() => setDeleteTarget(r)} />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Roles Management"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'System' },
          { label: 'Roles' },
        ]}
        showBack
        backTo="/"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New Role
          </Button>
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}

      <ListBox
        title="Roles List"
        subtitle="Group permissions into assignable roles"
        onRefresh={load}
        refreshing={loading}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search roles…"
        page={list.page}
        totalPages={list.totalPages}
        onPageChange={list.setPage}
        pageSize={list.pageSize}
        pageSizeOptions={list.pageSizeOptions}
        onPageSizeChange={list.setPageSize}
        totalItems={list.total}
        from={list.from}
        to={list.to}
      >
        <DataTable
          columns={columns}
          data={list.paginated}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={ShieldCheck}
              title={list.search ? 'No matching roles' : 'No roles found'}
            />
          }
        />
      </ListBox>

      {/* Create / Edit dialog */}
      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-3xl">
          <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{modalMode === 'create' ? 'Add Role' : `Edit Role: ${editTarget?.name}`}</DialogTitle>
            </DialogHeader>

            {formError && (
              <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{formError}</div>
            )}

            <FormField label="Role Name" required>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. tour_manager"
                pattern="[A-Za-z0-9_-]+"
                required
                autoFocus
              />
            </FormField>

            <FormField label="Permissions">
              {allPermissions.length === 0 ? (
                <div className="rounded-md bg-info-subtle px-3 py-2 text-sm text-info">No permissions available.</div>
              ) : (
                <PermissionPicker allPermissions={allPermissions} selectedIds={selectedPermIds} onChange={setSelectedPermIds} />
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? 'Saving…' : modalMode === 'create' ? 'Create Role' : 'Update Role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Role"
        description={
          <>
            Delete role <strong>{deleteTarget?.name}</strong>? Users assigned only this role will be moved to the{' '}
            <strong>user</strong> role.
          </>
        }
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
      />
    </div>
  )
}
