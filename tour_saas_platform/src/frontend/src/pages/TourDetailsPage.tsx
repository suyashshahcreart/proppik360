import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  Coffee,
  Copy,
  Home,
  Lamp,
  Loader2,
  MapPin,
  Sofa,
  User,
  Warehouse,
} from 'lucide-react'
import { api, ApiError } from '../services/api'
import type {
  FurnishType,
  ListingStatus,
  OwnerType,
  PaymentStatus,
  PropertyCategoryTreeNode,
  SizeBhk,
  Tour,
  TourDetailsInput,
  TourStatus,
} from '../types'
import { PageHeader } from '@/components/shared/PageHeader'
import { ListBox } from '@/components/shared/ListBox'
import { FormField } from '@/components/shared/FormField'
import { CustomerSearchSelect } from '@/components/shared/CustomerSearchSelect'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { CategoryIcon } from '@/components/icons/CategoryIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SelectWithOther } from '@/components/shared/SelectWithOther'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { COUNTRIES, citiesForState, statesForCountry } from '@/lib/world-locations'

const compactField = 'gap-1 [&>label]:flex [&>label]:h-4 [&>label]:items-end [&>label]:text-xs [&>label]:font-medium [&>label]:leading-4'
const compactInput = 'h-8 min-h-8 py-0 text-sm'
const compactSelect = 'h-8 min-h-8 max-h-8 py-0 text-sm'

/** Six-digit public tour id (R2 folder / URL). */
function randomSixDigitTourId(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 900_000) + 100_000
  return String(n)
}

const QR_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 8-character alphanumeric QR code (separate from tour id). */
function randomQrCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const byte of bytes) code += QR_ALPHABET[byte % QR_ALPHABET.length]
  return code
}

