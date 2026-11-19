import { requireDb, HttpError } from './db'
import { config } from './env'
import { TYPE_SQL } from './protocols'
import { getHead } from './indexer'
import type { Analytics, HistoryRow } from '../shared/api-types'

export type { Analytics, HistoryRow }

export interface HistoryCursor {
  block: string
  logIndex: number
}

export interface HistoryFilters {
  address: string
  direction: 'all' | 'in' | 'out'
  type: 'all' | 'transfer' | 'request_payment' | 'swap' | 'bridge'
  status?: 'all' | 'confirmed' | 'pending' | 'failed'
  q: string
  since?: Date
  until?: Date
  /** Keyset position: rows strictly older than this (block, log index). Wins over `page`. */
  cursor?: HistoryCursor | null
  page: number
  pageSize: number
}

export const encodeCursor = (c: HistoryCursor) => Buffer.from(`${c.block}:${c.logIndex}`).toString('base64url')

export function decodeCursor(text: string): HistoryCursor {
  const plain = Buffer.from(text, 'base64url').toString('utf8')
  const m = /^(\d{1,15}):(\d{1,9})$/.exec(plain)
  if (!m) throw new HttpError(400, 'bad_cursor', 'Invalid page cursor.')
  return { block: m[1], logIndex: Number(m[2]) }
}


/**
 * A wallet's coverage is the block interval ITS indexer scanned. Rows the table holds from scans of other
 * wallets outside that interval are not shown or counted, so what the list says it covers is what it covers.
 * An unregistered wallet has no interval and therefore no rows.
 */
export const SCANNED_SQL = (blockColumn: string, addressParam: string) =>
  `${blockColumn} between (select oldest_scanned from wallets where address = ${addressParam}) and (select newest_scanned from wallets where address = ${addressParam})`

const HEX_PREFIX = /^0x[0-9a-f]{1,64}$/

/** Builds a parameterized WHERE clause. Values are never interpolated into SQL text. */
export function buildWhere(f: HistoryFilters, withCursor = true): { text: string; params: unknown[] } {
  const params: unknown[] = [f.address]
  const clauses = [`t.chain_id = ${config.chainId}`, '(t.from_addr = $1 or t.to_addr = $1)', SCANNED_SQL('t.block_number', '$1')]
  const add = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (f.direction === 'in') clauses.push('(t.to_addr = $1 and t.from_addr <> $1)')
  if (f.direction === 'out') clauses.push('(t.from_addr = $1 and t.to_addr <> $1)')
  if (f.type !== 'all') clauses.push(`${TYPE_SQL('$1')} = '${f.type}'`)
  if (withCursor && f.cursor) clauses.push(`(t.block_number, t.log_index) < (${add(f.cursor.block)}::bigint, ${add(f.cursor.logIndex)}::int)`)
  if (f.since) clauses.push(`t.block_time >= ${add(f.since)}`)
  if (f.until) clauses.push(`t.block_time <= ${add(f.until)}`)
  const q = f.q.trim().toLowerCase()
  if (q) {
    if (!HEX_PREFIX.test(q)) throw new HttpError(400, 'bad_query', 'Search by transaction hash or address (0x…).')
    const p = add(`${q}%`)
    clauses.push(`(t.tx_hash like ${p} or t.from_addr like ${p} or t.to_addr like ${p})`)
  }
  return { text: clauses.join(' and '), params }
}

const FROM = 'from transfers t left join payment_requests r on r.paid_tx_hash = t.tx_hash'

const KIND_TYPE: Record<string, HistoryRow['type']> = { send: 'transfer', pay_request: 'request_payment', split: 'request_payment', swap: 'swap', bridge: 'bridge' }

const SELECT_ROW = `t.tx_hash, t.log_index, t.block_number::text as block_number, t.block_time, t.from_addr, t.to_addr, t.token, t.amount::text as amount,
            case when t.from_addr = t.to_addr then 'self' when t.from_addr = $1 then 'out' else 'in' end as direction,
            ${TYPE_SQL('$1')} as type, r.id as request_id,
            (select m.tx_to from tx_meta m where m.chain_id = t.chain_id and m.tx_hash = t.tx_hash) as contract`

