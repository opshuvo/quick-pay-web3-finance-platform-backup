/**
 * Pending transaction records. A wallet's transaction is saved the moment the app sends it, and a background worker
 * reconciles every record with its real receipt on Arc: success becomes Confirmed, a revert becomes Failed, and a
 * transaction the network never mined is dropped from the list. Nothing here guesses a status: only a receipt, or the
 * continued absence of both the receipt and the transaction itself, changes a record.
 */
import { isAddress, type Hex } from 'viem'
import { HttpError, requireDb, sql } from './db'
import { config } from './env'
import { enqueueTxs } from './txqueue'
import { syncTip } from './indexer'
import { client, rpc, rpcPausedForMs } from './rpc'

export const PENDING_KINDS = ['send', 'pay_request', 'swap', 'bridge', 'split'] as const
export type PendingKind = (typeof PENDING_KINDS)[number]

const HASH = /^0x[0-9a-fA-F]{64}$/
const DIGITS = /^\d{1,40}$/
/** A transaction neither mined nor known to the node for this long was replaced or dropped. */
export const DROP_AFTER_MS = 30 * 60_000

export interface PendingInput {
  txHash: string
  wallet: string
  kind: PendingKind
  to: string
  token: string
  amount: string
  symbol?: string | null
  decimals?: number | null
}

/** Validates a client submission. Pure, so it is tested without a network. */
export function parsePending(body: unknown): PendingInput {
  const b = (body ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const txHash = text(b.txHash)
  if (!HASH.test(txHash)) throw new HttpError(400, 'bad_hash', 'Invalid transaction hash.')
  const wallet = text(b.wallet)
  if (!isAddress(wallet, { strict: false })) throw new HttpError(400, 'bad_address', 'Invalid wallet address.')
  const to = text(b.to)
  const token = text(b.token)
  if (!isAddress(to, { strict: false }) || !isAddress(token, { strict: false })) throw new HttpError(400, 'bad_address', 'Invalid address.')
  const kind = text(b.kind)
  if (!(PENDING_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'Unknown transaction kind.')
  const amount = text(b.amount)
  if (!DIGITS.test(amount)) throw new HttpError(400, 'bad_amount', 'Amount must be a whole number of base units.')
  const symbol = typeof b.symbol === 'string' ? b.symbol.replace(/[^\w.\-]/g, '').slice(0, 16) || null : null
  const decimals = typeof b.decimals === 'number' && Number.isInteger(b.decimals) && b.decimals >= 0 && b.decimals <= 36 ? b.decimals : null
  return { txHash: txHash.toLowerCase(), wallet: wallet.toLowerCase(), kind: kind as PendingKind, to: to.toLowerCase(), token: token.toLowerCase(), amount, symbol, decimals }
}

/** viem's own "this hash is not known" answers, as opposed to a rate limit, a timeout or an outage. */
export function isNotFound(error: unknown): boolean {
  let current = error as { name?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.name === 'TransactionNotFoundError' || current.name === 'TransactionReceiptNotFoundError') return true
    current = current.cause as typeof current
  }
  return false
}

/** Seconds to wait before the next receipt check: quick at first (Arc finalizes in under a second), then backing off. */
export function nextCheckDelayMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5))
}

export type Reconciliation = { status: 'confirmed' | 'failed'; blockNumber: bigint } | { status: 'pending' } | { status: 'dropped' }

/** What a receipt lookup means. `known` is whether the node still knows the transaction itself. */
export function reconcile(receipt: { status: 'success' | 'reverted'; blockNumber: bigint } | null, known: boolean, ageMs: number): Reconciliation {
  if (receipt) return { status: receipt.status === 'success' ? 'confirmed' : 'failed', blockNumber: receipt.blockNumber }
  if (!known && ageMs > DROP_AFTER_MS) return { status: 'dropped' }
  return { status: 'pending' }
}

/**
 * Saves a record, but only for a transaction the node really knows and that this wallet really sent. A made-up hash,
 * or someone else's transaction, is refused, so no fake pending row can appear in anybody's history.
 */
