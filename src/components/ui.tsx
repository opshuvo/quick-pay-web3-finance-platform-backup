import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, Inbox, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { arcAddressUrl } from '@/lib/arc'
import { shortAddress } from '@/lib/format'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display text-balance text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-[60ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin', className)} aria-hidden />
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl" style={{ background: 'var(--surface-strong)' }}>
        <Inbox className="size-5" style={{ color: 'var(--muted)' }} />
      </div>
      <p className="display text-base font-semibold">{title}</p>
      <p className="mt-1 max-w-[42ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', body, onRetry }: { title?: string; body: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-8 text-center">
      <AlertTriangle className="mb-2 size-6" style={{ color: 'var(--danger)' }} />
      <p className="display font-semibold">{title}</p>
      <p className="mt-1 max-w-[46ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {onRetry && (
        <button className="btn btn-ghost mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode; action?: ReactNode }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : tone === 'success' ? 'var(--success)' : 'var(--accent)'
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm"
      style={{ border: `1px solid ${color}`, background: 'var(--surface-muted)' }}
    >
      <span className="min-w-0 flex-1 text-pretty" style={{ color: 'var(--ink-2)' }}>
        {children}
      </span>
      {action}
    </div>
  )
}

export function StatusBadge({ tone, children }: { tone: 'success' | 'danger' | 'warn' | 'neutral'; children: ReactNode }) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted)'
  return (
    <span className="chip" style={{ color, borderColor: color }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx('inline-flex size-9 items-center justify-center rounded-xl', className)}
      style={{ color: 'var(--muted)' }}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setDone(true)
            toast.success('Copied')
            setTimeout(() => setDone(false), 1500)
          },
          () => toast.error('Copy is blocked by your browser. Select and copy manually.'),
        )
      }}
    >
      {done ? <Check className="size-4" style={{ color: 'var(--success)' }} /> : <Copy className="size-4" />}
    </button>
  )
}

export function ExplorerLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}

export function AddressChip({ address, copy = true }: { address: string; copy?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <a href={arcAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="mono text-sm" style={{ color: 'var(--ink-2)' }} title={address}>
        {shortAddress(address)}
      </a>
      {copy && <CopyButton value={address} label="Copy address" className="!size-8" />}
    </span>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="min-w-0 break-words text-right font-medium tabular-nums">{children}</span>
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs" style={{ color: 'var(--subtle)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}
