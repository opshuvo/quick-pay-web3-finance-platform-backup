import { useQuery } from '@tanstack/react-query'
import type { Analytics, Coverage, HistoryRow } from '../../shared/api-types'
import { api } from '@/lib/api'
import { retryDelay } from '@/lib/arcRpc'
import { chainAnalytics, chainHistoryPage } from '@/lib/chainHistory/read'
import { historyServerUsable } from '@/lib/chainHistory/mode'

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
  since: string
  until: string
  page: number
  pageSize: number
}

export const DEFAULT_FILTERS: HistoryFilters = { q: '', direction: 'all', type: 'all', since: '', until: '', page: 1, pageSize: 25 }

export interface HistoryResponse {
  rows: HistoryRow[]
  total: number
  page: number
  pageSize: number
  coverage: Coverage
}

export function historyQuery(filters: HistoryFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.direction !== 'all') params.set('direction', filters.direction)
  if (filters.type !== 'all') params.set('type', filters.type)
  if (filters.since) params.set('since', new Date(`${filters.since}T00:00:00`).toISOString())
  if (filters.until) params.set('until', new Date(`${filters.until}T23:59:59`).toISOString())
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  return params.toString()
}

/** `background`: a read nobody is watching closely (the notification bell), so it polls slowly and leaves the CPU to the screen. */
export function useHistory(address: string | undefined, filters: HistoryFilters, options: { background?: boolean } = {}) {
  return useQuery<HistoryResponse>({
    queryKey: ['history', address, filters],
    enabled: Boolean(address),
    placeholderData: (previous) => previous,
    retry: 2,
    retryDelay,
    // Poll faster while the indexer is still catching up so progress is visible. A failed read is retried automatically.
    refetchInterval: (query) => query.state.status === 'error' ? RETRY_WHEN_FAILED_MS : options.background ? BACKGROUND_POLL_MS : pollMs(query.state.data?.coverage.status, query.state.data?.coverage.source === 'browser' ? 4_000 : 6_000, query.state.data?.coverage.source === 'browser' ? 10_000 : 30_000),
    // With a history server the server answers. Without one, this device reads Arc directly.
    queryFn: async ({ signal }) => ((await historyServerUsable()) ? readWithRegistration<HistoryResponse>(address ?? '', `/history/${address}?${historyQuery(filters)}`, signal) : chainHistoryPage(address ?? '', filters)),
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