export async function recordPending(input: PendingInput): Promise<{ status: string }> {
  const db = requireDb()
  let tx: { from: string }
  try {
    tx = await rpc(() => client.getTransaction({ hash: input.txHash as Hex }))
  } catch (error) {
    if (isNotFound(error)) throw new HttpError(404, 'tx_not_found', 'The network does not know this transaction (yet).')
    throw new HttpError(503, 'rpc_unavailable', 'Arc could not be read right now. Try again shortly.')
  }
  if (tx.from.toLowerCase() !== input.wallet) throw new HttpError(403, 'sender_mismatch', 'This transaction was not sent by that wallet.')
  await db`
    insert into pending_txs (chain_id, tx_hash, wallet, kind, to_addr, token, amount, symbol, decimals)
    values (${config.chainId}, ${input.txHash}, ${input.wallet}, ${input.kind}, ${input.to}, ${input.token}, ${input.amount}::numeric, ${input.symbol ?? null}, ${input.decimals ?? null})
    on conflict (chain_id, tx_hash) do nothing`
  const row = (await db`select status from pending_txs where chain_id = ${config.chainId} and tx_hash = ${input.txHash}`) as { status: string }[]
  return { status: row[0]?.status ?? 'pending' }
}

interface DueRow {
  tx_hash: string
  wallet: string
  attempts: number
  age_ms: number
}

/** Checks a batch of due records against Arc. Returns how many were examined. */
export async function reconcileDue(limit = 10): Promise<number> {
  const db = requireDb()
  if (rpcPausedForMs() > 0) return 0
  const due = (await db`
    select tx_hash, wallet, attempts, (extract(epoch from (now() - created_at)) * 1000)::bigint::float8 as age_ms
    from pending_txs
    where chain_id = ${config.chainId} and status = 'pending' and next_attempt_at <= now()
    order by created_at asc limit ${limit}`) as DueRow[]
  for (const row of due) {
    try {
      let receipt: { status: 'success' | 'reverted'; blockNumber: bigint } | null = null
      try {
        receipt = await rpc(() => client.getTransactionReceipt({ hash: row.tx_hash as Hex }))
      } catch (error) {
        // "Not mined yet" is an answer; a rate limit or an outage is not, and must never change a record.
        if (!isNotFound(error)) throw error
      }
      let known = true
      if (!receipt) {
        known = await rpc(() => client.getTransaction({ hash: row.tx_hash as Hex })).then(() => true, (error: unknown) => {
          if (!isNotFound(error)) throw error
          return false
        })
      }
      const result = reconcile(receipt, known, row.age_ms)
      if (result.status === 'pending') {
        const delay = nextCheckDelayMs(row.attempts + 1)
        await db`update pending_txs set attempts = attempts + 1, next_attempt_at = now() + ${delay / 1000} * interval '1 second', updated_at = now() where chain_id = ${config.chainId} and tx_hash = ${row.tx_hash}`
        continue
      }
      await db`
        update pending_txs set status = ${result.status}, block_number = ${'blockNumber' in result ? result.blockNumber.toString() : null}::bigint, updated_at = now()
        where chain_id = ${config.chainId} and tx_hash = ${row.tx_hash}`
      if (result.status === 'confirmed') {
        // Bring the wallet's tip up to date so the real transfer rows replace this record, and queue swap/bridge verification.
        await enqueueTxs(row.wallet, [row.tx_hash]).catch(() => undefined)
        void syncTip(row.wallet, 2, 0).catch(() => undefined)
      }
    } catch (error) {
      console.error('[pending] reconcile failed', (error as Error).message)
      const delay = nextCheckDelayMs(row.attempts + 1)
      await db`update pending_txs set attempts = attempts + 1, next_attempt_at = now() + ${delay / 1000} * interval '1 second' where chain_id = ${config.chainId} and tx_hash = ${row.tx_hash}`.catch(() => undefined)
    }
  }
  return due.length
}

let started = false
export function startPendingWorker(): void {
  if (!sql || started) return
  started = true
  void (async () => {
    for (;;) {
      try {
        const n = await reconcileDue()
        await new Promise((resolve) => setTimeout(resolve, n > 0 ? 400 : 1_500))
      } catch (error) {
        console.error('[pending] loop error', (error as Error).message)
        await new Promise((resolve) => setTimeout(resolve, 4_000))
      }
    }
  })()
}
