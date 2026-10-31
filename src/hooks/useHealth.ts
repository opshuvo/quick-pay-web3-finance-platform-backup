import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Health {
  ok: boolean
  database: 'ok' | 'unconfigured' | 'error'
  rpc: 'ok' | 'error'
  rpcSource: 'proxy' | 'public'
  headBlock: number | null
  chainId: number
}

/** Backend health. When the service is unreachable the UI says so instead of showing stale data. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    retry: false,
    refetchInterval: 30_000,
    queryFn: ({ signal }) => api<Health>('/health', { signal }),
  })
}
