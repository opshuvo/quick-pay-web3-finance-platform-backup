import type { PublicClient } from 'viem'
import { ARC_CHAIN_ID, ARC_MIN_FEE_PER_GAS } from '@/lib/arc'
import { Amount, gasTokenToUsdc, gasTokenDecimalsFor } from '@/onchain-money'

/** Fee caps for Arc: never below the 20 gwei floor, otherwise the transaction can be dropped. */
export async function arcFeeParams(client: PublicClient) {
  const fees = await client.estimateFeesPerGas()
  const maxFeePerGas = fees.maxFeePerGas && fees.maxFeePerGas > ARC_MIN_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_FEE_PER_GAS
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n
  return { maxFeePerGas, maxPriorityFeePerGas: maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas }
}

/** Converts a gas cost (18-decimal native view) into 6-decimal USDC, rounded up by one unit. */
export function gasCostToUsdc(gas: bigint, maxFeePerGas: bigint): bigint {
  const native = Amount.fromRaw(gas * maxFeePerGas, gasTokenDecimalsFor(ARC_CHAIN_ID))
  return gasTokenToUsdc(ARC_CHAIN_ID, native, 'trunc').raw + 1n
}
