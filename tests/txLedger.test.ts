import { beforeEach, describe, expect, test } from 'bun:test'
import { buildAnalytics, buildHistory, type Filters } from '../src/lib/chainHistory/derive'
import { ChainHistory } from '../src/lib/chainHistory/engine'
import { ledgerAdd, ledgerFor, ledgerPending, ledgerRehash, ledgerSetStatus, resetLedger } from '../src/lib/txLedger'
import { describeSimulationError, shouldRetrySimulation } from '../src/lib/simulationError'
import { validateRecipient } from '../src/lib/payments'
import { env } from '../src/lib/env'
import { NATIVE_TRANSFER_EMITTER, TRANSFER_TOPIC } from '../shared/swapLegs'

const W = '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const OTHER = '0x5bacb7' + '00'.repeat(17)
const USDC = '0x3600000000000000000000000000000000000000'
const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const pad = (a: string) => '0x' + a.slice(2).padStart(64, '0')
const f: Filters = { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25 }
const sys = (from: string, to: string, usdc: bigint, logIndex: number) => ({ address: NATIVE_TRANSFER_EMITTER, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: '0x' + (usdc * 10n ** 12n).toString(16), logIndex })
const entry = (n: number, extra: Partial<Parameters<typeof ledgerAdd>[0]> = {}) => ({ hash: hash(n), wallet: W, kind: 'send' as const, to: OTHER, token: USDC, amount: '10000', symbol: 'USDC', decimals: 6, ...extra })

beforeEach(() => resetLedger())

describe('the device ledger of what the wallet signed', () => {
  test('a signed transaction is kept as pending, once, and its status follows the receipt', () => {
    ledgerAdd(entry(1))
    ledgerAdd(entry(1))
    expect(ledgerFor(W)).toHaveLength(1)
    expect(ledgerPending(W)).toHaveLength(1)
    ledgerSetStatus(W, hash(1), 'confirmed')
    expect(ledgerFor(W)[0].status).toBe('confirmed')
    expect(ledgerPending(W)).toHaveLength(0)
    // adding the same hash again must not reset a resolved status
    ledgerAdd(entry(1))
    expect(ledgerFor(W)[0].status).toBe('confirmed')
  })
  test('a sped-up transaction keeps one record under its new hash', () => {
    ledgerAdd(entry(2))
    ledgerRehash(W, hash(2), hash(3))
    expect(ledgerFor(W).map((e) => e.hash)).toEqual([hash(3)])
  })
  test('records belong to one wallet only', () => {
    ledgerAdd(entry(4))
    expect(ledgerFor('0x' + '77'.repeat(20))).toHaveLength(0)
  })
})

function engineWith(txs: Record<string, { status: 'success' | 'reverted'; from: string; to: string; logs: ReturnType<typeof sys>[] } | 'missing'>) {
  const client = {
    getBlockNumber: async () => 29_000_000n,
    getTransaction: async ({ hash: h }: { hash: string }) => {
      const t = txs[h]
      if (!t || t === 'missing') throw new Error('Transaction could not be found')
      return { from: t.from, to: t.to }
    },
    getTransactionReceipt: async ({ hash: h }: { hash: string }) => {
      const t = txs[h]
      if (!t || t === 'missing') throw new Error('Transaction receipt with hash could not be found.')
      return { status: t.status, blockNumber: 28_999_990n, logs: t.logs, gasUsed: 100_000n, effectiveGasPrice: 20_000_000_000n }
    },
    getBlock: async () => ({ timestamp: 1_793_500_000n }),
    readContract: async () => 6,
  }
  return new ChainHistory(W, client as never)
}

