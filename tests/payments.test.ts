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

describe('EURC and USDC amounts and recipients', () => {
  test('a token amount is exact, in six decimals, and above zero', async () => {
    const { validateTokenAmount } = await import('../src/lib/payments')
    expect(validateTokenAmount('12.5', 'EURC')).toBe(12_500_000n)
    expect(validateTokenAmount('0.000001', 'EURC')).toBe(1n)
    expect(() => validateTokenAmount('0.0000001', 'EURC')).toThrow('EURC supports at most 6 decimal places')
    expect(() => validateTokenAmount('0', 'USDC')).toThrow('greater than zero')
    expect(() => validateTokenAmount('1e3', 'USDC')).toThrow('numbers only')
    expect(() => validateTokenAmount('5', 'EURC', 6, 4_999_999n)).toThrow('larger than your available balance')
    expect(validateTokenAmount('5', 'EURC', 6, 5_000_000n)).toBe(5_000_000n)
  })
  test('the EURC token contract is refused as a recipient, like the USDC contract', async () => {
    const { validateRecipient } = await import('../src/lib/payments')
    expect(() => validateRecipient('0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1')).toThrow('EURC token contract')
    expect(() => validateRecipient('0x3600000000000000000000000000000000000000')).toThrow('USDC token contract')
  })
})
