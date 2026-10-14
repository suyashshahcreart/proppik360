import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import {
  buildCustomClassIconValue,
  buildLucideIconValue,
  buildMediaIconValue,
  buildUrlIconValue,
  CURATED_LUCIDE_ICONS,
  formatCategoryIconLabel,
  isImageUrl,
  parseCategoryIcon,
} from '@/lib/category-icons'
import type { MediaListItem } from '@/types'
import { MediaPickerModal } from '@/components/media/MediaPickerModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CategoryIcon } from '@/components/icons/CategoryIcon'
import { cn } from '@/lib/utils'

interface IconPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string | null
  onSelect: (icon: string | null) => void
}

export function IconPickerDialog({ open, onOpenChange, value, onSelect }: IconPickerDialogProps) {
  const [tab, setTab] = useState('lucide')
  const [search, setSearch] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [pending, setPending] = useState<string | null>(value)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)

  const filteredLucide = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return CURATED_LUCIDE_ICONS
    return CURATED_LUCIDE_ICONS.filter(({ name }) => name.toLowerCase().includes(q))
  }, [search])

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPending(value)
      setSearch('')
      const parsed = parseCategoryIcon(value)
      if (parsed && (parsed.type === 'custom' || parsed.type === 'url')) {
        setCustomInput(parsed.value)
      } else {
        setCustomInput('')
      }
      if (parsed?.type === 'lucide') setTab('lucide')
      else if (parsed?.type === 'media' || parsed?.type === 'url' || parsed?.type === 'custom') {
        setTab('custom')
      }
    }
    onOpenChange(next)
  }

  const applyCustomInput = () => {
    const trimmed = customInput.trim()
    if (!trimmed) return
    setPending(isImageUrl(trimmed) ? buildUrlIconValue(trimmed) : buildCustomClassIconValue(trimmed))
  }

  const handleMediaSelect = (item: MediaListItem) => {
    setPending(buildMediaIconValue(item.id))
    setMediaPickerOpen(false)
  }

  const handleConfirm = () => {
    onSelect(pending)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Icon</DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="lucide">Lucide Icons</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>

            <TabsContent value="lucide" className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search icons…"
                  className="pl-8"
                />
              </div>

              <div className="min-h-[280px] flex-1 overflow-y-auto scrollbar-thin">
                {filteredLucide.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No icons match your search.</p>
                ) : (
                  <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                    {filteredLucide.map(({ name, icon: Icon }) => {
                      const iconValue = buildLucideIconValue(name)
                      const selected = pending === iconValue
                      return (
                        <button
                          key={name}
                          type="button"
                          title={name}
                          onClick={() => setPending(iconValue)}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-md border p-2 transition-colors hover:bg-secondary/70',
                            selected ? 'border-primary bg-primary/10' : 'border-transparent',
                          )}
                        >
                          <Icon className="size-5" />
                          <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                            {name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="custom" className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Enter a CSS icon class (e.g. Font Awesome) or an image URL, or pick from the media library.
              </p>

              <div className="flex gap-2">
                <Input
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. fa-solid fa-home or https://…/icon.svg"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyCustomInput()
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={applyCustomInput}>
                  Apply
                </Button>
              </div>

              <Button type="button" variant="outline" size="sm" onClick={() => setMediaPickerOpen(true)}>
                Choose from Media Library
              </Button>

              {pending && parseCategoryIcon(pending)?.type !== 'lucide' && (
                <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-3">
                  <div className="flex size-10 items-center justify-center rounded-md border border-border bg-card">
                    <CategoryIcon icon={pending} className="size-5" imgClassName="size-5" />
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-foreground">Preview</p>
                    <p className="truncate text-muted-foreground">{formatCategoryIconLabel(pending)}</p>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {pending && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
              <CategoryIcon icon={pending} className="size-4 shrink-0" imgClassName="size-4" />
              <span className="truncate text-muted-foreground">{formatCategoryIconLabel(pending)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-xs"
                onClick={() => setPending(null)}
              >
                Clear
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleConfirm}>
              Select
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaPickerModal
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        onSelect={handleMediaSelect}
        title="Select Icon Image"
      />
    </>
  )
}
