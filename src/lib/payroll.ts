/**
 * Batch payouts. Pure logic, no UI and no wallet: parsing a pasted list, validating it, and running it one
 * recipient at a time with a state that can be saved and resumed.
 *
 * The rules that keep money safe:
 *  - A row is sent at most once. Once a wallet gave back a transaction hash the row can no longer be sent again,
 *    only checked against Arc again.
 *  - A row is Confirmed only when Arc's receipt for that transaction succeeded AND contains the exact token transfer
 *    to that recipient. A mined receipt without the transfer is Unverified, never success.
 *  - A declined wallet prompt, or any error before the wallet broadcast, pauses the queue instead of skipping ahead.
 */
import { isAddress, isAddressEqual, parseEventLogs, erc20Abi, type Address, type Hash, type Log } from 'viem'
import { PaymentParseError, validateRecipient, validateTokenAmount } from '@/lib/payments'
import type { PayToken } from '../../shared/tokens'

export const MAX_PAYROLL_ROWS = 50

export interface PayrollRow {
  id: string
  address: string
  /** Decimal text as typed, for example "125.50". */
  amount: string
  label?: string
}

export interface ParsedLine { line: number; text: string; reason: string }

let counter = 0
export const newRowId = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Reads a pasted list. One recipient per line: `address, amount` with an optional third column for a label.
 * Commas, semicolons, tabs and spaces all separate columns, so amounts are written without thousands separators.
 * A first line that is a header is skipped.
 */
export function parseRecipients(text: string): { rows: PayrollRow[]; skipped: ParsedLine[] } {
  const rows: PayrollRow[] = []
  const skipped: ParsedLine[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const parts = line.split(/[,;\t]|\s{2,}/).map((p) => p.trim()).filter(Boolean)
    const cols = parts.length >= 2 ? parts : line.split(/\s+/)
    const [address, amount, ...rest] = cols
    if (index === 0 && /^(address|wallet|recipient|to)\b/i.test(address ?? '')) return
    if (!address || !amount) {
      skipped.push({ line: index + 1, text: line.slice(0, 60), reason: 'Needs an address and an amount.' })
      return
    }
    if (rows.length >= MAX_PAYROLL_ROWS) {
      skipped.push({ line: index + 1, text: line.slice(0, 60), reason: `A batch holds at most ${MAX_PAYROLL_ROWS} recipients.` })
      return
    }
    rows.push({ id: newRowId(), address, amount, label: rest.join(' ').slice(0, 40) || undefined })
  })
  return { rows, skipped }
}

export interface RowIssue { id: string; field: 'address' | 'amount'; message: string }
export interface ValidRow { id: string; to: Address; amount: bigint; label?: string }

export interface PayrollValidation {
  valid: ValidRow[]
  issues: RowIssue[]
  /** Addresses that appear more than once. Allowed (it may be intended) but shown as a warning. */
  duplicates: string[]
  total: bigint
  overBalance: boolean
  tooMany: boolean
  /** True only when there is at least one row, every row is valid, and the total fits the balance. */
  ok: boolean
}

export function validatePayroll(rows: PayrollRow[], symbol: PayToken, sender: string | undefined, balance: bigint | undefined, decimals = 6): PayrollValidation {
  const valid: ValidRow[] = []
  const issues: RowIssue[] = []
  const seen = new Map<string, number>()
  for (const row of rows) {
    let to: Address | undefined
    let amount: bigint | undefined
    try {
      to = validateRecipient(row.address, sender)
    } catch (error) {
      issues.push({ id: row.id, field: 'address', message: error instanceof PaymentParseError ? error.message : 'Invalid address.' })
    }
    try {
      amount = validateTokenAmount(row.amount, symbol, decimals)
    } catch (error) {
      issues.push({ id: row.id, field: 'amount', message: error instanceof PaymentParseError ? error.message : 'Invalid amount.' })
    }
    if (to && amount !== undefined) {
      valid.push({ id: row.id, to, amount, label: row.label })
      seen.set(to.toLowerCase(), (seen.get(to.toLowerCase()) ?? 0) + 1)
    }
  }
  const total = valid.reduce((sum, r) => sum + r.amount, 0n)
  const overBalance = balance !== undefined && total > balance
  const tooMany = rows.length > MAX_PAYROLL_ROWS
  return {
    valid,
    issues,
    duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([a]) => a),
    total,
    overBalance,
    tooMany,
    ok: rows.length > 0 && issues.length === 0 && !overBalance && !tooMany,
  }
}

