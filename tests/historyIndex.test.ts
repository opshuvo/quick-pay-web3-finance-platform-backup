import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, toHex } from 'viem'
import { quickPayRouterAbi } from '../src/contracts/quickPayRouterAbi'
import { decodeContractLog, watchedContracts } from '../server/events'
import { buildWhere, decodeCursor, encodeCursor, type HistoryFilters } from '../server/history'
import { DROP_AFTER_MS, isNotFound, nextCheckDelayMs, parsePending, reconcile } from '../server/pending'
import { historyQuery, DEFAULT_FILTERS } from '../src/hooks/useHistory'

const WALLET = '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const filters = (over: Partial<HistoryFilters> = {}): HistoryFilters => ({ address: WALLET, direction: 'all', type: 'all', q: '', page: 1, pageSize: 20, ...over })

describe('cursor pagination', () => {
  test('a cursor round-trips and is rejected when it is not ours', () => {
    const c = { block: '31700001', logIndex: 7 }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(() => decodeCursor('not-a-cursor')).toThrow()
    expect(() => decodeCursor(Buffer.from("1:2'; drop table transfers;--").toString('base64url'))).toThrow()
  })
  test('the keyset clause is parameterized and only added to row queries, never to counts', () => {
    const withCursor = buildWhere(filters({ cursor: { block: '100', logIndex: 3 } }))
    expect(withCursor.text).toContain('(t.block_number, t.log_index) <')
    expect(withCursor.params).toContain('100')
    expect(withCursor.text).not.toContain('100')
    expect(buildWhere(filters({ cursor: { block: '100', logIndex: 3 } }), false).text).not.toContain('t.log_index) <')
  })
  test('the client sends the cursor and the server default page is 20 rows', () => {
    expect(DEFAULT_FILTERS.pageSize).toBe(20)
    expect(historyQuery({ ...DEFAULT_FILTERS, cursor: 'abc' })).toContain('cursor=abc')
    expect(historyQuery(DEFAULT_FILTERS)).not.toContain('cursor=')
  })
})

describe('pending transactions are saved honestly and reconciled with receipts', () => {
  const good = { txHash: `0x${'ab'.repeat(32)}`, wallet: WALLET, kind: 'send', to: '0x5bacb7e04a2b3b5ae45be89d6a932d4cf7dae1ba', token: '0x3600000000000000000000000000000000000000', amount: '10000' }
  test('a well-formed submission is normalized, anything else is refused', () => {
    expect(parsePending({ ...good, wallet: good.wallet.toUpperCase().replace('0X', '0x') }).wallet).toBe(WALLET)
    for (const bad of [{ txHash: '0x12' }, { wallet: 'nope' }, { kind: 'mint' }, { amount: '-1' }, { amount: '1.5' }, { to: '0x1' }]) {
      expect(() => parsePending({ ...good, ...bad })).toThrow()
    }
  })
  test('a receipt decides: success is Confirmed, a revert is Failed', () => {
    expect(reconcile({ status: 'success', blockNumber: 5n }, true, 0)).toEqual({ status: 'confirmed', blockNumber: 5n })
    expect(reconcile({ status: 'reverted', blockNumber: 6n }, true, 0)).toEqual({ status: 'failed', blockNumber: 6n })
  })
  test('no receipt keeps it Pending; only a transaction the node no longer knows, after a long wait, is dropped', () => {
    expect(reconcile(null, true, 10 * DROP_AFTER_MS)).toEqual({ status: 'pending' })
    expect(reconcile(null, false, 1_000)).toEqual({ status: 'pending' })
    expect(reconcile(null, false, DROP_AFTER_MS + 1)).toEqual({ status: 'dropped' })
  })
  test('checks start quick and back off to a cap, and only "not found" errors count as not found', () => {
    expect(nextCheckDelayMs(0)).toBe(2_000)
    expect(nextCheckDelayMs(3)).toBe(16_000)
    expect(nextCheckDelayMs(99)).toBe(60_000)
    expect(isNotFound(Object.assign(new Error('x'), { name: 'TransactionReceiptNotFoundError' }))).toBe(true)
    expect(isNotFound(Object.assign(new Error('x'), { cause: { name: 'TransactionNotFoundError' } }))).toBe(true)
    expect(isNotFound(new Error('rate limit exceeded'))).toBe(false)
  })
})

describe('Router and Registry events', () => {
  test('watching needs real addresses and an explicit start block, never block 0', () => {
    expect(watchedContracts({})).toBeNull()
    expect(watchedContracts({ VITE_QUICKPAY_REGISTRY_ADDRESS: '0x3920870225841408E5bfcADA83d1b50F5fcCa58b' })).toBeNull()
    const w = watchedContracts({ VITE_QUICKPAY_REGISTRY_ADDRESS: '0x3920870225841408E5bfcADA83d1b50F5fcCa58b', VITE_QUICKPAY_ROUTER_ADDRESS: '0x1593C6fdEAB15228c90da354913a919fDA08b7E4', VITE_QUICKPAY_REGISTRY_FROM_BLOCK: '28830240' })
    expect(w?.addresses).toEqual(['0x3920870225841408e5bfcada83d1b50f5fcca58b', '0x1593c6fdeab15228c90da354913a919fda08b7e4'])
    expect(w?.fromBlock).toBe(28830240n)
  })
  test('a router PaymentSent log decodes with its own ABI, and unknown logs are skipped', () => {
    const payer = '0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968'
    const recipient = '0x5baCB7e04A2b3B5Ae45be89d6A932D4cF7DAE1bA'
    const reference = `0x${'00'.repeat(32)}` as const
    const topics = encodeEventTopics({ abi: quickPayRouterAbi, eventName: 'PaymentSent', args: { payer, recipient, reference_: reference } })
    const decoded = decodeContractLog({ topics: topics as `0x${string}`[], data: encodeAbiParameters([{ type: 'uint256' }], [10_000n]) })
    expect(decoded?.name).toBe('PaymentSent')
    expect(decoded?.args.amount).toBe('10000')
    expect(decoded?.args.payer.toLowerCase()).toBe(payer.toLowerCase())
    expect(decodeContractLog({ topics: [toHex(1, { size: 32 })], data: '0x' })).toBeNull()
  })
})
