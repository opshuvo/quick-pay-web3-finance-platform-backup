import { ArrowLeftRight, Waypoints } from 'lucide-react'
import { EmptyState, ErrorState, ExplorerLink, Skeleton, StatusBadge } from '@/components/ui'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useActivity, type ActivityDto } from '@/lib/activity'
import { isBackendMissing, isServiceDown } from '@/lib/api'
import { displayUnits, formatDateTime, shortAddress } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { acrossApi } from '@/lib/across'
import { chainLabel, explorerTxUrl } from '@/lib/chains'

export function activityState(a: ActivityDto): { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral' } {
  if (a.kind === 'swap') return { label: 'Confirmed on-chain', tone: 'success' }
  // Read from the Arc receipt only: the destination chain was not checked, so it is never called complete.
  if (a.kind === 'bridge' && a.destinationChainId === 0) return { label: 'Deposit confirmed on Arc', tone: 'neutral' }
  if (a.status === 'filled' && a.destinationVerified) return { label: 'Complete', tone: 'success' }
  if (a.status === 'filled') return { label: 'Filled, verifying destination', tone: 'warn' }
  if (a.status === 'expired') return { label: 'Expired', tone: 'danger' }
  if (a.status === 'refunded') return { label: 'Refunded', tone: 'neutral' }
  return { label: 'In transit', tone: 'warn' }
}

const amount = (raw: string | null, decimals: number | null, symbol: string | null) =>
  raw === null ? null : `${displayUnits(BigInt(raw), decimals ?? 6, 2, 6)} ${symbol ?? ''}`.trim()

function Item({ a, chains }: { a: ActivityDto; chains?: Parameters<typeof chainLabel>[0] }) {
  const state = activityState(a)
  const Icon = a.kind === 'swap' ? ArrowLeftRight : Waypoints
  const spent = amount(a.amountIn, a.tokenInDecimals, a.tokenInSymbol ?? (a.tokenIn ? shortAddress(a.tokenIn, 6, 4) : null))
  const got = amount(a.amountOut, a.tokenOutDecimals, a.tokenOutSymbol ?? (a.tokenOut ? shortAddress(a.tokenOut, 6, 4) : null))
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--surface-strong)' }}><Icon className="size-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {a.kind === 'swap' ? 'Swap' : a.destinationChainId === 0 ? `Bridge from ${chainLabel(chains, a.sourceChainId)}` : `Bridge ${chainLabel(chains, a.sourceChainId)} → ${chainLabel(chains, a.destinationChainId)}`}
        </p>
        <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
          {spent}{got ? ` → ${got}` : a.expectedAmountOut ? ` → expected ${amount(a.expectedAmountOut, a.tokenOutDecimals, a.tokenOutSymbol)} (not yet received)` : ''}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
          {formatDateTime(a.timestamp)}
          {explorerTxUrl(chains, a.sourceChainId, a.sourceTxHash) && <ExplorerLink href={explorerTxUrl(chains, a.sourceChainId, a.sourceTxHash) as string}>Source tx</ExplorerLink>}
          {a.kind === 'bridge' && a.destinationTxHash && explorerTxUrl(chains, a.destinationChainId, a.destinationTxHash) && <ExplorerLink href={explorerTxUrl(chains, a.destinationChainId, a.destinationTxHash) as string}>Destination tx</ExplorerLink>}
        </p>
      </div>
      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
    </li>
  )
}

/** Verified Swap/Bridge records for the connected wallet. Nothing appears here until the chain confirmed it. */
export function ActivityList({ kind, title }: { kind?: 'swap' | 'bridge'; title: string }) {
  const { address } = useArcWallet()
  const query = useActivity(address, kind)
  const chains = useQuery({ queryKey: ['across-chains'], staleTime: 5 * 60_000, retry: 1, queryFn: acrossApi.chains })
  return (
    <section className="card p-5" aria-labelledby={`activity-${kind ?? 'all'}`}>
      <h2 id={`activity-${kind ?? 'all'}`} className="display mb-1 text-base font-semibold">{title}</h2>
      <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>Saved only after the transaction was read back from the chain.</p>
      {!address ? (
        <EmptyState title="Connect your wallet" body="Your verified activity appears here once connected." />
      ) : query.isLoading ? (
        <Skeleton className="h-24" />
      ) : query.isError ? (
        <ErrorState title="Activity unavailable" body={isBackendMissing(query.error) ? 'Verified swap and bridge activity is saved by the Quick Pay backend, which is not connected to this deployment yet. Your transactions are not lost: they are on-chain.' : isServiceDown(query.error) ? 'The history service is not reachable right now.' : 'Could not load your activity.'} onRetry={() => void query.refetch()} />
      ) : query.data && query.data.length > 0 ? (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>{query.data.map((a) => <Item key={a.id} a={a} chains={chains.data} />)}</ul>
      ) : (
        <EmptyState title="Nothing yet" body={kind === 'bridge' ? 'Bridges you complete here are listed once Across and the chains confirm them.' : 'Swaps you complete here are listed once they are confirmed on Arc.'} />
      )}
    </section>
  )
}
