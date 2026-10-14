export const THEME_STORAGE_KEY = 'app-theme'
export const ACCENT_STORAGE_KEY = 'app-accent'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type AccentPreset = 'indigo' | 'blue' | 'emerald' | 'rose' | 'amber' | 'violet'

const ACCENT_CSS_VARS = [
  '--primary',
  '--primary-hover',
  '--ring',
  '--accent',
  '--accent-foreground',
  '--sidebar-primary',
  '--chart-1',
] as const

export const ACCENT_PRESETS: AccentPreset[] = ['indigo', 'blue', 'emerald', 'rose', 'amber', 'violet']

export const ACCENT_LABELS: Record<AccentPreset, string> = {
  indigo: 'Indigo',
  blue: 'Blue',
  emerald: 'Emerald',
  rose: 'Rose',
  amber: 'Amber',
  violet: 'Violet',
}

export const ACCENT_SWATCHES: Record<AccentPreset, string> = {
  indigo: '#4F46E5',
  blue: '#2563EB',
  emerald: '#059669',
  rose: '#E11D48',
  amber: '#D97706',
  violet: '#7C3AED',
}

const ACCENT_VALUES: Record<
  AccentPreset,
  { light: Record<(typeof ACCENT_CSS_VARS)[number], string>; dark: Record<(typeof ACCENT_CSS_VARS)[number], string> }
> = {
  indigo: {
    light: {
      '--primary': '#4F46E5',
      '--primary-hover': '#4338CA',
      '--ring': '#4F46E5',
      '--accent': '#EEF2FF',
      '--accent-foreground': '#4338CA',
      '--sidebar-primary': '#6366F1',
      '--chart-1': '#4F46E5',
    },
    dark: {
      '--primary': '#6366F1',
      '--primary-hover': '#818CF8',
      '--ring': '#6366F1',
      '--accent': '#27272A',
      '--accent-foreground': '#A5B4FC',
      '--sidebar-primary': '#6366F1',
      '--chart-1': '#6366F1',
    },
  },
  blue: {
    light: {
      '--primary': '#2563EB',
      '--primary-hover': '#1D4ED8',
      '--ring': '#2563EB',
      '--accent': '#EFF6FF',
      '--accent-foreground': '#1D4ED8',
      '--sidebar-primary': '#3B82F6',
      '--chart-1': '#2563EB',
    },
    dark: {
      '--primary': '#3B82F6',
      '--primary-hover': '#60A5FA',
      '--ring': '#3B82F6',
      '--accent': '#27272A',
      '--accent-foreground': '#93C5FD',
      '--sidebar-primary': '#3B82F6',
      '--chart-1': '#3B82F6',
    },
  },
  emerald: {
    light: {
      '--primary': '#059669',
      '--primary-hover': '#047857',
      '--ring': '#059669',
      '--accent': '#ECFDF5',
      '--accent-foreground': '#047857',
      '--sidebar-primary': '#10B981',
      '--chart-1': '#059669',
    },
    dark: {
      '--primary': '#10B981',
      '--primary-hover': '#34D399',
      '--ring': '#10B981',
      '--accent': '#27272A',
      '--accent-foreground': '#6EE7B7',
      '--sidebar-primary': '#10B981',
      '--chart-1': '#10B981',
    },
  },
  rose: {
    light: {
      '--primary': '#E11D48',
      '--primary-hover': '#BE123C',
      '--ring': '#E11D48',
      '--accent': '#FFF1F2',
      '--accent-foreground': '#BE123C',
      '--sidebar-primary': '#F43F5E',
      '--chart-1': '#E11D48',
    },
    dark: {
      '--primary': '#F43F5E',
      '--primary-hover': '#FB7185',
      '--ring': '#F43F5E',
      '--accent': '#27272A',
      '--accent-foreground': '#FDA4AF',
      '--sidebar-primary': '#F43F5E',
      '--chart-1': '#F43F5E',
    },
  },
  amber: {
    light: {
      '--primary': '#D97706',
      '--primary-hover': '#B45309',
      '--ring': '#D97706',
      '--accent': '#FFFBEB',
      '--accent-foreground': '#B45309',
      '--sidebar-primary': '#F59E0B',
      '--chart-1': '#D97706',
    },
    dark: {
      '--primary': '#F59E0B',
      '--primary-hover': '#FBBF24',
      '--ring': '#F59E0B',
      '--accent': '#27272A',
      '--accent-foreground': '#FCD34D',
      '--sidebar-primary': '#F59E0B',
      '--chart-1': '#F59E0B',
    },
  },
  violet: {
    light: {
      '--primary': '#7C3AED',
      '--primary-hover': '#6D28D9',
      '--ring': '#7C3AED',
      '--accent': '#F5F3FF',
      '--accent-foreground': '#6D28D9',
      '--sidebar-primary': '#8B5CF6',
      '--chart-1': '#7C3AED',
    },
    dark: {
      '--primary': '#8B5CF6',
      '--primary-hover': '#A78BFA',
      '--ring': '#8B5CF6',
      '--accent': '#27272A',
      '--accent-foreground': '#C4B5FD',
      '--sidebar-primary': '#8B5CF6',
      '--chart-1': '#8B5CF6',
    },
  },
}

export function getStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage may be unavailable
  }
  return 'system'
}

export function setStoredTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // localStorage may be unavailable
  }
}

export function getStoredAccent(): AccentPreset {
  if (typeof window === 'undefined') return 'indigo'
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY)
    if (stored && ACCENT_PRESETS.includes(stored as AccentPreset)) return stored as AccentPreset
  } catch {
    // localStorage may be unavailable
  }
  return 'indigo'
}

export function setStoredAccent(accent: AccentPreset): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, accent)
  } catch {
    // localStorage may be unavailable
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getResolvedTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return getSystemTheme()
  return preference
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = getResolvedTheme(preference)
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  return resolved
}

export function applyAccent(preset: AccentPreset, resolvedTheme: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.accent = preset

  if (preset === 'indigo') {
    for (const variable of ACCENT_CSS_VARS) {
      root.style.removeProperty(variable)
    }
    return
  }

  const values = ACCENT_VALUES[preset][resolvedTheme]
  for (const [variable, value] of Object.entries(values)) {
    root.style.setProperty(variable, value)
  }
}

export function subscribeToSystemTheme(callback: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

/** Apply stored theme + accent — call before React mount to reduce flash. */
export function initTheme(): void {
  const theme = getStoredTheme()
  const resolved = applyTheme(theme)
  applyAccent(getStoredAccent(), resolved)
}
