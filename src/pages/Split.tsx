import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, Notice, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useSession } from '@/hooks/useSession'
import { ApiError } from '@/lib/api'
import { displayUsdc, formatDateTime, shortAddress } from '@/lib/format'
import { requestsApi } from '@/lib/requests'
import { equalShares, MAX_PARTICIPANTS, saveSplit, sumShares, useSplits, validateSplit, type Participant, type Split, type SplitMode } from '@/lib/split'
import { parseUsdc } from '@/onchain-money'

interface Row {
  id: string
  name: string
  address: string
  amountText: string
}

const newRow = (): Row => ({ id: crypto.randomUUID(), name: '', address: '', amountText: '' })
const EXPIRY = [
  { label: 'No expiry', hours: 0 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
]

function toRaw(text: string): bigint | undefined {
  if (!text.trim()) return undefined
  try {
    return parseUsdc(text.trim())
  } catch {
    return undefined
  }
}

function Builder() {
  const { address, isConnected } = useArcWallet()
  const { ensureSession } = useSession()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [totalText, setTotalText] = useState('')
  const [mode, setMode] = useState<SplitMode>('equal')
  const [includeMe, setIncludeMe] = useState(true)
  const [myAmountText, setMyAmountText] = useState('')
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()])
  const [hours, setHours] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const total = toRaw(totalText)
  const people = rows.length + (includeMe ? 1 : 0)
  const equal = useMemo(() => (total !== undefined && total > 0n ? equalShares(total, people) : []), [total, people])

  // Equal mode derives every share; custom mode reads the typed amounts.
  const amounts: (bigint | undefined)[] = rows.map((r, i) => (mode === 'equal' ? equal[i] : toRaw(r.amountText)))
  const myAmount = includeMe ? (mode === 'equal' ? equal[rows.length] : toRaw(myAmountText)) : undefined

  const draft = {
    title,
    total,
    organizerAddress: address,
    participants: [
      ...rows.map((r, i) => ({ name: r.name, address: r.address.trim(), amount: amounts[i], isOrganizer: false })),
      ...(includeMe ? [{ name: 'You', address: address ?? '', amount: myAmount, isOrganizer: true }] : []),
    ],
  }
  const validation = validateSplit(draft)
  const assigned = sumShares(draft.participants.map((p) => p.amount ?? 0n))

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  function fillEqually() {
    if (total === undefined || total <= 0n) return
    setRows((rs) => rs.map((r, i) => ({ ...r, amountText: displayExact(equal[i]) })))
    if (includeMe) setMyAmountText(displayExact(equal[rows.length]))
  }

  async function create() {
    setAttempted(true)
    if (!validation.ok || !address || total === undefined) return
    setBusy(true)
    try {
      const token = await ensureSession()
      if (!token) return
      const split: Split = {
        id: crypto.randomUUID(),
        owner: address.toLowerCase(),
        title: title.trim(),
        description: description.trim(),
        total: total.toString(),
        mode,
        expiresAt: hours ? isoAfterHours(hours) : undefined,
        createdAt: isoNow(),
        participants: draft.participants.map<Participant>((p, i) => ({
          id: rows[i]?.id ?? crypto.randomUUID(),
          name: p.name.trim() || `Participant ${i + 1}`,
          address: p.address,
          amount: (p.amount ?? 0n).toString(),
          isOrganizer: p.isOrganizer,
        })),
      }
      saveSplit(split)
      // One ordinary payment request per participant. No funds move.
      for (const [i, p] of split.participants.entries()) {
        if (p.isOrganizer) continue
        setProgress(`Creating request ${i + 1} of ${split.participants.filter((x) => !x.isOrganizer).length}…`)
        const request = await requestsApi.create(token, { amount: p.amount, description: `Split: ${split.title} (${p.name})`, expiresAt: split.expiresAt })
        split.participants = split.participants.map((x) => (x.id === p.id ? { ...x, requestId: request.id } : x))
        saveSplit({ ...split })
      }
      toast.success('Split created. Share each person their request link.')
      void navigate(`/split/${split.id}`)
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('cancel'))) toast.error(error instanceof ApiError ? error.message : 'Could not create every request. Open the split to retry the missing ones.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  if (!isConnected) {
    return <div className="card"><EmptyState title="Connect a wallet" body="Splits are tied to the wallet that collects the money." action={<WalletButton />} /></div>
  }

  const diffTone = validation.difference === 0n ? 'var(--success)' : 'var(--danger)'
  return (
    <div className="space-y-4">
      <Notice tone="info">A split creates one <strong>off-chain payment request</strong> per participant. Creating it moves no money. A share is marked paid only after Quick Pay verifies the participant's USDC transfer on Arc.</Notice>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="display text-lg font-semibold">Bill</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="label">Title</span><input className="field mt-1.5" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team dinner" /></label>
          <label className="block"><span className="label">Total (USDC)</span><input className="field mt-1.5 tabular-nums" inputMode="decimal" value={totalText} onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setTotalText(e.target.value)} placeholder="0.00" /></label>
        </div>
        <label className="block"><span className="label">Description (optional)</span><input className="field mt-1.5" maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Friday, 8 people" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Split type</span>
            <div className="segmented mt-1.5" role="tablist" aria-label="Split type">
              <button role="tab" aria-selected={mode === 'equal'} className="seg-item" onClick={() => setMode('equal')}>Equal</button>
              <button role="tab" aria-selected={mode === 'custom'} className="seg-item" onClick={() => setMode('custom')}>Custom</button>
            </div>
          </div>
          <label className="block"><span className="label">Requests expire</span>
            <select className="field mt-1.5" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{EXPIRY.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}</select>
          </label>
        </div>
        <label className="inner flex min-h-[48px] cursor-pointer items-center gap-3 px-3.5 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} />
          I'm part of this split (my share is counted but not requested)
        </label>
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-lg font-semibold">Participants</h2>
          {mode === 'custom' && <button className="btn btn-ghost !min-h-[40px] text-xs" onClick={fillEqually} disabled={total === undefined || total <= 0n}>Fill equally</button>}
        </div>
        {rows.map((r, i) => (
          <div key={r.id} className="inner grid gap-2 p-3 sm:grid-cols-[1fr_1.6fr_9rem_auto] sm:items-end">
            <label className="block"><span className="label">Name</span><input className="field mt-1" maxLength={30} value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} placeholder={`Person ${i + 1}`} /></label>
            <label className="block"><span className="label">Wallet address</span><input className="field mono mt-1 !text-[13px]" spellCheck={false} value={r.address} onChange={(e) => update(r.id, { address: e.target.value })} placeholder="0x…" /></label>
            <label className="block"><span className="label">Share (USDC)</span>
              {mode === 'equal' ? (
                <div className="field mt-1 flex items-center tabular-nums" aria-readonly>{amounts[i] !== undefined ? displayUsdc(amounts[i]) : '—'}</div>
              ) : (
                <input className="field mt-1 tabular-nums" inputMode="decimal" value={r.amountText} onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && update(r.id, { amountText: e.target.value })} placeholder="0.00" />
              )}
            </label>
            <button className="btn btn-ghost !px-3" aria-label={`Remove participant ${i + 1}`} disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        {includeMe && (
          <div className="inner grid gap-2 p-3 sm:grid-cols-[1fr_1.6fr_9rem_auto] sm:items-end" style={{ borderColor: 'var(--border-strong)' }}>
            <div><span className="label">Name</span><p className="mt-2.5 font-semibold">You <StatusBadge tone="neutral">Organizer</StatusBadge></p></div>
            <div><span className="label">Wallet address</span><p className="mono mt-2.5 text-[13px]">{address ? shortAddress(address, 8, 6) : ''}</p></div>
            <label className="block"><span className="label">Your share (USDC)</span>
              {mode === 'equal' ? (
                <div className="field mt-1 flex items-center tabular-nums" aria-readonly>{myAmount !== undefined ? displayUsdc(myAmount) : '—'}</div>
              ) : (
                <input className="field mt-1 tabular-nums" inputMode="decimal" value={myAmountText} onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setMyAmountText(e.target.value)} placeholder="0.00" />
              )}
            </label>
            <span className="hidden w-[46px] sm:block" />
          </div>
        )}
        <button className="btn btn-ghost w-full" disabled={rows.length >= MAX_PARTICIPANTS} onClick={() => setRows((rs) => [...rs, newRow()])}><Plus className="size-4" /> Add participant</button>
      </section>

      <section className="card space-y-3 p-4 sm:p-5" aria-live="polite">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="label">Bill total</p><p className="display mt-1 text-lg font-bold tabular-nums">{total !== undefined ? displayUsdc(total) : '—'}</p></div>
          <div><p className="label">Assigned</p><p className="display mt-1 text-lg font-bold tabular-nums">{displayUsdc(assigned)}</p></div>
          <div><p className="label">{validation.difference >= 0n ? 'Remaining' : 'Over by'}</p><p className="display mt-1 text-lg font-bold tabular-nums" style={{ color: total === undefined ? 'var(--muted)' : diffTone }}>{total === undefined ? '—' : displayUsdc(validation.difference < 0n ? -validation.difference : validation.difference)}</p></div>
        </div>
        {attempted && !validation.ok && (
          <Notice tone="danger"><ul className="list-disc pl-4">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>
        )}
        <button className="btn btn-primary w-full" disabled={busy} onClick={() => void create()}>
          {busy ? <><Spinner /> {progress || 'Signing in…'}</> : <><Users className="size-4" /> Create split and payment requests</>}
        </button>
        <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>You'll sign a free message to prove you own this wallet. No funds move and nothing is sent automatically.</p>
      </section>
    </div>
  )
}

