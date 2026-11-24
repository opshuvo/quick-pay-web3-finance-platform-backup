/**
 * Live check of USDC / EURC payment requests against the running backend, database and Arc Mainnet.
 * Settlement is proven from a REAL EURC transfer on Arc, never from a made-up one.
 * Run: bun tests/requestsToken.live.ts   (backend on :3001; the test deletes the rows it creates)
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { requireDb } from '../server/db'
import { buildSessionMessage } from '../shared/session'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001'
const TX = process.env.EURC_TX ?? '0xc85bd5606a24a587aa2b4658ffeae2305a49025529ce4a7530db1dfd1535dedc'
const RECIPIENT = (process.env.EURC_TO ?? '0x6f57b4c22155cef09f17184c954f227ff0493742').toLowerCase()
const VALUE = BigInt(process.env.EURC_VALUE ?? '138678960')

let passed = 0
const failed: string[] = []
const check = (ok: boolean, s: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`)
  if (ok) passed++
  else failed.push(s)
}
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, init)
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

const account = privateKeyToAccount(generatePrivateKey())
const issuedAt = new Date().toISOString()
const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
const payload = { address: account.address, chainId: 5042, issuedAt, expiresAt, nonce: crypto.randomUUID().replace(/-/g, '') }
const signature = await account.signMessage({ message: buildSessionMessage(payload) })
const auth = `QuickPay ${btoa(JSON.stringify({ ...payload, signature }))}`
const post = (path: string, body: unknown, withAuth = true) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(withAuth ? { authorization: auth } : {}) }, body: JSON.stringify(body) })

const created: string[] = []
try {
  const eurc = await post('/requests', { amount: '1500000', token: 'EURC', reference: 'INV-1042 <b>x</b>', description: 'Design work' })
  check(eurc.status === 200 || eurc.status === 201, `an EURC request is created (${eurc.status})`)
  const id = String(eurc.body.id)
  created.push(id)
  check(eurc.body.token === 'EURC' && eurc.body.amount === '1500000', `it carries its token and amount (${eurc.body.token}, ${eurc.body.amount})`)
  check(eurc.body.reference === 'INV-1042 bx/b', `the reference is stored cleaned: "${eurc.body.reference}"`)
  const got = await call(`/requests/${id}`)
  check(got.body.token === 'EURC' && got.body.reference === 'INV-1042 bx/b' && got.body.status === 'unpaid', 'reading it back returns the same token, reference and Unpaid status')

  const usdc = await post('/requests', { amount: '2000000', description: 'an older client sends no token' })
  created.push(String(usdc.body.id))
  check(usdc.body.token === 'USDC' && usdc.body.reference === '', `a request with no token is USDC with no reference (${usdc.body.token})`)

  const bad = await post('/requests', { amount: '1000000', token: 'DAI' })
  check(bad.status === 400 && bad.body.error === 'bad_token', `an unsupported token is refused (${bad.status} ${bad.body.error})`)

  // Settlement from a real EURC transfer on Arc, using requests dated before it.
  const db = requireDb()
  let n = 0
  const make = async (token: 'EURC' | 'USDC', amount: bigint) => {
    const rid = `qatest${(n++).toString().padStart(2, '2')}${Math.random().toString(36).slice(2, 10)}`.replace(/[^a-z2-9]/g, 'k').slice(0, 16).padEnd(16, 'k')
    await db.unsafe(`insert into payment_requests (id, recipient, amount, token, reference, description, created_at) values ($1,$2,$3,$4,'', 'test', '2020-01-01')`, [rid, RECIPIENT, amount.toString(), token])
    created.push(rid)
    return rid
  }
  // The same transaction also moved 2,100 USDC to this recipient. An EURC request for 1,000 must not be settled by that USDC.
  const wrongToken = await make('EURC', 1_000_000_000n)
  const wrong = await post(`/requests/${wrongToken}/verify`, { txHash: TX }, false)
  check(wrong.status === 422 && wrong.body.error === 'no_matching_transfer', `an EURC request is NOT settled by a larger USDC transfer in the same transaction (${wrong.status} ${wrong.body.error})`)
  const tooBig = await make('EURC', VALUE + 1n)
  const big = await post(`/requests/${tooBig}/verify`, { txHash: TX }, false)
  check(big.status === 422, `an EURC request for more than the transfer is NOT settled (${big.status} ${big.body.error})`)
  const right = await make('EURC', VALUE)
  const paid = await post(`/requests/${right}/verify`, { txHash: TX }, false)
  check(paid.status === 200 && paid.body.status === 'paid' && String(paid.body.paidTxHash).toLowerCase() === TX, `an EURC request for the exact amount is settled by that real EURC transfer (${paid.status} ${paid.body.status})`)
  const again = await make('EURC', VALUE)
  const reuse = await post(`/requests/${again}/verify`, { txHash: TX }, false)
  check(reuse.status === 409, `the same transaction cannot settle a second request (${reuse.status} ${reuse.body.error})`)
} finally {
  const db = requireDb()
  for (const id of created) await db.unsafe('delete from payment_requests where id = $1', [id])
}
console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
