import { CheckCircle2, CircleAlert, Wallet } from 'lucide-react'
import { ExplorerLink, Spinner } from '@/components/ui'
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
    <div role="status" aria-live="polite" className="inner mt-4 p-4">
      {stage === 'wallet' && (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4" style={{ color: 'var(--accent)' }} /> {walletText}
        </p>
      )}
      {stage === 'confirming' && (
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Spinner /> Pending: waiting for confirmation…
          </p>
          {hash && <p className="mono text-xs" style={{ color: 'var(--muted)' }}>{shortHash(hash)}</p>}
        </div>
      )}
      {stage === 'success' && (
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--success)' }}>
            <CheckCircle2 className="size-4" /> {successText}
          </p>
          {hash && (
            <p className="flex flex-wrap items-center gap-3 text-xs">
              <span className="mono break-all" style={{ color: 'var(--muted)' }}>{hash}</span>
              {txUrl && <ExplorerLink href={txUrl(hash)}>View on explorer</ExplorerLink>}
            </p>
          )}
        </div>
      )}
      {stage === 'error' && (
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
            <CircleAlert className="size-4" /> {error ?? 'Something went wrong.'}
          </p>
          {hash && txUrl && <ExplorerLink href={txUrl(hash)}>View on explorer</ExplorerLink>}
        </div>
      )}
    </div>
  )
}
