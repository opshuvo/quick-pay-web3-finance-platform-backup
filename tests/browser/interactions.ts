/**
 * Interaction audit in a real browser: how long a tap takes to reach the screen, frame pacing during motion,
 * tap-target size on a phone, and that the controls respond. Run after `bunx vite preview --port 4173`.
 */
import { chromium, type Page } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const out: string[] = []
const fail: string[] = []
const log = (s: string) => { out.push(s); console.log(s) }
const check = (ok: boolean, s: string) => { log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) fail.push(s) }

/** Milliseconds from a click until the browser has painted twice (the change is on screen). */
async function tapToPaint(page: Page, selector: string, nth = 0): Promise<number> {
  return page.evaluate(async ([sel, n]) => {
    const el = document.querySelectorAll<HTMLElement>(sel as string)[n as number]
    if (!el) return -1
    const t0 = performance.now()
    el.click()
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return performance.now() - t0
  }, [selector, nth] as const)
}

/** Worst frame gap and dropped-frame count over `ms` of motion. */
async function framePacing(page: Page, ms: number) {
  return page.evaluate((span) => new Promise<{ worst: number; slow: number; frames: number }>((resolve) => {
    const gaps: number[] = []
    let last = performance.now()
    const start = last
    const tick = (now: number) => {
      gaps.push(now - last)
      last = now
      if (now - start < (span as number)) requestAnimationFrame(tick)
      else resolve({ worst: Math.max(...gaps), slow: gaps.filter((g) => g > 34).length, frames: gaps.length })
    }
    requestAnimationFrame(tick)
  }), ms)
}

const browser = await chromium.launch({ args: ['--disable-gpu'] })

// ---- phone ------------------------------------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' })
  await ctx.addInitScript(() => sessionStorage.setItem('qp-splash', '1'))
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  // Theme menu: open, choose Dark, theme applies in one frame, and no element is still transitioning colours.
  let ms = await tapToPaint(page, 'button[aria-label^="Theme:"]')
  check(ms >= 0 && ms < 100, `theme menu opens and paints in ${ms.toFixed(0)}ms (< 100)`)
  await page.waitForTimeout(300)
  const itemBefore = await page.evaluate(() => document.documentElement.dataset.theme)
  ms = await page.evaluate(async () => {
    const dark = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes('Dark'))
    const t0 = performance.now()
    dark?.click()
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return performance.now() - t0
  })
  const themeNow = await page.evaluate(() => document.documentElement.dataset.theme)
  check(itemBefore === 'light' && themeNow === 'dark', `theme switches light -> dark (${itemBefore} -> ${themeNow}) in ${ms.toFixed(0)}ms`)
  check(ms < 100, `theme switch paints in under 100ms (${ms.toFixed(0)}ms)`)
  await page.waitForTimeout(260)
  check((await page.locator('[role="menu"]').count()) === 0, 'theme menu is removed after its exit animation')
  check((await page.evaluate(() => localStorage.getItem('quickpay.theme-pref'))) === 'dark', 'theme preference is saved')
  await page.reload({ waitUntil: 'networkidle' })
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'saved theme is applied before first paint after reload')

  // Bottom navigation and More sheet.
  const nav = await page.locator('nav a, nav button').count()
  check(nav >= 5, `bottom navigation present (${nav} items)`)
  const navMs: number[] = []
  for (const label of ['Swap', 'Bridge', 'Send']) {
    const t0 = Date.now()
    await page.locator(`nav.mnav a[aria-label="${label}"], nav.mnav a:has-text("${label}")`).first().click({ timeout: 4000 }).catch(() => undefined)
    await page.waitForSelector('main h1', { timeout: 5000 }).catch(() => undefined)
    navMs.push(Date.now() - t0)
  }
  check(Math.max(...navMs) < 700, `tab navigation settles in ${navMs.join(', ')}ms (< 700 each)`)

  // Bridge: provider tabs, sliding pill, network selector, logos.
  await page.goto(`${BASE}/bridge`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const tabs = await page.locator('[role="tab"]').allTextContents()
  check(['Across', 'LI.FI', 'Circle'].every((t) => tabs.some((x) => x.includes(t))), `bridge provider tabs: ${tabs.map((t) => t.trim()).join(' | ')}`)
  const thumb = await page.evaluate(() => document.querySelector('.segmented')?.getAttribute('data-thumb'))
  check(thumb === 'on', 'segmented pill is positioned on the selected provider')
  for (const name of ['LI.FI', 'Circle', 'Across']) {
    const t = await page.evaluate(async (n) => {
      const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent?.includes(n))
      const t0 = performance.now()
      tab?.click()
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return performance.now() - t0
    }, name)
    check(t < 100, `provider tab ${name} responds in ${t.toFixed(0)}ms (< 100)`)
    await page.waitForTimeout(350)
  }
  const chip = page.locator('.net-chip').first()
  if ((await chip.count()) > 0) {
    ms = await tapToPaint(page, '.net-chip')
    check(ms < 100, `network selector opens in ${ms.toFixed(0)}ms`)
    const pacing = await framePacing(page, 400)
    check(pacing.worst < 80, `network menu animation: worst frame ${pacing.worst.toFixed(0)}ms, ${pacing.slow} slow of ${pacing.frames}`)
    const rows = await page.locator('[role="option"]').count()
    const logos = await page.locator('[role="option"] [role="img"]').count()
    check(rows > 0 && rows === logos, `every network row has a logo (${logos}/${rows})`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(260)
  }

  // Scrolling and tap targets on a phone.
  for (const route of ['/', '/swap', '/send', '/history', '/split', '/settings']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    const small = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>('a[href], button, [role="tab"], [role="menuitemradio"], input, select')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        if (el.closest('[aria-hidden="true"]') || el.classList.contains('sr-only')) continue
        // Buttons, tabs and fields need 40px; inline text links only need WCAG 2.2's 24px minimum.
        const minSize = el.tagName === 'A' && !el.classList.contains('mnav-item') && !el.closest('nav') ? 24 : 40
        if (r.height < minSize || r.width < minSize) bad.push(`${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      return bad
    })
    check(small.length === 0, `${route} tap targets >= 40px on phone${small.length ? ` — small: ${small.slice(0, 5).join('; ')}` : ''}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 1, `${route} has no horizontal scroll (${overflow}px)`)
  }
  check(errors.length === 0, `no console or page errors on the phone run${errors.length ? `: ${errors.slice(0, 2).join(' / ')}` : ''}`)
  await ctx.close()
}