function categoryKey(name: string, slug: string | null | undefined): string {
  return (slug || name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isOtherCategory(node: { name: string; slug: string | null } | null): boolean {
  if (!node) return false
  const key = categoryKey(node.name, node.slug)
  return key === 'other' || key === 'others'
}

function isResidential(node: { name: string; slug: string | null } | null): boolean {
  if (!node) return false
  return categoryKey(node.name, node.slug).includes('residential')
}

function showsFurnish(node: { name: string; slug: string | null } | null): boolean {
  if (!node) return false
  const key = categoryKey(node.name, node.slug)
  return key.includes('commercial') || key.includes('residential')
}

const LISTING_STATUS: { value: ListingStatus; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending', label: 'Pending' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'on_hold', label: 'On hold' },
]

const PAYMENT_STATUS: { value: PaymentStatus; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'free', label: 'Free' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partial', label: 'Half / partial' },
]

const OWNER_OPTIONS: { value: OwnerType; label: string; icon: ReactNode }[] = [
  { value: 'owner', label: 'Owner', icon: <User className="size-3.5" /> },
  { value: 'broker', label: 'Broker', icon: <Briefcase className="size-3.5" /> },
  { value: 'other', label: 'Other', icon: <Coffee className="size-3.5" /> },
]

const FURNISH_OPTIONS: { value: FurnishType; label: string; icon: ReactNode }[] = [
  { value: 'fully_furnished', label: 'Fully furnished', icon: <Sofa className="size-3.5" /> },
  { value: 'semi_furnished', label: 'Semi furnished', icon: <Lamp className="size-3.5" /> },
  { value: 'unfurnished', label: 'Unfurnished', icon: <Warehouse className="size-3.5" /> },
]

const SIZE_OPTIONS: { value: SizeBhk; label: string }[] = [
  { value: '1_bhk', label: '1 BHK' },
  { value: '1_rk', label: '1 RK' },
  { value: '1_5_bhk', label: '1.5 BHK' },
  { value: '2_bhk', label: '2 BHK' },
  { value: '2_5_bhk', label: '2.5 BHK' },
  { value: '3_bhk', label: '3 BHK' },
  { value: '3_5_bhk', label: '3.5 BHK' },
  { value: '4_bhk', label: '4 BHK' },
  { value: '4_5_bhk', label: '4.5 BHK' },
  { value: '5_bhk', label: '5 BHK' },
  { value: '5_plus_bhk', label: '5+ BHK' },
]

interface FormState {
  name: string
  slug: string
  customer_id: string
  listing_status: ListingStatus
  payment_status: PaymentStatus
  owner_type: OwnerType
  owner_type_details: string
  property_category_id: string
  property_sub_category_id: string
  furnish_type: FurnishType | ''
  size_bhk: SizeBhk | ''
  other_option_details: string
  super_built_up_area: string
  price: string
  use_company_billing: boolean
  billing_company_name: string
  gst_no: string
  house_no: string
  building_name: string
  society_name: string
  area_locality: string
  landmark: string
  pin_code: string
  country: string
  state: string
  city: string
  full_address: string
}

const emptyForm = (): FormState => ({
  name: '',
  slug: '',
  customer_id: '',
  listing_status: 'pending',
  payment_status: 'unpaid',
  owner_type: 'owner',
  owner_type_details: '',
  property_category_id: '',
  property_sub_category_id: '',
  furnish_type: '',
  size_bhk: '',
  other_option_details: '',
  super_built_up_area: '',
  price: '',
  use_company_billing: false,
  billing_company_name: '',
  gst_no: '',
  house_no: '',
  building_name: '',
  society_name: '',
  area_locality: '',
  landmark: '',
  pin_code: '',
  country: 'India',
  state: 'Gujarat',
  city: 'Ahmedabad',
  full_address: 'Ahmedabad, Gujarat\nIndia',
})

type AddressParts = Pick<
  FormState,
  | 'house_no'
  | 'building_name'
  | 'society_name'
  | 'area_locality'
  | 'landmark'
  | 'pin_code'
  | 'country'
  | 'state'
  | 'city'
>

function buildFullAddress(parts: AddressParts): string {
  const lines: string[] = []

  const houseBuilding = [parts.house_no, parts.building_name]
    .map((value) => value.trim())
    .filter(Boolean)
  if (houseBuilding.length > 0) lines.push(houseBuilding.join(', '))

  const society = parts.society_name.trim()
  if (society) lines.push(society)

  const area = parts.area_locality.trim()
  if (area) lines.push(area)

  const landmark = parts.landmark.trim()
  if (landmark) lines.push(`Near ${landmark}`)

  const cityState = [parts.city, parts.state]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(', ')
  const pin = parts.pin_code.trim()
  let location = cityState
  if (pin) location = location ? `${location} - ${pin}` : pin
  if (location) lines.push(location)

  const country = parts.country.trim()
  if (country) lines.push(country)

  return lines.join('\n')
}

function formFromTour(tour: Tour): FormState {
  const base: FormState = {
    ...emptyForm(),
    name: tour.name,
    slug: tour.tour_id ?? String(tour.id),
    customer_id: tour.customer_id ?? '',
    listing_status: (tour.listing_status as ListingStatus) ?? 'pending',
    payment_status: (tour.payment_status as PaymentStatus) ?? 'unpaid',
    owner_type: (tour.owner_type as OwnerType) ?? 'owner',
    owner_type_details: tour.owner_type_details ?? '',
    property_category_id: tour.property_category_id ?? '',
    property_sub_category_id: tour.property_sub_category_id ?? '',
    furnish_type: (tour.furnish_type as FurnishType | null) ?? '',
    size_bhk: (tour.size_bhk as SizeBhk | null) ?? '',
    other_option_details: tour.other_option_details ?? '',
    super_built_up_area: tour.super_built_up_area != null ? String(tour.super_built_up_area) : '',
    price: tour.price != null ? String(tour.price) : '',
    use_company_billing: Boolean(tour.use_company_billing),
    billing_company_name: tour.billing_company_name ?? '',
    gst_no: tour.gst_no ?? '',
    house_no: tour.house_no ?? '',
    building_name: tour.building_name ?? '',
    society_name: tour.society_name ?? '',
    area_locality: tour.area_locality ?? '',
    landmark: tour.landmark ?? '',
    pin_code: tour.pin_code ?? '',
    country: tour.country || 'India',
    state: tour.state ?? '',
    city: tour.city ?? '',
    full_address: tour.full_address ?? '',
  }
  return {
    ...base,
    full_address: base.full_address || buildFullAddress(base),
  }
}

const choicePillClass =
  'inline-flex h-8 cursor-pointer select-none items-center gap-1 rounded-md border px-2.5 text-sm font-medium shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1'

function ChoicePills<T extends string>({
  options,
  value,
  onChange,
  scrollable,
}: {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: string
  onChange: (value: T) => void
  scrollable?: boolean
}) {
  return (
    <div
      className={cn(
        'flex gap-1.5',
        scrollable ? 'flex-nowrap overflow-x-auto pb-0.5' : 'flex-wrap',
      )}
      role="group"
    >
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              choicePillClass,
              selected
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-input bg-card text-foreground hover:border-primary/40 hover:bg-secondary/80',
            )}
          >
            {selected ? (
              <Check className="size-3 shrink-0" />
            ) : option.icon ? (
              <span className="[&>svg]:size-3.5 [&>svg]:shrink-0">{option.icon}</span>
            ) : null}
            <span className="whitespace-nowrap leading-none">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function serializeForm(form: FormState, qr: string | null): string {
  return JSON.stringify({ form, qr: qr ?? '' })
}

function CollapsibleFormSection({
  icon,
  title,
  defaultOpen = true,
  storageKey,
  children,
}: {
  icon: ReactNode
  title: string
  defaultOpen?: boolean
  storageKey?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      const stored = sessionStorage.getItem(storageKey)
      if (stored === '0') return false
      if (stored === '1') return true
    }
    return defaultOpen
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (storageKey) sessionStorage.setItem(storageKey, next ? '1' : '0')
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div
        className={cn(
          'flex w-full items-center gap-2.5 bg-muted/40 px-3 py-2.5',
          open && 'border-b border-border',
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground [&>svg]:size-3.5">
          {icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted"
          >
            <ChevronDown
              className={cn('size-4 transition-transform duration-200', !open && '-rotate-90')}
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-2.5 p-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function TourDetailsPage() {
  const { tourId } = useParams<{ tourId?: string }>()
  const isEdit = Boolean(tourId)
  const navigate = useNavigate()
  const location = useLocation()
  const preselectedCustomerId =
    typeof (location.state as { customerId?: unknown } | null)?.customerId === 'string'
      ? (location.state as { customerId: string }).customerId
      : ''

  const [form, setForm] = useState<FormState>(() => {
    const initial = emptyForm()
    if (!tourId && preselectedCustomerId) {
      return { ...initial, customer_id: preselectedCustomerId }
    }
    return initial
  })
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [customers, setCustomers] = useState<
    Array<{ id: string; name: string; company_name: string | null }>
  >([])
  const [categories, setCategories] = useState<PropertyCategoryTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [baseline, setBaseline] = useState('')
  const [tourStatus, setTourStatus] = useState<TourStatus | null>(null)
  const [canEditIdentity, setCanEditIdentity] = useState(true)
  const [addressManual, setAddressManual] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [postCreateOpen, setPostCreateOpen] = useState(false)
  const [postCreateId, setPostCreateId] = useState<string | null>(null)
  const pendingNav = useRef<(() => void) | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const valuesRef = useRef(form)
  const qrRef = useRef(qrCode)
  const touchedRef = useRef(new Set<string>())
  const submittedRef = useRef(false)
  valuesRef.current = form
  qrRef.current = qrCode

  const isDirty = !loading && baseline.length > 0 && serializeForm(form, qrCode) !== baseline

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) return
    setError((banner) => (banner?.startsWith('Please fix the highlighted') ? null : banner))
  }, [fieldErrors])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAddressManual(false)

    void (async () => {
      try {
        const options = await api.tours.formOptions()
        if (cancelled) return
        setCustomers(options.customers)
        setCategories(options.categories)
        if (tourId) {
          const tour = await api.tours.get(tourId)
          if (cancelled) return
          const loaded = formFromTour(tour)
          setForm(loaded)
          setBaseline(serializeForm(loaded, tour.qr_code ?? null))
          setQrCode(tour.qr_code ?? null)
          setTourStatus(tour.status)
          setCanEditIdentity(tour.canEditIdentity ?? false)
        } else {
          const initial = emptyForm()
          if (preselectedCustomerId) initial.customer_id = preselectedCustomerId
          const draftTourId = randomSixDigitTourId()
          const draftQr = randomQrCode()
          setForm({ ...initial, slug: draftTourId })
          setBaseline(serializeForm({ ...initial, slug: draftTourId }, draftQr))
          setQrCode(draftQr)
          qrRef.current = draftQr
          setTourStatus(null)
          setCanEditIdentity(true)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tour')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tourId, preselectedCustomerId])

  const guardNavigation = useCallback(
    (action: () => void) => {
      if (!isDirty) {
        action()
        return
      }
      pendingNav.current = action
      setDiscardOpen(true)
    },
    [isDirty],
  )

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectedType = useMemo(
    () => categories.find((node) => node.id === form.property_category_id) ?? null,
    [categories, form.property_category_id],
  )
  const subtypes = selectedType?.children.filter((child) => child.status === 'active') ?? []
  const selectedSub = subtypes.find((node) => node.id === form.property_sub_category_id) ?? null
  const furnishVisible = showsFurnish(selectedType)
  const residential = isResidential(selectedType)
  const otherVisible =
    isOtherCategory(selectedType) && selectedSub != null && isOtherCategory(selectedSub)
  const stateOptions = statesForCountry(form.country).map((state) => ({ value: state, label: state }))
  const cityOptions = citiesForState(form.country, form.state).map((city) => ({ value: city, label: city }))

  function messageFor(key: string, draft: FormState, draftQr: string | null): string | null {
    if (key === 'name') {
      if (!draft.name.trim()) return 'Enter a tour name. This is the title people see in the list.'
      if (draft.name.trim().length > 255) return 'Tour name is too long. Use 255 characters or fewer.'
      return null
    }
    if (key === 'customer_id') {
      if (!draft.customer_id) return 'Choose a customer. Every tour must belong to one customer.'
      return null
    }
    if (key === 'slug') {
      if (!canEditIdentity) return null
      const code = draft.slug.trim()
      if (!code) return 'Enter a 6-digit tour ID or click Regenerate.'
      if (!/^\d{6}$/.test(code)) {
        return 'Tour ID must be exactly 6 digits (numbers only).'
      }
      return null
    }
    if (key === 'qr_code') {
      if (!canEditIdentity) return null
      const code = (draftQr ?? '').trim().toLowerCase()
      if (!code) return 'Enter a QR code or click Regenerate.'
      if (!/^[0-9a-z]{8}$/.test(code)) {
        return 'QR code must be 8 letters or digits (lowercase).'
      }
      return null
    }
    if (key === 'super_built_up_area') {
      const areaRaw = draft.super_built_up_area.trim()
      if (!areaRaw) return null
      const area = Number(areaRaw)
      if (!Number.isFinite(area) || area <= 0) {
        return 'Enter the area as a number greater than 0 (square feet).'
      }
      return null
    }
    if (key === 'price') {
      const priceRaw = draft.price.trim()
      if (!priceRaw) return null
      const price = Number(priceRaw)
      if (!Number.isFinite(price) || price < 0) {
        return 'Enter the price as a number (0 or more). Leave blank if you do not know it yet.'
      }
      return null
    }
    if (key === 'billing_company_name') {
      if (draft.use_company_billing && !draft.billing_company_name.trim()) {
        return 'Enter the company name shown on the bill, or turn off company billing.'
      }
      return null
    }
    if (key === 'gst_no') {
      if (draft.use_company_billing && !draft.gst_no.trim()) {
        return 'Enter the GST number for this company, or turn off company billing.'
      }
      return null
    }
    return null
  }

  function applyMessages(keys: string[], draft: FormState, draftQr: string | null) {
    setFieldErrors((current) => {
      const next = { ...current }
      for (const key of keys) {
        const checking = submittedRef.current || touchedRef.current.has(key) || Boolean(current[key])
        if (!checking) continue
        const message = messageFor(key, draft, draftQr)
        if (message) next[key] = message
        else delete next[key]
      }
      return next
    })
  }

  function touchAndCheck(key: string) {
    touchedRef.current.add(key)
    applyMessages([key], valuesRef.current, qrRef.current)
  }

  function patch(partial: Partial<FormState>) {
    const next = { ...valuesRef.current, ...partial }
    valuesRef.current = next
    setForm(next)
    const keys = Object.keys(partial)
    if (partial.use_company_billing != null) {
      keys.push('billing_company_name', 'gst_no')
    }
    applyMessages(keys, next, qrRef.current)
  }

  function patchName(name: string) {
    const next = { ...valuesRef.current, name }
    valuesRef.current = next
    setForm(next)
    applyMessages(['name'], next, qrRef.current)
  }

  function patchAddress(partial: Partial<FormState>) {
    setAddressManual(false)
    setForm((current) => {
      const next = { ...current, ...partial }
      next.full_address = buildFullAddress(next)
      return next
    })
  }

  async function copyQrCode() {
    if (!qrCode) return
    try {
      await navigator.clipboard.writeText(qrCode)
      toast.success('QR code copied')
    } catch {
      toast.error('Could not copy QR code')
    }
  }

  function selectType(id: string) {
    patch({
      property_category_id: id,
      property_sub_category_id: '',
      furnish_type: '',
      size_bhk: '',
      other_option_details: '',
    })
  }

  function collectFieldErrors(draft = valuesRef.current, draftQr = qrRef.current): Record<string, string> {
    const next: Record<string, string> = {}
    for (const key of [
      'name',
      'customer_id',
      'slug',
      'qr_code',
      'super_built_up_area',
      'price',
      'billing_company_name',
      'gst_no',
    ]) {
      const message = messageFor(key, draft, draftQr)
      if (message) next[key] = message
    }
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submittedRef.current = true

    const nextErrors = collectFieldErrors()
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError('Please fix the highlighted fields. The note under each box explains what to change.')
      const first = Object.keys(nextErrors)[0]
      const el =
        document.getElementById(
          first === 'name'
            ? 'tour-name'
            : first === 'slug'
              ? 'tour-id'
              : first === 'qr_code'
                ? 'tour-qr'
                : first === 'customer_id'
                  ? 'tour-customer'
                  : first,
        ) ?? document.querySelector('[aria-invalid="true"]')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setError(null)

    const areaRaw = form.super_built_up_area.trim()
    const priceRaw = form.price.trim()
    const area = areaRaw ? Number(areaRaw) : null
    const price = priceRaw ? Number(priceRaw) : null

    const tourIdDigits = form.slug.trim()
    const qrDigits = (qrCode ?? '').trim().toLowerCase()
    const payload: TourDetailsInput = {
      name: form.name.trim(),
      ...(canEditIdentity && tourIdDigits ? { slug: tourIdDigits } : {}),
      ...(canEditIdentity && qrDigits ? { qr_code: qrDigits } : {}),
      customer_id: form.customer_id,
      listing_status: form.listing_status,
      payment_status: form.payment_status,
      owner_type: form.owner_type,
      owner_type_details: form.owner_type === 'other' ? form.owner_type_details || null : null,
      property_category_id: form.property_category_id || null,
      property_sub_category_id: subtypes.length > 0 ? form.property_sub_category_id || null : null,
      furnish_type: furnishVisible ? form.furnish_type || null : null,
      size_bhk: residential ? form.size_bhk || null : null,
      other_option_details: otherVisible ? form.other_option_details || null : null,
      super_built_up_area: area,
      price,
      use_company_billing: form.use_company_billing,
      billing_company_name: form.use_company_billing ? form.billing_company_name || null : null,
      gst_no: form.use_company_billing ? form.gst_no || null : null,
      house_no: form.house_no || null,
      building_name: form.building_name || null,
      society_name: form.society_name || null,
      area_locality: form.area_locality || null,
      landmark: form.landmark || null,
      pin_code: form.pin_code || null,
      country: form.country || null,
      state: form.state || null,
      city: form.city || null,
      full_address: form.full_address || null,
    }

    setSaving(true)
    try {
      const saved = isEdit && tourId
        ? await api.tours.update(tourId, payload)
        : await api.tours.create(payload.name, payload)
      setQrCode(saved.qr_code ?? null)
      setTourStatus(saved.status)
      setCanEditIdentity(saved.canEditIdentity ?? false)
      const savedForm = { ...form, slug: saved.tour_id }
      setForm(savedForm)
      setBaseline(serializeForm(savedForm, saved.qr_code ?? null))
      toast.success(isEdit ? 'Changes saved' : 'Tour created successfully')

      if (!isEdit) {
        setPostCreateId(saved.tour_id)
        setPostCreateOpen(true)
        navigate(`/tours/${saved.tour_id}/edit`, { replace: true })
      } else if (saved.tour_id !== tourId) {
        navigate(`/tours/${saved.tour_id}/edit`, { replace: true })
      } else {
        setForm((current) => ({ ...current, slug: saved.tour_id }))
        setQrCode(saved.qr_code ?? null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save tour'
      const field =
        err instanceof ApiError && err.field
          ? err.field
          : /qr code/i.test(message)
            ? 'qr_code'
            : /tour id/i.test(message) || /slug/i.test(message)
              ? 'slug'
              : /customer/i.test(message)
                ? 'customer_id'
                : undefined
      if (field) {
        setFieldErrors({ [field]: message })
        setError('Please fix the highlighted field. The note under the box explains what to change.')
        document
          .getElementById(
            field === 'qr_code'
              ? 'tour-qr'
              : field === 'slug'
                ? 'tour-id'
                : field === 'name'
                  ? 'tour-name'
                  : field,
          )
          ?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      } else {
        setError(message)
      }
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const saveLabel = isEdit ? 'Save changes' : 'Create tour'
  const invalidClass = 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30'

  const formActions = (
    <>
      {isEdit && tourId && (
        <Button type="button" variant="outline" asChild>
          <Link to={`/upload?tour=${encodeURIComponent(tourId)}`}>Upload ZIP</Link>
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => guardNavigation(() => navigate('/tours'))}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={saving || loading} className="min-w-32">
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saveLabel}
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-0">
      <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
        <PageHeader
          title={isEdit ? 'Edit tour' : 'Create tour'}
          breadcrumbs={[
            { label: 'Home', href: '/' },
            { label: 'Tours', href: '/tours' },
            { label: isEdit ? 'Edit' : 'Create' },
          ]}
        showBack
        onBack={() => guardNavigation(() => navigate('/tours'))}
          actions={
            <div className="hidden items-center gap-3 sm:flex">
              {isDirty && (
                <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                  Unsaved changes
                </Badge>
              )}
              {tourStatus && <StatusBadge status={tourStatus} />}
              <Button type="submit" disabled={saving || loading} className="min-w-32">
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saveLabel}
              </Button>
            </div>
          }
        />

        {error && !loading && (
          <div className="mb-3 rounded-md bg-destructive-subtle px-3 py-1.5 text-sm text-destructive">
            {error}
          </div>
        )}
        <ListBox
          title="Tour details"
          subtitle="Only tour name and customer are required. All other fields are optional."
          onClose={() => guardNavigation(() => navigate('/tours'))}
        >
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground sm:px-5">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="space-y-3 p-4 sm:p-5">
              <CollapsibleFormSection
                icon={<ClipboardList />}
                title="Basic information"
                storageKey="tour-form-basic-open"
              >
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-5 [&>*]:min-w-0">
                  <FormField
                    label="Tour name"
                    htmlFor="tour-name"
                    required
                    error={fieldErrors.name}
                    className={compactField}
                  >
                      <Input
                        id="tour-name"
                        className={cn(compactInput, fieldErrors.name && invalidClass)}
                        value={form.name}
                        onChange={(event) => patchName(event.target.value)}
                        onBlur={() => touchAndCheck('name')}
                        aria-invalid={Boolean(fieldErrors.name)}
                        placeholder="e.g. Avadhgreens VR Tour"
                        required
                      />
                  </FormField>
                  <FormField
                    label="Customer"
                    htmlFor="tour-customer"
                    required
                    error={fieldErrors.customer_id}
                    className={compactField}
                  >
                    <div id="tour-customer" className="min-w-0 w-full">
                      <CustomerSearchSelect
                        value={form.customer_id}
                        onValueChange={(value) => patch({ customer_id: value })}
                        customers={customers}
                        triggerClassName={cn(compactSelect, fieldErrors.customer_id && invalidClass)}
                        disabled={loading}
                      />
                    </div>
                  </FormField>
                  <FormField label="Status" className={compactField}>
                    <SelectWithOther
                      value={form.listing_status}
                      onValueChange={(value) => patch({ listing_status: value as ListingStatus })}
                      options={LISTING_STATUS}
                      triggerClassName={compactSelect}
                    />
                  </FormField>
                  <FormField label="Payment status" className={compactField}>
                    <SelectWithOther
                      value={form.payment_status}
                      onValueChange={(value) => patch({ payment_status: value as PaymentStatus })}
                      options={PAYMENT_STATUS}
                      triggerClassName={compactSelect}
                    />
                  </FormField>
                </div>
                {(qrCode || canEditIdentity) && (
                  <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-2 [&>*]:min-w-0">
                    <FormField
                      label="Tour ID"
                      htmlFor="tour-id"
                      error={fieldErrors.slug}
                      hint={
                        fieldErrors.slug
                          ? undefined
                          : canEditIdentity
                            ? '6-digit number — R2 folder and public URL. Editable until the first ZIP upload.'
                            : 'Locked after the first ZIP upload.'
                      }
                      className={compactField}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          id="tour-id"
                          inputMode="numeric"
                          pattern="\d{6}"
                          maxLength={6}
                          value={form.slug}
                          readOnly={!canEditIdentity}
                          disabled={!canEditIdentity}
                          aria-invalid={Boolean(fieldErrors.slug)}
                          className={cn(
                            compactInput,
                            'min-w-0 flex-1 font-mono',
                            fieldErrors.slug && invalidClass,
                          )}
                          onChange={(event) => {
                            const value = event.target.value.replace(/\D/g, '').slice(0, 6)
                            patch({ slug: value })
                            applyMessages(['slug'], valuesRef.current, qrRef.current)
                          }}
                          onBlur={() => touchAndCheck('slug')}
                          placeholder="e.g. 482901"
                        />
                        {canEditIdentity && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 shrink-0 px-2.5"
                            onClick={() => {
                              const next = randomSixDigitTourId()
                              patch({ slug: next })
                              touchedRef.current.add('slug')
                              applyMessages(['slug'], valuesRef.current, qrRef.current)
                              toast.success(`New tour ID: ${next}. Save to keep it.`)
                            }}
                          >
                            Regenerate
                          </Button>
                        )}
                      </div>
                    </FormField>
                    <FormField
                      label="QR code"
                      htmlFor="tour-qr"
                      error={fieldErrors.qr_code}
                      hint={
                        fieldErrors.qr_code
                          ? undefined
                          : '8 letters or digits — for QR labels and scanning (not the same as Tour ID).'
                      }
                      className={compactField}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          id="tour-qr"
                          readOnly={!canEditIdentity}
                          disabled={!canEditIdentity}
                          maxLength={8}
                          value={qrCode ?? ''}
                          aria-invalid={Boolean(fieldErrors.qr_code)}
                          className={cn(
                            compactInput,
                            'min-w-0 flex-1 font-mono',
                            !canEditIdentity && 'bg-muted/40',
                            fieldErrors.qr_code && invalidClass,
                          )}
                          placeholder="e.g. a3k9x2m1"
                          onChange={(event) => {
                            const value = event.target.value
                              .toLowerCase()
                              .replace(/[^0-9a-z]/g, '')
                              .slice(0, 8)
                            qrRef.current = value
                            setQrCode(value)
                            applyMessages(['qr_code'], valuesRef.current, value)
                          }}
                          onBlur={() => touchAndCheck('qr_code')}
                        />
                        {canEditIdentity && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 shrink-0 px-2.5"
                            onClick={() => {
                              const next = randomQrCode()
                              qrRef.current = next
                              setQrCode(next)
                              touchedRef.current.add('qr_code')
                              applyMessages(['qr_code'], valuesRef.current, next)
                              toast.success(`New QR code: ${next}. Save to keep it.`)
                            }}
                          >
                            Regenerate
                          </Button>
                        )}
                        {qrCode && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 shrink-0 px-2.5"
                            onClick={() => void copyQrCode()}
                          >
                            <Copy className="size-3.5" />
                            Copy
                          </Button>
                        )}
                      </div>
                    </FormField>
                  </div>
                )}
                {!canEditIdentity && isEdit && (
                  <p className="text-[10px] text-muted-foreground">
                    Tour ID is locked after the first ZIP upload — R2 files live at{' '}
                    <span className="font-mono">{form.slug || tourId}/index.html</span>
                  </p>
                )}
              </CollapsibleFormSection>

              <CollapsibleFormSection
                icon={<Building2 />}
                title="Property details"
                storageKey="tour-form-property-open"
              >
                {!form.property_category_id && (
                  <p className="text-xs text-muted-foreground">
                    Select a property type to show sub type, furnish, and size options.
                  </p>
                )}
                <div className="grid gap-2.5 md:grid-cols-2">
                  <FormField label="Owner type" className={compactField}>
                    <ChoicePills
                      options={OWNER_OPTIONS}
                      value={form.owner_type}
                      onChange={(value) => patch({ owner_type: value })}
                    />
                  </FormField>
                  <FormField label="Property type" className={compactField}>
                    {categories.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No property types yet. Add them under System → Property types.
                      </p>
                    ) : (
                      <ChoicePills
                        options={categories.map((node) => ({
                          value: node.id,
                          label: node.name,
                          icon: node.icon ? (
                            <CategoryIcon icon={node.icon} className="size-3.5" />
                          ) : node.name.toLowerCase().includes('residential') ? (
                            <Home className="size-3.5" />
                          ) : node.name.toLowerCase().includes('other') ? (
                            <Coffee className="size-3.5" />
                          ) : (
                            <Building2 className="size-3.5" />
                          ),
                        }))}
                        value={form.property_category_id}
                        onChange={selectType}
                      />
                    )}
                  </FormField>
                </div>

                {form.owner_type === 'other' && (
                  <FormField label="Other owner details" htmlFor="owner-other" className={compactField}>
                    <Input
                      id="owner-other"
                      className={compactInput}
                      value={form.owner_type_details}
                      onChange={(event) => patch({ owner_type_details: event.target.value })}
                    />
                  </FormField>
                )}

                {(subtypes.length > 0 || furnishVisible) && (
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {subtypes.length > 0 && (
                      <FormField
                        label="Property sub type"
                        className={cn(compactField, !furnishVisible && 'md:col-span-2')}
                      >
                        <ChoicePills
                          options={subtypes.map((node) => ({
                            value: node.id,
                            label: node.name,
                            icon: node.icon ? (
                              <CategoryIcon icon={node.icon} className="size-3.5" />
                            ) : undefined,
                          }))}
                          value={form.property_sub_category_id}
                          onChange={(value) => {
                            const sub = subtypes.find((node) => node.id === value) ?? null
                            const showOther =
                              isOtherCategory(selectedType) && sub != null && isOtherCategory(sub)
                            patch({
                              property_sub_category_id: value,
                              other_option_details: showOther ? form.other_option_details : '',
                            })
                          }}
                        />
                      </FormField>
                    )}
                    {furnishVisible && (
                      <FormField
                        label="Furnish type"
                        className={cn(compactField, subtypes.length === 0 && 'md:col-span-2')}
                      >
                        <ChoicePills
                          options={FURNISH_OPTIONS}
                          value={form.furnish_type}
                          onChange={(value) => patch({ furnish_type: value })}
                        />
                      </FormField>
                    )}
                  </div>
                )}

                {residential && (
                  <FormField label="Size (BHK / RK)" className={compactField}>
                    <ChoicePills
                      scrollable
                      options={SIZE_OPTIONS}
                      value={form.size_bhk}
                      onChange={(value) => patch({ size_bhk: value })}
                    />
                  </FormField>
                )}

                {otherVisible && (
                  <FormField label="Other option details" htmlFor="other-details" className={compactField}>
                    <Textarea
                      id="other-details"
                      className="min-h-16 py-1.5 text-sm"
                      value={form.other_option_details}
                      placeholder="Enter other option details"
                      onChange={(event) => patch({ other_option_details: event.target.value })}
                    />
                  </FormField>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <FormField
                    label="Super built-up area (sq ft)"
                    htmlFor="area"
                    error={fieldErrors.super_built_up_area}
                    className={compactField}
                  >
                    <Input
                      id="area"
                      className={cn(compactInput, fieldErrors.super_built_up_area && invalidClass)}
                      aria-invalid={Boolean(fieldErrors.super_built_up_area)}
                      inputMode="decimal"
                      placeholder="e.g. 1200"
                      value={form.super_built_up_area}
                      onChange={(event) => patch({ super_built_up_area: event.target.value })}
                      onBlur={() => touchAndCheck('super_built_up_area')}
                    />
                  </FormField>
                  <FormField label="Price (₹)" htmlFor="price" error={fieldErrors.price} className={compactField}>
                    <Input
                      id="price"
                      className={cn(compactInput, fieldErrors.price && invalidClass)}
                      aria-invalid={Boolean(fieldErrors.price)}
                      inputMode="decimal"
                      placeholder="Enter price"
                      value={form.price}
                      onChange={(event) => patch({ price: event.target.value })}
                      onBlur={() => touchAndCheck('price')}
                    />
                  </FormField>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <Checkbox
                    id="company-billing"
                    checked={form.use_company_billing}
                    onCheckedChange={(checked) => patch({ use_company_billing: checked === true })}
                  />
                  <Label htmlFor="company-billing" className="text-xs font-normal">
                    Use company billing details
                  </Label>
                </div>
                {form.use_company_billing && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FormField
                      label="Company name"
                      htmlFor="company"
                      error={fieldErrors.billing_company_name}
                      className={compactField}
                    >
                      <Input
                        id="company"
                        className={cn(compactInput, fieldErrors.billing_company_name && invalidClass)}
                        aria-invalid={Boolean(fieldErrors.billing_company_name)}
                        placeholder="Enter company name"
                        value={form.billing_company_name}
                        onChange={(event) => patch({ billing_company_name: event.target.value })}
                        onBlur={() => touchAndCheck('billing_company_name')}
                      />
                    </FormField>
                    <FormField label="GST no" htmlFor="gst" error={fieldErrors.gst_no} className={compactField}>
                      <Input
                        id="gst"
                        className={cn(compactInput, fieldErrors.gst_no && invalidClass)}
                        aria-invalid={Boolean(fieldErrors.gst_no)}
                        placeholder="Enter GST number"
                        value={form.gst_no}
                        onChange={(event) => patch({ gst_no: event.target.value })}
                        onBlur={() => touchAndCheck('gst_no')}
                      />
                    </FormField>
                  </div>
                )}
              </CollapsibleFormSection>

              <CollapsibleFormSection
                icon={<MapPin />}
                title="Address details"
                storageKey="tour-form-address-open"
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField label="House / office no" htmlFor="house" className={compactField}>
                    <Input
                      id="house"
                      className={compactInput}
                      placeholder="e.g., H-123, 12A"
                      value={form.house_no}
                      onChange={(event) => patchAddress({ house_no: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Society / building name" htmlFor="building" className={compactField}>
                    <Input
                      id="building"
                      className={compactInput}
                      placeholder="Building or tower name"
                      value={form.building_name}
                      onChange={(event) => patchAddress({ building_name: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Society / complex name" htmlFor="society" className={compactField}>
                    <Input
                      id="society"
                      className={compactInput}
                      placeholder="Society or complex name"
                      value={form.society_name}
                      onChange={(event) => patchAddress({ society_name: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Area / locality" htmlFor="area-locality" className={compactField}>
                    <Input
                      id="area-locality"
                      className={compactInput}
                      placeholder="e.g., Vastrapur"
                      value={form.area_locality}
                      onChange={(event) => patchAddress({ area_locality: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Landmark" htmlFor="landmark" className={compactField}>
                    <Input
                      id="landmark"
                      className={compactInput}
                      placeholder="Nearby landmark"
                      value={form.landmark}
                      onChange={(event) => patchAddress({ landmark: event.target.value })}
                    />
                  </FormField>
                  <FormField label="PIN code" htmlFor="pin" className={compactField}>
                    <Input
                      id="pin"
                      className={compactInput}
                      inputMode="numeric"
                      placeholder="e.g., 380015"
                      value={form.pin_code}
                      onChange={(event) => patchAddress({ pin_code: event.target.value })}
                    />
                  </FormField>
                </div>
                <div className="grid gap-2 lg:grid-cols-3 lg:grid-rows-3 lg:items-stretch">
                  <FormField label="Country" className={cn(compactField, 'lg:col-start-1 lg:row-start-1')}>
                    <SelectWithOther
                      value={form.country}
                      onValueChange={(value) => patchAddress({ country: value, state: '', city: '' })}
                      options={COUNTRIES.map((country) => ({ value: country, label: country }))}
                      placeholder="Select country"
                      triggerClassName={compactSelect}
                    />
                  </FormField>
                  <FormField label="State" className={cn(compactField, 'lg:col-start-1 lg:row-start-2')}>
                    <SelectWithOther
                      key={form.country}
                      value={form.state}
                      onValueChange={(value) => patchAddress({ state: value, city: '' })}
                      options={stateOptions}
                      placeholder="Select state"
                      triggerClassName={compactSelect}
                      disabled={!form.country}
                    />
                  </FormField>
                  <FormField label="City" className={cn(compactField, 'lg:col-start-1 lg:row-start-3')}>
                    <SelectWithOther
                      key={`${form.country}-${form.state}`}
                      value={form.city}
                      onValueChange={(value) => patchAddress({ city: value })}
                      options={cityOptions}
                      placeholder="Select city"
                      triggerClassName={compactSelect}
                      disabled={!form.state}
                    />
                  </FormField>
                  <FormField
                    label="Full address"
                    htmlFor="full-address"
                    className={cn(
                      compactField,
                      'flex flex-col lg:col-span-2 lg:col-start-2 lg:row-span-3 lg:row-start-1',
                    )}
                  >
                    <div className="flex items-center gap-2 lg:-mt-0.5">
                      <Badge variant={addressManual ? 'secondary' : 'info'} className="text-[10px] font-normal">
                        {addressManual ? 'Edited manually' : 'Auto-generated'}
                      </Badge>
                      {addressManual && (
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline"
                          onClick={() => {
                            setAddressManual(false)
                            patchAddress({})
                          }}
                        >
                          Regenerate from fields
                        </button>
                      )}
                    </div>
                    <Textarea
                      id="full-address"
                      className="min-h-32 flex-1 resize-y py-2 text-sm leading-relaxed lg:min-h-0 lg:resize-none"
                      placeholder="Complete address with street details..."
                      value={form.full_address}
                      onChange={(event) => {
                        setAddressManual(true)
                        patch({ full_address: event.target.value })
                      }}
                    />
                  </FormField>
                </div>
              </CollapsibleFormSection>

            </div>
          )}
          {!loading && (
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:px-5">
              {isDirty && (
                <Badge variant="outline" className="mr-auto text-xs font-normal text-muted-foreground sm:hidden">
                  Unsaved changes
                </Badge>
              )}
              {formActions}
            </div>
          )}
        </ListBox>
      </form>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="You have unsaved changes on this tour. Leave without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setDiscardOpen(false)
          pendingNav.current?.()
          pendingNav.current = null
        }}
      />

      <Dialog open={postCreateOpen} onOpenChange={setPostCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tour created</DialogTitle>
            <DialogDescription>
              Your tour is saved. Upload the ZIP now or continue editing details.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPostCreateOpen(false)}>
              Later
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPostCreateOpen(false)
                if (postCreateId) navigate(`/upload?tour=${encodeURIComponent(postCreateId)}`)
              }}
            >
              Upload ZIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
