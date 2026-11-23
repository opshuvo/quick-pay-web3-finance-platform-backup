import { ExplorerLink } from '@/components/ui'
import { StatusRing } from '@/components/StatusRing'
import { shortHash } from '@/lib/format'

interface Props {
  stage: 'idle' | 'wallet' | 'confirming' | 'success' | 'error'
  hash?: string
  error?: string
  txUrl?: (hash: string) => string
  walletText?: string
  successText?: string
}

/** Honest transaction status: every state shown here comes from a real wallet or receipt event. */
export function TxProgress({ stage, hash, error, txUrl, walletText = 'Confirm in your wallet…', successText = 'Confirmed on-chain' }: Props) {
  if (stage === 'idle') return null
  return (
    <div role="status" aria-live="polite" className="inner swap-in-up mt-4 p-4">
      {stage === 'wallet' && (
        <div className="fade-slide flex items-center gap-3">
          <StatusRing state="wallet" />
          <p className="text-sm font-semibold">{walletText}</p>
        </div>
      )}
      {stage === 'confirming' && (
        <div className="fade-slide flex items-center gap-3">
          <StatusRing state="pending" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold">Pending: waiting for confirmation…</p>
            {hash && <p className="mono truncate text-xs" style={{ color: 'var(--muted)' }}>{shortHash(hash)}</p>}
          </div>
        </div>
      )}
      {stage === 'success' && (
        <div className="fade-slide flex items-start gap-3">
          <StatusRing state="success" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>{successText}</p>
            {hash && (
              <p className="flex flex-wrap items-center gap-3 text-xs">
                <span className="mono break-all" style={{ color: 'var(--muted)' }}>{hash}</span>
                {txUrl && <ExplorerLink href={txUrl(hash)}>View on explorer</ExplorerLink>}
              </p>
            )}
          </div>
        </div>
      )}
      {stage === 'error' && (
        <div className="fade-slide flex items-start gap-3">
          <StatusRing state="failed" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{error ?? 'Something went wrong.'}</p>
            {hash && txUrl && <ExplorerLink href={txUrl(hash)}>View on explorer</ExplorerLink>}
          </div>
        </div>
      )}
    </div>
  )
}
