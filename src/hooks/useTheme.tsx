import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'quickpay.theme'

function initial(): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return 'dark'
}

interface ThemeValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

/**
 * Writes the theme to the page in the same frame as the tap. Transitions are switched off for that one frame, so
 * every colour changes together instead of hundreds of elements fading one by one.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (root.dataset.theme === theme) return
  root.classList.add('theme-instant')
  root.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode: the theme still changes, it just is not remembered.
  }
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-instant')))
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial)
  // First paint: no flash, no switching class.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next)
    setThemeState(next)
  }, [])
  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setThemeState(next)
  }, [])
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
