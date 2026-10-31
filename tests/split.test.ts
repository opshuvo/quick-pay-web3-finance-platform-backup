import { describe, expect, test } from 'bun:test'
import { equalShares, summarizeSplit, sumShares, validateSplit, type Split } from '../src/lib/split'

const A = '0x52908400098527886E0F7030069857D2E4169EE7'
const B = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ME = '0x8366a39CC670B4001A1121B8F6A443A643e40951'

describe('equalShares', () => {
  test('always sums exactly to the total', () => {
    for (const [total, n] of [[100n, 3], [1n, 3], [10_000_000n, 7], [999_999n, 12], [5n, 1]] as const) {
      const shares = equalShares(total, n)
      expect(shares).toHaveLength(n)
      expect(sumShares(shares)).toBe(total)
    }
  })
  test('puts leftover units on the first shares, never differing by more than one unit', () => {
    expect(equalShares(100n, 3)).toEqual([34n, 33n, 33n])
    expect(equalShares(10n, 4)).toEqual([3n, 3n, 2n, 2n])
  })
  test('handles empty or invalid counts', () => {
    expect(equalShares(100n, 0)).toEqual([])
  })
})

describe('validateSplit', () => {
  const draft = (over = {}) => ({
    title: 'Dinner',
    total: 30_000_000n,
    organizerAddress: ME,
    participants: [
      { name: 'Ana', address: A, amount: 10_000_000n, isOrganizer: false },
      { name: 'Ben', address: B, amount: 10_000_000n, isOrganizer: false },
      { name: 'Me', address: ME, amount: 10_000_000n, isOrganizer: true },
    ],
    ...over,
  })
  test('accepts a custom split whose shares equal the total', () => {
    const v = validateSplit(draft())
    expect(v.ok).toBe(true)
    expect(v.difference).toBe(0n)
  })
  test('reports under- and over-assigned amounts', () => {
    const under = validateSplit(draft({ total: 31_000_000n }))
    expect(under.ok).toBe(false)
    expect(under.difference).toBe(1_000_000n)
    const over = validateSplit(draft({ total: 29_000_000n }))
    expect(over.difference).toBe(-1_000_000n)
    expect(over.errors.join(' ')).toMatch(/more than/)
  })
  test('rejects duplicate, invalid, own and zero addresses and zero amounts', () => {
    const dup = validateSplit(draft({ participants: [
      { name: 'Ana', address: A, amount: 15_000_000n, isOrganizer: false },
      { name: 'Ana2', address: A.toLowerCase(), amount: 15_000_000n, isOrganizer: false },
    ] }))
    expect(dup.errors.join(' ')).toMatch(/already in the split/)
    expect(validateSplit(draft({ participants: [{ name: 'X', address: '0x12', amount: 1n, isOrganizer: false }, { name: 'Y', address: B, amount: 1n, isOrganizer: false }] })).errors.join(' ')).toMatch(/valid wallet address/)
    expect(validateSplit(draft({ participants: [{ name: 'Me2', address: ME, amount: 15_000_000n, isOrganizer: false }, { name: 'Ben', address: B, amount: 15_000_000n, isOrganizer: false }] })).errors.join(' ')).toMatch(/your own address/)
    expect(validateSplit(draft({ participants: [{ name: 'Z', address: '0x0000000000000000000000000000000000000000', amount: 15_000_000n, isOrganizer: false }, { name: 'Ben', address: B, amount: 15_000_000n, isOrganizer: false }] })).errors.join(' ')).toMatch(/zero address/)
    expect(validateSplit(draft({ participants: [{ name: 'Ana', address: A, amount: 0n, isOrganizer: false }, { name: 'Ben', address: B, amount: 30_000_000n, isOrganizer: false }] })).errors.join(' ')).toMatch(/greater than zero/)
  })
  test('needs a title, a total and at least two participants', () => {
    expect(validateSplit(draft({ title: ' ' })).ok).toBe(false)
    expect(validateSplit(draft({ total: undefined })).ok).toBe(false)
    expect(validateSplit(draft({ participants: [{ name: 'Ana', address: A, amount: 30_000_000n, isOrganizer: false }] })).ok).toBe(false)
  })
})

describe('summarizeSplit', () => {
  const split: Split = {
    id: 's1', owner: ME.toLowerCase(), title: 'Dinner', description: '', total: '30000000', mode: 'equal', createdAt: '2026-01-01T00:00:00Z',
    participants: [
      { id: '1', name: 'Ana', address: A, amount: '10000000', isOrganizer: false, requestId: 'r1' },
      { id: '2', name: 'Ben', address: B, amount: '10000000', isOrganizer: false, requestId: 'r2' },
      { id: '3', name: 'Me', address: ME, amount: '10000000', isOrganizer: true },
    ],
  }
  test('counts only verified payments as paid', () => {
    const s = summarizeSplit(split, { r1: 'paid', r2: 'unpaid' })
    expect(s.paid).toBe(10_000_000n)
    expect(s.pending).toBe(10_000_000n)
    expect(s.own).toBe(10_000_000n)
    expect(s.unpaid).toBe(0n)
    expect(s.paid + s.pending + s.own + s.unpaid).toBe(s.total)
  })
  test('expired, cancelled and unrequested shares are unpaid', () => {
    const s = summarizeSplit(split, { r1: 'expired' })
    expect(s.paid).toBe(0n)
    expect(s.unpaid).toBe(20_000_000n)
  })
})
