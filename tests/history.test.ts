import { describe, expect, test } from 'bun:test'
import { buildWhere, type HistoryFilters } from '../server/history'

const base: HistoryFilters = { address: '0x52908400098527886e0f7030069857d2e4169ee7', direction: 'all', type: 'all', q: '', page: 1, pageSize: 25 }

describe('buildWhere', () => {
  test('always scopes to the wallet and parameterizes values', () => {
    const w = buildWhere({ ...base, direction: 'in', q: '0xabc', since: new Date('2026-01-01') })
    expect(w.text).toContain('t.from_addr = $1 or t.to_addr = $1')
    expect(w.params[0]).toBe(base.address)
    expect(w.text).not.toContain('0xabc')
    expect(w.params).toContain('0xabc%')
  })
  test('rejects non-hex search input instead of building SQL from it', () => {
    expect(() => buildWhere({ ...base, q: "x'; drop table transfers;--" })).toThrow()
  })
})

describe('coverage scoping', () => {
  test("history only counts the wallet's own scanned block interval, using only the wallet parameter", () => {
    const w = buildWhere(base)
    expect(w.text).toContain('t.block_number between (select oldest_scanned from wallets where address = $1) and (select newest_scanned from wallets where address = $1)')
    expect(w.params).toEqual([base.address])
  })
})

describe('swap and bridge labelling', () => {
  test('type filters use constant protocol address lists, never user input', () => {
    const swap = buildWhere({ ...base, type: 'swap' })
    expect(swap.text).toContain("= 'swap'")
    expect(swap.text).toContain('0x8366a39cc670b4001a1121b8f6a443a643e40951')
    const bridge = buildWhere({ ...base, type: 'bridge' })
    expect(bridge.text).toContain('0x9b4a302a548c7e313c2b74c461db7b84d3074a84')
    expect(bridge.params).toEqual([base.address])
  })
})
