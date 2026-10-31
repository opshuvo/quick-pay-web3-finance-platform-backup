import { erc20Abi, zeroHash, type Address, type PublicClient } from 'viem'
import { quickPayRouterAbi } from '@/contracts/quickPayRouterAbi'
import { ARC_USDC } from '@/lib/arc'

/** Headroom for the router hop (extra call, reentrancy guard, event) when payTo cannot be simulated yet. */
const ROUTER_OVERHEAD_GAS = 40_000n

export function routerAllowance(client: PublicClient, owner: Address, router: Address): Promise<bigint> {
  return client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: [owner, router] })
}

/**
 * Gas for a send through the router. With enough allowance this is a real simulation of payTo. Without it
 * payTo would revert in simulation, so the estimate is the simulated approve plus the simulated transfer plus
 * a fixed router overhead, and callers should present it as an estimate.
 */
export async function estimateRouterSendGas(client: PublicClient, account: Address, router: Address, to: Address, amount: bigint): Promise<bigint> {
  const allowance = await routerAllowance(client, account, router)
  if (allowance >= amount) {
    return client.estimateContractGas({ account, address: router, abi: quickPayRouterAbi, functionName: 'payTo', args: [to, amount, zeroHash] })
  }
  const [approveGas, transferGas] = await Promise.all([
    client.estimateContractGas({ account, address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [router, amount] }),
    client.estimateContractGas({ account, address: ARC_USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
  ])
  return approveGas + transferGas + ROUTER_OVERHEAD_GAS
}
