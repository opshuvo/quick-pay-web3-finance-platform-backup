import { createElement } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Repeat2, Waypoints, type LucideIcon } from 'lucide-react'
import { ExplorerLink, StatusBadge } from '@/components/ui'
import { arcTxUrl } from '@/lib/arc'
import { displayUsdc, formatDateTime, shortAddress, shortHash } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistory'

export const TYPE_LABEL: Record<HistoryRow['type'], string> = {
  transfer: 'Transfer',
  request_payment: 'Request payment',
  swap: 'Swap',
  bridge: 'Bridge',
}

export function rowIcon(row: HistoryRow): LucideIcon {
  if (row.type === 'swap') return ArrowLeftRight
  if (row.type === 'bridge') return Waypoints
  if (row.direction === 'self') return Repeat2
  return row.direction === 'in' ? ArrowDownLeft : ArrowUpRight
}

export function rowTitle(row: HistoryRow): string {
  if (row.type === 'swap') return 'Swap (Uniswap)'
  if (row.type === 'bridge') return 'Bridge (Across)'
  if (row.direction === 'self') return 'Self transfer'
  return row.direction === 'in' ? 'Received' : 'Sent'
}

/** One verified USDC transfer. Selecting it opens the detail drawer; the explorer link opens the chain explorer. */
export function TxRow({ row, onSelect }: { row: HistoryRow; onSelect?: (row: HistoryRow) => void }) {
  const incoming = row.direction === 'in'
  const self = row.direction === 'self'
  const counterparty = incoming ? row.from : row.to
  const tone = self ? 'var(--muted)' : incoming ? 'var(--success)' : 'var(--ink-2)'
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-strong)', color: tone, boxShadow: 'inset 0 0 0 1px var(--border)' }}>
        {createElement(rowIcon(row), { className: 'size-[18px]', 'aria-hidden': true })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
          {rowTitle(row)}
          {!self && <span className="mono truncate text-xs font-medium" style={{ color: 'var(--muted)' }}>{incoming ? 'from' : 'to'} {shortAddress(counterparty)}</span>}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
          {formatDateTime(row.timestamp)}
          {row.type === 'request_payment' && <StatusBadge tone="neutral">Request payment</StatusBadge>}
          <span className="mono hidden md:inline" style={{ color: 'var(--subtle)' }}>{shortHash(row.txHash)}</span>
        </span>
      </span>
      <span className="hidden sm:block"><StatusBadge tone="success">Confirmed</StatusBadge></span>
      <span className="display w-[7.5rem] shrink-0 text-right text-sm font-bold tabular-nums sm:w-32" style={{ color: incoming ? 'var(--success)' : 'var(--ink)' }}>
        {self ? '' : incoming ? '+' : '−'}
        {displayUsdc(BigInt(row.amount))}
        <span className="ml-1 text-[11px] font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
      </span>
    </>
  )
  return (
    <li className="flex items-center gap-2 py-2">
      {onSelect ? (
        <button type="button" onClick={() => onSelect(row)} aria-label={`${rowTitle(row)} ${displayUsdc(BigInt(row.amount))} USDC, open details`} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-[var(--surface)]">
          {body}
        </button>
      ) : (
        <div className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-2">{body}</div>
      )}
      <span className="hidden shrink-0 sm:block"><ExplorerLink href={arcTxUrl(row.txHash)}>Tx</ExplorerLink></span>
    </li>
  )
}
