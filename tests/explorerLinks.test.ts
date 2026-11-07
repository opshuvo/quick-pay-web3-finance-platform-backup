import { describe, expect, test } from 'bun:test'
import { ARC_EXPLORER, arcAddressUrl, arcTxUrl } from '../src/lib/arc'

const HASH = '0x' + 'ab'.repeat(32)
const ADDR = '0x1593C6fdEAB15228c90da354913a919fDA08b7E4'

describe('Arc explorer links', () => {
  test('transactions and addresses use Arc\'s official explorer', () => {
    expect(ARC_EXPLORER).toBe('https://explorer.arc.io')
    expect(arcTxUrl(HASH)).toBe(`https://explorer.arc.io/tx/${HASH}`)
    expect(arcAddressUrl(ADDR)).toBe(`https://explorer.arc.io/address/${ADDR}`)
  })
  test('malformed input links to the explorer home, never to a broken or injected path', () => {
    expect(arcTxUrl('0x123')).toBe(ARC_EXPLORER)
    expect(arcTxUrl('../../evil')).toBe(ARC_EXPLORER)
    expect(arcAddressUrl('not-an-address')).toBe(ARC_EXPLORER)
  })
})
