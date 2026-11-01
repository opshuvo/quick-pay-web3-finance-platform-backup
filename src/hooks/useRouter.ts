import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { quickPayRouterAbi } from '@/contracts/quickPayRouterAbi'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { env } from '@/lib/env'

/** Why a configured Quick Pay contract is not being used right now. */
export type RouterProblem = 'unreachable' | 'paused' | 'wrong-usdc' | 'no-contract'

export type RouterCheck = { ok: true; address: Address } | { ok: false; problem: Exclude<RouterProblem, 'unreachable'> }

/** Live reads on Arc: the contract has code, uses the official USDC and is not paused. Throws when Arc cannot be read. */
export async function verifyRouter(client: Pick<PublicClient, 'getCode' | 'readContract'>, configured: Address): Promise<RouterCheck> {
  const code = await client.getCode({ address: configured })
  if (!code || code === '0x') return { ok: false, problem: 'no-contract' }
  const [usdc, paused] = await Promise.all([
    client.readContract({ address: configured, abi: quickPayRouterAbi, functionName: 'usdc' }),
    client.readContract({ address: configured, abi: quickPayRouterAbi, functionName: 'paused' }),
  ])
  if (usdc.toLowerCase() !== ARC_USDC.toLowerCase()) return { ok: false, problem: 'wrong-usdc' }
  if (paused) return { ok: false, problem: 'paused' }
  return { ok: true, address: configured }
}

/**
 * The QuickPayRouter address, but only after live reads on Arc confirm it has code, uses the official USDC and is not
 * paused. `configured` says an address is set at all. When it is set but not usable, `problem` says why:
 * `unreachable` means Arc could not be read (sending is held back, never silently switched to a plain transfer),
 * the other reasons mean the contract itself cannot take payments and sends go direct, with a notice.
 */
export function useRouter(): { address?: Address; isLoading: boolean; configured: boolean; problem?: RouterProblem } {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const configured = env.routerAddress
  const q = useQuery({
    queryKey: ['router-check', configured],
    enabled: Boolean(client && configured),
    refetchInterval: (query) => (query.state.status === 'error' ? 5_000 : 60_000),
    retry: 2,
    retryDelay: (attempt) => Math.min(4_000, 500 * 2 ** attempt),
    queryFn: () => verifyRouter(client as PublicClient, configured as Address),
  })
  if (!configured) return { isLoading: false, configured: false }
  if (q.data?.ok) return { address: q.data.address, isLoading: false, configured: true }
  if (q.data && !q.data.ok) return { isLoading: false, configured: true, problem: q.data.problem }
  if (q.isError) return { isLoading: false, configured: true, problem: 'unreachable' }
  return { isLoading: true, configured: true }
}
