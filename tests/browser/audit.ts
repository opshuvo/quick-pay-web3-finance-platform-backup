/**
 * Real-browser audit of every route in both themes and two viewports.
 * Reports console errors, failed requests, layout shift, long tasks, horizontal overflow and page-ready time.
 * Run: bunx vite preview --port 4173 & bun tests/browser/audit.ts [baseUrl]
 */
import { chromium, type Page } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const ROUTES = (process.env.ROUTES ? process.env.ROUTES.split(',') : ['/', '/send', '/receive', '/scan', '/split', '/swap', '/bridge', '/history', '/requests', '/analytics', '/settings', '/contracts', '/profile'])
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
]
const THEMES = ['light', 'dark'] as const

interface Result { route: string; theme: string; vp: string; ready: number; cls: number; longTasks: number; longMs: number; overflow: boolean; errors: string[]; failed: string[] }
const results: Result[] = []

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __lt: number[] }
    w.__cls = 0
    w.__lt = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch { /* ignore */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(e.duration) }).observe({ type: 'longtask', buffered: true }) } catch { /* ignore */ }
  })
}

const browser = await chromium.launch({ args: ['--disable-gpu'] })
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor, colorScheme: theme })
    await ctx.addInitScript(() => { try { sessionStorage.setItem('qp-splash', '1') } catch { /* ignore */ } })
    for (const route of ROUTES) {
      const page = await ctx.newPage()
      await instrument(page)
      const errors: string[] = []
      const failed: string[] = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`) })
      page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url().slice(0, 100)} ${r.failure()?.errorText}`))
      page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/')) failed.push(`${r.status()} ${r.url().slice(0, 100)}`) })
      page.on('crash', () => errors.push('PAGE CRASH'))
      page.on('close', () => { if (process.env.DEBUG_AUDIT) console.log('closed', route) })
      const t0 = Date.now()
      await page.goto(`${BASE}${route}`, { waitUntil: 'load' })
      await page.waitForSelector('main, #main', { timeout: 15000 }).catch(() => undefined)
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
      const ready = Date.now() - t0
      await page.waitForTimeout(700)
      const m = await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __lt: number[] }
        return { cls: w.__cls, lt: w.__lt, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, theme: document.documentElement.dataset.theme }
      })
      if (m.theme !== theme) errors.push(`theme resolved to ${m.theme}, expected ${theme}`)
      results.push({ route, theme, vp: vp.name, ready, cls: Number(m.cls.toFixed(4)), longTasks: m.lt.length, longMs: Math.round(m.lt.reduce((a, b) => a + b, 0)), overflow: m.overflow, errors, failed })
      if (process.env.SHOTS) await page.screenshot({ path: `/tmp/shots/${vp.name}-${theme}-${route === '/' ? 'home' : route.slice(1)}.png` })
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()

let bad = 0
for (const r of results) {
  const flags = [r.overflow && 'OVERFLOW', r.cls > 0.02 && `CLS ${r.cls}`, r.errors.length && `${r.errors.length} errors`, r.failed.length && `${r.failed.length} failed`, r.longMs > 400 && `long ${r.longMs}ms`].filter(Boolean)
  if (flags.length) bad++
  console.log(`${r.vp.padEnd(7)} ${r.theme.padEnd(5)} ${r.route.padEnd(11)} ready ${String(r.ready).padStart(5)}ms  cls ${r.cls}  longtasks ${r.longTasks} (${r.longMs}ms)  ${flags.join(' | ')}`)
  for (const e of r.errors.slice(0, 3)) console.log(`      ${e}`)
  for (const f of r.failed.slice(0, 3)) console.log(`      ${f}`)
}
console.log(`\n${results.length} page loads, ${bad} with findings`)
