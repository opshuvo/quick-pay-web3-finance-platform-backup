import { describe, expect, test } from 'bun:test'
import { backoffMs, classifyRpcFailure, createRpcLimiter, retryDelay } from '../src/lib/arcRpc'
import { ChainHistory } from '../src/lib/chainHistory/engine'

/** Errors shaped like the ones viem raises for the real Arc RPC responses measured on 2026-11-01. */
const httpError = (status: number, details: string) => Object.assign(new Error('HTTP request failed.'), { name: 'HttpRequestError', status, details, shortMessage: 'HTTP request failed.' })
const rpcError = (code: number, details: string) => Object.assign(new Error('RPC Request failed.'), { name: 'RpcRequestError', code, details, shortMessage: 'RPC Request failed.' })
const RATE_429 = () => httpError(429, '{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limit exceeded"}}')
const RANGE = () => rpcError(-32012, 'requested range too large')

function clock() {
  let t = 1_000_000
  const slept: number[] = []
  return { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms }, slept }
}

describe('classifyRpcFailure (real Arc RPC responses)', () => {
  test('HTTP 429 and JSON-RPC -32005 are rate limits', () => {
    expect(classifyRpcFailure(RATE_429())).toBe('rate')
    expect(classifyRpcFailure(rpcError(-32005, 'rate limit exceeded'))).toBe('rate')
    expect(classifyRpcFailure(Object.assign(new Error('x'), { cause: RATE_429() }))).toBe('rate')
  })
  test('"requested range too large" (-32012) is a range error, never a rate limit', () => {
    expect(classifyRpcFailure(RANGE())).toBe('range')
    expect(classifyRpcFailure(new Error('query exceeds max block range'))).toBe('range')
  })
  test('timeouts, unreachable nodes and unknown errors', () => {
    expect(classifyRpcFailure(Object.assign(new Error('The request took too long to respond.'), { name: 'TimeoutError' }))).toBe('timeout')
    expect(classifyRpcFailure(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyRpcFailure(httpError(503, 'service unavailable'))).toBe('network')
    expect(classifyRpcFailure(new Error('execution reverted'))).toBe('other')
  })
  test('the request body echoed by viem is not mistaken for a range complaint', () => {
    const e = Object.assign(new Error('Request body: {"method":"eth_getLogs","params":[{"fromBlock":"0x1","toBlock":"0x2"}]}'), { details: 'fetch failed' })
    expect(classifyRpcFailure(e)).toBe('network')
  })
})

describe('backoff', () => {
  test('grows exponentially, is capped, and stays within 50-100% of each step', () => {
    expect(backoffMs(0, 800, 10_000, () => 0)).toBe(400)
    expect(backoffMs(0, 800, 10_000, () => 1)).toBe(800)
    expect(backoffMs(1, 800, 10_000, () => 0)).toBe(800)
    expect(backoffMs(2, 800, 10_000, () => 0)).toBe(1_600)
    expect(backoffMs(10, 800, 10_000, () => 1)).toBe(10_000)
  })
  test('query retry delay is 1s, 2s, 4s and capped at 8s', () => {
    expect([0, 1, 2, 3, 6].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
  })
})

describe('createRpcLimiter', () => {
  test('retries a rate limit with growing waits and then succeeds', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 100, sleep: c.sleep, now: c.now, random: () => 0 })
    let calls = 0
    const notes: (string | null)[] = []
    const value = await limiter.run(async () => { calls += 1; if (calls < 3) throw RATE_429(); return 'ok' }, { onNote: (n) => notes.push(n) })
    expect(value).toBe('ok')
    expect(calls).toBe(3)
    expect(notes.filter(Boolean).length).toBe(2)
    expect(notes[notes.length - 1]).toBeNull()
    expect(c.slept.some((ms) => ms >= 400)).toBe(true)
  })
  test('slows down after a rate limit and speeds up again after a run of successes', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 100, maxIntervalMs: 1_000, sleep: c.sleep, now: c.now, random: () => 0 })
    let first = true
    await limiter.run(async () => { if (first) { first = false; throw RATE_429() } return 1 })
    const slowed = limiter.state().intervalMs
    expect(slowed).toBeGreaterThan(100)
    for (let i = 0; i < 40; i++) await limiter.run(async () => 1)
    expect(limiter.state().intervalMs).toBeLessThan(slowed)
    expect(limiter.state().intervalMs).toBeGreaterThanOrEqual(100)
  })
  test('after a burst of rate limits the gap is back to normal within about a dozen successes', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 350, maxIntervalMs: 2_000, attempts: 8, sleep: c.sleep, now: c.now, random: () => 0 })
    await limiter.run(async () => { throw RATE_429() }).catch(() => undefined)
    expect(limiter.state().intervalMs).toBe(2_000)
    for (let i = 0; i < 14; i++) await limiter.run(async () => 1)
    expect(limiter.state().intervalMs).toBe(350)
  })
  test('the gap never grows past its maximum', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 100, maxIntervalMs: 300, attempts: 8, sleep: c.sleep, now: c.now, random: () => 0 })
    await limiter.run(async () => { throw RATE_429() }).catch(() => undefined)
    expect(limiter.state().intervalMs).toBe(300)
  })
  test('a refused range is thrown at once so the caller can use a smaller one', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 10, sleep: c.sleep, now: c.now })
    let calls = 0
    await limiter.run(async () => { calls += 1; throw RANGE() }).catch(() => undefined)
    expect(calls).toBe(1)
  })
  test('an unknown error gets one more try, not five', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 10, sleep: c.sleep, now: c.now, random: () => 0 })
    let calls = 0
    await limiter.run(async () => { calls += 1; throw new Error('execution reverted') }).catch(() => undefined)
    expect(calls).toBe(2)
  })
  test('gives up after the allowed attempts and throws the last error', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 10, attempts: 4, sleep: c.sleep, now: c.now, random: () => 0 })
    let calls = 0
    const error = await limiter.run(async () => { calls += 1; throw new TypeError('Failed to fetch') }).catch((e: unknown) => e)
    expect(calls).toBe(4)
    expect((error as Error).message).toBe('Failed to fetch')
  })
  test('one rate limit pauses calls that were already queued', async () => {
    const c = clock()
    const limiter = createRpcLimiter({ baseIntervalMs: 10, sleep: c.sleep, now: c.now, random: () => 1 })
    let failedOnce = false
    const a = limiter.run(async () => { if (!failedOnce) { failedOnce = true; throw RATE_429() } return 'a' })
    const b = limiter.run(async () => 'b')
    const startedAt = c.now()
    await Promise.all([a, b])
    expect(c.now() - startedAt).toBeGreaterThanOrEqual(700)
  })
  test('identical in-flight requests are shared', async () => {
    const limiter = createRpcLimiter({ baseIntervalMs: 0 })
    let calls = 0
    let release: (v: number) => void = () => undefined
    const slow = () => { calls += 1; return new Promise<number>((resolve) => { release = resolve }) }
    const p1 = limiter.shared('head', slow)
    const p2 = limiter.shared('head', slow)
    release(7)
    expect(await Promise.all([p1, p2])).toEqual([7, 7])
    expect(calls).toBe(1)
    await limiter.shared('head', async () => 8)
  })
})

