import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { recordConfirmedTx } from '@/lib/chainHistory/record'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { BridgeProgress } from '@/components/BridgeProgress'
import { isTerminal, trackedSummary, type Tracked } from '@/lib/bridgeStatus'
import { ExplorerLink, StatusBadge } from '@/components/ui'
import { activityApi } from '@/lib/activity'
import { acrossApi, type AcrossChain } from '@/lib/across'
import { ApiError, isServiceDown } from '@/lib/api'
import type { StoredBridge } from '@/lib/bridgeStore'
import { chainLabel, explorerTxUrl } from '@/lib/chains'
import { displayUnits, formatDateTime } from '@/lib/format'

/** Tracks one bridge: verified record from the history service, falling back to Across's own status. */
export function BridgeTracker({ item, chains, expanded }: { item: StoredBridge; chains?: AcrossChain[]; expanded?: boolean }) {
  const tracked = useQuery<Tracked>({
    queryKey: ['bridge-track', item.hash],
    retry: false,
    refetchInterval: (query) => (isTerminal(query.state.data) ? false : 6_000),
    queryFn: async () => {
      try {
        const refreshed = await activityApi.refreshBridge(item.hash, item.originChainId)
        if (refreshed.activity) return { source: 'verified', activity: refreshed.activity }
        if (item.inputToken && item.outputToken && item.recipient && item.expectedOutput) {
          const recorded = await activityApi.recordBridge({
            txHash: item.hash,
            wallet: item.wallet ?? '',
            originChainId: item.originChainId,
            inputToken: item.inputToken,
            outputToken: item.outputToken,
            recipient: item.recipient,
            expectedOutput: item.expectedOutput,
            feeAmount: item.feeAmount ?? '0',
            inputSymbol: item.inputSymbol ?? item.symbol,
            inputDecimals: item.inputDecimals ?? 6,
            outputSymbol: item.outputSymbol ?? item.symbol,
            outputDecimals: item.outputDecimals ?? 6,
          })
          return recorded.recorded ? { source: 'verified', activity: recorded.activity } : { source: 'waiting', reason: recorded.reason }
        }
        return { source: 'waiting', reason: 'No quote details were saved on this device for this transfer.' }
      } catch (error) {
        if (!isServiceDown(error)) throw error
        try {
          return { source: 'across', status: await acrossApi.status(item.hash) }
        } catch (inner) {
          if (inner instanceof ApiError && inner.status === 404) return { source: 'waiting', reason: 'Across has not indexed the deposit yet.' }
          throw inner
        }
      }
    },
  })
  const summary = trackedSummary(tracked.data)
  const activity = tracked.data?.source === 'verified' ? tracked.data.activity : undefined
  const destHash = activity?.destinationTxHash ?? (tracked.data?.source === 'across' ? tracked.data.status?.fillTxnRef : undefined)
  // A bridge that arrived on Arc: its delivery is read from Arc and listed in History as a bridge, not as a plain receipt.
  const queryClient = useQueryClient()
  const listed = useRef<string | null>(null)
  const delivered = tracked.data?.source === 'verified' ? (activity?.status === 'filled' && activity.destinationVerified) : tracked.data?.source === 'across' && tracked.data.status?.status === 'filled'
  useEffect(() => {
    if (!delivered || !destHash || !item.wallet || item.destinationChainId !== ARC_CHAIN_ID || listed.current === destHash) return
    listed.current = destHash
    void recordConfirmedTx({ address: item.wallet, hash: destHash, queryClient, bridgeFill: true })
  }, [delivered, destHash, item.wallet, item.destinationChainId, queryClient])
  const sentUrl = explorerTxUrl(chains, item.originChainId, item.hash)
  const gotUrl = destHash ? explorerTxUrl(chains, item.destinationChainId, destHash) : undefined

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.amount} {item.symbol} · {chainLabel(chains, item.originChainId)} → {chainLabel(chains, item.destinationChainId)}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{formatDateTime(item.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={tracked.isError ? 'neutral' : summary.tone}>{tracked.isError ? 'Status unavailable' : summary.label}</StatusBadge>
          {sentUrl && <ExplorerLink href={sentUrl}>Sent</ExplorerLink>}
          {gotUrl && <ExplorerLink href={gotUrl}>Received</ExplorerLink>}
        </div>
      </div>
      {(expanded || !isTerminal(tracked.data)) && !tracked.isError && (
        <div className="mt-3"><BridgeProgress steps={summary.steps} /></div>
      )}
      {activity?.amountOut && activity.destinationVerified && (
        <p className="mt-2 text-xs" style={{ color: 'var(--success)' }}>
          Received {displayUnits(BigInt(activity.amountOut), activity.tokenOutDecimals ?? 6, 2, 6)} {activity.tokenOutSymbol ?? ''} (read from the destination transaction)
        </p>
      )}
    </li>
  )
}
