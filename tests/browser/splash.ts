/**
 * Launch-screen audit in a real browser: the sequence, its timing, how smooth it is on a phone, that it can be skipped,
 * shows once per session, and settles at once with reduced motion. Run after `bunx vite preview --port 4173`.
 */
import { chromium, type Page } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const fail: string[] = []
let passed = 0
const check = (ok: boolean, s: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (ok) passed++; else fail.push(s) }

const state = (page: Page) => page.evaluate(() => {
  const q = (s: string) => document.querySelector<HTMLElement>(s)
  const op = (s: string) => { const el = q(s); return el ? Number(getComputedStyle(el).opacity) : -1 }
  const line = q('.sp-line > span')
  const m = line ? new DOMMatrix(getComputedStyle(line).transform) : null
  return { present: Boolean(q('[data-testid="splash"]')), logo: op('.sp-logo'), glow: op('.sp-glow'), name: op('.sp-name'), clip: q('.sp-name') ? getComputedStyle(q('.sp-name') as HTMLElement).clipPath : '', tag: op('.sp-tag'), fill: m ? m.a : -1 }
})

const browser = await chromium.launch({ args: ['--disable-gpu'] })

// Phone, first visit.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
  // Frame pacing across the whole launch.
  await page.addInitScript(() => {
    const w = window as unknown as { __gaps: number[] }
    w.__gaps = []
    let last = performance.now()
    const tick = (now: number) => { w.__gaps.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await page.goto(`${BASE}/`, { waitUntil: 'commit' })
  await page.waitForSelector('[data-testid="splash"]', { timeout: 5000 })
  const start = Date.now()
  await page.waitForTimeout(450)
  const early = await state(page)
  check(early.present && early.logo > 0 && early.logo < 1.01 && early.name < 0.5 && early.tag < 0.2, `0.45s: the mark is appearing, wordmark and tagline not yet (logo ${early.logo.toFixed(2)}, name ${early.name.toFixed(2)}, tagline ${early.tag.toFixed(2)})`)
  await page.waitForTimeout(1950 - (Date.now() - start) + 0)
  const mid = await state(page)
  check(mid.name > 0.9 && mid.tag > 0.9 && mid.glow > 0.3, `2.0s: wordmark and tagline are revealed and the glow is up (name ${mid.name.toFixed(2)}, tagline ${mid.tag.toFixed(2)}, glow ${mid.glow.toFixed(2)})`)
  check(mid.fill > 0.4 && mid.fill < 1, `2.0s: the loading line is part-way (${(mid.fill * 100).toFixed(0)}%)`)
  const text = await page.evaluate(() => document.querySelector('[data-testid="splash"]')?.textContent ?? '')
  check(/QuickPay/.test(text) && /USDC payments on Arc/i.test(text), `the splash reads "${text.replace(/\s+/g, ' ').trim()}"`)
  check((await page.locator('.sp-logo svg .qp-arch').count()) === 2 && (await page.locator('.sp-logo svg .qp-node').count()) === 1, 'the mark shows the Circle ring, the two Arc arches and the payment node')
  const orbit = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.splash .orbit-ring, .splash .orbit-wave, .splash .orbit-flow, .sp-wave')].filter((e) => getComputedStyle(e).animationName !== 'none' && getComputedStyle(e).display !== 'none').length)
  check(orbit >= 5, `orbital rings, ripples and light waves are animating (${orbit} layers)`)
  await page.waitForTimeout(4100 - (Date.now() - start))
  check(!(await state(page)).present, 'the splash has left by 4s and the app is underneath')
  check((await page.locator('main').count()) > 0, 'the app finished loading behind it')
  const pace = await page.evaluate(() => { const g = (window as unknown as { __gaps: number[] }).__gaps.slice(5); return { worst: Math.max(...g), slow: g.filter((x) => x > 34).length, frames: g.length } })
  check(pace.worst < 120 && pace.slow <= 12, `launch pacing on a phone with no GPU: worst frame ${pace.worst.toFixed(0)}ms, ${pace.slow} slow of ${pace.frames}`)
  await page.reload({ waitUntil: 'networkidle' })
  check(!(await state(page)).present, 'a second load in the same session skips the splash')
  check(errors.length === 0, `no console or page errors (${errors.length})`)
  await ctx.close()
}

// Tap to skip.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'commit' })
  await page.waitForSelector('[data-testid="splash"]', { timeout: 5000 })
  await page.waitForTimeout(600)
  await page.locator('[data-testid="splash"]').click({ position: { x: 150, y: 300 } })
  await page.waitForTimeout(100)
  check(!(await state(page)).present, 'tapping the splash skips it at once')
  await ctx.close()
}

// Reduced motion: the finished frame at once, gone quickly.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'commit' })
  await page.waitForSelector('[data-testid="splash"]', { timeout: 5000 })
  await page.waitForTimeout(250)
  const s = await state(page)
  check(s.name > 0.95 && s.tag > 0.95, `reduced motion shows the finished frame straight away (name ${s.name.toFixed(2)}, tagline ${s.tag.toFixed(2)})`)
  await page.waitForTimeout(1300)
  check(!(await state(page)).present, 'reduced motion leaves within about a second')
  await ctx.close()
}

// Dark device preference: same navy launch screen.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'commit' })
  await page.waitForSelector('[data-testid="splash"]', { timeout: 5000 })
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="splash"]') as Element).backgroundImage.slice(0, 40))
  check(bg.startsWith('radial-gradient'), `desktop dark: deep navy radial background (${bg})`)
  await ctx.close()
}
await browser.close()
console.log(`\n${passed} passed, ${fail.length} failed`)
process.exit(fail.length ? 1 : 0)
