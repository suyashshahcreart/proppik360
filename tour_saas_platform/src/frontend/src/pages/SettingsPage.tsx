import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Loader2,
  MessageSquare,
  Save,
  Settings2,
  SlidersHorizontal,
  Users,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../services/api'
import type { User } from '../types'
import { can, canAny, PermissionGate } from '@/components/shared/PermissionGate'
import { PageHeader } from '@/components/shared/PageHeader'
import { ListBox } from '@/components/shared/ListBox'
import { TourMasterAdminTab } from '@/components/settings/TourMasterAdminTab'
import { CachePurgeSettingsTab } from '@/components/settings/CachePurgeSettingsTab'
import {
  Msg91TemplatesDialog,
  type Msg91TemplateRow,
} from '@/components/settings/Msg91TemplatesDialog'
import { SettingsField, SettingsPanel } from '@/components/settings/SettingsPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

function parseTemplatesJson(raw: string | null | undefined): Msg91TemplateRow[] {
  if (!raw?.trim()) return []
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
    return Object.entries(obj).map(([key, template_id]) => ({
      key,
      template_id: typeof template_id === 'string' ? template_id : String(template_id ?? ''),
    }))
  } catch {
    return []
  }
}

const SETTINGS_ANY = [
  'setting_view',
  'setting_edit',
  'setting_general',
  'setting_sms',
  'setting_tour_admin',
  'setting_cache_purge',
] as const

function flagOn(map: Record<string, string | null>, key: string): boolean {
  return map[key] === '1' || map[key] === 'true'
}

function msToSecondsDisplay(ms: string): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '30'
  // Prefer whole seconds; if legacy value looks like seconds already (< 1000), keep as-is
  if (n < 1000) return String(Math.round(n))
  return String(Math.round(n / 1000))
}

function secondsToMs(sec: string): number {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return 30000
  return Math.round(n * 1000)
}