// ---- running a batch -------------------------------------------------------------------------------------------------------

export type RowState = 'queued' | 'wallet' | 'pending' | 'confirmed' | 'failed' | 'unverified'

export interface RunRow {
  id: string
  to: Address
  /** Base units, as a decimal string so it survives JSON. */
  amount: string
  label?: string
  state: RowState
  hash?: Hash
  error?: string
}

export interface PayrollRun {
  id: string
  wallet: string
  token: PayToken
  mode: 'queue' | 'batch'
  createdAt: number
  rows: RunRow[]
  /** Why the queue stopped, when it did. The user can resume. */
  paused?: string
  /** For one-approval batches: the wallet's id for the whole bundle, so it can be checked again after a reload. */
  callsId?: string
}

export function newRun(wallet: string, token: PayToken, mode: PayrollRun['mode'], valid: ValidRow[]): PayrollRun {
  return {
    id: `run-${Date.now().toString(36)}`,
    wallet: wallet.toLowerCase(),
    token,
    mode,
    createdAt: Date.now(),
    rows: valid.map((r) => ({ id: r.id, to: r.to, amount: r.amount.toString(), label: r.label, state: 'queued' as const })),
  }
}

export interface RunSummary {
  total: number
  confirmed: number
  pending: number
  failed: number
  unverified: number
  queued: number
  /** Nothing is waiting on the wallet or on Arc and nothing is queued. */
  finished: boolean
  confirmedAmount: bigint
}

export function summarizeRun(run: PayrollRun): RunSummary {
  const count = (s: RowState) => run.rows.filter((r) => r.state === s).length
  const queued = count('queued')
  const pending = count('pending') + count('wallet')
  return {
    total: run.rows.length,
    confirmed: count('confirmed'),
    pending,
    failed: count('failed'),
    unverified: count('unverified'),
    queued,
    finished: queued === 0 && pending === 0,
    confirmedAmount: run.rows.filter((r) => r.state === 'confirmed').reduce((s, r) => s + BigInt(r.amount), 0n),
  }
}

/** A failed row may be retried only when we know no money moved: it never reached the chain, or its receipt reverted. */
export const canRetry = (row: RunRow) => row.state === 'failed'

/** Puts failed rows back in the queue. Rows that are pending, unverified or confirmed are never touched. */
export function retryFailed(run: PayrollRun): PayrollRun {
  return { ...run, paused: undefined, rows: run.rows.map((r) => (canRetry(r) ? { id: r.id, to: r.to, amount: r.amount, label: r.label, state: 'queued' as const } : r)) }
}

export interface QueueDeps {
  /** Asks the wallet to sign one transfer. Resolves with the hash once the wallet broadcast it. Throws if declined. */
  send: (row: RunRow) => Promise<Hash>
  /** Reads Arc for the final outcome of a transaction (and follows a wallet speed-up). */
  confirm: (hash: Hash, row: RunRow) => Promise<{ state: 'confirmed' | 'failed' | 'unverified'; hash?: Hash; error?: string }>
  /** True when the error means the person declined in their wallet. */
  isRejection: (error: unknown) => boolean
  describe: (error: unknown) => string
  /** Called after every change so the caller can save and draw it. */
  onChange: (run: PayrollRun) => void
}

