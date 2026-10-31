import { requireDb, HttpError } from './db'
import { TYPE_SQL } from './protocols'
import { getHead } from './indexer'
import type { Analytics, HistoryRow } from '../shared/api-types'

export type { Analytics, HistoryRow }

export interface HistoryFilters {
  address: string
  direction: 'all' | 'in' | 'out'
  type: 'all' | 'transfer' | 'request_payment' | 'swap' | 'bridge'
  q: string
  since?: Date
  until?: Date
  page: number
  pageSize: number
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
export function buildWhere(f: HistoryFilters): { text: string; params: unknown[] } {
  const params: unknown[] = [f.address]
  const clauses = ['(t.from_addr = $1 or t.to_addr = $1)', SCANNED_SQL('t.block_number', '$1')]
  const add = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (f.direction === 'in') clauses.push('(t.to_addr = $1 and t.from_addr <> $1)')
  if (f.direction === 'out') clauses.push('(t.from_addr = $1 and t.to_addr <> $1)')
  if (f.type !== 'all') clauses.push(`${TYPE_SQL('$1')} = '${f.type}'`)
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

export async function queryHistory(f: HistoryFilters): Promise<{ rows: HistoryRow[]; total: number }> {
  const db = requireDb()
  const w = buildWhere(f)
  const head = await getHead()
  const limit = `$${w.params.length + 1}`
  const offset = `$${w.params.length + 2}`
  const raw = (await db.unsafe(
    `select t.tx_hash, t.log_index, t.block_number::text as block_number, t.block_time, t.from_addr, t.to_addr, t.token, t.amount::text as amount,
            case when t.from_addr = t.to_addr then 'self' when t.from_addr = $1 then 'out' else 'in' end as direction,
            ${TYPE_SQL('$1')} as type, r.id as request_id
     ${FROM} where ${w.text}
     order by t.block_number desc, t.log_index desc limit ${limit} offset ${offset}`,
    [...w.params, f.pageSize, (f.page - 1) * f.pageSize],
  )) as Record<string, unknown>[]
  const counted = (await db.unsafe(`select count(*)::text as n ${FROM} where ${w.text}`, w.params)) as { n: string }[]
  const rows = raw.map(
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
      confirmations: Math.max(0, Number(head) - Number(r.block_number)),
      status: 'confirmed',
    }),
  )
  return { rows, total: Number(counted[0]?.n ?? 0) }
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
    from transfers where (from_addr = ${address} or to_addr = ${address})
      and block_number between (select oldest_scanned from wallets where address = ${address}) and (select newest_scanned from wallets where address = ${address})`) as Record<string, string | Date | null>[]
  const monthly = (await db`
    select to_char(date_trunc('month', block_time at time zone 'UTC'), 'YYYY-MM') as month,
      coalesce(sum(amount) filter (where from_addr = ${address} and to_addr <> ${address}), 0)::text as sent,
      coalesce(sum(amount) filter (where to_addr = ${address} and from_addr <> ${address}), 0)::text as received,
      count(*)::int as count
    from transfers where (from_addr = ${address} or to_addr = ${address})
      and block_number between (select oldest_scanned from wallets where address = ${address}) and (select newest_scanned from wallets where address = ${address})
    group by 1 order by 1 desc limit 12`) as Analytics['monthly']
  const breakdown = (await db.unsafe(
    `select ${TYPE_SQL('$1')} as type,
       case when t.from_addr = t.to_addr then 'self' when t.from_addr = $1 then 'out' else 'in' end as direction,
       count(*)::int as count, coalesce(sum(t.amount), 0)::text as amount
     from transfers t left join payment_requests r on r.paid_tx_hash = t.tx_hash
     where (t.from_addr = $1 or t.to_addr = $1) and ${SCANNED_SQL('t.block_number', '$1')}
     group by 1, 2 order by 3 desc`,
    [address],
  )) as Analytics['breakdown']
  const top = (await db`
    select case when from_addr = ${address} then to_addr else from_addr end as address,
      count(*)::int as count, coalesce(sum(amount), 0)::text as amount
    from transfers where (from_addr = ${address} or to_addr = ${address}) and from_addr <> to_addr
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
