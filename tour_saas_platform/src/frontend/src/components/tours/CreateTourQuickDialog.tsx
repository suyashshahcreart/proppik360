import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/services/api'
import type { CustomerWithLinks, Tour } from '@/types'
import { CustomerSearchSelect, type CustomerOption } from '@/components/shared/CustomerSearchSelect'
import { CreateCustomerQuickDialog } from '@/components/tours/CreateCustomerQuickDialog'
import { FormField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function randomSixDigitTourId(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 900_000) + 100_000
  return String(n)
}

function customerOption(customer: CustomerWithLinks): CustomerOption {
  return {
    id: customer.id,
    name: `${customer.first_name} ${customer.last_name}`.trim(),
    company_name: customer.company_name,
  }
}

export function CreateTourQuickDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (tour: Tour) => void
}) {
  const [name, setName] = useState('')
  const [tourId, setTourId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; customer_id?: string; slug?: string; form?: string }>({})

  useEffect(() => {
    if (!open) return
    setName('')
    setTourId(randomSixDigitTourId())
    setCustomerId('')
    setErrors({})
    setSaving(false)
    setCreateCustomerOpen(false)
    setLoadingCustomers(true)
    void api.tours
      .formOptions()
      .then((options) => setCustomers(options.customers))
      .catch(() => setErrors({ form: 'Could not load customers.' }))
      .finally(() => setLoadingCustomers(false))
  }, [open])

  function handleCustomerCreated(customer: CustomerWithLinks) {
    const option = customerOption(customer)
    setCustomers((current) => {
      const next = current.filter((item) => item.id !== option.id)
      next.push(option)
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    setCustomerId(option.id)
    setErrors((current) => ({ ...current, customer_id: undefined }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    const trimmed = name.trim()
    const slug = tourId.trim()
    if (!trimmed) nextErrors.name = 'Enter a tour name.'
    if (!customerId) nextErrors.customer_id = 'Choose a customer.'
    if (slug && !/^\d{6}$/.test(slug)) nextErrors.slug = 'Tour ID must be exactly 6 digits.'
    if (nextErrors.name || nextErrors.customer_id || nextErrors.slug) {
      setErrors(nextErrors)
      return
    }

    setSaving(true)
    setErrors({})
    try {
      const created = await api.tours.create(trimmed, {
        name: trimmed,
        customer_id: customerId,
        listing_status: 'pending',
        payment_status: 'unpaid',
        owner_type: 'owner',
        ...(slug ? { slug } : {}),
      })
      toast.success('Tour created')
      onCreated(created)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create tour'
      const field = err instanceof ApiError ? err.field : undefined
      if (field === 'name' || field === 'customer_id' || field === 'slug') {
        setErrors({ [field]: message })
      } else {
        setErrors({ form: message })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !saving && !createCustomerOpen && onOpenChange(next)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New tour</DialogTitle>
              <DialogDescription>
                Name and customer are required. Tour ID can be typed or regenerated. The new tour is selected after save.
              </DialogDescription>
            </DialogHeader>

            {errors.form && (
              <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{errors.form}</p>
            )}

            <FormField label="Tour name" htmlFor="quick-tour-name" required error={errors.name}>
              <Input
                id="quick-tour-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Avadhgreens VR Tour"
                autoFocus
                disabled={saving}
              />
            </FormField>

            <FormField
              label="Tour ID"
              htmlFor="quick-tour-id"
              error={errors.slug}
              hint={errors.slug ? undefined : '6-digit number — R2 folder and public URL. Leave as generated or type your own.'}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="quick-tour-id"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={tourId}
                  disabled={saving}
                  className="min-w-0 flex-1 font-mono"
                  onChange={(event) => setTourId(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="e.g. 482901"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0 px-2.5"
                  disabled={saving}
                  onClick={() => {
                    const next = randomSixDigitTourId()
                    setTourId(next)
                    setErrors((current) => ({ ...current, slug: undefined }))
                    toast.success(`New tour ID: ${next}`)
                  }}
                >
                  Regenerate
                </Button>
              </div>
            </FormField>

            <FormField label="Customer" required error={errors.customer_id}>
              {loadingCustomers ? (
                <div className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading customers…
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <CustomerSearchSelect
                      value={customerId}
                      onValueChange={setCustomerId}
                      customers={customers}
                      disabled={saving}
                      placeholder="Choose a customer…"
                      triggerClassName="h-9 min-h-9 max-h-9"
                    />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9 shrink-0"
                        disabled={saving}
                        onClick={() => setCreateCustomerOpen(true)}
                        aria-label="New customer"
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">New customer</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || loadingCustomers}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Create tour
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CreateCustomerQuickDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        onCreated={handleCustomerCreated}
      />
    </>
  )
}
