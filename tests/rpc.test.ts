import { describe, expect, test } from 'bun:test'
import { BACKOFF_CAP_MS, MAX_RETRY_AFTER_MS, backoffDelay, classifyRpcError, createRpcRunner, getRetryAfterMs, isRangeTooLarge } from '../server/rpc'

// Shaped like viem errors: provider text in `details`, request echo inside `message`.
const viemError = (details: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`RPC Request failed.\n\nURL: https://rpc.example\nRequest body: {"method":"eth_getLogs"}\n\nDetails: ${details}`), { details, shortMessage: 'RPC Request failed.', ...extra })

describe('classifyRpcError', () => {
  test('the real Arc rate limit (-32005 "rate limit exceeded") is a rate limit, never a range problem', () => {
    const e = viemError('rate limit exceeded', { code: -32005 })
    expect(classifyRpcError(e)).toBe('rate_limited')
    expect(isRangeTooLarge(e)).toBe(false)
  })
  test('"too many requests" and HTTP 429 are rate limits', () => {
    expect(classifyRpcError(viemError('Too many requests, slow down'))).toBe('rate_limited')
    expect(classifyRpcError(viemError('whatever', { status: 429 }))).toBe('rate_limited')
    expect(isRangeTooLarge(viemError('Too many requests'))).toBe(false)
  })
  test('a status found on a nested cause is honoured', () => {
    expect(classifyRpcError(Object.assign(new Error('wrapped'), { cause: { status: 429 } }))).toBe('rate_limited')
  })
  test('the real Arc range rejection (-32012) is range_too_large', () => {
    const e = viemError('requested range too large', { code: -32012 })
    expect(classifyRpcError(e)).toBe('range_too_large')
    expect(isRangeTooLarge(e)).toBe(true)
  })
  test.each(['block range is too wide', 'query returned more than 10000 results', 'exceeds max block range', 'response size exceeded'])('provider range or result-size complaint: %s', (text) => {
    expect(classifyRpcError(viemError(text))).toBe('range_too_large')
  })
  test('when both words appear, the rate limit wins', () => {
    expect(classifyRpcError(viemError('rate limit exceeded for large range queries'))).toBe('rate_limited')
  })
  test('timeouts, network errors and unknown errors are told apart', () => {
    expect(classifyRpcError(new Error('The request timed out.'))).toBe('timeout')
    expect(classifyRpcError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout')
    expect(classifyRpcError(viemError('The request took too long to respond.'))).toBe('timeout')
    expect(classifyRpcError(viemError('HTTP request failed.'))).toBe('network')
    expect(classifyRpcError(new Error('fetch failed'))).toBe('network')
    expect(classifyRpcError(new Error('connect ECONNREFUSED 127.0.0.1:8545'))).toBe('network')
    expect(isRangeTooLarge(new Error('The request timed out.'))).toBe(false)
    expect(classifyRpcError(viemError('execution reverted'))).toBe('other')
    expect(classifyRpcError('boom')).toBe('other')
  })
  test('the echoed request body can never trigger a classification', () => {
    expect(classifyRpcError(viemError('internal error'))).toBe('other')
  })
})

describe('backoff', () => {
  test('is bounded, jittered and grows with the attempt', () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const low = backoffDelay(attempt, undefined, () => 0)
      const high = backoffDelay(attempt, undefined, () => 0.999999)
      expect(high).toBeLessThanOrEqual(BACKOFF_CAP_MS)
      expect(low).toBeGreaterThanOrEqual(Math.min(BACKOFF_CAP_MS, 400 * 2 ** attempt) / 2)
      expect(high).toBeGreaterThan(low)
    }
    expect(backoffDelay(3, undefined, () => 0.5)).toBeGreaterThan(backoffDelay(0, undefined, () => 0.5))
  })
  test('Retry-After is a floor, capped at one minute', () => {
    expect(backoffDelay(0, 5_000, () => 0)).toBe(5_000)
    expect(backoffDelay(0, 10 * 60_000, () => 0)).toBe(MAX_RETRY_AFTER_MS)
    expect(backoffDelay(5, 100, () => 0)).toBeGreaterThan(100)
  })
  test('reads Retry-After seconds and dates from the error or its cause', () => {
    const headers = (value: string) => ({ get: (name: string) => (name === 'retry-after' ? value : null) })
    expect(getRetryAfterMs({ headers: headers('3') })).toBe(3_000)
    expect(getRetryAfterMs({ cause: { headers: headers('2') } })).toBe(2_000)
    expect(getRetryAfterMs({ headers: headers(new Date(10_000).toUTCString()) }, 4_000)).toBe(6_000)
    expect(getRetryAfterMs({ headers: headers('9999') })).toBe(MAX_RETRY_AFTER_MS)
    expect(getRetryAfterMs({ headers: headers('nonsense') })).toBeUndefined()
    expect(getRetryAfterMs(new Error('none'))).toBeUndefined()
  })
})

