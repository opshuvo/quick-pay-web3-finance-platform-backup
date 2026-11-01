import { useQuery } from '@tanstack/react-query'
import { chainHead } from '@/lib/chainHistory/read'
import { fetchHealthShared } from '@/lib/chainHistory/mode'

export interface Health {
  ok: boolean
  database: 'ok' | 'unconfigured' | 'error'
  verification?: { pending: number; failing: number; lastError: string | null } | null
  rpc: 'ok' | 'error'
  rpcSource: 'proxy' | 'public'
  headBlock: number | null
  chainId: number
  /** `server`: the Quick Pay backend answered. `browser`: no backend is connected, so the block is read straight from Arc. */
  mode?: 'server' | 'browser'
}

/** Backend health. When the service is unreachable the UI says so instead of showing stale data. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<Health> => {
      try {
        return { ...(await fetchHealthShared<Health>()), mode: 'server' }
      } catch (error) {
        if (signal?.aborted) throw error
        // No backend answered: report what can still be verified, the Arc RPC itself.
        const headBlock = await chainHead()
        return { ok: true, database: 'unconfigured', rpc: 'ok', rpcSource: 'public', headBlock, chainId: 5042, mode: 'browser' }
      }
    },
  })
}
