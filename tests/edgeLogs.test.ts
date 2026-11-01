import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { getChain, getUsdc } from '../src/onchain-facts'
import { EDGE_CHUNK, fetchEdgeChunk, resetEdgeCache } from '../src/lib/chainHistory/edge'
import { ChainHistory } from '../src/lib/chainHistory/engine'

const W = '0x' + '26'.repeat(20)
const OTHER = '0x' + '5b'.repeat(20)
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const pad = (a: string) => '0x' + a.slice(2).padStart(64, '0')
const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const CHUNK = 2_881 // blocks 28,810,000 to 28,819,999

function wire(over: Record<string, unknown> = {}) {
  const block = CHUNK * EDGE_CHUNK + 777
  return {
    chunk: CHUNK, from: CHUNK * EDGE_CHUNK, to: CHUNK * EDGE_CHUNK + EDGE_CHUNK - 1,
    logs: [{ transactionHash: hash(1), logIndex: '0x2', blockNumber: '0x' + block.toString(16), topics: [TRANSFER, pad(W), pad(OTHER)], data: '0x2710' }],
    times: [[block, 1_793_000_000]],
    ...over,
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fake = (response: () => Response | Promise<Response>) => { let calls = 0; const f = (async () => { calls += 1; return response() }) as unknown as typeof fetch; return { f, calls: () => calls } }

afterEach(() => resetEdgeCache())

describe('relay response handling', () => {
  test('a good window becomes verified-shape rows with their block times', async () => {
    const r = await fetchEdgeChunk(W, CHUNK, fake(() => json(wire())).f)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chunk.rows).toEqual([{ txHash: hash(1), logIndex: 2, block: CHUNK * EDGE_CHUNK + 777, from: W, to: OTHER, amount: '10000' }])
    expect(r.chunk.times.get(CHUNK * EDGE_CHUNK + 777)).toBe(1_793_000_000)
  })
  test('a host without the relay (HTML page or 404) is reported unavailable, not as an empty history', async () => {
    expect(await fetchEdgeChunk(W, CHUNK, fake(() => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })).f)).toEqual({ ok: false, reason: 'unavailable' })
    resetEdgeCache()
    expect(await fetchEdgeChunk(W, CHUNK, fake(() => json({ error: 'not_found' }, 404)).f)).toEqual({ ok: false, reason: 'unavailable' })
  })
  test('not final, busy and network failures are not treated as data', async () => {
    expect(await fetchEdgeChunk(W, CHUNK, fake(() => json({ error: 'not_final' }, 409)).f)).toEqual({ ok: false, reason: 'not_final' })
    expect(await fetchEdgeChunk(W, CHUNK, fake(() => json({ error: 'rpc_busy' }, 503)).f)).toEqual({ ok: false, reason: 'busy' })
    expect(await fetchEdgeChunk(W, CHUNK, fake(() => { throw new TypeError('Failed to fetch') }).f)).toEqual({ ok: false, reason: 'busy' })
  })
  test('answers that cannot be trusted are rejected whole', async () => {
    const bad = [
      wire({ logs: [{ ...wire().logs[0], topics: [TRANSFER, pad(OTHER), pad('0x' + '77'.repeat(20))] }] }), // not this wallet
      wire({ logs: [{ ...wire().logs[0], blockNumber: '0x10' }] }), // outside the window
      wire({ times: [] }), // a row without a block time
      wire({ chunk: CHUNK + 1 }), // answer for another window
      wire({ logs: [{ ...wire().logs[0], topics: ['0x' + '00'.repeat(32), pad(W), pad(OTHER)] }] }), // not a Transfer
      wire({ logs: [{ ...wire().logs[0], transactionHash: 'nope' }] }),
    ]
    for (const body of bad) {
      resetEdgeCache()
      expect((await fetchEdgeChunk(W, CHUNK, fake(() => json(body)).f)).ok).toBe(false)
    }
  })
  test('a window is requested once, even by simultaneous readers, and kept', async () => {
    const f = fake(() => json(wire()))
    await Promise.all([fetchEdgeChunk(W, CHUNK, f.f), fetchEdgeChunk(W, CHUNK, f.f), fetchEdgeChunk(W, CHUNK, f.f)])
    await fetchEdgeChunk(W, CHUNK, f.f)
    expect(f.calls()).toBe(1)
  })
})

