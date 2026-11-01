import type { Address } from 'viem'
import { ARC_USDC } from '@/lib/arc'
import { env } from '@/lib/env'

/**
 * Tokens FlowPay lists in Swap on Arc Mainnet (chain 5042). Addresses come from Circle's published Arc
 * contract addresses (https://docs.arc.io/arc/references/contract-addresses.md). The expected symbol and
 * decimals are only a cross-check: the list still reads every value from the token's own contract and drops
 * a token whose contract does not answer with exactly these. Nothing here is a price or a balance.
 *
 * USYC is deliberately not listed: it is a permissioned fund token that only allowlisted institutions can hold.
 */
export interface OfficialToken {
  id: string
  label: string
  address: Address
  expectedSymbol: string
  expectedDecimals: number
}

export const OFFICIAL_ARC_TOKENS: OfficialToken[] = [
  { id: 'usdc', label: 'USDC', address: ARC_USDC, expectedSymbol: 'USDC', expectedDecimals: 6 },
  { id: 'eurc', label: 'EURC', address: env.eurcAddress ?? '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', expectedSymbol: 'EURC', expectedDecimals: 6 },
  { id: 'cirbtc', label: 'cirBTC', address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', expectedSymbol: 'cirBTC', expectedDecimals: 8 },
  { id: 'weth', label: 'WETH', address: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB', expectedSymbol: 'WETH', expectedDecimals: 18 },
]

/** Default receive token: the first listed token that is not USDC. */
export const DEFAULT_RECEIVE_TOKEN: Address = (OFFICIAL_ARC_TOKENS.find((t) => t.id !== 'usdc') as OfficialToken).address
