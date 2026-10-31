import { useQuery } from '@tanstack/react-query'
import type { Analytics, Coverage, HistoryRow } from '../../shared/api-types'
import { api } from '@/lib/api'

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

export function useHistory(address: string | undefined, filters: HistoryFilters) {
  return useQuery<HistoryResponse>({
    queryKey: ['history', address, filters],
    enabled: Boolean(address),
    placeholderData: (previous) => previous,
    retry: 1,
    // Poll faster while the indexer is still catching up so progress is visible.
    refetchInterval: (query) => pollMs(query.state.data?.coverage.status, 6_000, 30_000),
    queryFn: ({ signal }) => readWithRegistration<HistoryResponse>(address ?? '', `/history/${address}?${historyQuery(filters)}`, signal),
  })
}

export function useAnalytics(address: string | undefined) {
  return useQuery<Analytics & { coverage: Coverage }>({
    queryKey: ['history', 'analytics', address],
    enabled: Boolean(address),
    retry: 1,
    refetchInterval: (query) => pollMs(query.state.data?.coverage.status, 10_000, 60_000),
    queryFn: ({ signal }) => readWithRegistration<Analytics & { coverage: Coverage }>(address ?? '', `/analytics/${address}`, signal),
  })
}
