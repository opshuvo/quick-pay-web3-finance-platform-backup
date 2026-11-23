import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'

/** What the user picked. `system` follows the device and changes with it. */
export type ThemePreference = 'system' | 'dark' | 'light'
/** What is on screen right now. */
export type Theme = 'dark' | 'light'

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'dark', 'light']
/** A new key: everyone starts on System, and a choice made from here on is remembered. */
export const THEME_KEY = 'quickpay.theme-pref'
const THEME_COLOR: Record<Theme, string> = { dark: '#0a1222', light: '#f6f8fb' }
const QUERY = '(prefers-color-scheme: dark)'

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // Storage blocked: follow the device.
  }
  return 'system'
}

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme => (preference === 'system' ? (systemDark ? 'dark' : 'light') : preference)

const subscribeSystem = (notify: () => void) => {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
const systemIsDark = () => window.matchMedia(QUERY).matches

/**
 * Writes the theme to the page in the same frame as the tap. Transitions are switched off for that one frame, so
 * every colour changes together instead of hundreds of elements fading one by one.
 */
function applyTheme(theme: Theme, preference: ThemePreference) {
  const root = document.documentElement
  if (root.dataset.theme !== theme || root.dataset.themePref !== preference) {
    root.classList.add('theme-instant')
    root.dataset.theme = theme
    root.dataset.themePref = preference
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-instant')))
  }
}

interface ThemeValue {
  /** The theme on screen. */
  theme: Theme
  /** The saved choice: system, dark or light. */
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  /** Flips between dark and light (and leaves System). */
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark, () => true)
  const theme = resolveTheme(preference, systemDark)

  // Keeps the page in step when the device switches while System is selected, and on first paint.
  useEffect(() => {
    applyTheme(theme, preference)
  }, [theme, preference])

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private mode: the choice applies now but is not remembered.
    }
    applyTheme(resolveTheme(next, systemIsDark()), next)
    setPreferenceState(next)
  }, [])
  const toggle = useCallback(() => setPreference(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'), [setPreference])
  const value = useMemo(() => ({ theme, preference, setPreference, toggle }), [theme, preference, setPreference, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
