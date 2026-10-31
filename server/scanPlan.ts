import type { RpcErrorKind } from './rpc'

/**
 * Pure scan planning for the indexer. A wallet's scanned blocks are one contiguous interval
 * [oldest, newest]. New work always starts right next to that interval, and the interval only
 * grows after a chunk was fully scanned and stored, so a block can never be skipped.
 */
export interface Cursor {
  newest: bigint
  oldest: bigint
}

export interface ScanPlan {
  direction: 'forward' | 'backfill'
  from: bigint
  to: bigint
}

export function planStep(cursor: Cursor, head: bigint, range: number, followLagBlocks: number, forwardOnly = false): ScanPlan | null {
  const { newest, oldest } = cursor
  const span = BigInt(range)
  const behind = head - newest > BigInt(followLagBlocks)
  const forward = forwardOnly ? head > newest : behind || oldest === 0n ? head > newest : false
  if (!forward && (forwardOnly || oldest === 0n)) return null
  if (forward) {
    const from = newest + 1n
    const to = from + span - 1n > head ? head : from + span - 1n
    return { direction: 'forward', from, to }
  }
  const to = oldest - 1n
  const from = to - span + 1n < 0n ? 0n : to - span + 1n
  return { direction: 'backfill', from, to }
}

/** The cursor after a chunk was scanned AND stored. Mirrors the SQL greatest()/least() update. */
export function applyStep(cursor: Cursor, plan: ScanPlan): Cursor {
  return plan.direction === 'forward'
    ? { newest: plan.to > cursor.newest ? plan.to : cursor.newest, oldest: cursor.oldest }
    : { newest: cursor.newest, oldest: plan.from < cursor.oldest ? plan.from : cursor.oldest }
}

/** One transfer per (tx hash, log index). Mirrors the table's primary key; the insert also ignores conflicts. */
export function dedupeRows<T extends { tx_hash: string; log_index: number }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const row of rows) {
    const key = `${row.tx_hash}:${row.log_index}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(row)
  }
  return unique
}

export interface RangeState {
  range: number
  streak: number
}

/** Grows the block range slowly after clean chunks; shrinks it ONLY when the provider says the range is too large. */
export function adaptRange(state: RangeState, outcome: 'ok' | RpcErrorKind, ceiling: number): RangeState {
  if (outcome === 'ok') {
    const streak = state.streak + 1
    return streak >= 15 ? { range: Math.min(ceiling, Math.floor(state.range * 1.25)), streak: 0 } : { range: state.range, streak }
  }
  if (outcome === 'range_too_large') return { range: Math.max(250, Math.floor(state.range / 2)), streak: 0 }
  return { range: state.range, streak: 0 }
}
