import { displayUsdc } from '@/lib/format'

export interface MonthPoint {
  month: string
  sent: string
  received: string
  count: number
}

/** Sent vs received bars per month, drawn only from indexed monthly totals. */
export function MonthlyChart({ points, height = 150 }: { points: MonthPoint[]; height?: number }) {
  const months = [...points].reverse()
  const max = months.reduce((m, x) => {
    const v = BigInt(x.sent) > BigInt(x.received) ? BigInt(x.sent) : BigInt(x.received)
    return v > m ? v : m
  }, 0n)
  const scale = (value: string) => (max === 0n ? 2 : Math.max(3, Number((BigInt(value) * 1000n) / max) / 1000 * height))
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'linear-gradient(180deg, var(--accent), var(--accent-2))' }} />Sent</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'linear-gradient(180deg, var(--cyan), var(--success))' }} />Received</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 sm:gap-3" role="img" aria-label="Monthly sent and received USDC">
        {months.map((m) => (
          <div key={m.month} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
            <div className="flex items-end gap-1 border-b" style={{ height, borderColor: 'var(--border)' }}>
              <div title={`Sent ${displayUsdc(BigInt(m.sent))} USDC`} className="w-3.5 rounded-t-md sm:w-4" style={{ height: scale(m.sent), background: 'linear-gradient(180deg, var(--accent), var(--accent-2))' }} />
              <div title={`Received ${displayUsdc(BigInt(m.received))} USDC`} className="w-3.5 rounded-t-md sm:w-4" style={{ height: scale(m.received), background: 'linear-gradient(180deg, var(--cyan), var(--success))' }} />
            </div>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{m.month.slice(2)}</span>
            <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>{m.count} tx</span>
          </div>
        ))}
      </div>
    </div>
  )
}
