import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PaymentConfirm } from '@/components/PaymentConfirm'
import { AddressChip, ErrorState, ExplorerLink, Field, Notice, PageHeader, Row, Skeleton, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { ApiError } from '@/lib/api'
import { arcTxUrl } from '@/lib/arc'
import { displayUsdc, formatDateTime } from '@/lib/format'
import { requestsApi, STATUS_LABEL, STATUS_TONE } from '@/lib/requests'
import { getAddress } from 'viem'

export default function PayRequest() {
  const { id = '' } = useParams()
  const wallet = useArcWallet()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [manualHash, setManualHash] = useState('')

  const request = useQuery({
    queryKey: ['request', id],
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'unpaid' ? 15_000 : false),
    queryFn: () => requestsApi.get(id),
  })

  const verify = useMutation({
    mutationFn: (hash: string) => requestsApi.verify(id, hash),
    onSuccess: (r) => {
      queryClient.setQueryData(['request', id], r)
      if (r.status === 'paid') toast.success('Payment verified on Arc')
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not verify the payment.'),
  })

  if (request.isLoading) return <div className="mx-auto max-w-lg space-y-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
  if (request.isError || !request.data) {
    const notFound = request.error instanceof ApiError && request.error.status === 404
    return (
      <div className="mx-auto max-w-lg card">
        <ErrorState title={notFound ? 'Request not found' : 'Could not load this request'} body={notFound ? 'This payment request link is invalid or no longer exists.' : 'The Quick Pay service is not reachable right now.'} onRetry={notFound ? undefined : () => void request.refetch()} />
      </div>
    )
  }

  const r = request.data
  const amount = BigInt(r.amount)
  const recipient = getAddress(r.recipient)
  const isRecipient = wallet.address?.toLowerCase() === r.recipient
  const canPay = r.status === 'unpaid' && wallet.isConnected && !isRecipient

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Payment request" subtitle="Someone is asking you to pay in USDC on Arc Mainnet." />
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
          <span className="chip">Off-chain request</span>
        </div>
        <p className="display text-4xl font-bold tabular-nums">{displayUsdc(amount)} <span className="text-lg" style={{ color: 'var(--subtle)' }}>USDC</span></p>
        {r.description && <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--ink-2)' }}>{r.description}</p>}
        <div className="mt-4 divide-y" style={{ borderColor: 'var(--border)' }}>
          <Row label="Pay to"><AddressChip address={recipient} /></Row>
          <Row label="Created">{formatDateTime(r.createdAt)}</Row>
          <Row label="Expires">{r.expiresAt ? formatDateTime(r.expiresAt) : 'No expiry'}</Row>
          {r.status === 'paid' && r.paidTxHash && (
            <>
              <Row label="Paid">{r.paidAt ? formatDateTime(r.paidAt) : '—'}</Row>
              <Row label="Transaction"><ExplorerLink href={arcTxUrl(r.paidTxHash)}>View on explorer</ExplorerLink></Row>
            </>
          )}
        </div>

        {r.status === 'unpaid' && (
          <div className="mt-4">
            <Notice tone="warn">Only pay people you trust. Check that the recipient address above is the one you expect. Payments are irreversible.</Notice>
          </div>
        )}
        {r.status === 'expired' && <div className="mt-4"><Notice tone="info">This request expired and can no longer be settled. Ask the sender for a new one.</Notice></div>}
        {r.status === 'cancelled' && <div className="mt-4"><Notice tone="danger">The sender cancelled this request. Do not pay it.</Notice></div>}
        {isRecipient && r.status === 'unpaid' && <div className="mt-4"><Notice tone="info">This is your own request. Share its link from <Link to="/requests" className="font-semibold underline">Payment Requests</Link>.</Notice></div>}

        {r.status === 'unpaid' && !isRecipient && (
          <div className="mt-4">
            {wallet.isConnected ? (
              <button className="btn btn-primary w-full" disabled={!canPay} onClick={() => setOpen(true)}>Review and pay</button>
            ) : (
              <WalletButton className="w-full" />
            )}
          </div>
        )}
      </div>

      {r.status === 'unpaid' && (
        <details className="card mt-4 p-4">
          <summary className="min-h-[32px] cursor-pointer text-sm font-semibold">Already paid? Verify by transaction hash</summary>
          <div className="mt-3 space-y-3">
            <Field label="Transaction hash" hint="Quick Pay checks the payment on Arc before marking this request paid.">
              <input className="field mono" placeholder="0x…" value={manualHash} onChange={(e) => setManualHash(e.target.value.trim())} />
            </Field>
            <button className="btn btn-ghost w-full" disabled={!/^0x[0-9a-fA-F]{64}$/.test(manualHash) || verify.isPending} onClick={() => verify.mutate(manualHash)}>
              {verify.isPending && <Spinner />} Verify payment
            </button>
          </div>
        </details>
      )}

      {canPay && (
        <PaymentConfirm
          open={open}
          onClose={() => setOpen(false)}
          to={recipient}
          amount={amount}
          title="Pay request"
          note="After your payment confirms, Quick Pay checks it on Arc and marks the request paid."
          onSuccess={(hash) => verify.mutate(hash)}
        />
      )}
    </div>
  )
}
