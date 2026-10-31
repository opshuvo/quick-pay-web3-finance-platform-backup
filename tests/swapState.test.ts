import { describe, expect, test } from 'bun:test'
import { reviewState, swapQuoteKey, type ReviewInput } from '../src/lib/swapState'

const USDC = '0x3600000000000000000000000000000000000000'
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
// A realistic live quote: 0.01 USDC -> 0.008962 EURC.
const base: ReviewInput = {
  connected: true, onArc: true, signerReady: true, contractsVerified: true, sameToken: false, tokensKnown: true,
  amount: { ok: true, value: 10_000n }, balance: 5_000_000n, payIsGasToken: true, gasUsdc: 3_000n,
  selected: { tokenIn: USDC, tokenOut: EURC, amount: 10_000n },
  quotePending: false, quoteLoading: false,
  quote: { tokenIn: USDC, tokenOut: EURC, amountIn: 10_000n, amountOut: 8_962n, minOut: 8_917n },
  quoteError: 'none', quoteExpired: false, slippageValid: true, highImpact: false, acceptedLoss: false,
}
const with_ = (over: Partial<ReviewInput>) => reviewState({ ...base, ...over })

describe('reviewState (Review swap button)', () => {
  test('enabled only with a real, fresh, matching quote and every check passing', () => {
    expect(reviewState(base)).toEqual({ canReview: true, label: 'Review swap', reason: null })
  })
  test.each([
    ['1 USDC', 1_000_000n, 892_651n],
    ['5 USDC', 5_000_000n, 4_463_255n],
  ])('realistic %s quote enables review', (_name, amountIn, amountOut) => {
    const r = with_({ amount: { ok: true, value: amountIn }, selected: { tokenIn: USDC, tokenOut: EURC, amount: amountIn }, quote: { tokenIn: USDC, tokenOut: EURC, amountIn, amountOut, minOut: (amountOut * 995n) / 1000n }, balance: 10_000_000n })
    expect(r.canReview).toBe(true)
  })
  test('never enabled without a quote, while loading, or while the typed amount is not quoted yet', () => {
    expect(with_({ quote: undefined, quoteServiceChecking: true })).toMatchObject({ canReview: false, label: 'Getting quote…' })
    // Once nothing is running, a missing quote is reported, never an endless "Getting quote…".
    expect(with_({ quote: undefined })).toMatchObject({ canReview: false, label: 'Quote unavailable' })
    expect(with_({ quoteLoading: true })).toMatchObject({ canReview: false, label: 'Getting quote…' })
    expect(with_({ quotePending: true })).toMatchObject({ canReview: false, label: 'Getting quote…' })
  })
  test('a quote for a different amount or pair is never reused', () => {
    expect(with_({ selected: { tokenIn: USDC, tokenOut: EURC, amount: 20_000n }, amount: { ok: true, value: 20_000n } }).canReview).toBe(false)
    expect(with_({ selected: { tokenIn: USDC, tokenOut: '0x000000000000000000000000000000000000dEaD', amount: 10_000n } }).canReview).toBe(false)
    expect(with_({ selected: { tokenIn: EURC, tokenOut: USDC, amount: 10_000n } }).canReview).toBe(false)
  })
  test('quote failures are shown as failures, not as a valid zero quote', () => {
    expect(with_({ quote: undefined, quoteError: 'no_route' })).toMatchObject({ canReview: false, label: 'No route available' })
    expect(with_({ quote: undefined, quoteError: 'failed' })).toMatchObject({ canReview: false, label: 'Quote unavailable' })
    expect(with_({ quote: { ...base.quote!, amountOut: 0n, minOut: 0n } })).toMatchObject({ canReview: false, label: 'Amount too small' })
    expect(with_({ quote: { ...base.quote!, minOut: 0n } }).canReview).toBe(false)
  })
  test('invalid amounts', () => {
    expect(with_({ amount: { ok: false, reason: 'empty', message: 'Enter an amount.' } })).toMatchObject({ canReview: false, label: 'Enter an amount' })
    expect(with_({ amount: { ok: false, reason: 'zero', message: 'Amount must be greater than zero.' } })).toMatchObject({ canReview: false, label: 'Invalid amount' })
    expect(with_({ amount: { ok: false, reason: 'too_many_decimals', message: 'x' } }).canReview).toBe(false)
  })
  test('balance: over balance, and USDC that would leave nothing for fees', () => {
    expect(with_({ balance: 5_000n })).toMatchObject({ canReview: false, label: 'Insufficient balance' })
    expect(with_({ balance: 11_000n, gasUsdc: 3_000n })).toMatchObject({ canReview: false, label: 'Not enough left for fees' })
    expect(with_({ balance: 11_000n, gasUsdc: 3_000n, payIsGasToken: false }).canReview).toBe(true)
    expect(with_({ balance: 13_000n, gasUsdc: 3_000n }).canReview).toBe(true)
  })
  test('unsupported or identical tokens, unverified contracts, bad slippage', () => {
    expect(with_({ sameToken: true }).canReview).toBe(false)
    expect(with_({ tokensKnown: false }).canReview).toBe(false)
    expect(with_({ contractsVerified: false })).toMatchObject({ canReview: false, label: 'Swapping unavailable' })
    expect(with_({ slippageValid: false })).toMatchObject({ canReview: false, label: 'Invalid slippage' })
  })
  test('expired quotes must be refreshed first', () => {
    expect(with_({ quoteExpired: true })).toMatchObject({ canReview: false, label: 'Quote expired, refreshing…' })
  })
  test('high price impact needs explicit acceptance', () => {
    expect(with_({ highImpact: true }).canReview).toBe(false)
    expect(with_({ highImpact: true, acceptedLoss: true }).canReview).toBe(true)
  })
  test('wallet states', () => {
    expect(with_({ connected: false })).toMatchObject({ canReview: false, label: 'Connect wallet' })
    expect(with_({ onArc: false })).toMatchObject({ canReview: false, label: 'Switch to Arc Mainnet' })
    expect(with_({ signerReady: false }).canReview).toBe(false)
  })
})

describe('swapQuoteKey (quotes refresh when anything changes)', () => {
  const k = (over: Partial<Parameters<typeof swapQuoteKey>[0]> = {}) => JSON.stringify(swapQuoteKey({ tokenIn: USDC, tokenOut: EURC, amount: 10_000n, slippageBps: 50, wallet: '0xabc', engine: 'x', ...over }))
  test('changes with the amount, either token, slippage, wallet and engine', () => {
    const original = k()
    for (const over of [{ amount: 1_000_000n }, { amount: undefined }, { tokenIn: EURC }, { tokenOut: '0x000000000000000000000000000000000000dEaD' }, { slippageBps: 100 }, { wallet: '0xdef' }, { engine: 'y' }]) expect(k(over)).not.toBe(original)
  })
  test('is stable for the same request, ignoring address case', () => {
    expect(k()).toBe(k())
    expect(k({ tokenIn: USDC.toUpperCase().replace('0X', '0x') })).toBe(k())
  })
})
