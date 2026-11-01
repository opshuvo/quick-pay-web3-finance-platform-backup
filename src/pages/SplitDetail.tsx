import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { RequestShare } from '@/components/RequestShare'
import { StatTile } from '@/components/StatTile'
import { EmptyState, ExplorerLink, Notice, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useSession } from '@/hooks/useSession'
import { ApiError } from '@/lib/api'
import { arcTxUrl } from '@/lib/arc'
import { displayUsdc, formatDateTime, shortAddress } from '@/lib/format'
import { requestsApi, STATUS_LABEL, STATUS_TONE, type RequestDto } from '@/lib/requests'
import { deleteSplit, loadSplit, saveSplit, summarizeSplit, useSplits, type Participant } from '@/lib/split'

const stillValid = (iso: string | undefined) => (iso && new Date(iso) > new Date() ? iso : undefined)

export default function SplitDetail() {
  const { id = '' } = useParams()
  const { address, isConnected } = useArcWallet()
  useSplits(address) // re-render when the saved split changes
  const split = loadSplit(id, address)
  const navigate = useNavigate()
  const client = useQueryClient()
  const { ensureSession } = useSession()
  const [shareFor, setShareFor] = useState<Participant | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const requested = split?.participants.filter((p) => p.requestId) ?? []
  const results = useQueries({
    queries: requested.map((p) => ({
      queryKey: ['request', p.requestId],
      queryFn: () => requestsApi.get(p.requestId as string),
      refetchInterval: 20_000,
      retry: 1,
    })),
  })
  const byId: Record<string, RequestDto | undefined> = {}
  requested.forEach((p, i) => {
    byId[p.requestId as string] = results[i]?.data
  })

  if (!isConnected) {
    return <div className="card"><EmptyState title="Connect a wallet" body="Open your splits with the wallet that created them." action={<WalletButton />} /></div>
  }
  if (!split) {
    return (
      <div className="card">
        <EmptyState title="Split not found on this device" body="Splits are saved in this browser for the wallet that created them. Open it on the original device, or check Payment Requests for the underlying requests." action={<Link className="btn btn-primary" to="/split">Back to splits</Link>} />
      </div>
    )
  }

  const statuses = Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, v?.status]))
  const summary = summarizeSplit(split, statuses)
  const collectable = summary.total - summary.own
  const pct = collectable > 0n ? Number((summary.paid * 10000n) / collectable) / 100 : 0
  const missing = split.participants.filter((p) => !p.isOrganizer && !p.requestId)

  async function createMissing() {
    if (!split) return
    setBusy('missing')
    try {
      const token = await ensureSession()
      if (!token) return
      let current = split
      for (const p of missing) {
        const request = await requestsApi.create(token, { amount: p.amount, description: `Split: ${split.title} (${p.name})`, expiresAt: stillValid(split.expiresAt) })
        current = { ...current, participants: current.participants.map((x) => (x.id === p.id ? { ...x, requestId: request.id } : x)) }
        saveSplit(current)
      }
      toast.success('Missing requests created.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create the requests.')
    } finally {
      setBusy(null)
    }
  }

  async function cancel(p: Participant) {
    if (!p.requestId) return
    setBusy(p.id)
    try {
      const token = await ensureSession()
      if (!token) return
      await requestsApi.cancel(token, p.requestId)
      await client.invalidateQueries({ queryKey: ['request', p.requestId] })
      toast.success(`Request for ${p.name} cancelled.`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel the request.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <Link to="/split" className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}><ArrowLeft className="size-4" /> All splits</Link>
      <PageHeader title={split.title} subtitle={`${split.description ? `${split.description} · ` : ''}${split.mode === 'equal' ? 'Equal split' : 'Custom split'} · created ${formatDateTime(split.createdAt)}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Bill total" value={`${displayUsdc(summary.total)}`} sub="USDC" />
        <StatTile label="Paid (verified)" value={displayUsdc(summary.paid)} sub="Confirmed on Arc" />
        <StatTile label="Pending" value={displayUsdc(summary.pending)} sub="Open requests, awaiting payment" />
        <StatTile label="Unpaid" value={displayUsdc(summary.unpaid)} sub="Expired, cancelled or not requested" />
      </div>

      <div className="card mb-4 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">Collected from others</span>
          <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{displayUsdc(summary.paid)} of {displayUsdc(collectable)} USDC · {pct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-strong)' }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the bill collected">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--cyan), var(--accent), var(--accent-2))', transition: 'width .5s ease' }} />
        </div>
        {summary.own > 0n && <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>Your own share of {displayUsdc(summary.own)} USDC is not requested.</p>}
      </div>

      <Notice tone="info">Each share is an <strong>off-chain payment request</strong>. It turns <strong>Paid</strong> only after FlowPay verifies a matching USDC transfer on Arc. Nothing is ever sent automatically.</Notice>

      <section className="card mt-4 p-2 sm:p-4">
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {split.participants.map((p) => {
            const req = p.requestId ? byId[p.requestId] : undefined
            const loading = Boolean(p.requestId) && !req
            const wrongPayer = req?.status === 'paid' && req.paidBy && p.address && req.paidBy.toLowerCase() !== p.address.toLowerCase()
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-semibold">{p.name} {p.isOrganizer && <StatusBadge tone="neutral">You</StatusBadge>}</p>
                  <p className="mono truncate text-xs" style={{ color: 'var(--muted)' }}>{p.address ? shortAddress(p.address, 8, 6) : ''}</p>
                </div>
                <p className="display w-28 text-right font-bold tabular-nums">{displayUsdc(BigInt(p.amount))}</p>
                <div className="w-44 text-right">
                  {p.isOrganizer ? <StatusBadge tone="neutral">Your share</StatusBadge>
                    : !p.requestId ? <StatusBadge tone="warn">Not requested</StatusBadge>
                    : loading ? <StatusBadge tone="neutral">Checking…</StatusBadge>
                    : req ? <StatusBadge tone={STATUS_TONE[req.status]}>{req.status === 'paid' ? 'Paid · verified on Arc' : req.status === 'unpaid' ? 'Awaiting payment' : STATUS_LABEL[req.status]}</StatusBadge>
                    : <StatusBadge tone="neutral">Unavailable</StatusBadge>}
                </div>
                {!p.isOrganizer && p.requestId && (
                  <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    {req?.paidTxHash && <ExplorerLink href={arcTxUrl(req.paidTxHash)}>Payment tx</ExplorerLink>}
                    {req?.status === 'unpaid' && (
                      <>
                        <button className="btn btn-ghost !min-h-[40px] !px-3 text-xs" onClick={() => setShareFor(p)}><Share2 className="size-3.5" /> Share</button>
                        <button className="btn btn-ghost !min-h-[40px] !px-3 text-xs" disabled={busy === p.id} onClick={() => void cancel(p)}>{busy === p.id ? <Spinner /> : 'Cancel'}</button>
                      </>
                    )}
                    <Link to={`/pay/${p.requestId}`} className="btn btn-ghost !min-h-[40px] !px-3 text-xs">Open</Link>
                  </div>
                )}
                {wrongPayer && req?.paidBy && <p className="w-full text-right text-xs" style={{ color: 'var(--warn)' }}>Paid by a different address: {shortAddress(req.paidBy)}</p>}
              </li>
            )
          })}
        </ul>
        {missing.length > 0 && (
          <div className="p-3">
            <button className="btn btn-primary w-full" disabled={busy === 'missing'} onClick={() => void createMissing()}>{busy === 'missing' ? <Spinner /> : null} Create {missing.length} missing request{missing.length > 1 ? 's' : ''}</button>
          </div>
        )}
      </section>

      <div className="mt-4 flex justify-end">
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Remove from this device</button>
      </div>

      <ConfirmSheet open={Boolean(shareFor)} onClose={() => setShareFor(null)} title={shareFor ? `Request for ${shareFor.name}` : 'Share'}>
        {shareFor?.requestId && (
          <div>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>Send this link or QR to {shareFor.name}. It is an off-chain request for {displayUsdc(BigInt(shareFor.amount))} USDC. They still confirm the payment in their own wallet.</p>
            <RequestShare id={shareFor.requestId} />
          </div>
        )}
      </ConfirmSheet>
      <ConfirmSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Remove this split?">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>This only removes the bill from this device. Existing payment requests stay active until they expire or you cancel them, and verified payments are unaffected.</p>
        <button className="btn btn-danger mt-4 w-full" onClick={() => { deleteSplit(split.id); void navigate('/split') }}>Remove split</button>
      </ConfirmSheet>
    </div>
  )
}
