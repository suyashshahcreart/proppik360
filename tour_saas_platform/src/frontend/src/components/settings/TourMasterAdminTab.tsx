import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Save, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import type { TourAdminMaster, TourAdminMasterTemplate, User } from '@/types'
import { can } from '@/components/shared/PermissionGate'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { RowActions } from '@/components/shared/RowActions'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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

type ModalMode = 'create' | 'edit' | 'view' | null

interface TemplateForm {
  label: string
  username_pattern: string
  password_mode: 'random' | 'fixed'
  password: string
  country_code: string
  mobile: string
  password_enabled: boolean
  otp_enabled: boolean
  is_active: boolean
  sort_order: string
}

const emptyForm = (): TemplateForm => ({
  label: '',
  username_pattern: 'admin-{tour_id}',
  password_mode: 'random',
  password: '',
  country_code: '+91',
  mobile: '',
  password_enabled: true,
  otp_enabled: true,
  is_active: true,
  sort_order: '0',
})

function formFromTemplate(t: TourAdminMasterTemplate): TemplateForm {
  return {
    label: t.label,
    username_pattern: t.username_pattern,
    password_mode: t.password_mode,
    password: '',
    country_code: t.country_code || '+91',
    mobile: t.mobile ?? '',
    password_enabled: t.password_enabled,
    otp_enabled: t.otp_enabled,
    is_active: t.is_active,
    sort_order: String(t.sort_order ?? 0),
  }
}

