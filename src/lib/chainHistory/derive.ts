/**
 * Turns what the browser read from Arc into the same shapes the history server returns, so every screen
 * works the same whether a server or the chain itself is the source. Pure functions, no I/O.
 */
import type { ActivityDto, Analytics, Coverage, HistoryRow } from '../../../shared/api-types'
import { evaluateCoverage } from '../../../server/coverageState'
import { BRIDGE_COUNTERPARTIES, SWAP_COUNTERPARTIES } from '../../../server/protocols'
import { UNISWAP_UNIVERSAL_ROUTER } from '../../../shared/uniswap-constants'

export interface RawTransfer {
  txHash: string
  logIndex: number
  block: number
  from: string
  to: string
  amount: string
}

export interface TxMeta {
  from: string
  to: string | null
  ok: boolean
}

export interface SwapRec {
  hash: string
  block: number
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  inSymbol: string | null
  inDecimals: number | null
  outSymbol: string | null
  outDecimals: number | null
  feeAmount: string
}

export interface BridgeRec {
  hash: string
  block: number
  token: string
  amountIn: string
  symbol: string | null
  decimals: number | null
}

export interface Snapshot {
  address: string
  usdc: string
  registry?: string
  transfers: RawTransfer[]
  meta: ReadonlyMap<string, TxMeta>
  swaps: readonly SwapRec[]
  bridges: readonly BridgeRec[]
  times: ReadonlyMap<number, number>
  newest: number | null
  oldest: number | null
  head: number
  range: number
  error: string | null
  lastProgressAt: number
  pendingVerification: number
}

export interface Filters {
  q: string
  direction: 'all' | 'in' | 'out'
  type: 'all' | 'transfer' | 'request_payment' | 'swap' | 'bridge'
  since: string
  until: string
  page: number
  pageSize: number
}

export class HistoryInputError extends Error {}

const list = (values: readonly string[]) => new Set(values)
const SWAP_SET = list(SWAP_COUNTERPARTIES)
const BRIDGE_SET = list(BRIDGE_COUNTERPARTIES)
const HEX_PREFIX = /^0x[0-9a-f]{1,64}$/

/**
 * A snapshot never changes once built (the reader makes a new one when anything changes), so everything derived from it
 * is computed once and shared by every screen that asks: History, Overview, notifications, Analytics and Activity all
 * read the same snapshot on every poll.
 */
const hashSets = new WeakMap<Snapshot, { swaps: Set<string>; bridges: Set<string> }>()
function verifiedHashes(s: Snapshot) {
  let sets = hashSets.get(s)
  if (!sets) {
    sets = { swaps: new Set(s.swaps.map((x) => x.hash)), bridges: new Set(s.bridges.map((x) => x.hash)) }
    hashSets.set(s, sets)
  }
  return sets
}

/** Same rules as the server: a verified transaction target wins, then a known protocol counterparty. */
export function classify(s: Snapshot, t: RawTransfer): HistoryRow['type'] {
  const w = s.address
  const meta = s.meta.get(t.txHash)
  const verified = meta?.ok && meta.from === w ? meta.to : null
  const { swaps, bridges } = verifiedHashes(s)
  if (swaps.has(t.txHash)) return 'swap'
  if (bridges.has(t.txHash)) return 'bridge'
  if (verified && s.registry && verified === s.registry) return 'request_payment'
  if (verified && SWAP_SET.has(verified)) return 'swap'
  if (verified && BRIDGE_SET.has(verified)) return 'bridge'
  const counterparty = t.from === w ? t.to : t.from
  if (SWAP_SET.has(counterparty)) return 'swap'
  if (BRIDGE_SET.has(counterparty)) return 'bridge'
  return 'transfer'
}

const iso = (s: Snapshot, block: number) => new Date((s.times.get(block) ?? 0) * 1000).toISOString()

function toRow(s: Snapshot, t: RawTransfer): HistoryRow {
  const w = s.address
  return {
    txHash: t.txHash,
    logIndex: t.logIndex,
    blockNumber: t.block,
    timestamp: iso(s, t.block),
    from: t.from,
    to: t.to,
    token: s.usdc,
    amount: t.amount,
    direction: t.from === t.to ? 'self' : t.from === w ? 'out' : 'in',
    type: classify(s, t),
    requestId: null,
    contract: s.meta.get(t.txHash)?.to ?? null,
    confirmations: Math.max(0, s.head - t.block),
    status: 'confirmed',
  }
}

