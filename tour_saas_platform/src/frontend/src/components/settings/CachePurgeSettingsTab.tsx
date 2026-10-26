import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, type SystemCachePurgeRequest } from '@/services/api'
import type { Tour, User } from '@/types'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { TourMultiSearchSelect } from '@/components/shared/TourMultiSearchSelect'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getR2PublicDomain } from '@/lib/viewer-url'

const PURGE_ALL_PHRASE = 'PURGE ALL CACHE'

type CustomMode = 'url' | 'hostname' | 'tag' | 'prefix'

const CUSTOM_MODE_HELP: Record<
  CustomMode,
  { title: string; description: string; placeholder: string }
> = {
  url: {
    title: 'URL',
    description:
      'Purges assets in the Cloudflare cache that match the URL(s) exactly (one per line). Host must match your tour CDN domain.',
    placeholder: 'https://proppik360.com/221026/index.html',
  },
  hostname: {
    title: 'Hostname',
    description:
      'Any assets at URLs with a host that matches one of the provided values will be purged.',
    placeholder: 'proppik360.com',
  },
  tag: {
    title: 'Tag',
    description:
      'Purges assets served with a matching Cache-Tag response header. Tour uploads do not set Cache-Tag today — use URL or Prefix unless you configure tags.',
    placeholder: 'my-cache-tag',
  },
  prefix: {
    title: 'Prefix',
    description:
      'Any assets in the directory will be purged from cache (full https URL, trailing slash added if missing).',
    placeholder: 'https://proppik360.com/221026/',
  },
}

