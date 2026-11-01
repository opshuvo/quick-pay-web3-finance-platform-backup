import { useRef, useState } from 'react'
import { erc20Abi, isAddress, keccak256, stringToHex, zeroAddress, type Address, type Hash, type TransactionReceipt } from 'viem'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recordConfirmedTx } from '@/lib/chainHistory/record'
import { AmountInput } from '@/components/AmountInput'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Field, Notice, Row, Spinner } from '@/components/ui'
import { quickPayRegistryAbi } from '@/contracts/quickPayRegistryAbi'
import { useArcWallet } from '@/hooks/useArcWallet'
import { ARC_CHAIN_ID, ARC_USDC, arcTxUrl } from '@/lib/arc'
import { confirmTx, TxFlowError } from '@/lib/confirmTx'
import { parseTxError } from '@/lib/errors'
import { arcFeeParams } from '@/lib/fees'
import { displayUsdc, formatDateTime } from '@/lib/format'
import { PaymentParseError, validateAmount } from '@/lib/payments'
import { confirmCreated, confirmPaid } from '@/lib/registryEvents'

const STATUS = ['None', 'Open', 'Paid', 'Cancelled', 'Expired']

type Stage = 'idle' | 'wallet' | 'confirming' | 'success' | 'error'

interface Step {
  write: () => Promise<Hash>
  /** Returns a problem description when the mined receipt does not contain what this step was meant to do. */
  verify?: (receipt: TransactionReceipt) => string | null
}

/**
 * Runs contract writes in order and reports honest status. One run at a time (a ref guards double clicks, not just
 * React state). A step counts only when its receipt is for the submitted transaction, succeeded, and passes `verify`.
 */