export function SettingsPage({ user }: { user: User }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [general, setGeneral] = useState({
    support_email: '',
    support_phone: '',
    tour_admin_api_base_url: '',
  })
  const [sms, setSms] = useState({
    sms_msg91_enabled: false,
    msg91_sender_id: '',
    msg91_route: '4',
    msg91_timeout_sec: '30',
    otp_length: '6',
    otp_expiry_sec: '300',
    msg91_mock_mode: false,
  })
  const [msg91Templates, setMsg91Templates] = useState<Msg91TemplateRow[]>([])
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const [savingGeneral, setSavingGeneral] = useState(false)
  const [savingSms, setSavingSms] = useState(false)

  const availableTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string; icon: typeof SlidersHorizontal }> = []
    if (can(user, 'setting_general') || can(user, 'setting_edit') || can(user, 'setting_view')) {
      tabs.push({ id: 'general', label: 'General', icon: SlidersHorizontal })
    }
    if (can(user, 'setting_sms') || can(user, 'setting_edit') || can(user, 'setting_view')) {
      tabs.push({ id: 'sms', label: 'SMS Configuration', icon: MessageSquare })
    }
    if (
      can(user, 'setting_tour_admin') ||
      can(user, 'setting_view') ||
      can(user, 'setting_edit')
    ) {
      tabs.push({ id: 'tour_admin', label: 'Tour Master Admin', icon: Users })
    }
    if (can(user, 'setting_cache_purge')) {
      tabs.push({ id: 'cache_purge', label: 'Cache purge', icon: RefreshCw })
    }
    return tabs
  }, [user])

  const [activeTab, setActiveTab] = useState('general')

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some((t) => t.id === activeTab)) {
      setActiveTab(availableTabs[0].id)
    }
  }, [availableTabs, activeTab])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const map = await api.system.settings.get()
      setGeneral({
        support_email: map.support_email ?? '',
        support_phone: map.support_phone ?? '',
        tour_admin_api_base_url: map.tour_admin_api_base_url ?? '',
      })
      setSms({
        sms_msg91_enabled: flagOn(map, 'sms_msg91_enabled'),
        msg91_sender_id: map.msg91_sender_id ?? '',
        msg91_route: map.msg91_route ?? '4',
        msg91_timeout_sec: msToSecondsDisplay(map.msg91_timeout_ms ?? '30000'),
        otp_length: map.otp_length ?? '6',
        otp_expiry_sec: map.otp_expiry_sec ?? '300',
        msg91_mock_mode: flagOn(map, 'msg91_mock_mode'),
      })
      let templates = parseTemplatesJson(map.msg91_templates)
      if (templates.length === 0 && map.msg91_otp_template_id?.trim()) {
        templates = [{ key: 'tour_access_otp', template_id: map.msg91_otp_template_id.trim() }]
      }
      if (templates.length === 0) {
        templates = [
          { key: 'login_otp', template_id: '' },
          { key: 'tour_access_otp', template_id: '' },
        ]
      }
      setMsg91Templates(templates)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const canEditGeneral = canAny(user, ['setting_general', 'setting_edit'])
  const canEditSms = canAny(user, ['setting_sms', 'setting_edit'])

  const saveGeneral = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEditGeneral) return
    setSavingGeneral(true)
    try {
      await api.system.settings.patch({ tab: 'general', ...general })
      toast.success('General settings saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingGeneral(false)
    }
  }

  const saveSms = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canEditSms) return
    setSavingSms(true)
    try {
      await api.system.settings.patch({
        tab: 'sms',
        sms_msg91_enabled: sms.sms_msg91_enabled,
        msg91_sender_id: sms.msg91_sender_id,
        msg91_route: sms.msg91_route,
        msg91_timeout_ms: secondsToMs(sms.msg91_timeout_sec),
        msg91_templates: msg91Templates,
        otp_length: Number(sms.otp_length) || 6,
        otp_expiry_sec: Number(sms.otp_expiry_sec) || 300,
        msg91_mock_mode: sms.msg91_mock_mode,
      })
      toast.success('SMS settings saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingSms(false)
    }
  }

  if (!canAny(user, [...SETTINGS_ANY])) {
    return (
      <div className="space-y-4">
        <PageHeader title="General Settings" description="Platform configuration" />
        <p className="text-sm text-muted-foreground">You do not have access to settings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="General Settings Management"
        description="Configure platform defaults, SMS gateway, and tour admin templates"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'System' },
          { label: 'Settings' },
        ]}
        showBack
        backTo="/dashboard"
      />

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* BrokerX-style white card: title left + ↑ / ⛶ / ✕ in the same header box */}
      <ListBox
        title="General Settings"
        subtitle="Platform configuration"
        collapsible
        fullscreenable
        onRefresh={() => void load()}
        refreshing={loading}
        hideSearch
        contentClassName="p-4 md:p-5"
      >
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        orientation="vertical"
        className="flex flex-col gap-5 md:flex-row md:items-start"
      >
        <TabsList
          className={cn(
            'h-auto w-full shrink-0 flex-col items-stretch justify-start gap-0.5',
            'rounded-xl border border-border bg-muted/30 p-2 md:w-56',
          )}
        >
          {availableTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  'justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium shadow-none',
                  'data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground',
                  'data-[state=inactive]:hover:bg-muted/60 data-[state=inactive]:hover:text-foreground',
                  'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm',
                )}
              >
                <Icon className="size-4 shrink-0 opacity-90" />
                {tab.label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <div className="min-w-0 flex-1">
          <PermissionGate
            user={user}
            anyOf={['setting_general', 'setting_edit', 'setting_view']}
          >
            <TabsContent value="general" className="mt-0">
              <form onSubmit={saveGeneral}>
                <SettingsPanel
                  title="General"
                  description="Support contacts and tour-admin API base URL"
                  footer={
                    <>
                      <span />
                      <Button type="submit" size="sm" disabled={savingGeneral || !canEditGeneral}>
                        {savingGeneral ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                        Save
                      </Button>
                    </>
                  }
                >
                  <SettingsField
                    label="Support email"
                    hint="Shown on support / contact surfaces"
                  >
                    <Input
                      type="email"
                      value={general.support_email}
                      disabled={!canEditGeneral}
                      onChange={(e) =>
                        setGeneral((g) => ({ ...g, support_email: e.target.value }))
                      }
                      placeholder="support@proppik.com"
                    />
                  </SettingsField>
                  <SettingsField label="Support phone">
                    <Input
                      value={general.support_phone}
                      disabled={!canEditGeneral}
                      onChange={(e) =>
                        setGeneral((g) => ({ ...g, support_phone: e.target.value }))
                      }
                      placeholder="+91 …"
                    />
                  </SettingsField>
                  <SettingsField
                    label="Tour admin API base URL"
                    hint="Used when copying tour-admin API links (no trailing slash)."
                  >
                    <Input
                      value={general.tour_admin_api_base_url}
                      disabled={!canEditGeneral}
                      onChange={(e) =>
                        setGeneral((g) => ({ ...g, tour_admin_api_base_url: e.target.value }))
                      }
                      placeholder="http://127.0.0.1:8787/api/tour-admin"
                    />
                  </SettingsField>
                </SettingsPanel>
              </form>
            </TabsContent>
          </PermissionGate>

          <PermissionGate user={user} anyOf={['setting_sms', 'setting_edit', 'setting_view']}>
            <TabsContent value="sms" className="mt-0">
              <form onSubmit={saveSms}>
                <SettingsPanel
                  title="MSG91"
                  description="SMS / OTP gateway for tour-admin login"
                  enabled={sms.sms_msg91_enabled}
                  onEnabledChange={(v) => setSms((s) => ({ ...s, sms_msg91_enabled: v }))}
                  enableDisabled={!canEditSms}
                  footer={
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTemplatesOpen(true)}
                      >
                        <Settings2 className="size-4" />
                        Manage Templates
                      </Button>
                      <Button type="submit" size="sm" disabled={savingSms || !canEditSms}>
                        {savingSms ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                        Save
                      </Button>
                    </>
                  }
                >
                  <SettingsField
                    label="MSG91 AUTH KEY"
                    required
                    hint="Your MSG91 authentication key — set MSG91_AUTH_KEY in server .env (never stored in the database)."
                  >
                    <Input
                      value="••••••••••••••••••••••••"
                      readOnly
                      disabled
                      className="font-mono tracking-wider"
                    />
                  </SettingsField>

                  <SettingsField
                    label="MSG91 SENDER ID"
                    required
                    hint="Your approved sender ID (e.g., PROPPK)"
                  >
                    <Input
                      value={sms.msg91_sender_id}
                      disabled={!canEditSms}
                      onChange={(e) =>
                        setSms((s) => ({ ...s, msg91_sender_id: e.target.value }))
                      }
                      placeholder="PROPPK"
                    />
                  </SettingsField>

                  <SettingsField
                    label="MSG91 TIMEOUT"
                    hint="API request timeout in seconds (default: 30)"
                  >
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={sms.msg91_timeout_sec}
                      disabled={!canEditSms}
                      onChange={(e) =>
                        setSms((s) => ({ ...s, msg91_timeout_sec: e.target.value }))
                      }
                    />
                  </SettingsField>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <SettingsField label="OTP length">
                      <Input
                        type="number"
                        min={4}
                        max={8}
                        value={sms.otp_length}
                        disabled={!canEditSms}
                        onChange={(e) => setSms((s) => ({ ...s, otp_length: e.target.value }))}
                      />
                    </SettingsField>
                    <SettingsField label="OTP expiry (seconds)">
                      <Input
                        type="number"
                        min={60}
                        max={900}
                        value={sms.otp_expiry_sec}
                        disabled={!canEditSms}
                        onChange={(e) =>
                          setSms((s) => ({ ...s, otp_expiry_sec: e.target.value }))
                        }
                      />
                    </SettingsField>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="sms_mock"
                      checked={sms.msg91_mock_mode}
                      disabled={!canEditSms}
                      onCheckedChange={(v) =>
                        setSms((s) => ({ ...s, msg91_mock_mode: v === true }))
                      }
                    />
                    <Label htmlFor="sms_mock" className="text-sm font-normal">
                      Mock mode (log OTP to server console — no real SMS)
                    </Label>
                  </div>
                </SettingsPanel>
              </form>

              <Msg91TemplatesDialog
                open={templatesOpen}
                onOpenChange={setTemplatesOpen}
                value={msg91Templates}
                readOnly={!canEditSms}
                onSave={async (rows) => {
                  if (!canEditSms) {
                    setMsg91Templates(rows)
                    return
                  }
                  const map = await api.system.settings.patch({
                    tab: 'sms',
                    msg91_templates: rows,
                  })
                  const persisted = parseTemplatesJson(map.msg91_templates)
                  setMsg91Templates(
                    persisted.length > 0
                      ? persisted
                      : rows,
                  )
                  toast.success('MSG91 templates saved')
                }}
              />
            </TabsContent>
          </PermissionGate>

          <PermissionGate
            user={user}
            anyOf={['setting_tour_admin', 'setting_view', 'setting_edit']}
          >
            <TabsContent value="tour_admin" className="mt-0">
              <TourMasterAdminTab user={user} />
            </TabsContent>
          </PermissionGate>

          <PermissionGate user={user} permission="setting_cache_purge">
            <TabsContent value="cache_purge" className="mt-0">
              <CachePurgeSettingsTab user={user} />
            </TabsContent>
          </PermissionGate>
        </div>
      </Tabs>
      </ListBox>
    </div>
  )
}
