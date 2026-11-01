import { describe, expect, test } from 'bun:test'
import { buildActivity, buildAnalytics, buildCoverage, buildHistory, HistoryInputError, filterRows, type Filters, type Snapshot } from '../src/lib/chainHistory/derive'
import { netFlows } from '../shared/swapLegs'

const W = '0x05b62b3057d4cefbc1aced6f6055679d65042ac1'
const OTHER = '0x1111111111111111111111111111111111111111'
const POOL = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const USDC = '0x3600000000000000000000000000000000000000'
const f = (over: Partial<Filters> = {}): Filters => ({ q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25, ...over })

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  address: W, usdc: USDC,
  transfers: [
    { txHash: '0xaa', logIndex: 1, block: 100, from: OTHER, to: W, amount: '5000000' },
    { txHash: '0xbb', logIndex: 2, block: 200, from: W, to: OTHER, amount: '2000000' },
    { txHash: '0xcc', logIndex: 3, block: 300, from: POOL, to: W, amount: '7000000' },
    { txHash: '0xdd', logIndex: 4, block: 400, from: OTHER, to: OTHER, amount: '9' }, // not this wallet's
    { txHash: '0xee', logIndex: 5, block: 500, from: W, to: OTHER, amount: '1' }, // no block time known
  ],
  meta: new Map(), swaps: [], bridges: [],
  times: new Map([[100, 1_700_000_000], [200, 1_700_100_000], [300, 1_700_200_000], [400, 1_700_300_000]]),
  newest: 1000, oldest: 50, head: 1000, range: 5000, error: null, lastProgressAt: Date.now(), pendingVerification: 0,
  ...over,
})

describe('browser history rows', () => {
  test('lists only this wallet, newest first, with direction and an explorer-ready hash', () => {
    const rows = filterRows(snap(), f())
    expect(rows.map((r) => r.txHash)).toEqual(['0xcc', '0xbb', '0xaa'])
    expect(rows.map((r) => r.direction)).toEqual(['in', 'out', 'in'])
    expect(rows.every((r) => r.status === 'confirmed' && r.token === USDC)).toBe(true)
  })
  test('a transfer with no known block time is never listed with an invented date', () => {
    expect(filterRows(snap(), f()).some((r) => r.txHash === '0xee')).toBe(false)
  })
  test("another wallet's snapshot never contains these rows", () => {
    expect(filterRows(snap({ address: OTHER }), f()).every((r) => r.from === OTHER || r.to === OTHER)).toBe(true)
    expect(filterRows(snap({ address: '0x2222222222222222222222222222222222222222' }), f())).toHaveLength(0)
  })
  test('direction, search and pagination', () => {
    expect(filterRows(snap(), f({ direction: 'out' })).map((r) => r.txHash)).toEqual(['0xbb'])
    expect(filterRows(snap(), f({ q: '0xaa' })).map((r) => r.txHash)).toEqual(['0xaa'])
    expect(() => filterRows(snap(), f({ q: "x'; drop" }))).toThrow(HistoryInputError)
    const page = buildHistory(snap(), f({ pageSize: 2, page: 2 }), Date.now())
    expect(page.total).toBe(3)
    expect(page.rows.map((r) => r.txHash)).toEqual(['0xaa'])
  })
})

describe('swap and bridge labelling', () => {
  test('a verified swap record labels its transfers; a known pool counterparty is a best-effort label', () => {
    const swapSnap = snap({ swaps: [{ hash: '0xbb', block: 200, tokenIn: USDC, tokenOut: '0xabc', amountIn: '2000000', amountOut: '1', inSymbol: 'USDC', inDecimals: 6, outSymbol: 'EURC', outDecimals: 6, feeAmount: '10' }] })
    const types = Object.fromEntries(filterRows(swapSnap, f()).map((r) => [r.txHash, r.type]))
    expect(types).toEqual({ '0xcc': 'swap', '0xbb': 'swap', '0xaa': 'transfer' })
    const a = buildActivity(swapSnap, 5042)
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ kind: 'swap', wallet: W, status: 'confirmed', tokenOutSymbol: 'EURC', amountIn: '2000000' })
  })
  test('a bridge deposit is never reported as complete', () => {
    const b = snap({ bridges: [{ hash: '0xbb', block: 200, token: USDC, amountIn: '2000000', symbol: 'USDC', decimals: 6 }] })
    const [a] = buildActivity(b, 5042)
    expect(a).toMatchObject({ kind: 'bridge', status: 'pending', destinationVerified: false, amountOut: null })
  })
  test('swap legs are read from the receipt logs', () => {
    const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const topic = (a: string) => `0x${a.slice(2).padStart(64, '0')}`
    const flows = netFlows([
      { address: USDC, topics: [T, topic(POOL), topic(W)], data: `0x${(7_000_000n).toString(16).padStart(64, '0')}` },
      { address: '0xabc0000000000000000000000000000000000000', topics: [T, topic(W), topic(POOL)], data: `0x${(5n).toString(16).padStart(64, '0')}` },
    ], W)
    expect(flows.find((x) => x.token === USDC)?.net).toBe(7_000_000n)
  })
})

describe('totals and coverage honesty', () => {
  test('totals add up from the listed rows only', () => {
    const a = buildAnalytics(snap(), Date.now())
    expect(a.totalSent).toBe('2000000')
    expect(a.totalReceived).toBe('12000000')
    expect(a.transactionCount).toBe(3)
    expect(a.coverage.source).toBe('browser')
  })
  test('never complete until block 0 was reached', () => {
    expect(buildCoverage(snap({ oldest: 50 }), Date.now()).status).toBe('indexing')
    expect(buildCoverage(snap({ oldest: 0 }), Date.now()).status).toBe('complete')
    expect(buildCoverage(snap({ oldest: null, newest: null }), Date.now()).status).toBe('unregistered')
  })
})

describe('history server selection (regression: expired RPC credentials on the server)', () => {
  const withHealth = async (body: unknown, status = 200, type = 'application/json') => {
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } })) as unknown as typeof fetch
    try {
      const { historyServerUsable, forgetServerProbe } = await import('../src/lib/chainHistory/mode')
      forgetServerProbe()
      return await historyServerUsable()
    } finally {
      globalThis.fetch = real
    }
  }
  test('a healthy server (database and RPC ok) is used', async () => {
    expect(await withHealth({ ok: true, database: 'ok', rpc: 'ok' })).toBe(true)
  })
  test('a server whose Arc RPC is failing is NOT used, so the browser reads Arc directly', async () => {
    expect(await withHealth({ ok: true, database: 'ok', rpc: 'error' })).toBe(false)
  })
  test('a server with no database, or a static host answering with HTML, is not used', async () => {
    expect(await withHealth({ ok: true, database: 'unconfigured', rpc: 'ok' })).toBe(false)
    expect(await withHealth('<!DOCTYPE html><html></html>', 200, 'text/html')).toBe(false)
  })
})
