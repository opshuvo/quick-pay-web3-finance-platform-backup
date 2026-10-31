import { describe, expect, test } from 'bun:test'
import { adaptRange, applyStep, dedupeRows, planStep, type Cursor } from '../server/scanPlan'

const LAG = 40

describe('adaptRange', () => {
  const ceiling = 5000
  test('a rate limit or any other failure never shrinks the range', () => {
    expect(adaptRange({ range: 4000, streak: 9 }, 'rate_limited', ceiling)).toEqual({ range: 4000, streak: 0 })
    expect(adaptRange({ range: 4000, streak: 9 }, 'other', ceiling)).toEqual({ range: 4000, streak: 0 })
  })
  test('only a provider range complaint halves it, down to a floor', () => {
    expect(adaptRange({ range: 4000, streak: 3 }, 'range_too_large', ceiling)).toEqual({ range: 2000, streak: 0 })
    expect(adaptRange({ range: 300, streak: 0 }, 'range_too_large', ceiling).range).toBe(250)
  })
  test('grows slowly after 15 clean chunks and never past the ceiling', () => {
    let state = { range: 2000, streak: 0 }
    for (let i = 0; i < 14; i++) state = adaptRange(state, 'ok', ceiling)
    expect(state.range).toBe(2000)
    state = adaptRange(state, 'ok', ceiling)
    expect(state.range).toBe(2500)
    for (let i = 0; i < 400; i++) state = adaptRange(state, 'ok', ceiling)
    expect(state.range).toBe(ceiling)
  })
})

describe('planStep', () => {
  test('a freshly registered wallet backfills from just below the head', () => {
    const plan = planStep({ newest: 1000n, oldest: 1001n }, 1000n, 100, LAG)
    expect(plan).toEqual({ direction: 'backfill', from: 901n, to: 1000n })
  })
  test('follows the tip first when it is behind, otherwise keeps backfilling', () => {
    expect(planStep({ newest: 1000n, oldest: 500n }, 1100n, 50, LAG)?.direction).toBe('forward')
    expect(planStep({ newest: 1000n, oldest: 500n }, 1020n, 50, LAG)?.direction).toBe('backfill')
  })
  test('forward chunks are clamped to the head and backfill chunks to block 0', () => {
    expect(planStep({ newest: 1000n, oldest: 500n }, 1010n, 50, LAG, true)).toEqual({ direction: 'forward', from: 1001n, to: 1010n })
    expect(planStep({ newest: 1000n, oldest: 30n }, 1000n, 50, LAG)).toEqual({ direction: 'backfill', from: 0n, to: 29n })
  })
  test('nothing to do when complete and caught up, or when only forward work was requested', () => {
    expect(planStep({ newest: 1000n, oldest: 0n }, 1000n, 50, LAG)).toBeNull()
    expect(planStep({ newest: 1000n, oldest: 500n }, 1000n, 50, LAG, true)).toBeNull()
  })
})

/** Deterministic pseudo-random numbers so a failing run can be reproduced. */
function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

describe('checkpoint safety', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`random failures, crashes before the checkpoint and restarts never skip or duplicate a log (seed ${seed})`, () => {
      const rand = rng(seed)
      const startHead = 6000n
      let head = startHead
      // ground truth: logs at random blocks, extended as the chain grows
      const truth = new Map<string, { block: bigint }>()
      const addLogs = (from: bigint, to: bigint) => {
        for (let b = from; b <= to; b++) if (rand() < 0.05) truth.set(`0x${b}:0`, { block: b })
      }
      addLogs(0n, head)
      const stored = new Map<string, number>() // key -> times inserted as a row
      let cursor: Cursor = { newest: head, oldest: head + 1n } // exactly what registerWallet writes
      let range = 400
      let guard = 0
      while (guard++ < 5000) {
        if (rand() < 0.3) { const grow = BigInt(Math.floor(rand() * 60)); addLogs(head + 1n, head + grow); head += grow }
        const plan = planStep(cursor, head, range, LAG, rand() < 0.2)
        if (!plan) { if (cursor.oldest === 0n && head - cursor.newest <= BigInt(LAG)) break; continue }
        // every chunk must touch the scanned interval: no gap can ever open
        if (plan.direction === 'forward') expect(plan.from).toBe(cursor.newest + 1n)
        else expect(plan.to).toBe(cursor.oldest - 1n)
        const r = rand()
        if (r < 0.25) continue // RPC failure: checkpoint untouched, chunk retried later
        // chunk fetched and stored (rows deduped by key; the DB ignores conflicts)
        for (const [key, log] of truth) if (log.block >= plan.from && log.block <= plan.to) stored.set(key, (stored.get(key) ?? 0) + 1)
        if (r < 0.4) continue // crash AFTER storing but BEFORE the checkpoint: the chunk is simply scanned again
        cursor = applyStep(cursor, plan)
        if (rand() < 0.05) range = 400 // process restart resets only in-memory state
      }
      expect(cursor.oldest).toBe(0n)
      expect(head - cursor.newest).toBeLessThanOrEqual(BigInt(LAG))
      // every log up to the scanned tip was stored; rescans only ever repeat rows that the primary key ignores
      for (const [key, log] of truth) if (log.block <= cursor.newest) expect(stored.has(key)).toBe(true)
      for (const key of stored.keys()) expect(truth.has(key)).toBe(true)
    })
  }
  test('two workers planning from the same stale cursor never open a gap or lose a log', () => {
    const rand = rng(99)
    let head = 5000n
    const truth = new Map<string, bigint>()
    for (let b = 0n; b <= head; b++) if (rand() < 0.05) truth.set(`0x${b}:0`, b)
    const stored = new Set<string>()
    let cursor: Cursor = { newest: head, oldest: head + 1n }
    let guard = 0
    while (guard++ < 2000 && !(cursor.oldest === 0n && head - cursor.newest <= BigInt(LAG))) {
      if (rand() < 0.2) { const grow = BigInt(Math.floor(rand() * 50)); for (let b = head + 1n; b <= head + grow; b++) if (rand() < 0.05) truth.set(`0x${b}:0`, b); head += grow }
      // both workers read the SAME checkpoint, with different range sizes
      const plans = [planStep(cursor, head, 300, LAG, false), planStep(cursor, head, 700, LAG, rand() < 0.3)].filter((p) => p !== null)
      const order = rand() < 0.5 ? plans : [...plans].reverse()
      for (const plan of order) {
        if (rand() < 0.2) continue // that worker's RPC call failed
        for (const [key, block] of truth) if (block >= plan.from && block <= plan.to) stored.add(key)
        cursor = applyStep(cursor, plan)
      }
    }
    expect(cursor.oldest).toBe(0n)
    for (const [key, block] of truth) if (block <= cursor.newest) expect(stored.has(key)).toBe(true)
  })
  test('applyStep never moves a checkpoint backwards (mirrors greatest()/least())', () => {
    const c: Cursor = { newest: 500n, oldest: 100n }
    expect(applyStep(c, { direction: 'forward', from: 401n, to: 450n }).newest).toBe(500n)
    expect(applyStep(c, { direction: 'backfill', from: 150n, to: 199n }).oldest).toBe(100n)
  })
})

describe('dedupeRows', () => {
  test('keeps one row per (tx hash, log index), including self transfers seen by both queries', () => {
    const row = (tx: string, i: number) => ({ tx_hash: tx, log_index: i, amount: '1' })
    expect(dedupeRows([row('0xa', 0), row('0xa', 0), row('0xa', 1), row('0xb', 0)])).toHaveLength(3)
    expect(dedupeRows([])).toEqual([])
  })
})
