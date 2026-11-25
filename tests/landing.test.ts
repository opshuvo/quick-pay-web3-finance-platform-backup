import { describe, expect, test } from 'bun:test'
import { FEATURES, httpsUrl, SECURITY, STEPS, WHY } from '../src/components/landing/content'
import { NAV } from '../src/nav'

describe('landing page content', () => {
  test('it presents the eight features that were asked for', () => {
    expect(FEATURES.map((f) => f.title)).toEqual(['Send', 'Receive', 'Scan & Pay', 'Split Payment', 'Request Pay', 'Swap', 'Bridge', 'Transaction History'])
  })
  test('every feature opens a real route of the app', () => {
    const routes = new Set(NAV.map((n) => n.to))
    for (const f of FEATURES) expect(routes.has(f.to)).toBe(true)
  })
  test('the steps, security points and benefits are all written out', () => {
    expect(STEPS).toHaveLength(4)
    expect(SECURITY.map((p) => p.title)).toContain('Non-custodial')
    expect(WHY.length).toBeGreaterThanOrEqual(5)
    for (const item of [...STEPS, ...SECURITY, ...WHY]) {
      expect(item.title.length).toBeGreaterThan(3)
      expect(item.text.length).toBeGreaterThan(20)
    }
  })
  test('no copy invents figures, rankings or audits', () => {
    const copy = [...FEATURES.map((f) => f.text), ...STEPS.map((s) => s.text), ...SECURITY.map((p) => p.text), ...WHY.map((p) => p.text)].join(' ')
    expect(copy.replace('5042', '')).not.toMatch(/\d/) // the only number allowed is Arc's chain ID
    expect(copy).not.toMatch(/audited by|certified|guaranteed|#1|best in|million|billion|instant(ly)? finality|zero fees|no fees/i)
  })
  test('footer links are https only, so a bad setting can never become a script link', () => {
    expect(httpsUrl('https://x.com/quickpay')).toBe('https://x.com/quickpay')
    expect(httpsUrl('  https://discord.gg/abc  ')).toBe('https://discord.gg/abc')
    expect(httpsUrl('http://insecure.example')).toBeUndefined()
    expect(httpsUrl('javascript:alert(1)')).toBeUndefined()
    expect(httpsUrl('data:text/html,<script>')).toBeUndefined()
    expect(httpsUrl('not a url')).toBeUndefined()
    expect(httpsUrl('')).toBeUndefined()
    expect(httpsUrl(undefined)).toBeUndefined()
  })
})

describe('official links', () => {
  test('the official X account is linked from the landing page footer', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync(new URL('../src/pages/Landing.tsx', import.meta.url), 'utf8')
    expect(page).toContain("'https://x.com/quickpayxyz'")
  })
})
