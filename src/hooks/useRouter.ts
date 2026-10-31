import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { quickPayRouterAbi } from '@/contracts/quickPayRouterAbi'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { env } from '@/lib/env'

/**
 * The QuickPayRouter address, but only after live reads on Arc confirm it has code, uses the official
 * USDC and is not paused. Otherwise `address` is undefined and sends stay plain USDC transfers.
 */
export function useRouter(): { address?: Address; isLoading: boolean } {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const configured = env.routerAddress
  const q = useQuery({
    queryKey: ['router-check', configured],
    enabled: Boolean(client && configured),
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<Address | null> => {
      if (!client || !configured) return null
      const code = await client.getCode({ address: configured })
      if (!code || code === '0x') return null
      const [usdc, paused] = await Promise.all([
        client.readContract({ address: configured, abi: quickPayRouterAbi, functionName: 'usdc' }),
        client.readContract({ address: configured, abi: quickPayRouterAbi, functionName: 'paused' }),
      ])
      if (usdc.toLowerCase() !== ARC_USDC.toLowerCase() || paused) return null
      return configured
    },
  })
  return { address: q.data ?? undefined, isLoading: Boolean(configured) && q.isLoading }
}
