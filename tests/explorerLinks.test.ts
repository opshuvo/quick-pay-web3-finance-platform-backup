import { describe, expect, test } from 'bun:test'
import { ARC_EXPLORER, arcAddressUrl, arcTxUrl } from '../src/lib/arc'

const HASH = '0x' + 'ab'.repeat(32)
const ADDR = '0x1593C6fdEAB15228c90da354913a919fDA08b7E4'

describe('Arc Etherscan links', () => {
  test('transactions and addresses use arc.etherscan.io', () => {
    expect(ARC_EXPLORER).toBe('https://arc.etherscan.io')
    expect(arcTxUrl(HASH)).toBe(`https://arc.etherscan.io/tx/${HASH}`)
    expect(arcAddressUrl(ADDR)).toBe(`https://arc.etherscan.io/address/${ADDR}`)
  })
  test('malformed input links to the explorer home, never to a broken or injected path', () => {
    expect(arcTxUrl('0x123')).toBe(ARC_EXPLORER)
    expect(arcTxUrl('../../evil')).toBe(ARC_EXPLORER)
    expect(arcAddressUrl('not-an-address')).toBe(ARC_EXPLORER)
  })
})