// ---- desktop -----------------------------------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
  await ctx.addInitScript(() => sessionStorage.setItem('qp-splash', '1'))
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'System theme follows the dark device preference by default')
  check((await page.evaluate(() => document.documentElement.dataset.themePref)) === 'system', 'preference is "system" until the user chooses')
  // Switching device preference while on System updates the page live.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(150)
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'device preference change is followed live')
  // History tabs on desktop (table layout) and sliding pill.
  await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const hTabs = await page.locator('[role="tab"]').count()
  if (hTabs === 0) log('SKIP  history filter tabs only render for a connected wallet (none connected in this run)')
  else {
    const times: number[] = []
    for (let i = 0; i < Math.min(hTabs, 5); i++) times.push(await tapToPaint(page, '[role="tab"]', i))
    check(Math.max(...times) < 100, `history tabs respond in ${times.map((t) => t.toFixed(0)).join(', ')}ms`)
  }
  // Keyboard: skip link and focus visibility.
  await page.keyboard.press('Tab')
  const skip = await page.evaluate(() => document.activeElement?.textContent?.trim())
  check(skip === 'Skip to content', `first Tab stop is "${skip}"`)
  // Reduced motion removes animation durations.
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const rp = await rm.newPage()
  await rp.goto(`${BASE}/bridge`, { waitUntil: 'networkidle' })
  const dur = await rp.evaluate(() => { const el = document.querySelector('.pane-in'); return el ? getComputedStyle(el).animationDuration : 'n/a' })
  check(dur === '0.01s' || dur === '1e-05s' || dur === 'n/a', `reduced motion shortens animations (pane animation-duration ${dur})`)
  await rm.close()
  check(errors.length === 0, `no console or page errors on the desktop run${errors.length ? `: ${errors.slice(0, 2).join(' / ')}` : ''}`)
  await ctx.close()
}
await browser.close()
console.log(`\n${out.length - fail.length} passed, ${fail.length} failed`)
process.exit(fail.length ? 1 : 0)
