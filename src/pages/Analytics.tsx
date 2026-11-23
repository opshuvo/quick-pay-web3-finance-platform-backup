import { Activity, ArrowDownLeft, ArrowUpRight, TrendingUp, type LucideIcon } from 'lucide-react'
import { CoverageNotice } from '@/components/Coverage'
import { MonthlyChart } from '@/components/MonthlyChart'
import { AddressChip, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useAnalytics } from '@/hooks/useHistory'
import { isRpcUnavailable, isServiceDown } from '@/lib/api'
import { displayUsdc, formatNumber } from '@/lib/format'

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: LucideIcon; tone?: 'success' }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="header-card-label">{label}</p>
        <span className="stat-icon" data-tone={tone}><Icon className="size-4" aria-hidden /></span>
      </div>
      <p className="display mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{sub}</p>}
    </div>
  )
}

const TYPE_LABEL: Record<string, string> = { transfer: 'Transfers', request_payment: 'Request payments' }
const DIR_LABEL: Record<string, string> = { in: 'received', out: 'sent', self: 'self transfers' }

export default function Analytics() {
  const { address, isConnected } = useArcWallet()
  const query = useAnalytics(address)

  if (!isConnected || !address) {
    return (
      <div>
        <PageHeader title="Analytics" subtitle="Statistics computed from your indexed Arc transactions." />
        <div className="card"><EmptyState title="Connect a wallet" body="Analytics are calculated from your own wallet's activity." action={<WalletButton />} /></div>
      </div>
    )
  }
  if (query.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>
  if (query.isError || !query.data) {
    return <div className="card"><ErrorState title="Analytics unavailable" body={isRpcUnavailable(query.error) ? 'Arc\'s RPC is not answering right now, so statistics cannot be calculated yet. Quick Pay is retrying automatically.' : isServiceDown(query.error) ? 'The history service is not reachable, so statistics cannot be calculated right now.' : 'Could not load analytics.'} onRetry={() => void query.refetch()} /></div>
  }

  const a = query.data
  const complete = a.coverage.status === 'complete'

  return (
    <div className="space-y-6 lg:space-y-8">
      <PageHeader title="Analytics" subtitle="Calculated from USDC transfers indexed from Arc for your wallet. No estimates." />
      <CoverageNotice coverage={a.coverage} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={ArrowUpRight} label={complete ? 'Total sent' : 'Sent so far'} value={`${displayUsdc(BigInt(a.totalSent))}`} sub={`${formatNumber(a.sentCount)} payments · USDC`} />
        <Stat icon={ArrowDownLeft} tone="success" label={complete ? 'Total received' : 'Received so far'} value={`${displayUsdc(BigInt(a.totalReceived))}`} sub={`${formatNumber(a.receivedCount)} payments · USDC`} />
        <Stat icon={Activity} label="Transactions" value={formatNumber(a.transactionCount)} sub={complete ? 'USDC token transfers' : 'In scanned range only'} />
        <Stat icon={TrendingUp} tone="success" label="Net flow" value={`${BigInt(a.totalReceived) - BigInt(a.totalSent) < 0n ? '' : '+'}${displayUsdc(BigInt(a.totalReceived) - BigInt(a.totalSent))}`} sub={complete ? 'Received minus sent' : 'Incomplete until backfill ends'} />
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="display mb-1 text-lg font-semibold">Monthly activity</h2>
        <p className="mb-5 text-sm" style={{ color: 'var(--muted)' }}>USDC sent and received per month, from indexed transfers.</p>
        {a.monthly.length === 0 ? (
          <EmptyState title="No monthly data yet" body={complete ? 'This wallet has no USDC transfers.' : 'No activity found in the blocks scanned so far.'} />
        ) : (
          <MonthlyChart points={a.monthly} />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="display mb-3 text-lg font-semibold">Payment breakdown</h2>
          {a.breakdown.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No data.</p> : (
            <ul className="divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
              {a.breakdown.map((b) => (
                <li key={`${b.type}-${b.direction}`} className="flex items-center justify-between py-2.5">
                  <span>{TYPE_LABEL[b.type] ?? b.type} {DIR_LABEL[b.direction] ?? b.direction}<span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>{b.count}×</span></span>
                  <span className="tabular-nums font-semibold">{displayUsdc(BigInt(b.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="display mb-3 text-lg font-semibold">Top counterparties</h2>
          {a.topCounterparties.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No data.</p> : (
            <ul className="divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
              {a.topCounterparties.map((c) => (
                <li key={c.address} className="flex items-center justify-between py-2.5">
                  <AddressChip address={c.address} />
                  <span className="tabular-nums"><span className="mr-2 text-xs" style={{ color: 'var(--muted)' }}>{c.count}×</span><span className="font-semibold">{displayUsdc(BigInt(c.amount))}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>Amounts are in USDC (6-decimal ERC-20 view). Native-value transfers are not counted.</p>
    </div>
  )
}