describe('History shows pending, failed and confirmed records without hiding any', () => {
  test('a pending payment is listed at once, marked pending, and left out of the totals', () => {
    const e = engineWith({})
    ledgerAdd(entry(10))
    const rows = buildHistory(e.snapshot(), f, 1).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', local: true, direction: 'out', amount: '10000', txHash: hash(10) })
    expect(buildAnalytics(e.snapshot(), 1).totalSent).toBe('0')
  })
  test('a failed payment stays listed as failed and moves no money in the totals', () => {
    const e = engineWith({})
    ledgerAdd(entry(11))
    ledgerSetStatus(W, hash(11), 'failed')
    const rows = buildHistory(e.snapshot(), f, 1).rows
    expect(rows[0]).toMatchObject({ status: 'failed' })
    const a = buildAnalytics(e.snapshot(), 1)
    expect(a.totalSent).toBe('0')
    expect(a.transactionCount).toBe(0)
  })
  test('a swap and a bridge keep their type and token while pending', () => {
    const e = engineWith({})
    ledgerAdd(entry(12, { kind: 'swap', token: '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1', symbol: 'EURC', decimals: 6, amount: '5000000' }))
    ledgerAdd(entry(13, { kind: 'bridge' }))
    const rows = buildHistory(e.snapshot(), f, 1).rows
    expect(rows.map((r) => r.type).sort()).toEqual(['bridge', 'swap'])
    expect(rows.find((r) => r.type === 'swap')).toMatchObject({ symbol: 'EURC', decimals: 6 })
    expect(buildHistory(e.snapshot(), { ...f, type: 'swap' }, 1).rows).toHaveLength(1)
  })
  test('once the chain scan lists the same transaction, the scanned row replaces the record (no duplicate)', async () => {
    const e = engineWith({ [hash(14)]: { status: 'success', from: W, to: OTHER, logs: [sys(W, OTHER, 10_000n, 0)] } })
    ledgerAdd(entry(14))
    expect(buildHistory(e.snapshot(), f, 1).rows[0].local).toBe(true)
    await e.ingestConfirmed(hash(14))
    const rows = buildHistory(e.snapshot(), f, 1).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].local).toBeUndefined()
    expect(rows[0].status).toBe('confirmed')
  })
  test('newest first across scanned and local rows', async () => {
    const e = engineWith({ [hash(15)]: { status: 'success', from: W, to: OTHER, logs: [sys(W, OTHER, 5n, 0)] } })
    await e.ingestConfirmed(hash(15)) // block time 1_793_500_000 s
    ledgerAdd(entry(16, { submittedAt: 1_793_500_100_000 }))
    expect(buildHistory(e.snapshot(), f, 1).rows.map((r) => r.txHash)).toEqual([hash(16), hash(15)])
  })
})

describe('reconciling signed transactions with Arc', () => {
  test('a successful receipt makes the record confirmed and lists its transfer', async () => {
    const e = engineWith({ [hash(20)]: { status: 'success', from: W, to: OTHER, logs: [sys(W, OTHER, 10_000n, 0)] } })
    ledgerAdd(entry(20))
    await e.reconcileLedger()
    expect(ledgerFor(W)[0].status).toBe('confirmed')
    expect(buildHistory(e.snapshot(), f, 1).rows[0]).toMatchObject({ status: 'confirmed', amount: '10000' })
  })
  test('a reverted receipt makes the record failed, and nothing is listed as moved', async () => {
    const e = engineWith({ [hash(21)]: { status: 'reverted', from: W, to: OTHER, logs: [] } })
    ledgerAdd(entry(21))
    await e.reconcileLedger()
    expect(ledgerFor(W)[0].status).toBe('failed')
    expect(buildHistory(e.snapshot(), f, 1).rows[0].status).toBe('failed')
  })
  test('no receipt yet leaves a fresh record pending; a transaction the node never saw becomes failed after a long wait', async () => {
    const e = engineWith({})
    ledgerAdd(entry(22))
    ledgerAdd(entry(23, { submittedAt: Date.now() - 30 * 60_000 }))
    await e.reconcileLedger()
    const byHash = new Map(ledgerFor(W).map((x) => [x.hash, x.status]))
    expect(byHash.get(hash(22))).toBe('pending')
    expect(byHash.get(hash(23))).toBe('failed')
  })
})

describe('Send simulation errors', () => {
  const viemLike = (shortMessage: string, extra: object = {}) => Object.assign(new Error(shortMessage), { shortMessage, ...extra })
  test('a temporary RPC failure is retried and never blamed on the payment', () => {
    const rate = Object.assign(new Error('HTTP request failed. Status: 429'), { status: 429 })
    expect(describeSimulationError(rate).kind).toBe('busy')
    expect(shouldRetrySimulation(0, rate)).toBe(true)
    expect(shouldRetrySimulation(3, rate)).toBe(false)
  })
  test('real reverts are named and not retried', () => {
    const balance = viemLike('The contract function "transfer" reverted with the following reason:\nERC20: transfer amount exceeds balance')
    expect(describeSimulationError(balance).kind).toBe('balance')
    expect(shouldRetrySimulation(0, balance)).toBe(false)
    expect(describeSimulationError(viemLike('reverted: Blocklistable: account is blocklisted')).kind).toBe('blocked')
    expect(describeSimulationError(viemLike('reverted: Pausable: paused')).kind).toBe('paused')
    expect(describeSimulationError(viemLike('reverted with custom error InvalidRecipient')).kind).toBe('recipient')
    expect(describeSimulationError(viemLike('something unexpected')).kind).toBe('other')
  })
  test('the Quick Pay contract and Arc system addresses are not valid recipients', () => {
    if (env.routerAddress) expect(() => validateRecipient(env.routerAddress as string)).toThrow(/payment contract/)
    expect(() => validateRecipient(NATIVE_TRANSFER_EMITTER)).toThrow(/system address/)
    expect(() => validateRecipient('0x1800000000000000000000000000000000000001')).toThrow(/system address/)
    expect(() => validateRecipient(USDC)).toThrow(/USDC token contract/)
    expect(validateRecipient(OTHER)).toBeTruthy()
  })
})
