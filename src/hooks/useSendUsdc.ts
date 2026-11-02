import { useCallback, useRef, useState } from 'react'
import { erc20Abi, zeroHash, type Address } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { quickPayRouterAbi } from '@/contracts/quickPayRouterAbi'
import { useRouter } from '@/hooks/useRouter'
import { routerAllowance } from '@/lib/routerSend'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { recordConfirmedTx } from '@/lib/chainHistory/record'
import { arcFeeParams } from '@/lib/fees'
import { confirmTx, receiptHasTransfer, TxFlowError, TxReplacedError } from '@/lib/confirmTx'
import { PaymentParseError, validateRecipient } from '@/lib/payments'
import { ledgerAdd, ledgerRehash, ledgerSetStatus } from '@/lib/txLedger'
import { runUsdcSend, SingleFlight, type SendStage, type SendState } from '@/lib/sendFlow'

export type { SendStage, SendState }

/**
 * Sends USDC on Arc. One submission at a time: a second call while one is in flight is ignored,
 * so a double tap can never produce two payments.
 */
export function useSendUsdc() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const { address: router, configured: routerConfigured, isLoading: routerLoading, problem: routerProblem } = useRouter()
  const [state, setState] = useState<SendState>({ stage: 'idle' })
  const flight = useRef(new SingleFlight())

  const reset = useCallback(() => {
    if (!flight.current.isBusy) setState({ stage: 'idle' })
  }, [])

  const send = useCallback(
    async (to: Address, amount: bigint): Promise<`0x${string}` | null> => {
      if (!publicClient || !address) return null
      const hash = await flight.current.run(() =>
        runUsdcSend({
          onState: setState,
          submit: async () => {
            // The owner's contract is configured but could not be verified: never fall back to a plain transfer silently.
            if (routerConfigured && !router && (routerLoading || routerProblem === 'unreachable')) throw new TxFlowError('The Quick Pay contract could not be verified yet. Try again in a moment. Nothing was sent.')
            // Last line of defence: whatever called this, never sign an empty amount or a lost-funds recipient.
            if (amount <= 0n) throw new TxFlowError('Amount must be greater than zero.')
            try {
              validateRecipient(to, address)
            } catch (error) {
              if (error instanceof PaymentParseError) throw new TxFlowError(error.message)
              throw error
            }
            const fees = await arcFeeParams(publicClient)
            // The wallet signed: keep the payment in History as pending until Arc's receipt says what happened.
            const remember = (hash: `0x${string}`, target: Address) => {
              ledgerAdd({ hash, wallet: address, kind: 'send', to: target, token: ARC_USDC, amount: amount.toString(), symbol: 'USDC', decimals: 6 })
              return hash
            }
            if (!router) {
              return remember(await writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount], chainId: ARC_CHAIN_ID, ...fees }), to)
            }
            // Through the Quick Pay router: approve the exact amount only (never unlimited), wait for it, then pay.
            if ((await routerAllowance(publicClient, address, router)) < amount) {
              const approveHash = await writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [router, amount], chainId: ARC_CHAIN_ID, ...fees })
              const approval = await confirmTx(publicClient, approveHash)
              if (approval.receipt.status !== 'success') throw new TxFlowError('The approval failed on-chain. No funds moved.')
            }
            return remember(await writeContractAsync({ address: router, abi: quickPayRouterAbi, functionName: 'payTo', args: [to, amount, zeroHash], chainId: ARC_CHAIN_ID, ...fees }), to)
          },
          waitForReceipt: async (h) => {
            let confirmed: Awaited<ReturnType<typeof confirmTx>>
            try {
              confirmed = await confirmTx(publicClient, h)
            } catch (error) {
              // Cancelled or dropped: the payment will never happen. Any other failure leaves it pending (Arc is asked again later).
              if (error instanceof TxReplacedError && error.reason === 'cancelled') ledgerSetStatus(address, h, 'failed')
              throw error
            }
            const { hash: mined, receipt } = confirmed
            ledgerRehash(address, h, mined)
            ledgerSetStatus(address, mined, receipt.status === 'success' ? 'confirmed' : 'failed')
            // Success needs the receipt AND the exact USDC transfer (right payer, recipient and amount) inside it.
            return { status: receipt.status, hash: mined, verified: receiptHasTransfer(receipt.logs, ARC_USDC, address, to, amount) }
          },
        }),
      )
      if (hash) {
        const refresh = () => void queryClient.invalidateQueries({ queryKey: ['readContract'] })
        refresh()
        // Another read a few seconds later, in case the first one hit an RPC node that had not seen the block yet.
        setTimeout(refresh, 4_000)
        // The payment is read from its receipt and listed in History straight away.
        void recordConfirmedTx({ address, hash, queryClient })
      }
      return hash ?? null
    },
    [address, publicClient, queryClient, router, routerConfigured, routerLoading, routerProblem, writeContractAsync],
  )

  return { state, send, reset, busy: state.stage === 'wallet' || state.stage === 'confirming' }
}