/** Asks Arc again about every row the wallet already broadcast. Never sends anything. */
export async function recheckPending(initial: PayrollRun, deps: Pick<QueueDeps, 'confirm' | 'onChange'>): Promise<PayrollRun> {
  let run: PayrollRun = { ...initial }
  for (const row of run.rows.filter((r) => r.hash && (r.state === 'pending' || r.state === 'wallet'))) {
    try {
      const out = await deps.confirm(row.hash as Hash, row)
      run = { ...run, rows: run.rows.map((r) => (r.id === row.id ? { ...r, state: out.state, hash: out.hash ?? row.hash, error: out.error } : r)) }
    } catch {
      run = { ...run, rows: run.rows.map((r) => (r.id === row.id ? { ...r, state: 'pending' as const, error: 'Arc could not be reached to check this transfer. It may still complete.' } : r)) }
    }
    deps.onChange(run)
  }
  return run
}

/**
 * Runs the queue one row at a time. Safe to call again after a reload: rows that already hold a hash are only checked,
 * never sent again. Returns the final run state.
 */
export async function runQueue(initial: PayrollRun, deps: QueueDeps): Promise<PayrollRun> {
  let run: PayrollRun = { ...initial, paused: undefined }
  const update = (id: string, patch: Partial<RunRow>) => {
    run = { ...run, rows: run.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
    deps.onChange(run)
  }
  deps.onChange(run)

  // 1. Rows the wallet already broadcast: only ask Arc again. If one still cannot be read, stop before sending more.
  run = await recheckPending(run, deps)
  const unreadable = run.rows.find((r) => r.state === 'pending' && r.hash)
  if (unreadable) {
    run = { ...run, paused: 'Paused: a transfer is still waiting for Arc to confirm it. Resume to check it again before anything else is sent.' }
    deps.onChange(run)
    return run
  }

  // 2. Rows not yet sent, in order.
  for (const row of run.rows.filter((r) => r.state === 'queued' && !r.hash)) {
    update(row.id, { state: 'wallet', error: undefined })
    let hash: Hash
    try {
      hash = await deps.send(row)
    } catch (error) {
      // Nothing was broadcast. Put the row back and stop, so the person decides what to do next.
      update(row.id, { state: 'queued' })
      run = { ...run, paused: deps.isRejection(error) ? `Paused: you declined the transfer to ${row.to.slice(0, 6)}…${row.to.slice(-4)}.` : `Paused: ${deps.describe(error)}` }
      deps.onChange(run)
      return run
    }
    update(row.id, { state: 'pending', hash })
    try {
      const out = await deps.confirm(hash, row)
      update(row.id, { state: out.state, hash: out.hash ?? hash, error: out.error })
    } catch {
      // Broadcast but not readable yet: it stays pending and is never sent again. The queue stops here rather than piling
      // more transfers on top of one whose outcome is unknown.
      update(row.id, { state: 'pending', error: 'Arc could not be reached to check this transfer. It may still complete.' })
      run = { ...run, paused: 'Paused: Arc could not be reached to check the last transfer. Resume to check it again before anything else is sent.' }
      deps.onChange(run)
      return run
    }
  }
  return run
}

// ---- one-approval batches (EIP-5792) ---------------------------------------------------------------------------------------

/** Minimal shape of a receipt as read back from Arc. */
export interface ReadReceipt { transactionHash: Hash; status: 'success' | 'reverted'; logs: readonly Log[] }

/**
 * Matches each row to a Transfer of its token, from the sender to its recipient, for its exact amount, among the logs of
 * the receipts Arc returned. Each log can satisfy only one row, so two identical rows need two transfers.
 */
export function matchBatchReceipts(rows: RunRow[], receipts: ReadReceipt[], token: Address, sender: Address): Record<string, { hash: Hash } | undefined> {
  const found: { hash: Hash; from: Address; to: Address; value: bigint; used: boolean }[] = []
  for (const receipt of receipts) {
    if (receipt.status !== 'success') continue
    const own = receipt.logs.filter((l) => l.address.toLowerCase() === token.toLowerCase())
    for (const log of parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: own, strict: false })) {
      if (log.args.from && log.args.to && log.args.value !== undefined) found.push({ hash: receipt.transactionHash, from: log.args.from, to: log.args.to, value: log.args.value, used: false })
    }
  }
  const out: Record<string, { hash: Hash } | undefined> = {}
  for (const row of rows) {
    const hit = found.find((f) => !f.used && f.value === BigInt(row.amount) && isAddressEqual(f.from, sender) && isAddressEqual(f.to, row.to))
    if (hit) hit.used = true
    out[row.id] = hit ? { hash: hit.hash } : undefined
  }
  return out
}

