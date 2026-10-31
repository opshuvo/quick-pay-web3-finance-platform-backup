import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, FileText, QrCode, ScanLine, Send, SplitSquareHorizontal, type LucideIcon } from 'lucide-react'
import { TxDetailSheet } from '@/components/TxDetailSheet'
import { TxRow } from '@/components/TxRow'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui'
import { useArcWallet } from '@/hooks/useArcWallet'
import { DEFAULT_FILTERS, useHistory, type HistoryRow } from '@/hooks/useHistory'

const TILES: { to: string; title: string; body: string; icon: LucideIcon }[] = [
  { to: '/send', title: 'Send', body: 'Pay a wallet address', icon: Send },
  { to: '/receive', title: 'Receive', body: 'Share your address or QR', icon: QrCode },
  { to: '/scan', title: 'Scan & Pay', body: 'Fill details from a QR', icon: ScanLine },
  { to: '/split', title: 'Split Payment', body: 'Divide a bill', icon: SplitSquareHorizontal },
  { to: '/requests', title: 'Requests', body: 'Ask to be paid', icon: FileText },
]

function Section({ title, to, icon: Icon, direction, onSelect }: { title: string; to: string; icon: LucideIcon; direction: 'in' | 'out'; onSelect: (row: HistoryRow) => void }) {
  const { address, isConnected } = useArcWallet()
  const query = useHistory(address, { ...DEFAULT_FILTERS, direction, pageSize: 5 })
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="display flex items-center gap-2 text-lg font-semibold">
          <Icon className="size-[18px]" style={{ color: direction === 'in' ? 'var(--success)' : 'var(--cyan)' }} aria-hidden /> {title}
        </h2>
        <Link to={to} className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>View all</Link>
      </div>
      {!isConnected ? (
        <EmptyState title="Connect a wallet" body="Payments are looked up by your wallet address." />
      ) : query.isLoading ? (
        <div className="space-y-3 py-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : query.isError ? (
        <EmptyState title="History unavailable" body="The history service is not reachable right now." />
      ) : query.data && query.data.rows.length > 0 ? (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>{query.data.rows.map((r) => <TxRow key={`${r.txHash}-${r.logIndex}`} row={r} onSelect={onSelect} />)}</ul>
      ) : (
        <EmptyState title={direction === 'in' ? 'Nothing received yet' : 'Nothing sent yet'} body={query.data?.coverage.status === 'complete' ? 'No matching USDC transfers for this wallet.' : 'Still scanning older blocks. Matches will appear as the backfill progresses.'} />
      )}
    </section>
  )
}

export default function Payments() {
  const [selected, setSelected] = useState<HistoryRow | null>(null)
  return (
    <div>
      <PageHeader title="Payments" subtitle="Move USDC, request it, split it, and follow every payment. Nothing is sent without your confirmation." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map(({ to, title, body, icon: Icon }) => (
          <Link key={to} to={to} className="card hover-lift flex flex-col gap-3 p-4">
            <span className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, var(--glow), var(--glow-2))', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
              <Icon className="size-5" style={{ color: 'var(--cyan)' }} aria-hidden />
            </span>
            <span>
              <span className="display block font-semibold">{title}</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>{body}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Sent" to="/sent" icon={ArrowUpRight} direction="out" onSelect={setSelected} />
        <Section title="Received" to="/received" icon={ArrowDownLeft} direction="in" onSelect={setSelected} />
      </div>
      <TxDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
