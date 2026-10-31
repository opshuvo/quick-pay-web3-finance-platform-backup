import { describe, expect, test } from 'bun:test'
import { buildUsdcUri, parsePaymentContent, PaymentParseError, validateAmount, validateRecipient } from '../src/lib/payments'

const A = '0x52908400098527886E0F7030069857D2E4169EE7'
const USDC = '0x3600000000000000000000000000000000000000'

describe('validateRecipient', () => {
  test('accepts checksummed and lowercase addresses', () => {
    expect(validateRecipient(A)).toBe(A)
    expect(validateRecipient(A.toLowerCase())).toBe(A)
  })
  test('rejects bad input, zero address, the USDC contract, and self', () => {
    expect(() => validateRecipient('0x123')).toThrow(PaymentParseError)
    expect(() => validateRecipient('0x0000000000000000000000000000000000000000')).toThrow(/zero address/)
    expect(() => validateRecipient(USDC)).toThrow(/token contract/)
    expect(() => validateRecipient(A, A.toLowerCase())).toThrow(/own address/)
  })
  test('rejects a mixed-case address with a bad checksum', () => {
    const bad = `0x${A.slice(2, 10).toLowerCase()}${A.slice(10).replace('E', 'e')}`
    expect(() => validateRecipient(bad)).toThrow()
  })
})

describe('validateAmount', () => {
  test('parses to 6-decimal base units', () => {
    expect(validateAmount('1')).toBe(1_000_000n)
    expect(validateAmount('0.000001')).toBe(1n)
    expect(validateAmount('12.5')).toBe(12_500_000n)
  })
  test('rejects zero, empty, too many decimals, junk and over-balance', () => {
    expect(() => validateAmount('0')).toThrow()
    expect(() => validateAmount('')).toThrow()
    expect(() => validateAmount('1.0000001')).toThrow(/6 decimal/)
    expect(() => validateAmount('1e5')).toThrow()
    expect(() => validateAmount('.')).toThrow()
    expect(() => validateAmount('5', 4_000_000n)).toThrow(/balance/)
  })
})

describe('parsePaymentContent', () => {
  test('plain address', () => {
    expect(parsePaymentContent(A)).toEqual({ kind: 'address', to: A })
  })
  test('EIP-681 USDC transfer on Arc with amount', () => {
    const uri = buildUsdcUri(A as `0x${string}`, 2_500_000n)
    expect(parsePaymentContent(uri)).toEqual({ kind: 'address', to: A, amount: '2' + '.5' })
  })
  test('quick pay request link', () => {
    expect(parsePaymentContent('https://example.com/pay/abcdefghjkmnpqrs')).toEqual({ kind: 'request', id: 'abcdefghjkmnpqrs' })
  })
  test('rejects other chains, other tokens, native value and garbage', () => {
    expect(() => parsePaymentContent(`ethereum:${A}@1`)).toThrow(/chain 1/)
    expect(() => parsePaymentContent(`ethereum:${A}@5042/transfer?address=${A}`)).toThrow(/other than USDC/)
    expect(() => parsePaymentContent(`ethereum:${A}@5042?value=1000`)).toThrow(/Native-value/)
    expect(() => parsePaymentContent('hello world')).toThrow()
    expect(() => parsePaymentContent('')).toThrow()
  })
  test('scanning never yields anything but details to review', () => {
    const parsed = parsePaymentContent(A)
    expect(Object.keys(parsed).sort()).toEqual(['kind', 'to'])
  })
})
