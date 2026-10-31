import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import { HistoryHint } from '@/components/Coverage'
import { TxDetailSheet } from '@/components/TxDetailSheet'
import { TxRow } from '@/components/TxRow'
import { EmptyState, ErrorState, Notice, PageHeader, Skeleton, Spinner } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { DEFAULT_FILTERS, historyQuery, useHistory, type HistoryFilters, type HistoryRow } from '@/hooks/useHistory'
import { isServiceDown } from '@/lib/api'
import { formatNumber } from '@/lib/format'

export type ExplorerTab = 'all' | 'out' | 'in' | 'swap' | 'bridge'

const TABS: { id: ExplorerTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'out', label: 'Sent' },
  { id: 'in', label: 'Received' },
  { id: 'swap', label: 'Swap' },
  { id: 'bridge', label: 'Bridge' },
]

const TAB_FILTERS: Record<ExplorerTab, Pick<HistoryFilters, 'direction' | 'type'>> = {
  all: { direction: 'all', type: 'all' },
  out: { direction: 'out', type: 'all' },
  in: { direction: 'in', type: 'all' },
  swap: { direction: 'all', type: 'swap' },
  bridge: { direction: 'all', type: 'bridge' },
}

interface Props {
  title: string
  subtitle: string
  /** Lock the view to one tab (used by the Sent and Received pages). */
  lockedTab?: ExplorerTab
}

/** Searchable, filterable, paginated transfer list backed by the existing history service. */
export function TransferExplorer({ title, subtitle, lockedTab }: Props) {
  const { address, isConnected } = useArcWallet()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<ExplorerTab>(lockedTab ?? 'all')
  const [filters, setFilters] = useState<HistoryFilters>(() => ({ ...DEFAULT_FILTERS, ...TAB_FILTERS[lockedTab ?? 'all'], q: (params.get('q') ?? '').trim().toLowerCase() }))
  const [search, setSearch] = useState(filters.q)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState<HistoryRow | null>(null)
  const query = useHistory(address, filters)
  const set = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }))

  function selectTab(next: ExplorerTab) {
    setTab(next)
    set(TAB_FILTERS[next])
  }

  async function exportCsv() {
    if (!address) return
    setExporting(true)
    try {
      const response = await fetch(`/api/history/${address}?${historyQuery(filters, { format: 'csv' })}`)
      if (!response.ok) throw new Error('export failed')
      const url = URL.createObjectURL(await response.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `quickpay-${lockedTab ?? tab}-${address.slice(0, 8)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not export the CSV right now.')
    } finally {
      setExporting(false)
    }
  }

  if (!isConnected || !address) {
    return (
      <div>
        <PageHeader title={title} subtitle={subtitle} />
        <div className="card"><EmptyState title="Connect a wallet" body="Transactions are looked up by your wallet address." action={<WalletButton />} /></div>
      </div>
    )
  }

  const data = query.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const activeTab = lockedTab ?? tab

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <button className="btn btn-ghost shrink-0" onClick={() => void exportCsv()} disabled={exporting || !data || data.total === 0}>
            {exporting ? <Spinner /> : <Download className="size-4" />} <span className="hidden sm:inline">Export CSV</span>
          </button>
        }
      />
      {data && <div className="mb-3"><HistoryHint coverage={data.coverage} /></div>}

      <div className="card mb-4 space-y-3 p-3 sm:p-4">
        {!lockedTab && (
          <div className="segmented" role="tablist" aria-label="Transaction type">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="seg-item" onClick={() => selectTab(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            set({ q: search.trim().toLowerCase() })
          }}
        >
          <label className="relative">
            <span className="sr-only">Search by transaction hash or address</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
            <input className="field mono !pl-10" placeholder="Search tx hash or wallet address (0x…)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <input aria-label="From date" type="date" className="field sm:w-40" value={filters.since} onChange={(e) => set({ since: e.target.value })} />
          <input aria-label="To date" type="date" className="field sm:w-40" value={filters.until} onChange={(e) => set({ until: e.target.value })} />
        </form>
        {filters.q && (
          <p className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="min-w-0 truncate">Filtering by <span className="mono">{filters.q}</span></span>
            <button className="font-semibold underline" onClick={() => { setSearch(''); set({ q: '' }) }}>Clear</button>
          </p>
        )}
        {(activeTab === 'swap' || activeTab === 'bridge') && (
          <Notice tone="info">{activeTab === 'swap' ? 'Swaps are detected from transfers with known Uniswap contracts on Arc.' : 'Bridges are detected from transfers with the Across contract on Arc.'} Some routes, such as swaps through v3 pools or inbound bridge fills, may not be labelled and will appear under All.</Notice>
        )}
      </div>

      <div className="card px-2 py-1 sm:px-4">
        {query.isLoading ? (
          <div className="space-y-3 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : query.isError ? (
          <ErrorState
            title={isServiceDown(query.error) ? 'History service unavailable' : 'Could not load transactions'}
            body={isServiceDown(query.error) ? 'The Quick Pay indexer or its database is not reachable, so nothing is shown. Nothing is lost: history is rebuilt from the chain.' : (query.error).message}
            onRetry={() => void query.refetch()}
          />
        ) : data && data.rows.length === 0 ? (
          <EmptyState
            title={data.coverage.status === 'complete' ? 'No transactions found' : 'Nothing found so far'}
            body={data.coverage.status === 'complete' ? 'No USDC token transfers match these filters for this wallet. Native-value transfers, pending and failed transactions are not indexed.' : 'The indexer is still scanning older blocks. Matching transactions may appear as the backfill progresses.'}
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data?.rows.map((row) => <TxRow key={`${row.txHash}-${row.logIndex}`} row={row} onSelect={setSelected} />)}
          </ul>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--muted)' }}>
          <span>{formatNumber(data.total)} transactions · page {data.page} of {formatNumber(pages)}</span>
          <div className="flex gap-2">
            <button className="btn btn-ghost !px-3" aria-label="Previous page" disabled={filters.page <= 1} onClick={() => set({ page: filters.page - 1 })}><ChevronLeft className="size-4" /></button>
            <button className="btn btn-ghost !px-3" aria-label="Next page" disabled={filters.page >= pages} onClick={() => set({ page: filters.page + 1 })}><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
      <TxDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
