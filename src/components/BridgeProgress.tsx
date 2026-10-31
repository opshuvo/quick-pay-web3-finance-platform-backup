import { Check, Circle, Loader2, X } from 'lucide-react'

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