export function CachePurgeSettingsTab({ user: _user }: { user: User }) {
  const [tours, setTours] = useState<Tour[]>([])
  const [loadingTours, setLoadingTours] = useState(true)
  const [selectedTourIds, setSelectedTourIds] = useState<string[]>([])
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)

  const [everythingStep, setEverythingStep] = useState<0 | 1 | 2>(0)
  const [everythingPhrase, setEverythingPhrase] = useState('')
  const [everythingLoading, setEverythingLoading] = useState(false)

  const [customMode, setCustomMode] = useState<CustomMode>('prefix')
  const [customText, setCustomText] = useState('')
  const [customConfirmOpen, setCustomConfirmOpen] = useState(false)
  const [customLoading, setCustomLoading] = useState(false)

  const loadTours = useCallback(async () => {
    setLoadingTours(true)
    try {
      const list = await api.tours.list()
      setTours(list)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingTours(false)
    }
  }, [])

  useEffect(() => {
    void loadTours()
  }, [loadTours])

  const tourOptions = useMemo(
    () =>
      tours.map((t) => ({
        tourId: t.tour_id,
        name: t.name,
        status: t.status,
      })),
    [tours],
  )

  async function runBulkPurge() {
    const tourIds = [...selectedTourIds]
    if (tourIds.length === 0) return
    setBulkLoading(true)
    try {
      const res = await api.system.cache.purge({ type: 'tours', tourIds })
      if (res.success === false) {
        toast.error('Some tours failed to purge — check results')
      } else {
        toast.success(`CDN cache purge requested for ${tourIds.length} tour(s)`)
      }
      setBulkConfirmOpen(false)
      setSelectedTourIds([])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBulkLoading(false)
    }
  }

  async function runEverythingPurge() {
    setEverythingLoading(true)
    try {
      await api.system.cache.purge({
        type: 'everything',
        confirmPhrase: PURGE_ALL_PHRASE,
      })
      toast.success('Entire zone cache purge requested')
      setEverythingStep(0)
      setEverythingPhrase('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEverythingLoading(false)
    }
  }

  function parseCustomValues(): string[] {
    if (customMode === 'hostname') {
      return customText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return customText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function runCustomPurge() {
    const values = parseCustomValues()
    if (values.length === 0) {
      toast.error('Enter at least one value')
      return
    }
    setCustomLoading(true)
    try {
      const payload: SystemCachePurgeRequest = {
        type: 'custom',
        mode: customMode,
        values,
      }
      await api.system.cache.purge(payload)
      toast.success('Custom cache purge completed')
      setCustomConfirmOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCustomLoading(false)
    }
  }

  const publicDomain = getR2PublicDomain()

  return (
    <div className="space-y-6">
      <SettingsPanel
        title="Selected tours"
        description={`Purge Cloudflare CDN cache by tour folder on ${publicDomain} (and admin domain when configured).`}
      >
        <div className="space-y-3">
          {loadingTours ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading tours…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Tours</Label>
                <TourMultiSearchSelect
                  options={tourOptions}
                  value={selectedTourIds}
                  onValueChange={setSelectedTourIds}
                  placeholder="Click to search and select tours…"
                />
              </div>
              <Button
                type="button"
                disabled={selectedTourIds.length === 0}
                onClick={() => setBulkConfirmOpen(true)}
              >
                <RefreshCw className="size-4" />
                Purge cache for selected ({selectedTourIds.length})
              </Button>
            </>
          )}
        </div>
      </SettingsPanel>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Purge entire zone cache
          </CardTitle>
          <CardDescription>
            Clears all cached assets on the Cloudflare zone for {publicDomain}. Use only when
            necessary.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {everythingStep === 0 && (
            <Button type="button" variant="destructive" onClick={() => setEverythingStep(1)}>
              Purge everything…
            </Button>
          )}
          {everythingStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type{' '}
                <span className="font-mono font-semibold text-foreground">{PURGE_ALL_PHRASE}</span>{' '}
                to continue.
              </p>
              <Input
                value={everythingPhrase}
                onChange={(e) => setEverythingPhrase(e.target.value)}
                placeholder={PURGE_ALL_PHRASE}
                autoComplete="off"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEverythingStep(0)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={everythingPhrase !== PURGE_ALL_PHRASE}
                  onClick={() => setEverythingStep(2)}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}
          {everythingStep === 2 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-destructive">
                Final confirmation: purge all cached content for this zone?
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEverythingStep(1)}>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={everythingLoading}
                  onClick={() => void runEverythingPurge()}
                >
                  {everythingLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Confirm purge everything
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SettingsPanel
        title="Custom purge"
        description="Same modes as Cloudflare → Caching → Custom Purge."
      >
        <RadioGroup
          value={customMode}
          onValueChange={(v) => setCustomMode(v as CustomMode)}
          className="space-y-3"
        >
          {(Object.keys(CUSTOM_MODE_HELP) as CustomMode[]).map((mode) => (
            <div key={mode} className="flex items-start gap-3 rounded-md border border-border p-3">
              <RadioGroupItem value={mode} id={`custom-${mode}`} className="mt-1" />
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`custom-${mode}`} className="font-medium">
                  {CUSTOM_MODE_HELP[mode].title}
                </Label>
                <p className="text-xs text-muted-foreground">{CUSTOM_MODE_HELP[mode].description}</p>
              </div>
            </div>
          ))}
        </RadioGroup>
        <div className="mt-4 space-y-2">
          <Label htmlFor="custom-purge-values">Values</Label>
          <Textarea
            id="custom-purge-values"
            rows={5}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={CUSTOM_MODE_HELP[customMode].placeholder}
            className="font-mono text-xs"
          />
        </div>
        <Button type="button" className="mt-3" onClick={() => setCustomConfirmOpen(true)}>
          Purge
        </Button>
      </SettingsPanel>

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        title="Purge cache for selected tours?"
        description={`This will request Cloudflare to purge CDN cache for ${selectedTourIds.length} tour prefix(es).`}
        confirmLabel="Purge selected"
        loading={bulkLoading}
        onConfirm={() => void runBulkPurge()}
      />

      <ConfirmDialog
        open={customConfirmOpen}
        onOpenChange={setCustomConfirmOpen}
        title="Run custom cache purge?"
        description={`Mode: ${customMode}. ${parseCustomValues().length} value(s) will be sent to Cloudflare.`}
        confirmLabel="Purge"
        destructive={false}
        loading={customLoading}
        onConfirm={() => void runCustomPurge()}
      />
    </div>
  )
}
