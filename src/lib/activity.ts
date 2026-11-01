import { useQuery } from '@tanstack/react-query'
import type { ActivityDto } from '../../shared/api-types'
import { api } from '@/lib/api'
import { chainActivity } from '@/lib/chainHistory/read'
import { historyServerUsable } from '@/lib/chainHistory/mode'
import { retryDelay } from '@/lib/arcRpc'

export type { ActivityDto }

export const activityApi = {
  list: (address: string, signal?: AbortSignal) => api<{ activity: ActivityDto[] }>(`/activity/${address}`, { signal }),
  recordSwap: (txHash: string) => api<ActivityDto>('/activity/swap', { method: 'POST', body: { txHash } }),
  recordBridge: (body: {
    txHash: string
    wallet: string
    originChainId: number
    inputToken: string
    outputToken: string
    recipient: string
    expectedOutput: string
    feeAmount: string
    inputSymbol: string
    inputDecimals: number
    outputSymbol: string
    outputDecimals: number
  }) => api<{ recorded: false; reason: string } | { recorded: true; activity: ActivityDto }>('/activity/bridge', { method: 'POST', body }),
  refreshBridge: (txHash: string, originChainId: number) =>
    api<{ activity: ActivityDto | null }>('/activity/bridge/refresh', { method: 'POST', body: { txHash, originChainId } }),
}

/** Verified swaps and bridges for a wallet, from the Quick Pay history service. */
export function useActivity(address: string | undefined, kind?: 'swap' | 'bridge') {
  return useQuery({
    queryKey: ['activity', address, kind],
    enabled: Boolean(address),
    retry: 2,
    retryDelay,
    refetchInterval: 8_000,
    queryFn: async ({ signal }) => {
      const wallet = (address as string).toLowerCase()
      // Without a history server, swaps and bridges are rebuilt from verified receipts read straight from Arc.
      const activity = (await historyServerUsable()) ? (await activityApi.list(wallet, signal)).activity : await chainActivity(wallet)
      return kind ? activity.filter((a) => a.kind === kind) : activity
    },
  })
}
