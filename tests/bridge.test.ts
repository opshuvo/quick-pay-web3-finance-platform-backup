import { describe, expect, test } from 'bun:test'
import { assertBridgeQuote, BridgeGuardError, describeFillTime, isQuoteStale, QUOTE_MARGIN_MS } from '../src/lib/bridgeGuard'
import { trackedSummary } from '../src/lib/bridgeStatus'
import type { AcrossQuote } from '../src/lib/across'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_ARC = '0x3600000000000000000000000000000000000000'
const SPOKE = '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64'
const ctx = { origin: 8453, destination: 5042, originToken: USDC_BASE as `0x${string}`, destinationToken: USDC_ARC as `0x${string}`, amountRaw: 10_000_000n }

// Shape matches a live Across response (Base -> Arc, 10 USDC); only fields the guard reads are filled in.
const quote = (over: Record<string, unknown> = {}): AcrossQuote =>
  ({
    inputAmount: '10000000',
    inputToken: { address: USDC_BASE, chainId: 8453, decimals: 6, symbol: 'USDC' },
    outputToken: { address: USDC_ARC, chainId: 5042, decimals: 6, symbol: 'USDC' },
    checks: { allowance: { token: USDC_BASE, spender: SPOKE, actual: '0', expected: '10000000' } },
    swapTx: { chainId: 8453, to: SPOKE, data: '0xdeadbeef00', },
    quoteExpiryTimestamp: 2_000_000_000,
    ...over,
  }) as unknown as AcrossQuote
const bad = (over: Record<string, unknown>, pattern: RegExp, c = ctx) => expect(() => assertBridgeQuote(quote(over), c)).toThrow(pattern)

describe('assertBridgeQuote', () => {
  test('accepts a quote that matches what the user selected', () => {
    expect(() => assertBridgeQuote(quote(), ctx)).not.toThrow()
  })
  test('rejects a different network, target contract, empty data and native value', () => {
    bad({ swapTx: { chainId: 1, to: SPOKE, data: '0xdeadbeef00' } }, /different network/)
    bad({ swapTx: { chainId: 8453, to: '0x000000000000000000000000000000000000dEaD', data: '0xdeadbeef00' } }, /other than the approved spender/)
    bad({ swapTx: { chainId: 8453, to: SPOKE, data: '0x' } }, /no data/)
    bad({ swapTx: { chainId: 8453, to: SPOKE, data: '0xdeadbeef00', value: '1' } }, /native value/)
  })
  test('rejects a different token, different chains, or an amount that is not what was typed', () => {
    bad({ inputToken: { address: USDC_ARC, chainId: 8453, decimals: 6, symbol: 'USDC' } }, /different token/)
    bad({ outputToken: { address: USDC_ARC, chainId: 1, decimals: 6, symbol: 'USDC' } }, /different networks/)
    bad({ inputAmount: '10000001' }, /differs from the amount/)
    expect(() => assertBridgeQuote(quote(), { ...ctx, amountRaw: undefined })).toThrow(BridgeGuardError)
  })
  test('rejects an approval for another token or for more than the bridged amount (no unlimited allowance)', () => {
    bad({ checks: { allowance: { token: USDC_ARC, spender: SPOKE, actual: '0', expected: '10000000' } } }, /different token than the one being bridged/)
    bad({ checks: { allowance: { token: USDC_BASE, spender: SPOKE, actual: '0', expected: '115792089237316195423570985008687907853269984665640564039457584007913129639935' } } }, /approval amount differs/)
  })
  test('unsupported route: a quote for other chains than the selected route never passes', () => {
    expect(() => assertBridgeQuote(quote(), { ...ctx, destination: 1 })).toThrow(/different networks/)
  })
})

describe('quote freshness', () => {
  const q = quote({ quoteExpiryTimestamp: 1_000 })
  test('stale inside the safety margin, fresh before it', () => {
    expect(isQuoteStale(q, 1_000_000 - QUOTE_MARGIN_MS + 1)).toBe(true)
    expect(isQuoteStale(q, 1_000_000 - QUOTE_MARGIN_MS - 1)).toBe(false)
    expect(isQuoteStale(q, 2_000_000)).toBe(true)
  })
  test('fill time wording never says 0 seconds', () => {
    expect(describeFillTime(0)).toBe('within seconds')
    expect(describeFillTime(2)).toBe('~2 seconds')
    expect(describeFillTime(150)).toBe('~3 minutes')
    expect(describeFillTime(-1)).toBe('unknown')
  })
})

type Activity = Parameters<typeof trackedSummary>[0]
const activity = (status: string, destinationVerified: boolean): Activity => ({ source: 'verified', activity: { status, destinationVerified } as never })

describe('trackedSummary (what the user is told)', () => {
  test('complete ONLY when the destination transaction was verified', () => {
    expect(trackedSummary(activity('filled', true)).label).toBe('Complete')
    const unverified = trackedSummary(activity('filled', false))
    expect(unverified.label).not.toBe('Complete')
    expect(unverified.tone).toBe('warn')
  })
  test('a source transaction alone, or no answer yet, is never complete', () => {
    for (const t of [undefined, { source: 'waiting', reason: 'not indexed' } as Activity, activity('pending', false)]) {
      const summary = trackedSummary(t)
      expect(summary.label).not.toBe('Complete')
      expect(summary.steps[0].label).toBe('Source transaction confirmed')
    }
  })
  test('delayed fills stay "in transit"; expired and refunded are shown only when reported', () => {
    expect(trackedSummary(activity('pending', false)).label).toBe('In transit')
    expect(trackedSummary(activity('expired', false)).label).toBe('Expired')
    expect(trackedSummary(activity('refunded', false)).label).toBe('Refunded')
  })
  test('Across-only fallback says it is not independently verified', () => {
    const t = trackedSummary({ source: 'across', status: { status: 'filled' } as never })
    expect(t.label).toBe('Filled (per Across)')
    expect(t.steps[2].label).toMatch(/not independently verified/)
  })
})
