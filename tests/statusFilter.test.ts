import { describe, expect, test } from 'bun:test'
import { filterRows, rowsFromLedger, type Filters, type Snapshot } from '../src/lib/chainHistory/derive'
import type { LedgerEntry } from '../src/lib/txLedger'

const W = '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const OTHER = '0x5bacb7' + '00'.repeat(17)
const USDC = '0x3600000000000000000000000000000000000000'
const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const base: Filters = { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25 }
const entry = (n: number, status: LedgerEntry['status']): LedgerEntry => ({ hash: hash(n), wallet: W, kind: 'send', to: OTHER, token: USDC, amount: '1000000', symbol: 'USDC', decimals: 6, submittedAt: 1_793_500_000_000 + n, status })

const snapshot = (ledger: LedgerEntry[]): Snapshot => ({
  address: W, usdc: USDC, transfers: [], meta: new Map(), swaps: [], bridges: [], ledger, times: new Map(), newest: 1, oldest: 0, head: 10, range: 1000, error: null, lastProgressAt: 0, pendingVerification: 0,
})

describe('status filter (Pending and Failed tabs)', () => {
  const s = snapshot([entry(1, 'pending'), entry(2, 'failed'), entry(3, 'confirmed')])
  test('lists every status by default', () => {
    expect(filterRows(s, base)).toHaveLength(3)
    expect(filterRows(s, { ...base, status: 'all' })).toHaveLength(3)
  })
  test('pending shows only pending, failed only failed, sent only confirmed', () => {
    expect(filterRows(s, { ...base, status: 'pending' }).map((r) => r.txHash)).toEqual([hash(1)])
    expect(filterRows(s, { ...base, status: 'failed' }).map((r) => r.txHash)).toEqual([hash(2)])
    expect(filterRows(s, { ...base, direction: 'out', status: 'confirmed' }).map((r) => r.txHash)).toEqual([hash(3)])
  })
  test('ledger rows are marked local and carry the receipt status, never a guess', () => {
    const rows = rowsFromLedger(W, USDC, [entry(1, 'pending'), entry(2, 'failed')])
    expect(rows.map((r) => [r.status, r.local])).toEqual([['pending', true], ['failed', true]])
    expect(rows[0].direction).toBe('out')
  })
})
