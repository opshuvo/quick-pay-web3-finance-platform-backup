import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import type { Address, PublicClient, WalletClient } from 'viem'
import { activityApi } from '@/lib/activity'
import { ApiError } from '@/lib/api'
import { historyServerUsable } from '@/lib/chainHistory/mode'
import { chainTrackConfirmed } from '@/lib/chainHistory/read'
import { parseTxError } from '@/lib/errors'
import { executeSwap, type SwapStep } from '@/lib/uniswap/execute'
import { executeApiSwap, type ApiSwapStep } from '@/lib/uniswap/executeApi'
import { ApiValidationError } from '@/lib/uniswap/apiValidate'
import { PRICE_IMPACT_BLOCK } from '@/lib/uniswap/arc'
import type { SwapQuoteView } from '@/hooks/useSwapQuote'

export interface SwapRun {
  stage: 'idle' | 'wallet' | 'confirming' | 'success' | 'error'
  step?: ApiSwapStep
  hash?: `0x${string}`
  error?: string
  /** Whether the verified record was written to Quick Pay history. */
  saved?: 'saving' | 'saved' | 'failed'
}

interface Args {
  publicClient: PublicClient
  walletClient: WalletClient
  reviewed: SwapQuoteView
  refresh: () => Promise<SwapQuoteView | undefined>
  tokenIn: Address
  tokenOut: Address
  amount: bigint
  slippageBps: number
  acceptLoss: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs one swap end to end. A second call while one is running is ignored (no duplicate submissions),
 * the quote is re-fetched right before anything is signed, and success is reported only after the
 * transaction receipt says so. The verified swap is then saved to Quick Pay history.
 */
export function useSwapExecution() {
  const [run, setRun] = useState<SwapRun>({ stage: 'idle' })
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const { address } = useAccount()

  const save = useCallback(
    async (hash: `0x${string}`) => {
      setRun((r) => ({ ...r, saved: 'saving' }))
      if (!(await historyServerUsable()) && address) {
        // No history server: read the confirmed transaction's receipt from Arc and keep the verified swap on this device's history.
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            await chainTrackConfirmed(address, hash)
            setRun((r) => ({ ...r, saved: 'saved' }))
            void queryClient.invalidateQueries({ queryKey: ['activity'] })
            void queryClient.invalidateQueries({ queryKey: ['history'] })
            return
          } catch {
            await sleep(2500)
          }
        }
        setRun((r) => ({ ...r, saved: 'failed' }))
        return
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await activityApi.recordSwap(hash)
          setRun((r) => ({ ...r, saved: 'saved' }))
          void queryClient.invalidateQueries({ queryKey: ['activity'] })
          void queryClient.invalidateQueries({ queryKey: ['history'] })
          return
        } catch (error) {
          // A 404/422 right after confirmation usually means the history service has not seen the block yet.
          if (error instanceof ApiError && error.status === 422 && error.code !== 'tx_not_found') break
          await sleep(2500)
        }
      }
      setRun((r) => ({ ...r, saved: 'failed' }))
    },
    [queryClient, address],
  )

  const execute = useCallback(
    async (a: Args) => {
      if (lock.current) return
      lock.current = true
      setRun({ stage: 'wallet', step: 'quote' })
      try {
        const fresh = await a.refresh()
        if (!fresh) throw new Error('No live quote is available right now. Nothing was sent.')
        if (fresh.engine !== a.reviewed.engine || fresh.minOut < a.reviewed.minOut) {
          throw new Error('The price moved while you were reviewing. Check the updated quote and confirm again. Nothing was sent.')
        }
        if (fresh.priceImpactPct / 100 > PRICE_IMPACT_BLOCK && !a.acceptLoss) throw new Error('Price impact is above the 5% limit and was not accepted.')

        const onStep = (step: ApiSwapStep, hash?: `0x${string}`) =>
          setRun({ stage: step === 'swap-confirm' || step === 'approve-confirm' || step === 'quote' || step === 'build' ? 'confirming' : 'wallet', step, hash })

        const result =
          fresh.engine === 'uniswap-api' && fresh.api
            ? await executeApiSwap(a.publicClient, a.walletClient, fresh.api, { tokenIn: a.tokenIn, tokenOut: a.tokenOut, amount: a.amount, quoteFetchedAt: fresh.fetchedAt }, onStep)
            : await executeSwap(a.publicClient, a.walletClient, a.tokenIn, a.tokenOut, 'exactIn', a.amount, a.slippageBps, a.acceptLoss, (step: SwapStep, hash) => onStep(step, hash))
        if (result.success) {
          setRun({ stage: 'success', hash: result.hash, saved: 'saving' })
          void save(result.hash)
        } else {
          setRun({ stage: 'error', hash: result.hash, error: 'The swap transaction failed on-chain. Your tokens were not exchanged.' })
        }
      } catch (error) {
        const known = error instanceof ApiValidationError || error instanceof ApiError || (error instanceof Error && /Price impact|exceeds your|expired|moved|No live quote|approval transaction/.test(error.message))
        setRun({ stage: 'error', error: known ? (error).message : parseTxError(error).message })
      } finally {
        lock.current = false
      }
    },
    [save],
  )

  const reset = useCallback(() => setRun({ stage: 'idle' }), [])
  return { run, execute, reset, retrySave: save }
}
