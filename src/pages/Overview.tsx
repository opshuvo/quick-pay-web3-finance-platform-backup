import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowLeftRight, FileText, ScanLine, Send, SplitSquareHorizontal, Waypoints } from 'lucide-react'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import { HistoryHint } from '@/components/Coverage'
import { FlowCard, RouterCard } from '@/components/dashboard'
import { MonthlyChart } from '@/components/MonthlyChart'
import { ActivityFeed, AddressRow, GlowBlobs, NetworkBadge, PrimaryActions, rise, SecondaryActions, TrendCard, VisibilityToggle } from '@/components/neon'
import { StatTile } from '@/components/StatTile'
import { TxDetailSheet } from '@/components/TxDetailSheet'
import { EmptyState, Skeleton, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useHealth } from '@/hooks/useHealth'
import { DEFAULT_FILTERS, useAnalytics, useHistory, type HistoryRow } from '@/hooks/useHistory'
import { loadSession, useSession } from '@/hooks/useSession'
import { displayUsdc, formatNumber } from '@/lib/format'
import { setPref, usePrefs } from '@/lib/prefs'
import { requestsApi, STATUS_LABEL, STATUS_TONE } from '@/lib/requests'
import type { SessionToken } from '../../shared/session'

const PRIMARY = [
  { to: '/send', label: 'Send', icon: Send },
  { to: '/receive', label: 'Receive', icon: ArrowDownLeft },
]
const SECONDARY = [
  { to: '/scan', label: 'Scan', icon: ScanLine },
  { to: '/split', label: 'Split', icon: SplitSquareHorizontal },
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { to: '/bridge', label: 'Bridge', icon: Waypoints },
]

/** One page of history feeds both the 24 hour trend and the activity feed. */
const FEED_SIZE = 100
const FEED_SHOWN = 25