/** The default view (no type, text or date filter) needs no join to decide which rows to take: it is two index walks. */
const isFastPath = (f: HistoryFilters) => f.type === 'all' && !f.q.trim() && !f.since && !f.until

/** Transfer rows, newest first, one more than a page so the caller knows whether another page exists. */
async function transferRows(f: HistoryFilters, head: bigint): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const db = requireDb()
  const take = f.pageSize + 1
  const offset = f.cursor ? 0 : (f.page - 1) * f.pageSize
  let text: string
  let params: unknown[]
  if (isFastPath(f)) {
    params = [f.address]
    const add = (value: unknown) => {
      params.push(value)
      return `$${params.length}`
    }
    const cursor = f.cursor ? `and (t.block_number, t.log_index) < (${add(f.cursor.block)}::bigint, ${add(f.cursor.logIndex)}::int)` : ''
    const inner = add(take + offset)
    const side = (column: 'from_addr' | 'to_addr', extra: string) =>
      `(select t.* from transfers t where t.chain_id = ${config.chainId} and t.${column} = $1 ${extra} and ${SCANNED_SQL('t.block_number', '$1')} ${cursor} order by t.block_number desc, t.log_index desc limit ${inner})`
    const sides = f.direction === 'in' ? [side('to_addr', 'and t.from_addr <> $1')] : f.direction === 'out' ? [side('from_addr', 'and t.to_addr <> $1')] : [side('from_addr', ''), side('to_addr', 'and t.from_addr <> $1')]
    text = `select ${SELECT_ROW} from (${sides.join(' union all ')}) t left join payment_requests r on r.paid_tx_hash = t.tx_hash
            order by t.block_number desc, t.log_index desc limit ${add(take)} offset ${add(offset)}`
  } else {
    const w = buildWhere(f)
    params = [...w.params, take, offset]
    text = `select ${SELECT_ROW} ${FROM} where ${w.text} order by t.block_number desc, t.log_index desc limit $${w.params.length + 1} offset $${w.params.length + 2}`
  }
  const raw = (await db.unsafe(text, params)) as Record<string, unknown>[]
  const rows = raw.slice(0, f.pageSize).map(
    (r): HistoryRow => ({
      txHash: r.tx_hash as string,
      logIndex: r.log_index as number,
      blockNumber: Number(r.block_number),
      timestamp: new Date(r.block_time as string).toISOString(),
      from: r.from_addr as string,
      to: r.to_addr as string,
      token: r.token as string,
      amount: r.amount as string,
      direction: r.direction as HistoryRow['direction'],
      type: r.type as HistoryRow['type'],
      requestId: (r.request_id as string | null) ?? null,
      contract: (r.contract as string | null) ?? null,
      confirmations: Math.max(0, Number(head) - Number(r.block_number)),
      status: 'confirmed',
    }),
  )
  return { rows, more: raw.length > f.pageSize }
}

/**
 * Transactions this wallet signed that the chain scan does not list: still waiting for a receipt (pending), reverted
 * (failed: a revert writes no logs), or confirmed without a USDC transfer. Each status comes from the receipt the
 * reconciliation worker read. Once the scan lists the same transaction hash the scanned row wins, so nothing doubles.
 */
