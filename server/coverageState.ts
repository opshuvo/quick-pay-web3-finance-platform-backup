import type { Coverage } from '../shared/api-types'

export interface CoverageInput {
  registered: boolean
  head: bigint
  newest: bigint
  oldest: bigint
  /** How far behind the head a fully back-filled wallet may be and still count as up to date. */
  completeLagBlocks: bigint
  lastError: string | null
  lastErrorAt: Date | null
  now: number
  /** When this wallet last advanced its scanned range (or when the indexer started, if it has not yet). */
  lastProgressAt: number
  stallAfterMs: number
  rpc: Coverage['rpc']
  range: number
}

const RECENT_ERROR_MS = 120_000

/**
 * What the history screens may claim. "complete" means the USDC token Transfer logs were scanned from block 0
 * up to near the head; it never covers native-value transfers, pending transactions or failed transactions.
 */
export function evaluateCoverage(input: CoverageInput): Coverage {
  const { head } = input
  if (!input.registered) {
    return {
      status: 'unregistered', headBlock: Number(head), oldestScannedBlock: null, newestScannedBlock: null,
      blocksRemaining: Number(head) + 1, percent: 0, error: null, rpc: input.rpc, range: input.range, stalled: false, msSinceProgress: null,
    }
  }
  const scanned = input.newest >= input.oldest ? input.newest - input.oldest + 1n : 0n
  const complete = input.oldest === 0n && head - input.newest <= input.completeLagBlocks
  const msSinceProgress = Math.max(0, input.now - input.lastProgressAt)
  const stalled = !complete && msSinceProgress > input.stallAfterMs
  const recentError = Boolean(input.lastError && input.lastErrorAt && input.now - input.lastErrorAt.getTime() < RECENT_ERROR_MS)
  return {
    status: complete ? 'complete' : 'indexing',
    headBlock: Number(head),
    oldestScannedBlock: scanned === 0n ? null : Number(input.oldest),
    newestScannedBlock: scanned === 0n ? null : Number(input.newest),
    blocksRemaining: Number(input.oldest) + Math.max(0, Number(head - input.newest)),
    percent: Math.min(100, Number((scanned * 10000n) / (head + 1n)) / 100),
    // A stalled wallet keeps showing its last error however old it is: that is the likely reason.
    error: input.lastError && (recentError || stalled) ? input.lastError : null,
    rpc: input.rpc,
    range: input.range,
    stalled,
    msSinceProgress: complete ? null : msSinceProgress,
  }
}
