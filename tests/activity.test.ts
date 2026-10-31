import { describe, expect, test } from 'bun:test'
import { netFlows, pickSwapLegs } from '../server/activity'

const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`
const me = '0x52908400098527886e0f7030069857d2e4169ee7'
const pool = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const hex = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
const log = (token: string, from: string, to: string, amount: bigint) => ({ address: token, topics: [T, topic(from), topic(to)], data: hex(amount) }) as never

describe('netFlows / pickSwapLegs', () => {
  test('reads a swap from receipt logs: tokens out and in', () => {
    const logs = [log('0xaaaa000000000000000000000000000000000001', me, pool, 1_000_000n), log('0xbbbb000000000000000000000000000000000002', pool, me, 990_000n)]
    const legs = pickSwapLegs(netFlows(logs, me))
    expect(legs?.tokenIn.net).toBe(-1_000_000n)
    expect(legs?.tokenOut.net).toBe(990_000n)
  })
  test('ignores transfers that do not involve the wallet and nets out refunds', () => {
    const logs = [log('0xaaaa000000000000000000000000000000000001', pool, pool, 5n), log('0xaaaa000000000000000000000000000000000001', me, pool, 100n), log('0xaaaa000000000000000000000000000000000001', pool, me, 30n)]
    expect(netFlows(logs, me)).toEqual([{ token: '0xaaaa000000000000000000000000000000000001', net: -70n }])
  })
  test("ignores Arc's 18-decimal native mirror logs so USDC is not double counted", () => {
    const native = '0xfffffffffffffffffffffffffffffffffffffffe'
    const usdc = '0x3600000000000000000000000000000000000000'
    const logs = [log(native, me, pool, 1_000_000n * 10n ** 12n), log(usdc, me, pool, 1_000_000n), log('0xbbbb000000000000000000000000000000000002', pool, me, 7n)]
    const legs = pickSwapLegs(netFlows(logs, me))
    expect(legs?.tokenIn).toEqual({ token: usdc, net: -1_000_000n })
  })
  test('a plain transfer is not a swap (needs both an outflow and an inflow)', () => {
    expect(pickSwapLegs(netFlows([log('0xaaaa000000000000000000000000000000000001', me, pool, 100n)], me))).toBeNull()
  })
})
