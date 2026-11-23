import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { usePresence } from '@/hooks/usePresence'
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '@/hooks/useTheme'

const OPTIONS: Record<ThemePreference, { label: string; icon: LucideIcon; hint: string }> = {
  system: { label: 'System', icon: Monitor, hint: 'Follows your device' },
  dark: { label: 'Dark', icon: Moon, hint: 'Deep navy and neon green' },
  light: { label: 'Light', icon: Sun, hint: 'White and emerald' },
}

/** Header control: one button that shows the theme on screen, opening a System / Dark / Light choice. */
export function ThemeMenu() {
  const { theme, preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const menu = usePresence(open)
  const Current = preference === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Theme: ${OPTIONS[preference].label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-ghost !min-h-[44px] !min-w-[44px] !px-0 sm:!px-3">
        <span key={`${preference}-${theme}`} className="theme-spin inline-flex"><Current className="size-4" aria-hidden /></span>
      </button>
      {menu.mounted && (
        <div role="menu" aria-label="Theme" data-state={menu.state} className="card pop absolute right-0 top-[calc(100%+8px)] z-50 w-56 p-1.5" style={{ background: 'var(--bg-2)' }}>
          {THEME_PREFERENCES.map((id) => {
            const { label, icon: Icon, hint } = OPTIONS[id]
            return (
              <button key={id} role="menuitemradio" aria-checked={preference === id} onClick={() => { setPreference(id); setOpen(false) }} className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--surface-strong)]">
                <Icon className="size-4 shrink-0" aria-hidden style={{ color: preference === id ? 'var(--accent)' : 'var(--muted)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>
                </span>
                {preference === id && <Check className="size-4 shrink-0" aria-hidden style={{ color: 'var(--accent)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Settings version: three always-visible options. */
export function ThemeSegmented() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
      {THEME_PREFERENCES.map((id) => {
        const { label, icon: Icon } = OPTIONS[id]
        const on = preference === id
        return (
          <button key={id} role="radio" aria-checked={on} onClick={() => setPreference(id)} className="btn flex-col !gap-1 !py-2" style={{ background: on ? 'var(--accent-btn)' : 'var(--surface-muted)', color: on ? 'var(--accent-ink)' : 'var(--ink)', border: '1px solid var(--border)' }}>
            <Icon className="size-4" aria-hidden /> <span className="text-xs">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
