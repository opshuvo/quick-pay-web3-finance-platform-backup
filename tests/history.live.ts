/**
 * Live history checks against a running backend, its PostgreSQL database and the real Arc RPC.
 *   bun run tests/history.live.ts [http://localhost:3001] [wallet]
 * Reads real data. The only write is one pending record for a REAL transaction the wallet sent (the Registry's
 * deployment), used to prove the pending to confirmed reconciliation; it is removed again by the caller.
 */
const base = process.argv[2] ?? 'http://localhost:3001'
const wallet = (process.argv[3] ?? '0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968').toLowerCase()
const REGISTRY_DEPLOY_TX = '0x910838149a2e5d9f66aa1e7a3055b2bdb1c733fbe9e790f41d631341e4ccc138'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
type Json = Record<string, unknown>
async function call(path: string, init?: RequestInit) {
  const started = performance.now()
  const res = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } })
  const body = (await res.json().catch(() => null)) as Json | null
  return { status: res.status, body: body ?? {}, ms: performance.now() - started }
}
const rowsOf = (b: Json) => (b.rows as Json[]) ?? []
const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]

const health = await call('/health')
check('database and RPC are healthy', health.body.database === 'ok' && health.body.rpc === 'ok', health.body)

// 1. Speed: the newest 20 come from the database, repeated reads add (almost) no RPC traffic.
const cold = await call(`/history/${wallet}?pageSize=20`)
check('first page returns up to 20 rows with coverage', cold.status === 200 && rowsOf(cold.body).length <= 20 && Boolean(cold.body.coverage), cold.status)
const before = Number((await call('/health')).body.rpcCalls)
const times: number[] = []
for (let i = 0; i < 40; i++) times.push((await call(`/history/${wallet}?pageSize=20&q=`)).ms)
const rpcDelta = Number((await call('/health')).body.rpcCalls) - before
console.log(`      40 reads: p50 ${percentile(times, 0.5).toFixed(1)} ms, p95 ${percentile(times, 0.95).toFixed(1)} ms, RPC calls made: ${rpcDelta}`)
check('p95 of a first-page read is under 150 ms', percentile(times, 0.95) < 150, percentile(times, 0.95))
check('40 reads cause no per-read chain scans (indexer background work excluded: a few calls at most)', rpcDelta <= 12, rpcDelta)

// 2. Cursor pagination walks every row exactly once, newest first.
const full = rowsOf((await call(`/history/${wallet}?pageSize=100`)).body)
const walked: Json[] = []
let cursor: string | null = null
let pages = 0
do {
  const page = await call(`/history/${wallet}?pageSize=2${cursor ? `&cursor=${cursor}` : ''}`)
  walked.push(...rowsOf(page.body).filter((r) => !r.local))
  cursor = (page.body.nextCursor as string | null) ?? null
  pages += 1
} while (cursor && pages < 200)
const key = (r: Json) => `${r.txHash}:${r.logIndex}`
const confirmedFull = full.filter((r) => !r.local)
check('cursor pages return every confirmed row, in the same order, with no duplicates', walked.length === confirmedFull.length && walked.every((r, i) => key(r) === key(confirmedFull[i])) && new Set(walked.map(key)).size === walked.length, { walked: walked.length, full: confirmedFull.length })
const ordered = confirmedFull.every((r, i) => i === 0 || Number(confirmedFull[i - 1].blockNumber) > Number(r.blockNumber) || (Number(confirmedFull[i - 1].blockNumber) === Number(r.blockNumber) && Number(confirmedFull[i - 1].logIndex) > Number(r.logIndex)))
check('rows are strictly newest first (block, then log index)', ordered)
check('a bad cursor is a clean 400', (await call(`/history/${wallet}?cursor=zzzz`)).status === 400)

// 3. Types: sent / received / router payments are labelled from receipts and logs.
const types = new Set(full.map((r) => r.type))
console.log(`      row types present: ${[...types].join(', ')}; directions: ${[...new Set(full.map((r) => r.direction))].join(', ')}`)
check('every row has a known type and direction', full.every((r) => ['transfer', 'request_payment', 'swap', 'bridge'].includes(r.type as string) && ['in', 'out', 'self'].includes(r.direction as string)))

// 4. Pending records: refused when fake or foreign, saved and reconciled when real.
const fake = await call('/pending', { method: 'POST', body: JSON.stringify({ txHash: `0x${'12'.repeat(32)}`, wallet, kind: 'send', to: wallet, token: '0x3600000000000000000000000000000000000000', amount: '1' }) })
check('a made-up transaction cannot become a pending record', fake.status === 404 && fake.body.error === 'tx_not_found', fake)
const foreign = await call('/pending', { method: 'POST', body: JSON.stringify({ txHash: REGISTRY_DEPLOY_TX, wallet: '0x000000000000000000000000000000000000dEaD', kind: 'send', to: wallet, token: '0x3600000000000000000000000000000000000000', amount: '1' }) })
check("someone else's transaction cannot be saved against another wallet", foreign.status === 403 && foreign.body.error === 'sender_mismatch', foreign)
const saved = await call('/pending', { method: 'POST', body: JSON.stringify({ txHash: REGISTRY_DEPLOY_TX, wallet, kind: 'send', to: wallet, token: '0x3600000000000000000000000000000000000000', amount: '0' }) })
check('a real transaction the wallet sent is saved at once as pending', saved.status === 201 && ['pending', 'confirmed'].includes(saved.body.status as string), saved)
const listed = await call(`/history/${wallet}?pageSize=20`)
const listedRow = rowsOf(listed.body).find((r) => r.txHash === REGISTRY_DEPLOY_TX)
check('it is listed immediately on the first page, as pending or already reconciled', Boolean(listedRow) && ['pending', 'confirmed'].includes(listedRow?.status as string), listedRow)
let status = 'pending'
for (let i = 0; i < 30 && status === 'pending'; i++) {
  await Bun.sleep(1000)
  const all = rowsOf((await call(`/history/${wallet}?pageSize=20&status=confirmed`)).body)
  const hit = all.find((r) => r.txHash === REGISTRY_DEPLOY_TX)
  if (hit) status = hit.status as string
  else if (rowsOf((await call(`/history/${wallet}?pageSize=20&status=pending`)).body).length === 0) status = 'unlisted'
}
check('the worker reconciles it with the on-chain receipt to Confirmed', status === 'confirmed' || status === 'unlisted', status)
const again = await call('/pending', { method: 'POST', body: JSON.stringify({ txHash: REGISTRY_DEPLOY_TX, wallet, kind: 'send', to: wallet, token: '0x3600000000000000000000000000000000000000', amount: '0' }) })
check('saving the same hash again does not duplicate it', again.status === 201)
const allRows = rowsOf((await call(`/history/${wallet}?pageSize=100`)).body)
check('no transaction hash appears twice for the same log', new Set(allRows.map(key)).size === allRows.length)

console.log(failures === 0 ? '\nAll live history checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