/** True when a wallet's capability report says it can run a list of calls atomically on this chain. */
export function supportsAtomicBatch(capabilities: unknown, chainId: number): boolean {
  if (!capabilities || typeof capabilities !== 'object') return false
  const all = capabilities as Record<string | number, unknown>
  const forChain = (all[chainId] ?? all[`0x${chainId.toString(16)}`]) as { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } } | undefined
  if (!forChain) return false
  const status = forChain.atomic?.status
  return status === 'supported' || status === 'ready' || forChain.atomicBatch?.supported === true
}

export const isValidAddress = (value: string) => isAddress(value, { strict: false })

// ---- reloads ----------------------------------------------------------------------------------------------------------------

/**
 * A page that closed while the wallet was asking leaves a row in "wallet" with no hash. Nobody can tell whether it was
 * broadcast, so it becomes Unverified, never queued again on its own.
 */
export function normalizeLoadedRun(run: PayrollRun): PayrollRun {
  return {
    ...run,
    rows: run.rows.map((r) =>
      r.state === 'wallet' && !r.hash
        ? { ...r, state: 'unverified' as const, error: 'The page closed while your wallet was asking, so we cannot tell whether this was sent. Check your wallet and History before sending it again.' }
        : r,
    ),
  }
}

/** The person confirmed a row without a hash was not sent. Only such rows can be queued this way. */
export function requeueUnsent(run: PayrollRun, id: string): PayrollRun {
  return { ...run, paused: undefined, rows: run.rows.map((r) => (r.id === id && r.state === 'unverified' && !r.hash ? { id: r.id, to: r.to, amount: r.amount, label: r.label, state: 'queued' as const } : r)) }
}

// ---- saved lists and the active run (on this device) -----------------------------------------------------------------------

const LISTS_KEY = 'quickpay.payroll.lists.v1'
const RUN_KEY = 'quickpay.payroll.run.v1'

export interface SavedList { id: string; name: string; token: PayToken; rows: PayrollRow[]; savedAt: number }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the batch still runs, it just cannot be resumed after a reload */
  }
}

export const loadLists = (wallet: string): SavedList[] => {
  const all = read<SavedList[]>(`${LISTS_KEY}:${wallet.toLowerCase()}`, [])
  return Array.isArray(all) ? all.filter((l) => l && typeof l.name === 'string' && Array.isArray(l.rows)) : []
}
export function saveList(wallet: string, name: string, token: PayToken, rows: PayrollRow[]): SavedList[] {
  const clean = name.trim().slice(0, 40)
  if (!clean) return loadLists(wallet)
  const others = loadLists(wallet).filter((l) => l.name.toLowerCase() !== clean.toLowerCase())
  const next = [{ id: `l${Date.now().toString(36)}`, name: clean, token, rows: rows.map((r) => ({ ...r })), savedAt: Date.now() }, ...others].slice(0, 20)
  write(`${LISTS_KEY}:${wallet.toLowerCase()}`, next)
  return next
}
export function deleteList(wallet: string, id: string): SavedList[] {
  const next = loadLists(wallet).filter((l) => l.id !== id)
  write(`${LISTS_KEY}:${wallet.toLowerCase()}`, next)
  return next
}

export const loadRun = (wallet: string): PayrollRun | null => {
  const run = read<PayrollRun | null>(`${RUN_KEY}:${wallet.toLowerCase()}`, null)
  return run && Array.isArray(run.rows) && run.wallet === wallet.toLowerCase() ? normalizeLoadedRun(run) : null
}
export const saveRun = (run: PayrollRun) => write(`${RUN_KEY}:${run.wallet}`, run)
export const clearRun = (wallet: string) => {
  try {
    localStorage.removeItem(`${RUN_KEY}:${wallet.toLowerCase()}`)
  } catch {
    /* ignore */
  }
}
