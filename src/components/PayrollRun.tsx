import { CheckCircle2, CircleAlert, Clock3, Loader2, ShieldQuestion, XCircle } from 'lucide-react'
import { ExplorerLink, Notice, Spinner, StatusBadge } from '@/components/ui'
import { arcTxUrl } from '@/lib/arc'
import { displayUsdc, shortAddress } from '@/lib/format'
import { summarizeRun, type PayrollRun, type RowState } from '@/lib/payroll'

const LABEL: Record<RowState, string> = { queued: 'Waiting', wallet: 'In your wallet', pending: 'Pending on Arc', confirmed: 'Confirmed', failed: 'Failed', unverified: 'Unverified' }
const TONE: Record<RowState, 'neutral' | 'warn' | 'success' | 'danger'> = { queued: 'neutral', wallet: 'warn', pending: 'warn', confirmed: 'success', failed: 'danger', unverified: 'danger' }
const ICON: Record<RowState, typeof Clock3> = { queued: Clock3, wallet: Loader2, pending: Loader2, confirmed: CheckCircle2, failed: XCircle, unverified: ShieldQuestion }

interface Props {
  run: PayrollRun
  busy: boolean
  onResume: () => void
  onRetryFailed: () => void
  onRequeue: (id: string) => void
  onDismiss: () => void
}

/** Progress of a batch. Every status comes from the wallet or from Arc's receipt for that transfer. */
export function PayrollRunPanel({ run, busy, onResume, onRetryFailed, onRequeue, onDismiss }: Props) {
  const s = summarizeRun(run)
  const settled = s.confirmed + s.failed + s.unverified
  const hasWork = s.queued > 0 || run.rows.some((r) => r.state === 'pending' && r.hash)
  return (
    <section className="card space-y-4 p-5" aria-label="Batch in progress">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display text-lg font-semibold">{s.finished ? 'Batch finished' : 'Batch in progress'}</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {s.confirmed} of {s.total} confirmed on Arc · {displayUsdc(s.confirmedAmount)} {run.token} paid
            {run.mode === 'batch' ? ' · sent with one approval' : ''}
          </p>
        </div>
        {busy && <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}><Spinner /> Working</span>}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-strong)' }} role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={settled} aria-label="Transfers settled">
        <div className="h-full origin-left rounded-full transition-transform duration-300" style={{ background: 'var(--accent)', transform: `scaleX(${s.total ? settled / s.total : 0})` }} />
      </div>

      {run.paused && !busy && <Notice tone="warn">{run.paused}</Notice>}

      <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {run.rows.map((row) => {
          const Icon = ICON[row.state]
          const spinning = row.state === 'wallet' || row.state === 'pending'
          return (
            <li key={row.id} className="py-3">
              <div className="flex items-center gap-3">
                <Icon className={`size-4 shrink-0 ${spinning && busy ? 'animate-spin' : ''}`} aria-hidden style={{ color: row.state === 'confirmed' ? 'var(--success)' : row.state === 'failed' || row.state === 'unverified' ? 'var(--danger)' : 'var(--muted)' }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.label ? `${row.label} · ` : ''}<span className="mono">{shortAddress(row.to)}</span></p>
                  <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{displayUsdc(BigInt(row.amount))} {run.token}</p>
                </div>
                <StatusBadge tone={TONE[row.state]}>{LABEL[row.state]}</StatusBadge>
              </div>
              {(row.error || row.hash) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs">
                  {row.error && <span style={{ color: row.state === 'confirmed' ? 'var(--muted)' : 'var(--danger)' }}>{row.error}</span>}
                  {row.hash && <ExplorerLink href={arcTxUrl(row.hash)}>View transaction</ExplorerLink>}
                  {row.state === 'unverified' && !row.hash && (
                    <button type="button" className="font-semibold underline" disabled={busy} onClick={() => onRequeue(row.id)}>I did not send this: add it back to the queue</button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {s.unverified > 0 && (
        <Notice tone="danger">
          <CircleAlert className="mr-1 inline size-4" aria-hidden />
          Unverified rows are never counted as paid and never retried automatically. Open each transaction on the explorer, or check your wallet and History, before sending it again.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        {hasWork && <button className="btn btn-primary" disabled={busy} onClick={onResume}>{busy ? <Spinner /> : null}{s.queued > 0 && !run.rows.some((r) => r.hash) ? 'Start' : 'Resume'}</button>}
        {s.failed > 0 && <button className="btn btn-ghost" disabled={busy} onClick={onRetryFailed}>Retry {s.failed} failed</button>}
        {s.finished && <button className="btn btn-ghost" onClick={onDismiss}>Close this batch</button>}
      </div>
    </section>
  )
}
