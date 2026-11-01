import { describe, expect, test } from 'bun:test'
import { buildActivity, buildAnalytics, buildHistory, type Filters } from '../src/lib/chainHistory/derive'
import { ChainHistory } from '../src/lib/chainHistory/engine'
import { BRIDGE_COUNTERPARTIES } from '../server/protocols'
import { UNISWAP_UNIVERSAL_ROUTER } from '../shared/uniswap-constants'
import { NATIVE_TRANSFER_EMITTER, TRANSFER_TOPIC } from '../shared/swapLegs'

const W = '0x26eff17acb6932f197adbc1aa493b9bf64c04968'
const OTHER = '0x5bacb7' + '00'.repeat(17)
const RELAYER = '0x' + '9a'.repeat(20)
const USDC = '0x3600000000000000000000000000000000000000'
const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1'
const BRIDGE = BRIDGE_COUNTERPARTIES[0]
const pad = (a: string) => '0x' + a.slice(2).padStart(64, '0')
const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const f: Filters = { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25 }
const log = (token: string, from: string, to: string, amount: bigint, logIndex: number) => ({ address: token, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: '0x' + amount.toString(16), logIndex })

function engine(txs: Record<string, { from: string; to: string | null; status?: 'success' | 'reverted'; logs: ReturnType<typeof log>[] }>) {
  const client = {
    getBlockNumber: async () => 29_000_000n,
    getTransaction: async ({ hash: h }: { hash: string }) => ({ from: txs[h].from, to: txs[h].to }),
    getTransactionReceipt: async ({ hash: h }: { hash: string }) => ({ status: txs[h].status ?? 'success', blockNumber: 28_999_990n, logs: txs[h].logs, gasUsed: 100_000n, effectiveGasPrice: 20_000_000_000n }),
    getBlock: async () => ({ timestamp: 1_793_500_000n }),
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => (functionName === 'symbol' ? (address === USDC ? 'USDC' : 'EURC') : 6),
  }
  const e = new ChainHistory(W, client as never)
  return e
}
const view = (e: ChainHistory) => buildHistory(e.snapshot(), f, 1)

