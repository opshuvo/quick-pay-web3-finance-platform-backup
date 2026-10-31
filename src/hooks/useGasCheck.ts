import { useQuery } from '@tanstack/react-query'
import { useBalance, usePublicClient } from 'wagmi'
import type { Address } from 'viem'
import { ARC_CHAIN_ID, ARC_MIN_FEE_PER_GAS } from '@/lib/arc'
import type { AcrossQuote } from '@/lib/across'
import { Amount, gasTokenDecimalsFor, usdcToGasToken } from '@/onchain-money'

export interface GasCheck {
  /** undefined while it cannot be determined; never assumed true. */
  ok: boolean | undefined
  /** Native units (18 decimals on Arc, the chain's own on others). */
  required?: bigint
  balance?: bigint
  symbol?: string
  note?: string
}

/** Typical gas when the node cannot simulate yet (for example before the approval is mined). */
const FALLBACK_BRIDGE_GAS = 350_000n
const APPROVAL_GAS = 70_000n

/**
 * Does the wallet hold enough native gas on the source chain? On Arc the gas token is USDC itself,
 * so the bridged amount and the fee come from the same pool and are added together.
 */
export function useGasCheck(origin: number, wallet: Address | undefined, quote: AcrossQuote | undefined, needsApproval: boolean, amount: bigint | undefined): GasCheck {
  const client = usePublicClient({ chainId: origin })
  const native = useBalance({ address: wallet, chainId: origin, query: { enabled: Boolean(wallet), refetchInterval: 20_000 } })
  const estimate = useQuery({
    queryKey: ['bridge-gas', origin, quote?.id, needsApproval, wallet],
    enabled: Boolean(client && quote && wallet),
    retry: false,
    staleTime: 20_000,
    queryFn: async () => {
      const c = client as NonNullable<typeof client>
      const fees = await c.estimateFeesPerGas()
      let maxFee = fees.maxFeePerGas ?? fees.gasPrice ?? 0n
      if (origin === ARC_CHAIN_ID && maxFee < ARC_MIN_FEE_PER_GAS) maxFee = ARC_MIN_FEE_PER_GAS
      let gas = FALLBACK_BRIDGE_GAS
      if (!needsApproval && quote) {
        const simulated = await c.estimateGas({ account: wallet, to: quote.swapTx.to, data: quote.swapTx.data, value: quote.swapTx.value ? BigInt(quote.swapTx.value) : 0n }).catch(() => null)
        if (simulated) gas = (simulated * 12n) / 10n
      }
      return (gas + (needsApproval ? APPROVAL_GAS : 0n)) * maxFee
    },
  })

  if (!wallet || !quote) return { ok: undefined }
  if (native.data === undefined || estimate.data === undefined) return { ok: undefined, symbol: native.data?.symbol, note: estimate.isError ? 'Network fee could not be estimated.' : undefined }
  let required = estimate.data
  if (origin === ARC_CHAIN_ID && amount !== undefined && quote.inputToken.symbol === 'USDC') {
    required += usdcToGasToken(ARC_CHAIN_ID, Amount.fromRaw(amount, quote.inputToken.decimals)).toDecimals(gasTokenDecimalsFor(ARC_CHAIN_ID)).raw
  }
  return { ok: native.data.value >= required, required, balance: native.data.value, symbol: native.data.symbol }
}
