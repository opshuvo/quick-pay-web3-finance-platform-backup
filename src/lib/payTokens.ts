import type { Address } from 'viem'
import { ARC_USDC } from '@/lib/arc'
import { OFFICIAL_ARC_TOKENS } from '@/lib/arcTokens'
import { PAY_TOKEN_DECIMALS, type PayToken } from '../../shared/tokens'

export interface PayTokenInfo {
  symbol: PayToken
  address: Address
  decimals: number
}

/** The stablecoins that can be sent or requested. Addresses are the published Arc contracts; the Send screen re-checks them on-chain. */
export function payTokenInfo(symbol: PayToken): PayTokenInfo {
  if (symbol === 'USDC') return { symbol, address: ARC_USDC, decimals: PAY_TOKEN_DECIMALS }
  const eurc = OFFICIAL_ARC_TOKENS.find((t) => t.id === 'eurc')
  if (!eurc) throw new Error('EURC is not configured')
  return { symbol, address: eurc.address, decimals: eurc.expectedDecimals }
}

export const isUsdcToken = (token: { address: string }) => token.address.toLowerCase() === ARC_USDC.toLowerCase()
