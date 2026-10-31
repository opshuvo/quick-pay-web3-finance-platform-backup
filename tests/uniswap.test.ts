import { describe, expect, test } from 'bun:test'
import { buildSwap, assertSlippage, maxIn, minOut, UNIVERSAL_ROUTER, type Quote } from '../src/lib/uniswap/arc'

const USDC = '0x3600000000000000000000000000000000000000'
const OTHER = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const ME = '0x52908400098527886E0F7030069857D2E4169EE7'
const quote: Quote = { route: { version: 'v3', fee: 500, sqrtPriceX96: 1n << 96n, feeFraction: 0.0005 }, side: 'exactIn', amountIn: 1_000_000n, amountOut: 990_000n, priceImpact: 0.001 }

describe('slippage bounds', () => {
  test('minOut / maxIn apply basis points', () => {
    expect(minOut(1_000_000n, 50)).toBe(995_000n)
    expect(maxIn(1_000_000n, 100)).toBe(1_010_000n)
  })
  test('rejects more than 1% and non-integers', () => {
    expect(() => assertSlippage(101)).toThrow()
    expect(() => assertSlippage(28.999)).toThrow()
    expect(() => assertSlippage(-1)).toThrow()
  })
})

describe('buildSwap', () => {
  test('targets Universal Router 2.1.2 with zero native value and execute selector', () => {
    const tx = buildSwap(quote, USDC, OTHER, ME, 50, 1_900_000_000n)
    expect(tx.to).toBe(UNIVERSAL_ROUTER)
    expect(tx.value).toBe(0n)
    expect(tx.data.startsWith('0x3593564c')).toBe(true) // execute(bytes,bytes[],uint256)
    expect(tx.limitOut).toBe(985_050n)
  })
  test('refuses slippage above the cap', () => {
    expect(() => buildSwap(quote, USDC, OTHER, ME, 500, 1n)).toThrow()
  })
})
