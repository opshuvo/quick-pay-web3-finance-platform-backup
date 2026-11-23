import { createElement, memo } from 'react'
import { ExternalLink } from 'lucide-react'
import { CopyButton, StatusBadge } from '@/components/ui'
import { rowAmount, rowIcon, rowTitle } from '@/components/TxRow'
import { arcTxUrl } from '@/lib/arc'
import { formatDateTime, shortAddress, shortHash } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistory'

const STATUS: Record<HistoryRow['status'], { label: string; tone: 'success' | 'warn' | 'danger' }> = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
}

const Line = memo(function Line({ row, onSelect }: { row: HistoryRow; onSelect: (row: HistoryRow) => void }) {
  const incoming = row.direction === 'in'
  const self = row.direction === 'self'
  const counterparty = incoming ? row.from : row.to
  const amount = rowAmount(row)
  const status = STATUS[row.status]
  return (
    <tr tabIndex={0} onClick={() => onSelect(row)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(row))} aria-label={`${rowTitle(row)} ${amount.text} ${amount.symbol}, open details`}>
      <td>
        <span className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--surface-strong)', color: 'var(--ink-2)' }}>
            {createElement(rowIcon(row), { className: 'size-4', 'aria-hidden': true })}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{rowTitle(row)}</span>
            {row.type === 'request_payment' && <span className="block text-xs" style={{ color: 'var(--muted)' }}>Request payment</span>}
          </span>
        </span>
      </td>
      <td className="mono text-xs" style={{ color: 'var(--ink-2)' }} title={counterparty}>{self ? '—' : `${incoming ? 'From' : 'To'} ${shortAddress(counterparty)}`}</td>
      <td className="whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>{formatDateTime(row.timestamp)}</td>
      <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
      <td className="num whitespace-nowrap font-semibold tabular-nums" style={{ color: row.status === 'failed' ? 'var(--subtle)' : incoming ? 'var(--success)' : 'var(--ink)' }}>
        {self || row.status === 'failed' ? '' : incoming ? '+' : '−'}{amount.text}
        <span className="ml-1 text-[11px] font-medium" style={{ color: 'var(--subtle)' }}>{amount.symbol}</span>
      </td>
      <td className="num whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-0.5">
          <span className="mono mr-1 text-xs" style={{ color: 'var(--subtle)' }}>{shortHash(row.txHash)}</span>
          <a href={arcTxUrl(row.txHash)} target="_blank" rel="noopener noreferrer" aria-label="View transaction on Arc Explorer (opens in a new tab)" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-[var(--surface-strong)]" style={{ color: 'var(--accent)' }}>
            <ExternalLink className="size-4" aria-hidden />
          </a>
          <CopyButton value={row.txHash} label="Copy transaction hash" className="!size-9" />
        </span>
      </td>
    </tr>
  )
})

/** Wide-screen transaction table: the same rows as the mobile list, in columns. */
export function TxTable({ rows, onSelect }: { rows: HistoryRow[]; onSelect: (row: HistoryRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="tx-table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Counterparty</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col" className="num">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <Line key={`${row.txHash}-${row.logIndex}`} row={row} onSelect={onSelect} />)}
        </tbody>
      </table>
    </div>
  )
}
