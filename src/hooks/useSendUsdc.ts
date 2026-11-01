import { useCallback, useRef, useState } from 'react'
import { erc20Abi, zeroHash, type Address } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { quickPayRouterAbi } from '@/contracts/quickPayRouterAbi'
import { useRouter } from '@/hooks/useRouter'
import { routerAllowance } from '@/lib/routerSend'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { api } from '@/lib/api'
import { arcFeeParams } from '@/lib/fees'
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
  const { address: router } = useRouter()
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
            const fees = await arcFeeParams(publicClient)
            if (!router) {
              return writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount], chainId: ARC_CHAIN_ID, ...fees })
            }
            // Through the Quick Pay router: approve the exact amount only (never unlimited), wait for it, then pay.
            if ((await routerAllowance(publicClient, address, router)) < amount) {
              const approveHash = await writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [router, amount], chainId: ARC_CHAIN_ID, ...fees })
              const approval = await publicClient.waitForTransactionReceipt({ hash: approveHash })
              if (approval.status !== 'success') throw new Error('The approval failed on-chain. No funds moved.')
            }
            return writeContractAsync({ address: router, abi: quickPayRouterAbi, functionName: 'payTo', args: [to, amount, zeroHash], chainId: ARC_CHAIN_ID, ...fees })
          },
          waitForReceipt: (h) => publicClient.waitForTransactionReceipt({ hash: h }),
        }),
      )
      if (hash) {
        void queryClient.invalidateQueries({ queryKey: ['readContract'] })
        void queryClient.invalidateQueries({ queryKey: ['history'] })
        void api(`/index/${address}`, { method: 'POST' }).catch(() => undefined)
      }
      return hash ?? null
    },
    [address, publicClient, queryClient, router, writeContractAsync],
  )

  return { state, send, reset, busy: state.stage === 'wallet' || state.stage === 'confirming' }
}