async function pendingRows(f: HistoryFilters): Promise<HistoryRow[]> {
  if (f.direction === 'in' || f.cursor || f.page > 1) return []
  const db = requireDb()
  const status = f.status && f.status !== 'all' ? f.status : null
  const q = f.q.trim().toLowerCase()
  const raw = (await db`
    select p.tx_hash, p.kind, p.to_addr, p.token, p.amount::text as amount, p.symbol, p.decimals, p.status, p.block_number::text as block_number, p.created_at
    from pending_txs p
    where p.chain_id = ${config.chainId} and p.wallet = ${f.address} and p.status in ('pending', 'failed', 'confirmed')
      and p.created_at > now() - interval '14 days'
      and (${status}::text is null or p.status = ${status}::text)
      and (${q}::text = '' or p.tx_hash like ${`${q}%`})
      and not exists (select 1 from transfers t where t.chain_id = p.chain_id and t.tx_hash = p.tx_hash)
    order by p.created_at desc limit 20`) as Record<string, unknown>[]
  return raw
    .map((r): HistoryRow => {
      const usdc = (r.token as string) === config.usdc
      return {
        txHash: r.tx_hash as string,
        logIndex: -2,
        blockNumber: r.block_number ? Number(r.block_number) : 0,
        timestamp: new Date(r.created_at as string).toISOString(),
        from: f.address,
        to: r.to_addr as string,
        token: r.token as string,
        amount: r.amount as string,
        symbol: usdc ? null : ((r.symbol as string | null) ?? null),
        decimals: usdc ? null : ((r.decimals as number | null) ?? null),
        direction: 'out',
        type: KIND_TYPE[r.kind as string] ?? 'transfer',
        requestId: null,
        contract: null,
        confirmations: 0,
        status: r.status as HistoryRow['status'],
        local: true,
      }
    })
    .filter((row) => f.type === 'all' || row.type === f.type)
}

const FIRST_PAGE_COUNT_TTL_MS = 30_000
const ROWS_TTL_MS = 1_500
const countCache = new Map<string, { at: number; n: number }>()
const rowsCache = new Map<string, { at: number; value: HistoryResult }>()
const inflight = new Map<string, Promise<HistoryResult>>()

export interface HistoryResult {
  rows: HistoryRow[]
  total: number
  /** Opaque keyset position of the next (older) page; null on the last page. */
  nextCursor: string | null
}

const keyOf = (f: HistoryFilters, withPaging: boolean) =>
  JSON.stringify([f.address, f.direction, f.type, f.status ?? 'all', f.q, f.since?.toISOString(), f.until?.toISOString(), ...(withPaging ? [f.cursor?.block, f.cursor?.logIndex, f.page, f.pageSize] : [])])

/** Count with a short cache: counting every page view is the expensive part of a long history, and it changes slowly. */
async function countRows(f: HistoryFilters): Promise<number> {
  const key = keyOf(f, false)
  const hit = countCache.get(key)
  if (hit && Date.now() - hit.at < FIRST_PAGE_COUNT_TTL_MS) return hit.n
  const db = requireDb()
  const w = buildWhere(f, false)
  const counted = (await db.unsafe(`select count(*)::text as n ${FROM} where ${w.text}`, w.params)) as { n: string }[]
  const n = Number(counted[0]?.n ?? 0)
  if (countCache.size > 2000) countCache.clear()
  countCache.set(key, { at: Date.now(), n })
  return n
}

async function compute(f: HistoryFilters): Promise<HistoryResult> {
  const status = f.status ?? 'all'
  const head = await getHead()
  const pending = status === 'confirmed' ? [] : await pendingRows(f)
  if (status === 'pending' || status === 'failed') return { rows: pending, total: pending.length, nextCursor: null }
  // Pending rows share the page: the list never grows past the size that was asked for.
  const [{ rows, more }, total] = await Promise.all([transferRows({ ...f, pageSize: Math.max(1, f.pageSize - pending.length) }, head), countRows(f)])
  const last = rows[rows.length - 1]
  return { rows: [...pending, ...rows], total: total + (f.cursor || f.page > 1 ? 0 : pending.length), nextCursor: more && last ? encodeCursor({ block: String(last.blockNumber), logIndex: last.logIndex }) : null }
}