export default function Overview() {
  const wallet = useArcWallet()
  const prefs = usePrefs()
  const health = useHealth()
  const history = useHistory(wallet.address, { ...DEFAULT_FILTERS, pageSize: FEED_SIZE })
  const stats = useAnalytics(wallet.address)
  const { ensureSession } = useSession()
  const [signed, setSigned] = useState<SessionToken | null>(null)
  const [selected, setSelected] = useState<HistoryRow | null>(null)
  const token = signed && signed.address === wallet.address?.toLowerCase() ? signed : wallet.address ? loadSession(wallet.address) : null
  const requests = useQuery({
    queryKey: ['requests', wallet.address, token?.signature],
    enabled: Boolean(token),
    retry: false,
    queryFn: async () => (await requestsApi.list(token as SessionToken)).requests,
  })

  const complete = stats.data?.coverage.status === 'complete'
  const suffix = complete ? '' : ' so far'
  const hidden = prefs.hideBalances

  return (
    <div className="relative isolate">
      <GlowBlobs />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {/* Header, balance and actions */}
          <section className="glass rise p-5 sm:p-7" style={rise(0)} aria-label="Balance">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="flex items-center gap-2.5 text-sm font-semibold">
                <TokenUSDC variant="branded" size={24} />
                <span className="display text-lg font-semibold">Available USDC</span>
              </h1>
              <NetworkBadge wrongNetwork={wallet.wrongNetwork} />
            </div>

            {!wallet.isConnected ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="display text-balance text-4xl font-bold sm:text-5xl">Pay anyone, <span className="gradient-text">instantly.</span></p>
                  <p className="mt-3 max-w-[46ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet to send and receive USDC on Arc, split bills, track every payment, and swap or bridge when you need to.</p>
                </div>
                <WalletButton />
              </div>
            ) : (
              <div className="mt-6">
                <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{hidden ? 'USDC hidden' : 'Showing USDC'}</p>
                <div className="mt-1 flex items-center gap-3">
                  {wallet.balanceLoading ? (
                    <Skeleton className="h-14 w-60" />
                  ) : wallet.balanceRaw !== undefined ? (
                    <span className="display text-5xl font-bold tabular-nums sm:text-6xl" style={{ color: 'var(--ink)' }}>{hidden ? '••••••' : displayUsdc(wallet.balanceRaw)}</span>
                  ) : (
                    <span className="display text-2xl font-bold" style={{ color: 'var(--muted)' }}>Balance unavailable</span>
                  )}
                  <VisibilityToggle hidden={hidden} onToggle={() => setPref('hideBalances', !hidden)} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {wallet.address && <AddressRow address={wallet.address} />}
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>This balance is also your gas on Arc</span>
                </div>
              </div>
            )}

            <div className="mt-7">
              <PrimaryActions actions={PRIMARY} />
              <SecondaryActions actions={SECONDARY} />
            </div>
          </section>

          <TrendCard rows={history.data?.rows} balanceRaw={wallet.balanceRaw} loading={wallet.isConnected && (history.isLoading || wallet.balanceLoading)} connected={wallet.isConnected} hidden={hidden} pageSize={FEED_SIZE} style={rise(1)} />

          <ActivityFeed address={wallet.address} rows={history.data?.rows.slice(0, FEED_SHOWN)} loading={history.isLoading} connected={wallet.isConnected} error={history.isError} onSelect={setSelected} style={rise(2)} />
          {stats.data && !complete && <HistoryHint coverage={stats.data.coverage} />}
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="rise" style={rise(1)}><FlowCard sent={stats.data?.totalSent} received={stats.data?.totalReceived} suffix={suffix} loading={wallet.isConnected && stats.isLoading} hidden={hidden} error={wallet.isConnected && stats.isError} /></div>
          <div className="rise grid grid-cols-2 gap-3" style={rise(2)}>
            <StatTile label="Transactions" loading={wallet.isConnected && stats.isLoading} value={wallet.isConnected && stats.data ? formatNumber(stats.data.transactionCount) : '—'} sub={complete ? 'USDC token transfers' : stats.data ? 'In scanned range' : wallet.isConnected ? '' : 'Connect to see'} />
            <StatTile label="Latest block" loading={health.isLoading} value={health.data?.headBlock ? formatNumber(health.data.headBlock) : '—'} sub={health.data?.rpc === 'ok' ? 'Arc RPC online' : health.isError ? 'Service offline' : ''} />
          </div>
          <div className="rise" style={rise(3)}><RouterCard /></div>

          <section className="card defer rise p-4 sm:p-5" style={rise(4)}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="display text-lg font-semibold">Payment requests</h2>
              <Link to="/requests" className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Manage</Link>
            </div>
            {!wallet.isConnected ? (
              <EmptyState title="No wallet connected" body="Connect to see requests you created." />
            ) : !token ? (
              <EmptyState title="Sign in to view" body="Requests are private to your wallet. Sign a free message to load them." action={<button className="btn btn-primary" onClick={() => void ensureSession().then(setSigned)}>Sign in with wallet</button>} />
            ) : requests.isLoading ? (
              <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : requests.isError ? (
              <EmptyState title="Requests unavailable" body="The requests service is not reachable, or your session expired." />
            ) : requests.data && requests.data.length > 0 ? (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {requests.data.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-strong)' }}><FileText className="size-4" style={{ color: 'var(--cyan)' }} aria-hidden /></span>
                    <Link to={`/pay/${r.id}`} className="min-w-0 flex-1">
                      <span className="display block font-bold tabular-nums">{displayUsdc(BigInt(r.amount))} USDC</span>
                      <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>{r.description || 'No description'}</span>
                    </Link>
                    <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No requests yet" body="Ask someone to pay you with a link or QR." action={<Link to="/requests" className="btn btn-primary">Create request</Link>} />
            )}
          </section>

          <section className="card defer rise p-4 sm:p-5" style={rise(5)}>
            <h2 className="display mb-4 text-lg font-semibold">Monthly activity</h2>
            {!wallet.isConnected ? (
              <EmptyState title="Connect a wallet" body="Monthly sent and received totals are calculated from your indexed transactions." />
            ) : stats.isLoading ? (
              <Skeleton className="h-44" />
            ) : stats.isError || !stats.data ? (
              <EmptyState title="Chart unavailable" body="The history service is not reachable, so no activity can be charted." />
            ) : stats.data.monthly.length === 0 ? (
              <EmptyState title="No monthly data yet" body={complete ? 'This wallet has no USDC transfers.' : 'No activity found in the blocks scanned so far.'} />
            ) : (
              <MonthlyChart points={stats.data.monthly} />
            )}
          </section>
        </aside>
      </div>
      <TxDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