describe('a transaction the app just confirmed is in History at once', () => {
  test('a payment: its USDC transfer is listed from the receipt, mirror logs and other tokens are not', async () => {
    const e = engine({ [hash(1)]: { from: W, to: '0x1593c6fdeab15228c90da354913a919fda08b7e4', logs: [log(USDC, W, OTHER, 10_000n, 3), log(NATIVE_TRANSFER_EMITTER, W, OTHER, 10_000n * 10n ** 12n, 2), log(EURC, OTHER, '0x' + '33'.repeat(20), 5n, 4)] } })
    await e.ingestConfirmed(hash(1))
    const page = view(e)
    expect(page.total).toBe(1)
    expect(page.rows[0]).toMatchObject({ txHash: hash(1), direction: 'out', amount: '10000', type: 'transfer', blockNumber: 28_999_990, status: 'confirmed' })
    expect(page.rows[0].timestamp).toBe(new Date(1_793_500_000_000).toISOString())
    expect(buildAnalytics(e.snapshot(), 1).sentCount).toBe(1)
  })

  test('a swap: shows as a swap in History and in Activity, including a swap that never touches USDC in the list', async () => {
    const e = engine({ [hash(2)]: { from: W, to: UNISWAP_UNIVERSAL_ROUTER, logs: [log(USDC, W, OTHER, 1_000_000n, 1), log(EURC, OTHER, W, 860_000n, 2)] } })
    await e.ingestConfirmed(hash(2))
    expect(view(e).rows[0]).toMatchObject({ txHash: hash(2), type: 'swap', direction: 'out' })
    const swaps = buildActivity(e.snapshot(), 5042)
    expect(swaps.length).toBe(1)
    expect(swaps[0]).toMatchObject({ kind: 'swap', sourceTxHash: hash(2), amountIn: '1000000', amountOut: '860000', tokenInSymbol: 'USDC', tokenOutSymbol: 'EURC' })
    expect(swaps[0].tokenOut?.toLowerCase()).toBe(EURC)
  })

  test('a swap between two other tokens is listed in History with its own token, and left out of the USDC totals', async () => {
    const WETH = '0x128cc466b61f542da60c70e3aa11c10e19b84edb'
    const e = engine({ [hash(3)]: { from: W, to: UNISWAP_UNIVERSAL_ROUTER, logs: [log(EURC, W, OTHER, 5n, 1), log(WETH, OTHER, W, 7n, 2)] } })
    await e.ingestConfirmed(hash(3))
    const page = view(e)
    expect(page.total).toBe(1)
    expect(page.rows[0]).toMatchObject({ txHash: hash(3), type: 'swap', direction: 'out', amount: '5', symbol: 'EURC', decimals: 6, token: EURC })
    expect(buildActivity(e.snapshot(), 5042).map((a) => a.kind)).toEqual(['swap'])
    const stats = buildAnalytics(e.snapshot(), 1)
    expect(stats.transactionCount).toBe(0)
    expect(stats.totalSent).toBe('0')
    // Filters work on it like on any other row.
    expect(buildHistory(e.snapshot(), { ...f, type: 'swap' }, 1).total).toBe(1)
    expect(buildHistory(e.snapshot(), { ...f, direction: 'in' }, 1).total).toBe(0)
  })

  test('a bridge of another token (not USDC) is listed as a bridge with its token', async () => {
    const e = engine({ [hash(8)]: { from: W, to: BRIDGE, logs: [log(EURC, W, BRIDGE, 3_000_000n, 1)] } })
    await e.ingestConfirmed(hash(8))
    expect(view(e).rows[0]).toMatchObject({ type: 'bridge', direction: 'out', amount: '3000000', symbol: 'EURC' })
    expect(buildAnalytics(e.snapshot(), 1).totalSent).toBe('0')
  })

  test('a bridge deposit made on Arc shows as a bridge in History and Activity', async () => {
    const e = engine({ [hash(4)]: { from: W, to: BRIDGE, logs: [log(USDC, W, BRIDGE, 2_000_000n, 1)] } })
    await e.ingestConfirmed(hash(4))
    expect(view(e).rows[0]).toMatchObject({ type: 'bridge', direction: 'out', amount: '2000000' })
    expect(buildActivity(e.snapshot(), 5042)[0]).toMatchObject({ kind: 'bridge', sourceTxHash: hash(4), amountIn: '2000000', destinationVerified: false })
  })

  test('a bridge that arrived on Arc is a bridge delivery, not a plain receipt; without the mark it is a receipt', async () => {
    const txs = { [hash(5)]: { from: RELAYER, to: '0x' + '77'.repeat(20), logs: [log(USDC, RELAYER, W, 3_000_000n, 1)] } }
    const marked = engine(txs)
    await marked.ingestConfirmed(hash(5), { bridgeFill: true })
    expect(view(marked).rows[0]).toMatchObject({ type: 'bridge', direction: 'in', amount: '3000000' })
    const plain = engine(txs)
    await plain.ingestConfirmed(hash(5))
    expect(view(plain).rows[0]).toMatchObject({ type: 'transfer', direction: 'in' })
  })

  test('a failed transaction is never listed', async () => {
    const e = engine({ [hash(6)]: { from: W, to: OTHER, status: 'reverted', logs: [log(USDC, W, OTHER, 9n, 1)] } })
    await e.ingestConfirmed(hash(6))
    expect(view(e).total).toBe(0)
  })

  test('the same transfer found later by the block scan is not counted twice', async () => {
    const e = engine({ [hash(7)]: { from: W, to: OTHER, logs: [log(USDC, W, OTHER, 42n, 3)] } })
    await e.ingestConfirmed(hash(7))
    ;(e as unknown as { commit: (r: unknown[], t: Map<number, number>) => void }).commit([{ txHash: hash(7), logIndex: 3, block: 28_999_990, from: W, to: OTHER, amount: '42' }], new Map([[28_999_990, 1_793_500_000]]))
    expect(view(e).total).toBe(1)
    expect(buildAnalytics(e.snapshot(), 1).totalSent).toBe('42')
  })

  test('sent, received, swap and bridge all appear together and the totals add up', async () => {
    const e = engine({
      [hash(10)]: { from: W, to: OTHER, logs: [log(USDC, W, OTHER, 100n, 1)] },
      [hash(11)]: { from: OTHER, to: W, logs: [log(USDC, OTHER, W, 250n, 1)] },
      [hash(12)]: { from: W, to: UNISWAP_UNIVERSAL_ROUTER, logs: [log(USDC, W, OTHER, 400n, 1), log(EURC, OTHER, W, 1n, 2)] },
      [hash(13)]: { from: W, to: BRIDGE, logs: [log(USDC, W, BRIDGE, 500n, 1)] },
    })
    for (const n of [10, 11, 12, 13]) await e.ingestConfirmed(hash(n))
    const page = view(e)
    expect(page.rows.map((r) => `${r.type}:${r.direction}`).sort()).toEqual(['bridge:out', 'swap:out', 'transfer:in', 'transfer:out'])
    const stats = buildAnalytics(e.snapshot(), 1)
    expect(stats.totalSent).toBe('1000')
    expect(stats.totalReceived).toBe('250')
    expect(stats.transactionCount).toBe(4)
  })
})
