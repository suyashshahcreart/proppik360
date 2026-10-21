import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/services/api'
import type { TourAdmin, User } from '@/types'
import { cn } from '@/lib/utils'
import { can } from '@/components/shared/PermissionGate'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { RowActions } from '@/components/shared/RowActions'
import { EmptyState } from '@/components/shared/EmptyState'
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

interface TourAdminSectionProps {
  tourId: string
  user: User
}

type ModalMode = 'create' | 'edit' | null

const emptyForm = (tourId: string) => ({
  username: `admin-${tourId}`,
  password: '',
  country_code: '+91',
  mobile: '',
  password_enabled: true,
  otp_enabled: true,
  is_active: true,
})

export function TourAdminSection({ tourId, user }: TourAdminSectionProps) {
  const canView = can(user, 'tour_admin_view')
  const canEdit = can(user, 'tour_admin_edit')

  const [admins, setAdmins] = useState<TourAdmin[]>([])
  const [apiBase, setApiBase] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editTarget, setEditTarget] = useState<TourAdmin | null>(null)
  const [form, setForm] = useState(() => emptyForm(tourId))
  const [deleteTarget, setDeleteTarget] = useState<TourAdmin | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const invalidClass =
    'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'

  function clearFormErrors() {
    setFormError(null)
    setFieldErrors({})
  }

  function resolveFieldFromMessage(message: string, apiField?: string): string | undefined {
    if (apiField) return apiField
    if (/username/i.test(message)) return 'username'
    if (/password/i.test(message)) return 'password'
    if (/mobile/i.test(message)) return 'mobile'
    if (/country/i.test(message)) return 'country_code'
    if (/otp|password login/i.test(message)) return 'password_enabled'
    return undefined
  }

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const [payload, settings] = await Promise.all([
        api.tours.tourAdmin.get(tourId),
        api.system.settings.get().catch(() => ({}) as Record<string, string | null>),
      ])
      setAdmins(payload.admins ?? (payload.admin ? [payload.admin] : []))
      setApiBase((settings.tour_admin_api_base_url ?? '').replace(/\/$/, ''))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [tourId, canView])

  useEffect(() => {
    void load()
  }, [load])

  if (!canView) return null

  const publicApiUrl = apiBase ? `${apiBase}/${tourId}` : `/api/tour-admin/${tourId}`

  const openCreate = () => {
    setEditTarget(null)
    setForm(emptyForm(tourId))
    setGeneratedPassword(null)
    clearFormErrors()
    setModalMode('create')
  }

  const openEdit = (row: TourAdmin) => {
    clearFormErrors()
    setEditTarget(row)
    setForm({
      username: row.username,
      password: '',
      country_code: row.country_code || '+91',
      mobile: row.mobile ?? '',
      password_enabled: row.password_enabled,
      otp_enabled: row.otp_enabled,
      is_active: row.is_active,
    })
    setGeneratedPassword(null)
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditTarget(null)
    setForm(emptyForm(tourId))
    clearFormErrors()
  }

  const patchForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
    if (formError) setFormError(null)
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    setSaving(true)
    setGeneratedPassword(null)
    clearFormErrors()
    try {
      await api.tours.tourAdmin.put(tourId, {
        id: editTarget?.id,
        username: form.username.trim(),
        password: form.password.trim() || null,
        country_code: form.country_code,
        mobile: form.mobile.trim() || null,
        password_enabled: form.password_enabled,
        otp_enabled: form.otp_enabled,
        is_active: form.is_active,
      })
      toast.success(editTarget ? 'Tour admin updated' : 'Tour admin created', {
        id: 'tour-admin-save',
      })
      closeModal()
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save tour admin'
      const apiField = err instanceof ApiError ? err.field : undefined
      const fieldKey = resolveFieldFromMessage(message, apiField)
      if (fieldKey) {
        setFieldErrors({ [fieldKey]: message })
        setFormError('Please fix the highlighted field below.')
      } else {
        setFormError(message)
      }
      toast.error(message, { id: 'tour-admin-save' })
    } finally {
      setSaving(false)
    }
  }

  const onResetPassword = async (row: TourAdmin) => {
    if (!canEdit) return
    setResetting(true)
    try {
      const result = await api.tours.tourAdmin.resetPassword(tourId, null, row.id)
      if (result.generated_password) {
        setGeneratedPassword(result.generated_password)
        toast.success('New password generated — copy it now', { id: 'tour-admin-reset' })
      } else {
        toast.success('Password reset', { id: 'tour-admin-reset' })
      }
      await load()
    } catch (err) {
      toast.error((err as Error).message, { id: 'tour-admin-reset' })
    } finally {
      setResetting(false)
    }
  }

  const onDelete = async () => {
    if (!deleteTarget || !canEdit) return
    setDeleting(true)
    try {
      await api.tours.tourAdmin.delete(tourId, deleteTarget.id)
      setDeleteTarget(null)
      toast.success('Tour admin deleted')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label}`)
    }
  }

  const columns: DataTableColumn<TourAdmin>[] = [
    {
      key: 'username',
      header: 'Username',
      sortable: true,
      sortValue: (r) => r.username,
      render: (r) => <span className="font-semibold">{r.username}</span>,
    },
    {
      key: 'mobile',
      header: 'Mobile',
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.mobile ? `${r.country_code} ${r.mobile}` : '—'}
        </span>
      ),
    },
    {
      key: 'login',
      header: 'Login',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.password_enabled && <Badge variant="secondary">Password</Badge>}
          {r.otp_enabled && <Badge variant="secondary">OTP</Badge>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge variant={r.is_active ? 'success' : 'secondary'}>
          {r.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (r) => <span className="text-xs text-muted-foreground">{r.source}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              disabled={resetting}
              onClick={() => void onResetPassword(r)}
              title="Reset password"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          <RowActions
            onEdit={canEdit ? () => openEdit(r) : undefined}
            onDelete={canEdit ? () => setDeleteTarget(r) : undefined}
          />
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading tour admin…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4" />
            Tour admin logins
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Multiple admins can sign in for this tour (password or OTP).
          </p>
        </div>
        {canEdit && (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            Add admin
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <span className="text-muted-foreground">API base:</span>
        <code className="truncate font-mono text-[11px]">{publicApiUrl}</code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => void copyText('API URL', publicApiUrl)}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>

      {generatedPassword && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <div className="font-medium">Generated password (shown once)</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm">{generatedPassword}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void copyText('Password', generatedPassword)}
            >
              <Copy className="mr-1 size-3.5" />
              Copy
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          data={admins}
          keyExtractor={(r) => r.id}
          emptyState={
            <EmptyState
              icon={KeyRound}
              title="No tour admins yet"
              description="Add an admin manually, or enable auto-create templates under System → Settings."
            />
          }
        />
      </div>

      <Dialog open={!!modalMode} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={onSave} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {modalMode === 'create' ? 'Add tour admin' : `Edit: ${editTarget?.username}`}
              </DialogTitle>
            </DialogHeader>

            {formError && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {formError}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Username" required error={fieldErrors.username}>
                <Input
                  id="tour-admin-username"
                  aria-invalid={Boolean(fieldErrors.username)}
                  className={cn(fieldErrors.username && invalidClass)}
                  value={form.username}
                  onChange={(e) => patchForm('username', e.target.value)}
                  required
                />
              </FormField>
              <FormField
                label="Password"
                hint={editTarget?.has_password ? 'Leave blank to keep current.' : undefined}
                error={fieldErrors.password}
              >
                <PasswordInput
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  className={cn(fieldErrors.password && invalidClass)}
                  value={form.password}
                  onChange={(e) => patchForm('password', e.target.value)}
                />
              </FormField>
              <FormField label="Country code" error={fieldErrors.country_code}>
                <Input
                  aria-invalid={Boolean(fieldErrors.country_code)}
                  className={cn(fieldErrors.country_code && invalidClass)}
                  value={form.country_code}
                  onChange={(e) => patchForm('country_code', e.target.value)}
                />
              </FormField>
              <FormField label="Mobile (OTP)" error={fieldErrors.mobile}>
                <Input
                  aria-invalid={Boolean(fieldErrors.mobile)}
                  className={cn(fieldErrors.mobile && invalidClass)}
                  value={form.mobile}
                  onChange={(e) => patchForm('mobile', e.target.value)}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-4">
              {fieldErrors.password_enabled && (
                <p className="w-full text-xs text-destructive">{fieldErrors.password_enabled}</p>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ta_pw"
                  checked={form.password_enabled}
                  onCheckedChange={(v) => patchForm('password_enabled', v === true)}
                />
                <Label htmlFor="ta_pw">Password login</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ta_otp"
                  checked={form.otp_enabled}
                  onCheckedChange={(v) => patchForm('otp_enabled', v === true)}
                />
                <Label htmlFor="ta_otp">OTP login</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ta_active"
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v === true }))}
                />
                <Label htmlFor="ta_active">Active</Label>
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
        title="Delete tour admin"
        description={
          <>
            Delete admin <strong>{deleteTarget?.username}</strong> for this tour?
          </>
        }
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={onDelete}
      />
    </div>
  )
}
