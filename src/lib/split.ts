/**
 * Split Payment logic (pure, no UI). A split is a bill divided between participants. Each
 * participant's share becomes one ordinary off-chain payment request (created through the
 * existing requests API) that the participant pays on Arc. A share counts as paid only after
 * the backend has verified the payment transaction on-chain.
 *
 * Bill details live on this device; paid status always comes from the verified requests.
 */
import { useSyncExternalStore } from 'react'
import { isAddress } from 'viem'
import { ARC_USDC } from '@/lib/arc'
import type { RequestStatus } from '../../shared/session'

export type SplitMode = 'equal' | 'custom'

export interface Participant {
  id: string
  name: string
  address: string
  /** Share in USDC base units (6 decimals), as a decimal string. */
  amount: string
  /** The organizer's own share is counted but never requested. */
  isOrganizer: boolean
  requestId?: string
}

export interface Split {
  id: string
  owner: string
  title: string
  description: string
  /** Bill total in USDC base units. */
  total: string
  mode: SplitMode
  expiresAt?: string
  participants: Participant[]
  createdAt: string
}

export const MAX_PARTICIPANTS = 12

/** Divides `total` into `count` shares that add up exactly; leftover units go to the first shares. */
export function equalShares(total: bigint, count: number): bigint[] {
  if (count <= 0 || total < 0n) return []
  const n = BigInt(count)
  const base = total / n
  const remainder = Number(total % n)
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1n : 0n))
}

export const sumShares = (shares: bigint[]) => shares.reduce((a, b) => a + b, 0n)

export interface SplitDraft {
  title: string
  total: bigint | undefined
  participants: { name: string; address: string; amount: bigint | undefined; isOrganizer: boolean }[]
  organizerAddress?: string
}

export interface SplitValidation {
  ok: boolean
  errors: string[]
  /** total minus the sum of shares: positive means unassigned, negative means over-assigned. */
  difference: bigint
}

export function validateSplit(draft: SplitDraft): SplitValidation {
  const errors: string[] = []
  if (!draft.title.trim()) errors.push('Give the bill a title.')
  if (draft.total === undefined || draft.total <= 0n) errors.push('Enter a bill total greater than zero.')
  if (draft.participants.length < 2) errors.push('Add at least two participants (or yourself and one other).')
  if (draft.participants.length > MAX_PARTICIPANTS) errors.push(`A split supports up to ${MAX_PARTICIPANTS} participants.`)

  const seen = new Set<string>()
  draft.participants.forEach((p, i) => {
    const label = p.name.trim() || `Participant ${i + 1}`
    if (!p.isOrganizer) {
      if (!isAddress(p.address, { strict: false })) {
        errors.push(`${label}: enter a valid wallet address.`)
      } else {
        const key = p.address.toLowerCase()
        if (/^0x0{40}$/.test(key)) errors.push(`${label}: the zero address cannot pay.`)
        else if (key === ARC_USDC.toLowerCase()) errors.push(`${label}: that is the USDC contract address.`)
        else if (draft.organizerAddress && key === draft.organizerAddress.toLowerCase()) errors.push(`${label}: that is your own address. Use "I'm part of this split" instead.`)
        else if (seen.has(key)) errors.push(`${label}: this address is already in the split.`)
        seen.add(key)
      }
    }
    if (p.amount === undefined || p.amount <= 0n) errors.push(`${label}: enter an amount greater than zero.`)
  })

  const assigned = sumShares(draft.participants.map((p) => p.amount ?? 0n))
  const difference = (draft.total ?? 0n) - assigned
  if (draft.total !== undefined && draft.total > 0n && difference !== 0n) {
    errors.push(difference > 0n ? 'Shares add up to less than the bill total.' : 'Shares add up to more than the bill total.')
  }
  return { ok: errors.length === 0, errors, difference }
}

export interface SplitSummary {
  total: bigint
  /** Organizer's own share: covered by the organizer, never requested. */
  own: bigint
  /** Verified on Arc. */
  paid: bigint
  /** Open requests waiting for payment. */
  pending: bigint
  /** Expired or cancelled requests, or shares not yet requested. */
  unpaid: bigint
}

export function summarizeSplit(split: Split, statuses: Record<string, RequestStatus | undefined>): SplitSummary {
  let own = 0n
  let paid = 0n
  let pending = 0n
  let unpaid = 0n
  for (const p of split.participants) {
    const amount = BigInt(p.amount)
    if (p.isOrganizer) own += amount
    else {
      const status = p.requestId ? statuses[p.requestId] : undefined
      if (status === 'paid') paid += amount
      else if (status === 'unpaid') pending += amount
      else unpaid += amount
    }
  }
  return { total: BigInt(split.total), own, paid, pending, unpaid }
}

/* ---------- device storage ---------- */

const KEY = 'quickpay.splits.v1'
const listeners = new Set<() => void>()
let version = 0

function readAll(): Split[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Split[]
  } catch {
    return []
  }
}

function writeAll(splits: Split[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(splits.slice(0, 100)))
  } catch {
    /* storage unavailable: the split lasts for this session only */
  }
  version += 1
  listeners.forEach((l) => l())
}

export const saveSplit = (split: Split) => writeAll([split, ...readAll().filter((s) => s.id !== split.id)])
export const deleteSplit = (id: string) => writeAll(readAll().filter((s) => s.id !== id))
export const loadSplit = (id: string, owner: string | undefined) => readAll().find((s) => s.id === id && s.owner === owner?.toLowerCase())

const cache: { version: number; all: Split[] } = { version: -1, all: [] }
const EMPTY: Split[] = []

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Stable snapshot: the same array is returned until a save/delete bumps the version. */
function snapshot(): Split[] {
  if (cache.version !== version) {
    cache.all = readAll()
    cache.version = version
  }
  return cache.all
}

export function useSplits(owner: string | undefined): Split[] {
  const all = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  return owner ? all.filter((s) => s.owner === owner.toLowerCase()) : EMPTY
}
