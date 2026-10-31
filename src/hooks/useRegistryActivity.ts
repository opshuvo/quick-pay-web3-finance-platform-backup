import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { quickPayRegistryAbi } from '@/contracts/quickPayRegistryAbi'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { env } from '@/lib/env'
import { fetchCreated, fetchPayments, type RegistryPayment, type RegistryRequestCreated } from '@/lib/registryEvents'

/** Used only when VITE_QUICKPAY_REGISTRY_FROM_BLOCK is not set: a bounded recent window, clearly not full history. */
const FALLBACK_LOOKBACK = 5_000n

interface Cursor<T> {
  next: bigint
  items: T[]
}
const cursors = new Map<string, Cursor<unknown>>()

/** Scans forward from the last scanned block, so polling never re-reads old ranges. */
async function incremental<T extends { txHash: string; logIndex: number }>(key: string, from: bigint, head: bigint, read: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const cached = cursors.get(key) as Cursor<T> | undefined
  const start = cached ? cached.next : from
  const fresh = start <= head ? await read(start, head) : []
  const seen = new Set((cached?.items ?? []).map((i) => `${i.txHash}-${i.logIndex}`))
  const items = [...(cached?.items ?? []), ...fresh.filter((i) => !seen.has(`${i.txHash}-${i.logIndex}`))]
  cursors.set(key, { next: head + 1n, items })
  return items
}

export interface RegistryScan<T> {
  items: T[]
  fromBlock: bigint
  headBlock: bigint
  /** True when the scan began at the registry's creation block, so it covers the contract's whole history. */
  fullHistory: boolean
}

function useScan<T extends { txHash: string; logIndex: number; blockNumber: bigint }>(kind: string, wallet: Address | undefined, read: (client: NonNullable<ReturnType<typeof usePublicClient>>, registry: Address, from: bigint, to: bigint) => Promise<T[]>) {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const registry = env.registryAddress
  return useQuery<RegistryScan<T>>({
    queryKey: ['registry-activity', kind, registry, wallet?.toLowerCase()],
    enabled: Boolean(client && registry && wallet),
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!client || !registry || !wallet) throw new Error('not ready')
      const head = await client.getBlockNumber()
      const configured = env.registryFromBlock
      const fromBlock = configured ?? (head > FALLBACK_LOOKBACK ? head - FALLBACK_LOOKBACK : 0n)
      const items = await incremental<T>(`${kind}:${registry}:${wallet.toLowerCase()}:${fromBlock}`, fromBlock, head, (a, b) => read(client, registry, a, b))
      return { items: [...items].sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : x.blockNumber > y.blockNumber ? -1 : 1)), fromBlock, headBlock: head, fullHistory: configured !== undefined }
    },
  })
}

/** Payments the registry itself confirmed, for one wallet in one role. Rows come only from registry-emitted logs. */
export function useRegistryPayments(wallet: Address | undefined, role: 'payer' | 'merchant') {
  return useScan<RegistryPayment>(`pay-${role}`, wallet, (client, registry, a, b) => fetchPayments(client, registry, role === 'payer' ? { payer: wallet } : { merchant: wallet }, a, b))
}

export interface MyRequest extends RegistryRequestCreated {
  status: number
}

/** Requests the wallet created on the registry, each with its live status read from the contract. */
export function useMyRegistryRequests(wallet: Address | undefined) {
  const client = usePublicClient({ chainId: ARC_CHAIN_ID })
  const registry = env.registryAddress
  const created = useScan<RegistryRequestCreated>('created', wallet, (c, r, a, b) => (wallet ? fetchCreated(c, r, wallet, a, b) : Promise.resolve([])))
  const ids = (created.data?.items ?? []).map((i) => i.id.toString()).join(',')
  const statuses = useQuery<Record<string, number>>({
    queryKey: ['registry-activity', 'status', registry, ids],
    enabled: Boolean(client && registry && ids),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!client || !registry) return {}
      const entries = await Promise.all(
        (created.data?.items ?? []).map(async (i) => [i.id.toString(), Number(await client.readContract({ address: registry, abi: quickPayRegistryAbi, functionName: 'statusOf', args: [i.id] }))] as const),
      )
      return Object.fromEntries(entries)
    },
  })
  const items: MyRequest[] = (created.data?.items ?? []).map((i) => ({ ...i, status: statuses.data?.[i.id.toString()] ?? -1 }))
  return { created, statuses, items }
}
