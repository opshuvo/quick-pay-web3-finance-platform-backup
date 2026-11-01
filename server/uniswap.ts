/**
 * Server-side client for the official Uniswap Trading API (https://trade-api.gateway.uniswap.org/v1).
 * The API key lives only in `UNISWAP_API_KEY` on the server. The browser sends minimal parameters;
 * this module fixes everything security-relevant itself (chain, protocols, permit amount, router
 * version) and validates every response before returning it.
 */
import { isAddress } from 'viem'
import { UNISWAP_PERMIT2 as PERMIT2, UNISWAP_ROUTER_VERSION as ROUTER_VERSION, UNISWAP_UNIVERSAL_ROUTER as UNIVERSAL_ROUTER } from '../shared/uniswap-constants'
import { HttpError } from './db'
import { config } from './env'

export const UNISWAP_BASE = 'https://trade-api.gateway.uniswap.org/v1'
export const ARC_CHAIN_ID = 5042
export const MAX_SLIPPAGE_PERCENT = 1
const ZERO = `0x${'0'.repeat(40)}`

const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
const addr = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || value.toLowerCase() === ZERO) {
    throw new HttpError(400, 'bad_address', `Invalid ${label}.`)
  }
  return value.toLowerCase()
}
const digits = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,40}$/.test(value)) throw new HttpError(400, 'bad_amount', `Invalid ${label}.`)
  return value
}

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  if (!config.uniswapApiKey) {
    throw new HttpError(503, 'uniswap_not_configured', 'The Uniswap API key is not configured on this server.')
  }
  let response: Response
  try {
    response = await fetch(`${UNISWAP_BASE}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': config.uniswapApiKey,
        'x-universal-router-version': ROUTER_VERSION,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new HttpError(502, 'uniswap_unreachable', 'The Uniswap API is not reachable right now.')
  }
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const body = data as { detail?: string; message?: string } | null
    const safe = String(body?.detail ?? body?.message ?? '').replace(/[^\x20-\x7E]/g, '').slice(0, 200)
    if (response.status === 401 || response.status === 403) throw new HttpError(502, 'uniswap_unauthorized', 'The Uniswap API rejected the configured key.')
    if (response.status === 404) throw new HttpError(404, 'no_route', safe || 'Uniswap found no route for this pair and size.')
    if (response.status === 429) throw new HttpError(429, 'uniswap_rate_limited', 'The Uniswap API is rate limited. Try again in a moment.')
    if (response.status === 400) throw new HttpError(400, 'uniswap_bad_request', safe || 'Uniswap rejected the request.')
    throw new HttpError(502, 'uniswap_error', 'The Uniswap API returned an error.')
  }
  return data as T
}

// ---- support / status -------------------------------------------------------------------------

interface SupportedChain {
  chainId: number
  chainName: string
  contractAddresses?: { name: string; version?: string; address: string }[]
  protocols?: string[]
}

let chainCache: { at: number; chain: SupportedChain | null } | null = null

export interface UniswapStatus {
  configured: boolean
  chainSupported: boolean | null
  routerVerified: boolean | null
  protocols: string[]
  message: string
}

export async function uniswapStatus(): Promise<UniswapStatus> {
  if (!config.uniswapApiKey) {
    return { configured: false, chainSupported: null, routerVerified: null, protocols: [], message: 'UNISWAP_API_KEY is not set on the server.' }
  }
  try {
    if (!chainCache || Date.now() - chainCache.at > 10 * 60_000) {
      const data = await call<{ chains: SupportedChain[] }>('/supported_chains', { method: 'GET' })
      chainCache = { at: Date.now(), chain: data.chains.find((c) => c.chainId === ARC_CHAIN_ID) ?? null }
    }
    const chain = chainCache.chain
    if (!chain) return { configured: true, chainSupported: false, routerVerified: null, protocols: [], message: 'The Uniswap API does not list Arc Mainnet.' }
    const router = chain.contractAddresses?.find((c) => /universal ?router/i.test(c.name) && c.version === ROUTER_VERSION)
    const routerVerified = router ? same(router.address, UNIVERSAL_ROUTER) : false
    return {
      configured: true,
      chainSupported: true,
      routerVerified,
      protocols: (chain.protocols ?? []).filter((p) => ['V2', 'V3', 'V4'].includes(p)),
      message: routerVerified ? 'Uniswap API lists Arc Mainnet.' : 'The Universal Router address reported by Uniswap does not match the one Quick Pay trusts. Swaps through the API are disabled.',
    }
  } catch (error) {
    if (error instanceof HttpError) return { configured: true, chainSupported: null, routerVerified: null, protocols: [], message: error.message }
    throw error
  }
}

async function requireArcSupport() {
  const status = await uniswapStatus()
  if (!status.configured) throw new HttpError(503, 'uniswap_not_configured', 'The Uniswap API key is not configured on this server.')
  if (status.chainSupported === false) throw new HttpError(422, 'chain_unsupported', 'The Uniswap API does not support Arc Mainnet.')
  if (status.routerVerified === false) throw new HttpError(422, 'router_mismatch', status.message)
}

// ---- endpoints --------------------------------------------------------------------------------

export interface QuoteInput {
  tokenIn?: unknown
  tokenOut?: unknown
  amount?: unknown
  swapper?: unknown
  slippageTolerance?: unknown
}

export async function getQuote(input: QuoteInput) {
  await requireArcSupport()
  const tokenIn = addr(input.tokenIn, 'input token')
  const tokenOut = addr(input.tokenOut, 'output token')
  if (tokenIn === tokenOut) throw new HttpError(400, 'same_token', 'Choose two different tokens.')
  const amount = digits(input.amount, 'amount')
  const swapper = addr(input.swapper, 'wallet address')
  const slippage = Number(input.slippageTolerance)
  if (!Number.isFinite(slippage) || slippage < 0.01 || slippage > MAX_SLIPPAGE_PERCENT) {
    throw new HttpError(400, 'bad_slippage', `Slippage must be between 0.01% and ${MAX_SLIPPAGE_PERCENT}%.`)
  }
  const data = await call<{ routing?: string; quote?: Record<string, unknown>; permitData?: unknown; requestId?: string }>('/quote', {
    method: 'POST',
    body: {
      type: 'EXACT_INPUT',
      amount,
      tokenIn,
      tokenOut,
      tokenInChainId: ARC_CHAIN_ID,
      tokenOutChainId: ARC_CHAIN_ID,
      swapper,
      slippageTolerance: Math.round(slippage * 100) / 100,
      protocols: ['V2', 'V3', 'V4'],
      routingPreference: 'BEST_PRICE',
      permitAmount: 'EXACT',
      generatePermitAsTransaction: false,
    },
  })
  return validateQuoteResponse(data, { tokenIn, tokenOut, amount, swapper })
}

export function validateQuoteResponse(
  data: { routing?: string; quote?: Record<string, unknown>; permitData?: unknown; requestId?: string },
  expected: { tokenIn: string; tokenOut: string; amount: string; swapper: string },
) {
  if (data.routing !== 'CLASSIC' || !data.quote) {
    throw new HttpError(422, 'unsupported_routing', 'Uniswap returned a route type Quick Pay does not execute. Try a different pair or size.')
  }
  const q = data.quote as {
    input?: { token?: string; amount?: string }
    output?: { token?: string; amount?: string; recipient?: string }
    chainId?: number
    txFailureReasons?: string[]
  }
  if (q.chainId !== undefined && Number(q.chainId) !== ARC_CHAIN_ID) throw new HttpError(422, 'quote_mismatch', 'The quote is for a different network.')
  if (!same(q.input?.token, expected.tokenIn) || q.input?.amount !== expected.amount) throw new HttpError(422, 'quote_mismatch', 'The quote does not match the requested input.')
  if (!same(q.output?.token, expected.tokenOut)) throw new HttpError(422, 'quote_mismatch', 'The quote does not match the requested output token.')
  if (q.output?.recipient && !same(q.output.recipient, expected.swapper)) throw new HttpError(422, 'quote_mismatch', 'The quote pays a different recipient.')
  if (!q.output?.amount || !/^\d+$/.test(q.output.amount)) throw new HttpError(422, 'quote_mismatch', 'The quote has no output amount.')
  if (q.txFailureReasons && q.txFailureReasons.length > 0) {
    throw new HttpError(422, 'simulation_failed', `Uniswap's simulation of this swap failed (${q.txFailureReasons.join(', ')}).`)
  }
  return { routing: 'CLASSIC' as const, quote: data.quote, permitData: data.permitData ?? null, requestId: data.requestId ?? null }
}

