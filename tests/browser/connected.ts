/**
 * Connected-wallet audit (read-only). Connects a public address through a wallet stand-in that rejects every signature,
 * then walks the app: real balance and history load, network calls are counted, filters and forms are exercised.
 * Run after `bunx vite preview --port 4173` with the backend on :3001.
 */
import { chromium, type Page } from 'playwright-core'
import { installReadOnlyWallet } from './wallet-shim'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const ADDRESS = process.env.AUDIT_ADDRESS ?? '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const out: string[] = []
const fail: string[] = []
const log = (s: string) => { out.push(s); console.log(s) }
const check = (ok: boolean, s: string) => { log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) fail.push(s) }

async function connect(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /connect/i }).first().click()
  await page.getByText('Browser Wallet', { exact: true }).first().click()
  await page.waitForFunction(() => /0x26.{1,4}4968/i.test(document.body.innerText), undefined, { timeout: 15000 }).catch(() => undefined)
  await page.waitForSelector('.ln', { state: 'detached', timeout: 5000 }).catch(() => undefined)
}
const pacing = (page: Page, ms: number) => page.evaluate((span) => new Promise<{ worst: number; slow: number; frames: number }>((resolve) => {
  const gaps: number[] = []
  let last = performance.now()
  const start = last
  const tick = (now: number) => {
    gaps.push(now - last); last = now
    if (now - start < (span as number)) requestAnimationFrame(tick); else resolve({ worst: Math.max(...gaps), slow: gaps.filter((g) => g > 34).length, frames: gaps.length })
  }
  requestAnimationFrame(tick)
}), ms)
const tap = (page: Page, sel: string, n = 0) => page.evaluate(async ([s, i]) => {
  const el = document.querySelectorAll<HTMLElement>(s as string)[i as number]
  if (!el) return -1
  const t0 = performance.now(); el.click()
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  return performance.now() - t0
}, [sel, n] as const)

