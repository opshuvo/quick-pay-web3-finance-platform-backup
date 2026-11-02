import type { HistoryRow } from '../../shared/api-types'

export interface TrendPoint {
  at: number
  /** Raw USDC (6 decimals) */
  value: bigint
}

export interface Trend {
  points: TrendPoint[]
  /** Balance change over the charted window, in raw USDC. */
  change: bigint
  /** True when the list was cut off before the window start, so the chart begins at the oldest row read. */
  truncated: boolean
  /** Number of confirmed USDC transfers inside the chart. */
  transfers: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Rebuilds the last 24 hours of the wallet's USDC balance from its confirmed transfers, walking backwards from the
 * balance read from Arc right now. Only confirmed USDC rows count. Transaction fees do not appear as transfers, so a
 * past point can be slightly above the true balance by the fees paid since. Returns null when there is nothing to draw.
 */
export function balanceTrend(rows: readonly HistoryRow[], current: bigint, usdc: string, now: number, pageSize: number, windowMs = DAY_MS): Trend | null {
  const wanted = usdc.toLowerCase()
  const usable = rows
    .filter((r) => r.status === 'confirmed' && r.direction !== 'self' && !r.symbol && r.token.toLowerCase() === wanted)
    .map((r) => ({ at: Date.parse(r.timestamp), delta: r.direction === 'in' ? BigInt(r.amount) : -BigInt(r.amount) }))
    .filter((r) => Number.isFinite(r.at) && r.at <= now)
    .sort((a, b) => b.at - a.at)
  // The page is newest first and holds `pageSize` rows at most: if it is full and still reaches the window start, older rows were not read.
  const full = rows.length >= pageSize
  const oldestRead = rows.length > 0 ? Math.min(...rows.map((r) => Date.parse(r.timestamp)).filter(Number.isFinite)) : now
  const truncated = full && oldestRead > now - windowMs
  const start = truncated ? oldestRead : now - windowMs
  const inside = usable.filter((r) => r.at >= start)
  if (inside.length === 0) return null

  // Walk back from now: the balance just before each transfer is the balance after it minus its effect.
  const points: TrendPoint[] = [{ at: now, value: current }]
  let balance = current
  for (const r of inside) {
    points.push({ at: r.at, value: balance })
    balance -= r.delta
    points.push({ at: r.at - 1, value: balance })
  }
  points.push({ at: start, value: balance })
  points.sort((a, b) => a.at - b.at)
  return { points, change: current - balance, truncated, transfers: inside.length }
}
