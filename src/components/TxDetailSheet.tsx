import { Link } from 'react-router-dom'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { rowTitle, TYPE_LABEL } from '@/components/TxRow'
import { CopyButton, ExplorerLink, Row, StatusBadge } from '@/components/ui'
import type { HistoryRow } from '@/hooks/useHistory'
import { arcAddressUrl, arcTxUrl } from '@/lib/arc'
import { displayUsdc, formatDateTime, formatNumber } from '@/lib/format'

function AddressLine({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <a className="mono break-all text-xs underline" href={arcAddressUrl(address)} target="_blank" rel="noopener noreferrer">{address}</a>
      <CopyButton value={address} label="Copy address" className="!size-8 shrink-0" />
    </span>
  )
}

/** Full detail for one indexed transfer. Every field comes from the indexed Arc log. */
export function TxDetailSheet({ row, onClose }: { row: HistoryRow | null; onClose: () => void }) {
  return (
    <ConfirmSheet open={Boolean(row)} onClose={onClose} title="Transaction details">
      {row && (
        <div>
          <div className="mb-4 text-center">
            <p className="label">{rowTitle(row)}</p>
            <p className="display mt-1 text-4xl font-bold tabular-nums" style={{ color: row.direction === 'in' ? 'var(--success)' : 'var(--ink)' }}>
              {row.direction === 'in' ? '+' : row.direction === 'out' ? '−' : ''}
              {displayUsdc(BigInt(row.amount))}
            </p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>USDC on Arc Mainnet</p>
            <div className="mt-2"><StatusBadge tone="success">Confirmed · {formatNumber(row.confirmations)} confirmations</StatusBadge></div>
          </div>
          <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
            <Row label="Type">{TYPE_LABEL[row.type]}</Row>
            <Row label="Time">{formatDateTime(row.timestamp)}</Row>
            <Row label="Block">{formatNumber(row.blockNumber)}</Row>
            <Row label="From"><AddressLine address={row.from} /></Row>
            <Row label="To"><AddressLine address={row.to} /></Row>
            <Row label="Transaction">
              <span className="inline-flex items-center gap-1">
                <span className="mono break-all text-xs">{row.txHash}</span>
                <CopyButton value={row.txHash} label="Copy transaction hash" className="!size-8 shrink-0" />
              </span>
            </Row>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <ExplorerLink href={arcTxUrl(row.txHash)}>View on explorer</ExplorerLink>
            {row.requestId && <Link className="text-sm font-semibold underline" onClick={onClose} to={`/pay/${row.requestId}`}>Open payment request</Link>}
          </div>
        </div>
      )}
    </ConfirmSheet>
  )
}
