/**
 * USDC transfer indexer. Arc chain data is the source of truth: every row is a real
 * `Transfer` log from the official USDC contract. Each wallet keeps a scanned block
 * interval; the tip is followed forward and history is backfilled toward block 0.
 * History is only called "complete" once the backfill has actually reached block 0.
 */
import { toHex, type Hex } from 'viem'
import { config } from './env'
import { sql, requireDb, HttpError } from './db'
import { client, rpc, rpcPausedForMs, classifyRpcError } from './rpc'
import { adaptRange, dedupeRows, planStep, type RangeState } from './scanPlan'
import { evaluateCoverage } from './coverageState'
import { enqueueTxs, shouldVerify } from './txqueue'
import { SharedValue, TipGate, waitAtMost } from './tipGate'
import type { Coverage } from '../shared/api-types'

export type { Coverage }

const TRANSFER_TOPIC: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const padTopic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`

let rangeState: RangeState = { range: config.indexer.initialRange, streak: 0 }
const bootAt = Date.now()
/** In memory: when each wallet last advanced its scanned range. Unknown wallets count from process start. */
const lastProgress = new Map<string, number>()
const tipGate = new TipGate()
const blockTimes = new Map<bigint, Date>()

/** One shared chain-head lookup: concurrent requests share a single RPC call; a recent value covers short outages. */
const headValue = new SharedValue<bigint>(1_500, 60_000)
export const getHead = (): Promise<bigint> => headValue.get(() => rpc(() => client.getBlockNumber()))

interface WalletRow {
  address: string
  newest_scanned: string
  oldest_scanned: string
  last_error: string | null
  last_error_at: Date | null
}

interface RawLog {
  transactionHash: Hex
  logIndex: Hex
  blockNumber: Hex
  topics: Hex[]
  data: Hex
}

async function getLogs(topics: (Hex | null)[], from: bigint, to: bigint): Promise<RawLog[]> {
  return rpc(
    () =>
      client.request({
        method: 'eth_getLogs',
        params: [{ address: config.usdc as Hex, fromBlock: toHex(from), toBlock: toHex(to), topics }],
      }) as Promise<RawLog[]>,
  )
}

async function blockTime(number: bigint): Promise<Date> {
  const cached = blockTimes.get(number)
  if (cached) return cached
  const block = await rpc(() => client.getBlock({ blockNumber: number }))
  const date = new Date(Number(block.timestamp) * 1000)
  if (blockTimes.size > 5000) blockTimes.clear()
  blockTimes.set(number, date)
  return date
}

const topicAddress = (topic: Hex) => `0x${topic.slice(26)}`.toLowerCase()

async function scanRange(address: string, from: bigint, to: bigint): Promise<void> {
  const sent = await getLogs([TRANSFER_TOPIC, padTopic(address)], from, to)
  const received = await getLogs([TRANSFER_TOPIC, null, padTopic(address)], from, to)
  const logs = [...sent, ...received].filter((log) => log.topics.length === 3)
  if (logs.length === 0) return
  const blocks = [...new Set(logs.map((log) => BigInt(log.blockNumber)))]
  for (const number of blocks) await blockTime(number)
  const rows = dedupeRows(logs.map((log) => ({
    chain_id: config.chainId,
    tx_hash: log.transactionHash.toLowerCase(),
    log_index: Number(BigInt(log.logIndex)),
    block_number: BigInt(log.blockNumber).toString(),
    block_time: blockTimes.get(BigInt(log.blockNumber)) as Date,
    from_addr: topicAddress(log.topics[1]),
    to_addr: topicAddress(log.topics[2]),
    token: config.usdc,
    amount: BigInt(log.data).toString(),
  })))
  const db = requireDb()
  await db`insert into transfers ${db(rows)} on conflict (tx_hash, log_index) do nothing`
  // Queue the wallet's own outgoing transactions for receipt verification (swap discovery). Done before the
  // checkpoint moves, so a failure here retries the whole chunk instead of skipping it.
  await enqueueTxs(address, rows.filter((r) => shouldVerify(address, r.from_addr, r.to_addr)).map((r) => r.tx_hash))
}

const errorMessage = {
  rate_limited: 'The RPC provider is rate limiting requests; waiting before retrying.',
  range_too_large: 'RPC rejected the block range; retrying with a smaller range.',
  timeout: 'The RPC provider timed out; retrying.',
  network: 'The RPC provider could not be reached; retrying.',
  other: 'RPC request failed; retrying.',
} as const

/** Scans one chunk for a wallet. Returns true when progress was made. */
async function stepWallet(w: WalletRow, head: bigint, forwardOnly = false): Promise<boolean> {
  const db = requireDb()
  const plan = planStep({ newest: BigInt(w.newest_scanned), oldest: BigInt(w.oldest_scanned) }, head, rangeState.range, config.indexer.followLagBlocks, forwardOnly)
  if (!plan) return false
  try {
    // The checkpoint moves only after the whole chunk was fetched AND stored; a failure leaves it untouched.
    await scanRange(w.address, plan.from, plan.to)
    if (plan.direction === 'forward') {
      await db`update wallets set newest_scanned = greatest(newest_scanned, ${plan.to.toString()}::bigint), updated_at = now(), last_error = null where address = ${w.address}`
    } else {
      await db`update wallets set oldest_scanned = least(oldest_scanned, ${plan.from.toString()}::bigint), updated_at = now(), last_error = null where address = ${w.address}`
    }
    // Stall detection tracks the work that makes a wallet finish: backfill steps, or tip steps once backfill is done.
    // Tip syncs on read must not hide a stuck backfill.
    if (plan.direction === 'backfill' || BigInt(w.oldest_scanned) === 0n) lastProgress.set(w.address, Date.now())
    rangeState = adaptRange(rangeState, 'ok', config.indexer.ceilingRange)
    return true
  } catch (error) {
    const kind = classifyRpcError(error)
    rangeState = adaptRange(rangeState, kind, config.indexer.ceilingRange)
    await db`update wallets set last_error = ${errorMessage[kind]}, last_error_at = now(), updated_at = now() where address = ${w.address}`
    return false
  }
}

export async function registerWallet(address: string): Promise<void> {
  const db = requireDb()
  const known = (await db`select 1 from wallets where address = ${address}`) as unknown[]
  if (known.length === 0) {
    // Backfilling is real RPC work: refuse new wallets while too many are still catching up.
    const pending = (await db`select count(*)::int as n from wallets where oldest_scanned > 0`) as { n: number }[]
    if ((pending[0]?.n ?? 0) >= config.indexer.maxPendingWallets) {
      throw new HttpError(503, 'indexer_busy', 'The indexer is catching up on other wallets. Try again later.')
    }
  }
  const head = await getHead()
  await db`
    insert into wallets (address, chain_id, newest_scanned, oldest_scanned)
    values (${address}, ${config.chainId}, ${head.toString()}::bigint, ${(head + 1n).toString()}::bigint)
    on conflict (address) do update set last_activity = now()`
}

async function loadWallet(address: string): Promise<WalletRow | null> {
  const db = requireDb()
  const rows = (await db`select address, newest_scanned::text, oldest_scanned::text, last_error, last_error_at from wallets where address = ${address}`) as WalletRow[]
  return rows[0] ?? null
}

/**
 * Brings a registered wallet's tip up to date (bounded work). Safe to call on every read: it runs at most
 * once per freshness window per wallet, joins a run that is already in flight, never registers a wallet,
 * and stays out of the way while the provider is rate limiting us.
 */
export async function syncTip(address: string, maxChunks = 4, minAgeMs: number = config.indexer.tipFreshnessMs): Promise<void> {
  if (rpcPausedForMs() > 0) return
  // Reads must not block on slow or rate-limited RPC work: wait briefly, then answer from what is stored.
  // The sync keeps running in the background and later reads see its result.
  const sync = tipGate.run(address, minAgeMs, async () => {
    try {
      if (!(await loadWallet(address))) return
      const head = await getHead()
      for (let i = 0; i < maxChunks; i++) {
        const w = await loadWallet(address)
        if (!w || !(await stepWallet(w, head, true))) return
      }
    } catch (error) {
      console.error('[indexer] tip sync failed', (error as Error).message)
    }
  })
  await waitAtMost(sync, config.indexer.tipWaitMs)
}

/** Marks an existing wallet as recently used so its tip keeps being followed. Never creates a wallet. */
export async function touchWallet(address: string): Promise<void> {
  const db = requireDb()
  await db`update wallets set last_activity = now() where address = ${address} and last_activity < now() - interval '5 minutes'`
}

export async function coverage(address: string): Promise<Coverage> {
  const w = await loadWallet(address)
  const head = await getHead()
  return evaluateCoverage({
    registered: Boolean(w),
    head,
    newest: w ? BigInt(w.newest_scanned) : 0n,
    oldest: w ? BigInt(w.oldest_scanned) : 0n,
    completeLagBlocks: BigInt(config.indexer.completeLagBlocks),
    lastError: w?.last_error ?? null,
    lastErrorAt: w?.last_error_at ?? null,
    now: Date.now(),
    lastProgressAt: lastProgress.get(address) ?? bootAt,
    stallAfterMs: config.indexer.stallAfterMs,
    rpc: config.rpcSource,
    range: rangeState.range,
  })
}

let started = false
/** Background loop: tip follow for active wallets, backfill toward block 0 for everyone. */
export function startIndexer(): void {
  if (!sql || started) return
  started = true
  void (async () => {
    for (;;) {
      try {
        const head = await getHead()
        const lagFloor = (head - BigInt(config.indexer.followLagBlocks)).toString()
        const rows = (await sql`
          select address, newest_scanned::text, oldest_scanned::text, last_error, last_error_at from wallets
          where oldest_scanned > 0
             or (newest_scanned < ${lagFloor}::bigint and last_activity > now() - interval '24 hours')
          order by updated_at asc limit 1`) as WalletRow[]
        if (rows.length === 0) {
          await sleep(2500)
          continue
        }
        const ok = await stepWallet(rows[0], head)
        if (!ok) await sleep(2000)
      } catch (error) {
        console.error('[indexer] loop error', (error as Error).message)
        await sleep(4000)
      }
    }
  })()
}
