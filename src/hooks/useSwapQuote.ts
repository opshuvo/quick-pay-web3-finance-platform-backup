import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address, PublicClient } from 'viem'
import { ApiError } from '@/lib/api'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { arcFeeParams, gasCostToUsdc } from '@/lib/fees'
import { Amount, gasTokenDecimalsFor, gasTokenToUsdc } from '@/onchain-money'
import { bestQuote, minOut, NoRouteError, type Quote } from '@/lib/uniswap/arc'
import { uniswapApi, type ApiQuoteResponse, type UniswapStatus } from '@/lib/uniswap/api'
import { apiMinOut, assertQuoteMatches } from '@/lib/uniswap/apiValidate'
import { swapQuoteKey } from '@/lib/swapState'

export type Engine = 'uniswap-api' | 'onchain'

export interface SwapQuoteView {
  engine: Engine
  tokenIn: Address
  tokenOut: Address
  /** Why the Uniswap API was not used, when it was expected to be. */
  fallbackReason: string | null
  amountIn: bigint
  amountOut: bigint
  minOut: bigint
  /** Percent, 0 to 100. */
  priceImpactPct: number
  route: string
  /** Estimated network fee in 6-decimal USDC, or null when the source gave none. */
  gasUsdc: bigint | null
  /** Output measured directly on-chain for the same swap, when available. */
  referenceOut: bigint | null
  fetchedAt: number
  api?: ApiQuoteResponse
  onchain?: Quote
}

export class QuoteUnavailableError extends Error {}
export class QuoteTimeoutError extends Error {}

/** Longest a live quote may take (API plus on-chain). Past it the user gets an error and a retry, never a spinner. */
export const QUOTE_TIMEOUT_MS = 45_000

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new QuoteTimeoutError('The live quote took too long. Try again.')), ms) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

function routeLabelApi(res: ApiQuoteResponse): string {
  const hops = res.quote.route ?? []
  const first = hops[0] ?? []
  const kinds = [...new Set(first.map((p) => String(p.type ?? '').replace('-pool', '').toUpperCase()).filter(Boolean))]
  const fees = first.map((p) => (p.fee !== undefined ? `${(Number(p.fee) / 10_000).toFixed(2)}%` : '')).filter(Boolean)
  return `Uniswap ${kinds.join(' + ') || 'AMM'}${fees.length ? ` · ${fees.join(' → ')} fee tier` : ''}`
}

interface Params {
  tokenIn?: Address
  tokenOut?: Address
  amount?: bigint
  slippageBps: number
  wallet?: Address
  status?: UniswapStatus
  enabled: boolean
}

async function onchainView(client: PublicClient, p: Required<Pick<Params, 'tokenIn' | 'tokenOut' | 'amount' | 'slippageBps'>>, fallbackReason: string | null): Promise<SwapQuoteView> {
  const q = await bestQuote(client, p.tokenIn, p.tokenOut, 'exactIn', p.amount)
  const fees = await arcFeeParams(client).catch(() => null)
  return {
    engine: 'onchain',
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    fallbackReason,
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    minOut: minOut(q.amountOut, p.slippageBps),
    priceImpactPct: q.priceImpact * 100,
    route: `Uniswap ${q.route.version.toUpperCase()} · ${(q.route.feeFraction * 100).toFixed(2)}% fee tier`,
    gasUsdc: fees ? gasCostToUsdc(210_000n, fees.maxFeePerGas) : null,
    referenceOut: q.amountOut,
    fetchedAt: Date.now(),
    onchain: q,
  }
}

/**
 * Live quote. The Uniswap Trading API is used when the server has a key and the API lists Arc with the
 * router Quick Pay trusts. Otherwise (or if the API is unavailable) the same Uniswap pools are quoted
 * directly on-chain, and the screen says so. A quote is never invented.
 */
export function useSwapQuote({ tokenIn, tokenOut, amount, slippageBps, wallet, status, enabled }: Params) {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const fetchQuote = async (): Promise<SwapQuoteView> => {
    const c = client as PublicClient
    const base = { tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, amount: amount as bigint, slippageBps }
    const apiUsable = status?.configured && status.chainSupported && status.routerVerified && wallet
    let fallbackReason: string | null = status && !status.configured ? 'The Uniswap API key is not set on this server.' : status && status.chainSupported === false ? 'The Uniswap API does not list Arc Mainnet.' : status && status.routerVerified === false ? status.message : null

    if (apiUsable) {
      try {
        const res = await uniswapApi.quote({ tokenIn: base.tokenIn, tokenOut: base.tokenOut, amount: base.amount.toString(), swapper: wallet, slippageTolerance: slippageBps / 100 })
        assertQuoteMatches(res.quote, { tokenIn: base.tokenIn, tokenOut: base.tokenOut, amount: base.amount, wallet: wallet })
        const reference = await bestQuote(c, base.tokenIn, base.tokenOut, 'exactIn', base.amount).then((q) => q.amountOut).catch(() => null)
        const gasNative = res.quote.gasFee && /^\d+$/.test(res.quote.gasFee) ? BigInt(res.quote.gasFee) : null
        return {
          engine: 'uniswap-api',
          tokenIn: base.tokenIn,
          tokenOut: base.tokenOut,
          fallbackReason: null,
          amountIn: BigInt(res.quote.input.amount),
          amountOut: BigInt(res.quote.output.amount),
          minOut: apiMinOut(res.quote, slippageBps),
          priceImpactPct: Number(res.quote.priceImpact ?? 0),
          route: routeLabelApi(res),
          gasUsdc: gasNative === null ? null : gasTokenToUsdc(ARC_CHAIN_ID, Amount.fromRaw(gasNative, gasTokenDecimalsFor(ARC_CHAIN_ID)), 'trunc').raw + 1n,
          referenceOut: reference,
          fetchedAt: Date.now(),
          api: res,
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'bad_slippage') throw error
        fallbackReason = error instanceof ApiError ? `Uniswap API: ${error.message}` : 'The Uniswap API could not be used for this quote.'
      }
    }
    try {
      return await onchainView(c, base, fallbackReason)
    } catch (error) {
      if (error instanceof NoRouteError) throw new QuoteUnavailableError(error.message)
      throw error
    }
  }

  return useQuery<SwapQuoteView>({
    // Every input that changes the request changes the key, so a new amount, token, slippage or wallet refetches.
    queryKey: swapQuoteKey({ tokenIn, tokenOut, amount, slippageBps, wallet, engine: `${status?.configured}-${status?.chainSupported}-${status?.routerVerified}` }),
    enabled: Boolean(enabled && client && tokenIn && tokenOut && amount && amount > 0n && status),
    retry: false,
    refetchInterval: 15_000,
    staleTime: 0,
    queryFn: () => withTimeout(fetchQuote(), QUOTE_TIMEOUT_MS),
  })
}
