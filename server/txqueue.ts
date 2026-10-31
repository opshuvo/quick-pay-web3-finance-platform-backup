/**
 * Durable transaction verification queue.
 * The indexer enqueues every transaction in which a wallet SENT a USDC transfer. A worker then reads the
 * transaction and its receipt from Arc, stores the verified facts in `tx_meta` (sender, target contract,
 * status), and records genuine Uniswap swaps in `defi_activity` through the same receipt-verified path the
 * app uses. Because the queue lives in PostgreSQL, swaps are saved with the browser closed, history from
 * before this existed is recovered by the backfill, and a restart resumes where it stopped.
 */
import type { Hex } from 'viem'
import { UNISWAP_UNIVERSAL_ROUTER } from '../shared/uniswap-constants'
import { recordSwap } from './activity'
import { HttpError, requireDb, sql } from './db'
import { config } from './env'
import { client, rpc, rpcPausedForMs } from './rpc'

import { BRIDGE_COUNTERPARTIES, SWAP_COUNTERPARTIES } from './protocols'

/**
 * Which of a wallet's transfers need their transaction verified: everything the wallet sent, and anything it
 * received straight from a Uniswap or Across contract (the output leg of a swap or bridge).
 */
export function shouldVerify(wallet: string, from: string, to: string): boolean {
  if (from === wallet) return true
  const protocols: readonly string[] = [...SWAP_COUNTERPARTIES, ...BRIDGE_COUNTERPARTIES]
  return to === wallet && protocols.includes(from)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const BATCH = 10

export async function enqueueTxs(wallet: string, hashes: string[]): Promise<void> {
  const unique = [...new Set(hashes.map((h) => h.toLowerCase()))]
  if (unique.length === 0) return
  const db = requireDb()
  const rows = unique.map((tx_hash) => ({ chain_id: config.chainId, tx_hash, wallet }))
  // Idempotent: a re-scanned chunk never queues the same work twice.
  await db`insert into tx_queue ${db(rows)} on conflict (chain_id, tx_hash, wallet) do nothing`
}

interface QueueRow {
  tx_hash: string
  wallet: string
  attempts: number
}

interface Meta {
  tx_from: string
  tx_to: string | null
  status: string
}

async function loadMeta(hash: string): Promise<Meta> {
  const db = requireDb()
  const known = (await db`select tx_from, tx_to, status from tx_meta where chain_id = ${config.chainId} and tx_hash = ${hash}`) as Meta[]
  if (known[0]) return known[0]
  const [tx, receipt] = await Promise.all([rpc(() => client.getTransaction({ hash: hash as Hex })), rpc(() => client.getTransactionReceipt({ hash: hash as Hex }))])
  const meta: Meta = { tx_from: tx.from.toLowerCase(), tx_to: tx.to ? tx.to.toLowerCase() : null, status: receipt.status }
  await db`
    insert into tx_meta (chain_id, tx_hash, block_number, tx_from, tx_to, status)
    values (${config.chainId}, ${hash}, ${receipt.blockNumber.toString()}::bigint, ${meta.tx_from}, ${meta.tx_to}, ${meta.status})
    on conflict (chain_id, tx_hash) do nothing`
  return meta
}

async function handle(item: QueueRow): Promise<void> {
  const meta = await loadMeta(item.tx_hash)
  // Only successful transactions sent by this wallet to the Uniswap Universal Router are swaps.
  if (meta.status === 'success' && meta.tx_to === UNISWAP_UNIVERSAL_ROUTER && meta.tx_from === item.wallet) {
    try {
      await recordSwap(item.tx_hash)
    } catch (error) {
      // 422: verified not to be a recordable swap (no token legs). Anything else is retried.
      if (!(error instanceof HttpError && error.status === 422)) throw error
    }
  }
}

/** Processes up to one batch. Returns how many items were settled. */
export async function processQueue(): Promise<number> {
  const db = requireDb()
  const items = (await db`
    select tx_hash, wallet, attempts from tx_queue
    where chain_id = ${config.chainId} and next_attempt_at <= now()
    order by created_at asc limit ${BATCH}`) as QueueRow[]
  let settled = 0
  for (const item of items) {
    if (rpcPausedForMs() > 0) break
    try {
      await handle(item)
      await db`delete from tx_queue where chain_id = ${config.chainId} and tx_hash = ${item.tx_hash} and wallet = ${item.wallet}`
      settled += 1
    } catch (error) {
      const attempts = item.attempts + 1
      const delaySeconds = Math.min(1800, 5 * 2 ** Math.min(attempts, 9))
      await db`
        update tx_queue set attempts = ${attempts}, last_error = ${String((error as Error).message).slice(0, 300)},
          next_attempt_at = now() + ${delaySeconds} * interval '1 second'
        where chain_id = ${config.chainId} and tx_hash = ${item.tx_hash} and wallet = ${item.wallet}`
    }
  }
  return settled
}

export async function queueStats(): Promise<{ pending: number; failing: number; lastError: string | null }> {
  const db = requireDb()
  const rows = (await db`
    select count(*)::int as pending, count(*) filter (where attempts > 0)::int as failing,
      (select last_error from tx_queue where last_error is not null order by next_attempt_at desc limit 1) as last_error
    from tx_queue where chain_id = ${config.chainId}`) as { pending: number; failing: number; last_error: string | null }[]
  return { pending: rows[0]?.pending ?? 0, failing: rows[0]?.failing ?? 0, lastError: rows[0]?.last_error ?? null }
}

let started = false
export function startTxWorker(): void {
  if (!sql || started) return
  started = true
  void (async () => {
    for (;;) {
      try {
        const settled = await processQueue()
        await sleep(settled > 0 ? 200 : 3000)
      } catch (error) {
        console.error('[txqueue] worker error', (error as Error).message)
        await sleep(5000)
      }
    }
  })()
}
