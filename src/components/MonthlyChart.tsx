import { displayUsdc } from '@/lib/format'

export interface MonthPoint {
  month: string
  sent: string
  received: string
  count: number
}

/** Sent vs received bars per month, drawn only from indexed monthly totals. Solid bars, hairline gridlines, no decoration. */
export function MonthlyChart({ points, height = 160 }: { points: MonthPoint[]; height?: number }) {
  const months = [...points].reverse()
  const max = months.reduce((m, x) => {
    const v = BigInt(x.sent) > BigInt(x.received) ? BigInt(x.sent) : BigInt(x.received)
    return v > m ? v : m
  }, 0n)
  const scale = (value: string) => (max === 0n ? 2 : Math.max(3, (Number((BigInt(value) * 1000n) / max) / 1000) * height))
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--muted)' }}>
        <div className="flex gap-4">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />Sent</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--emerald)' }} />Received</span>
        </div>
        <span className="tabular-nums">USDC</span>
      </div>
      <div className="relative">
        {[0, 0.5, 1].map((f) => (
          <div key={f} aria-hidden className="pointer-events-none absolute inset-x-0 border-t" style={{ top: `${(1 - f) * height}px`, borderColor: 'var(--border)', borderStyle: f === 0 ? 'solid' : 'dashed' }}>
            {f > 0 && <span className="absolute right-0 -translate-y-full pr-1 text-[10px] tabular-nums" style={{ color: 'var(--subtle)' }}>{displayUsdc(BigInt(Math.round(Number(max) * f)))}</span>}
          </div>
        ))}
        <div className="relative flex gap-1.5 overflow-x-auto pb-1 sm:gap-3" role="img" aria-label="Monthly sent and received USDC">
          {months.map((m) => (
            <div key={m.month} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
              <div className="flex items-end gap-1" style={{ height }}>
                <div title={`Sent ${displayUsdc(BigInt(m.sent))} USDC`} className="bar-grow w-3.5 rounded-t sm:w-4" style={{ height: scale(m.sent), background: 'var(--accent)' }} />
                <div title={`Received ${displayUsdc(BigInt(m.received))} USDC`} className="bar-grow w-3.5 rounded-t sm:w-4" style={{ height: scale(m.received), background: 'var(--emerald)' }} />
              </div>
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{m.month.slice(2)}</span>
              <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>{m.count} tx</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