export function TourMasterAdminTab({ user }: { user: User }) {
  const canEdit = can(user, 'setting_tour_admin')

  const [master, setMaster] = useState<TourAdminMaster | null>(null)
  const [templates, setTemplates] = useState<TourAdminMasterTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoCreate, setAutoCreate] = useState(true)
  const [savingAuto, setSavingAuto] = useState(false)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editTarget, setEditTarget] = useState<TourAdminMasterTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<TourAdminMasterTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [masterData, list] = await Promise.all([
        api.system.tourAdminMaster.get(),
        api.system.tourAdminMaster.templates.list(),
      ])
      setMaster(masterData)
      setAutoCreate(masterData.auto_create_on_tour_create)
      setTemplates(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveAutoCreate = async () => {
    if (!canEdit) return
    setSavingAuto(true)
    try {
      const updated = await api.system.tourAdminMaster.put({
        auto_create_on_tour_create: autoCreate,
      })
      setMaster(updated)
      toast.success('Auto-create setting saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSavingAuto(false)
    }
  }

  const openCreate = () => {
    setEditTarget(null)
    setForm(emptyForm())
    setFormError(null)
    setModalMode('create')
  }

  const openEdit = (t: TourAdminMasterTemplate) => {
    setEditTarget(t)
    setForm(formFromTemplate(t))
    setFormError(null)
    setModalMode('edit')
  }

  const openView = (t: TourAdminMasterTemplate) => {
    setEditTarget(t)
    setForm(formFromTemplate(t))
    setFormError(null)
    setModalMode('view')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditTarget(null)
    setForm(emptyForm())
    setFormError(null)
  }

  const setField = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit || modalMode === 'view') return
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        label: form.label.trim(),
        username_pattern: form.username_pattern.trim(),
        password_mode: form.password_mode,
        password: form.password.trim() || null,
        country_code: form.country_code.trim() || '+91',
        mobile: form.mobile.trim() || null,
        password_enabled: form.password_enabled,
        otp_enabled: form.otp_enabled,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      if (modalMode === 'create') {
        await api.system.tourAdminMaster.templates.create(payload)
        toast.success('Default admin added')
      } else if (editTarget) {
        await api.system.tourAdminMaster.templates.update(editTarget.id, payload)
        toast.success('Default admin updated')
      }
      closeModal()
      await load()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || !canEdit) return
    setDeleting(true)
    try {
      await api.system.tourAdminMaster.templates.delete(deleteTarget.id)
      setDeleteTarget(null)
      toast.success('Default admin deleted')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<TourAdminMasterTemplate>[] = [
    {
      key: 'label',
      header: 'Label',
      sortable: true,
      sortValue: (t) => t.label,
      render: (t) => <span className="font-semibold text-foreground">{t.label}</span>,
    },
    {
      key: 'username_pattern',
      header: 'Username pattern',
      sortable: true,
      sortValue: (t) => t.username_pattern,
      render: (t) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.username_pattern}</code>
      ),
    },
    {
      key: 'password_mode',
      header: 'Password',
      render: (t) => (
        <span className="text-sm capitalize text-muted-foreground">
          {t.password_mode}
          {t.password_mode === 'fixed' && t.has_fixed_password ? ' · set' : ''}
        </span>
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      render: (t) => (
        <span className="text-sm text-muted-foreground">
          {t.mobile ? `${t.country_code} ${t.mobile}` : '—'}
        </span>
      ),
    },
    {
      key: 'login',
      header: 'Login',
      render: (t) => (
        <div className="flex flex-wrap gap-1">
          {t.password_enabled && <Badge variant="secondary">Password</Badge>}
          {t.otp_enabled && <Badge variant="secondary">OTP</Badge>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (t) => (t.is_active ? 1 : 0),
      render: (t) => (
        <Badge variant={t.is_active ? 'success' : 'secondary'}>
          {t.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (t) => (
        <RowActions
          onView={() => openView(t)}
          onEdit={canEdit ? () => openEdit(t) : undefined}
          onDelete={canEdit ? () => setDeleteTarget(t) : undefined}
        />
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const readOnly = modalMode === 'view'

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <SettingsPanel
        title="Tour Master Admin"
        description={`Default admins for new tours. Use ${'{tour_id}'} in username patterns. ${templates.length} template${templates.length === 1 ? '' : 's'}.`}
        enabled={autoCreate}
        onEnabledChange={setAutoCreate}
        enableLabel="Auto-create on new tour"
        enableDisabled={!canEdit}
        footer={
          <>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={openCreate}>
                <Plus className="size-4" />
                Add default admin
              </Button>
            ) : (
              <span />
            )}
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                disabled={savingAuto || autoCreate === master?.auto_create_on_tour_create}
                onClick={() => void saveAutoCreate()}
              >
                {savingAuto ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save
              </Button>
            ) : (
              <span />
            )}
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Toggle enables auto-create when a tour is created. Active rows below are applied
          automatically.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={columns}
            data={templates}
            keyExtractor={(t) => t.id}
            loading={false}
            emptyState={
              <EmptyState
                icon={Users}
                title="No default admins yet"
                description="Add at least one template so new tours can get login credentials."
              />
            }
          />
        </div>
      </SettingsPanel>

      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {modalMode === 'create'
                  ? 'Add default admin'
                  : modalMode === 'view'
                    ? `View: ${editTarget?.label}`
                    : `Edit: ${editTarget?.label}`}
              </DialogTitle>
            </DialogHeader>

            {formError && (
              <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Label" required className="sm:col-span-2">
                <Input
                  value={form.label}
                  onChange={(e) => setField('label', e.target.value)}
                  required
                  disabled={readOnly}
                  autoFocus={!readOnly}
                  placeholder="e.g. Site engineer"
                />
              </FormField>
              <FormField
                label="Username pattern"
                required
                hint="Use {tour_id} for the public tour id."
                className="sm:col-span-2"
              >
                <Input
                  value={form.username_pattern}
                  onChange={(e) => setField('username_pattern', e.target.value)}
                  required
                  disabled={readOnly}
                />
              </FormField>
              <FormField label="Password mode">
                <Select
                  value={form.password_mode}
                  disabled={readOnly}
                  onValueChange={(v) => setField('password_mode', v as 'random' | 'fixed')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random per tour</SelectItem>
                    <SelectItem value="fixed">Fixed password</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Sort order">
                <Input
                  type="number"
                  min={0}
                  value={form.sort_order}
                  onChange={(e) => setField('sort_order', e.target.value)}
                  disabled={readOnly}
                />
              </FormField>
              {form.password_mode === 'fixed' && !readOnly && (
                <FormField
                  label="Fixed password"
                  hint={
                    editTarget?.has_fixed_password
                      ? 'Leave blank to keep the current password.'
                      : 'Required for fixed mode.'
                  }
                  className="sm:col-span-2"
                >
                  <PasswordInput
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                    required={modalMode === 'create' || !editTarget?.has_fixed_password}
                  />
                </FormField>
              )}
              <FormField label="Country code">
                <Input
                  value={form.country_code}
                  onChange={(e) => setField('country_code', e.target.value)}
                  disabled={readOnly}
                />
              </FormField>
              <FormField label="Mobile (optional)">
                <Input
                  value={form.mobile}
                  onChange={(e) => setField('mobile', e.target.value)}
                  disabled={readOnly}
                />
              </FormField>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="tmpl_pw"
                  checked={form.password_enabled}
                  disabled={readOnly}
                  onCheckedChange={(v) => setField('password_enabled', v === true)}
                />
                <Label htmlFor="tmpl_pw">Password login</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="tmpl_otp"
                  checked={form.otp_enabled}
                  disabled={readOnly}
                  onCheckedChange={(v) => setField('otp_enabled', v === true)}
                />
                <Label htmlFor="tmpl_otp">OTP login</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="tmpl_active"
                  checked={form.is_active}
                  disabled={readOnly}
                  onCheckedChange={(v) => setField('is_active', v === true)}
                />
                <Label htmlFor="tmpl_active">Active (applied on new tours)</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {!readOnly && (
                <Button type="submit" size="sm" disabled={saving || !canEdit}>
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  {saving ? 'Saving…' : modalMode === 'create' ? 'Add admin' : 'Update'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete default admin"
        description={
          <>
            Delete template <strong>{deleteTarget?.label}</strong>? Existing tour admins are not
            removed — only future auto-create uses this list.
          </>
        }
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
      />
    </div>
  )
}
