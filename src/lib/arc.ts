/**
 * Arc Mainnet constants. Every value is derived from the generated
 * `@/onchain-facts` registry, never typed by hand.
 */
import { defineChain, isAddress, type Address } from 'viem'
import { getUsdc, requireChain } from '@/onchain-facts'

export const ARC_CHAIN_ID = 5042 as const

const facts = requireChain(ARC_CHAIN_ID)
const usdcFact = getUsdc(ARC_CHAIN_ID)
if (!usdcFact) throw new Error('USDC is missing for Arc in onchain-facts')

export const ARC_RPC_URL = facts.rpcUrls[0]
/** Arc Chain Explorer on Etherscan. Every transaction and address link in the app points here and opens in a new tab. */
export const ARC_EXPLORER = 'https://arc.etherscan.io'
export const ARC_USDC: Address = usdcFact.address as Address
export const ARC_USDC_DECIMALS = usdcFact.decimals

export const arcMainnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: facts.nativeCurrency.decimals },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Etherscan', url: ARC_EXPLORER } },
})

/** https://arc.etherscan.io/tx/{hash}. A malformed hash links to the explorer home instead of a broken page. */
export const arcTxUrl = (hash: string) => (/^0x[0-9a-fA-F]{64}$/.test(hash) ? `${ARC_EXPLORER}/tx/${hash}` : ARC_EXPLORER)
/** https://arc.etherscan.io/address/{address} */
export const arcAddressUrl = (address: string) => (isAddress(address, { strict: false }) ? `${ARC_EXPLORER}/address/${address}` : ARC_EXPLORER)

/** Arc's base fee never drops below 20 gwei; a lower cap is rejected or silently dropped. */
export const ARC_MIN_FEE_PER_GAS = 20_000_000_000n
