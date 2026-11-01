import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { AmountInput } from '@/components/AmountInput'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { RequestShare } from '@/components/RequestShare'
import { EmptyState, ErrorState, Field, Notice, PageHeader, Skeleton, Spinner, StatusBadge } from '@/components/ui'
import { WalletButton } from '@/components/WalletButton'
import { useArcWallet } from '@/hooks/useArcWallet'
import { loadSession, useSession } from '@/hooks/useSession'
import { isServiceDown, ApiError } from '@/lib/api'
import { displayUsdc, formatDateTime } from '@/lib/format'
import { PaymentParseError, validateAmount } from '@/lib/payments'
import { requestsApi, STATUS_LABEL, STATUS_TONE, type RequestDto } from '@/lib/requests'
import { REQUEST_LIMITS, type SessionToken } from '../../shared/session'

const EXPIRY: { label: string; ms: number | null }[] = [
  { label: 'No expiry', ms: null },
  { label: '1 hour', ms: 3_600_000 },
  { label: '24 hours', ms: 86_400_000 },
  { label: '7 days', ms: 7 * 86_400_000 },
  { label: '30 days', ms: 30 * 86_400_000 },
]

export default function Requests() {
  const { address, isConnected } = useArcWallet()
  const { ensureSession } = useSession()
  const queryClient = useQueryClient()
  const [signedToken, setToken] = useState<SessionToken | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [expiry, setExpiry] = useState(0)
  const [createdFor, setCreated] = useState<{ address: string; request: RequestDto } | null>(null)
  const [shown, setShown] = useState<RequestDto | null>(null)

  // Session tokens live in sessionStorage; derive the current one instead of mirroring it into state.
  const token = signedToken && signedToken.address === address?.toLowerCase() ? signedToken : address ? loadSession(address) : null
  const created = createdFor && createdFor.address === address ? createdFor.request : null

  const parsed = useMemo(() => {
    if (!amount) return { error: null as string | null, raw: undefined as bigint | undefined }
    try {
      return { raw: validateAmount(amount, REQUEST_LIMITS.maxAmountRaw), error: null }
    } catch (e) {
      return { raw: undefined, error: e instanceof PaymentParseError ? e.message : 'Invalid amount' }
    }
  }, [amount])

  const list = useQuery({
    queryKey: ['requests', address, token?.signature],
    enabled: Boolean(token),
    retry: false,
    queryFn: async () => (await requestsApi.list(token as SessionToken)).requests,
  })

  const create = useMutation({
    mutationFn: async () => {
      const session = token ?? (await ensureSession())
      if (!session) throw new ApiError(401, 'cancelled', 'Sign-in cancelled.')
      setToken(session)
      const ms = EXPIRY[expiry].ms
      return requestsApi.create(session, {
        amount: (parsed.raw as bigint).toString(),
        description,
        expiresAt: ms ? new Date(Date.now() + ms).toISOString() : undefined,
      })
    },
    onSuccess: (request) => {
      if (address) setCreated({ address, request })
      setAmount('')
      setDescription('')
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      toast.success('Payment request created')
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'cancelled') return
      toast.error(error instanceof ApiError ? error.message : 'Could not create the request.')
    },
  })

  const cancel = useMutation({
    mutationFn: (id: string) => requestsApi.cancel(token as SessionToken, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
      toast.success('Request cancelled')
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not cancel the request.'),
  })

  if (!isConnected || !address) {
    return (
      <div>
        <PageHeader title="Payment Requests" subtitle="Ask someone to pay you a set amount of USDC with a shareable link or QR." />
        <div className="card"><EmptyState title="Connect a wallet" body="Requests are created for your wallet address and require a free signature to manage." action={<WalletButton />} /></div>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="lg:col-span-2">
        <PageHeader title="Payment Requests" subtitle="Create a link or QR that asks someone to pay you a set amount of USDC." />
        <Notice tone="info">
          A request is an <strong>off-chain record</strong> kept by FlowPay. It does not move any money. Funds move only when someone pays it and confirms in their own wallet, and a request turns Paid only after the payment is found on Arc.
        </Notice>
      </div>

      <section className="card space-y-4 p-5 self-start">
        <h2 className="display text-lg font-semibold">New request</h2>
        <AmountInput value={amount} onChange={setAmount} />
        {parsed.error && <p role="alert" className="-mt-2 text-xs" style={{ color: 'var(--danger)' }}>{parsed.error}</p>}
        <Field label="Description (optional)" hint={`${description.length}/${REQUEST_LIMITS.descriptionMax}`}>
          <input className="field" maxLength={REQUEST_LIMITS.descriptionMax} placeholder="Invoice #1042, lunch, design work…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Expires">
          <select className="field" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRY.map((e, i) => <option key={e.label} value={i}>{e.label}</option>)}
          </select>
        </Field>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Payments go to your connected address <span className="mono">{address.slice(0, 6)}…{address.slice(-4)}</span>. Creating a request needs a free wallet signature, no gas.</p>
        <button className="btn btn-primary w-full" disabled={!parsed.raw || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Spinner /> : <PenLine className="size-4" />} Create request
        </button>
      </section>

      <section className="space-y-4">
        {created && (
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="display text-lg font-semibold">Share this request</h2>
              <StatusBadge tone="warn">Unpaid</StatusBadge>
            </div>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>{displayUsdc(BigInt(created.amount))} USDC{created.description ? ` · ${created.description}` : ''}</p>
            <RequestShare id={created.id} />
          </div>
        )}

        <div className="card p-5">
          <h2 className="display mb-3 text-lg font-semibold">Your requests</h2>
          {!token ? (
            <EmptyState title="Sign in to see your requests" body="Requests are private to your wallet. Sign a free message to load them." action={<button className="btn btn-primary" onClick={() => void ensureSession().then(setToken)}>Sign in with wallet</button>} />
          ) : list.isLoading ? (
            <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : list.isError ? (
            <ErrorState
              title={isServiceDown(list.error) ? 'Requests service unavailable' : 'Could not load requests'}
              body={list.error instanceof ApiError && (list.error.code === 'session_expired' || list.error.code === 'unauthorized') ? 'Your session expired. Sign in again.' : 'Try again in a moment.'}
              onRetry={() => void (list.error instanceof ApiError && list.error.status === 401 ? ensureSession().then(setToken) : list.refetch())}
            />
          ) : list.data && list.data.length === 0 ? (
            <EmptyState title="No requests yet" body="Create your first request on the left." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {list.data?.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="display font-bold tabular-nums">{displayUsdc(BigInt(r.amount))} USDC</p>
                    <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{r.description || 'No description'} · {formatDateTime(r.createdAt)}</p>
                  </div>
                  <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost !min-h-[40px] !px-3" aria-label="Show link and QR" onClick={() => setShown(r)}><Link2 className="size-4" /></button>
                    {r.status === 'unpaid' && (
                      <button className="btn btn-danger !min-h-[40px] !px-3" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Cancel</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmSheet open={Boolean(shown)} onClose={() => setShown(null)} title="Payment request">
        {shown && (
          <div>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>{displayUsdc(BigInt(shown.amount))} USDC · {STATUS_LABEL[shown.status]}</p>
            <RequestShare id={shown.id} />
          </div>
        )}
      </ConfirmSheet>
    </div>
  )
}