describe('ChainHistory against RPC behaviour measured on Arc', () => {
  test('a block range the node refuses is split, the smaller size is remembered, and nothing is lost', async () => {
    const seen: [number, number][] = []
    const client = {
      request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
        const from = Number(BigInt(params[0].fromBlock))
        const to = Number(BigInt(params[0].toBlock))
        seen.push([from, to])
        if (to - from + 1 > 2_500) throw RANGE()
        return [{ transactionHash: `0x${'aa'.repeat(32)}`, logIndex: '0x0', blockNumber: `0x${(from + 1).toString(16)}`, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', `0x${'0'.repeat(24)}${'11'.repeat(20)}`, `0x${'0'.repeat(24)}${'22'.repeat(20)}`], data: '0x01' }]
      },
    }
    const engine = new ChainHistory('0x' + '11'.repeat(20), client as never)
    const logs = await (engine as unknown as { logs: (t: unknown[], f: number, to: number) => Promise<unknown[]> }).logs([null], 0, 4_999)
    expect(logs.length).toBe(2)
    expect(seen).toEqual([[0, 4_999], [0, 2_499], [2_500, 4_999]])
    expect(engine.snapshot().range).toBe(2_500)
  }, 15_000)

  test('a transaction that cannot be verified does not block the others, and is retried later', async () => {
    const good = `0x${'bb'.repeat(32)}`
    const bad = `0x${'cc'.repeat(32)}`
    const wallet = '0x' + '11'.repeat(20)
    const client = {
      getTransaction: async ({ hash }: { hash: string }) => { if (hash === bad) throw new Error('transaction not found'); return { from: wallet, to: '0x' + '33'.repeat(20) } },
      getTransactionReceipt: async ({ hash }: { hash: string }) => { if (hash === bad) throw new Error('transaction not found'); return { status: 'success', blockNumber: 5n, logs: [], gasUsed: 1n, effectiveGasPrice: 1n } },
      getBlock: async () => ({ timestamp: 1_700_000_000n }),
    }
    const engine = new ChainHistory(wallet, client as never)
    const internals = engine as unknown as { pending: Set<string>; meta: Map<string, unknown>; verifyPending: (n: number) => Promise<void>; verifyRetry: Map<string, { failures: number }> }
    internals.pending.add(bad)
    internals.pending.add(good)
    await internals.verifyPending(1)
    // Only the first was attempted (batch of one), so run again: the bad one is now backing off and the good one goes through.
    await internals.verifyPending(1)
    await internals.verifyPending(1)
    expect(internals.meta.has(good)).toBe(true)
    expect(internals.pending.has(good)).toBe(false)
    expect(internals.pending.has(bad)).toBe(true)
    expect(internals.verifyRetry.get(bad)?.failures).toBe(1)
    expect(engine.lastError).toMatch(/retried automatically/)
  }, 15_000)

  test('simultaneous callers share one verification run', async () => {
    const wallet = '0x' + '11'.repeat(20)
    const hash = `0x${'dd'.repeat(32)}`
    let reads = 0
    const client = {
      getTransaction: async () => { reads += 1; return { from: wallet, to: '0x' + '33'.repeat(20) } },
      getTransactionReceipt: async () => ({ status: 'success', blockNumber: 5n, logs: [], gasUsed: 1n, effectiveGasPrice: 1n }),
      getBlock: async () => ({ timestamp: 1_700_000_000n }),
    }
    const engine = new ChainHistory(wallet, client as never)
    await Promise.all([engine.verifyTx(hash), engine.verifyTx(hash), engine.verifyTx(hash)])
    expect(reads).toBe(1)
  }, 15_000)
})
