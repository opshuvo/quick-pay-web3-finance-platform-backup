/** Browser client for Quick Pay's server-side Uniswap Trading API integration. No API key is ever in the browser. */
import { api } from '@/lib/api'

export interface UniswapStatus {
  configured: boolean
  chainSupported: boolean | null
  routerVerified: boolean | null
  protocols: string[]
  message: string
}

/** The subset of the Trading API's CLASSIC quote that Quick Pay reads. Everything else is passed back untouched. */
export interface ApiQuote {
  input: { token: string; amount: string }
  output: { token: string; amount: string; recipient?: string; minimumAmount?: string }
  chainId?: number
  slippage?: number
  gasFee?: string
  gasFeeUSD?: string
  gasUseEstimate?: string
  priceImpact?: number
  routeString?: string
  quoteId?: string
  txFailureReasons?: string[]
  route?: { type?: string; fee?: number | string; address?: string }[][]
  [key: string]: unknown
}

export interface PermitData {
  domain: { name?: string; version?: string; chainId?: number | string; verifyingContract?: string }
  types: Record<string, { name: string; type: string }[]>
  values: {
    details: { token: string; amount: string; expiration: string; nonce: string }
    spender: string
    sigDeadline: string
  }
}

export interface ApiQuoteResponse {
  routing: 'CLASSIC'
  quote: ApiQuote
  permitData: PermitData | null
  requestId: string | null
}

export interface ApiSwapResponse {
  swap: { to: string; data: string; value: '0'; chainId: number; gasLimit: string | null }
  gasFee: string | null
  requestId: string | null
}

export const uniswapApi = {
  status: (signal?: AbortSignal) => api<UniswapStatus>('/uniswap/status', { signal }),
  quote: (body: { tokenIn: string; tokenOut: string; amount: string; swapper: string; slippageTolerance: number }, signal?: AbortSignal) =>
    api<ApiQuoteResponse>('/uniswap/quote', { method: 'POST', body, signal }),
  checkApproval: (body: { walletAddress: string; token: string; amount: string }) =>
    api<{ approvalRequired: boolean; spender: string; requestId: string | null }>('/uniswap/check_approval', { method: 'POST', body }),
  swap: (body: { quote: ApiQuote; permitData?: PermitData; signature?: string; swapper: string }) =>
    api<ApiSwapResponse>('/uniswap/swap', { method: 'POST', body }),
}
