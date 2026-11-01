import { CoverageNotice } from '@/components/Coverage'
import { AddressChip, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useAnalytics } from '@/hooks/useHistory'
import { isRpcUnavailable, isServiceDown } from '@/lib/api'
import { displayUsdc, formatNumber } from '@/lib/format'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="display mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{sub}</p>}
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
  const max = a.monthly.reduce((m, x) => Math.max(m, Number(BigInt(x.sent) > BigInt(x.received) ? BigInt(x.sent) : BigInt(x.received))), 0)
  const months = [...a.monthly].reverse()

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Calculated from USDC transfers indexed from Arc for your wallet. No estimates." />
      <CoverageNotice coverage={a.coverage} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={complete ? 'Total sent' : 'Sent so far'} value={`${displayUsdc(BigInt(a.totalSent))}`} sub={`${formatNumber(a.sentCount)} payments · USDC`} />
        <Stat label={complete ? 'Total received' : 'Received so far'} value={`${displayUsdc(BigInt(a.totalReceived))}`} sub={`${formatNumber(a.receivedCount)} payments · USDC`} />
        <Stat label="Transactions" value={formatNumber(a.transactionCount)} sub={complete ? 'USDC token transfers' : 'In scanned range only'} />
        <Stat label="Net flow" value={`${BigInt(a.totalReceived) - BigInt(a.totalSent) < 0n ? '' : '+'}${displayUsdc(BigInt(a.totalReceived) - BigInt(a.totalSent))}`} sub={complete ? 'Received minus sent' : 'Incomplete until backfill ends'} />
      </div>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-lg font-semibold">Monthly activity</h2>
          <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />Sent</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--success)' }} />Received</span>
          </div>
        </div>
        {months.length === 0 ? (
          <EmptyState title="No monthly data yet" body={complete ? 'This wallet has no USDC transfers.' : 'No activity found in the blocks scanned so far.'} />
        ) : (
          <div className="flex h-48 items-end gap-2 overflow-x-auto" role="img" aria-label="Monthly sent and received USDC">
            {months.map((m) => {
              const h = (v: string) => (max === 0 ? 0 : Math.max(2, Math.round((Number(BigInt(v)) / max) * 150)))
              return (
                <div key={m.month} className="flex min-w-[44px] flex-1 flex-col items-center gap-1">
                  <div className="flex h-[150px] items-end gap-1">
                    <div title={`Sent ${displayUsdc(BigInt(m.sent))} USDC`} className="w-4 rounded-t-md" style={{ height: h(m.sent), background: 'var(--accent)' }} />
                    <div title={`Received ${displayUsdc(BigInt(m.received))} USDC`} className="w-4 rounded-t-md" style={{ height: h(m.received), background: 'var(--success)' }} />
                  </div>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{m.month.slice(2)}</span>
                  <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>{m.count} tx</span>
                </div>
              )
            })}
          </div>
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