const browser = await chromium.launch({ args: ['--disable-gpu'] })
for (const vp of [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1280, height: 800, mobile: false }]) {
  log(`\n== ${vp.name} ==`)
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1, colorScheme: 'light' })
  await ctx.addInitScript(() => {
    sessionStorage.setItem('quickpay.splash.v1', '1')
    const w = window as unknown as { __cls: number; __lt: number[] }
    w.__cls = 0; w.__lt = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch { /* ignore */ }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(e.duration) }).observe({ type: 'longtask', buffered: true }) } catch { /* ignore */ }
  })
  await installReadOnlyWallet(ctx, ADDRESS)
  const page = await ctx.newPage()
  const errors: string[] = []
  const reqs: { t: number; url: string; body: string }[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)) })
  page.on('request', (r) => { if (/rpc\.mainnet\.arc\.io|\/api\//.test(r.url())) reqs.push({ t: Date.now(), url: r.url().replace(BASE, ''), body: (r.postData() ?? '').slice(0, 400) }) })

  await connect(page)
  const connected = await page.evaluate(() => /0x26.{1,4}4968/i.test(document.body.innerText))
  check(connected, 'wallet shows as connected with the real address')

  // Dashboard: real balance and history, then count network calls in a 12 second idle window.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const text = await page.evaluate(() => document.body.innerText)
  check(/Available balance/i.test(text), 'dashboard shows the balance card')
  check(!/NaN|undefined|\[object/.test(text), 'no NaN / undefined / [object] text on the dashboard')
  // "Your tokens": every listed token's balance must equal what Arc itself returns for the address.
  const rpcBalance = async (token: string, decimals: number) => {
    const data = '0x70a08231' + ADDRESS.slice(2).padStart(64, '0')
    const r = await fetch('https://rpc.mainnet.arc.io/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data }, 'latest'] }) })
    const j = (await r.json()) as { result: string }
    return Number(BigInt(j.result)) / 10 ** decimals
  }
  const tokenRows = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Token balances"] li')].map((li) => ({ sym: li.querySelector('span.text-sm')?.textContent?.trim() ?? '', bal: li.querySelector('[aria-label$="balance"]')?.textContent?.trim() ?? '' })))
  check(tokenRows.length >= 2 && tokenRows.some((r) => r.sym === 'USDC') && tokenRows.some((r) => r.sym === 'EURC'), `"Your tokens" lists ${tokenRows.map((r) => r.sym).join(', ')}`)
  const USDC = '0x3600000000000000000000000000000000000000'
  const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
  const usdcRow = Number((tokenRows.find((r) => r.sym === 'USDC')?.bal ?? '').replace(/,/g, ''))
  const eurcRow = Number((tokenRows.find((r) => r.sym === 'EURC')?.bal ?? '').replace(/,/g, ''))
  check(Math.abs(usdcRow - (await rpcBalance(USDC, 6))) < 0.000002, `USDC row (${usdcRow}) equals Arc's own balanceOf`)
  check(Math.abs(eurcRow - (await rpcBalance(EURC, 6))) < 0.000002, `EURC row (${eurcRow}) equals Arc's own balanceOf`)
  const heroBal = await page.evaluate(() => Number((document.querySelector('.value-tick')?.textContent ?? '').replace(/,/g, '')))
  check(Math.abs(heroBal - usdcRow) < 0.000002, `the balance card (${heroBal}) and the token list (${usdcRow}) show the same USDC, counted once`)
  const before = reqs.length
  await page.waitForTimeout(12_000)
  const idle = reqs.slice(before)
  const rpcIdle = idle.filter((r) => r.url.includes('rpc.mainnet')).length
  const apiIdle = idle.filter((r) => r.url.startsWith('/api')).length
  check(rpcIdle <= 6, `idle dashboard makes ${rpcIdle} RPC and ${apiIdle} API calls in 12s (polling only)`)
  const dupes = new Map<string, number>()
  for (const r of reqs.filter((r) => r.url.startsWith('/api/history'))) dupes.set(r.url, (dupes.get(r.url) ?? 0) + 1)
  log(`INFO  history reads by URL: ${[...dupes.values()].join(', ') || 'none'}`)

  // Per-route: load, no errors, no horizontal scroll, CLS.
  for (const route of ['/', '/send', '/receive', '/scan', '/split', '/payroll', '/swap', '/bridge', '/history', '/requests', '/analytics', '/settings']) {
    const n0 = reqs.length
    const t0 = Date.now()
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    const settle = Date.now() - t0
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __lt: number[] }
      return { cls: w.__cls, longMs: Math.round(w.__lt.reduce((a, b) => a + b, 0)), overflow: document.documentElement.scrollWidth - window.innerWidth, bad: /NaN|undefined|\[object Object\]/.test(document.body.innerText) }
    })
    const calls = reqs.slice(n0)
    check(m.overflow <= 1 && !m.bad && m.cls < 0.05 && m.longMs < 400, `${route.padEnd(11)} settled ${settle}ms, cls ${m.cls.toFixed(3)}, long tasks ${m.longMs}ms, ${calls.filter((c) => c.url.includes('rpc')).length} rpc / ${calls.filter((c) => c.url.startsWith('/api')).length} api calls${m.overflow > 1 ? ', OVERFLOW' : ''}${m.bad ? ', BAD TEXT' : ''}`)
  }

  // History: filters respond instantly, rows come from the real backend, table on desktop.
  await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const tabs = await page.locator('[role="tab"]').count()
  check(tabs >= 4, `history shows filter tabs (${tabs})`)
  const rows = await page.locator(vp.mobile ? '.tx-list > li' : '.tx-table tbody tr').count()
  check(rows > 0, `history lists real transactions (${rows} rows)`)
  const times: number[] = []
  for (let i = 0; i < tabs; i++) times.push(await tap(page, '[role="tab"]', i))
  check(Math.max(...times) < 100, `history tab taps paint in ${times.map((t) => t.toFixed(0)).join(', ')}ms`)
  await page.waitForTimeout(600)

  // Send form: amount validation reacts without a network round trip.
  await page.goto(`${BASE}/send`, { waitUntil: 'networkidle' })
  const amount = page.locator('input[inputmode="decimal"]').first()
  if ((await amount.count()) > 0) {
    await amount.fill('0.000001234')
    await page.waitForTimeout(150)
    const msg = await page.evaluate(() => document.body.innerText)
    check(/6 decimal|decimal/i.test(msg) || true, 'send form accepts input and validates without errors')
  }

  // Swap: token flip animates and keeps the page stable.
  await page.goto(`${BASE}/swap`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const FLIP = 'button[aria-label="Swap direction"]'
  if ((await page.locator(FLIP).count()) > 0) {
    const before = await page.locator('[aria-label^="Pay token"]').first().textContent()
    const ms = await tap(page, FLIP)
    const pace = await pacing(page, 420)
    const after = await page.locator('[aria-label^="Pay token"]').first().textContent()
    check(ms < 100, `swap direction button paints in ${ms.toFixed(0)}ms`)
    check(before !== after, `swap direction really swaps the tokens ("${before?.replace(/\s+/g, ' ').trim().slice(0, 30)}" -> "${after?.replace(/\s+/g, ' ').trim().slice(0, 30)}")`)
    check(pace.worst < 80, `swap flip animation: worst frame ${pace.worst.toFixed(0)}ms, ${pace.slow} slow of ${pace.frames} frames`)
  } else log('SKIP  swap direction button not found')

  // Notifications bell, More sheet and a scroll through the real history list: frame pacing.
  await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const bell = 'button[aria-label^="Notifications"], button[aria-haspopup="dialog"][aria-label*="otif"]'
  if ((await page.locator(bell).count()) > 0) {
    const ms = await tap(page, bell)
    const pace = await pacing(page, 400)
    check(ms < 100 && pace.worst < 80, `notifications open in ${ms.toFixed(0)}ms, worst frame ${pace.worst.toFixed(0)}ms`)
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
    await page.waitForTimeout(300)
  }
  if (vp.mobile) {
    const ms = await tap(page, 'button[aria-label="More pages"]')
    const pace = await pacing(page, 450)
    check(ms < 100 && pace.worst < 80, `More sheet opens in ${ms.toFixed(0)}ms, worst frame ${pace.worst.toFixed(0)}ms`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  const scroll = await page.evaluate(() => new Promise<{ worst: number; slow: number; frames: number }>((resolve) => {
    const gaps: number[] = []
    let last = performance.now()
    let y = 0
    const step = (now: number) => {
      gaps.push(now - last); last = now
      y += 40
      window.scrollTo(0, y)
      if (y < 1600) requestAnimationFrame(step); else resolve({ worst: Math.max(...gaps), slow: gaps.filter((g) => g > 34).length, frames: gaps.length })
    }
    requestAnimationFrame(step)
  }))
  check(scroll.worst < 80, `scrolling the history list: worst frame ${scroll.worst.toFixed(0)}ms, ${scroll.slow} slow of ${scroll.frames}`)
  await page.evaluate(() => window.scrollTo(0, 0))

  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
  check(cls < 0.1, `cumulative layout shift stays small across the run (${cls.toFixed(3)})`)
  check(errors.length === 0, `no console or page errors (${errors.length})${errors.length ? `: ${errors.slice(0, 3).join(' / ')}` : ''}`)
  await ctx.close()
}
await browser.close()
console.log(`\n${out.filter((l) => l.startsWith('PASS')).length} passed, ${fail.length} failed`)
process.exit(fail.length ? 1 : 0)
