import { useCallback, useState, useEffect, type FormEvent } from 'react'
import { Loader2, Plus, UserCog } from 'lucide-react'
import { api } from '../services/api'
import type { AdminUser, Role } from '../types'
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

type ModalMode = 'create' | 'edit' | null

interface UserForm {
  name: string
  email: string
  password: string
  status: 'active' | 'suspended'
  roleIds: string[]
}

const emptyForm = (): UserForm => ({
  name: '',
  email: '',
  password: '',
  status: 'active',
  roleIds: [],
})

export function SystemUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const filterUsers = useCallback((u: AdminUser, query: string) => {
    const haystack = [u.name, u.email, u.status, ...u.roles].join(' ').toLowerCase()
    return haystack.includes(query)
  }, [])

  const list = useListControls({
    items: users,
    filterFn: filterUsers,
    defaultPageSize: 10,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersData, rolesData] = await Promise.all([api.system.users.list(), api.system.roles.list()])
      setUsers(usersData)
      setRoles(rolesData)
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
    setForm(emptyForm())
    setFormError(null)
    setModalMode('create')
  }

  const openEdit = async (u: AdminUser) => {
    setEditTarget(u)
    try {
      const detail = await api.system.users.get(u.id)
      const roleIds = roles.filter((r) => detail.roles.includes(r.name)).map((r) => r.id)
      setForm({ name: detail.name, email: detail.email, password: '', status: detail.status, roleIds })
    } catch {
      setForm({
        name: u.name,
        email: u.email,
        password: '',
        status: u.status,
        roleIds: roles.filter((r) => u.roles.includes(r.name)).map((r) => r.id),
      })
    }
    setFormError(null)
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditTarget(null)
    setForm(emptyForm())
    setFormError(null)
  }

  const setField = <K extends keyof UserForm>(key: K, value: UserForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const toggleRole = (roleId: string) => {
    setForm((f) => ({
      ...f,
      roleIds: f.roleIds.includes(roleId) ? f.roleIds.filter((id) => id !== roleId) : [...f.roleIds, roleId],
    }))
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      if (modalMode === 'create') {
        await api.system.users.create({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          status: form.status,
          role_ids: form.roleIds,
        })
      } else if (editTarget) {
        await api.system.users.update(editTarget.id, {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password || undefined,
          status: form.status,
          role_ids: form.roleIds,
        })
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
      await api.system.users.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (u) => u.name,
      render: (u) => <span className="font-semibold text-foreground">{u.name}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      sortValue: (u) => u.email,
      render: (u) => <span className="text-sm text-muted-foreground">{u.email}</span>,
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) =>
        u.roles.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <Badge key={r} variant={r === 'admin' ? 'destructive' : 'default'}>
                {r}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (u) => u.status,
      render: (u) => <Badge variant={u.status === 'active' ? 'success' : 'secondary'}>{u.status}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (u) => (
        <RowActions onEdit={() => openEdit(u)} onDelete={() => setDeleteTarget(u)} />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Users Management"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'System' },
          { label: 'Users' },
        ]}
        showBack
        backTo="/"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New User
          </Button>
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}

      <ListBox
        title="Users List"
        subtitle="Manage platform user accounts and role assignments"
        onRefresh={load}
        refreshing={loading}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search users…"
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
          keyExtractor={(u) => u.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={UserCog}
              title={list.search ? 'No matching users' : 'No users found'}
            />
          }
        />
      </ListBox>

      {/* Create / Edit dialog */}
      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{modalMode === 'create' ? 'Add User' : `Edit User: ${editTarget?.name}`}</DialogTitle>
            </DialogHeader>

            {formError && (
              <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{formError}</div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Name" required>
                <Input value={form.name} onChange={(e) => setField('name', e.target.value)} required autoFocus />
              </FormField>
              <FormField label="Email" required>
                <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} required />
              </FormField>
              <FormField
                label="Password"
                required={modalMode === 'create'}
                hint={modalMode === 'edit' ? 'Leave blank to keep current' : undefined}
              >
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  required={modalMode === 'create'}
                  minLength={8}
                  autoComplete="new-password"
                />
              </FormField>
              <FormField label="Status">
                <Select value={form.status} onValueChange={(v) => setField('status', v as 'active' | 'suspended')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField label="Roles">
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles available.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-3">
                  {roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.roleIds.includes(role.id)} onCheckedChange={() => toggleRole(role.id)} />
                      {role.name}
                    </label>
                  ))}
                </div>
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {saving ? 'Saving…' : modalMode === 'create' ? 'Create User' : 'Update User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete User"
        description={
          <>
            Delete user <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </>
        }
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
      />
    </div>
  )
}
