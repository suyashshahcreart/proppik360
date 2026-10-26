import { useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import type { CustomerWithLinks } from '@/types'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const COUNTRY_CODES = ['+91', '+1', '+44', '+971', '+65', '+61', '+81', '+49', '+33', '+86']

export function CreateCustomerQuickDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: CustomerWithLinks) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [mobile, setMobile] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFirstName('')
    setLastName('')
    setEmail('')
    setCountryCode('+91')
    setMobile('')
    setCompanyName('')
    setSaving(false)
    setError(null)
  }, [open])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !mobile.trim()) {
      setError('First name, last name, email, and mobile are required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await api.customers.create({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        country_code: countryCode,
        mobile: mobile.trim(),
        company_name: companyName.trim() || null,
      })
      toast.success('Customer created')
      onCreated(created)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Required fields only. The new customer is selected on the tour form after you save.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="First name" htmlFor="quick-customer-first" required>
              <Input
                id="quick-customer-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="e.g. Sanjay"
                autoFocus
                disabled={saving}
              />
            </FormField>
            <FormField label="Last name" htmlFor="quick-customer-last" required>
              <Input
                id="quick-customer-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="e.g. Singh"
                disabled={saving}
              />
            </FormField>
            <FormField label="Email" htmlFor="quick-customer-email" required>
              <Input
                id="quick-customer-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="e.g. example@email.com"
                disabled={saving}
              />
            </FormField>
            <FormField label="Mobile" required>
              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode} disabled={saving}>
                  <SelectTrigger className="w-24 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="9876543210"
                  disabled={saving}
                />
              </div>
            </FormField>
            <FormField label="Company name" htmlFor="quick-customer-company" className="sm:col-span-2">
              <Input
                id="quick-customer-company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="e.g. Prop Pik Global"
                disabled={saving}
              />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
