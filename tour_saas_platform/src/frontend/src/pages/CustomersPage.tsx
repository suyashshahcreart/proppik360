import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, Users, X, Check } from 'lucide-react'
import { api } from '../services/api'
import type { Customer, CustomerInput, CustomerWithLinks } from '../types'
import { FileDropzone } from '@/components/media/FileDropzone'
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
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

// ─── Country codes for the mobile dropdown ───────────────────────────────────

const COUNTRY_CODES: Array<{ code: string; label: string }> = [
  { code: '+91', label: '(+91) India' },
  { code: '+1', label: '(+1) United States' },
  { code: '+44', label: '(+44) United Kingdom' },
  { code: '+971', label: '(+971) UAE' },
  { code: '+65', label: '(+65) Singapore' },
  { code: '+61', label: '(+61) Australia' },
  { code: '+81', label: '(+81) Japan' },
  { code: '+49', label: '(+49) Germany' },
  { code: '+33', label: '(+33) France' },
  { code: '+86', label: '(+86) China' },
]

interface SocialLinkDraft {
  platform_name: string
  url: string
  icon_class: string
}

interface FormState {
  first_name: string
  last_name: string
  email: string
  country_code: string
  mobile: string
  company_name: string
  slug: string
  company_website: string
  tag_line: string
  designation: string
  social_links: SocialLinkDraft[]
}

const EMPTY_FORM: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  country_code: '+91',
  mobile: '',
  company_name: '',
  slug: '',
  company_website: '',
  tag_line: '',
  designation: '',
  social_links: [
    { platform_name: '', url: '', icon_class: '' },
    { platform_name: '', url: '', icon_class: '' },
    { platform_name: '', url: '', icon_class: '' },
  ],
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function customerToForm(c: CustomerWithLinks): FormState {
  const links =
    c.social_links.length > 0
      ? c.social_links.map((l) => ({
          platform_name: l.platform_name,
          url: l.url,
          icon_class: l.icon_class,
        }))
      : [{ platform_name: '', url: '', icon_class: '' }]

  return {
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    country_code: c.country_code || '+91',
    mobile: c.mobile,
    company_name: c.company_name ?? '',
    slug: c.slug ?? '',
    company_website: c.company_website ?? '',
    tag_line: c.tag_line ?? '',
    designation: c.designation ?? '',
    social_links: links,
  }
}

function formToPayload(form: FormState): CustomerInput {
  return {
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim(),
    country_code: form.country_code,
    mobile: form.mobile.trim(),
    company_name: form.company_name.trim() || null,
    slug: form.slug.trim() || null,
    company_website: form.company_website.trim() || null,
    tag_line: form.tag_line.trim() || null,
    designation: form.designation.trim() || null,
    social_links: form.social_links.map((l) => ({
      platform_name: l.platform_name.trim(),
      url: l.url.trim(),
      icon_class: l.icon_class.trim(),
    })),
  }
}

// ─── Customer form dialog ────────────────────────────────────────────────────

