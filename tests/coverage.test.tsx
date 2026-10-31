import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { evaluateCoverage, type CoverageInput } from '../server/coverageState'
import { CoverageNotice, COVERAGE_SCOPE, HistoryHint } from '../src/components/Coverage'

const NOW = 2_000_000_000_000
const base: CoverageInput = {
  registered: true, head: 1_000_000n, newest: 1_000_000n, oldest: 600_000n, completeLagBlocks: 240n,
  lastError: null, lastErrorAt: null, now: NOW, lastProgressAt: NOW - 5_000, stallAfterMs: 600_000, rpc: 'public', range: 2000,
}

describe('evaluateCoverage', () => {
  test('partial: scanned range, remaining blocks and percent are reported', () => {
    const c = evaluateCoverage(base)
    expect(c).toMatchObject({ status: 'indexing', oldestScannedBlock: 600_000, newestScannedBlock: 1_000_000, blocksRemaining: 600_000, stalled: false })
    expect(c.percent).toBeCloseTo(40, 0)
  })
  test('complete only when block 0 was reached AND the tip is near the head', () => {
    expect(evaluateCoverage({ ...base, oldest: 0n }).status).toBe('complete')
    expect(evaluateCoverage({ ...base, oldest: 0n, newest: 999_800n }).status).toBe('complete')
    expect(evaluateCoverage({ ...base, oldest: 0n, newest: 999_000n }).status).toBe('indexing')
    expect(evaluateCoverage({ ...base, oldest: 1n }).status).toBe('indexing')
  })
  test('unregistered wallets claim nothing', () => {
    const c = evaluateCoverage({ ...base, registered: false })
    expect(c).toMatchObject({ status: 'unregistered', oldestScannedBlock: null, newestScannedBlock: null, percent: 0, stalled: false, error: null })
  })
  test('stalled: no progress beyond the threshold, with the last error kept however old', () => {
    const fresh = evaluateCoverage({ ...base, lastProgressAt: NOW - 599_000 })
    expect(fresh.stalled).toBe(false)
    const stalled = evaluateCoverage({ ...base, lastProgressAt: NOW - 601_000, lastError: 'RPC request failed; retrying.', lastErrorAt: new Date(NOW - 3_600_000) })
    expect(stalled).toMatchObject({ status: 'indexing', stalled: true, error: 'RPC request failed; retrying.' })
    expect(stalled.msSinceProgress).toBe(601_000)
  })
  test('error: a recent indexer error is shown, an old one on a healthy wallet is not', () => {
    expect(evaluateCoverage({ ...base, lastError: 'boom', lastErrorAt: new Date(NOW - 30_000) }).error).toBe('boom')
    expect(evaluateCoverage({ ...base, lastError: 'boom', lastErrorAt: new Date(NOW - 600_000) }).error).toBeNull()
  })
  test('a complete wallet is never reported as stalled', () => {
    const c = evaluateCoverage({ ...base, oldest: 0n, lastProgressAt: NOW - 3_600_000 })
    expect(c).toMatchObject({ status: 'complete', stalled: false, msSinceProgress: null })
  })
})

const html = (input: Partial<CoverageInput>) => renderToStaticMarkup(<CoverageNotice coverage={evaluateCoverage({ ...base, ...input })} />)

describe('CoverageNotice wording', () => {
  test('complete says USDC token transfers and lists what is not covered', () => {
    const out = html({ oldest: 0n })
    expect(out).toContain('USDC token transfers complete')
    expect(out).not.toContain('History complete')
    expect(out).toContain(COVERAGE_SCOPE)
    expect(out).toMatch(/Native-value transfers, pending transactions and failed transactions are not included/)
  })
  test('partial shows the scanned range and says results can be incomplete', () => {
    const out = html({})
    expect(out).toContain('Backfill in progress')
    expect(out).toContain('600,000')
    expect(out).toMatch(/incomplete/)
    expect(out).not.toContain('complete:')
  })
  test('stalled is a warning that says how long and shows the last error', () => {
    const out = html({ lastProgressAt: NOW - 12 * 60_000, lastError: 'RPC request failed; retrying.', lastErrorAt: new Date(NOW - 11 * 60_000) })
    expect(out).toContain('Indexing looks stalled')
    expect(out).toContain('about 12 minutes')
    expect(out).toContain('RPC request failed; retrying.')
  })
  test('an indexing error on a moving wallet is shown as a note, not as stalled', () => {
    const out = html({ lastError: 'The RPC provider is rate limiting requests; waiting before retrying.', lastErrorAt: new Date(NOW - 5_000) })
    expect(out).toContain('Indexer note')
    expect(out).not.toContain('stalled')
  })
  test('unregistered says indexing is starting and shows no history', () => {
    const out = html({ registered: false })
    expect(out).toContain('Starting to index this wallet')
    expect(out).not.toContain('complete')
  })
})

describe('HistoryHint (user-facing Overview and history)', () => {
  const hint = (input: Partial<CoverageInput>) => renderToStaticMarkup(<HistoryHint coverage={evaluateCoverage({ ...base, ...input })} />)
  test('partial history says it is still syncing without any progress details', () => {
    const out = hint({})
    expect(out).toContain('still syncing')
    expect(out).not.toMatch(/Backfill|%|blocks|remaining|RPC|\d{3},\d{3}/)
  })
  test('stalled, errored and unregistered wallets also stay non-technical and never claim completeness', () => {
    for (const out of [hint({ lastProgressAt: NOW - 20 * 60_000, lastError: 'RPC request failed', lastErrorAt: new Date(NOW) }), hint({ registered: false })]) {
      expect(out).toContain('still syncing')
      expect(out).not.toMatch(/RPC|stalled|complete/i)
    }
  })
  test('complete history only states its scope', () => {
    const out = hint({ oldest: 0n })
    expect(out).toContain('USDC token transfers')
    expect(out).not.toContain('syncing')
  })
})