function useTxSequence() {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { address: account } = useAccount()
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const [stage, setStage] = useState<Stage>('idle')
  const [hash, setHash] = useState<`0x${string}`>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const fail = (message: string) => {
    setError(message)
    setStage('error')
  }

  const run = async (steps: Step[]) => {
    if (lock.current || !client) return false
    lock.current = true
    setBusy(true)
    setError(undefined)
    setHash(undefined)
    try {
      for (const step of steps) {
        setStage('wallet')
        const submitted = await step.write()
        setHash(submitted)
        setStage('confirming')
        const { hash: mined, receipt } = await confirmTx(client, submitted)
        setHash(mined)
        if (receipt.status !== 'success') throw new TxFlowError('The transaction was mined but failed on-chain. No funds moved.')
        const problem = step.verify?.(receipt)
        if (problem) throw new TxFlowError(problem)
        // The payment or request that was just confirmed is listed in History straight away.
        if (step.verify && account) void recordConfirmedTx({ address: account, hash: mined, queryClient })
      }
      setStage('success')
      return true
    } catch (e) {
      fail(e instanceof TxFlowError ? e.message : parseTxError(e).message)
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { stage, hash, error, busy, run, fail, reset: () => setStage('idle'), writeContractAsync, client }
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
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const wallet = useArcWallet()
  const tx = useTxSequence()
  const [amount, setAmount] = useState('')
  const [payer, setPayer] = useState('')
  const [hours, setHours] = useState('')
  const [ref, setRef] = useState('')
  const [createdId, setCreatedId] = useState<bigint>()

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
      <TxProgress stage={tx.stage} hash={tx.hash} error={tx.error} txUrl={arcTxUrl} successText={createdId !== undefined ? `Request #${createdId.toString()} created on-chain` : 'Request created on-chain'} />
      <button
        className="btn btn-primary w-full"
        disabled={!ready}
        onClick={() => {
          if (raw === undefined || !tx.client || !address) return
          const client = tx.client
          const amountRaw = raw
          void (async () => {
            const expiresAt = hours ? BigInt(Math.floor(Date.now() / 1000) + Number(hours) * 3600) : 0n
            setCreatedId(undefined)
            const ok = await tx.run([
              {
                write: async () => {
                  const fees = await arcFeeParams(client)
                  return tx.writeContractAsync({
                    address: registry,
                    abi: quickPayRegistryAbi,
                    functionName: 'createRequest',
                    args: [amountRaw, (payer || zeroAddress) as Address, expiresAt, ref ? keccak256(stringToHex(ref)) : `0x${'0'.repeat(64)}`],
                    chainId: ARC_CHAIN_ID,
                    ...fees,
                  })
                },
                // Only a RequestCreated event from this registry, for this wallet and amount, proves the request exists.
                verify: (receipt) => {
                  const created = confirmCreated(receipt.logs, registry, address, amountRaw)
                  if (!created) return 'The transaction was mined, but no matching request was created. Check the explorer before trying again.'
                  setCreatedId(created.id)
                  return null
                },
              },
            ])
            if (ok) void queryClient.invalidateQueries({ queryKey: ['readContract'] })
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
  const queryClient = useQueryClient()
  const wallet = useArcWallet()
  const tx = useTxSequence()
  const [idText, setIdText] = useState('')
  const [open, setOpen] = useState(false)
  const id = /^\d{1,18}$/.test(idText) ? BigInt(idText) : undefined

  const request = useReadContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'getRequest', args: id ? [id] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: id !== undefined, refetchInterval: open ? false : 15_000 } })
  const status = useReadContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'statusOf', args: id ? [id] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: id !== undefined } })
  const allowance = useReadContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: address ? [address, registry] : undefined, chainId: ARC_CHAIN_ID, query: { enabled: Boolean(address) } })

  const r = request.data
  const restrictedToOther = Boolean(r && r.payer !== zeroAddress && address && r.payer.toLowerCase() !== address.toLowerCase())
  const payable = Boolean(r && status.data === 1 && r.merchant !== zeroAddress && !restrictedToOther)
  const needsApproval = r !== undefined && (allowance.data ?? 0n) < r.amount
  const enoughBalance = r !== undefined && wallet.balanceRaw !== undefined && wallet.balanceRaw >= r.amount
  const send = useMutation({
    mutationFn: async () => {
      const client = tx.client
      if (!r || id === undefined || !client || !address) return
      // Re-read the chain right before signing: the request, its status and the allowance may have changed since the review.
      const [fresh, freshStatus, freshAllowance] = await Promise.all([
        client.readContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'getRequest', args: [id] }),
        client.readContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'statusOf', args: [id] }),
        client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: [address, registry] }),
      ]).catch(() => [undefined, undefined, undefined] as const)
      if (!fresh || freshStatus === undefined || freshAllowance === undefined) return tx.fail('Could not re-check this request on Arc. Nothing was sent. Try again.')
      if (freshStatus !== 1) return tx.fail('This request is no longer open, so nothing was sent.')
      if (fresh.amount !== r.amount || fresh.merchant.toLowerCase() !== r.merchant.toLowerCase()) return tx.fail('This request changed since you reviewed it. Nothing was sent. Review it again.')
      if (fresh.payer !== zeroAddress && fresh.payer.toLowerCase() !== address.toLowerCase()) return tx.fail('This request is restricted to a different payer. Nothing was sent.')
      const steps: Step[] = []
      // Approve only the exact amount, never an unlimited allowance.
      if (freshAllowance < fresh.amount) {
        steps.push({ write: async () => tx.writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [registry, fresh.amount], chainId: ARC_CHAIN_ID, ...(await arcFeeParams(client)) }) })
      }
      steps.push({
        write: async () => tx.writeContractAsync({ address: registry, abi: quickPayRegistryAbi, functionName: 'pay', args: [id], chainId: ARC_CHAIN_ID, ...(await arcFeeParams(client)) }),
        // Only a PaymentReceived event from this registry for this request, payer, merchant and amount proves it was paid.
        verify: (receipt) =>
          confirmPaid(receipt.logs, registry, { id, payer: address, merchant: fresh.merchant, amount: fresh.amount })
            ? null
            : 'The transaction was mined, but this request was not marked paid. Check the explorer before trying again.',
      })
      const ok = await tx.run(steps)
      void request.refetch()
      void status.refetch()
      void allowance.refetch()
      if (ok) void queryClient.invalidateQueries({ queryKey: ['readContract'] })
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
      {restrictedToOther && <Notice tone="warn">This request is restricted to a different payer, so your wallet cannot pay it.</Notice>}
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
