/**
 * Quick Pay Router and Registry event indexer. These two contracts emit few events, so one cursor scans them for
 * everybody (never per wallet): block ranges are fetched once, decoded with the contracts' own ABIs and stored with
 * their transaction hash and log index, which is also the primary key, so a re-scan can never duplicate a row.
 * The cursor moves only after a range was fetched AND stored.
 */
import { decodeEventLog, toHex, type Hex } from 'viem'
import { quickPayRegistryAbi } from '../src/contracts/quickPayRegistryAbi'
import { quickPayRouterAbi } from '../src/contracts/quickPayRouterAbi'
import { requireDb, sql } from './db'
import { config } from './env'
import { getHead } from './indexer'
import { client, rpc, classifyRpcError } from './rpc'

const CURSOR = 'quickpay-contracts'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface WatchedContracts {
  addresses: string[]
  fromBlock: bigint
}

const isAddr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? v.trim().toLowerCase() : undefined)

/** Contract addresses and the block to start from, from the same public settings the app uses. Never block 0. */
export function watchedContracts(env: Record<string, string | undefined> = process.env): WatchedContracts | null {
  const addresses = [isAddr(env.VITE_QUICKPAY_REGISTRY_ADDRESS), isAddr(env.VITE_QUICKPAY_ROUTER_ADDRESS)].filter((a): a is string => Boolean(a))
  const raw = env.VITE_QUICKPAY_REGISTRY_FROM_BLOCK?.trim()
  if (addresses.length === 0 || !raw || !/^\d{1,15}$/.test(raw)) return null
  return { addresses, fromBlock: BigInt(raw) }
}

export interface DecodedEvent {
  name: string
  args: Record<string, string>
}

const abis = [quickPayRegistryAbi, quickPayRouterAbi] as const

const stringify = (value: unknown): string => (typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

/** Decodes a log with the contracts' ABIs. Anything those ABIs do not describe is skipped, not guessed. */
export function decodeContractLog(log: { topics: Hex[]; data: Hex }): DecodedEvent | null {
  for (const abi of abis) {
    try {
      const decoded = decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics as [Hex, ...Hex[]] }) as { eventName?: string; args?: Record<string, unknown> }
      if (!decoded.eventName) continue
      return { name: decoded.eventName, args: Object.fromEntries(Object.entries(decoded.args ?? {}).map(([k, v]) => [k, stringify(v)])) }
    } catch {
      /* not this ABI */
    }
  }
  return null
}

interface RawLog {
  transactionHash: Hex
  logIndex: Hex
  blockNumber: Hex
  address: Hex
  topics: Hex[]
  data: Hex
}

const blockTimes = new Map<bigint, Date>()
async function blockTime(number: bigint): Promise<Date> {
  const cached = blockTimes.get(number)
  if (cached) return cached
  const block = await rpc(() => client.getBlock({ blockNumber: number }))
  const date = new Date(Number(block.timestamp) * 1000)
  if (blockTimes.size > 2000) blockTimes.clear()
  blockTimes.set(number, date)
  return date
}

/** Scans one range and stores what it finds. Returns the number of events stored. */
export async function scanContracts(watched: WatchedContracts, from: bigint, to: bigint): Promise<number> {
  const logs = (await rpc(() => client.request({ method: 'eth_getLogs', params: [{ address: watched.addresses as Hex[], fromBlock: toHex(from), toBlock: toHex(to) }] }))) as RawLog[]
  const rows: Record<string, unknown>[] = []
  for (const log of logs) {
    const decoded = decodeContractLog(log)
    if (!decoded) continue
    rows.push({
      chain_id: config.chainId,
      tx_hash: log.transactionHash.toLowerCase(),
      log_index: Number(BigInt(log.logIndex)),
      block_number: BigInt(log.blockNumber).toString(),
      block_time: await blockTime(BigInt(log.blockNumber)),
      contract: log.address.toLowerCase(),
      name: decoded.name,
      args: decoded.args,
    })
  }
  if (rows.length === 0) return 0
  const db = requireDb()
  // `args` is stored as jsonb; the primary key (chain, tx hash, log index) makes a repeated scan a no-op.
  for (const row of rows) {
    await db`
      insert into contract_events (chain_id, tx_hash, log_index, block_number, block_time, contract, name, args)
      values (${row.chain_id as number}, ${row.tx_hash as string}, ${row.log_index as number}, ${row.block_number as string}::bigint, ${row.block_time as Date}, ${row.contract as string}, ${row.name as string}, ${row.args as Record<string, string>}::jsonb)
      on conflict (chain_id, tx_hash, log_index) do nothing`
  }
  return rows.length
}

let started = false
export function startContractIndexer(): void {
  const watched = watchedContracts()
  if (!sql || started) return
  if (!watched) {
    console.warn('[events] Router/Registry event indexing is off: set VITE_QUICKPAY_REGISTRY_ADDRESS and VITE_QUICKPAY_REGISTRY_FROM_BLOCK (and optionally VITE_QUICKPAY_ROUTER_ADDRESS).')
    return
  }
  started = true
  let range = 5000n
  void (async () => {
    for (;;) {
      try {
        const db = requireDb()
        const head = await getHead()
        const saved = (await db`select next_block::text as n from indexer_cursors where name = ${CURSOR}`) as { n: string }[]
        const next = saved[0] ? BigInt(saved[0].n) : watched.fromBlock
        if (next > head) {
          await sleep(5_000)
          continue
        }
        const to = next + range - 1n > head ? head : next + range - 1n
        try {
          await scanContracts(watched, next, to)
        } catch (error) {
          const kind = classifyRpcError(error)
          if (kind === 'range_too_large' && range > 250n) range = range / 2n
          await sleep(kind === 'rate_limited' ? 3_000 : 2_000)
          continue
        }
        await db`
          insert into indexer_cursors (name, next_block) values (${CURSOR}, ${(to + 1n).toString()}::bigint)
          on conflict (name) do update set next_block = excluded.next_block, updated_at = now()`
        if (range < 5000n) range = range * 2n > 5000n ? 5000n : range * 2n
        // Caught up: poll the tip gently. Behind: keep going, the RPC runner already spaces calls out.
        if (to >= head) await sleep(4_000)
      } catch (error) {
        console.error('[events] loop error', (error as Error).message)
        await sleep(4_000)
      }
    }
  })()
}

export async function contractIndexStatus(): Promise<{ nextBlock: number | null; events: number }> {
  const db = requireDb()
  const cur = (await db`select next_block::text as n from indexer_cursors where name = ${CURSOR}`) as { n: string }[]
  const count = (await db`select count(*)::int as n from contract_events where chain_id = ${config.chainId}`) as { n: number }[]
  return { nextBlock: cur[0] ? Number(cur[0].n) : null, events: count[0]?.n ?? 0 }
}
