/**
 * Arc Mainnet constants. Every value is derived from the generated
 * `@/onchain-facts` registry, never typed by hand.
 */
import { defineChain, type Address } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl, getUsdc, requireChain } from '@/onchain-facts'

export const ARC_CHAIN_ID = 5042 as const

const facts = requireChain(ARC_CHAIN_ID)
const usdcFact = getUsdc(ARC_CHAIN_ID)
if (!usdcFact) throw new Error('USDC is missing for Arc in onchain-facts')

export const ARC_RPC_URL = facts.rpcUrls[0]
export const ARC_EXPLORER = facts.explorerBase
export const ARC_USDC: Address = usdcFact.address as Address
export const ARC_USDC_DECIMALS = usdcFact.decimals

export const arcMainnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: facts.nativeCurrency.decimals },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: ARC_EXPLORER } },
})

export const arcTxUrl = (hash: string) => buildTxExplorerUrl(ARC_CHAIN_ID, hash)
export const arcAddressUrl = (address: string) => buildAddressExplorerUrl(ARC_CHAIN_ID, address)

/** Arc's base fee never drops below 20 gwei; a lower cap is rejected or silently dropped. */
export const ARC_MIN_FEE_PER_GAS = 20_000_000_000n