/** Plain decimal text for an exact base-unit amount, used to seed custom inputs. */
function displayExact(raw: bigint | undefined): string {
  if (raw === undefined) return ''
  const s = raw.toString().padStart(7, '0')
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, '') || '0'
}

function MySplits() {
  const { address } = useArcWallet()
  const splits = useSplits(address)
  if (splits.length === 0) {
    return <div className="card"><EmptyState title="No splits yet" body="Splits you create appear here. They are saved on this device; each share's paid status comes from verified transactions on Arc." /></div>
  }
  return (
    <ul className="space-y-3">
      {splits.map((s) => (
        <li key={s.id}>
          <Link to={`/split/${s.id}`} className="card hover-lift flex items-center justify-between gap-3 p-4">
            <span className="min-w-0">
              <span className="display block truncate font-semibold">{s.title}</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>{s.participants.length} participants · {s.mode === 'equal' ? 'Equal' : 'Custom'} · {formatDateTime(s.createdAt)}</span>
            </span>
            <span className="display font-bold tabular-nums">{displayUsdc(BigInt(s.total))} <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const isoNow = () => new Date().toISOString()
const isoAfterHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

export default function SplitPage() {
  const [tab, setTab] = useState<'new' | 'mine'>('new')
  return (
    <div>
      <PageHeader title="Split Payment" subtitle="Divide a bill equally or by custom amounts and share a payment request with each person." />
      <div className="segmented mb-4 max-w-sm" role="tablist" aria-label="Split views">
        <button role="tab" aria-selected={tab === 'new'} className="seg-item" onClick={() => setTab('new')}>New split</button>
        <button role="tab" aria-selected={tab === 'mine'} className="seg-item" onClick={() => setTab('mine')}>My splits</button>
      </div>
      {tab === 'new' ? <Builder /> : <MySplits />}
    </div>
  )
}
