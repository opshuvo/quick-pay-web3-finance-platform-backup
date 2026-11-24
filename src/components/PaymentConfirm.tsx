import { useEffect } from 'react'
import { erc20Abi, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { TxProgress } from '@/components/TxProgress'
import { Notice, Row, Spinner } from '@/components/ui'
import { useArcWallet } from '@/hooks/useArcWallet'
import { useRouter } from '@/hooks/useRouter'
import { useSendUsdc } from '@/hooks/useSendUsdc'
import { estimateRouterSendGas } from '@/lib/routerSend'
import { ARC_CHAIN_ID, ARC_USDC, arcTxUrl } from '@/lib/arc'
import { describeSimulationError, shouldRetrySimulation } from '@/lib/simulationError'
import { retryDelay } from '@/lib/arcRpc'
import { arcFeeParams, gasCostToUsdc } from '@/lib/fees'
import { displayUsdc, shortAddress } from '@/lib/format'
import { isUsdcToken, type PayTokenInfo } from '@/lib/payTokens'

interface Props {
  open: boolean
  onClose: () => void
  to: Address
  amount: bigint
  title?: string
  note?: string
  /** Token to send. Omitted means USDC. Any other token is a direct transfer, never through the Quick Pay contract. */
  token?: PayTokenInfo & { balance?: bigint }
  onSuccess?: (hash: `0x${string}`) => void
}

/**
 * The single confirmation step in front of every USDC payment: shows exactly what will be
 * sent, checks balance + network fee against live data, and only then asks the wallet to sign.
 */
export function PaymentConfirm({ open, onClose, to, amount, title = 'Review payment', note, token, onSuccess }: Props) {
  const { address } = useAccount()
  const wallet = useArcWallet()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { state, send, reset, busy } = useSendUsdc()
  const { address: routerAddress, isLoading: routerIsLoading, problem: routerProblemRaw } = useRouter()
  const isUsdc = !token || isUsdcToken(token)
  const symbol = token?.symbol ?? 'USDC'
  // The Quick Pay contract only handles USDC; other tokens are sent straight to the recipient.
  const router = isUsdc ? routerAddress : undefined
  const routerLoading = isUsdc && routerIsLoading
  const routerProblem = isUsdc ? routerProblemRaw : null
  const tokenBalance = isUsdc ? wallet.balanceRaw : token?.balance

  const fee = useQuery({
    queryKey: ['fee-estimate', address, to, amount.toString(), router, token?.address],
    // An amount above the balance cannot be simulated (the token would revert); it is reported as a low balance instead.
    enabled: open && Boolean(address && publicClient && wallet.onArc) && !routerLoading && !(tokenBalance !== undefined && amount > tokenBalance),
    // A temporary RPC failure is retried; a real revert is not.
    retry: shouldRetrySimulation,
    retryDelay,
    refetchInterval: open ? 20_000 : false,
    queryFn: async () => {
      if (!publicClient || !address) throw new Error('no client')
      const [gas, fees] = await Promise.all([
        router
          ? estimateRouterSendGas(publicClient, address, router, to, amount)
          : publicClient.estimateContractGas({ account: address, address: token?.address ?? ARC_USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
        arcFeeParams(publicClient),
      ])
      return { gas, usdc: gasCostToUsdc(gas, fees.maxFeePerGas) }
    },
  })

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const balance = tokenBalance
  // Gas on Arc is always paid in USDC. For USDC the fee comes out of the same balance as the amount; for another token it is a separate USDC check.
  const total = fee.data && isUsdc ? amount + fee.data.usdc : undefined
  const gasShort = !isUsdc && fee.data !== undefined && wallet.balanceRaw !== undefined && fee.data.usdc > wallet.balanceRaw
  const insufficient = balance !== undefined && (amount > balance || (total !== undefined && total > balance))
  const done = state.stage === 'success'
  // With a Quick Pay contract configured, a payment waits until it is verified instead of silently going direct.
  const routerHeld = routerLoading || routerProblem === 'unreachable'
  const canConfirm = wallet.onArc && fee.isSuccess && !insufficient && !gasShort && !busy && !done && balance !== undefined && !routerHeld

  return (
    <ConfirmSheet open={open} onClose={onClose} title={title} locked={busy}>
      <div className="mb-4 text-center">
        <p className="display text-4xl font-bold tabular-nums">{displayUsdc(amount)}</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{symbol} on Arc Mainnet</p>
      </div>
      <div className="inner divide-y px-4" style={{ borderColor: 'var(--border)' }}>
        <Row label="From">{address ? <span className="mono">{shortAddress(address)}</span> : '—'}</Row>
        <Row label="To"><span className="mono break-all">{to}</span></Row>
        {router && <Row label="Via"><span className="mono break-all text-xs">Quick Pay contract {shortAddress(router)}</span></Row>}
        <Row label="Network fee">
          {!wallet.onArc ? 'Switch to Arc' : fee.isLoading ? 'Estimating…' : fee.data ? `≈ ${displayUsdc(fee.data.usdc, 4, 6)} USDC${isUsdc ? '' : ' (gas is paid in USDC)'}` : 'Unavailable'}
        </Row>
        <Row label="Total debited">{isUsdc ? (total !== undefined ? `${displayUsdc(total, 2, 6)} USDC` : '—') : fee.data ? `${displayUsdc(amount, 2, 6)} ${symbol} + ≈ ${displayUsdc(fee.data.usdc, 4, 6)} USDC fee` : '—'}</Row>
      </div>
      {note && <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>{note}</p>}
      {router && <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>This payment goes through the Quick Pay contract, which sends your USDC straight to the recipient and never holds it. If it needs permission first, your wallet asks you to approve exactly this amount, then to pay.</p>}

      <div className="mt-3 space-y-2">
        {routerProblem === 'unreachable' && <Notice tone="warn">Could not verify the Quick Pay contract on Arc right now, so this payment is on hold. Retrying automatically.</Notice>}
        {routerProblem && routerProblem !== 'unreachable' && (
          <Notice tone="warn">The Quick Pay contract is {routerProblem === 'paused' ? 'paused' : routerProblem === 'wrong-usdc' ? 'not set up for the official USDC' : 'not found on Arc'}, so this payment is sent as a direct USDC transfer.</Notice>
        )}
        {fee.isError && wallet.onArc && (() => {
          const problem = describeSimulationError(fee.error)
          return <Notice tone={problem.kind === 'busy' ? 'warn' : 'danger'}>{problem.message}</Notice>
        })()}
        {insufficient && <Notice tone="danger">Balance too low: {isUsdc ? 'the amount plus network fee is' : 'the amount is'} more than your {displayUsdc(balance ?? 0n)} {symbol}.</Notice>}
        {gasShort && <Notice tone="danger">Not enough USDC to pay the network fee. Gas on Arc is paid in USDC, so add a little USDC first.</Notice>}
        <p className="flex items-start gap-2 text-xs" style={{ color: 'var(--warn)' }}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          This moves real {symbol} on Arc Mainnet. Blockchain payments are irreversible. Double-check the address.
        </p>
      </div>

      <TxProgress stage={state.stage} hash={state.hash} error={state.error} txUrl={arcTxUrl} />

      {done ? (
        <button className="btn btn-primary mt-4 w-full" onClick={onClose}>Done</button>
      ) : !wallet.onArc ? (
        <button className="btn btn-primary mt-4 w-full" disabled={wallet.switching} onClick={() => void wallet.switchToArc()}>
          {wallet.switching && <Spinner />} Switch to Arc Mainnet
        </button>
      ) : (
        <button
          className="btn btn-primary mt-4 w-full"
          disabled={!canConfirm}
          onClick={() => {
            void send(to, amount, token).then((hash) => {
              if (hash) onSuccess?.(hash)
            })
          }}
        >
          {busy ? <Spinner /> : null}
          {state.stage === 'wallet' ? 'Confirm in wallet…' : state.stage === 'confirming' ? 'Confirming…' : state.stage === 'error' ? 'Try again' : 'Confirm and send'}
        </button>
      )}
    </ConfirmSheet>
  )
}
