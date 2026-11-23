import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TxTable } from '../src/components/TxTable'
import type { HistoryRow } from '../shared/api-types'

const row = (i: number, patch: Partial<HistoryRow> = {}): HistoryRow => ({
  txHash: `0x${i.toString(16).padStart(64, 'a')}`, logIndex: i, blockNumber: String(100 - i), timestamp: new Date(1_700_000_000_000 - i * 60_000).toISOString(),
  from: '0x1111111111111111111111111111111111111111', to: '0x2222222222222222222222222222222222222222', token: '0x3600000000000000000000000000000000000000',
  amount: '12500000', symbol: 'USDC', decimals: 6, direction: 'out', type: 'transfer', status: 'confirmed', confirmations: 5, ...patch,
}) as HistoryRow

describe('the History table', () => {
  test('has real column headers and one row per transaction', () => {
    const html = renderToStaticMarkup(<TxTable rows={[row(1), row(2, { direction: 'in' })]} onSelect={() => undefined} />)
    for (const head of ['Type', 'Counterparty', 'Date', 'Status', 'Amount', 'Transaction']) expect(html).toContain(`>${head}</th>`)
    expect((html.match(/<tr tabindex="0"/g) ?? []).length).toBe(2)
  })

  test('shows the real status and sign of each row, and never a plus on a failed payment', () => {
    const html = renderToStaticMarkup(<TxTable rows={[row(1, { status: 'pending' }), row(2, { status: 'failed' }), row(3, { direction: 'in' }), row(4)]} onSelect={() => undefined} />)
    expect(html).toContain('Pending')
    expect(html).toContain('Failed')
    expect(html).toContain('Confirmed')
    expect(html).toContain('+12.50')
    expect(html).toContain('−12.50')
    expect(html.match(/[+−]12\.50/g)?.length).toBe(3)
  })

  test('every row links to the Arc explorer in a new tab', () => {
    const html = renderToStaticMarkup(<TxTable rows={[row(1)]} onSelect={() => undefined} />)
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('/tx/0x')
  })
})
