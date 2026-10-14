import { useCallback, useState, useEffect, type FormEvent } from 'react'
import { KeyRound, Plus, Loader2 } from 'lucide-react'
import { api } from '../services/api'
import type { Permission } from '../types'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

type ModalMode = 'create' | 'edit' | null

export function SystemPermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editTarget, setEditTarget] = useState<Permission | null>(null)
  const [formName, setFormName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Permission | null>(null)
  const [deleting, setDeleting] = useState(false)

  const filterPermissions = useCallback((p: Permission, query: string) => {
    return p.name.toLowerCase().includes(query) || p.guard_name.toLowerCase().includes(query)
  }, [])

  const list = useListControls({
    items: permissions,
    filterFn: filterPermissions,
    defaultPageSize: 10,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.system.permissions.list()
      setPermissions(data)
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
    setFormError(null)
    setModalMode('create')
  }

  const openEdit = (p: Permission) => {
    setEditTarget(p)
    setFormName(p.name)
    setFormError(null)
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditTarget(null)
    setFormName('')
    setFormError(null)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      if (modalMode === 'create') {
        await api.system.permissions.create(formName.trim())
      } else if (editTarget) {
        await api.system.permissions.update(editTarget.id, formName.trim())
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
      await api.system.permissions.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<Permission>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (p) => p.name,
      render: (p) => <code className="text-sm text-primary">{p.name}</code>,
    },
    {
      key: 'guard',
      header: 'Guard',
      sortable: true,
      sortValue: (p) => p.guard_name,
      render: (p) => <Badge variant="secondary">{p.guard_name}</Badge>,
    },
    {
      key: 'roles',
      header: 'Assigned Roles',
      sortable: true,
      sortValue: (p) => p.roles_count,
      render: (p) => (
        <Badge variant="info">
          {p.roles_count} role{p.roles_count !== 1 ? 's' : ''}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (p) => (
        <RowActions onEdit={() => openEdit(p)} onDelete={() => setDeleteTarget(p)} />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Permissions Management"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'System' },
          { label: 'Permissions' },
        ]}
        showBack
        backTo="/"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New Permission
          </Button>
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}

      <ListBox
        title="Permissions List"
        subtitle="Define access rules for roles and users"
        onRefresh={load}
        refreshing={loading}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search permissions…"
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
          keyExtractor={(p) => p.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title={list.search ? 'No matching permissions' : 'No permissions found'}
            />
          }
        />
      </ListBox>

      {/* Create / Edit dialog */}
      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave} noValidate>
            <DialogHeader>
              <DialogTitle>{modalMode === 'create' ? 'Add Permission' : 'Edit Permission'}</DialogTitle>
            </DialogHeader>

            <div className="py-4">
              {formError && (
                <div className="mb-3 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              )}
              <FormField label="Name" required hint="Use resource_action format (letters, numbers, _, -)">
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. tour_view"
                  pattern="[A-Za-z0-9_-]+"
                  required
                  autoFocus
                />
              </FormField>
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

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Permission"
        description={<>Delete <code>{deleteTarget?.name}</code>?</>}
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
      >
        {deleteTarget && deleteTarget.roles_count > 0 && (
          <div className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
            This permission is assigned to {deleteTarget.roles_count} role(s).
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
