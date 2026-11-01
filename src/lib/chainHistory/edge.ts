/**
 * Reads a wallet's USDC movements (Arc's system Transfer logs, see native.ts) for a fixed 10,000-block window from the Quick Pay relay (`/api/arc-logs`, a
 * serverless function in `public/api/arc-logs.js`). The relay asks the official Arc RPC and its answer for a finished
 * window never changes, so it is cached for everyone: the first reader pays the RPC calls, later readers (other
 * devices, a cleared cache) get it instantly with no RPC call and no rate limit. Only logs that name this wallet and
 * sit inside the window are accepted; anything else is rejected, never shown. When the relay is missing (local
 * preview, another host) or busy, the caller reads the RPC directly as before.
 */
import { TRANSFER_TOPIC } from '../../../shared/swapLegs'
import type { RawTransfer } from './derive'
import { systemAmountToUsdc } from './native'

export const EDGE_CHUNK = 10_000

export interface EdgeChunk {
  rows: RawTransfer[]
  times: Map<number, number>
}
export type EdgeResult = { ok: true; chunk: EdgeChunk } | { ok: false; reason: 'unavailable' | 'busy' | 'not_final' }

const HASH = /^0x[0-9a-f]{64}$/
const HEX = /^0x[0-9a-f]+$/
const topicAddress = (topic: string) => `0x${topic.slice(26)}`

interface WireLog { transactionHash: unknown; logIndex: unknown; blockNumber: unknown; topics: unknown; data: unknown }

function parse(address: string, chunk: number, body: unknown): EdgeChunk | undefined {
  const b = body as { chunk?: unknown; logs?: unknown; times?: unknown } | null
  if (!b || b.chunk !== chunk || !Array.isArray(b.logs) || !Array.isArray(b.times)) return undefined
  const from = chunk * EDGE_CHUNK
  const to = from + EDGE_CHUNK - 1
  const rows = new Map<string, RawTransfer>()
  for (const entry of b.logs as WireLog[]) {
    if (!entry || typeof entry.transactionHash !== 'string' || typeof entry.logIndex !== 'string' || typeof entry.blockNumber !== 'string' || typeof entry.data !== 'string') return undefined
    const topics = entry.topics
    if (!Array.isArray(topics) || topics.length !== 3 || !topics.every((t) => typeof t === 'string' && /^0x[0-9a-f]{64}$/.test(t))) return undefined
    if (topics[0] !== TRANSFER_TOPIC || !HASH.test(entry.transactionHash) || !HEX.test(entry.logIndex) || !HEX.test(entry.blockNumber) || !HEX.test(entry.data)) return undefined
    const block = Number(BigInt(entry.blockNumber))
    const fromAddr = topicAddress(topics[1] as string)
    const toAddr = topicAddress(topics[2] as string)
    // A log that does not involve this wallet, or lies outside the window, means the answer cannot be trusted.
    if (block < from || block > to || (fromAddr !== address && toAddr !== address)) return undefined
    const amount = systemAmountToUsdc(entry.data)
    if (amount === 0n) continue
    const row: RawTransfer = { txHash: entry.transactionHash, logIndex: Number(BigInt(entry.logIndex)), block, from: fromAddr, to: toAddr, amount: amount.toString() }
    rows.set(`${row.txHash}:${row.logIndex}`, row)
  }
  const times = new Map<number, number>()
  for (const pair of b.times as unknown[]) {
    if (!Array.isArray(pair) || !Number.isInteger(pair[0]) || !Number.isInteger(pair[1])) return undefined
    times.set(pair[0] as number, pair[1] as number)
  }
  // Every row needs the time of its block, or it would be shown with an invented date.
  for (const row of rows.values()) if (!times.has(row.block)) return undefined
  return { rows: [...rows.values()], times }
}

const done = new Map<string, EdgeChunk>()
const inflight = new Map<string, Promise<EdgeResult>>()

/** One window of one wallet. Successful windows are kept in memory, and simultaneous requests share one call. */
export function fetchEdgeChunk(address: string, chunk: number, fetcher: typeof fetch = fetch): Promise<EdgeResult> {
  const key = `${address}:${chunk}`
  const known = done.get(key)
  if (known) return Promise.resolve({ ok: true, chunk: known })
  let pending = inflight.get(key)
  if (!pending) {
    pending = load(address, chunk, fetcher)
      .then((result) => {
        if (result.ok) {
          if (done.size > 64) done.clear()
          done.set(key, result.chunk)
        }
        return result
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}

async function load(address: string, chunk: number, fetcher: typeof fetch): Promise<EdgeResult> {
  let response: Response
  try {
    response = await fetcher(`/api/arc-logs?address=${address}&chunk=${chunk}&v=2`, { signal: AbortSignal.timeout(20_000) })
  } catch {
    return { ok: false, reason: 'busy' }
  }
  if (response.status === 409) return { ok: false, reason: 'not_final' }
  if (response.status >= 500 || response.status === 429) return { ok: false, reason: 'busy' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // An HTML page or a plain 404: this host has no relay.
    return { ok: false, reason: 'unavailable' }
  }
  if (!response.ok) return { ok: false, reason: response.status === 404 || response.status === 405 ? 'unavailable' : 'busy' }
  const parsed = parse(address, chunk, body)
  return parsed ? { ok: true, chunk: parsed } : { ok: false, reason: 'busy' }
}

/** Test hook: forget remembered windows. */
export function resetEdgeCache() {
  done.clear()
  inflight.clear()
}
