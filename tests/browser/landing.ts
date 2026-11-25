/**
 * Browser checks for the landing page and its hand-off to the dashboard.
 * The wallet stand-in is read-only (it rejects every signature and transaction). Run after `bunx vite preview --port 4173`.
 */
import { chromium } from 'playwright-core'
import { installReadOnlyWallet } from './wallet-shim'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const ADDRESS = process.env.AUDIT_ADDRESS ?? '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const USDC = '0x3600000000000000000000000000000000000000'

let passed = 0
const failed: string[] = []
const check = (ok: boolean, s: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`)
  if (ok) passed++
  else failed.push(s)
}

const VIEWS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 820, height: 1100, mobile: false },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
]

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
try {
  // Content, honesty and layout on every screen size, signed out.
  for (const view of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, isMobile: view.mobile, hasTouch: view.mobile, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await ctx.addInitScript(() => sessionStorage.setItem('quickpay.splash.v1', '1'))
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    const tag = view.name
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)

    check((await page.locator('h1').innerText()).includes('USDC payments'), `${tag}: the landing page is shown before a wallet is connected`)
    check((await page.locator('.ln').getAttribute('data-theme')) === 'dark', `${tag}: the landing page is dark whatever the app theme is`)
    const features = await page.locator('#features h3').allInnerTexts()
    check(['Send', 'Receive', 'Scan & Pay', 'Split Payment', 'Request Pay', 'Swap', 'Bridge', 'Transaction History'].every((f) => features.includes(f)), `${tag}: all eight feature cards are present (${features.length})`)
    check((await page.locator('#how ol > li').count()) === 4, `${tag}: how it works has four steps`)
    check((await page.locator('#security').innerText()).includes('Arc Mainnet') && (await page.locator('#why li').count()) === 6, `${tag}: the security and why sections are present`)
    const usdcHref = await page.locator('#security a.ln-contract-link').getAttribute('href')
    check(usdcHref?.toLowerCase().endsWith(`/address/${USDC}`) ?? false, `${tag}: the USDC address links to its real explorer page`)
    check((await page.locator('#security').innerText()).includes('not had an independent security audit'), `${tag}: it says plainly that no independent audit has been done`)
    check((await page.locator('footer a[href="https://quickpay.boats"]').count()) === 1 && (await page.locator('footer a[href*="github.com"]').count()) === 1, `${tag}: the footer links the website and GitHub`)
    const hrefs = await page.locator('a[href^="http"]').evaluateAll((els) => els.map((e) => ({ href: (e as HTMLAnchorElement).href, rel: (e as HTMLAnchorElement).rel })))
    check(hrefs.every((h) => h.href.startsWith('https://') && h.rel.includes('noopener')), `${tag}: every external link is https and opens safely (${hrefs.length})`)

    // No invented figures: the only numbers allowed are the chain ID, the live block, the step numbers and the year.
    const text = (await page.locator('.ln').innerText()).replace(/0x[0-9a-fA-F…]+/g, '')
    const numbers = [...text.matchAll(/\d[\d,.]*/g)].map((m) => m[0]).filter((n) => !/^(0x|[1-4]$|5042$|\d{4}$)/.test(n) && !/^\d{1,3}(,\d{3})+$/.test(n))
    check(numbers.length === 0, `${tag}: no made-up figures appear (${numbers.slice(0, 5).join(' ') || 'none'})`)
    const live = await page.locator('.ln-live').innerText()
    if (/block/.test(live)) {
      const shown = Number(live.match(/block ([\d,]+)/)?.[1]?.replace(/,/g, ''))
      const rpc = await (await fetch('https://rpc.mainnet.arc.io/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })).json() as { result: string }
      const head = Number(BigInt(rpc.result))
      check(Math.abs(head - shown) < 300, `${tag}: the live block (${shown}) is Arc's real head (${head})`)
    } else check(false, `${tag}: the live block did not load (${live})`)

    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal scrolling`)
    const small = await page.locator('.ln a, .ln button').evaluateAll((els) => els.filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 36 && !(e as HTMLElement).closest('footer') && !(e as HTMLElement).closest('.ln-contract') }).map((e) => `${(e as HTMLElement).innerText.slice(0, 20)}:${Math.round((e as HTMLElement).getBoundingClientRect().height)}`))
    check(small.length === 0, `${tag}: buttons and links are comfortable to tap (${small.join(', ') || 'all ≥ 36px'})`)
    check(errors.length === 0, `${tag}: no console or page errors (${errors.length}${errors[0] ? ': ' + errors[0].slice(0, 80) : ''})`)

    // Scroll through the whole page: every section reveals and the frames stay smooth.
    const pacing = await page.evaluate(async () => {
      const times: number[] = []
      let last = performance.now()
      let running = true
      const tick = (t: number) => { times.push(t - last); last = t; if (running) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      const height = document.documentElement.scrollHeight
      for (let y = 0; y <= height; y += 140) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 16)) }
      running = false
      return { worst: Math.max(...times), slow: times.filter((t) => t > 50).length, frames: times.length }
    })
    check(pacing.worst < 120 && pacing.slow <= Math.ceil(pacing.frames * 0.05), `${tag}: scrolling the page stays smooth (worst ${pacing.worst.toFixed(0)}ms, ${pacing.slow} slow of ${pacing.frames})`)
    await page.waitForTimeout(700)
    const hidden = await page.locator('[data-reveal]:not([data-in])').count()
    check(hidden === 0, `${tag}: every section is revealed after scrolling (${hidden} hidden)`)
    await ctx.close()
  }

  // Reduced motion shows everything at once.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await ctx.addInitScript(() => sessionStorage.setItem('quickpay.splash.v1', '1'))
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    check((await page.locator('[data-reveal]:not([data-in])').count()) === 0, 'reduced motion: every section is visible without scrolling')
    await ctx.close()
  }

  // Keyboard: the skip link is first, and the page can be used without a mouse.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(() => sessionStorage.setItem('quickpay.splash.v1', '1'))
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.keyboard.press('Tab')
    check((await page.evaluate(() => document.activeElement?.textContent ?? '')).includes('Skip to content'), 'keyboard: the first tab stop is "Skip to content"')
    await page.getByRole('link', { name: 'How it works' }).first().click()
    await page.waitForTimeout(400)
    check(page.url().endsWith('#how'), 'anchor links move to their section')
    await ctx.close()
  }

  // Deep links are never hijacked, and Connect opens the existing wallet flow and then the dashboard.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(() => sessionStorage.setItem('quickpay.splash.v1', '1'))
    await installReadOnlyWallet(ctx, ADDRESS, 'https://rpc.mainnet.arc.io/')
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/send`, { waitUntil: 'networkidle' })
    check((await page.locator('.ln').count()) === 0 && /Send/.test(await page.locator('h1').first().innerText()), 'deep links such as /send open the app, not the landing page')
    await page.goto(`${BASE}/pay/abcdefghjkmnpqrs`, { waitUntil: 'networkidle' })
    check((await page.locator('.ln').count()) === 0, 'a shared payment link opens the app, not the landing page')

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /connect wallet/i }).first().click()
    check(await page.getByText('Browser Wallet', { exact: true }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'Connect wallet opens the existing wallet picker')
    await page.getByText('Browser Wallet', { exact: true }).first().click()
    const overlay = await page.waitForSelector('.ln-exit', { timeout: 15000 }).then(() => true).catch(() => false)
    check(overlay, 'the landing page fades out above the dashboard instead of cutting')
    await page.waitForFunction(() => /0x26.{1,4}4968/i.test(document.body.innerText), undefined, { timeout: 15000 }).catch(() => undefined)
    await page.waitForTimeout(900)
    check((await page.locator('.ln').count()) === 0, 'after the fade the landing page is gone')
    check(/Available balance/.test(await page.locator('body').innerText()) && new URL(page.url()).pathname === '/', 'after connecting, the existing dashboard opens at the same address')

    // A reconnect on reload goes straight to the dashboard, with no landing flash.
    await page.addInitScript(() => {
      ;(window as unknown as { __sawLanding: boolean }).__sawLanding = false
      new MutationObserver(() => { if (document.querySelector('.ln')) (window as unknown as { __sawLanding: boolean }).__sawLanding = true }).observe(document, { childList: true, subtree: true })
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    check(!(await page.evaluate(() => (window as unknown as { __sawLanding: boolean }).__sawLanding)), 'reloading while connected never flashes the landing page')
    check(/Available balance/.test(await page.locator('body').innerText()), 'the dashboard returns on reload')
    check(errors.length === 0, `no page errors during the hand-off (${errors.length})`)
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
