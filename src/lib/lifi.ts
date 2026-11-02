/**
 * LI.FI client. Calls go through the Quick Pay backend (`/api/lifi/*`), which only forwards an allow-list of LI.FI
 * endpoints and keeps any API key server-side. A LI.FI quote is turned into the same shape the Across quote has, so the
 * Bridge screen, its safety checks and its confirmation flow are shared by both providers.
 */
import { isAddress, type Address, type Hex } from 'viem'
import { api } from '@/lib/api'
import type { AcrossChain, AcrossQuote, AcrossRoute } from '@/lib/across'
import { BridgeGuardError } from '@/lib/bridgeGuard'

export const LIFI_URL = 'https://li.fi/'

/** LI.FI quotes carry no expiry, so a quote is treated as good for this long and then refreshed. */
export const LIFI_QUOTE_TTL_S = 55

interface LifiToken { address: Address; chainId: number; symbol: string; decimals: number }

interface LifiChainDto {
  id: number
  name: string
  logoURI?: string
  diamondAddress?: Address
  metamask?: { blockExplorerUrls?: string[] }
}

export interface LifiQuote {
  id: string
  tool: string
  toolDetails?: { name?: string }
  action: { fromChainId: number; toChainId: number; fromToken: LifiToken; toToken: LifiToken; fromAmount: string; fromAddress: Address; toAddress: Address }
  estimate: { approvalAddress: Address; fromAmount: string; toAmount: string; toAmountMin: string; executionDuration: number; fromAmountUSD?: string; toAmountUSD?: string }
  transactionRequest?: { to: Address; data: Hex; value?: string; gasLimit?: string; chainId: number }
}

/** NOT_FOUND and INVALID mean LI.FI has not seen the transaction (yet). */
export interface LifiStatus {
  status: 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED'
  substatus?: string
  substatusMessage?: string
  sending?: { txHash?: string }
  receiving?: { txHash?: string; chainId?: number; amount?: string }
}

export type LifiChain = AcrossChain & { diamond?: Address }

export const lifiApi = {
  chains: async (): Promise<LifiChain[]> =>
    (await api<{ chains: LifiChainDto[] }>('/lifi/chains')).chains.map((c) => ({ chainId: c.id, name: c.name, explorerUrl: c.metamask?.blockExplorerUrls?.[0] ?? '', logoUrl: c.logoURI, diamond: c.diamondAddress })),
  routes: (origin: number, destination: number) => api<AcrossRoute[]>(`/lifi/routes?fromChain=${origin}&toChain=${destination}`),
  quote: (p: { amount: bigint; inputToken: Address; outputToken: Address; origin: number; destination: number; depositor: Address; recipient: Address }) =>
    api<LifiQuote>(
      `/lifi/quote?${new URLSearchParams({
        fromChain: String(p.origin),
        toChain: String(p.destination),
        fromToken: p.inputToken,
        toToken: p.outputToken,
        fromAmount: p.amount.toString(),
        fromAddress: p.depositor,
        toAddress: p.recipient,
      })}`,
    ),
  status: (hash: string, origin: number, destination: number) => api<LifiStatus>(`/lifi/status?txHash=${hash}&fromChain=${origin}&toChain=${destination}`),
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export interface LifiQuoteContext {
  depositor: Address
  recipient: Address
  /** LI.FI's own contract on the source chain (from its chain list). The transaction must target it. */
  diamond: Address | undefined
  /** The wallet's current allowance for the approval spender, read from the source chain. */
  allowance: bigint
  nowMs: number
}

/** Checks a LI.FI quote against what was asked for, then maps it to the shared quote shape. Throws BridgeGuardError on any mismatch. */
export function lifiToQuote(raw: LifiQuote, ctx: LifiQuoteContext): AcrossQuote {
  const { action, estimate } = raw
  const tx = raw.transactionRequest
  if (!tx || !isAddress(tx.to) || !tx.data) throw new BridgeGuardError('LI.FI did not return a transaction for this route.')
  if (!same(action.fromAddress, ctx.depositor)) throw new BridgeGuardError('The LI.FI quote is for a different sender than your wallet.')
  if (!same(action.toAddress, ctx.recipient)) throw new BridgeGuardError('The LI.FI quote would deliver to a different recipient than the one you chose.')
  if (tx.chainId !== action.fromChainId) throw new BridgeGuardError('The transaction is for a different network than the quote.')
  if (!ctx.diamond) throw new BridgeGuardError('LI.FI\'s contract address for this network is unknown, so the transaction cannot be checked and was refused.')
  if (!same(tx.to, ctx.diamond)) throw new BridgeGuardError('The transaction targets a contract other than LI.FI\'s own contract on this network, so it was refused.')
  const feeRaw = BigInt(estimate.fromAmount) - BigInt(estimate.toAmount)
  const sameToken = action.fromToken.symbol.toUpperCase() === action.toToken.symbol.toUpperCase() && action.fromToken.decimals === action.toToken.decimals
  const feeUsd = Number(estimate.fromAmountUSD ?? 0) - Number(estimate.toAmountUSD ?? 0)
  return {
    id: raw.id,
    provider: 'lifi',
    via: raw.toolDetails?.name ?? raw.tool,
    checks: {
      allowance: { token: action.fromToken.address, spender: estimate.approvalAddress, actual: ctx.allowance.toString(), expected: estimate.fromAmount },
      balance: { token: action.fromToken.address, actual: '0', expected: estimate.fromAmount },
    },
    inputToken: action.fromToken,
    outputToken: action.toToken,
    fees: { total: { amount: sameToken && feeRaw > 0n ? feeRaw.toString() : '0', amountUsd: String(Math.max(0, feeUsd)), token: action.fromToken } },
    inputAmount: estimate.fromAmount,
    expectedOutputAmount: estimate.toAmount,
    minOutputAmount: estimate.toAmountMin,
    expectedFillTime: estimate.executionDuration,
    quoteExpiryTimestamp: Math.floor(ctx.nowMs / 1000) + LIFI_QUOTE_TTL_S,
    swapTx: { chainId: tx.chainId, to: tx.to, data: tx.data, value: tx.value ?? '0x0', gas: tx.gasLimit },
  }
}
