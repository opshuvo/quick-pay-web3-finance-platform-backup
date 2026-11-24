import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Upload, Users } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { PayrollRunPanel } from '@/components/PayrollRun'
import { EmptyState, Field, Notice, PageHeader, Row, Spinner } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useBatchPayout } from '@/hooks/useBatchPayout'
import { useTokenList } from '@/hooks/useTokenList'
import { displayUsdc, shortAddress } from '@/lib/format'
import {
  clearRun, deleteList, loadLists, loadRun, MAX_PAYROLL_ROWS, newRowId, newRun, parseRecipients, requeueUnsent, retryFailed, saveList, saveRun, validatePayroll,
  type ParsedLine, type PayrollRow, type PayrollRun, type SavedList,
} from '@/lib/payroll'
import { payTokenInfo } from '@/lib/payTokens'
import { formatUsdc } from '@/onchain-money'
import { PAY_TOKENS, type PayToken } from '../../shared/tokens'

const blank = (): PayrollRow => ({ id: newRowId(), address: '', amount: '' })

export default function Payroll() {
  const wallet = useArcWallet()
  const list = useTokenList()
  const payout = useBatchPayout()
  const [symbol, setSymbol] = useState<PayToken>('USDC')
  const [rows, setRows] = useState<PayrollRow[]>(() => [blank(), blank()])
  const [pasteText, setPasteText] = useState('')
  const [skipped, setSkipped] = useState<ParsedLine[]>([])
  const [saved, setSaved] = useState<SavedList[]>([])
  const [listName, setListName] = useState('')
  const [review, setReview] = useState(false)
  const [run, setRun] = useState<PayrollRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  const address = wallet.address
  const info = payTokenInfo(symbol)
  const listed = list.tokens.find((t) => t.address.toLowerCase() === info.address.toLowerCase())
  const verified = (s: PayToken) => s === 'USDC' || list.tokens.some((t) => t.address.toLowerCase() === payTokenInfo(s).address.toLowerCase())
  const balance = symbol === 'USDC' ? wallet.balanceRaw : listed?.balance
  const check = useMemo(() => validatePayroll(rows, symbol, address, balance, info.decimals), [rows, symbol, address, balance, info.decimals])

  // This wallet's saved lists and any batch that was in progress when the page last closed (kept on this device).
  useEffect(() => {
    if (!address) return
    setSaved(loadLists(address))
    const existing = loadRun(address)
    setRun(existing)
    // A batch that was already sent is only checked against Arc again here. Nothing is sent without a click.
    if (existing && existing.rows.some((r) => r.hash && r.state === 'pending')) {
      setBusy(true)
      const finish = (next: PayrollRun) => { saveRun(next); setRun(next) }
      const job = existing.callsId && existing.mode === 'batch' ? payout.recheckBundle(existing, finish) : payout.recheck(existing, finish)
      void Promise.resolve(job).finally(() => setBusy(false))
    }
    // The first read for a wallet is the only one that matters; later changes come from the run itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  function persist(next: PayrollRun) {
    saveRun(next)
    setRun(next)
  }

  function update(id: string, patch: Partial<PayrollRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addPasted() {
    const parsed = parseRecipients(pasteText)
    setSkipped(parsed.skipped)
    if (parsed.rows.length === 0) {
      toast.error(parsed.skipped.length ? 'No recipients could be read from that text.' : 'Paste one recipient per line.')
      return
    }
    setRows((rs) => {
      const kept = rs.filter((r) => r.address.trim() || r.amount.trim())
      return [...kept, ...parsed.rows].slice(0, MAX_PAYROLL_ROWS)
    })
    setPasteText('')
    setTouched(true)
  }

  async function start(mode: 'queue' | 'batch') {
    if (!address || !check.ok) return
    setReview(false)
    setBusy(true)
    const fresh = newRun(address, symbol, mode, check.valid)
    persist(fresh)
    try {
      await (mode === 'batch' ? payout.runBatch(fresh, persist) : payout.runQueued(fresh, persist))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The batch could not start.')
    } finally {
      setBusy(false)
    }
  }

  async function resume() {
    if (!run) return
    setBusy(true)
    try {
      if (run.mode === 'batch' && run.callsId) await payout.recheckBundle(run, persist)
      else if (run.mode === 'batch') await payout.runBatch({ ...run, rows: run.rows }, persist)
      else await payout.runQueued(run, persist)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not continue the batch.')
    } finally {
      setBusy(false)
    }
  }

  if (!wallet.isConnected || !address) {
    return (
      <div>
        <PageHeader title="Batch Payouts" subtitle="Pay several people in one go: payroll, a team, or a list of suppliers." />
        <div className="card"><EmptyState title="Connect a wallet" body="Batch payouts are sent from your own wallet. Quick Pay never holds your funds." action={<WalletButton />} /></div>
      </div>
    )
  }

  const rowIssue = (id: string, field: 'address' | 'amount') => (touched ? check.issues.find((i) => i.id === id && i.field === field)?.message : undefined)
  const running = Boolean(run) && !(run && run.rows.every((r) => r.state === 'confirmed' || r.state === 'failed' || r.state === 'unverified'))

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Batch Payouts" subtitle="Pay several people at once. Every transfer is checked against Arc's receipt before it counts as paid." />
      <Notice tone="warn">This sends real {symbol} on Arc Mainnet and cannot be reversed. Check every address. Lists you save stay on this device.</Notice>

      {run && (
        <PayrollRunPanel
          run={run}
          busy={busy}
          onResume={() => void resume()}
          onRetryFailed={() => persist(retryFailed(run))}
          onRequeue={(id) => persist(requeueUnsent(run, id))}
          onDismiss={() => { clearRun(address); setRun(null) }}
        />
      )}

      <section className="card space-y-4 p-5" aria-label="Recipients">
        <div>
          <span className="label mb-1.5 block">Token</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Token to pay">
            {PAY_TOKENS.map((s) => {
              const ok = verified(s)
              return (
                <button key={s} type="button" role="radio" aria-checked={symbol === s} disabled={!ok || running} title={ok ? undefined : `${s} could not be verified on Arc right now`} onClick={() => setSymbol(s)} className="chip min-h-[44px] justify-center font-semibold disabled:opacity-40" style={symbol === s ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--blue-soft)' } : undefined}>
                  {s}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            Balance: {balance === undefined ? (wallet.balanceLoading || list.isLoading ? 'Loading…' : 'Unavailable') : `${displayUsdc(balance)} ${symbol}`}. Each transfer pays its own network fee in USDC.
          </p>
        </div>

        {saved.length > 0 && (
          <Field label="Saved lists (on this device)">
            <div className="flex gap-2">
              <select className="field" defaultValue="" onChange={(e) => {
                const l = saved.find((x) => x.id === e.target.value)
                if (l) { setSymbol(l.token); setRows(l.rows.map((r) => ({ ...r, id: newRowId() }))); setTouched(true) }
                e.target.value = ''
              }}>
                <option value="" disabled>Load a list…</option>
                {saved.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.rows.length}, {l.token})</option>)}
              </select>
            </div>
          </Field>
        )}

        <Field label="Paste a list" hint={`One recipient per line: address, amount, optional label. Up to ${MAX_PAYROLL_ROWS}.`}>
          <textarea className="field mono min-h-[92px]" spellCheck={false} placeholder={'0x…, 125.50, Ana\n0x…, 90'} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        </Field>
        <button className="btn btn-ghost" disabled={!pasteText.trim()} onClick={addPasted}><Upload className="size-4" /> Add from list</button>
        {skipped.length > 0 && (
          <Notice tone="warn">
            {skipped.length} line{skipped.length > 1 ? 's were' : ' was'} not added: {skipped.slice(0, 3).map((s) => `line ${s.line} (${s.reason})`).join('; ')}{skipped.length > 3 ? '…' : ''}
          </Notice>
        )}

        <ul className="space-y-3" aria-label="Recipient rows">
          {rows.map((row, i) => (
            <li key={row.id} className="inner space-y-2 p-3">
              <div className="flex items-center justify-between">
                <span className="label">Recipient {i + 1}</span>
                <button type="button" aria-label={`Remove recipient ${i + 1}`} className="inline-flex size-10 items-center justify-center rounded-xl" style={{ color: 'var(--muted)' }} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== row.id) : [blank()]))}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <input className="field mono" placeholder="0x… address" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={row.address} onChange={(e) => { update(row.id, { address: e.target.value.trim() }); setTouched(true) }} aria-label={`Recipient ${i + 1} address`} aria-invalid={Boolean(rowIssue(row.id, 'address'))} />
              {rowIssue(row.id, 'address') && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{rowIssue(row.id, 'address')}</p>}
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <input className="field" inputMode="decimal" placeholder={`Amount (${symbol})`} value={row.amount} onChange={(e) => { const v = e.target.value.replace(/,/g, '.'); if (v === '' || /^\d*\.?\d*$/.test(v)) { update(row.id, { amount: v }); setTouched(true) } }} aria-label={`Recipient ${i + 1} amount`} aria-invalid={Boolean(rowIssue(row.id, 'amount'))} />
                <input className="field" placeholder="Label (optional)" maxLength={40} value={row.label ?? ''} onChange={(e) => update(row.id, { label: e.target.value })} aria-label={`Recipient ${i + 1} label`} />
              </div>
              {rowIssue(row.id, 'amount') && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{rowIssue(row.id, 'amount')}</p>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" disabled={rows.length >= MAX_PAYROLL_ROWS} onClick={() => setRows((rs) => [...rs, blank()])}><Plus className="size-4" /> Add recipient</button>
          <button className="btn btn-ghost" onClick={() => { setRows([blank(), blank()]); setSkipped([]); setTouched(false) }}>Clear</button>
        </div>

        <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
          <Row label="Recipients">{rows.filter((r) => r.address.trim() || r.amount.trim()).length}</Row>
          <Row label={`Total (${symbol})`}><span className="tabular-nums">{displayUsdc(check.total, 2, 6)}</span></Row>
        </div>
        {check.overBalance && <Notice tone="danger">The total is more than your {symbol} balance.</Notice>}
        {check.duplicates.length > 0 && <Notice tone="warn">{check.duplicates.map((d) => shortAddress(d)).join(', ')} appear more than once. That is allowed, but check it is intended.</Notice>}
        {touched && check.issues.length > 0 && <Notice tone="danger">{check.issues.length} problem{check.issues.length > 1 ? 's' : ''} to fix before you can review this batch.</Notice>}

        <div className="flex flex-wrap items-end gap-2">
          <button className="btn btn-primary flex-1" disabled={!check.ok || Boolean(run) || busy || !wallet.onArc} onClick={() => setReview(true)}>
            <Users className="size-4" /> Review batch
          </button>
        </div>
        {run && <p className="text-xs" style={{ color: 'var(--muted)' }}>Close the batch above before starting a new one.</p>}
        {!wallet.onArc && <Notice tone="warn" action={<button className="btn btn-primary" onClick={() => void wallet.switchToArc()} disabled={wallet.switching}>{wallet.switching && <Spinner />} Switch to Arc</button>}>Your wallet is on another network.</Notice>}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <input className="field min-w-0 flex-1" placeholder="Name this list to save it" maxLength={40} value={listName} onChange={(e) => setListName(e.target.value)} aria-label="List name" />
          <button className="btn btn-ghost" disabled={!listName.trim() || rows.every((r) => !r.address.trim())} onClick={() => { setSaved(saveList(address, listName, symbol, rows)); setListName(''); toast.success('List saved on this device') }}>Save list</button>
          {saved.length > 0 && <button className="btn btn-ghost" onClick={() => { const l = saved[0]; setSaved(deleteList(address, l.id)); toast.success(`Deleted "${l.name}"`) }}>Delete latest</button>}
        </div>
      </section>

      <ConfirmSheet open={review} onClose={() => setReview(false)} title="Review batch">
        <div className="mb-3 text-center">
          <p className="display text-3xl font-bold tabular-nums">{displayUsdc(check.total, 2, 6)} {symbol}</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>to {check.valid.length} recipient{check.valid.length > 1 ? 's' : ''} on Arc Mainnet</p>
        </div>
        <ul className="inner max-h-56 divide-y overflow-y-auto px-4" style={{ borderColor: 'var(--border)' }}>
          {check.valid.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">{r.label ? `${r.label} · ` : ''}<span className="mono">{shortAddress(r.to)}</span></span>
              <span className="tabular-nums">{formatUsdc(r.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Each transfer is sent straight from your wallet to the recipient. Quick Pay never holds the funds. Each one pays its own network fee in USDC.</p>
        <div className="mt-4 space-y-2">
          <button className="btn btn-primary w-full" onClick={() => void start('queue')}>Send one by one ({check.valid.length} wallet confirmation{check.valid.length > 1 ? 's' : ''})</button>
          {payout.canBatch ? (
            <button className="btn btn-ghost w-full" onClick={() => void start('batch')}>Send all with one approval</button>
          ) : (
            <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>{payout.capabilitiesLoading ? 'Checking whether your wallet can send these together…' : 'Your wallet does not offer to send these together, so each transfer is approved separately.'}</p>
          )}
        </div>
      </ConfirmSheet>
    </div>
  )
}