function clock() {
  let t = 1_000
  const slept: number[] = []
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => { slept.push(ms); t += ms },
    advance: (ms: number) => { t += ms },
  }
}

describe('createRpcRunner', () => {
  test('retries rate-limited calls with backoff, then succeeds', async () => {
    const c = clock()
    const runner = createRpcRunner({ minIntervalMs: 0, sleep: c.sleep, now: c.now, random: () => 0 })
    let calls = 0
    const result = await runner.run(async () => {
      calls += 1
      if (calls < 3) throw viemError('rate limit exceeded')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(c.slept.length).toBe(2)
    expect(c.slept[1]).toBeGreaterThan(c.slept[0])
  })
  test('gives up after the attempt limit and rethrows the rate-limit error', async () => {
    const c = clock()
    const runner = createRpcRunner({ minIntervalMs: 0, sleep: c.sleep, now: c.now, random: () => 0 })
    let calls = 0
    await expect(runner.run(async () => { calls += 1; throw viemError('rate limit exceeded') }, 4)).rejects.toThrow(/rate limit/)
    expect(calls).toBe(4)
  })
  test('never retries a range, timeout, network or unknown error', async () => {
    const c = clock()
    const runner = createRpcRunner({ minIntervalMs: 0, sleep: c.sleep, now: c.now })
    for (const error of [viemError('requested range too large'), new Error('timed out'), new Error('fetch failed'), new Error('weird')]) {
      let calls = 0
      await expect(runner.run(async () => { calls += 1; throw error })).rejects.toBe(error)
      expect(calls).toBe(1)
    }
  })
  test('a rate limit pauses the whole runner for at least Retry-After, visible to other callers', async () => {
    let t = 1_000
    const pausedWhenSleeping: number[] = []
    const holder: { runner?: ReturnType<typeof createRpcRunner> } = {}
    const runner = createRpcRunner({
      minIntervalMs: 0,
      now: () => t,
      random: () => 0,
      sleep: async (ms) => { pausedWhenSleeping.push(holder.runner?.pausedForMs() ?? 0); t += ms },
    })
    holder.runner = runner
    const limited = Object.assign(viemError('rate limit exceeded'), { headers: { get: (n: string) => (n === 'retry-after' ? '7' : null) } })
    let first = true
    await runner.run(async () => { if (first) { first = false; throw limited } return 'ok' })
    expect(pausedWhenSleeping[0]).toBeGreaterThanOrEqual(7_000)
    expect(runner.pausedForMs()).toBe(0)
  })
  test('spaces calls by the minimum interval', async () => {
    const c = clock()
    const runner = createRpcRunner({ minIntervalMs: 150, sleep: c.sleep, now: c.now })
    await runner.run(async () => 1)
    await runner.run(async () => 2)
    expect(c.slept).toEqual([150])
  })
  test('in-flight calls are bounded even when many are queued', async () => {
    const runner = createRpcRunner({ minIntervalMs: 0, maxConcurrent: 2, sleep: async () => undefined })
    let current = 0
    let peak = 0
    const releases: (() => void)[] = []
    const job = () => new Promise<number>((resolve) => {
      current += 1
      peak = Math.max(peak, current)
      releases.push(() => { current -= 1; resolve(1) })
    })
    const all = Promise.all(Array.from({ length: 6 }, () => runner.run(job)))
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
      while (releases.length) releases.shift()?.()
      await new Promise((r) => setTimeout(r, 0))
    }
    await all
    expect(peak).toBe(2)
    expect(runner.inFlight()).toBe(0)
  })
  test('a failed call releases its slot', async () => {
    const runner = createRpcRunner({ minIntervalMs: 0, maxConcurrent: 1, sleep: async () => undefined })
    await expect(runner.run(async () => { throw new Error('weird') })).rejects.toThrow('weird')
    expect(await runner.run(async () => 'ok')).toBe('ok')
  })
})
