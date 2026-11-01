import { ApiError } from '@/lib/api'
import { buildActivity, buildAnalytics, buildHistory, filterRows, HistoryInputError, type Filters, type Snapshot } from './derive'
import { chainHistoryFor } from './engine'
import { waitAtMost } from './mode'

const ARC = 5042

/** Gives the engine a moment to pull in the newest blocks, then answers from what has been read so far. */
async function ready(address: string): Promise<Snapshot> {
  const engine = chainHistoryFor(address)
  engine.touch()
  engine.start()
  // A wallet the reader already knows answers at once with what it has (the sync carries on in the background and the
  // next poll shows the result). Only a first visit waits, up to 8 seconds, for the first block.
  await waitAtMost(engine.syncTip(), engine.started ? 800 : 8_000)
  if (!engine.started) throw new ApiError(0, 'rpc_unavailable', `Could not read Arc right now: ${engine.lastError ?? 'the RPC did not answer'}. Press retry.`)
  return engine.snapshot()
}

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof HistoryInputError) throw new ApiError(400, 'bad_query', e.message)
    throw e
  }
}

export async function chainHistoryPage(address: string, filters: Filters) {
  const snapshot = await ready(address)
  return guard(() => buildHistory(snapshot, filters, Date.now()))
}

export async function chainAnalytics(address: string) {
  const snapshot = await ready(address)
  return buildAnalytics(snapshot, Date.now())
}

export async function chainActivity(address: string) {
  const snapshot = await ready(address)
  return buildActivity(snapshot, ARC)
}

/** CSV of every matching row, built from the same data as the list. */
export async function chainCsv(address: string, filters: Filters): Promise<string> {
  const snapshot = await ready(address)
  const rows = guard(() => filterRows(snapshot, filters))
  const cell = (v: string | number) => {
    const t = String(v)
    return /^[=+\-@]/.test(t) || /[",\n]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t
  }
  const units = (raw: string, decimals = 6) => {
    const d = raw.padStart(decimals + 1, '0')
    return decimals === 0 ? d : `${d.slice(0, -decimals)}.${d.slice(-decimals)}`
  }
  const lines = rows.map((r) => [r.timestamp, r.txHash, r.blockNumber, r.direction, r.type, r.from, r.to, r.token, units(r.amount, r.decimals ?? 6), r.confirmations, r.status].map(cell).join(','))
  return ['timestamp,tx_hash,block_number,direction,type,from,to,token,amount_usdc,confirmations,status', ...lines].join('\n') + '\n'
}

export const chainTrackConfirmed = (address: string, hash: string, options?: { bridgeFill?: boolean }) => chainHistoryFor(address).trackConfirmed(hash, options)

export { arcHeadBlock as chainHead } from './engine'
