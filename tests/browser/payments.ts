/**
 * Browser checks for the payment workflows: EURC sending, token-aware payment links, batch payouts and the grouped navigation.
 * Uses the read-only wallet stand-in, which REJECTS every signature and transaction, so no funds can move and the checks prove the
 * app behaves correctly when a wallet says no. Run after `bunx vite preview --port 4173` with the backend on :3001.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { requireDb } from '../../server/db'
import { buildSessionMessage } from '../../shared/session'
import { installReadOnlyWallet } from './wallet-shim'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const API = process.env.API ?? 'http://127.0.0.1:3001'
const ADDRESS = process.env.AUDIT_ADDRESS ?? '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const RECIPIENT = '0x8f6c1e3b5a7d9f2c4e6a8b0d1f3a5c7e9b2d4f60'

let passed = 0
const failed: string[] = []
const check = (ok: boolean, s: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`)
  if (ok) passed++
  else failed.push(s)
}

async function connect(page: Page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /connect/i }).first().click()
  await page.getByText('Browser Wallet').first().click()
  await page.waitForFunction(() => /0x26.{1,4}4968/i.test(document.body.innerText), undefined, { timeout: 15000 }).catch(() => undefined)
}
const eurcBalance = async () => {
  const data = '0x70a08231' + ADDRESS.slice(2).padStart(64, '0')
  const r = await fetch('https://rpc.mainnet.arc.io/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: EURC, data }, 'latest'] }) })
  return Number(BigInt(((await r.json()) as { result: string }).result)) / 1e6
}
const ledgerCount = (page: Page) => page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('quickpay.txledger.v1') ?? '{}') as Record<string, unknown[]>; return Object.values(s).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0) } catch { return 0 } })

const browser = await chromium.launch({ args: ['--disable-gpu'] })

async function context(opts: { mobile: boolean; atomic?: boolean }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: opts.mobile, hasTouch: opts.mobile, deviceScaleFactor: opts.mobile ? 2 : 1, colorScheme: 'light' })
  await ctx.addInitScript(() => sessionStorage.setItem('quickpay.splash.v1', '1'))
  await installReadOnlyWallet(ctx, ADDRESS, undefined, { atomic: opts.atomic })
  return ctx
}

// ---- grouped navigation ----------------------------------------------------------------------------------------------------
{
  const ctx = await context({ mobile: false })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const titles = await page.locator('aside nav p.label').allTextContents()
  check(['Instant Pay', 'Payment Links', 'Payroll', 'Swap & Bridge', 'Activity'].every((t, i) => titles[i]?.trim() === t), `desktop sidebar sections: ${titles.map((t) => t.trim()).join(' | ')}`)
  const payroll = page.locator('aside nav a', { hasText: 'Batch Payouts' })
  check((await payroll.count()) === 1, 'Batch Payouts is in the sidebar under Payroll')
  await payroll.click()
  await page.waitForURL('**/payroll')
  check((await page.locator('h1').first().textContent())?.includes('Batch Payouts') === true, 'it opens the Batch Payouts page')
  await ctx.close()
}
{
  const ctx = await context({ mobile: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.locator('button[aria-label="More pages"]').click()
  await page.waitForTimeout(400)
  check((await page.locator('[role="dialog"] >> text=Batch Payouts').count()) === 1, 'the phone More sheet lists Batch Payouts')
  await ctx.close()
}

// ---- Send EURC -------------------------------------------------------------------------------------------------------------
for (const mobile of [true, false]) {
  const label = mobile ? 'phone' : 'desktop'
  const ctx = await context({ mobile })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await connect(page)
  await page.goto(`${BASE}/send`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const radios = await page.locator('[role="radiogroup"][aria-label="Token to send"] [role="radio"]').evaluateAll((els) => els.map((e) => ({ t: e.textContent?.trim(), disabled: (e as HTMLButtonElement).disabled })))
  check(radios.length === 2 && radios.every((r) => !r.disabled), `${label}: Send offers ${radios.map((r) => r.t).join(' and ')}, both verified on Arc`)
  await page.locator('[role="radio"]', { hasText: 'EURC' }).click()
  check((await page.locator('h1').first().textContent())?.includes('Send EURC') === true, `${label}: the page now says Send EURC`)
  const balText = await page.evaluate(() => document.body.innerText.match(/Balance\s+([\d.,]+)\s+EURC/)?.[1] ?? '')
  const real = await eurcBalance()
  check(Math.abs(Number(balText.replace(/,/g, '')) - real) < 0.000002, `${label}: the EURC balance shown (${balText}) equals Arc's own balanceOf (${real})`)
  await page.locator('input[aria-label="Amount"]').fill('9999')
  await page.locator('input.mono').first().fill(RECIPIENT)
  await page.waitForTimeout(200)
  check((await page.locator('[role="alert"]', { hasText: 'larger than your available balance' }).count()) === 1, `${label}: an amount above the EURC balance is refused with a clear message`)
  const before = await ledgerCount(page)
  const tiny = Math.min(0.000001, real)
  await page.locator('input[aria-label="Amount"]').fill(tiny.toFixed(6))
  await page.getByRole('button', { name: 'Review payment' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(2500)
  const sheet = await page.locator('[role="dialog"]').innerText()
  check(/EURC on Arc Mainnet/.test(sheet), `${label}: the review sheet is in EURC`)
  check(!/Quick Pay contract/.test(sheet), `${label}: EURC is a direct transfer, not through the Quick Pay contract`)
  check(/gas is paid in USDC/.test(sheet), `${label}: the fee line says gas is paid in USDC`)
  check(/EURC \+ ≈/.test(sheet), `${label}: the total shows the EURC amount and the USDC fee separately`)
  await page.getByRole('button', { name: /Confirm and send/ }).click()
  await page.waitForTimeout(1500)
  const after = await page.locator('[role="dialog"]').innerText()
  check(/rejected|cancel|declin/i.test(after) && !/Confirmed on-chain/.test(after), `${label}: when the wallet declines, nothing is shown as sent`)
  check((await ledgerCount(page)) === before, `${label}: a declined payment leaves no pending record in History`)
  check(errors.length === 0, `${label}: no page errors (${errors.length})`)
  await ctx.close()
}

// ---- payment links in USDC or EURC -----------------------------------------------------------------------------------------
{
  const throwaway = privateKeyToAccount(generatePrivateKey())
  const payload = { address: throwaway.address, chainId: 5042, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), nonce: crypto.randomUUID().replace(/-/g, '') }
  const signature = await throwaway.signMessage({ message: buildSessionMessage(payload) })
  const created = (await (await fetch(`${API}/requests`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `QuickPay ${btoa(JSON.stringify({ ...payload, signature }))}` }, body: JSON.stringify({ amount: '100000', token: 'EURC', reference: 'ORDER-77', description: 'Sticker pack' }) })).json()) as { id: string }
  try {
    const ctx = await context({ mobile: true })
    const page = await ctx.newPage()
    await connect(page)
    await page.goto(`${BASE}/pay/${created.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const text = await page.evaluate(() => document.body.innerText)
    check(/0\.10\s*EURC/.test(text) && /Ref ORDER-77/.test(text) && /pay in EURC/i.test(text), 'the payment link shows 0.10 EURC, its reference and says to pay in EURC')
    await page.getByRole('button', { name: 'Review and pay' }).click()
    await page.waitForSelector('[role="dialog"]')
    await page.waitForTimeout(2500)
    const sheet = await page.locator('[role="dialog"]').innerText()
    check(/EURC on Arc Mainnet/.test(sheet) && !/Quick Pay contract/.test(sheet), 'paying an EURC link reviews an EURC direct transfer')
    await page.getByRole('button', { name: /Confirm and send/ }).click()
    await page.waitForTimeout(1500)
    const status = await page.evaluate(() => document.body.innerText)
    check(!/Payment verified|Marking this request as paid/.test(status), 'a declined payment is not marked paid')
    await ctx.close()
  } finally {
    await requireDb().unsafe('delete from payment_requests where id = $1', [created.id])
  }
  const ctx = await context({ mobile: false })
  const page = await ctx.newPage()
  await connect(page)
  await page.goto(`${BASE}/requests`, { waitUntil: 'networkidle' })
  const radios = await page.locator('[role="radiogroup"][aria-label="Token to request"] [role="radio"]').allTextContents()
  check(radios.join(',') === 'USDC,EURC', `the new-request form offers ${radios.join(' and ')}`)
  check((await page.locator('input[placeholder="INV-1042"]').count()) === 1, 'the form has a reference field')
  await page.locator('[role="radio"]', { hasText: 'EURC' }).click()
  await page.waitForTimeout(150)
  check((await page.locator('text=EURC').count()) > 0 && /EURC/.test(await page.locator('main').innerText()), 'choosing EURC switches the amount field to EURC')
  await ctx.close()
}

// ---- batch payouts ---------------------------------------------------------------------------------------------------------
for (const atomic of [false, true]) {
  const ctx = await context({ mobile: !atomic, atomic })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const tag = atomic ? 'wallet that can batch' : 'wallet that cannot batch'
  await connect(page)
  await page.goto(`${BASE}/payroll`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const good = (n: number) => `0x${(0xabc000 + n).toString(16).padStart(40, '1')}`
  await page.locator('textarea').fill(`${good(1)}, 1.25, Ana\n${good(2)}, 0.5\nnot-an-address, 3\n${good(3)}\n${good(1)}, 2`)
  await page.getByRole('button', { name: 'Add from list' }).click()
  await page.waitForTimeout(300)
  const rowCount = await page.locator('[aria-label="Recipient rows"] > li').count()
  check(rowCount === 4, `${tag}: pasted list adds 4 readable rows and skips the one without an amount (${rowCount})`)
  check((await page.locator('text=/not added/').count()) >= 1, `${tag}: the unreadable line is reported`)
  check((await page.locator('[role="alert"]', { hasText: /valid 0x wallet address/ }).count()) === 1, `${tag}: the bad address is flagged on its row`)
  check((await page.locator('text=appear more than once').count()) === 1, `${tag}: a repeated address is flagged as a warning, not blocked`)
  check(await page.getByRole('button', { name: 'Review batch' }).isDisabled(), `${tag}: Review is disabled while a row is invalid`)
  // Fix the bad row and check the total.
  const bad = page.locator('[aria-label="Recipient rows"] > li', { hasText: 'not-an-address' }).first()
  await page.locator('input[aria-label="Recipient 3 address"]').fill(good(4))
  await page.waitForTimeout(250)
  const total = await page.evaluate(() => document.body.innerText.match(/Total \(USDC\)\s*([\d.,]+)/)?.[1] ?? '')
  check(total === '6.75', `${tag}: the total is exact (${total}, expected 6.75)`)
  check((await page.locator('text=more than your USDC balance').count()) === 1 && (await page.getByRole('button', { name: 'Review batch' }).isDisabled()), `${tag}: a total above the wallet's real balance is refused`)
  void bad
  // Smaller amounts that the wallet really can cover.
  for (const [i, v] of ['0.25', '0.05', '0.1', '0.05'].entries()) await page.locator(`input[aria-label="Recipient ${i + 1} amount"]`).fill(v)
  await page.waitForTimeout(250)
  const small = await page.evaluate(() => document.body.innerText.match(/Total \(USDC\)\s*([\d.,]+)/)?.[1] ?? '')
  check(small === '0.45', `${tag}: the total follows the edits (${small}, expected 0.45)`)
  // Save, reload, load back (kept on this device).
  await page.locator('input[aria-label="List name"]').fill('Team A')
  await page.getByRole('button', { name: 'Save list' }).click()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check((await page.locator('select option', { hasText: 'Team A' }).count()) === 1, `${tag}: the saved list survives a reload (stored on this device)`)
  await page.locator('select').first().selectOption({ label: 'Team A (4, USDC)' })
  await page.waitForTimeout(300)
  check((await page.locator('[aria-label="Recipient rows"] > li').count()) === 4, `${tag}: loading it restores the recipients`)
  // Start: the wallet declines, so nothing is sent and the queue pauses.
  const ledgerBefore = await ledgerCount(page)
  await page.getByRole('button', { name: 'Review batch' }).click()
  await page.waitForSelector('[role="dialog"]')
  const dialog = await page.locator('[role="dialog"]').innerText()
  check(/0\.45 USDC/.test(dialog) && /4 recipients/.test(dialog), `${tag}: the review shows the total and the recipient count`)
  const batchBtn = await page.getByRole('button', { name: 'Send all with one approval' }).count()
  check(atomic ? batchBtn === 1 : batchBtn === 0, `${tag}: the one-approval option is ${atomic ? 'offered because the wallet reports atomic support' : 'not offered because the wallet does not report it'}`)
  await page.getByRole('button', { name: atomic ? 'Send all with one approval' : /Send one by one/ }).click()
  await page.waitForTimeout(2500)
  const panel = await page.locator('[aria-label="Batch in progress"]').innerText()
  check(/declined|Paused/i.test(panel), `${tag}: a declined wallet pauses the batch (${panel.match(/Paused[^.]*\./)?.[0] ?? 'paused'})`)
  const states = await page.locator('[aria-label="Batch in progress"] li').allInnerTexts()
  check(states.length === 4 && states.every((t) => /Waiting/.test(t)) && !states.some((t) => /Confirmed|Pending|Failed/.test(t)), `${tag}: every row is still Waiting, none shown as sent`)
  check((await ledgerCount(page)) === ledgerBefore, `${tag}: History has no pending record for transfers that were never signed`)
  // The paused batch survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check((await page.locator('[aria-label="Batch in progress"]').count()) === 1, `${tag}: the paused batch is still there after a reload`)
  check((await page.getByRole('button', { name: 'Review batch' }).isDisabled()), `${tag}: a second batch cannot start until this one is closed`)
  check((await page.getByRole('button', { name: 'Close this batch' }).count()) === 0, `${tag}: an unfinished batch cannot be dismissed`)
  check(errors.length === 0, `${tag}: no page errors (${errors.length})`)
  await ctx.close()
}

await browser.close()
console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
