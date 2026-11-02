import { useId, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Eye, EyeOff, Wallet, type LucideIcon } from 'lucide-react'
import { Skeleton, EmptyState, CopyButton } from '@/components/ui'
import { TxRow } from '@/components/TxRow'
import { useNow } from '@/hooks/useNow'
import { balanceTrend, type Trend } from '@/lib/balanceTrend'
import { ARC_USDC, arcAddressUrl } from '@/lib/arc'
import { displayUsdc, shortAddress } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistory'

export const GLASS = 'rounded-3xl border border-slate-800 bg-slate-900/60 shadow-[0_0_40px_-18px_rgba(99,102,241,0.55)] backdrop-blur-xl'
const PRESS = 'transition-all duration-200 hover:scale-105 active:scale-95'

/** Ambient Indigo and Cyan glow blobs behind the dashboard. Decorative only. */
export function GlowBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-24 -top-24 size-[26rem] rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="absolute -right-20 top-40 size-[24rem] rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute -bottom-24 left-1/3 size-[22rem] rounded-full bg-indigo-600/15 blur-3xl" />
    </div>
  )
}

export function NetworkBadge({ wrongNetwork }: { wrongNetwork: boolean }) {
  const dot = wrongNetwork ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
      <span className="relative flex size-2">
        <span className={`absolute inline-flex size-full animate-pulse rounded-full opacity-75 ${dot}`} />
        <span className={`relative inline-flex size-2 rounded-full ${dot}`} />
      </span>
      {wrongNetwork ? 'Wallet on another network' : 'Arc Mainnet'}
    </span>
  )
}

interface ActionDef { to: string; label: string; icon: LucideIcon }

export function PrimaryActions({ actions }: { actions: ActionDef[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className={`${PRESS} flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-cyan-400 text-base font-bold text-slate-950 shadow-lg shadow-indigo-500/30 hover:shadow-cyan-400/50`}>
          <Icon className="size-5" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  )
}

export function SecondaryActions({ actions }: { actions: ActionDef[] }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {actions.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className={`${PRESS} flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-800 bg-slate-900/60 text-xs font-semibold text-slate-200 backdrop-blur-xl hover:border-cyan-400/60 hover:shadow-[0_0_22px_-4px_rgba(34,211,238,0.55)]`}>
          <Icon className="size-[18px] text-cyan-300" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  )
}

export function VisibilityToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={hidden} aria-label={hidden ? 'Show balance' : 'Hide balance'} onClick={onToggle} className={`${PRESS} inline-flex size-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 text-slate-300 hover:text-cyan-300`}>
      {hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
    </button>
  )
}

export function AddressRow({ address }: { address: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/40 py-0.5 pl-3 pr-1">
      <Wallet className="size-3.5 text-slate-400" aria-hidden />
      <span className="mono text-sm text-slate-200" title={address}>{shortAddress(address)}</span>
      <CopyButton value={address} label="Copy address" className="!size-9 transition-transform duration-200 hover:scale-110 active:scale-90" />
    </div>
  )
}

function Sparkline({ trend }: { trend: Trend }) {
  const id = useId()
  const W = 320
  const H = 90
  const { path, area, last } = useMemo(() => {
    const pts = trend.points
    const t0 = pts[0].at
    const span = Math.max(1, pts[pts.length - 1].at - t0)
    const values = pts.map((p) => Number(p.value))
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const xy = pts.map((p) => [((p.at - t0) / span) * W, H - 8 - ((Number(p.value) - min) / range) * (H - 16)] as const)
    const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    return { path: line, area: `${line} L${W} ${H} L0 ${H} Z`, last: xy[xy.length - 1] }
  }, [trend])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Balance over the last 24 hours" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${id}-s`} x1="0" x2="1"><stop offset="0" stopColor="#818cf8" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
        <linearGradient id={`${id}-f`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity="0.28" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-f)`} />
      <path d={path} fill="none" stroke={`url(#${id}-s)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#22d3ee" />
    </svg>
  )
}

