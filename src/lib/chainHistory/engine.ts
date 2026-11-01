/**
 * Browser-side Arc history reader, used when no history server is connected.
 * It scans Arc's USDC Transfer logs for ONE wallet with eth_getLogs (newest first, then backwards to block 0),
 * verifies the transactions behind them from their receipts, and keeps a local cache so a visit only scans
 * what is new. Everything shown is read from the chain; the cache is a speed-up, not a source of truth.
 */
import { createPublicClient, erc20Abi, http, toHex, type Hex, type PublicClient } from 'viem'
import { netFlows, pickSwapLegs, TRANSFER_TOPIC } from '../../../shared/swapLegs'
import { ARC_RPC_URL, ARC_USDC, arcMainnet } from '@/lib/arc'
import { env } from '@/lib/env'
import { isBridgeCounterparty, isBridgeTarget, isSwapCounterparty, isSwapTarget, type BridgeRec, type RawTransfer, type Snapshot, type SwapRec, type TxMeta } from './derive'

const CHUNK = 5_000
const MIN_CHUNK = 500
const PARALLEL = 3
const HEAD_TTL_MS = 2_000
const MIN_INTERVAL_MS = 220
const CACHE_VERSION = 1
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const pad = (a: string): Hex => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`
const topicAddress = (t: string) => `0x${t.slice(26)}`.toLowerCase()

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Arc RPC request failed'))

type Kind = 'rate' | 'range' | 'other'
const kindOf = (e: unknown): Kind => {
  const text = `${(e as { details?: string }).details ?? ''} ${(e as Error)?.message ?? ''}`.toLowerCase()
  if (/rate.?limit|too many requests|429/.test(text)) return 'rate'
  if (/range|too large|too many (blocks|results)|exceed/.test(text)) return 'range'
  return 'other'
}

interface RawLog { transactionHash: Hex; logIndex: Hex; blockNumber: Hex; topics: Hex[]; data: Hex }

interface Cache {
  v: number
  newest: number | null
  oldest: number | null
  transfers: RawTransfer[]
  meta: [string, string, string | null, boolean][]
  swaps: SwapRec[]
  bridges: BridgeRec[]
  times: [number, number][]
}

export const shouldVerify = (wallet: string, from: string, to: string) => from === wallet || (to === wallet && (isSwapCounterparty(from) || isBridgeCounterparty(from)))

export class ChainHistory {
  readonly address: string
  private readonly client: PublicClient
  private readonly transfers = new Map<string, RawTransfer>()
  private readonly meta = new Map<string, TxMeta>()
  private readonly swaps = new Map<string, SwapRec>()
  private readonly bridges = new Map<string, BridgeRec>()
  private readonly times = new Map<number, number>()
  private readonly tokens = new Map<string, { symbol: string | null; decimals: number | null }>()
  private readonly pending = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private newest: number | null = null
  private oldest: number | null = null
  private head = 0
  private range = CHUNK
  private error: string | null = null
  private lastProgressAt = Date.now()
  private version = 0
  private touchedAt = Date.now()
  private running = false
  private loopActive = false
  private tipRun: Promise<void> | undefined
  private headAt = 0
  private headInflight: Promise<void> | undefined
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private nextSlot = 0
  private pauseUntil = 0
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private snapshotCache: { version: number; value: Snapshot } | undefined

  constructor(address: string, client?: PublicClient) {
    this.address = address.toLowerCase()
    this.client = client ?? sharedClient()
    this.load()
  }

  // ---- subscription (React useSyncExternalStore) ------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    clearTimeout(this.stopTimer)
    this.start()
    return () => {
      this.listeners.delete(fn)
      // Keep scanning briefly so quick navigation between pages does not restart work.
      if (this.listeners.size === 0) this.stopTimer = setTimeout(() => { this.running = false }, 30_000)
    }
  }
  getVersion = () => this.version
  private bump() {
    this.version += 1
    for (const l of this.listeners) l()
  }

  snapshot(): Snapshot {
    if (this.snapshotCache?.version === this.version) return this.snapshotCache.value
    const value: Snapshot = {
      address: this.address,
      usdc: ARC_USDC.toLowerCase(),
      registry: env.registryAddress?.toLowerCase(),
      transfers: [...this.transfers.values()],
      meta: this.meta,
      swaps: [...this.swaps.values()],
      bridges: [...this.bridges.values()],
      times: this.times,
      newest: this.newest,
      oldest: this.oldest,
      head: this.head,
      range: this.range,
      error: this.error,
      lastProgressAt: this.lastProgressAt,
      pendingVerification: this.pending.size,
    }
    this.snapshotCache = { version: this.version, value }
    return value
  }
  get started() { return this.newest !== null }
  get lastError() { return this.error }

  // ---- RPC with pacing, shared rate-limit pause and retries --------------------------------------
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      const now = Date.now()
      const slot = Math.max(now, this.nextSlot, this.pauseUntil)
      this.nextSlot = slot + MIN_INTERVAL_MS
      if (slot > now) await sleep(slot - now)
      try {
        return await fn()
      } catch (e) {
        last = e
        const kind = kindOf(e)
        if (kind === 'range') throw e
        this.pauseUntil = Math.max(this.pauseUntil, Date.now() + Math.min(10_000, 1_500 * 2 ** attempt))
      }
    }
    throw last
  }

  private async logs(topics: (Hex | null)[], from: number, to: number): Promise<RawLog[]> {
    return this.call(() => this.client.request({ method: 'eth_getLogs', params: [{ address: ARC_USDC, fromBlock: toHex(from), toBlock: toHex(to), topics }] }))
  }

  /** Reads one block range for this wallet (sent + received) and the timestamps of the blocks involved. */
  private async readRange(from: number, to: number): Promise<{ rows: RawTransfer[]; times: Map<number, number> }> {
    const w = pad(this.address)
    const [sent, received] = [await this.logs([TRANSFER_TOPIC, w], from, to), await this.logs([TRANSFER_TOPIC, null, w], from, to)]
    const rows = new Map<string, RawTransfer>()
    for (const l of [...sent, ...received]) {
      if (l.topics.length !== 3) continue
      const t: RawTransfer = { txHash: l.transactionHash.toLowerCase(), logIndex: Number(BigInt(l.logIndex)), block: Number(BigInt(l.blockNumber)), from: topicAddress(l.topics[1]), to: topicAddress(l.topics[2]), amount: BigInt(l.data).toString() }
      rows.set(`${t.txHash}:${t.logIndex}`, t)
    }
    const times = new Map<number, number>()
    for (const block of new Set([...rows.values()].map((r) => r.block))) {
      if (this.times.has(block)) continue
      const b = await this.call(() => this.client.getBlock({ blockNumber: BigInt(block) }))
      times.set(block, Number(b.timestamp))
    }
    return { rows: [...rows.values()], times }
  }

  private commit(rows: RawTransfer[], times: Map<number, number>) {
    for (const [b, t] of times) this.times.set(b, t)
    for (const r of rows) {
      this.transfers.set(`${r.txHash}:${r.logIndex}`, r)
      if (shouldVerify(this.address, r.from, r.to) && !this.meta.has(r.txHash)) this.pending.add(r.txHash)
    }
  }

  // ---- scanning ----------------------------------------------------------------------------------
  /** One tip scan at a time: callers that arrive while it runs share it. */
  private scanTip(): Promise<void> {
    this.tipRun ??= this.scanTipNow().finally(() => { this.tipRun = undefined })
    return this.tipRun
  }

  private async scanTipNow() {
    while (this.newest !== null && this.newest < this.head && this.running) {
      const from = this.newest + 1
      const to = Math.min(this.head, from + this.range - 1)
      const { rows, times } = await this.readRange(from, to)
      this.commit(rows, times)
      this.newest = to
      this.progress()
    }
  }

  private async backfillBatch() {
    if (this.oldest === null || this.oldest <= 0) return
    const chunks: [number, number][] = []
    let top = this.oldest - 1
    for (let i = 0; i < PARALLEL && top >= 0; i++) {
      const from = Math.max(0, top - this.range + 1)
      chunks.push([from, top])
      top = from - 1
    }
    const results = await Promise.allSettled(chunks.map(([f, t]) => this.readRange(f, t)))
    let failure: unknown
    // The scanned interval only grows through the contiguous prefix of chunks that succeeded.
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'rejected') { failure = r.reason; break }
      this.commit(r.value.rows, r.value.times)
      this.oldest = chunks[i][0]
    }
    if (failure) {
      if (kindOf(failure) === 'range') this.range = Math.max(MIN_CHUNK, Math.floor(this.range / 2))
      throw asError(failure)
    }
    this.progress()
  }

  private progress() {
    this.lastProgressAt = Date.now()
    this.error = null
    this.bump()
    this.scheduleSave()
  }

  // ---- verification of the transactions behind the transfers -----------------------------------
  private async tokenMeta(token: string) {
    const cached = this.tokens.get(token)
    if (cached) return cached
    let value: { symbol: string | null; decimals: number | null } = { symbol: null, decimals: null }
    try {
      const [symbol, decimals] = await Promise.all([
        this.call(() => this.client.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'symbol' })),
        this.call(() => this.client.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'decimals' })),
      ])
      value = { symbol: String(symbol).slice(0, 16), decimals: Number(decimals) }
    } catch {
      /* shown as an address with no symbol: never guessed */
    }
    this.tokens.set(token, value)
    return value
  }

  /** Reads a transaction and its receipt from Arc. Only a successful receipt can produce a swap or bridge record. */
  async verifyTx(hash: string): Promise<void> {
    const h = hash.toLowerCase() as Hex
    const [tx, receipt] = await Promise.all([this.call(() => this.client.getTransaction({ hash: h })), this.call(() => this.client.getTransactionReceipt({ hash: h }))])
    const ok = receipt.status === 'success'
    const meta: TxMeta = { from: tx.from.toLowerCase(), to: tx.to ? tx.to.toLowerCase() : null, ok }
    this.meta.set(h, meta)
    this.pending.delete(h)
    if (!ok || meta.from !== this.address) return
    const block = Number(receipt.blockNumber)
    const flows = netFlows(receipt.logs, this.address)
    if (isSwapTarget(meta.to)) {
      const legs = pickSwapLegs(flows)
      if (legs) {
        const [a, b] = await Promise.all([this.tokenMeta(legs.tokenIn.token), this.tokenMeta(legs.tokenOut.token)])
        this.swaps.set(h, {
          hash: h, block, tokenIn: legs.tokenIn.token, tokenOut: legs.tokenOut.token, amountIn: (-legs.tokenIn.net).toString(), amountOut: legs.tokenOut.net.toString(),
          inSymbol: a.symbol, inDecimals: a.decimals, outSymbol: b.symbol, outDecimals: b.decimals,
          // Arc gas is paid in USDC: the native view has 18 decimals, the ERC-20 view 6.
          feeAmount: ((receipt.gasUsed * receipt.effectiveGasPrice) / 10n ** 12n).toString(),
        })
      }
    } else if (isBridgeTarget(meta.to) || [...this.transfers.values()].some((t) => t.txHash === h && t.from === this.address && isBridgeCounterparty(t.to))) {
      const spent = flows.filter((f) => f.net < 0n).sort((x, y) => (x.net < y.net ? -1 : 1))[0]
      if (spent) {
        const m = await this.tokenMeta(spent.token)
        this.bridges.set(h, { hash: h, block, token: spent.token, amountIn: (-spent.net).toString(), symbol: m.symbol, decimals: m.decimals })
      }
    }
    if (!this.times.has(block)) {
      const b = await this.call(() => this.client.getBlock({ blockNumber: receipt.blockNumber }))
      this.times.set(block, Number(b.timestamp))
    }
  }

  private async verifyPending(max: number) {
    const batch = [...this.pending].slice(0, max)
    let failed: unknown
    for (let i = 0; i < batch.length; i += 4) {
      const settled = await Promise.allSettled(batch.slice(i, i + 4).map((h) => this.verifyTx(h)))
      for (const s of settled) if (s.status === 'rejected') failed = s.reason
    }
    if (batch.length) this.bump()
    if (failed) throw asError(failed)
  }

  /** Called after the app itself confirmed a transaction (for example a swap): read it now instead of waiting for the scan. */
  async trackConfirmed(hash: string): Promise<void> {
    await this.refreshHead()
    this.start()
    await this.verifyTx(hash)
    this.bump()
    this.scheduleSave()
  }

  /** The chain head, shared: several screens ask at once and poll often, so a value under 2 seconds old is reused. */
  private refreshHead(): Promise<void> {
    if (this.newest !== null && Date.now() - this.headAt < HEAD_TTL_MS) return Promise.resolve()
    this.headInflight ??= (async () => {
      this.head = Number(await this.call(() => this.client.getBlockNumber()))
      this.headAt = Date.now()
      if (this.newest === null) {
        this.newest = this.head
        this.oldest = this.head + 1
      }
    })().finally(() => { this.headInflight = undefined })
    return this.headInflight
  }

  /** Brings the newest blocks in right away (used when a screen asks for fresh data). */
  async syncTip(): Promise<void> {
    this.start()
    await this.refreshHead()
    await this.scanTip()
    await this.verifyPending(8).catch(() => undefined)
  }

  // ---- main loop ---------------------------------------------------------------------------------
  /** Marks the data as still wanted. A reader that stops asking lets the scan stop after a minute. */
  touch() { this.touchedAt = Date.now() }

  start() {
    this.touchedAt = Date.now()
    this.running = true
    if (this.loopActive) return
    this.loopActive = true
    void this.loop().finally(() => { this.loopActive = false })
  }

  private async loop() {
    let failures = 0
    while (this.running) {
      if (this.listeners.size === 0 && Date.now() - this.touchedAt > 60_000) {
        this.running = false
        break
      }
      try {
        await this.refreshHead()
        await this.scanTip()
        await this.verifyPending(12)
        if (this.oldest !== null && this.oldest > 0) await this.backfillBatch()
        else await sleep(10_000)
        failures = 0
      } catch (e) {
        failures += 1
        const kind = kindOf(e)
        this.error = kind === 'rate' ? 'The public Arc RPC is rate limiting requests; waiting before retrying.' : kind === 'range' ? 'The RPC rejected the block range; retrying with a smaller range.' : `The Arc RPC did not answer (${String((e as Error)?.message ?? e).split('\n')[0].slice(0, 120)}); retrying.`
        this.bump()
        await sleep(Math.min(15_000, 1_000 * 2 ** Math.min(failures, 4)))
      }
    }
  }

  // ---- local cache (speed-up only) ---------------------------------------------------------------
  private key() { return `quickpay.chainhistory.v${CACHE_VERSION}.5042.${this.address}` }

  private load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) ?? 'null') as Cache | null
      if (!raw || raw.v !== CACHE_VERSION) return
      for (const t of raw.transfers) this.transfers.set(`${t.txHash}:${t.logIndex}`, t)
      for (const [h, from, to, ok] of raw.meta) this.meta.set(h, { from, to, ok })
      for (const s of raw.swaps) this.swaps.set(s.hash, s)
      for (const b of raw.bridges) this.bridges.set(b.hash, b)
      for (const [b, t] of raw.times) this.times.set(b, t)
      this.newest = raw.newest
      this.oldest = raw.oldest
      for (const t of this.transfers.values()) if (shouldVerify(this.address, t.from, t.to) && !this.meta.has(t.txHash)) this.pending.add(t.txHash)
    } catch {
      /* unreadable cache: start from the chain */
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      const cache: Cache = {
        v: CACHE_VERSION, newest: this.newest, oldest: this.oldest, transfers: [...this.transfers.values()],
        meta: [...this.meta].map(([h, m]) => [h, m.from, m.to, m.ok]), swaps: [...this.swaps.values()], bridges: [...this.bridges.values()], times: [...this.times],
      }
      try {
        localStorage.setItem(this.key(), JSON.stringify(cache))
      } catch {
        /* storage full or blocked: the next visit simply rescans from the chain */
      }
    }, 2_000)
  }
}

let shared: PublicClient | undefined
const sharedClient = () => (shared ??= createPublicClient({ chain: arcMainnet, transport: http(ARC_RPC_URL, { retryCount: 1, timeout: 20_000 }) }) as PublicClient)

/** Latest Arc block, read directly from the RPC. */
export async function arcHeadBlock(): Promise<number> {
  return Number(await sharedClient().getBlockNumber())
}

const engines = new Map<string, ChainHistory>()
export function chainHistoryFor(address: string): ChainHistory {
  const key = address.toLowerCase()
  let engine = engines.get(key)
  if (!engine) {
    engine = new ChainHistory(key)
    engines.set(key, engine)
  }
  return engine
}
