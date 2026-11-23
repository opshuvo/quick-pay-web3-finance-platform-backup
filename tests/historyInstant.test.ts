import { beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_FILTERS, narrowRows, rememberHistory, storedHistory, type HistoryResponse } from '../src/hooks/useHistory'
import type { HistoryRow } from '../shared/api-types'

const row = (i: number, patch: Partial<HistoryRow> = {}): HistoryRow => ({
  txHash: `0x${i.toString(16).padStart(64, '0')}`, logIndex: 0, blockNumber: String(100 - i), timestamp: new Date(1_700_000_000_000 - i * 1000).toISOString(),
  from: '0x1', to: '0x2', token: '0x3600000000000000000000000000000000000000', amount: '1000000', symbol: 'USDC', decimals: 6,
  direction: 'out', type: 'transfer', status: 'confirmed', confirmations: 5, ...patch,
}) as HistoryRow

const response = (rows: HistoryRow[]): HistoryResponse => ({
  rows, total: rows.length, page: 1, pageSize: 20, nextCursor: 'abc',
  coverage: { status: 'complete', percent: 100, source: 'server' } as HistoryResponse['coverage'],
})

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  }
})

describe('switching tabs never blanks the list', () => {
  const all = response([row(0), row(1, { direction: 'in' }), row(2, { type: 'swap' }), row(3, { direction: 'in', type: 'bridge' })])

  test('Sent and Received show the matching rows of the wider view at once, in the same order', () => {
    const sent = narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, direction: 'out', status: 'confirmed' })
    expect(sent?.rows.map((r) => r.txHash)).toEqual([row(0).txHash, row(2).txHash])
    const received = narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, direction: 'in', status: 'confirmed' })
    expect(received?.rows).toHaveLength(2)
    expect(received?.nextCursor).toBeUndefined()
  })

  test('a type tab narrows by type', () => {
    expect(narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, type: 'swap' })?.rows).toHaveLength(1)
  })

  test('nothing is guessed: searches, dates, paging, widening and empty matches fall back to loading', () => {
    expect(narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, q: '0xabc' })).toBeUndefined()
    expect(narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, since: '2026-01-01' })).toBeUndefined()
    expect(narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, page: 2, cursor: 'x' })).toBeUndefined()
    expect(narrowRows(all, { ...DEFAULT_FILTERS, type: 'swap' }, DEFAULT_FILTERS)).toBeUndefined()
    expect(narrowRows(all, DEFAULT_FILTERS, { ...DEFAULT_FILTERS, type: 'request_payment' })).toBeUndefined()
    expect(narrowRows(undefined, DEFAULT_FILTERS, DEFAULT_FILTERS)).toBeUndefined()
  })
})

describe('a reload shows the last real answer at once', () => {
  const wallet = '0xAbC0000000000000000000000000000000000001'

  test('the last first page is replayed for the same wallet and view only', () => {
    rememberHistory(wallet, DEFAULT_FILTERS, response([row(0), row(1)]))
    expect(storedHistory(wallet, DEFAULT_FILTERS)?.data.rows).toHaveLength(2)
    expect(storedHistory(wallet.toLowerCase(), DEFAULT_FILTERS)?.data.rows).toHaveLength(2)
    expect(storedHistory('0xdef', DEFAULT_FILTERS)).toBeUndefined()
    expect(storedHistory(wallet, { ...DEFAULT_FILTERS, type: 'swap' })).toBeUndefined()
  })

  test('pending and failed rows are never replayed, only confirmed ones', () => {
    rememberHistory(wallet, DEFAULT_FILTERS, response([row(0, { status: 'pending' }), row(1), row(2, { status: 'failed' })]))
    expect(storedHistory(wallet, DEFAULT_FILTERS)?.data.rows.map((r) => r.status)).toEqual(['confirmed'])
  })

  test('later pages and big pages are not stored', () => {
    rememberHistory(wallet, { ...DEFAULT_FILTERS, page: 2, cursor: 'x' }, response([row(0)]))
    rememberHistory(wallet, { ...DEFAULT_FILTERS, pageSize: 100 }, response([row(0)]))
    expect(storedHistory(wallet, { ...DEFAULT_FILTERS, page: 2, cursor: 'x' })).toBeUndefined()
    expect(storedHistory(wallet, { ...DEFAULT_FILTERS, pageSize: 100 })).toBeUndefined()
  })

  test('only the 12 most recent views are kept per wallet, and broken storage is ignored', () => {
    for (let i = 0; i < 15; i++) rememberHistory(wallet, { ...DEFAULT_FILTERS, q: `0x${i}abc` }, response([row(i)]))
    expect(Object.keys(JSON.parse(memory.get(`quickpay.history.v1:${wallet.toLowerCase()}`) ?? '{}'))).toHaveLength(12)
    memory.set(`quickpay.history.v1:${wallet.toLowerCase()}`, '{not json')
    expect(storedHistory(wallet, DEFAULT_FILTERS)).toBeUndefined()
  })
})
