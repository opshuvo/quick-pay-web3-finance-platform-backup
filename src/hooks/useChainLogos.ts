import { useQuery } from '@tanstack/react-query'
import { acrossApi, cachedChains } from '@/lib/across'
import { lifiApi } from '@/lib/lifi'

/**
 * Network logos as the providers publish them (LI.FI first, Across to fill gaps), shared by every chain badge on the
 * Bridge screen. One request serves them all, and the last Across list is remembered on this device, so a badge never
 * waits on the network to show something sensible.
 */
export function useChainLogos(): ReadonlyMap<number, string> {
  const cached = cachedChains()?.data
  const query = useQuery({
    queryKey: ['chain-logos'],
    staleTime: 24 * 60 * 60_000,
    retry: 1,
    initialData: cached ? new Map(cached.filter((c) => c.logoUrl).map((c) => [c.chainId, c.logoUrl as string])) : undefined,
    queryFn: async () => {
      const logos = new Map<number, string>()
      const [lifi, across] = await Promise.allSettled([lifiApi.chains(), acrossApi.chains()])
      if (across.status === 'fulfilled') for (const c of across.value) if (c.logoUrl) logos.set(c.chainId, c.logoUrl)
      // LI.FI's artwork is the more complete set, so it wins where both have one.
      if (lifi.status === 'fulfilled') for (const c of lifi.value) if (c.logoUrl) logos.set(c.chainId, c.logoUrl)
      if (logos.size === 0) throw new Error('No chain logos available')
      return logos
    },
  })
  return query.data ?? EMPTY
}

const EMPTY: ReadonlyMap<number, string> = new Map()
