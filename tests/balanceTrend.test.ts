import { describe, expect, test } from 'bun:test'
import { balanceTrend } from '../src/lib/balanceTrend'
import type { HistoryRow } from '../shared/api-types'

const USDC = '0x3600000000000000000000000000000000000000'
const NOW = 1_793_500_000_000
const H = 3_600_000
const row = (hoursAgo: number, direction: 'in' | 'out' | 'self', amount: string, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  txHash: '0x' + hoursAgo.toString(16).padStart(64, '0'), logIndex: 0, blockNumber: 1, timestamp: new Date(NOW - hoursAgo * H).toISOString(), from: '0xa', to: '0xb', token: USDC, amount, direction, type: 'transfer', requestId: null, confirmations: 1, status: 'confirmed', ...extra,
})

describe('balanceTrend (24 hour balance from confirmed transfers)', () => {
  test('walks back from the live balance and reports the net change', () => {
    // now 10 USDC; received 4 six hours ago and sent 1 two hours ago => 24h ago it was 7
    const t = balanceTrend([row(2, 'out', '1000000'), row(6, 'in', '4000000')], 10_000_000n, USDC, NOW, 100)
    expect(t).not.toBeNull()
    expect(t?.change).toBe(3_000_000n)
    expect(t?.transfers).toBe(2)
    expect(t?.points[0].value).toBe(7_000_000n)
    expect(t?.points[t.points.length - 1].value).toBe(10_000_000n)
    expect(t?.truncated).toBe(false)
  })
  test('ignores pending, failed, self, older-than-24h and other-token rows', () => {
    const rows = [row(1, 'in', '5', { status: 'pending' }), row(2, 'in', '5', { status: 'failed' }), row(3, 'self', '5'), row(30, 'in', '5'), row(4, 'in', '5', { symbol: 'EURC', decimals: 6, token: '0x1' })]
    expect(balanceTrend(rows, 10n, USDC, NOW, 100)).toBeNull()
  })
  test('says so when the page is full and does not reach 24 hours back', () => {
    const rows = [row(1, 'in', '1'), row(2, 'in', '1')]
    expect(balanceTrend(rows, 10n, USDC, NOW, 2)?.truncated).toBe(true)
  })
  test('no rows means no chart', () => {
    expect(balanceTrend([], 10n, USDC, NOW, 100)).toBeNull()
  })
})
