import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui'

export function StatTile({ label, value, sub, loading, icon }: { label: string; value: ReactNode; sub?: string; loading?: boolean; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="label">{label}</p>
        {icon && <span style={{ color: 'var(--cyan)' }}>{icon}</span>}
      </div>
      {loading ? <Skeleton className="mt-2 h-8 w-32" /> : <p className="display mt-1.5 truncate text-2xl font-bold tabular-nums">{value}</p>}
      {sub && <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{sub}</p>}
    </div>
  )
}
