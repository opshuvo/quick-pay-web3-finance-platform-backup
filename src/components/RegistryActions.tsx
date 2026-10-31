import { useState } from 'react'
import { erc20Abi, isAddress, keccak256, stringToHex, zeroAddress, type Address } from 'viem'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { useMutation } from '@tanstack/react-query'
import { AmountInput } from '@/components/AmountInput'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Field, Notice, Row, Spinner } from '@/components/ui'
import { quickPayRegistryAbi } from '@/contracts/quickPayRegistryAbi'
import { useArcWallet } from '@/hooks/useArcWallet'
import { ARC_CHAIN_ID, ARC_USDC, arcTxUrl } from '@/lib/arc'
import { parseTxError } from '@/lib/errors'
import { arcFeeParams } from '@/lib/fees'
import { displayUsdc, formatDateTime } from '@/lib/format'
import { PaymentParseError, validateAmount } from '@/lib/payments'

const STATUS = ['None', 'Open', 'Paid', 'Cancelled', 'Expired']

type Stage = 'idle' | 'wallet' | 'confirming' | 'success' | 'error'

/** Runs one or more contract writes in order and reports honest status. */
function useTxSequence() {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const [stage, setStage] = useState<Stage>('idle')
  const [hash, setHash] = useState<`0x${string}`>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const run = async (writes: (() => Promise<`0x${string}`>)[]) => {
    if (busy || !client) return false
    setBusy(true)
    setError(undefined)
    try {
      for (const write of writes) {
        setStage('wallet')
        const h = await write()
        setHash(h)
        setStage('confirming')
        const receipt = await client.waitForTransactionReceipt({ hash: h })
        if (receipt.status !== 'success') throw new Error('reverted')
      }
      setStage('success')
      return true
    } catch (e) {
      setError(parseTxError(e).message)
      setStage('error')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { stage, hash, error, busy, run, reset: () => setStage('idle'), writeContractAsync, client }
}

export function RegistryActions({ registry }: { registry: Address }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <CreateRequest registry={registry} />
      <PayRequest registry={registry} />
    </div>
  )
}

function CreateRequest({ registry }: { registry: Address }) {
  const wallet = useArcWallet()
  const tx = useTxSequence()
  const [amount, setAmount] = useState('')
  const [payer, setPayer] = useState('')
  const [hours, setHours] = useState('')
  const [ref, setRef] = useState('')

  let raw: bigint | undefined
  let amountError: string | null = null
  if (amount) {
    try {
      raw = validateAmount(amount)
    } catch (e) {
      amountError = e instanceof PaymentParseError ? e.message : 'Invalid amount'
    }
  }
  const payerOk = payer === '' || isAddress(payer)
  const hoursOk = hours === '' || (/^\d+$/.test(hours) && Number(hours) > 0 && Number(hours) <= 8760)
  const ready = wallet.onArc && raw !== undefined && payerOk && hoursOk && !tx.busy

  return (
    <section className="card space-y-4 p-5">
      <h3 className="display text-lg font-semibold">Create an on-chain request</h3>
      <Notice tone="info">Writes a request to the registry. It moves no funds: the payer later pays you directly.</Notice>
      <AmountInput value={amount} onChange={setAmount} />
      {amountError && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{amountError}</p>}
      <Field label="Restrict to payer (optional)" error={payerOk ? null : 'Enter a valid address.'}><input className="field mono" placeholder="0x… (leave empty for anyone)" value={payer} onChange={(e) => setPayer(e.target.value.trim())} /></Field>
      <Field label="Expires in hours (optional)" error={hoursOk ? null : 'Whole hours, 1 to 8760.'}><input className="field" inputMode="numeric" placeholder="No expiry" value={hours} onChange={(e) => setHours(e.target.value.trim())} /></Field>
      <Field label="Reference (optional)" hint="Only its hash is stored on-chain."><input className="field" maxLength={140} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <TxProgress stage={tx.stage} hash={tx.hash} error={tx.error} txUrl={arcTxUrl} successText="Request created on-chain" />
      <button
        className="btn btn-primary w-full"
        disabled={!ready}
        onClick={() => {
          if (raw === undefined || !tx.client) return
          const client = tx.client
          void (async () => {
          const expiresAt = hours ? BigInt(Math.floor(Date.now() / 1000) + Number(hours) * 3600) : 0n
          const fees = await arcFeeParams(client)
          await tx.run([
            () =>
              tx.writeContractAsync({
                address: registry,
                abi: quickPayRegistryAbi,
                functionName: 'createRequest',
                args: [raw, (payer || zeroAddress) as Address, expiresAt, ref ? keccak256(stringToHex(ref)) : `0x${'0'.repeat(64)}`],
                chainId: ARC_CHAIN_ID,
                ...fees,
              }),
          ])
          })()
        }}
      >
        {tx.busy && <Spinner />} {wallet.onArc ? 'Create request' : 'Switch to Arc first'}
      </button>
    </section>
  )
}

function PayRequest({ registry }: { registry: Address }) {
  const { address } = useAccount()
  const wallet = useArcWallet()
  const tx = useTxSequence()
  const [idText, setIdText] = useState('')
  const [open, setOpen] = useState(false)
  const id = /^\d{1,18}$/.test(idText) ? BigInt(idText) : undefined

  const request = useReadContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'getRequest', args: id ? [id] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: id !== undefined, refetchInterval: open ? false : 15_000 } })
  const status = useReadContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'statusOf', args: id ? [id] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: id !== undefined } })
  const allowance = useReadContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: address ? [address, registry] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: Boolean(address) } })

  const r = request.data
  const payable = Boolean(r && status.data === 1 && r.merchant !== zeroAddress)
  const needsApproval = r !== undefined && (allowance.data ?? 0n) < r.amount
  const enoughBalance = r !== undefined && wallet.balanceRaw !== undefined && wallet.balanceRaw >= r.amount
  const send = useMutation({
    mutationFn: async () => {
      if (!r || id === undefined || !tx.client) return
      const fees = await arcFeeParams(tx.client)
      const writes: (() => Promise<`0x${string}`>)[] = []
      // Approve only the exact amount, never an unlimited allowance.
      if (needsApproval) writes.push(() => tx.writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [registry, r.amount], chainId: ARC_CHAIN_ID, ...fees }))
      writes.push(() => tx.writeContractAsync({ address: registry, abi: quickPayRegistryAbi, functionName: 'pay', args: [id], chainId: ARC_CHAIN_ID, ...fees }))
      const ok = await tx.run(writes)
      if (ok) {
        void request.refetch()
        void status.refetch()
        void allowance.refetch()
      }
    },
  })

  return (
    <section className="card space-y-4 p-5">
      <h3 className="display text-lg font-semibold">Pay an on-chain request</h3>
      <Field label="Request ID"><input className="field" inputMode="numeric" placeholder="1" value={idText} onChange={(e) => setIdText(e.target.value.trim())} /></Field>
      {id !== undefined && request.isLoading && <Spinner />}
      {r && r.merchant !== zeroAddress && (
        <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
          <Row label="Status">{STATUS[Number(status.data ?? 0)] ?? '—'}</Row>
          <Row label="Amount">{displayUsdc(r.amount)} USDC</Row>
          <Row label="Merchant"><span className="mono break-all text-xs">{r.merchant}</span></Row>
          <Row label="Payer">{r.payer === zeroAddress ? 'Anyone' : <span className="mono break-all text-xs">{r.payer}</span>}</Row>
          <Row label="Expires">{r.expiresAt ? formatDateTime(Number(r.expiresAt) * 1000) : 'No expiry'}</Row>
        </div>
      )}
      {r && r.merchant === zeroAddress && id !== undefined && !request.isLoading && <Notice tone="warn">No request with that ID exists.</Notice>}
      <button className="btn btn-primary w-full" disabled={!payable || !wallet.onArc || !enoughBalance} onClick={() => { tx.reset(); setOpen(true) }}>
        {wallet.onArc ? 'Review and pay' : 'Switch to Arc first'}
      </button>
      {payable && !enoughBalance && <p className="text-xs" style={{ color: 'var(--danger)' }}>Your USDC balance is lower than the request amount.</p>}
      <ConfirmSheet open={open && Boolean(r)} onClose={() => setOpen(false)} title="Confirm on-chain payment" locked={tx.busy}>
        {r && (
          <div>
            <p className="display text-center text-4xl font-bold tabular-nums">{displayUsdc(r.amount)}</p>
            <p className="mb-3 text-center text-sm" style={{ color: 'var(--muted)' }}>USDC paid directly to the merchant</p>
            <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
              <Row label="Merchant"><span className="mono break-all text-xs">{r.merchant}</span></Row>
              <Row label="Steps">{needsApproval ? '1) Approve exact amount  2) Pay' : 'Pay'}</Row>
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--warn)' }}>Real USDC on Arc Mainnet. Irreversible. The registry never holds your funds.</p>
            <TxProgress stage={tx.stage} hash={tx.hash} error={tx.error} txUrl={arcTxUrl} successText="Paid on-chain" />
            {tx.stage === 'success' ? (
              <button className="btn btn-primary mt-4 w-full" onClick={() => setOpen(false)}>Done</button>
            ) : (
              <button className="btn btn-primary mt-4 w-full" disabled={tx.busy} onClick={() => send.mutate()}>{tx.busy && <Spinner />} Confirm and pay</button>
            )}
          </div>
        )}
      </ConfirmSheet>
    </section>
  )
}
