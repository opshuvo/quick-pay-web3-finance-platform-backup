import { Database } from 'lucide-react'
import { Notice } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import type { Coverage as CoverageData } from '@/hooks/useHistory'

/** What a "complete" history does NOT include. Shown with every complete result so it is never read as "everything". */
export const COVERAGE_SCOPE = 'Covers USDC token transfers only. Native-value transfers, pending transactions and failed transactions are not included.'

export function describeStall(msSinceProgress: number | null): string {
  if (msSinceProgress === null) return 'No new blocks have been scanned recently.'
  const minutes = Math.max(1, Math.round(msSinceProgress / 60_000))
  return `No new blocks have been scanned for about ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

/**
 * Tells the truth about indexing. "Complete" appears only when the USDC token transfer backfill reached block 0,
 * and it always states what is not covered.
 */
export function CoverageNotice({ coverage }: { coverage: CoverageData }) {
  if (coverage.status === 'complete') {
    return (
      <Notice tone="success">
        <span className="inline-flex items-center gap-2"><Database className="size-4" aria-hidden /> <strong>USDC token transfers complete:</strong> indexed from block 0 to block {formatNumber(coverage.headBlock)}.</span>
        <span className="mt-1 block text-xs">{COVERAGE_SCOPE}</span>
      </Notice>
    )
  }
  if (coverage.status === 'unregistered') {
    return <Notice tone="info"><strong>Starting to index this wallet.</strong> Nothing has been scanned yet, so no history is shown. {COVERAGE_SCOPE}</Notice>
  }
  const scanned = coverage.oldestScannedBlock === null ? 'nothing scanned yet' : `blocks ${formatNumber(coverage.oldestScannedBlock)} to ${formatNumber(coverage.newestScannedBlock ?? 0)}`
  const detail = `Scanned ${scanned} of ${formatNumber(coverage.headBlock)} blocks, ${formatNumber(coverage.blocksRemaining)} remaining. Older activity may not be shown yet, so totals and the list can be incomplete.`
  const source = `Speed depends on the RPC endpoint (${coverage.rpc === 'proxy' ? 'keyed' : 'public'}).`
  if (coverage.stalled) {
    return (
      <Notice tone="warn">
        <strong>Indexing looks stalled ({coverage.percent.toFixed(2)}% scanned).</strong> {describeStall(coverage.msSinceProgress)} {detail}
        {coverage.error ? ` Last indexer error: ${coverage.error}` : ''} {source} {COVERAGE_SCOPE}
      </Notice>
    )
  }
  return (
    <Notice tone={coverage.error ? 'warn' : 'info'}>
      <strong>Backfill in progress ({coverage.percent.toFixed(2)}%).</strong> {detail}
      {coverage.error ? ` Indexer note: ${coverage.error}` : ''} {source} {COVERAGE_SCOPE}
    </Notice>
  )
}

/**
 * Subtle, non-technical note for Overview and Transaction History. No progress numbers or block ranges:
 * it only says whether older activity may be missing and what the list covers.
 */
export function HistoryHint({ coverage }: { coverage: CoverageData }) {
  const partial = coverage.status !== 'complete'
  return (
    <p className="text-xs" style={{ color: 'var(--muted)' }} role="note">
      {partial ? 'History is still syncing, so older activity may not be shown yet.' : 'Shows USDC token transfers.'}
    </p>
  )
}
