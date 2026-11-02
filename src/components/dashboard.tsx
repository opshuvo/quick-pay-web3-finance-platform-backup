import { ExternalLink, ShieldCheck, Route } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { useRouter } from '@/hooks/useRouter'
import { arcAddressUrl } from '@/lib/arc'
import { env } from '@/lib/env'
import { displayUsdc, shortAddress } from '@/lib/format'

/** Sent vs received as one proportional bar, from the indexed totals (raw 6-decimal USDC strings). */
export function FlowCard({ sent, received, suffix, loading, hidden, error }: { sent?: string; received?: string; suffix: string; loading: boolean; hidden: boolean; error: boolean }) {
  const s = sent ? BigInt(sent) : 0n
  const r = received ? BigInt(received) : 0n
  const total = s + r
  const inPct = total > 0n ? Number((r * 1000n) / total) / 10 : 0
  const net = r - s
  const show = (v: bigint) => (hidden ? '••••••' : displayUsdc(v < 0n ? -v : v))
  return (
    <section className="card p-5" aria-label="Money flow">
      <div className="flex items-center justify-between">
        <p className="label">Money flow{suffix}</p>
        <span className="chip">USDC</span>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-24" />
      ) : error || sent === undefined ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>History service offline, so totals can't be shown right now.</p>
      ) : (
        <>
          <p className="display mt-3 text-3xl font-bold tabular-nums" style={{ color: net >= 0n ? 'var(--success)' : 'var(--danger)' }}>
            {net >= 0n ? '+' : '−'}{show(net)}
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Net {net >= 0n ? 'received' : 'sent'}</p>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-strong)' }} role="img" aria-label={`${inPct.toFixed(0)} percent of volume was received`}>
            <div style={{ width: `${inPct}%`, background: 'var(--success)' }} />
            <div style={{ width: `${total > 0n ? 100 - inPct : 0}%`, background: 'var(--accent)' }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}><span className="size-2 rounded-full" style={{ background: 'var(--success)' }} />Received</dt>
              <dd className="display font-bold tabular-nums">{show(r)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}><span className="size-2 rounded-full" style={{ background: 'var(--accent)' }} />Sent</dt>
              <dd className="display font-bold tabular-nums">{show(s)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}

const PROBLEM_COPY: Record<string, string> = {
  unreachable: 'Arc could not be read, so sends are held back until the check succeeds.',
  paused: 'The contract is paused, so sends go directly as plain USDC transfers.',
  'wrong-usdc': 'The contract does not use the official Arc USDC, so sends go directly as plain USDC transfers.',
  'no-contract': 'No contract code was found at this address, so sends go directly as plain USDC transfers.',
}

/** Live status of the configured QuickPayRouter: code, official USDC and not paused, read from Arc. */
export function RouterCard() {
  const router = useRouter()
  const configured = env.routerAddress
  const active = Boolean(router.address)
  const title = !configured ? 'Plain USDC transfers' : router.isLoading ? 'Checking router on Arc' : active ? 'Sends use Quick Pay Router' : 'Router not in use'
  const body = !configured
    ? 'No router configured. Set VITE_QUICKPAY_ROUTER_ADDRESS to route sends through your contract.'
    : router.isLoading
      ? 'Reading the contract on Arc Mainnet.'
      : active
        ? 'Confirmed on Arc: contract code present, official USDC, not paused.'
        : PROBLEM_COPY[router.problem ?? 'unreachable']
  return (
    <section className="card p-5" aria-label="Payment contract">
      <div className="flex items-center justify-between">
        <p className="label">Payment contract</p>
        {active ? <ShieldCheck className="size-4" style={{ color: 'var(--success)' }} aria-hidden /> : <Route className="size-4" style={{ color: 'var(--muted)' }} aria-hidden />}
      </div>
      <p className="display mt-3 text-lg font-bold">{title}</p>
      <p className="mt-1 text-pretty text-xs" style={{ color: 'var(--muted)' }}>{body}</p>
      {configured && (
        <a href={arcAddressUrl(configured)} target="_blank" rel="noopener noreferrer" className="inner mono mt-4 flex min-h-[44px] items-center justify-between gap-2 px-3 text-xs">
          {shortAddress(configured)}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </section>
  )
}
