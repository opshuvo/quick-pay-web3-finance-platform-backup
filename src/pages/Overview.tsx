import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Eye, EyeOff, FileText, QrCode, ScanLine, Send, SplitSquareHorizontal, Waypoints, type LucideIcon } from 'lucide-react'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import { HistoryHint } from '@/components/Coverage'
import { MonthlyChart } from '@/components/MonthlyChart'
import { StatTile } from '@/components/StatTile'
import { TxDetailSheet } from '@/components/TxDetailSheet'
import { TxRow } from '@/components/TxRow'
import { AddressChip, EmptyState, Skeleton, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useHealth } from '@/hooks/useHealth'
import { isRpcUnavailable } from '@/lib/api'
import { DEFAULT_FILTERS, useAnalytics, useHistory, type HistoryRow } from '@/hooks/useHistory'
import { loadSession, useSession } from '@/hooks/useSession'
import { displayUsdc, formatNumber } from '@/lib/format'
import { setPref, usePrefs } from '@/lib/prefs'
import { requestsApi, STATUS_LABEL, STATUS_TONE } from '@/lib/requests'
import type { SessionToken } from '../../shared/session'

const ACTIONS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/send', label: 'Send', icon: Send },
  { to: '/receive', label: 'Receive', icon: QrCode },
  { to: '/scan', label: 'Scan', icon: ScanLine },
  { to: '/split', label: 'Split', icon: SplitSquareHorizontal },
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { to: '/bridge', label: 'Bridge', icon: Waypoints },
]

export default function Overview() {
  const wallet = useArcWallet()
  const prefs = usePrefs()
  const health = useHealth()
  const history = useHistory(wallet.address, { ...DEFAULT_FILTERS, pageSize: 5 })
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
  const hide = (text: string) => (prefs.hideBalances ? '••••••' : text)

  return (
    <div className="space-y-6">
      {/* Balance hero */}
      <section className="card card-hero relative overflow-hidden p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-70 blur-3xl" style={{ background: 'var(--glow)' }} aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              <TokenUSDC variant="branded" size={20} /> USDC balance
              <span className="chip"><span className="pulse-dot size-1.5 rounded-full" style={{ background: wallet.wrongNetwork ? 'var(--warn)' : 'var(--success)' }} />{wallet.wrongNetwork ? 'Wallet on another network' : 'Arc Mainnet'}</span>
            </div>
            {!wallet.isConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="display text-3xl font-bold sm:text-4xl">Pay anyone, <span className="gradient-text">instantly.</span></p>
                  <p className="mt-2 max-w-[46ch] text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet to send and receive USDC on Arc, split bills, track every payment, and swap or bridge when you need to.</p>
                </div>
                <WalletButton />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {wallet.balanceLoading ? (
                    <Skeleton className="h-12 w-56" />
                  ) : wallet.balanceRaw !== undefined ? (
                    <span className="display text-4xl font-bold tabular-nums sm:text-5xl">{hide(displayUsdc(wallet.balanceRaw))}</span>
                  ) : (
                    <span className="display text-2xl font-bold" style={{ color: 'var(--muted)' }}>Balance unavailable</span>
                  )}
                  <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
                  <button type="button" aria-label={prefs.hideBalances ? 'Show balance' : 'Hide balance'} aria-pressed={prefs.hideBalances} onClick={() => setPref('hideBalances', !prefs.hideBalances)} className="inline-flex size-10 items-center justify-center rounded-xl" style={{ color: 'var(--muted)' }}>
                    {prefs.hideBalances ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs" style={{ color: 'var(--muted)' }}>
                  {wallet.address && <AddressChip address={wallet.address} />}
                  <span>Also your gas balance on Arc</span>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:w-[26rem]">
            {ACTIONS.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="inner hover-lift flex min-h-[72px] flex-col items-center justify-center gap-1.5 text-xs font-semibold">
                <Icon className="size-5" style={{ color: 'var(--cyan)' }} aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Verified totals */}
      <section aria-label="Verified totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Total sent${suffix}`} loading={wallet.isConnected && stats.isLoading} icon={<ArrowUpRight className="size-4" />} value={wallet.isConnected && stats.data ? hide(`${displayUsdc(BigInt(stats.data.totalSent))}`) : '—'} sub={stats.data ? `${formatNumber(stats.data.sentCount)} payments · USDC` : wallet.isConnected && stats.isError ? 'History offline' : 'Connect to see'} />
        <StatTile label={`Total received${suffix}`} loading={wallet.isConnected && stats.isLoading} icon={<ArrowDownLeft className="size-4" />} value={wallet.isConnected && stats.data ? hide(`${displayUsdc(BigInt(stats.data.totalReceived))}`) : '—'} sub={stats.data ? `${formatNumber(stats.data.receivedCount)} payments · USDC` : wallet.isConnected && stats.isError ? 'History offline' : 'Connect to see'} />
        <StatTile label="Transactions" loading={wallet.isConnected && stats.isLoading} value={wallet.isConnected && stats.data ? formatNumber(stats.data.transactionCount) : '—'} sub={complete ? 'USDC token transfers' : stats.data ? 'In scanned range' : ''} />
        <StatTile label="Latest Arc block" loading={health.isLoading} value={health.data?.headBlock ? formatNumber(health.data.headBlock) : '—'} sub={health.data?.rpc === 'ok' ? 'Arc RPC online' : health.isError ? 'Service offline' : ''} />
      </section>
      {stats.data && !complete && <HistoryHint coverage={stats.data.coverage} />}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* Recent transactions */}
        <section className="card p-4 sm:p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="display text-lg font-semibold">Recent transactions</h2>
            <Link to="/history" className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>View all</Link>
          </div>
          {!wallet.isConnected ? (
            <EmptyState title="Nothing to show yet" body="Connect a wallet to see your USDC activity." />
          ) : history.isLoading ? (
            <div className="space-y-3 py-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : history.isError ? (
            <EmptyState title="History unavailable" body={isRpcUnavailable(history.error) ? 'Arc\'s RPC is not answering right now. Quick Pay is retrying automatically. Your balance above is read directly from Arc.' : 'The history service is not reachable right now. Your balance above is read directly from Arc.'} />
          ) : history.data && history.data.rows.length > 0 ? (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>{history.data.rows.map((row) => <TxRow key={`${row.txHash}-${row.logIndex}`} row={row} onSelect={setSelected} />)}</ul>
          ) : (
            <EmptyState title="No activity found yet" body={history.data?.coverage.status === 'complete' ? 'This wallet has no USDC transfers on Arc.' : 'Still scanning older blocks. Activity will appear as the backfill progresses.'} />
          )}
        </section>

        {/* Payment requests */}
        <section className="card p-4 sm:p-5">
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
      </div>

      {/* Monthly activity */}
      <section className="card p-4 sm:p-5">
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
      <TxDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
