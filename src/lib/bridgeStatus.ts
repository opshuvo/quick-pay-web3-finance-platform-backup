import type { ProgressStep } from '@/components/BridgeProgress'
import type { ActivityDto } from '@/lib/activity'
import type { DepositStatus } from '@/lib/across'
import type { LifiStatus } from '@/lib/lifi'
import { isCircleTerminal, type CircleTrack } from '@/lib/circleStatus'

export type Tracked =
  | { source: 'verified'; activity: ActivityDto }
  | { source: 'waiting'; reason: string }
  | { source: 'across'; status: DepositStatus | null }
  | { source: 'lifi'; status: LifiStatus | null; destinationVerified: boolean }
  | { source: 'circle'; track: CircleTrack }

export const isTerminal = (t: Tracked | undefined) =>
  t?.source === 'verified' ? (t.activity.status === 'filled' && t.activity.destinationVerified) || t.activity.status === 'expired' || t.activity.status === 'refunded'
  : t?.source === 'across' ? ['filled', 'expired', 'refunded'].includes(t.status?.status ?? '')
  : t?.source === 'circle' ? isCircleTerminal(t.track)
  : t?.source === 'lifi' ? t.status?.status === 'FAILED' || (t.status?.status === 'DONE' && (t.destinationVerified || t.status.substatus === 'REFUNDED'))
  : false

/** What the user sees. "Complete" requires a destination-chain receipt that the server read back as successful. */
export function trackedSummary(t: Tracked | undefined): { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral'; steps: ProgressStep[] } {
  const source: ProgressStep = { label: 'Source transaction confirmed', state: 'done' }
  if (!t) return { label: 'Checking…', tone: 'neutral', steps: [source, { label: 'Waiting for Across to index the deposit', state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
  if (t.source === 'waiting') {
    return { label: 'Waiting for Across', tone: 'neutral', steps: [source, { label: 'Waiting for Across to index the deposit', detail: t.reason, state: 'active' }, { label: 'Delivery on destination', state: 'todo' }] }
  }
  if (t.source === 'circle') {
    const k = t.track
    const burned: ProgressStep = { label: 'Burn confirmed on source chain', state: 'done' }
    const todo = (label: string): ProgressStep => ({ label, state: 'todo' })
    if (k.phase === 'source-pending') return { label: 'Confirming', tone: 'neutral', steps: [{ label: 'Waiting for the burn to confirm on the source chain', state: 'active' }, todo('Circle attestation'), todo('Mint on destination')] }
    if (k.phase === 'source-failed') return { label: 'Failed', tone: 'danger', steps: [{ label: 'The burn transaction failed on the source chain. Nothing was bridged.', state: 'failed' }] }
    if (k.phase === 'attesting') return { label: 'In transit', tone: 'warn', steps: [burned, { label: 'Waiting for Circle to attest the burn', detail: k.delayReason ? `Circle reports a delay: ${k.delayReason.replace(/_/g, ' ')}` : undefined, state: 'active' }, todo('Mint on destination')] }
    if (k.phase === 'awaiting-mint') return { label: 'Needs mint', tone: 'warn', steps: [burned, { label: 'Circle attested the burn', state: 'done' }, { label: 'Your USDC is not minted yet. Resume the transfer to mint it on the destination chain.', state: 'active' }] }
    if (k.phase === 'minting') return { label: 'In transit', tone: 'warn', steps: [burned, { label: 'Circle attested the burn', state: 'done' }, { label: k.hash ? 'Mint submitted, waiting for it to confirm' : 'Circle is submitting the mint on the destination chain', state: 'active' }] }
    if (k.phase === 'mint-failed') return { label: 'Mint failed', tone: 'danger', steps: [burned, { label: 'The mint transaction failed on the destination chain', state: 'failed' }, { label: 'Resume the transfer to retry the mint. Your burned USDC is not lost.', state: 'active' }] }
    return { label: 'Complete', tone: 'success', steps: [burned, { label: 'Circle attested the burn', state: 'done' }, { label: 'Mint verified on destination chain', state: 'done' }] }
  }
  if (t.source === 'lifi') {
    const s = t.status
    const wait = (label: string): ProgressStep[] => [source, { label, state: 'active' }, { label: 'Delivery on destination', state: 'todo' }]
    if (!s || s.status === 'NOT_FOUND' || s.status === 'INVALID') return { label: 'Waiting for LI.FI', tone: 'neutral', steps: wait('Waiting for LI.FI to index the transfer') }
    if (s.status === 'PENDING') return { label: 'In transit', tone: 'warn', steps: wait('LI.FI is moving the transfer') }
    if (s.status === 'FAILED') return { label: 'Failed', tone: 'danger', steps: [source, { label: s.substatusMessage ?? 'LI.FI reported the transfer failed', state: 'failed' }, { label: 'Check the source transaction and your balance', state: 'active' }] }
    if (s.substatus === 'REFUNDED') return { label: 'Refunded', tone: 'neutral', steps: [source, { label: 'Not delivered', state: 'failed' }, { label: 'Refunded on the source chain', state: 'done' }] }
    if (t.destinationVerified) return { label: 'Complete', tone: 'success', steps: [source, { label: 'LI.FI delivered the transfer', state: 'done' }, { label: 'Delivery verified on destination chain', state: 'done' }] }
    return { label: 'Delivered (per LI.FI)', tone: 'warn', steps: [source, { label: 'LI.FI reports the transfer delivered', state: 'done' }, { label: 'Destination receipt not independently verified yet', state: 'active' }] }
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
