import { describe, expect, test } from 'bun:test'
import { formatPercent, formatRate, formatTokenAmount, parseTokenAmount } from '../src/lib/swapAmount'

describe('parseTokenAmount (token decimals, no floats)', () => {
  test.each([
    ['0.01', 6, 10_000n],
    ['1', 6, 1_000_000n],
    ['5', 6, 5_000_000n],
    ['5.', 6, 5_000_000n],
    ['.5', 6, 500_000n],
    ['0.000001', 6, 1n],
    ['0.000000000000000001', 18, 1n],
    ['1.5', 18, 1_500_000_000_000_000_000n],
    ['123456789.123456', 6, 123_456_789_123_456n],
  ])('%s with %i decimals', (text, decimals, expected) => {
    expect(parseTokenAmount(text, decimals)).toEqual({ ok: true, value: expected })
  })
  test('rejects extra decimals instead of rounding them away', () => {
    expect(parseTokenAmount('0.0000001', 6)).toMatchObject({ ok: false, reason: 'too_many_decimals' })
    expect(parseTokenAmount('1.5', 0)).toMatchObject({ ok: false, reason: 'too_many_decimals' })
  })
  test('rejects empty, zero and junk', () => {
    expect(parseTokenAmount('', 6)).toMatchObject({ ok: false, reason: 'empty' })
    expect(parseTokenAmount('0', 6)).toMatchObject({ ok: false, reason: 'zero' })
    expect(parseTokenAmount('0.000000', 6)).toMatchObject({ ok: false, reason: 'zero' })
    for (const bad of ['abc', '1e3', '-1', '1.2.3', '1,5', '0x10', ' ', '.', '1 000']) expect(parseTokenAmount(bad, 6)).toMatchObject({ ok: false })
  })
})

describe('formatTokenAmount (exact, truncating, never shows a real amount as zero)', () => {
  test('small quotes keep meaningful digits: 0.01 USDC is about 0.008962 EURC', () => {
    expect(formatTokenAmount(8_962n, 6)).toBe('0.008962')
    expect(formatTokenAmount(896_208n, 6)).toBe('0.896208')
    expect(formatTokenAmount(1n, 6)).toBe('0.000001')
    expect(formatTokenAmount(1n, 18)).toBe('0.000000000000000001')
    expect(formatTokenAmount(1_234_567_890_123n, 18)).toBe('0.000001234')
  })
  test('amounts of 1 or more use grouping and at least two decimals', () => {
    expect(formatTokenAmount(5_000_000n, 6)).toBe('5.00')
    expect(formatTokenAmount(1_234_567_890n, 6)).toBe('1,234.56789')
    expect(formatTokenAmount(1_123_456_789_012_345_678n, 18)).toBe('1.123456')
  })
  test('truncates, never rounds up', () => {
    expect(formatTokenAmount(999_999n, 6, { maxFrac: 4 })).toBe('0.9999')
    expect(formatTokenAmount(1_999_999n, 6, { maxFrac: 4 })).toBe('1.9999')
  })
  test('zero and negatives', () => {
    expect(formatTokenAmount(0n, 6)).toBe('0.00')
    expect(formatTokenAmount(-8_962n, 6)).toBe('-0.008962')
  })
  test('a non-zero amount is never displayed as zero', () => {
    for (const decimals of [6, 8, 18]) for (const raw of [1n, 7n, 123n]) expect(formatTokenAmount(raw, decimals)).not.toMatch(/^0\.0+$/)
  })
})

describe('formatRate', () => {
  test('exact fixed-point rate for equal and different decimals', () => {
    expect(formatRate(896_208n, 6, 1_000_000n, 6)).toBe('0.8962')
    expect(formatRate(8_962n, 6, 10_000n, 6)).toBe('0.8962')
    expect(formatRate(1_000_000_000_000_000_000n, 18, 1_000_000n, 6)).toBe('1.00')
    expect(formatRate(1_000_000n, 6, 500_000_000_000_000_000n, 18)).toBe('2.00')
  })
  test('no rate without an input amount', () => {
    expect(formatRate(1n, 6, 0n, 6)).toBeUndefined()
  })
})

describe('formatPercent', () => {
  test('tiny impacts are not shown as exactly zero', () => {
    expect(formatPercent(0.0001)).toBe('<0.01%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(1.234)).toBe('1.23%')
    expect(formatPercent(Number.NaN)).toBe('0%')
  })
})
