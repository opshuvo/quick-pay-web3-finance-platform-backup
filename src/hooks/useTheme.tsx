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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial)
  useEffect(() => {
    const root = document.documentElement
    // Cross-fade colours on a switch, but not on the very first paint.
    const switching = root.dataset.theme !== undefined && root.dataset.theme !== theme
    if (switching) root.classList.add('theme-fade')
    root.dataset.theme = theme
    localStorage.setItem(KEY, theme)
    if (!switching) return
    const timer = setTimeout(() => root.classList.remove('theme-fade'), 360)
    return () => clearTimeout(timer)
  }, [theme])
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
