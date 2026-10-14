import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyAccent,
  applyTheme,
  getResolvedTheme,
  getStoredAccent,
  getStoredTheme,
  setStoredAccent,
  setStoredTheme,
  subscribeToSystemTheme,
  type AccentPreset,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

interface ThemeContextValue {
  theme: ThemePreference
  accent: AccentPreset
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
  setAccent: (accent: AccentPreset) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme())
  const [accent, setAccentState] = useState<AccentPreset>(() => getStoredAccent())
  const resolvedTheme = useMemo(() => getResolvedTheme(theme), [theme])

  useEffect(() => {
    applyTheme(theme)
    setStoredTheme(theme)
  }, [theme])

  useEffect(() => {
    applyAccent(accent, resolvedTheme)
    setStoredAccent(accent)
  }, [accent, resolvedTheme])

  useEffect(() => {
    if (theme !== 'system') return
    return subscribeToSystemTheme(() => {
      const resolved = applyTheme('system')
      applyAccent(accent, resolved)
    })
  }, [theme, accent])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
  }, [])

  const setAccent = useCallback((next: AccentPreset) => {
    setAccentState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const resolved = getResolvedTheme(current)
      return resolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const value = useMemo(
    () => ({ theme, accent, resolvedTheme, setTheme, setAccent, toggleTheme }),
    [theme, accent, resolvedTheme, setTheme, setAccent, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