/** Newest first, from the database only. Identical reads inside a moment share one answer (and one query). */
export async function queryHistory(f: HistoryFilters): Promise<HistoryResult> {
  const key = keyOf(f, true)
  const hit = rowsCache.get(key)
  if (hit && Date.now() - hit.at < ROWS_TTL_MS) return hit.value
  const running = inflight.get(key)
  if (running) return running
  const promise = compute(f)
    .then((value) => {
      if (rowsCache.size > 500) rowsCache.clear()
      rowsCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

const csvCell = (value: string | number) => {
  const text = String(value)
  return /^[=+\-@]/.test(text) || /[",\n]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` : text
}

function formatUsdc(raw: string): string {
  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).padStart(7, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -6)}.${digits.slice(-6)}`
}

export async function exportCsv(f: HistoryFilters): Promise<string> {
  const { rows } = await queryHistory({ ...f, page: 1, pageSize: 50_000 })
  const head = 'timestamp,tx_hash,block_number,direction,type,from,to,token,amount_usdc,confirmations,status'
  const lines = rows.map((r) =>
    [r.timestamp, r.txHash, r.blockNumber, r.direction, r.type, r.from, r.to, r.token, formatUsdc(r.amount), r.confirmations, r.status].map(csvCell).join(','),
  )
  return [head, ...lines].join('\n') + '\n'
}


export async function queryAnalytics(address: string): Promise<Analytics> {
  const db = requireDb()
  const totals = (await db`
    select
      coalesce(sum(amount) filter (where from_addr = ${address} and to_addr <> ${address}), 0)::text as sent,
      coalesce(sum(amount) filter (where to_addr = ${address} and from_addr <> ${address}), 0)::text as received,
      count(*)::text as n,
      count(*) filter (where from_addr = ${address} and to_addr <> ${address})::text as sent_n,
      count(*) filter (where to_addr = ${address} and from_addr <> ${address})::text as received_n,
      min(block_time) as first_at, max(block_time) as last_at
    from transfers where chain_id = ${config.chainId} and (from_addr = ${address} or to_addr = ${address})
      and block_number between (select oldest_scanned from wallets where address = ${address}) and (select newest_scanned from wallets where address = ${address})`) as Record<string, string | Date | null>[]
  const monthly = (await db`
    select to_char(date_trunc('month', block_time at time zone 'UTC'), 'YYYY-MM') as month,
      coalesce(sum(amount) filter (where from_addr = ${address} and to_addr <> ${address}), 0)::text as sent,
      coalesce(sum(amount) filter (where to_addr = ${address} and from_addr <> ${address}), 0)::text as received,
      count(*)::int as count
    from transfers where chain_id = ${config.chainId} and (from_addr = ${address} or to_addr = ${address})
      and block_number between (select oldest_scanned from wallets where address = ${address}) and (select newest_scanned from wallets where address = ${address})
    group by 1 order by 1 desc limit 12`) as Analytics['monthly']
  const breakdown = (await db.unsafe(
    `select ${TYPE_SQL('$1')} as type,
       case when t.from_addr = t.to_addr then 'self' when t.from_addr = $1 then 'out' else 'in' end as direction,
       count(*)::int as count, coalesce(sum(t.amount), 0)::text as amount
     from transfers t left join payment_requests r on r.paid_tx_hash = t.tx_hash
     where t.chain_id = ${config.chainId} and (t.from_addr = $1 or t.to_addr = $1) and ${SCANNED_SQL('t.block_number', '$1')}
     group by 1, 2 order by 3 desc`,
    [address],
  )) as Analytics['breakdown']
  const top = (await db`
    select case when from_addr = ${address} then to_addr else from_addr end as address,
      count(*)::int as count, coalesce(sum(amount), 0)::text as amount
    from transfers where chain_id = ${config.chainId} and (from_addr = ${address} or to_addr = ${address}) and from_addr <> to_addr
      and block_number between (select oldest_scanned from wallets where address = ${address}) and (select newest_scanned from wallets where address = ${address})
    group by 1 order by sum(amount) desc limit 5`) as Analytics['topCounterparties']
  const t = totals[0] ?? {}
  return {
    totalSent: String(t.sent ?? '0'),
    totalReceived: String(t.received ?? '0'),
    transactionCount: Number(t.n ?? 0),
    sentCount: Number(t.sent_n ?? 0),
    receivedCount: Number(t.received_n ?? 0),
    firstActivity: t.first_at ? new Date(t.first_at as string).toISOString() : null,
    lastActivity: t.last_at ? new Date(t.last_at as string).toISOString() : null,
    monthly,
    breakdown,
    topCounterparties: top,
  }
}