export interface ApprovalInput {
  walletAddress?: unknown
  token?: unknown
  amount?: unknown
}

/**
 * Asks Uniswap whether the wallet must approve Permit2 for this token. Only the yes/no answer is
 * used: Quick Pay builds the approval itself (exact amount, Permit2 as spender) rather than sending
 * calldata it did not construct.
 */
export async function checkApproval(input: ApprovalInput) {
  await requireArcSupport()
  const token = addr(input.token, 'token')
  const data = await call<{ approval?: { to?: string } | null; requestId?: string }>('/check_approval', {
    method: 'POST',
    body: { walletAddress: addr(input.walletAddress, 'wallet address'), token, amount: digits(input.amount, 'amount'), chainId: ARC_CHAIN_ID },
  })
  if (data.approval && !same(data.approval.to, token)) throw new HttpError(422, 'approval_mismatch', 'Uniswap returned an approval for a different contract.')
  return { approvalRequired: Boolean(data.approval), spender: PERMIT2, requestId: data.requestId ?? null }
}

export interface SwapInput {
  quote?: unknown
  permitData?: unknown
  signature?: unknown
  swapper?: unknown
}

export async function createSwap(input: SwapInput) {
  await requireArcSupport()
  const swapper = addr(input.swapper, 'wallet address')
  if (!input.quote || typeof input.quote !== 'object') throw new HttpError(400, 'bad_quote', 'Missing quote.')
  const hasPermit = input.permitData !== undefined && input.permitData !== null
  const hasSig = typeof input.signature === 'string' && /^0x[0-9a-fA-F]{130,}$/.test(input.signature)
  if (hasPermit !== hasSig) throw new HttpError(400, 'bad_permit', 'A permit and its signature must be sent together.')
  const quote = input.quote as { chainId?: number; swapper?: string }
  if (quote.chainId !== undefined && Number(quote.chainId) !== ARC_CHAIN_ID) throw new HttpError(422, 'quote_mismatch', 'The quote is for a different network.')
  if (quote.swapper && !same(quote.swapper, swapper)) throw new HttpError(422, 'quote_mismatch', 'The quote belongs to a different wallet.')
  const data = await call<{ swap?: Record<string, unknown>; gasFee?: string; requestId?: string }>('/swap', {
    method: 'POST',
    body: {
      quote: input.quote,
      ...(hasPermit ? { permitData: input.permitData, signature: input.signature } : {}),
      simulateTransaction: true,
      refreshGasPrice: true,
      deadline: Math.floor(Date.now() / 1000) + 20 * 60,
    },
  })
  return validateSwapResponse(data, swapper)
}

