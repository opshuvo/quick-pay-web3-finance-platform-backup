import { describe, expect, test } from 'bun:test'
import { displayUnits, displayUsdc, shortAddress } from '../src/lib/format'

describe('displayUnits', () => {
  test('groups thousands and keeps at least two decimals', () => {
    expect(displayUsdc(1_234_567_890n)).toBe('1,234.56789')
    expect(displayUsdc(5_000_000n)).toBe('5.00')
    expect(displayUsdc(0n)).toBe('0.00')
  })
  test('handles negatives and other decimals', () => {
    expect(displayUsdc(-1_500_000n)).toBe('-1.50')
    expect(displayUnits(10n ** 18n, 18)).toBe('1.00')
  })
  test('shortens addresses', () => {
    expect(shortAddress('0x52908400098527886E0F7030069857D2E4169EE7')).toBe('0x5290…9EE7')
  })
})
