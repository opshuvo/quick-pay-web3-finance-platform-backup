import { config } from '@/config'
import type { AcrossChain } from '@/lib/across'
import { ARC_CHAIN_ID, arcTxUrl } from '@/lib/arc'

/** Chain name from Across's live list, falling back to the wallet config, then the bare id. */
export function chainLabel(chains: AcrossChain[] | undefined, chainId: number): string {
  return chains?.find((c) => c.chainId === chainId)?.name ?? config.chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`
}

export function explorerTxUrl(chains: AcrossChain[] | undefined, chainId: number, hash: string): string | undefined {
  if (chainId === ARC_CHAIN_ID) return arcTxUrl(hash)
  const base = chains?.find((c) => c.chainId === chainId)?.explorerUrl ?? config.chains.find((c) => c.id === chainId)?.blockExplorers?.default.url
  return base ? `${base.replace(/\/$/, '')}/tx/${hash}` : undefined
}
