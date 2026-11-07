import { useId, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExternalLink, Eye, EyeOff, Wallet, type LucideIcon } from 'lucide-react'
import { Skeleton, EmptyState, CopyButton } from '@/components/ui'
import { TxRow } from '@/components/TxRow'
import { useNow } from '@/hooks/useNow'
import { balanceTrend, type Trend } from '@/lib/balanceTrend'
import { ARC_USDC, arcAddressUrl } from '@/lib/arc'
import { displayUsdc, shortAddress } from '@/lib/format'
import type { HistoryRow } from '@/hooks/useHistory'

const muted: CSSProperties = { color: 'var(--muted)' }
const subtle: CSSProperties = { color: 'var(--subtle)' }
const PRESS = 'transition-all duration-200 hover:scale-[1.04] active:scale-95'

/** Staggered entrance: `i` is the position in the sequence. */
export const rise = (i: number): CSSProperties => ({ ['--i' as string]: i })

/** Soft colour behind the dashboard. Radial gradients, not blurred elements: they cost almost nothing to paint. */
export function GlowBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="aura -left-24 -top-24 size-[30rem]" style={{ background: 'radial-gradient(closest-side, var(--glow-2), transparent)' }} />
      <div className="aura -right-20 top-40 size-[28rem]" style={{ background: 'radial-gradient(closest-side, var(--glow), transparent)' }} />
    </div>
  )
}

export function NetworkBadge({ wrongNetwork }: { wrongNetwork: boolean }) {
  const color = wrongNetwork ? 'var(--warn)' : 'var(--success)'
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: color }} />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
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
        <Link key={to} to={to} className={`act ${to === '/receive' ? 'act-receive' : 'act-send'}`}>
          <span className="act-icon"><Icon className="size-5" aria-hidden /></span>
          <span>{label}</span>
        </Link>
      ))}
    </div>
  )
}

interface Wave { key: number; index: number; x: number; y: number }

/** Scan, Split, Swap, Bridge. Each tile answers a tap with a ripple from the touch point and its own small icon motion. */
export function SecondaryActions({ actions }: { actions: ActionDef[] }) {
  const [wave, setWave] = useState<Wave | null>(null)
  const navigate = useNavigate()
  // Let the tap animation play for a moment before the page changes, unless the person prefers reduced motion or is opening a new tab.
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    event.preventDefault()
    setTimeout(() => void navigate(to), 190)
  }
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {actions.map(({ to, label, icon: Icon }, index) => (
        <Link
          key={to}
          to={to}
          data-kind={to.slice(1)}
          className="tile"
          onClick={go(to)}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setWave({ key: event.timeStamp, index, x: event.clientX - box.left, y: event.clientY - box.top })
          }}
        >
          {wave?.index === index && <span key={wave.key} aria-hidden className="tile-wave" style={{ left: wave.x, top: wave.y }} onAnimationEnd={() => setWave(null)} />}
          <span className="tile-icon"><Icon className="size-[20px]" aria-hidden /></span>
          <span className="tile-label">{label}</span>
        </Link>
      ))}
    </div>
  )
}

export function VisibilityToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={hidden} aria-label={hidden ? 'Show balance' : 'Hide balance'} onClick={onToggle} className={`${PRESS} inline-flex size-11 items-center justify-center rounded-xl border`} style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)', color: 'var(--muted)' }}>
      {hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
    </button>
  )
}

export function AddressRow({ address }: { address: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border py-0.5 pl-3 pr-1" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
      <Wallet className="size-3.5" style={subtle} aria-hidden />
      <span className="mono text-sm" style={{ color: 'var(--ink-2)' }} title={address}>{shortAddress(address)}</span>
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
  // The key restarts the draw-in animation whenever the chart's data changes.
  const drawKey = `${trend.points.length}-${trend.change}`
  return (
    <svg key={drawKey} viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Balance over the last 24 hours" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${id}-s`} x1="0" x2="1"><stop offset="0" stopColor="var(--accent-2)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient>
        <linearGradient id={`${id}-f`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-f)`} className="fade-area" />
      <path d={path} pathLength={1} fill="none" stroke={`url(#${id}-s)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="draw" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--accent)" className="fade-area" />
    </svg>
  )
}

/** 24-hour USDC balance trend, rebuilt from confirmed transfers and the live balance. Never invented. */
export function TrendCard({ rows, balanceRaw, loading, connected, hidden, pageSize, style }: { rows: HistoryRow[] | undefined; balanceRaw: bigint | undefined; loading: boolean; connected: boolean; hidden: boolean; pageSize: number; style?: CSSProperties }) {
  const now = useNow(60_000, connected)
  const trend = useMemo(() => (rows && balanceRaw !== undefined ? balanceTrend(rows, balanceRaw, ARC_USDC, now, pageSize) : null), [rows, balanceRaw, pageSize, now])
  const up = trend ? trend.change >= 0n : true
  let body: ReactNode
  if (!connected) body = <p className="py-6 text-sm" style={muted}>Connect a wallet to see your balance trend.</p>
  else if (loading || balanceRaw === undefined) body = <Skeleton className="h-24" />
  else if (!trend) body = <p className="py-6 text-sm" style={muted}>No confirmed USDC transfers in the last 24 hours, so there is no trend to draw yet.</p>
  else body = <Sparkline trend={trend} />
  return (
    <section className="glass glass-lift rise p-5" style={style} aria-label="24 hour balance trend">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="label">24h balance trend</p>
          {trend && (
            <p className="display mt-1 text-xl font-bold tabular-nums" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
              {hidden ? '••••••' : `${up ? '+' : '−'}${displayUsdc(trend.change < 0n ? -trend.change : trend.change)}`} <span className="text-sm font-medium" style={muted}>USDC</span>
            </p>
          )}
        </div>
        {trend && <span className="chip">{trend.transfers} transfer{trend.transfers === 1 ? '' : 's'}</span>}
      </div>
      {body}
      {trend && (
        <p className="mt-2 text-pretty text-xs" style={subtle}>
          {trend.truncated ? 'Starts at the oldest transfer read. ' : ''}Rebuilt from confirmed USDC transfers and your live balance; network fees are not included.
        </p>
      )}
    </section>
  )
}

/** Compact scrollable feed of recent activity, newest first. */
export function ActivityFeed({ address, rows, loading, connected, error, onSelect, style }: { address?: string; rows: HistoryRow[] | undefined; loading: boolean; connected: boolean; error: boolean; onSelect: (row: HistoryRow) => void; style?: CSSProperties }) {
  return (
    <section className="glass rise p-4 sm:p-5" style={style} aria-label="Recent activity">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="display text-lg font-semibold">Recent activity</h2>
        <Link to="/history" className="text-sm font-semibold transition-opacity hover:opacity-80" style={{ color: 'var(--accent)' }}>View all</Link>
      </div>
      {address && (
        <a href={arcAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="mb-2 flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border px-4 text-sm font-semibold transition-all duration-200 hover:scale-[1.015] active:scale-95" style={{ borderColor: 'var(--border-strong)', background: 'linear-gradient(90deg, var(--glow-2), var(--glow))', color: 'var(--ink)' }}>
          <span className="min-w-0 truncate">View full address history on Arc Explorer</span>
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
