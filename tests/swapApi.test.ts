import { describe, expect, test } from 'bun:test'
import { quoteExpired, QUOTE_TTL_MS, assertQuoteMatches, apiMinOut, validatePermit, validateSwapTx, permitTypes } from '../src/lib/uniswap/apiValidate'
import { validateQuoteResponse, validateSwapResponse } from '../server/uniswap'
import { UNISWAP_PERMIT2, UNISWAP_UNIVERSAL_ROUTER } from '../shared/uniswap-constants'
import type { ApiQuote, PermitData } from '../src/lib/uniswap/api'

// Fixtures follow the field names in Uniswap's published OpenAPI spec (CLASSIC quote, Permit, SwapTransactionResponse).
const USDC = '0x3600000000000000000000000000000000000000'
const OTHER = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const ME = '0x52908400098527886E0F7030069857D2E4169EE7'
const quote = (over: Partial<ApiQuote> = {}): ApiQuote => ({
  input: { token: USDC, amount: '1000000' },
  output: { token: OTHER, amount: '990000', recipient: ME, minimumAmount: '985050' },
  chainId: 5042,
  priceImpact: 0.1,
  ...over,
})
const permit = (over: Partial<PermitData['values']['details']> = {}, spender = UNISWAP_UNIVERSAL_ROUTER): PermitData => ({
  domain: { name: 'Permit2', chainId: 5042, verifyingContract: UNISWAP_PERMIT2 },
  types: { EIP712Domain: [], PermitSingle: [], PermitDetails: [] },
  values: { details: { token: USDC, amount: '1000000', expiration: String(2_000_000_000), nonce: '0', ...over }, spender, sigDeadline: String(2_000_000_000) },
})

describe('quote freshness', () => {
  test('expires after the 30 second window', () => {
    expect(quoteExpired(1_000, 1_000 + QUOTE_TTL_MS - 1)).toBe(false)
    expect(quoteExpired(1_000, 1_000 + QUOTE_TTL_MS)).toBe(true)
  })
})

describe('assertQuoteMatches', () => {
  const expected = { tokenIn: USDC, tokenOut: OTHER, amount: 1_000_000n, wallet: ME }
  test('accepts the exact requested swap', () => expect(() => assertQuoteMatches(quote(), expected)).not.toThrow())
  test('rejects a different token, amount, network or recipient', () => {
    expect(() => assertQuoteMatches(quote({ output: { token: USDC, amount: '1' } }), expected)).toThrow()
    expect(() => assertQuoteMatches(quote({ input: { token: USDC, amount: '2000000' } }), expected)).toThrow(/amount/)
    expect(() => assertQuoteMatches(quote({ chainId: 1 }), expected)).toThrow(/network/)
    expect(() => assertQuoteMatches(quote({ output: { token: OTHER, amount: '1', recipient: '0x000000000000000000000000000000000000dEaD' } }), expected)).toThrow(/recipient/)
  })
})

describe('apiMinOut', () => {
  test('never goes below the slippage formula', () => {
    expect(apiMinOut(quote({ output: { token: OTHER, amount: '1000000', minimumAmount: '1' } }), 50)).toBe(995_000n)
    expect(apiMinOut(quote({ output: { token: OTHER, amount: '1000000', minimumAmount: '999000' } }), 50)).toBe(999_000n)
  })
})

describe('validatePermit', () => {
  const now = 1_900_000_000
  const ok = { tokenIn: USDC, amount: 1_000_000n, now }
  test('accepts an exact permit to the Universal Router', () => expect(validatePermit(permit(), ok).spender.toLowerCase()).toBe(UNISWAP_UNIVERSAL_ROUTER))
  test('rejects wrong spender, token, verifying contract and unlimited amounts', () => {
    expect(() => validatePermit(permit({}, '0x000000000000000000000000000000000000dEaD'), ok)).toThrow(/spender/)
    expect(() => validatePermit(permit({ token: OTHER }), ok)).toThrow(/token/)
    const wrong = permit(); wrong.domain.verifyingContract = ME
    expect(() => validatePermit(wrong, ok)).toThrow(/unexpected contract/)
    expect(() => validatePermit(permit({ amount: (2n ** 160n - 1n).toString() }), ok)).toThrow(/larger/)
  })
  test('rejects expired permissions and strips the EIP712Domain type', () => {
    expect(() => validatePermit(permit({ expiration: '1' }), ok)).toThrow(/expired/)
    expect('EIP712Domain' in permitTypes(permit())).toBe(false)
  })
})

describe('transaction validation (browser and server)', () => {
  const good = { swap: { to: UNISWAP_UNIVERSAL_ROUTER, data: '0x3593564c00000000', value: '0' as const, chainId: 5042, gasLimit: null }, gasFee: null, requestId: null }
  test('accepts only the Universal Router on Arc with real calldata and zero value', () => {
    expect(validateSwapTx(good, ME).to).toBe(UNISWAP_UNIVERSAL_ROUTER)
    expect(() => validateSwapTx({ ...good, swap: { ...good.swap, to: ME } }, ME)).toThrow(/unexpected contract/)
    expect(() => validateSwapTx({ ...good, swap: { ...good.swap, chainId: 1 } }, ME)).toThrow(/network/)
    expect(() => validateSwapTx({ ...good, swap: { ...good.swap, data: '0x' } }, ME)).toThrow(/empty/)
    expect(() => validateSwapTx({ ...good, swap: { ...good.swap, value: '1' as '0' } }, ME)).toThrow(/native value/)
  })
  test('server rejects the same bad shapes before they reach the browser', () => {
    const base = { swap: { to: UNISWAP_UNIVERSAL_ROUTER, from: ME, data: '0x3593564c00000000', value: '0', chainId: 5042 } }
    expect(validateSwapResponse(base, ME).swap.value).toBe('0')
    expect(() => validateSwapResponse({ swap: { ...base.swap, to: ME } }, ME)).toThrow()
    expect(() => validateSwapResponse({ swap: { ...base.swap, from: '0x000000000000000000000000000000000000dEaD' } }, ME)).toThrow()
    expect(() => validateSwapResponse({ swap: { ...base.swap, value: '5' } }, ME)).toThrow()
    expect(() => validateSwapResponse({}, ME)).toThrow()
  })
  test('server rejects non-CLASSIC routing, mismatched quotes and failed simulations', () => {
    const expected = { tokenIn: USDC.toLowerCase(), tokenOut: OTHER.toLowerCase(), amount: '1000000', swapper: ME.toLowerCase() }
    expect(validateQuoteResponse({ routing: 'CLASSIC', quote: quote() as never }, expected).routing).toBe('CLASSIC')
    expect(() => validateQuoteResponse({ routing: 'DUTCH_V2', quote: quote() as never }, expected)).toThrow(/route type/)
    expect(() => validateQuoteResponse({ routing: 'CLASSIC', quote: quote({ input: { token: USDC, amount: '5' } }) as never }, expected)).toThrow()
    expect(() => validateQuoteResponse({ routing: 'CLASSIC', quote: quote({ txFailureReasons: ['SIMULATION_ERROR'] }) as never }, expected)).toThrow(/simulation/)
  })
})
