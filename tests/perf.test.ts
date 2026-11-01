import { describe, expect, test } from 'bun:test'
import { buildActivity, buildAnalytics, buildHistory, filterRows, type Filters, type Snapshot } from '../src/lib/chainHistory/derive'

const W = '0x' + '11'.repeat(20)
const OTHER = '0x' + '22'.repeat(20)
const f: Filters = { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25 }

function snapshot(n: number, swaps: number, bridges: number): Snapshot {
  const transfers = Array.from({ length: n }, (_, i) => ({
    txHash: '0x' + i.toString(16).padStart(64, '0'), logIndex: i % 3, block: 28_000_000 + i * 7,
    from: i % 2 ? W : OTHER, to: i % 2 ? OTHER : W, amount: String(1_000_000 + i),
  }))
  const times = new Map<number, number>()
  for (const t of transfers) times.set(t.block, 1_700_000_000 + t.block)
  return {
    address: W, usdc: '0x3600000000000000000000000000000000000000', registry: undefined, transfers, meta: new Map(),
    swaps: Array.from({ length: swaps }, (_, i) => ({ hash: transfers[i * 3].txHash, block: transfers[i * 3].block, tokenIn: '0xa', tokenOut: '0xb', amountIn: '1', amountOut: '1', inSymbol: 'A', inDecimals: 6, outSymbol: 'B', outDecimals: 6, feeAmount: '1' })),
    bridges: Array.from({ length: bridges }, (_, i) => ({ hash: transfers[n - 1 - i].txHash, block: transfers[n - 1 - i].block, token: '0xa', amountIn: '1', symbol: 'A', decimals: 6 })),
    times, newest: 28_100_000, oldest: 27_000_000, head: 28_100_000, range: 5000, error: null, lastProgressAt: 1, pendingVerification: 0,
  } as unknown as Snapshot
}

describe('history derivations are computed once per snapshot and give the same answers', () => {
  test('rows, analytics and activity are shared between screens reading the same snapshot', () => {
    const s = snapshot(300, 20, 10)
    expect(buildActivity(s, 5042)).toBe(buildActivity(s, 5042))
    const a = buildAnalytics(s, 1_000)
    const b = buildAnalytics(s, 2_000_000)
    expect(b.totalSent).toBe(a.totalSent)
    expect(b.transactionCount).toBe(a.transactionCount)
    expect(b.monthly).toEqual(a.monthly)
    expect(a.transactionCount).toBe(300)
  })

  test('filtering still works on the shared rows and never changes them', () => {
    const s = snapshot(200, 10, 4)
    const all = filterRows(s, f)
    const out = filterRows(s, { ...f, direction: 'out' })
    const swaps = filterRows(s, { ...f, type: 'swap' })
    expect(all.length).toBe(200)
    expect(out.length).toBe(100)
    expect(out.every((r) => r.direction === 'out')).toBe(true)
    expect(swaps.length).toBe(10)
    expect(filterRows(s, { ...f, type: 'bridge' }).length).toBe(4)
    expect(filterRows(s, f).length).toBe(200)
    // newest first
    expect(all[0].blockNumber).toBeGreaterThan(all[all.length - 1].blockNumber)
    expect(buildHistory(s, { ...f, pageSize: 5 }, 1).rows.length).toBe(5)
    expect(buildHistory(s, { ...f, q: all[3].txHash }, 1).total).toBe(1)
  })

  test('a changed snapshot is recomputed, not served from the old one', () => {
    const s1 = snapshot(50, 2, 1)
    const s2 = { ...s1, transfers: [...s1.transfers, { txHash: '0x' + 'ff'.repeat(32), logIndex: 0, block: 29_000_000, from: OTHER, to: W, amount: '5' }] } as Snapshot
    ;(s2.times as Map<number, number>).set(29_000_000, 1_800_000_000)
    expect(filterRows(s1, f).length).toBe(50)
    expect(filterRows(s2, f).length).toBe(51)
  })

  test('a large history is derived quickly (10,000 transfers, five screens reading it)', () => {
    const s = snapshot(10_000, 600, 200)
    const t0 = performance.now()
    buildHistory(s, f, 1); buildHistory(s, { ...f, pageSize: 5 }, 1); buildHistory(s, { ...f, direction: 'in', pageSize: 8 }, 1); buildAnalytics(s, 1); buildActivity(s, 5042)
    const firstTick = performance.now() - t0
    const t1 = performance.now()
    for (let i = 0; i < 20; i++) { buildHistory(s, f, 1); buildHistory(s, { ...f, direction: 'in', pageSize: 8 }, 1); buildAnalytics(s, 1); buildActivity(s, 5042) }
    const repeat = (performance.now() - t1) / 20
    // Generous bounds: this took about 180 ms per tick before sharing the work.
    expect(firstTick).toBeLessThan(120)
    expect(repeat).toBeLessThan(10)
  })
})
