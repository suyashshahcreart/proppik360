import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ACCENT_LABELS,
  ACCENT_PRESETS,
  ACCENT_SWATCHES,
  type ThemePreference,
} from '@/lib/theme'
import { cn } from '@/lib/utils'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function ThemePreview() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="size-2 rounded-full bg-destructive/80" />
        <div className="size-2 rounded-full bg-warning/80" />
        <div className="size-2 rounded-full bg-success/80" />
      </div>
      <div className="space-y-2 p-3">
        <div className="flex gap-2">
          <div className="h-8 w-16 rounded-md bg-sidebar" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-3/4 rounded bg-muted" />
            <div className="h-2 w-1/2 rounded bg-muted" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-6 flex-1 rounded-md bg-primary" />
          <div className="h-6 w-14 rounded-md border border-border bg-card" />
        </div>
      </div>
    </div>
  )
}

export function ThemeSettingsPanel() {
  const { theme, accent, setTheme, setAccent } = useTheme()

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">Appearance</h4>
        <p className="text-xs text-muted-foreground">Preview updates as you choose options.</p>
      </div>

      <ThemePreview />

      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">Color mode</Label>
        <RadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as ThemePreference)}
          className="grid grid-cols-3 gap-2"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Label
              key={value}
              htmlFor={`theme-${value}`}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-border px-2 py-2.5 text-center transition-colors hover:bg-secondary has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
            >
              <RadioGroupItem value={value} id={`theme-${value}`} className="sr-only" />
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-xs font-medium">{label}</span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">Accent color</Label>
        <div className="grid grid-cols-6 gap-2">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              title={ACCENT_LABELS[preset]}
              aria-label={ACCENT_LABELS[preset]}
              aria-pressed={accent === preset}
              onClick={() => setAccent(preset)}
              className={cn(
                'relative size-8 rounded-full transition-transform hover:scale-105',
                accent === preset && 'ring-2 ring-primary ring-offset-2 ring-offset-popover',
              )}
              style={{ backgroundColor: ACCENT_SWATCHES[preset] }}
            >
              {accent === preset && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="size-2 rounded-full bg-white shadow-sm" />
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{ACCENT_LABELS[accent]} accent selected</p>
      </div>
    </div>
  )
}
