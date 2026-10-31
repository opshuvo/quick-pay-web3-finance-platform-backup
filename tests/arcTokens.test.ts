import { describe, expect, test } from 'bun:test'
import { isAddress } from 'viem'
import { DEFAULT_RECEIVE_TOKEN, OFFICIAL_ARC_TOKENS } from '../src/lib/arcTokens'

describe('official Arc token list', () => {
  test('USDC is first and is the official Arc USDC', () => {
    expect(OFFICIAL_ARC_TOKENS[0].address).toBe('0x3600000000000000000000000000000000000000')
    expect(OFFICIAL_ARC_TOKENS[0].expectedDecimals).toBe(6)
  })
  test('offers at least one receive token besides USDC, all valid and unique', () => {
    const others = OFFICIAL_ARC_TOKENS.filter((t) => t.id !== 'usdc')
    expect(others.length).toBeGreaterThan(0)
    for (const t of OFFICIAL_ARC_TOKENS) expect(isAddress(t.address, { strict: false })).toBe(true)
    expect(new Set(OFFICIAL_ARC_TOKENS.map((t) => t.address.toLowerCase())).size).toBe(OFFICIAL_ARC_TOKENS.length)
  })
  test('the default receive token is never USDC', () => {
    expect(DEFAULT_RECEIVE_TOKEN.toLowerCase()).not.toBe('0x3600000000000000000000000000000000000000')
  })
})