describe('ChainHistory with the relay', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  test('a finished range comes from the relay, trimmed to the range asked for', async () => {
    const f = fake(() => json(wire()))
    globalThis.fetch = f.f
    const engine = new ChainHistory(W) as unknown as { head: number; readRange: (a: number, b: number) => Promise<{ rows: { block: number }[]; times: Map<number, number> }> }
    engine.head = (CHUNK + 5) * EDGE_CHUNK
    const inside = await engine.readRange(CHUNK * EDGE_CHUNK, CHUNK * EDGE_CHUNK + 4_999)
    expect(inside.rows.length).toBe(1)
    expect(inside.times.size).toBe(1)
    const outside = await engine.readRange(CHUNK * EDGE_CHUNK + 5_000, CHUNK * EDGE_CHUNK + 9_999)
    expect(outside.rows.length).toBe(0)
    expect(f.calls()).toBe(1)
  })

  test('a host without the relay is remembered, so the RPC is read directly from then on', async () => {
    globalThis.fetch = fake(() => json({ error: 'not_found' }, 404)).f
    const engine = new ChainHistory(W) as unknown as { head: number; readViaEdge: (a: number, b: number) => Promise<unknown>; edgeOffUntil: number }
    engine.head = (CHUNK + 5) * EDGE_CHUNK
    expect(await engine.readViaEdge(CHUNK * EDGE_CHUNK, CHUNK * EDGE_CHUNK + 4_999)).toBeUndefined()
    expect(engine.edgeOffUntil).toBe(Infinity)
  })

  test('a range that reaches the chain tip is never read from the relay', async () => {
    const f = fake(() => json(wire()))
    globalThis.fetch = f.f
    const engine = new ChainHistory(W) as unknown as { head: number; readViaEdge: (a: number, b: number) => Promise<unknown> }
    engine.head = CHUNK * EDGE_CHUNK + 5_000
    expect(await engine.readViaEdge(CHUNK * EDGE_CHUNK, CHUNK * EDGE_CHUNK + 4_999)).toBeUndefined()
    expect(f.calls()).toBe(0)
  })
})

describe('the serverless relay (public/api/arc-logs.js)', () => {
  const load = createRequire(import.meta.url)
  const source = readFileSync('public/api/arc-logs.js', 'utf8')
  const handler = load('../public/api/arc-logs.js') as (req: unknown, res: unknown) => Promise<void>
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  function call(query: Record<string, string>, rpc: (method: string, params: unknown[]) => unknown, method = 'GET') {
    const out: { status?: number; headers: Record<string, string>; body?: { logs: unknown; times: unknown } } = { headers: {} }
    const res = {
      setHeader: (k: string, v: string) => { out.headers[k] = v },
      status(code: number) { out.status = code; return this },
      send(text: string) { out.body = JSON.parse(text) },
    }
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const { method: m, params } = JSON.parse(init.body)
      const result = rpc(m, params)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 })
    }) as unknown as typeof fetch
    return handler({ method, query }, res).then(() => out)
  }

  test('uses the same RPC URL and USDC address as the Arc Mainnet registry', () => {
    expect(source).toContain(`const RPC = '${getChain(5042)?.rpcUrls[0]}'`)
    expect(source).toContain(`const USDC = '${getUsdc(5042)?.address.toLowerCase()}'`)
  })
  test('rejects bad input without calling the RPC', async () => {
    let called = false
    const rpc = () => { called = true; return '0x1' }
    expect((await call({ address: 'nope', chunk: '1' }, rpc)).status).toBe(400)
    expect((await call({ address: W, chunk: '-1' }, rpc)).status).toBe(400)
    expect((await call({ address: W, chunk: '1.5' }, rpc)).status).toBe(400)
    expect((await call({ address: '0x' + 'AB'.repeat(20), chunk: '1' }, rpc)).status).toBe(400)
    expect((await call({ address: W, chunk: '1' }, rpc, 'POST')).status).toBe(405)
    expect(called).toBe(false)
  })
  test('a window that is not finished is refused and never cached', async () => {
    const out = await call({ address: W, chunk: String(CHUNK) }, (m) => (m === 'eth_blockNumber' ? '0x' + (CHUNK * EDGE_CHUNK + 5_000).toString(16) : []))
    expect(out.status).toBe(409)
    expect(out.headers['cache-control']).toBe('no-store')
  })
  test('a finished window returns this wallet\'s logs, with block times, and is cached for a year', async () => {
    const block = CHUNK * EDGE_CHUNK + 777
    const log = { transactionHash: hash(1), logIndex: '0x2', blockNumber: '0x' + block.toString(16), topics: [TRANSFER, pad(W), pad(OTHER)], data: '0x2710', address: '0x3600000000000000000000000000000000000000', removed: false }
    const seen: unknown[][] = []
    const out = await call({ address: W, chunk: String(CHUNK) }, (m, params) => {
      if (m === 'eth_blockNumber') return '0x' + ((CHUNK + 3) * EDGE_CHUNK).toString(16)
      if (m === 'eth_getLogs') { seen.push(params); const p = (params[0] as { topics: unknown[]; fromBlock: string; toBlock: string }); return p.topics.length === 2 && p.fromBlock === '0x' + (CHUNK * EDGE_CHUNK).toString(16) ? [log] : [] }
      if (m === 'eth_getBlockByNumber') return { timestamp: '0x' + (1_793_000_000).toString(16) }
      throw new Error(m)
    })
    expect(out.status).toBe(200)
    expect(out.headers['cache-control']).toContain('immutable')
    expect(out.body?.logs).toEqual([{ transactionHash: hash(1), logIndex: '0x2', blockNumber: log.blockNumber, topics: log.topics, data: '0x2710' }])
    expect(out.body?.times).toEqual([[block, 1_793_000_000]])
    // four reads of at most 5,000 blocks each: two halves, sent and received
    expect(seen.length).toBe(4)
    for (const [p] of seen as [{ fromBlock: string; toBlock: string; address: string }][]) {
      expect(parseInt(p.toBlock, 16) - parseInt(p.fromBlock, 16) + 1).toBe(5_000)
      expect(p.address).toBe('0x3600000000000000000000000000000000000000')
    }
  })
})
