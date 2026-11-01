import { isAddressEqual, parseEventLogs, erc20Abi, type Address, type Hash, type Log, type PublicClient, type TransactionReceipt } from 'viem'

/** A message that is safe to show to the user as is. */
export class TxFlowError extends Error {}

/** The transaction was broadcast, but its outcome could not be read. It may still complete. */
export class TxUnconfirmedError extends TxFlowError {
  constructor(public hash: Hash, public underlying?: unknown) {
    super('We could not confirm this transaction. It may still complete. Check it on the explorer before trying again.')
  }
}

/** The wallet replaced or cancelled the transaction with another one, so this hash will never confirm. */
export class TxReplacedError extends TxFlowError {
  constructor(public hash: Hash, public reason: 'cancelled' | 'replaced') {
    super(
      reason === 'cancelled'
        ? 'This transaction was cancelled from your wallet before it confirmed. No funds moved.'
        : 'This transaction was replaced by a different one from your wallet. Check your wallet activity before trying again.',
    )
  }
}

export interface ConfirmedTx {
  /** The hash that actually mined (differs from the submitted one only when the wallet sped the transaction up). */
  hash: Hash
  receipt: TransactionReceipt
}

type Waiter = Pick<PublicClient, 'waitForTransactionReceipt'>

interface Options {
  /** How many times to ask the RPC before giving up as "unconfirmed". */
  attempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Waits for a transaction receipt and returns it only when it belongs to the transaction the wallet submitted.
 * viem resolves with the REPLACEMENT's receipt when a wallet cancels or swaps a pending transaction, which would
 * look like success for the original hash; those cases throw instead. A speed-up (same call, higher fee) is followed
 * and reported under its new hash. Transient RPC failures are retried; if the outcome still cannot be read, a
 * TxUnconfirmedError carries the hash so callers never present a broadcast transaction as a plain failure.
 */
export async function confirmTx(client: Waiter, submitted: Hash, options: Options = {}): Promise<ConfirmedTx> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const sleep = options.sleep ?? realSleep
  let hash = submitted
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    let replacement: { reason: 'cancelled' | 'replaced' | 'repriced'; hash: Hash } | undefined
    try {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        onReplaced: (r) => {
          replacement = { reason: r.reason, hash: r.transaction.hash }
        },
      })
      if (replacement) {
        if (replacement.reason !== 'repriced') throw new TxReplacedError(submitted, replacement.reason)
        hash = replacement.hash
      }
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new TxUnconfirmedError(submitted)
      return { hash, receipt }
    } catch (error) {
      if (error instanceof TxFlowError) throw error
      lastError = error
      if (i < attempts - 1) await sleep(options.retryDelayMs ?? 1_500)
    }
  }
  throw new TxUnconfirmedError(hash, lastError)
}

/** True when the receipt holds a Transfer of exactly `amount` of `token` from `from` to `to`, emitted by that token. */
export function receiptHasTransfer(logs: readonly Log[], token: Address, from: Address, to: Address, amount: bigint): boolean {
  const own = logs.filter((l) => l.address.toLowerCase() === token.toLowerCase())
  return parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: own, strict: false }).some(
    (l) => l.args.value === amount && Boolean(l.args.from) && Boolean(l.args.to) && isAddressEqual(l.args.from as Address, from) && isAddressEqual(l.args.to as Address, to),
  )
}
