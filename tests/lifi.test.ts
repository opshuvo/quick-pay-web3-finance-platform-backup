import { describe, expect, test } from 'bun:test'
import { assertBridgeQuote, BridgeGuardError } from '../src/lib/bridgeGuard'
import { lifiToQuote, type LifiQuote } from '../src/lib/lifi'

const WALLET = '0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968'
const OTHER = '0x1111111111111111111111111111111111111111'
const DIAMOND = '0xA4072583658Fae592A3506A42431cb6316a8d40b'
const USDC_ARC = '0x3600000000000000000000000000000000000000'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const NOW = 1_793_500_000_000

const raw = (over: Partial<LifiQuote> = {}): LifiQuote => ({
  id: 'q1',
  tool: 'across',
  toolDetails: { name: 'AcrossV4' },
  action: {
    fromChainId: 5042, toChainId: 8453, fromAmount: '1000000', fromAddress: WALLET, toAddress: WALLET,
    fromToken: { address: USDC_ARC, chainId: 5042, symbol: 'USDC', decimals: 6 },
    toToken: { address: USDC_BASE, chainId: 8453, symbol: 'USDC', decimals: 6 },
  },
  estimate: { approvalAddress: DIAMOND, fromAmount: '1000000', toAmount: '993446', toAmountMin: '993446', executionDuration: 2, fromAmountUSD: '1.0014', toAmountUSD: '0.9895' },
  transactionRequest: { to: DIAMOND, data: '0x1794958f00000000', value: '0x0', gasLimit: '0x42f54', chainId: 5042 },
  ...over,
})
const ctx = { depositor: WALLET as `0x${string}`, recipient: WALLET as `0x${string}`, diamond: DIAMOND as `0x${string}`, allowance: 0n, nowMs: NOW }

describe('LI.FI quote mapping and safety checks', () => {
  test('maps to the shared quote shape and passes the shared bridge guard', () => {
    const q = lifiToQuote(raw(), ctx)
    expect(q.provider).toBe('lifi')
    expect(q.via).toBe('AcrossV4')
    expect(q.fees.total.amount).toBe('6554')
    expect(q.checks.allowance.expected).toBe('1000000')
    expect(q.quoteExpiryTimestamp).toBe(Math.floor(NOW / 1000) + 55)
    expect(() => assertBridgeQuote(q, { origin: 5042, destination: 8453, originToken: USDC_ARC, destinationToken: USDC_BASE, amountRaw: 1_000_000n })).not.toThrow()
  })
  test('refuses a recipient other than the one chosen', () => {
    expect(() => lifiToQuote(raw({ action: { ...raw().action, toAddress: OTHER } }), ctx)).toThrow(BridgeGuardError)
  })
  test('refuses a sender other than the wallet', () => {
    expect(() => lifiToQuote(raw({ action: { ...raw().action, fromAddress: OTHER } }), ctx)).toThrow(BridgeGuardError)
  })
  test('refuses a transaction that does not target LI.FI\'s own contract', () => {
    expect(() => lifiToQuote(raw({ transactionRequest: { ...(raw().transactionRequest as NonNullable<LifiQuote['transactionRequest']>), to: OTHER } }), ctx)).toThrow(BridgeGuardError)
  })
  test('refuses when LI.FI\'s contract for the network is unknown', () => {
    expect(() => lifiToQuote(raw(), { ...ctx, diamond: undefined })).toThrow(BridgeGuardError)
  })
  test('refuses a quote without a transaction or for another network', () => {
    expect(() => lifiToQuote(raw({ transactionRequest: undefined }), ctx)).toThrow(BridgeGuardError)
    expect(() => lifiToQuote(raw({ transactionRequest: { ...(raw().transactionRequest as NonNullable<LifiQuote['transactionRequest']>), chainId: 1 } }), ctx)).toThrow(BridgeGuardError)
  })
  test('an approval to a spender other than the transaction target is refused by the shared guard', () => {
    const q = lifiToQuote(raw({ estimate: { ...raw().estimate, approvalAddress: OTHER } }), ctx)
    expect(() => assertBridgeQuote(q, { origin: 5042, destination: 8453, originToken: USDC_ARC, destinationToken: USDC_BASE, amountRaw: 1_000_000n })).toThrow(BridgeGuardError)
  })
})
