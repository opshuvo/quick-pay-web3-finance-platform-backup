import { useCallback, useRef, useState } from 'react'
import { erc20Abi, type Address } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
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
            return writeContractAsync({ address: ARC_USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount], chainId: ARC_CHAIN_ID, ...fees })
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
    [address, publicClient, queryClient, writeContractAsync],
  )

  return { state, send, reset, busy: state.stage === 'wallet' || state.stage === 'confirming' }
}