/** 24-hour USDC balance trend, rebuilt from confirmed transfers and the live balance. Never invented. */
export function TrendCard({ rows, balanceRaw, loading, connected, hidden, pageSize }: { rows: HistoryRow[] | undefined; balanceRaw: bigint | undefined; loading: boolean; connected: boolean; hidden: boolean; pageSize: number }) {
  const now = useNow(60_000, connected)
  const trend = useMemo(() => (rows && balanceRaw !== undefined ? balanceTrend(rows, balanceRaw, ARC_USDC, now, pageSize) : null), [rows, balanceRaw, pageSize, now])
  const up = trend ? trend.change >= 0n : true
  let body: ReactNode
  if (!connected) body = <p className="py-6 text-sm text-slate-400">Connect a wallet to see your balance trend.</p>
  else if (loading || balanceRaw === undefined) body = <Skeleton className="h-24" />
  else if (!trend) body = <p className="py-6 text-sm text-slate-400">No confirmed USDC transfers in the last 24 hours, so there is no trend to draw yet.</p>
  else body = <Sparkline trend={trend} />
  return (
    <section className={`${GLASS} p-5`} aria-label="24 hour balance trend">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">24h balance trend</p>
          {trend && (
            <p className={`display mt-1 text-xl font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
              {hidden ? '••••••' : `${up ? '+' : '−'}${displayUsdc(trend.change < 0n ? -trend.change : trend.change)}`} <span className="text-sm font-medium text-slate-400">USDC</span>
            </p>
          )}
        </div>
        {trend && <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{trend.transfers} transfer{trend.transfers === 1 ? '' : 's'}</span>}
      </div>
      {body}
      {trend && (
        <p className="mt-2 text-pretty text-xs text-slate-500">
          {trend.truncated ? 'Starts at the oldest transfer read. ' : ''}Rebuilt from confirmed USDC transfers and your live balance; network fees are not included.
        </p>
      )}
    </section>
  )
}

/** Compact scrollable feed of recent activity, newest first. */
export function ActivityFeed({ address, rows, loading, connected, error, onSelect }: { address?: string; rows: HistoryRow[] | undefined; loading: boolean; connected: boolean; error: boolean; onSelect: (row: HistoryRow) => void }) {
  return (
    <section className={`${GLASS} p-4 sm:p-5`} aria-label="Recent activity">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="display text-lg font-semibold text-slate-100">Recent activity</h2>
        <Link to="/history" className="text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200">View all</Link>
      </div>
      {address && (
        <a href={arcAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="mb-2 flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-cyan-400/30 bg-gradient-to-r from-indigo-500/15 to-cyan-400/10 px-4 text-sm font-semibold text-cyan-200 transition-all duration-200 hover:scale-[1.02] hover:border-cyan-300/70 hover:shadow-[0_0_24px_-6px_rgba(34,211,238,0.6)] active:scale-95">
          <span className="min-w-0 truncate">View full address history on Arc Etherscan</span>
          <ExternalLink className="size-4 shrink-0" aria-hidden />
        </a>
      )}
      {!connected ? (
        <EmptyState title="Nothing to show yet" body="Connect a wallet to see your USDC activity." />
      ) : loading ? (
        <div className="space-y-3 py-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : error ? (
        <EmptyState title="History unavailable" body="Activity could not be loaded right now. Your balance above is read directly from Arc." />
      ) : rows && rows.length > 0 ? (
        <ul className="max-h-[22rem] divide-y overflow-y-auto overscroll-contain pr-1" style={{ borderColor: 'var(--border)' }}>
          {rows.map((row) => <TxRow key={`${row.txHash}-${row.logIndex}`} row={row} onSelect={onSelect} />)}
        </ul>
      ) : (
        <EmptyState title="No activity found yet" body="Payments you send or receive will appear here." />
      )}
    </section>
  )
}
