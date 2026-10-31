import type { AmountParse } from '@/lib/swapAmount'

/** The exact inputs that make two quote requests the same request. Any change refetches. */
export function swapQuoteKey(p: { tokenIn?: string; tokenOut?: string; amount?: bigint; slippageBps: number; wallet?: string; engine?: string }) {
  return ['swap-quote', p.tokenIn?.toLowerCase(), p.tokenOut?.toLowerCase(), p.amount?.toString(), p.slippageBps, p.wallet?.toLowerCase(), p.engine] as const
}

export interface QuoteFacts {
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
  minOut: bigint
}

export interface ReviewInput {
  connected: boolean
  onArc: boolean
  signerReady: boolean
  contractsVerified: boolean
  /** Why contracts are not verified, when known. */
  contractsState?: 'checking' | 'unreachable' | 'missing'
  sameToken: boolean
  tokensKnown: boolean
  amount: AmountParse
  /** Balance in base units of the pay token, when it is known. */
  balance?: bigint
  payIsGasToken: boolean
  /** Estimated network fee in 6-decimal USDC, if known. */
  gasUsdc?: bigint | null
  selected: { tokenIn?: string; tokenOut?: string; amount?: bigint }
  /** True while the typed amount has not been sent to the quote request yet (debounce). */
  quotePending: boolean
  quoteLoading: boolean
  /** True only while the quote service check itself is still running (it has a hard timeout). */
  quoteServiceChecking?: boolean
  quote?: QuoteFacts
  quoteError: 'none' | 'no_route' | 'failed'
  quoteExpired: boolean
  slippageValid: boolean
  highImpact: boolean
  acceptedLoss: boolean
}

export interface ReviewState {
  canReview: boolean
  label: string
  /** Why the button is disabled, in plain words. Null when it is enabled. */
  reason: string | null
}

const blocked = (label: string, reason: string | null = label): ReviewState => ({ canReview: false, label, reason })

/**
 * The only place that decides whether "Review swap" is enabled. It needs a REAL quote that belongs to the
 * exact tokens and amount currently selected, is fresh, pays out something, and passes every check.
 */
export function reviewState(i: ReviewInput): ReviewState {
  if (!i.connected) return blocked('Connect wallet', null)
  if (!i.onArc) return blocked('Switch to Arc Mainnet', null)
  if (!i.contractsVerified) {
    if (i.contractsState === 'checking') return blocked('Verifying contracts…', 'Checking the Uniswap contracts on Arc.')
    if (i.contractsState === 'unreachable') return blocked('Swapping unavailable', 'Could not reach Arc to verify the Uniswap contracts. Retrying.')
    return blocked('Swapping unavailable', 'The Uniswap contracts could not be verified on Arc.')
  }
  if (!i.tokensKnown) return blocked('Choose tokens', 'Choose the tokens to swap.')
  if (i.sameToken) return blocked('Choose different tokens', 'Pick two different tokens.')
  if (!i.amount.ok) return blocked(i.amount.reason === 'empty' ? 'Enter an amount' : 'Invalid amount', i.amount.message)
  if (i.balance !== undefined && i.amount.value > i.balance) return blocked('Insufficient balance', 'The amount is larger than your balance.')
  if (i.payIsGasToken && i.balance !== undefined && i.gasUsdc != null && i.amount.value + i.gasUsdc > i.balance) return blocked('Not enough left for fees', 'USDC also pays Arc network fees, and this amount leaves too little for them.')
  if (!i.slippageValid) return blocked('Invalid slippage', 'Slippage must be between 0.01% and 1%.')
  if (i.quotePending || i.quoteLoading || i.quoteServiceChecking) return blocked('Getting quote…', 'Fetching a live quote.')
  if (i.quoteError === 'no_route') return blocked('No route available', 'No live Uniswap pool can fill this pair at this size.')
  if (i.quoteError === 'failed') return blocked('Quote unavailable', 'A live quote could not be fetched.')
  const q = i.quote
  if (!q) return i.quoteServiceChecking ? blocked('Getting quote…', 'Checking the quote service.') : blocked('Quote unavailable', 'No live quote could be started. Check your connection and try again.')
  // A quote for a different amount or pair (for example while the user is still typing) is never reused.
  const same = (a?: string, b?: string) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()
  if (!same(q.tokenIn, i.selected.tokenIn) || !same(q.tokenOut, i.selected.tokenOut) || q.amountIn !== i.selected.amount) return blocked('Getting quote…', 'The quote is for a different amount or pair.')
  if (q.amountOut <= 0n || q.minOut <= 0n) return blocked('Amount too small', 'At this size the swap would pay out nothing. Try a larger amount.')
  if (i.quoteExpired) return blocked('Quote expired, refreshing…', 'The quote expired.')
  if (i.highImpact && !i.acceptedLoss) return blocked('Accept the price impact', 'Confirm that you accept the price impact.')
  if (!i.signerReady) return blocked('Wallet not ready', 'Your wallet is not ready to sign yet.')
  return { canReview: true, label: 'Review swap', reason: null }
}
