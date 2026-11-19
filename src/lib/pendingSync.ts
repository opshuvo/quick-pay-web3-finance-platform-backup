import { api, ApiError } from '@/lib/api'
import type { LedgerEntry } from '@/lib/txLedger'

const RETRY_AFTER_MS = [1_500, 5_000, 12_000]

/**
 * Saves a transaction the wallet just signed on the history server, so it shows as Pending on every device and the
 * server reconciles it with the on-chain receipt. The server accepts only a transaction its own node can see and
 * that this wallet sent. A node that has not seen it yet is asked again a few times; any other answer (no server,
 * refused) ends the attempt quietly, because this device's own ledger still holds the record.
 */
export function reportPending(entry: LedgerEntry, attempt = 0): void {
  if (typeof window === 'undefined') return
  void api('/pending', {
    method: 'POST',
    body: { txHash: entry.hash, wallet: entry.wallet, kind: entry.kind, to: entry.to, token: entry.token, amount: entry.amount, symbol: entry.symbol, decimals: entry.decimals },
  }).catch((error: unknown) => {
    const retriable = error instanceof ApiError && (error.code === 'tx_not_found' || error.code === 'rpc_unavailable')
    if (retriable && attempt < RETRY_AFTER_MS.length) setTimeout(() => reportPending(entry, attempt + 1), RETRY_AFTER_MS[attempt])
  })
}