/** Only transfers whose block time is known are listed: a row never appears with an invented date. */
const known = (s: Snapshot) => s.transfers.filter((t) => s.times.has(t.block) && (t.from === s.address || t.to === s.address))

const rowCache = new WeakMap<Snapshot, HistoryRow[]>()
/** Every listed row, newest first. Built once per snapshot. */
function allRows(s: Snapshot): HistoryRow[] {
  let rows = rowCache.get(s)
  if (!rows) {
    rows = known(s)
      .sort((a, b) => b.block - a.block || b.logIndex - a.logIndex)
      .map((t) => toRow(s, t))
    rowCache.set(s, rows)
  }
  return rows
}

export function filterRows(s: Snapshot, f: Filters): HistoryRow[] {
  const q = f.q.trim().toLowerCase()
  if (q && !HEX_PREFIX.test(q)) throw new HistoryInputError('Search by transaction hash or address (0x…).')
  const since = f.since ? new Date(f.since).getTime() : undefined
  const until = f.until ? new Date(f.until).getTime() : undefined
  return allRows(s).filter((r) => {
    if (f.direction === 'in' && !(r.to === s.address && r.from !== s.address)) return false
    if (f.direction === 'out' && !(r.from === s.address && r.to !== s.address)) return false
    if (f.type !== 'all' && r.type !== f.type) return false
    if (since !== undefined || until !== undefined) {
      const at = new Date(r.timestamp).getTime()
      if (since !== undefined && at < since) return false
      if (until !== undefined && at > until) return false
    }
    if (q && !(r.txHash.startsWith(q) || r.from.startsWith(q) || r.to.startsWith(q))) return false
    return true
  })
}

export function buildCoverage(s: Snapshot, now: number): Coverage {
  const started = s.newest !== null && s.oldest !== null
  return {
    ...evaluateCoverage({
      registered: started,
      head: BigInt(s.head),
      newest: BigInt(s.newest ?? 0),
      oldest: BigInt(s.oldest ?? 0),
      completeLagBlocks: 240n,
      lastError: s.error,
      lastErrorAt: s.error ? new Date(now) : null,
      now,
      lastProgressAt: s.lastProgressAt,
      stallAfterMs: 5 * 60_000,
      rpc: 'public',
      range: s.range,
    }),
    source: 'browser',
  }
}

export function buildHistory(s: Snapshot, f: Filters, now: number) {
  const rows = filterRows(s, f)
  const start = (f.page - 1) * f.pageSize
  return { rows: rows.slice(start, start + f.pageSize), total: rows.length, page: f.page, pageSize: f.pageSize, coverage: buildCoverage(s, now) }
}

const analyticsCache = new WeakMap<Snapshot, Analytics>()

export function buildAnalytics(s: Snapshot, now: number): Analytics & { coverage: Coverage } {
  const cached = analyticsCache.get(s)
  if (cached) return { ...cached, coverage: buildCoverage(s, now) }
  const { coverage: _unused, ...figures } = computeAnalytics(s, now)
  analyticsCache.set(s, figures)
  return { ...figures, coverage: buildCoverage(s, now) }
}

