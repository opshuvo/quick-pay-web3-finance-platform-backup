import { getAddress, parseEventLogs, type Address, type Hash, type Log, type PublicClient } from 'viem'
import { quickPayRegistryAbi } from '@/contracts/quickPayRegistryAbi'
import { arcLogsLane, classifyRpcFailure } from '@/lib/arcRpc'

export interface RegistryPayment {
  id: bigint
  merchant: Address
  payer: Address
  amount: bigint
  paidAt: bigint
  txHash: Hash
  blockNumber: bigint
  logIndex: number
}

export interface RegistryRequestCreated {
  id: bigint
  merchant: Address
  payer: Address
  amount: bigint
  expiresAt: bigint
  txHash: Hash
  blockNumber: bigint
  logIndex: number
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Decodes only logs that were emitted BY the registry address; a lookalike event from another contract is ignored. */
export function registryPaymentsFromLogs(logs: readonly Log[], registry: Address): RegistryPayment[] {
  const own = logs.filter((l) => sameAddress(l.address, registry))
  return parseEventLogs({ abi: quickPayRegistryAbi, eventName: 'PaymentReceived', logs: own, strict: true }).map((l) => ({
    id: l.args.id,
    merchant: getAddress(l.args.merchant),
    payer: getAddress(l.args.payer),
    amount: l.args.amount,
    paidAt: l.args.paidAt,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
  }))
}

export function registryCreatedFromLogs(logs: readonly Log[], registry: Address): RegistryRequestCreated[] {
  const own = logs.filter((l) => sameAddress(l.address, registry))
  return parseEventLogs({ abi: quickPayRegistryAbi, eventName: 'RequestCreated', logs: own, strict: true }).map((l) => ({
    id: l.args.id,
    merchant: getAddress(l.args.merchant),
    payer: getAddress(l.args.payer),
    amount: l.args.amount,
    expiresAt: l.args.expiresAt,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
  }))
}

/** The registry record for a confirmed `createRequest`, or undefined when the receipt holds no matching event. */
export function confirmCreated(logs: readonly Log[], registry: Address, merchant: Address, amount: bigint): RegistryRequestCreated | undefined {
  return registryCreatedFromLogs(logs, registry).find((e) => sameAddress(e.merchant, merchant) && e.amount === amount)
}

/** The registry record for a confirmed `pay`, or undefined when the receipt holds no matching event. */
export function confirmPaid(logs: readonly Log[], registry: Address, expected: { id: bigint; payer: Address; merchant: Address; amount: bigint }): RegistryPayment | undefined {
  return registryPaymentsFromLogs(logs, registry).find(
    (e) => e.id === expected.id && sameAddress(e.payer, expected.payer) && sameAddress(e.merchant, expected.merchant) && e.amount === expected.amount,
  )
}

// The official Arc RPC accepts at most 5,001 blocks per eth_getLogs, so a bigger first try is a wasted, counted request.
const START_SPAN = 5_000n
const MIN_SPAN = 250n

/**
 * Reads events in block ranges, starting from a known block (never block 0). If the RPC rejects a range it is
 * halved and retried, so an unknown range limit degrades to smaller requests instead of failing.
 */
export async function scanRange<T>(from: bigint, to: bigint, read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  let cursor = from
  let span = START_SPAN
  while (cursor <= to) {
    const end = cursor + span - 1n > to ? to : cursor + span - 1n
    try {
      out.push(...(await read(cursor, end)))
      cursor = end + 1n
    } catch (error) {
      // A rate limit or an unreachable node is retried with backoff by the shared log lane; a smaller range would
      // not help and only multiplies the requests. Only a refused range is split.
      const kind = classifyRpcFailure(error)
      if (kind === 'rate' || kind === 'timeout' || kind === 'network' || span <= MIN_SPAN) throw error
      span = span / 2n
    }
  }
  return out
}

export async function fetchPayments(client: PublicClient, registry: Address, who: { payer?: Address; merchant?: Address }, from: bigint, to: bigint): Promise<RegistryPayment[]> {
  const logs = await scanRange(from, to, (fromBlock, toBlock) =>
    arcLogsLane.run(() => client.getContractEvents({ address: registry, abi: quickPayRegistryAbi, eventName: 'PaymentReceived', args: who, fromBlock, toBlock, strict: true })),
  )
  return registryPaymentsFromLogs(logs, registry)
}

export async function fetchCreated(client: PublicClient, registry: Address, merchant: Address, from: bigint, to: bigint): Promise<RegistryRequestCreated[]> {
  const logs = await scanRange(from, to, (fromBlock, toBlock) =>
    arcLogsLane.run(() => client.getContractEvents({ address: registry, abi: quickPayRegistryAbi, eventName: 'RequestCreated', args: { merchant }, fromBlock, toBlock, strict: true })),
  )
  return registryCreatedFromLogs(logs, registry)
}