export function validateSwapResponse(data: { swap?: Record<string, unknown>; gasFee?: string; requestId?: string }, swapper: string) {
  const swap = data.swap as { to?: string; from?: string; data?: string; value?: string; chainId?: number; gasLimit?: string } | undefined
  if (!swap) throw new HttpError(502, 'uniswap_error', 'Uniswap returned no transaction.')
  if (!same(swap.to, UNIVERSAL_ROUTER)) throw new HttpError(422, 'target_mismatch', 'Uniswap returned a transaction for an unexpected contract. It was blocked.')
  if (Number(swap.chainId) !== ARC_CHAIN_ID) throw new HttpError(422, 'chain_mismatch', 'Uniswap returned a transaction for a different network. It was blocked.')
  if (typeof swap.data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(swap.data)) throw new HttpError(422, 'empty_calldata', 'Uniswap returned empty transaction data. It was blocked.')
  if (swap.value !== undefined && !/^(0x0*|0)$/.test(String(swap.value))) throw new HttpError(422, 'native_value', 'The transaction would send native value, which a USDC swap on Arc never needs. It was blocked.')
  if (swap.from && !same(swap.from, swapper)) throw new HttpError(422, 'sender_mismatch', 'The transaction is for a different wallet. It was blocked.')
  return { swap: { to: swap.to as string, data: swap.data, value: '0', chainId: ARC_CHAIN_ID, gasLimit: swap.gasLimit ?? null }, gasFee: data.gasFee ?? null, requestId: data.requestId ?? null }
}