function computeAnalytics(s: Snapshot, now: number): Analytics & { coverage: Coverage } {
  const w = s.address
  const rows = filterRows(s, { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 1 })
  let sent = 0n
  let received = 0n
  let sentCount = 0
  let receivedCount = 0
  const monthly = new Map<string, { sent: bigint; received: bigint; count: number }>()
  const breakdown = new Map<string, { type: string; direction: string; count: number; amount: bigint }>()
  const top = new Map<string, { count: number; amount: bigint }>()
  for (const r of rows) {
    const amount = BigInt(r.amount)
    const out = r.from === w && r.to !== w
    const inn = r.to === w && r.from !== w
    if (out) { sent += amount; sentCount += 1 }
    if (inn) { received += amount; receivedCount += 1 }
    const month = r.timestamp.slice(0, 7)
    const m = monthly.get(month) ?? { sent: 0n, received: 0n, count: 0 }
    monthly.set(month, { sent: m.sent + (out ? amount : 0n), received: m.received + (inn ? amount : 0n), count: m.count + 1 })
    const key = `${r.type}:${r.direction}`
    const b = breakdown.get(key) ?? { type: r.type, direction: r.direction, count: 0, amount: 0n }
    breakdown.set(key, { ...b, count: b.count + 1, amount: b.amount + amount })
    if (r.from !== r.to) {
      const other = r.from === w ? r.to : r.from
      const o = top.get(other) ?? { count: 0, amount: 0n }
      top.set(other, { count: o.count + 1, amount: o.amount + amount })
    }
  }
  return {
    totalSent: sent.toString(),
    totalReceived: received.toString(),
    transactionCount: rows.length,
    sentCount,
    receivedCount,
    firstActivity: rows.length ? rows[rows.length - 1].timestamp : null,
    lastActivity: rows.length ? rows[0].timestamp : null,
    monthly: [...monthly].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12).map(([month, m]) => ({ month, sent: m.sent.toString(), received: m.received.toString(), count: m.count })),
    breakdown: [...breakdown.values()].sort((a, b) => b.count - a.count).map((b) => ({ ...b, amount: b.amount.toString() })),
    topCounterparties: [...top].sort((a, b) => (a[1].amount < b[1].amount ? 1 : -1)).slice(0, 5).map(([address, o]) => ({ address, count: o.count, amount: o.amount.toString() })),
    coverage: buildCoverage(s, now),
  }
}

const activityCache = new WeakMap<Snapshot, Map<number, ActivityDto[]>>()

export function buildActivity(s: Snapshot, chainId: number): ActivityDto[] {
  let byChain = activityCache.get(s)
  if (!byChain) activityCache.set(s, (byChain = new Map<number, ActivityDto[]>()))
  let list = byChain.get(chainId)
  if (!list) byChain.set(chainId, (list = computeActivity(s, chainId)))
  return list
}

function computeActivity(s: Snapshot, chainId: number): ActivityDto[] {
  const at = (block: number) => iso(s, block)
  const swaps = s.swaps.filter((x) => s.times.has(x.block)).map((x): ActivityDto => ({
    id: x.block * 1000 + (parseInt(x.hash.slice(-3), 16) % 1000),
    kind: 'swap', wallet: s.address, sourceChainId: chainId, destinationChainId: chainId, sourceTxHash: x.hash, destinationTxHash: x.hash,
    tokenIn: x.tokenIn, tokenOut: x.tokenOut, tokenInSymbol: x.inSymbol, tokenInDecimals: x.inDecimals, tokenOutSymbol: x.outSymbol, tokenOutDecimals: x.outDecimals,
    amountIn: x.amountIn, amountOut: x.amountOut, expectedAmountOut: null, feeAmount: x.feeAmount, feeToken: s.usdc,
    status: 'confirmed', destinationVerified: true, timestamp: at(x.block), updatedAt: at(x.block),
  }))
  const bridges = s.bridges.filter((x) => s.times.has(x.block)).map((x): ActivityDto => ({
    id: x.block * 1000 + (parseInt(x.hash.slice(-3), 16) % 1000),
    kind: 'bridge', wallet: s.address, sourceChainId: chainId, destinationChainId: 0, sourceTxHash: x.hash, destinationTxHash: null,
    tokenIn: x.token, tokenOut: null, tokenInSymbol: x.symbol, tokenInDecimals: x.decimals, tokenOutSymbol: null, tokenOutDecimals: null,
    amountIn: x.amountIn, amountOut: null, expectedAmountOut: null, feeAmount: null, feeToken: null,
    // The deposit on Arc is verified from its receipt. The destination fill is NOT read here, so it is never marked complete.
    status: 'pending', destinationVerified: false, timestamp: at(x.block), updatedAt: at(x.block),
  }))
  return [...swaps, ...bridges].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

export const isSwapTarget = (to: string | null) => to === UNISWAP_UNIVERSAL_ROUTER
export const isBridgeTarget = (to: string | null) => Boolean(to && BRIDGE_SET.has(to))
export const isSwapCounterparty = (a: string) => SWAP_SET.has(a)
export const isBridgeCounterparty = (a: string) => BRIDGE_SET.has(a)
