import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, type Address, type Hash, type Log } from 'viem'
import {
  matchBatchReceipts, MAX_PAYROLL_ROWS, newRun, normalizeLoadedRun, parseRecipients, requeueUnsent, retryFailed, runQueue, summarizeRun, supportsAtomicBatch,
  validatePayroll, type PayrollRun, type QueueDeps, type RunRow,
} from '../src/lib/payroll'

const A = '0x1111111111111111111111111111111111111111' as Address
const B = '0x2222222222222222222222222222222222222222' as Address
const C = '0x3333333333333333333333333333333333333333' as Address
const SENDER = '0x9999999999999999999999999999999999999999' as Address
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as Address
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash

describe('reading a pasted list', () => {
  test('accepts commas, tabs and semicolons, a header line and a label', () => {
    const text = `address,amount,label\n${A}, 1250.50, Ana Lopez\n${B}\t30\n${C};0.5`
    const { rows, skipped } = parseRecipients(text)
    expect(skipped).toEqual([])
    expect(rows.map((r) => [r.address, r.amount, r.label])).toEqual([[A, '1250.50', 'Ana Lopez'], [B, '30', undefined], [C, '0.5', undefined]])
  })
  test('reports lines that cannot be read and never invents a value', () => {
    const { rows, skipped } = parseRecipients(`${A}\n\n${B} 5`)
    expect(rows.length).toBe(1)
    expect(skipped).toEqual([{ line: 1, text: A, reason: 'Needs an address and an amount.' }])
  })
  test('stops at the batch limit and says so', () => {
    const text = Array.from({ length: MAX_PAYROLL_ROWS + 2 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')} 1`).join('\n')
    const { rows, skipped } = parseRecipients(text)
    expect(rows.length).toBe(MAX_PAYROLL_ROWS)
    expect(skipped.length).toBe(2)
  })
})

describe('checking a batch', () => {
  const rows = (items: [string, string][]) => items.map(([address, amount], i) => ({ id: `r${i}`, address, amount }))
  test('a clean batch is ok and totals exactly', () => {
    const v = validatePayroll(rows([[A, '10.25'], [B, '0.000001']]), 'USDC', SENDER, 11_000_000n)
    expect(v.ok).toBe(true)
    expect(v.total).toBe(10_250_001n)
  })
  test('every problem is attached to its row', () => {
    const v = validatePayroll(rows([['nope', '5'], [A, '1.1234567'], [B, '0'], [SENDER, '1']]), 'EURC', SENDER, undefined)
    expect(v.ok).toBe(false)
    expect(v.issues.map((i) => `${i.id}:${i.field}`)).toEqual(['r0:address', 'r1:amount', 'r2:amount', 'r3:address'])
    expect(v.issues.find((i) => i.id === 'r1')?.message).toContain('EURC')
  })
  test('token contracts and the zero address are refused', () => {
    const v = validatePayroll(rows([[EURC, '1'], ['0x0000000000000000000000000000000000000000', '1']]), 'USDC', SENDER, undefined)
    expect(v.issues.length).toBe(2)
    expect(v.issues[0].message).toContain('token contract')
  })
  test('a total above the balance blocks the batch; a duplicate address only warns', () => {
    const over = validatePayroll(rows([[A, '6'], [B, '6']]), 'USDC', SENDER, 10_000_000n)
    expect(over.overBalance).toBe(true)
    expect(over.ok).toBe(false)
    const dup = validatePayroll(rows([[A, '1'], [A.toLowerCase(), '2']]), 'USDC', SENDER, 100_000_000n)
    expect(dup.ok).toBe(true)
    expect(dup.duplicates).toEqual([A.toLowerCase()])
  })
  test('an empty batch is not ok', () => expect(validatePayroll([], 'USDC', SENDER, 1n).ok).toBe(false))
})

function runOf(n: number): PayrollRun {
  const valid = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, to: getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`), amount: BigInt((i + 1) * 1_000_000) }))
  return newRun(SENDER, 'USDC', 'queue', valid)
}
function deps(overrides: Partial<QueueDeps> & { sent?: string[] } = {}): { deps: QueueDeps; sent: string[]; saves: PayrollRun[] } {
  const sent: string[] = overrides.sent ?? []
  const saves: PayrollRun[] = []
  return {
    sent,
    saves,
    deps: {
      send: async (row) => { sent.push(row.id); return h(sent.length) },
      confirm: async () => ({ state: 'confirmed' }),
      isRejection: (e) => (e as Error).message === 'rejected',
      describe: (e) => (e as Error).message,
      onChange: (r) => saves.push(r),
      ...overrides,
    },
  }
}

describe('running a batch', () => {
  test('sends each row once, in order, and confirms from the receipt', async () => {
    const d = deps()
    const run = await runQueue(runOf(3), d.deps)
    expect(d.sent).toEqual(['r0', 'r1', 'r2'])
    expect(run.rows.map((r) => r.state)).toEqual(['confirmed', 'confirmed', 'confirmed'])
    expect(run.rows.map((r) => r.hash)).toEqual([h(1), h(2), h(3)])
    expect(summarizeRun(run).finished).toBe(true)
    expect(summarizeRun(run).confirmedAmount).toBe(6_000_000n)
  })

  test('declining in the wallet pauses the queue, sends nothing further, and the row can be sent later', async () => {
    let calls = 0
    const d = deps({ send: async (row) => { calls++; if (row.id === 'r1') throw new Error('rejected'); return h(calls) } })
    const run = await runQueue(runOf(3), d.deps)
    expect(run.rows.map((r) => r.state)).toEqual(['confirmed', 'queued', 'queued'])
    expect(run.paused).toContain('you declined')
    expect(calls).toBe(2)
    // Resuming sends only what is left.
    const again = deps()
    const finished = await runQueue(run, again.deps)
    expect(again.sent).toEqual(['r1', 'r2'])
    expect(finished.rows.every((r) => r.state === 'confirmed')).toBe(true)
  })

  test('an error before broadcast pauses with its reason and never marks anything sent', async () => {
    const d = deps({ send: async () => { throw new Error('insufficient funds for gas') } })
    const run = await runQueue(runOf(2), d.deps)
    expect(run.paused).toContain('insufficient funds for gas')
    expect(run.rows.map((r) => [r.state, r.hash])).toEqual([['queued', undefined], ['queued', undefined]])
  })

  test('a reverted receipt marks the row failed; the others still go through', async () => {
    const d = deps({ confirm: async (_hash, row) => (row.id === 'r1' ? { state: 'failed', error: 'reverted' } : { state: 'confirmed' }) })
    const run = await runQueue(runOf(3), d.deps)
    expect(run.rows.map((r) => r.state)).toEqual(['confirmed', 'failed', 'confirmed'])
    const retried = retryFailed(run)
    expect(retried.rows.map((r) => [r.state, r.hash])).toEqual([['confirmed', h(1)], ['queued', undefined], ['confirmed', h(3)]])
  })

  test('a mined receipt without the transfer is Unverified, never confirmed, and is not retried automatically', async () => {
    const d = deps({ confirm: async () => ({ state: 'unverified', error: 'no matching transfer' }) })
    const run = await runQueue(runOf(1), d.deps)
    expect(run.rows[0].state).toBe('unverified')
    expect(retryFailed(run).rows[0].state).toBe('unverified')
  })

  test('if Arc cannot be read after the wallet broadcast, the row stays pending and is never sent again on resume', async () => {
    const first = deps({ confirm: async () => { throw new Error('rpc down') } })
    const run = await runQueue(runOf(2), first.deps)
    expect(run.rows.map((r) => r.state)).toEqual(['pending', 'queued'])
    expect(run.rows[0].hash).toBe(h(1))
    expect(run.paused).toContain('Arc could not be reached')
    const second = deps({ confirm: async () => ({ state: 'confirmed' }) })
    const done = await runQueue(run, second.deps)
    // Row 0 was only checked; row 1 was sent now.
    expect(second.sent).toEqual(['r1'])
    expect(done.rows.map((r) => r.state)).toEqual(['confirmed', 'confirmed'])
  })

  test('a reload during the wallet prompt becomes Unverified and is only re-queued by an explicit action', () => {
    const base = runOf(2)
    const stuck: PayrollRun = { ...base, rows: base.rows.map((r, i) => (i === 0 ? ({ ...r, state: 'wallet' } as RunRow) : r)) }
    const loaded = normalizeLoadedRun(stuck)
    expect(loaded.rows[0].state).toBe('unverified')
    expect(loaded.rows[0].error).toContain('cannot tell')
    expect(retryFailed(loaded).rows[0].state).toBe('unverified')
    expect(requeueUnsent(loaded, 'r0').rows[0].state).toBe('queued')
    // A row that does have a hash can never be re-queued this way.
    const withHash: PayrollRun = { ...loaded, rows: loaded.rows.map((r) => (r.id === 'r0' ? { ...r, hash: h(9) } : r)) }
    expect(requeueUnsent(withHash, 'r0').rows[0].state).toBe('unverified')
  })
})

describe('one-approval batches', () => {
  const transferLog = (token: Address, from: Address, to: Address, value: bigint): Log => ({
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockHash: h(1), blockNumber: 1n, logIndex: 0, transactionHash: h(1), transactionIndex: 0, removed: false,
  }) as Log
  const rows = (): RunRow[] => [
    { id: 'a', to: A, amount: '5000000', state: 'pending' },
    { id: 'b', to: B, amount: '7000000', state: 'pending' },
    { id: 'c', to: A, amount: '5000000', state: 'pending' },
  ]

  test('each row needs its own transfer from the sender, to its recipient, of its exact amount', () => {
    const receipts = [{ transactionHash: h(7), status: 'success' as const, logs: [transferLog(EURC, SENDER, A, 5_000_000n), transferLog(EURC, SENDER, B, 7_000_000n)] }]
    const out = matchBatchReceipts(rows(), receipts, EURC, SENDER)
    expect(out.a?.hash).toBe(h(7))
    expect(out.b?.hash).toBe(h(7))
    // The third row is identical to the first, but only one such transfer exists.
    expect(out.c).toBeUndefined()
  })
  test('transfers of another token, from another sender, or in a reverted receipt never count', () => {
    const wrongToken = [{ transactionHash: h(1), status: 'success' as const, logs: [transferLog(A, SENDER, A, 5_000_000n)] }]
    expect(matchBatchReceipts(rows(), wrongToken, EURC, SENDER).a).toBeUndefined()
    const wrongSender = [{ transactionHash: h(1), status: 'success' as const, logs: [transferLog(EURC, C, A, 5_000_000n)] }]
    expect(matchBatchReceipts(rows(), wrongSender, EURC, SENDER).a).toBeUndefined()
    const reverted = [{ transactionHash: h(1), status: 'reverted' as const, logs: [transferLog(EURC, SENDER, A, 5_000_000n)] }]
    expect(matchBatchReceipts(rows(), reverted, EURC, SENDER).a).toBeUndefined()
  })
  test('batching is offered only when the wallet reports atomic support for Arc', () => {
    expect(supportsAtomicBatch({ 5042: { atomic: { status: 'supported' } } }, 5042)).toBe(true)
    expect(supportsAtomicBatch({ '0x13b2': { atomic: { status: 'ready' } } }, 5042)).toBe(true)
    expect(supportsAtomicBatch({ 5042: { atomicBatch: { supported: true } } }, 5042)).toBe(true)
    expect(supportsAtomicBatch({ 5042: { atomic: { status: 'unsupported' } } }, 5042)).toBe(false)
    expect(supportsAtomicBatch({ 1: { atomic: { status: 'supported' } } }, 5042)).toBe(false)
    expect(supportsAtomicBatch(undefined, 5042)).toBe(false)
    expect(supportsAtomicBatch({}, 5042)).toBe(false)
  })
})
