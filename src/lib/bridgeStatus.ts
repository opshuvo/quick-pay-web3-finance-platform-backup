import type { ProgressStep } from '@/components/BridgeProgress'
import type { ActivityDto } from '@/lib/activity'
import type { DepositStatus } from '@/lib/across'

export type Tracked =
  | { source: 'verified'; activity: ActivityDto }
  | { source: 'waiting'; reason: string }
  | { source: 'across'; status: DepositStatus | null }

export const isTerminal = (t: Tracked | undefined) =>
  t?.source === 'verified' ? (t.activity.status === 'filled' && t.activity.destinationVerified) || t.activity.status === 'expired' || t.activity.status === 'refunded'
  : t?.source === 'across' ? ['filled', 'expired', 'refunded'].includes(t.status?.status ?? '')
  : false

/** What the user sees. "Complete" requires a destination-chain receipt that the server read back as successful. */
export function trackedSummary(t: Tracked | undefined): { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral'; steps: ProgressStep[] } {
  const source: ProgressStep = { label: 'Source transaction confirmed', state: 'done' }
  if (!t) return { label: 'Checking…', tone: 'neutral', steps: [source, { label: 'Waiting for Across to index the deposit', state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
  if (t.source === 'waiting') {
    return { label: 'Waiting for Across', tone: 'neutral', steps: [source, { label: 'Waiting for Across to index the deposit', detail: t.reason, state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
  }
  if (t.source === 'across') {
    const s = t.status?.status
    if (s === 'filled') return { label: 'Filled (per Across)', tone: 'warn', steps: [source, { label: 'Relayer filled the transfer', state: 'done' }, { label: 'Destination not independently verified (history service offline)', state: 'active' }] }
    if (s === 'refunded') return { label: 'Refunded', tone: 'neutral', steps: [source, { label: 'Not filled in time', state: 'failed' }, { label: 'Refunded on the source chain', state: 'done' }] }
    if (s === 'expired') return { label: 'Expired', tone: 'danger', steps: [source, { label: 'Not filled before the deadline', state: 'failed' }, { label: 'Refund pending', state: 'active' }] }
    return { label: s === 'pending' ? 'In transit' : 'Waiting for Across', tone: 'neutral', steps: [source, { label: 'Across relayer is filling the transfer', state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
  }
  const a = t.activity
  if (a.status === 'filled' && a.destinationVerified) return { label: 'Complete', tone: 'success', steps: [source, { label: 'Relayer filled the transfer', state: 'done' }, { label: 'Delivery verified on destination chain', state: 'done' }] }
  if (a.status === 'filled') return { label: 'Filled, verifying', tone: 'warn', steps: [source, { label: 'Relayer filled the transfer', state: 'done' }, { label: 'Verifying the destination transaction', state: 'active' }] }
  if (a.status === 'refunded') return { label: 'Refunded', tone: 'neutral', steps: [source, { label: 'Not filled in time', state: 'failed' }, { label: 'Refunded on the source chain', state: 'done' }] }
  if (a.status === 'expired') return { label: 'Expired', tone: 'danger', steps: [source, { label: 'Not filled before the deadline', state: 'failed' }, { label: 'Refund pending', state: 'active' }] }
  return { label: 'In transit', tone: 'warn', steps: [source, { label: 'Across relayer is filling the transfer', state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
}
