import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { Analytics, Coverage, HistoryRow } from '../../shared/api-types'
import { api } from '@/lib/api'
import { retryDelay } from '@/lib/arcRpc'
import { chainAnalytics, chainHistoryPage } from '@/lib/chainHistory/read'
import { historyServerUsable } from '@/lib/chainHistory/mode'
import { rowsFromLedger } from '@/lib/chainHistory/derive'
import { ARC_USDC } from '@/lib/arc'
import { ledgerFor } from '@/lib/txLedger'

const REGISTER_RETRY_MS = 30_000
const registrations = new Map<string, Promise<void>>()

/**
 * Reads never register wallets. The first time the server reports an unregistered wallet, ask it to start indexing
 * through the existing rate-limited endpoint. One request per wallet is shared by every query, and a failure (for
 * example a busy indexer) is remembered briefly so polling cannot hammer the endpoint.
 */
function ensureIndexed(address: string): Promise<void> {
  const key = address.toLowerCase()
  let pending = registrations.get(key)
  if (!pending) {
    pending = api(`/index/${address}`, { method: 'POST' }).then(() => undefined)
    registrations.set(key, pending)
    const forget = () => setTimeout(() => registrations.delete(key), REGISTER_RETRY_MS)
    pending.then(forget, forget)
  }
  return pending
}

async function readWithRegistration<T extends { coverage: Coverage }>(address: string, path: string, signal?: AbortSignal): Promise<T> {
  const first = await api<T>(path, { signal })
  if (first.coverage.status !== 'unregistered') return first
  await ensureIndexed(address)
  return api<T>(path, { signal })
}

/** A failed read is retried twice with exponential backoff (see retryDelay), then every 10 seconds in the background. */
const RETRY_WHEN_FAILED_MS = 10_000
const BACKGROUND_POLL_MS = 20_000

const pollMs = (status: Coverage['status'] | undefined, fast: number, slow: number) => (status === 'indexing' || status === 'unregistered' ? fast : slow)

export type { Analytics, HistoryRow, Coverage }

export interface HistoryFilters {
  q: string
  direction: 'all' | 'in' | 'out'
  type: 'all' | 'transfer' | 'request_payment' | 'swap' | 'bridge'
  status: 'all' | 'confirmed' | 'pending' | 'failed'
  since: string
  until: string
  /** Keyset position from the server's `nextCursor`. When set, it decides which rows come next and `page` is only the label. */
  cursor: string
  page: number
  pageSize: number
}

export const DEFAULT_FILTERS: HistoryFilters = { q: '', direction: 'all', type: 'all', status: 'all', since: '', until: '', cursor: '', page: 1, pageSize: 20 }

export interface HistoryResponse {
  rows: HistoryRow[]
  total: number
  page: number
  pageSize: number
  /** Opaque position of the next (older) page, or null on the last page. Missing when the browser reads Arc directly. */
  nextCursor?: string | null
  coverage: Coverage
}

export function historyQuery(filters: HistoryFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.direction !== 'all') params.set('direction', filters.direction)
  if (filters.type !== 'all') params.set('type', filters.type)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.since) params.set('since', new Date(`${filters.since}T00:00:00`).toISOString())
  if (filters.until) params.set('until', new Date(`${filters.until}T23:59:59`).toISOString())
  if (filters.cursor) params.set('cursor', filters.cursor)
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  return params.toString()
}

const STORE_KEY = 'quickpay.history.v1'
const STORE_ENTRIES = 12
const STORE_MAX_ROWS = 40
interface Stored { at: number; data: HistoryResponse }

const storeSlot = (filters: HistoryFilters) => historyQuery({ ...filters, cursor: '', page: 1 })
/** Only a plain first page is worth keeping: it is what a screen shows before anything has loaded. */
const storable = (filters: HistoryFilters) => !filters.cursor && filters.page === 1 && filters.pageSize <= STORE_MAX_ROWS

function readStore(address: string): Record<string, Stored> {
  try {
    return JSON.parse(localStorage.getItem(`${STORE_KEY}:${address.toLowerCase()}`) ?? '{}') as Record<string, Stored>
  } catch {
    return {}
  }
}

/** The last answer this device received for this exact view, or nothing. Real rows from an earlier read, shown while the new read runs. */
export function storedHistory(address: string | undefined, filters: HistoryFilters): Stored | undefined {
  if (!address || !storable(filters)) return undefined
  const found = readStore(address)[storeSlot(filters)]
  return found && Array.isArray(found.data?.rows) ? found : undefined
}

export function rememberHistory(address: string, filters: HistoryFilters, data: HistoryResponse) {
  if (!storable(filters)) return
  try {
    const all = readStore(address)
    // Pending rows change within seconds, so they are never replayed from storage. Everything else is re-checked on arrival.
    all[storeSlot(filters)] = { at: Date.now(), data: { ...data, rows: data.rows.filter((r) => r.status === 'confirmed') } }
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, STORE_ENTRIES)
    localStorage.setItem(`${STORE_KEY}:${address.toLowerCase()}`, JSON.stringify(Object.fromEntries(keep)))
  } catch {
    // Storage full or unavailable: the screen simply loads normally.
  }
}

