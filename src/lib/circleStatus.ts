/**
 * Circle (CCTP) bridge records and status. Nothing here touches the SDK, so it is cheap to import everywhere.
 *
 * A transfer is "Complete" only when the destination mint transaction is read back from the destination chain
 * as successful. Circle's own attestation or forwarding status alone is never shown as delivery.
 */
import type { Hex } from 'viem'

export const IRIS_URL = 'https://iris-api.circle.com/v2/messages'
export type CircleMode = 'forwarder' | 'self'
export type CircleSpeed = 'FAST' | 'SLOW'

/** What is saved on this device so a transfer can be tracked (and resumed) after the page is closed. */
export interface CircleRecord {
  mode: CircleMode
  speed: CircleSpeed
  /** Circle's chain names, as the SDK expects them. */
  fromKit: string
  toKit: string
  fromDomain: number
  toDomain: number
  /** Public RPC for the destination chain, used only to read the mint receipt back. */
  toRpc?: string
  /** The mint transaction, when this wallet submitted it (self mode). */
  mintTx?: Hex
  /** The SDK result of a transfer that stopped part-way, so it can be resumed without burning twice. */
  resumable?: string
}

export interface IrisMessage {
  status?: 'complete' | 'pending_confirmations'
  delayReason?: string | null
  forwardState?: string
  forwardTxHash?: string
  destinationMintTxHash?: string
}

export type ReceiptState = 'success' | 'reverted' | 'missing' | 'unknown'

export type CircleTrack =
  | { phase: 'source-pending' }
  | { phase: 'source-failed' }
  | { phase: 'attesting'; delayReason?: string | null }
  | { phase: 'awaiting-mint' }
  | { phase: 'minting'; hash?: string }
  | { phase: 'mint-failed'; hash: string }
  | { phase: 'delivered'; hash: string; verified: boolean }

const isHash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)

/** The mint transaction Circle or this wallet reports, if any. */
export function mintHashOf(iris: IrisMessage | null, record: Pick<CircleRecord, 'mintTx'>): Hex | undefined {
  if (record.mintTx) return record.mintTx
  if (isHash(iris?.destinationMintTxHash)) return iris.destinationMintTxHash
  if (iris?.forwardState === 'COMPLETE' && isHash(iris.forwardTxHash)) return iris.forwardTxHash
  return undefined
}

/**
 * Reads the stage of a transfer from three independent facts: the burn receipt on the source chain, Circle's
 * message record, and the mint receipt on the destination chain. `destReceipt` is only meaningful for `mintHashOf`.
 */
export function deriveCircleTrack(input: { mode: CircleMode; source: ReceiptState; iris: IrisMessage | null; mint: Hex | undefined; destReceipt: ReceiptState }): CircleTrack {
  if (input.source === 'reverted') return { phase: 'source-failed' }
  if (input.source !== 'success') return { phase: 'source-pending' }
  if (input.mint) {
    if (input.destReceipt === 'success') return { phase: 'delivered', hash: input.mint, verified: true }
    if (input.destReceipt === 'reverted') return { phase: 'mint-failed', hash: input.mint }
    return { phase: 'minting', hash: input.mint }
  }
  const attested = input.iris?.status === 'complete'
  if (!attested) return { phase: 'attesting', delayReason: input.iris?.delayReason }
  return input.mode === 'self' ? { phase: 'awaiting-mint' } : { phase: 'minting' }
}

export const isCircleTerminal = (t: CircleTrack | undefined) => t?.phase === 'source-failed' || t?.phase === 'mint-failed' || (t?.phase === 'delivered' && t.verified)

/** Circle's message record for a burn transaction. `null` while Circle has not indexed it yet. */
export async function fetchIris(sourceDomain: number, burnHash: string, fetcher: typeof fetch = fetch): Promise<IrisMessage | null> {
  const response = await fetcher(`${IRIS_URL}/${sourceDomain}?transactionHash=${burnHash}`, { signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Circle answered ${response.status}.`)
  const body = (await response.json()) as { messages?: IrisMessage[] }
  return body.messages?.[0] ?? null
}

/** Fees from an SDK estimate are decimal strings in the token they name. This sums the ones paid in USDC, in 6-decimal units. */
export function sumUsdcFees(fees: { token: string; amount: string | null }[], parse: (v: string) => bigint): bigint {
  let total = 0n
  for (const f of fees) if (f.token === 'USDC' && f.amount) total += parse(f.amount)
  return total
}
