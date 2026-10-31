/**
 * Live smoke test against a running backend (bun run server) and the real Arc RPC.
 *   bun run tests/api.smoke.ts [http://localhost:3001]
 * It signs in with a throwaway key (no funds, nothing is sent on-chain).
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { buildSessionMessage, SESSION_TTL_MS, type SessionPayload } from '../shared/session'

const base = process.argv[2] ?? 'http://localhost:3001'
const account = privateKeyToAccount(generatePrivateKey())
let failures = 0

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.token) headers.authorization = `QuickPay ${init.token}`
  const res = await fetch(`${base}${path}`, { ...init, headers })
  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* csv or empty */ }
  return { status: res.status, body: body as Record<string, unknown> }
}

const now = Date.now()
const payload: SessionPayload = { address: account.address.toLowerCase(), chainId: 5042, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), nonce: 'b'.repeat(32) }
const token = btoa(JSON.stringify({ ...payload, signature: await account.signMessage({ message: buildSessionMessage(payload) }) }))

const health = await call('/health')
check('health reports database + rpc ok', health.body.database === 'ok' && health.body.rpc === 'ok', health.body)

const unauth = await call('/requests', { method: 'POST', body: JSON.stringify({ amount: '1000000' }) })
check('creating a request without a signature is rejected', unauth.status === 401, unauth)

const bad = await call('/requests', { method: 'POST', token, body: JSON.stringify({ amount: '0' }) })
check('zero amount rejected', bad.status === 400, bad)

const created = await call('/requests', { method: 'POST', token, body: JSON.stringify({ amount: '2500000', description: '  Lunch <b>split</b>  ' }) })
check('request created as unpaid', created.status === 201 && created.body.status === 'unpaid' && created.body.recipient === account.address.toLowerCase(), created)
check('description is sanitized', created.body.description === 'Lunch b split /b', created.body.description)
const id = created.body.id as string

const fetched = await call(`/requests/${id}`)
check('public read returns the request', fetched.status === 200 && fetched.body.amount === '2500000', fetched)

const list = await call('/requests', { token })
check('owner can list requests', list.status === 200 && (list.body.requests as unknown[]).length === 1, list)

const missing = await call('/requests/aaaaaaaaaaaaaaaa')
check('unknown request is 404', missing.status === 404, missing)

const fakeHash = `0x${'11'.repeat(32)}`
const verify = await call(`/requests/${id}/verify`, { method: 'POST', body: JSON.stringify({ txHash: fakeHash }) })
check('a made-up transaction cannot mark a request paid', verify.status === 404 && verify.body.error === 'tx_not_found', verify)

const cancelled = await call(`/requests/${id}/cancel`, { method: 'POST', token, body: '{}' })
check('owner can cancel an unpaid request', cancelled.status === 200 && cancelled.body.status === 'cancelled', cancelled)

const other = privateKeyToAccount(generatePrivateKey())
const otherPayload: SessionPayload = { ...payload, address: other.address.toLowerCase(), nonce: 'c'.repeat(32) }
const otherToken = btoa(JSON.stringify({ ...otherPayload, signature: await other.signMessage({ message: buildSessionMessage(otherPayload) }) }))
const created2 = await call('/requests', { method: 'POST', token, body: JSON.stringify({ amount: '1000000' }) })
const forbidden = await call(`/requests/${String(created2.body.id)}/cancel`, { method: 'POST', token: otherToken, body: '{}' })
check("another wallet cannot cancel someone else's request", forbidden.status === 403, forbidden)

const coverageStatus = (r: { body: Record<string, unknown> }) => (r.body.coverage as { status?: string } | undefined)?.status
const stranger = privateKeyToAccount(generatePrivateKey())
const read1 = await call(`/history/${stranger.address}?pageSize=1`)
const read2 = await call(`/analytics/${stranger.address}`)
const read3 = await call(`/history/${stranger.address}?pageSize=1`)
check('reading history/analytics does not register an unknown wallet', [read1, read2, read3].every((r) => r.status === 200 && coverageStatus(r) === 'unregistered'), [coverageStatus(read1), coverageStatus(read2), coverageStatus(read3)])
const idx = await call(`/index/${account.address}`, { method: 'POST' })
check('wallet indexing starts and reports honest coverage', idx.status === 200 && typeof idx.body.status === 'string' && ['indexing', 'complete'].includes(idx.body.status) && Number(idx.body.headBlock) > 0, idx)
const hist = await call(`/history/${account.address}?pageSize=5`)
check('history endpoint returns rows + coverage', hist.status === 200 && Array.isArray(hist.body.rows) && Boolean(hist.body.coverage), hist)
const burstStart = Date.now()
const burst = await Promise.all(Array.from({ length: 20 }, () => call(`/history/${account.address}?pageSize=1`)))
check('a burst of 20 reads is served without per-read chain scans', burst.every((r) => r.status === 200) && Date.now() - burstStart < 15_000, Date.now() - burstStart)
const badSearch = await call(`/history/${account.address}?q=${encodeURIComponent("x'; drop table transfers;--")}`)
check('non-hex search is rejected', badSearch.status === 400, badSearch)
const csv = await fetch(`${base}/history/${account.address}?format=csv`)
check('CSV export works', csv.status === 200 && (await csv.text()).startsWith('timestamp,tx_hash'), csv.status)
const stats = await call(`/analytics/${account.address}`)
check('analytics returns totals + coverage', stats.status === 200 && stats.body.totalSent === '0' && Boolean(stats.body.coverage), stats)

const chains = await call('/across/swap/chains')
check('Across chain list proxied and includes Arc', chains.status === 200 && Array.isArray(chains.body) && (chains.body as unknown as { chainId: number }[]).some((c) => c.chainId === 5042), chains.status)
const routes = await call('/across/available-routes?originChainId=5042&destinationChainId=1')
check('Across route list proxied', routes.status === 200 && Array.isArray(routes.body), routes.status)
const blocked = await call('/across/swap/anything-else')
check('non allow-listed Across paths are blocked', blocked.status === 404, blocked)
const badParam = await call('/across/available-routes?originChainId=abc')
check('invalid Across parameters are blocked', badParam.status === 400, badParam)

console.log(failures === 0 ? '\nAll smoke checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
