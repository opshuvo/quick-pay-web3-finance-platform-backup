import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MORE_GROUPS, NAV, PRIMARY_NAV } from '../src/nav'

describe('navigation', () => {
  test('primary navigation is exactly Send, Receive, Scan & Pay, Split Payment, Swap, Bridge', () => {
    expect(PRIMARY_NAV.map((n) => n.label)).toEqual(['Send', 'Receive', 'Scan & Pay', 'Split Payment', 'Swap', 'Bridge'])
  })
  test('secondary pages live under More', () => {
    const more = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.label))
    for (const label of ['Analytics', 'Smart Contracts', 'Profile', 'Settings', 'Payment Requests', 'Sent', 'Received', 'Transaction History', 'Overview', 'Payments']) expect(more).toContain(label)
  })
  test('every page appears exactly once', () => {
    const routes = NAV.map((n) => n.to)
    expect(new Set(routes).size).toBe(routes.length)
    const labels = NAV.map((n) => n.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
  test('every static route in App.tsx is still reachable from the navigation', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    const paths = [...app.matchAll(/<Route (index|path="([^"]+)")/g)].map((m) => (m[1] === 'index' ? '/' : `/${m[2]}`)).filter((p) => !p.includes(':') && p !== '/*')
    const nav = new Set(NAV.map((n) => n.to))
    for (const path of paths) expect(nav.has(path)).toBe(true)
  })
})