function CustomerFormDialog({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  initial: CustomerWithLinks | null
  onClose: () => void
  onSaved: (customer: CustomerWithLinks) => void
}) {
  const [form, setForm] = useState<FormState>(initial ? customerToForm(initial) : EMPTY_FORM)
  const [profileFile, setProfileFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [seoFile, setSeoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateLink(index: number, key: keyof SocialLinkDraft, value: string) {
    setForm((prev) => {
      const social_links = prev.social_links.map((row, i) => (i === index ? { ...row, [key]: value } : row))
      return { ...prev, social_links }
    })
  }

  function addLink() {
    setForm((prev) => ({
      ...prev,
      social_links: [...prev.social_links, { platform_name: '', url: '', icon_class: '' }],
    }))
  }

  function removeLink(index: number) {
    setForm((prev) => {
      const next = prev.social_links.filter((_, i) => i !== index)
      return { ...prev, social_links: next.length > 0 ? next : [{ platform_name: '', url: '', icon_class: '' }] }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim() || !form.mobile.trim()) {
      setError('First name, last name, email, and mobile are required')
      return
    }

    setSaving(true)
    try {
      const payload = formToPayload(form)
      let saved: CustomerWithLinks

      if (mode === 'create') {
        saved = await api.customers.create(payload)
      } else {
        saved = await api.customers.update(initial!.id, payload)
      }

      if (profileFile || coverFile) {
        saved = await api.customers.uploadPhotos(saved.id, { profile: profileFile, cover: coverFile })
      }

      if (seoFile) {
        await api.customers.uploadMedia(saved.id, 'customer_seo', seoFile)
      }

      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>
              {mode === 'create' ? 'Provide basic customer information.' : 'Update account information'}
            </DialogDescription>
          </DialogHeader>

          {error && <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="First Name" required>
              <Input
                placeholder="e.g. Sanjay"
                value={form.first_name}
                onChange={(e) => setField('first_name', e.target.value)}
                required
              />
            </FormField>
            <FormField label="Last Name" required>
              <Input
                placeholder="e.g. Singh"
                value={form.last_name}
                onChange={(e) => setField('last_name', e.target.value)}
                required
              />
            </FormField>
            <FormField label="Email" required>
              <Input
                type="email"
                placeholder="e.g. example@email.com"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                required
              />
            </FormField>

            <FormField label="Mobile" required>
              <div className="flex gap-2">
                <Select value={form.country_code} onValueChange={(v) => setField('country_code', v)}>
                  <SelectTrigger className="w-28 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="e.g. 9876543120"
                  value={form.mobile}
                  onChange={(e) => setField('mobile', e.target.value)}
                  required
                />
              </div>
            </FormField>
            <FormField label="Company Name">
              <Input
                placeholder="e.g. Prop Pik Global"
                value={form.company_name}
                onChange={(e) => setField('company_name', e.target.value)}
              />
            </FormField>
            <FormField label="Slug">
              <Input
                placeholder="unique-identifier"
                value={form.slug}
                onChange={(e) => setField('slug', e.target.value)}
              />
            </FormField>

            <FormField label="Company Website">
              <Input
                placeholder="e.g. https://www.proppik.com"
                value={form.company_website}
                onChange={(e) => setField('company_website', e.target.value)}
              />
            </FormField>
            <FormField label="Tag Line">
              <Input
                placeholder="e.g. We build tours, not just trips"
                value={form.tag_line}
                onChange={(e) => setField('tag_line', e.target.value)}
              />
            </FormField>
            <FormField label="Designation">
              <Input
                placeholder="e.g. Agent, Broker"
                value={form.designation}
                onChange={(e) => setField('designation', e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Profile Photo">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setProfileFile(e.target.files?.[0] ?? null)}
              />
              {initial?.profile_photo_url && !profileFile && (
                <a href={initial.profile_photo_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Current profile photo
                </a>
              )}
            </FormField>
            <FormField label="Cover Photo">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCoverFile(e.target.files?.[0] ?? null)}
              />
              {initial?.cover_photo_url && !coverFile && (
                <a href={initial.cover_photo_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Current cover photo
                </a>
              )}
            </FormField>

            <FormField label="SEO Image">
              {mode === 'edit' && initial ? (
                <FileDropzone
                  collection="customer_seo"
                  entityType="customer"
                  entityId={initial.id}
                  accept="image/*"
                  maxBytes={2 * 1024 * 1024}
                  disabled={saving}
                  compact
                />
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSeoFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">Max 2 MB — uploaded after saving</p>
                </>
              )}
            </FormField>
          </div>

          <Separator />

          <div>
            <h4 className="mb-3 text-sm font-semibold text-foreground">Social Links</h4>
            <div className="flex flex-col gap-2">
              {form.social_links.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder="e.g. facebook"
                    className="max-w-32"
                    value={link.platform_name}
                    onChange={(e) => updateLink(index, 'platform_name', e.target.value)}
                  />
                  <Input
                    placeholder="e.g. https://..."
                    value={link.url}
                    onChange={(e) => updateLink(index, 'url', e.target.value)}
                  />
                  <Input
                    placeholder="e.g. fa-solid fa-home"
                    className="max-w-40"
                    value={link.icon_class}
                    onChange={(e) => updateLink(index, 'icon_class', e.target.value)}
                  />
                  <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" title="Remove link" onClick={() => removeLink(index)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addLink}>
              Add link
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {saving ? (mode === 'create' ? 'Saving…' : 'Updating…') : mode === 'create' ? 'Save Customer' : 'Update Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<CustomerWithLinks | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const filterCustomers = useCallback((c: Customer, query: string) => {
    const haystack = [
      c.first_name,
      c.last_name,
      c.email,
      c.mobile,
      c.company_name,
      c.slug,
      c.designation,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  }, [])

  const list = useListControls({
    items: customers,
    filterFn: filterCustomers,
    defaultPageSize: 10,
  })

  function loadList() {
    setLoading(true)
    return api.customers
      .list()
      .then(setCustomers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadList()
  }, [])

  function openCreate() {
    setEditing(null)
    setModalMode('create')
  }

  async function openEdit(customer: Customer) {
    setLoadingEdit(true)
    setError(null)
    try {
      const full = await api.customers.get(customer.id)
      setEditing(full)
      setModalMode('edit')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer')
    } finally {
      setLoadingEdit(false)
    }
  }

  function closeModal() {
    setModalMode(null)
    setEditing(null)
  }

  function handleSaved(saved: CustomerWithLinks) {
    closeModal()
    setCustomers((prev) => {
      const idx = prev.findIndex((c) => c.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [saved, ...prev]
    })
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.customers.delete(confirmDelete.id)
      setCustomers((prev) => prev.filter((c) => c.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<Customer>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (c) => `${c.first_name} ${c.last_name}`,
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <Avatar>
            {c.profile_photo_url && <AvatarImage src={c.profile_photo_url} alt="" />}
            <AvatarFallback>{c.first_name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <Link
              to={`/customers/${c.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {c.first_name} {c.last_name}
            </Link>
            {c.designation && <div className="text-xs text-muted-foreground">{c.designation}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      sortValue: (c) => c.email,
      render: (c) => <span className="text-sm text-muted-foreground">{c.email}</span>,
    },
    {
      key: 'mobile',
      header: 'Mobile',
      sortable: true,
      sortValue: (c) => `${c.country_code} ${c.mobile}`,
      render: (c) => (
        <span className="text-sm text-muted-foreground">
          {c.country_code} {c.mobile}
        </span>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      sortable: true,
      sortValue: (c) => c.company_name ?? '',
      render: (c) => <span className="text-sm text-muted-foreground">{c.company_name || '—'}</span>,
    },
    {
      key: 'slug',
      header: 'Slug',
      sortable: true,
      sortValue: (c) => c.slug ?? '',
      render: (c) => <span className="font-mono text-xs text-muted-foreground">{c.slug || '—'}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      sortable: true,
      sortValue: (c) => new Date(c.created_at).getTime(),
      render: (c) => <span className="text-sm text-muted-foreground">{formatDate(c.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerClassName: 'text-right',
      className: 'text-right',
      render: (c) => (
        <RowActions
          viewTo={`/customers/${c.id}`}
          onEdit={() => openEdit(c)}
          onDelete={() => {
            setDeleteError(null)
            setConfirmDelete(c)
          }}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      <PageHeader
        title="Customers Management"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Customers' },
        ]}
        showBack
        backTo="/"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New Customer
          </Button>
        }
      />

      {error && <div className="rounded-md bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}
      {loadingEdit && (
        <div className="rounded-md bg-info-subtle px-4 py-3 text-sm text-info">Loading customer…</div>
      )}

      <ListBox
        title="Customers List"
        subtitle="Manage customers in the system"
        onRefresh={loadList}
        refreshing={loading}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search customers…"
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
          keyExtractor={(c) => c.id}
          loading={loading}
          emptyState={
            <EmptyState
              icon={Users}
              title={list.search ? 'No matching customers' : 'No customers yet'}
              description={
                list.search
                  ? 'Try a different search term.'
                  : 'Create your first customer to get started.'
              }
              action={
                !list.search ? (
                  <Button size="sm" onClick={openCreate}>
                    Create Customer
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </ListBox>

      {modalMode && (
        <CustomerFormDialog mode={modalMode} initial={editing} onClose={closeModal} onSaved={handleSaved} />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete Customer"
        description={
          <>
            Are you sure you want to delete{' '}
            <strong>
              "{confirmDelete?.first_name} {confirmDelete?.last_name}"
            </strong>
            ? Profile and cover photos will be removed from storage.
          </>
        }
        loading={deleting}
        confirmLabel={deleting ? 'Deleting…' : 'Yes, Delete'}
        onConfirm={handleDelete}
      >
        {deleteError && (
          <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{deleteError}</div>
        )}
      </ConfirmDialog>
    </div>
  )
}
