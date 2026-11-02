/**
 * A device-local record of the transactions this app submitted for a wallet, so History never hides one while it waits
 * or after it fails. Failed (reverted) transactions write no logs, and a pending one has none yet, so the chain scan
 * can not find either: this ledger is the only place they exist.
 *
 * It holds only what the wallet itself signed, with the status read from Arc's receipt (never guessed). A confirmed
 * entry is a receipt-verified success; once the chain scan lists the same transaction, History shows the scanned row
 * instead, so nothing is counted twice. Entries are per wallet, capped, and never leave the device.
 */
export type LedgerKind = 'send' | 'pay_request' | 'swap' | 'bridge'
export type LedgerStatus = 'pending' | 'confirmed' | 'failed'

export interface LedgerEntry {
  hash: string
  wallet: string
  kind: LedgerKind
  /** Who the money went to (the recipient, the router, or the bridge contract). */
  to: string
  /** Token contract and the raw amount in that token's own decimals. */
  token: string
  amount: string
  symbol: string | null
  decimals: number | null
  /** When the wallet signed, in milliseconds. */
  submittedAt: number
  status: LedgerStatus
}

const KEY = 'quickpay.txledger.v1'
const MAX_PER_WALLET = 60
const KEEP_RESOLVED_MS = 14 * 24 * 60 * 60 * 1000

type Store = Record<string, LedgerEntry[]>
let memory: Store | null = null
const listeners = new Set<() => void>()

function read(): Store {
  if (memory) return memory
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    memory = parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    memory = {}
  }
  return memory
}

function write(store: Store) {
  memory = store
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
  for (const listener of listeners) listener()
}

const norm = (value: string) => value.toLowerCase()

export function ledgerFor(wallet: string): LedgerEntry[] {
  return read()[norm(wallet)] ?? []
}

/** Called whenever the ledger changes (so History can refresh at once). */
export function onLedgerChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Records a submitted transaction. Adding the same hash again updates it instead of duplicating it. */
export function ledgerAdd(entry: Omit<LedgerEntry, 'status' | 'submittedAt'> & { status?: LedgerStatus; submittedAt?: number }) {
  const store = { ...read() }
  const wallet = norm(entry.wallet)
  const hash = norm(entry.hash)
  const now = Date.now()
  const current = (store[wallet] ?? []).filter((e) => now - e.submittedAt < KEEP_RESOLVED_MS || e.status === 'pending')
  const existing = current.find((e) => e.hash === hash)
  const next: LedgerEntry = { ...entry, wallet, hash, to: norm(entry.to), token: norm(entry.token), status: entry.status ?? existing?.status ?? 'pending', submittedAt: existing?.submittedAt ?? entry.submittedAt ?? now }
  store[wallet] = [next, ...current.filter((e) => e.hash !== hash)].slice(0, MAX_PER_WALLET)
  write(store)
}

/** A wallet sped a transaction up: the same payment now has a new hash. */
export function ledgerRehash(wallet: string, oldHash: string, newHash: string) {
  const store = { ...read() }
  const key = norm(wallet)
  const list = store[key]
  if (norm(oldHash) === norm(newHash) || !list?.some((e) => e.hash === norm(oldHash))) return
  store[key] = list.map((e) => (e.hash === norm(oldHash) ? { ...e, hash: norm(newHash) } : e))
  write(store)
}

/** Sets the status read from the receipt. An unknown hash is ignored. */
export function ledgerSetStatus(wallet: string, hash: string, status: LedgerStatus) {
  const store = { ...read() }
  const key = norm(wallet)
  const list = store[key]
  if (!list?.some((e) => e.hash === norm(hash) && e.status !== status)) return
  store[key] = list.map((e) => (e.hash === norm(hash) ? { ...e, status } : e))
  write(store)
}

/** Entries still waiting for a receipt: the engine re-checks them against Arc. */
export function ledgerPending(wallet: string): LedgerEntry[] {
  return ledgerFor(wallet).filter((e) => e.status === 'pending')
}

/** Test hook. */
export function resetLedger() {
  memory = null
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