/**
 * While a new view loads, the rows of the view before it that already match are shown at once (the newest rows of a
 * narrower view are always the matching rows of a wider one). Searches and date ranges are never guessed.
 */
export function narrowRows(previous: HistoryResponse | undefined, from: HistoryFilters | undefined, to: HistoryFilters): HistoryResponse | undefined {
  if (!previous || !from || from.page !== 1 || from.cursor || to.page !== 1 || to.cursor) return undefined
  if (from.q || to.q || from.since || to.since || from.until || to.until) return undefined
  const widerOrSame = (a: string, b: string) => a === 'all' || a === b
  if (!widerOrSame(from.direction, to.direction) || !widerOrSame(from.type, to.type) || !widerOrSame(from.status, to.status)) return undefined
  const rows = previous.rows.filter((r) => (to.direction === 'all' || r.direction === to.direction) && (to.type === 'all' || r.type === to.type) && (to.status === 'all' || r.status === to.status))
  return rows.length === 0 ? undefined : { ...previous, rows, total: rows.length, page: 1, pageSize: to.pageSize, nextCursor: undefined }
}

/** The one definition of a history read, shared by the screens and by background prefetching. */
export function historyQueryOptions(address: string | undefined, filters: HistoryFilters) {
  return queryOptions<HistoryResponse>({
    queryKey: ['history', address, filters],
    // With a history server the server answers. Without one, this device reads Arc directly.
    queryFn: async ({ signal }) => {
      if (!(await historyServerUsable())) return chainHistoryPage(address ?? '', filters)
      const page = await readWithRegistration<HistoryResponse>(address ?? '', `/history/${address}?${historyQuery(filters)}`, signal)
      // The server saves pending transactions the moment they are sent and reconciles them with their receipts. A
      // transaction this device signed that the server has not recorded (it was offline or still unknown to the node) is
      // added from this device's own record, so a pending or failed payment never disappears. Same hash, never twice.
      let result = page
      if (!(filters.page > 1 || filters.cursor || filters.direction === 'in')) {
        const seen = new Set(page.rows.map((r) => r.txHash.toLowerCase()))
        const wanted = filters.status === 'all' ? (s: string) => s !== 'confirmed' : (s: string) => s === filters.status
        const q = filters.q.trim().toLowerCase()
        const local = rowsFromLedger(address ?? '', ARC_USDC.toLowerCase(), ledgerFor(address ?? '').filter((e) => !seen.has(e.hash) && wanted(e.status) && (!q || e.hash.startsWith(q))))
          .filter((r) => filters.type === 'all' || r.type === filters.type)
        if (local.length > 0) result = { ...page, rows: [...local, ...page.rows], total: page.total + local.length }
      }
      if (address && result.coverage.source !== 'browser') rememberHistory(address, filters, result)
      return result
    },
  })
}

/** Warms the cache for views the user is likely to open next, so they open without a wait. Cheap: the server answers from its database. */
export function prefetchHistory(client: QueryClient, address: string | undefined, filters: HistoryFilters) {
  if (!address) return
  void client.prefetchQuery({ ...historyQueryOptions(address, filters), staleTime: 5_000 })
}

/** `background`: a read nobody is watching closely (the notification bell), so it polls slowly and leaves the CPU to the screen. */
export function useHistory(address: string | undefined, filters: HistoryFilters, options: { background?: boolean } = {}) {
  const stored = storedHistory(address, filters)
  return useQuery<HistoryResponse>({
    ...historyQueryOptions(address, filters),
    enabled: Boolean(address),
    staleTime: 2_000,
    // Last answer from this device first (a reload shows rows at once), then the live read replaces it.
    initialData: stored?.data,
    initialDataUpdatedAt: stored?.at,
    // Changing a tab never blanks the list: matching rows from the view before stay, otherwise the previous list stays.
    placeholderData: (previous, previousQuery) => narrowRows(previous, (previousQuery?.queryKey[2] as HistoryFilters | undefined), filters) ?? (previousQuery && (previousQuery.queryKey[1] === address) && filters.page === 1 ? undefined : previous),
    retry: 2,
    retryDelay,
    // Poll faster while the indexer is still catching up so progress is visible. A failed read is retried automatically.
    refetchInterval: (query) => query.state.status === 'error' ? RETRY_WHEN_FAILED_MS : options.background ? BACKGROUND_POLL_MS : pollMs(query.state.data?.coverage.status, query.state.data?.coverage.source === 'browser' ? 4_000 : 6_000, query.state.data?.coverage.source === 'browser' ? 10_000 : 30_000),
  })
}

export function useAnalytics(address: string | undefined) {
  return useQuery<Analytics & { coverage: Coverage }>({
    queryKey: ['history', 'analytics', address],
    enabled: Boolean(address),
    retry: 2,
    retryDelay,
    refetchInterval: (query) => query.state.status === 'error' ? RETRY_WHEN_FAILED_MS : pollMs(query.state.data?.coverage.status, query.state.data?.coverage.source === 'browser' ? 5_000 : 10_000, query.state.data?.coverage.source === 'browser' ? 15_000 : 60_000),
    queryFn: async ({ signal }) => ((await historyServerUsable()) ? readWithRegistration<Analytics & { coverage: Coverage }>(address ?? '', `/analytics/${address}`, signal) : chainAnalytics(address ?? '')),
  })
}
