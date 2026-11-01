/**
 * Across Protocol client. Calls go through the Quick Pay backend (`/api/across/*`), which only
 * forwards an allow-list of Across endpoints and keeps any API key server-side.
 */
import type { Address, Hex } from 'viem'
import { api } from '@/lib/api'

export const ACROSS_URL = 'https://across.to/'

export interface AcrossChain {
  chainId: number
  name: string
  explorerUrl: string
  logoUrl?: string
}

export interface AcrossRoute {
  originChainId: number
  originToken: Address
  destinationChainId: number
  destinationToken: Address
  originTokenSymbol: string
  destinationTokenSymbol: string
  isNative: boolean
}

interface TokenRef {
  decimals: number
  symbol: string
  address: Address
  chainId: number
}

/** One fee component as Across reports it, in the token it names. */
export interface FeeLine {
  amount: string
  amountUsd?: string
  token?: TokenRef
}

export interface AcrossQuote {
  id: string
  checks: { allowance: { token: Address; spender: Address; actual: string; expected: string }; balance: { token: Address; actual: string; expected: string } }
  approvalTxns?: { chainId: number; to: Address; data: Hex }[]
  inputToken: TokenRef
  outputToken: TokenRef
  crossSwapType?: string
  fees: {
    total: {
      amount: string
      amountUsd: string
      token: TokenRef
      details?: {
        swapImpact?: FeeLine
        app?: FeeLine
        bridge?: FeeLine & { details?: { lp?: FeeLine; relayerCapital?: FeeLine; destinationGas?: FeeLine } }
      }
    }
  }
  inputAmount: string
  expectedOutputAmount: string
  minOutputAmount: string
  expectedFillTime: number
  quoteExpiryTimestamp: number
  swapTx: { ecosystem?: string; simulationSuccess?: boolean; chainId: number; to: Address; data: Hex; gas?: string; value?: string }
}

export type DepositStatus = {
  /** 'filled' | 'pending' | 'expired' | 'refunded' (other values are shown as unavailable). */
  status: string
  fillTxnRef?: string
  depositRefundTxnRef?: string
  destinationChainId?: number
}

/** Non-EVM destinations cannot receive to an EVM address, so they are excluded from the chooser. */
const NON_EVM = new Set([34268394551451, 728126428, 1337, 2337])

export const acrossApi = {
  chains: async () => (await api<AcrossChain[]>('/across/swap/chains')).filter((c) => !NON_EVM.has(c.chainId)),
  routes: (origin: number, destination: number) => api<AcrossRoute[]>(`/across/available-routes?originChainId=${origin}&destinationChainId=${destination}`),
  quote: (p: { amount: bigint; inputToken: Address; outputToken: Address; origin: number; destination: number; depositor: Address; recipient: Address }) =>
    api<AcrossQuote>(
      `/across/swap/approval?${new URLSearchParams({
        tradeType: 'exactInput',
        amount: p.amount.toString(),
        inputToken: p.inputToken,
        outputToken: p.outputToken,
        originChainId: String(p.origin),
        destinationChainId: String(p.destination),
        depositor: p.depositor,
        recipient: p.recipient,
      })}`,
    ),
  status: (hash: string) => api<DepositStatus>(`/across/deposit/status?depositTxnRef=${hash}`),
}

const CHAINS_KEY = 'quickpay.across.chains.v1'
const CHAINS_MAX_AGE_MS = 7 * 24 * 60 * 60_000

/** The network list Across returned last time, so the Bridge form can show its choices at once while the live list loads. */
export function cachedChains(): { data: AcrossChain[]; at: number } | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAINS_KEY) ?? 'null') as { data?: AcrossChain[]; at?: number } | null
    if (!raw || !Array.isArray(raw.data) || typeof raw.at !== 'number' || Date.now() - raw.at > CHAINS_MAX_AGE_MS) return undefined
    return { data: raw.data, at: raw.at }
  } catch {
    return undefined
  }
}

export function rememberChains(data: AcrossChain[]): void {
  try {
    localStorage.setItem(CHAINS_KEY, JSON.stringify({ data, at: Date.now() }))
  } catch {
    /* storage unavailable: the list simply loads live every time */
  }
}
