import { describe, expect, test } from 'bun:test'
import { TipGate } from '../server/tipGate'

describe('TipGate', () => {
  test('repeated reads inside the freshness window do no work', async () => {
    let t = 0
    const gate = new TipGate(() => t)
    let runs = 0
    const work = async () => { runs += 1 }
    expect(await gate.run('w', 15_000, work)).toBe(true)
    for (let i = 0; i < 50; i++) {
      t += 100
      expect(await gate.run('w', 15_000, work)).toBe(false)
    }
    expect(runs).toBe(1)
  })
  test('work runs again once the window has passed', async () => {
    let t = 0
    const gate = new TipGate(() => t)
    let runs = 0
    const work = async () => { runs += 1 }
    await gate.run('w', 15_000, work)
    t += 15_001
    await gate.run('w', 15_000, work)
    expect(runs).toBe(2)
  })
  test('concurrent callers share one run', async () => {
    const gate = new TipGate(() => 0)
    let runs = 0
    let release: () => void = () => undefined
    const work = () => new Promise<void>((resolve) => { runs += 1; release = resolve })
    const calls = Array.from({ length: 20 }, () => gate.run('w', 15_000, work))
    await Promise.resolve()
    release()
    await Promise.all(calls)
    expect(runs).toBe(1)
  })
  test('wallets are independent and a shorter window (after a send) is honoured', async () => {
    let t = 0
    const gate = new TipGate(() => t)
    let runs = 0
    const work = async () => { runs += 1 }
    await gate.run('a', 15_000, work)
    await gate.run('b', 15_000, work)
    expect(runs).toBe(2)
    t += 4_000
    expect(await gate.run('a', 15_000, work)).toBe(false)
    expect(await gate.run('a', 3_000, work)).toBe(true)
  })
  test('failed work releases the gate and does not run again inside the window', async () => {
    let t = 0
    const gate = new TipGate(() => t)
    await expect(gate.run('w', 15_000, async () => { throw new Error('rpc down') })).rejects.toThrow('rpc down')
    expect(await gate.run('w', 15_000, async () => undefined)).toBe(false)
    t += 15_001
    expect(await gate.run('w', 15_000, async () => undefined)).toBe(true)
  })
})

import { SharedValue, waitAtMost } from '../server/tipGate'

describe('SharedValue (chain head lookups)', () => {
  test('many concurrent requests share one fetch', async () => {
    const shared = new SharedValue<number>(1_500, 60_000, () => 0)
    let fetches = 0
    let release: (n: number) => void = () => undefined
    const fetcher = () => new Promise<number>((resolve) => { fetches += 1; release = resolve })
    const calls = Array.from({ length: 40 }, () => shared.get(fetcher))
    await Promise.resolve()
    release(123)
    expect(await Promise.all(calls)).toEqual(Array(40).fill(123))
    expect(fetches).toBe(1)
  })
  test('a fresh value is reused, an old one is refreshed', async () => {
    let t = 0
    const shared = new SharedValue<number>(1_500, 60_000, () => t)
    let n = 0
    const fetcher = async () => ++n
    expect(await shared.get(fetcher)).toBe(1)
    t = 1_000
    expect(await shared.get(fetcher)).toBe(1)
    t = 2_000
    expect(await shared.get(fetcher)).toBe(2)
  })
  test('a failed refresh serves a recent value but never an ancient one', async () => {
    let t = 0
    const shared = new SharedValue<number>(1_500, 60_000, () => t)
    await shared.get(async () => 7)
    t = 10_000
    expect(await shared.get(async () => { throw new Error('rate limited') })).toBe(7)
    t = 100_000
    await expect(shared.get(async () => { throw new Error('rate limited') })).rejects.toThrow('rate limited')
  })
  test('with no previous value a failure is reported, and the next call retries', async () => {
    const shared = new SharedValue<number>(1_500, 60_000, () => 0)
    await expect(shared.get(async () => { throw new Error('down') })).rejects.toThrow('down')
    expect(await shared.get(async () => 5)).toBe(5)
  })
})

describe('waitAtMost (reads never block on slow RPC work)', () => {
  test('returns done when the work finishes in time, even if it fails', async () => {
    expect(await waitAtMost(Promise.resolve(1), 200)).toBe('done')
    expect(await waitAtMost(Promise.reject(new Error('rpc')), 200)).toBe('done')
  })
  test('returns timeout without cancelling work that is still running', async () => {
    let finished = false
    const slow = new Promise<void>((resolve) => setTimeout(() => { finished = true; resolve() }, 80))
    expect(await waitAtMost(slow, 10)).toBe('timeout')
    expect(finished).toBe(false)
    await slow
    expect(finished).toBe(true)
  })
})
