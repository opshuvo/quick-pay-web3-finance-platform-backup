import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { readPreference, resolveTheme, THEME_KEY } from '../src/hooks/useTheme'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const dark = tokens(":root,\n[data-theme='dark']")
const light = tokens("[data-theme='light'] {")

const hex = (v: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v)
  if (!m) throw new Error(`not a hex colour: ${v}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
}
const lum = (v: string) => {
  const [r, g, b] = hex(v).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const stops = (grad: string) => [...grad.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])

describe('both themes define the same tokens', () => {
  test('every token in one theme exists in the other', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
  })
})

describe.each([['dark', dark], ['light', light]] as const)('%s theme is readable', (_name, t) => {
  test('body text and secondary text', () => {
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(7)
    expect(contrast(t['ink-2'], t.bg)).toBeGreaterThanOrEqual(7)
    expect(contrast(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.muted, t['bg-2'])).toBeGreaterThanOrEqual(4.5)
    // Hints and labels: large or secondary text only, so the WCAG 3:1 bar applies.
    // Small helper text (labels, nav captions) uses this colour, so it meets the 4.5 text ratio on every surface.
    for (const surface of [t.bg, t.surface, t['surface-muted'], t['surface-strong']]) expect(contrast(t.subtle, surface)).toBeGreaterThanOrEqual(4.5)
  })
  test('the accent, status colours and focus ring stand out from the canvas', () => {
    for (const key of ['accent', 'success', 'danger', 'warn', 'focus']) expect(contrast(t[key], t.bg)).toBeGreaterThanOrEqual(3)
  })
  test('text on primary buttons is legible over every stop of the gradient', () => {
    for (const stop of stops(t['grad-btn'])) expect(contrast(t['accent-ink'], stop)).toBeGreaterThanOrEqual(4.5)
  })
})

test('the palettes are navy, and white on a light-blue canvas, with one blue accent', () => {
  expect(dark.bg.toLowerCase()).toBe('#0a1222')
  expect(light.surface.toLowerCase()).toBe('#ffffff')
  expect(light.bg.toLowerCase()).toBe('#f3f8ff')
  for (const t of [dark, light]) {
    expect(t['accent-btn']).toMatch(/^#[0-9a-f]{6}$/i)
    expect(t.cyan).toBe(t.accent)
  }
})

test('light status pills are readable on their soft tints (small text, 4.5:1)', () => {
  expect(contrast(light.success, light['emerald-soft'])).toBeGreaterThanOrEqual(4.5)
  expect(contrast(light.warn, light['warn-soft'])).toBeGreaterThanOrEqual(4.5)
  expect(contrast(light.danger, light['danger-soft'])).toBeGreaterThanOrEqual(4.5)
  expect(contrast(light.accent, light['blue-soft'])).toBeGreaterThanOrEqual(4.5)
})

test('blue and emerald are the two accents in both themes', () => {
  for (const t of [dark, light]) {
    expect(contrast(t.emerald, t.bg)).toBeGreaterThanOrEqual(3)
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3)
  }
})

describe('the look stays restrained', () => {
  test('buttons and accents are solid colours, never gradients', () => {
    for (const t of [dark, light]) {
      expect(t.grad).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t['grad-btn']).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
  test('surfaces are solid (no glass) in both themes', () => {
    for (const t of [dark, light]) for (const key of ['bg', 'bg-2', 'surface', 'surface-strong', 'surface-muted', 'border']) expect(t[key]).toMatch(/^#[0-9a-f]{6}$/i)
  })
  test('no blur or neon glow is applied to cards or panels', () => {
    const cards = css.slice(css.indexOf('@layer components'), css.indexOf('@layer components') + 1400)
    expect(cards).not.toMatch(/backdrop-filter:\s*blur/)
    expect(css).not.toMatch(/box-shadow:[^;]*0 0 \d+px var\(--(?:accent|cyan)\)/)
  })
})

describe('System is the default and a choice is remembered', () => {
  const memory = new Map<string, string>()
  beforeEach(() => {
    memory.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) }
  })
  test('nothing saved means System', () => expect(readPreference()).toBe('system'))
  test('Dark, Light and System are restored', () => {
    for (const p of ['dark', 'light', 'system']) { memory.set(THEME_KEY, p); expect(readPreference()).toBe(p as never) }
  })
  test('an unknown or old value falls back to System', () => {
    memory.set(THEME_KEY, 'purple')
    expect(readPreference()).toBe('system')
  })
  test('System follows the device, Dark and Light ignore it', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('no screen is locked to one theme', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f: string) => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [] })
  test('no forced dark island and no fixed light-on-dark or dark-on-light colour classes', () => {
    const offenders: string[] = []
    for (const file of files(new URL('../src', import.meta.url).pathname)) {
      const text = readFileSync(file, 'utf8')
      if (/data-theme="dark"|data-theme='dark'|\b(?:bg|text|border)-(?:slate|indigo|gray|zinc)-\d/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})

describe('motion rules', () => {
  const sheet = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

  test('no easing curve overshoots, so nothing bounces', () => {
    const curves = [...sheet.matchAll(/cubic-bezier\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number))
    expect(curves.length).toBeGreaterThan(5)
    for (const [, y1, , y2] of curves) {
      expect(y1).toBeGreaterThanOrEqual(0)
      expect(y1).toBeLessThanOrEqual(1)
      expect(y2).toBeGreaterThanOrEqual(0)
      expect(y2).toBeLessThanOrEqual(1)
    }
  })

  test('the shared timing is 220ms for small changes and 280ms for panes', () => {
    expect(sheet).toContain('--dur: 220ms;')
    expect(sheet).toContain('--dur-lg: 280ms;')
    expect(sheet).toMatch(/--ease: cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/)
  })

  test('nothing transitions "all" properties, which makes mobile layouts stutter', () => {
    expect(/transition:\s*all\b/.test(sheet)).toBe(false)
  })

  test('reduced motion switches every animation and transition off', () => {
    const block = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toContain('animation-duration: 0.01ms !important')
    expect(block).toContain('transition-duration: 0.01ms !important')
  })
})

describe('reference dashboard', () => {
  const stops = (value: string) => [...value.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])

  test('only Send and Receive carry gradients, and white text is readable over every stop', () => {
    for (const t of [dark, light]) {
      for (const key of ['grad-send', 'grad-receive']) {
        expect(t[key]).toContain('linear-gradient')
        const colours = stops(t[key])
        expect(colours.length).toBeGreaterThanOrEqual(2)
        for (const c of colours) expect(contrast('#ffffff', c)).toBeGreaterThanOrEqual(4.5)
      }
      expect(t['grad-btn']).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  test('the orbital background has colours in both themes and the balance card has its own surface', () => {
    for (const t of [dark, light]) {
      for (const key of ['orbit', 'orbit-2', 'hero-bg', 'wash-1', 'wash-2']) expect(t[key]).toBeTruthy()
      for (const c of stops(t['hero-bg'])) expect(contrast(t.ink, c)).toBeGreaterThanOrEqual(7)
      for (const c of stops(t['hero-bg'])) expect(contrast(t.muted, c)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('every orbital, ripple and sheen animation moves only transform and opacity', () => {
    for (const name of ['orbit-spin', 'orbit-wave', 'card-sheen', 'net-ripple', 'logo-ripple', 'logo-breathe-soft']) {
      const start = css.indexOf(`@keyframes ${name}`)
      expect(start).toBeGreaterThan(-1)
      let depth = 0
      let end = start
      for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++
        if (css[i] === '}' && --depth === 0) { end = i; break }
      }
      const props = [...css.slice(css.indexOf('{', start) + 1, end).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
      for (const prop of props) expect(['transform', 'opacity']).toContain(prop)
    }
  })

  test('the floating bottom bar is inset from the screen edges', () => {
    const bar = css.slice(css.lastIndexOf('/* Floating bottom navigation */'))
    expect(bar).toMatch(/left:\s*12px/)
    expect(bar).toMatch(/border-radius:\s*1\.5rem/)
  })
})
