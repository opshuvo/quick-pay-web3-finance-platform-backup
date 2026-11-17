import { Check, Circle, Loader2, X } from 'lucide-react'
import { ChainIcon } from '@/components/BridgeCard'

export type StepState = 'done' | 'active' | 'todo' | 'failed'

export interface ProgressStep {
  label: string
  detail?: string
  state: StepState
}

/** Vertical progress tracker. A step is `done` only when its fact was verified, never by elapsed time. */
export function BridgeProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="space-y-3" aria-label="Bridge progress">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-3">
          <span
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{
              background: s.state === 'done' ? 'var(--success)' : s.state === 'failed' ? 'var(--danger)' : 'var(--surface-strong)',
              color: s.state === 'done' || s.state === 'failed' ? '#fff' : 'var(--muted)',
            }}
          >
            {s.state === 'done' ? <Check className="size-3.5" aria-hidden /> : s.state === 'failed' ? <X className="size-3.5" aria-hidden /> : s.state === 'active' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Circle className="size-3" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: s.state === 'todo' ? 'var(--muted)' : undefined }}>{s.label}</p>
            {s.detail && <p className="text-xs" style={{ color: 'var(--muted)' }}>{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export type FlowState = 'idle' | 'active' | 'done' | 'failed'

/**
 * Source and destination of a transfer joined by a line. The line fills and a light travels along it only while the
 * transfer is genuinely in flight; the destination lights up only once delivery has been verified on that chain.
 */
export function BridgeFlow({ from, to, state, fromName, toName }: { from: number; to: number; state: FlowState; fromName: string; toName: string }) {
  const fill = state === 'done' ? 1 : state === 'active' ? 0.55 : state === 'failed' ? 0.3 : 0
  return (
    <div className="flow" role="img" aria-label={`${fromName} to ${toName}: ${state === 'done' ? 'delivered' : state === 'failed' ? 'failed' : state === 'active' ? 'in transit' : 'waiting'}`}>
      <span className="flow-node" data-on={state !== 'idle'} data-state={state === 'failed' ? 'failed' : undefined} data-pulse={state === 'active'}>
        <ChainIcon chainId={from} name={fromName} size={22} />
      </span>
      <span className="flow-line" data-active={state === 'active'} style={{ ['--fill' as string]: fill }} />
      <span className="flow-node" data-on={state === 'done'} data-state={state === 'done' ? 'done' : state === 'failed' ? 'failed' : undefined}>
        <ChainIcon chainId={to} name={toName} size={22} />
      </span>
    </div>
  )
}
