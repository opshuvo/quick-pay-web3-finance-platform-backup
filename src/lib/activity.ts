import { useQuery } from '@tanstack/react-query'
import type { ActivityDto } from '../../shared/api-types'
import { api } from '@/lib/api'

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
    retry: false,
    refetchInterval: 20_000,
    queryFn: async ({ signal }) => {
      const { activity } = await activityApi.list((address as string).toLowerCase(), signal)
      return kind ? activity.filter((a) => a.kind === kind) : activity
    },
  })
}
