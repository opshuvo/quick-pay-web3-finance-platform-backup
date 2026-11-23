/**
 * Measures real text contrast on the rendered pages in both themes (WCAG 2.x ratios, computed from the pixels' CSS colours).
 * Run after `bunx vite preview --port 4173`. Uses the read-only wallet stand-in so connected screens are covered.
 */
import { chromium } from 'playwright-core'
import { installReadOnlyWallet } from './wallet-shim'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const ADDRESS = process.env.AUDIT_ADDRESS ?? '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const ROUTES = ['/', '/send', '/receive', '/scan', '/split', '/swap', '/bridge', '/history', '/requests', '/analytics', '/settings']

const browser = await chromium.launch({ args: ['--disable-gpu'] })
let total = 0
let bad = 0
for (const theme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme })
  await ctx.addInitScript(() => sessionStorage.setItem('qp-splash', '1'))
  await installReadOnlyWallet(ctx, ADDRESS)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /connect/i }).first().click()
  await page.getByText('Browser Wallet').first().click()
  await page.waitForTimeout(2200)
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const found = await page.evaluate(() => {
      type RGBA = [number, number, number, number]
      const parse = (c: string): RGBA => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
      const over = (top: RGBA, bottom: RGBA): RGBA => { const a = top[3] + bottom[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a) as RGBA }
      const lum = (c: RGBA) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const ratio = (a: RGBA, b: RGBA) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
      const bgOf = (el: Element): RGBA => {
        const chain: RGBA[] = []
        for (let n: Element | null = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) chain.push(c); if (c[3] === 1) break }
        let base: RGBA = [255, 255, 255, 1]
        const root = parse(getComputedStyle(document.documentElement).backgroundColor); if (root[3] > 0) base = root
        const body = parse(getComputedStyle(document.body).backgroundColor); if (body[3] > 0) base = over(body, base)
        for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base)
        return base
      }
      const issues: string[] = []
      let count = 0
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const seen = new Set<Element>()
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const el = t.parentElement
        if (!el || seen.has(el) || !t.textContent?.trim()) continue
        seen.add(el)
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
        if (el.closest('.sr-only, [aria-hidden="true"], script, style, [disabled]')) continue
        let fg = parse(cs.color)
        let bg = bgOf(el)
        // Text on a gradient is judged against its worst colour stop.
        let worstStop: RGBA | null = null
        for (let n: Element | null = el; n; n = n.parentElement) {
          const img = getComputedStyle(n).backgroundImage
          if (img.includes('gradient')) {
            const stops = [...img.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter((c) => c[3] === 1)
            if (stops.length >= 2) worstStop = stops.reduce((w, c) => (ratio(fg, c) < ratio(fg, w) ? c : w))
            break
          }
        }
        if (worstStop) bg = worstStop
        fg = over(fg, bg)
        const size = parseFloat(cs.fontSize)
        const bold = Number(cs.fontWeight) >= 700
        const large = size >= 24 || (size >= 18.66 && bold)
        const need = large ? 3 : 4.5
        const ratioV = ratio(fg, bg)
        count++
        if (ratioV < need) issues.push(`${ratioV.toFixed(2)} (<${need}) "${(t.textContent ?? '').trim().slice(0, 28)}" <${el.tagName.toLowerCase()}> ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')}) ${size}px`)
      }
      return { count, issues }
    })
    total += found.count
    bad += found.issues.length
    console.log(`${theme.padEnd(5)} ${route.padEnd(11)} ${String(found.count).padStart(3)} text items, ${found.issues.length} below WCAG AA`)
    for (const i of found.issues.slice(0, 6)) console.log('        ' + i)
  }
  await ctx.close()
}
await browser.close()
console.log(`\n${total} text items checked, ${bad} below AA`)
process.exit(bad ? 1 : 0)
