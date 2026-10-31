import { isAddress, type Address } from 'viem'
import type { AcrossQuote } from '@/lib/across'

export class BridgeGuardError extends Error {}

/** Quotes closer to expiry than this are treated as stale: a wallet prompt can easily take that long. */
export const QUOTE_MARGIN_MS = 15_000

export const isQuoteStale = (quote: Pick<AcrossQuote, 'quoteExpiryTimestamp'>, nowMs: number) => quote.quoteExpiryTimestamp * 1000 < nowMs + QUOTE_MARGIN_MS

export interface BridgeContext {
  origin: number
  destination: number
  originToken: Address
  destinationToken: Address
  amountRaw: bigint | undefined
}

/**
 * Everything the wallet is about to sign must match what the user selected and reviewed: network, target
 * contract, tokens, amount and an exact (never larger) approval. Throws BridgeGuardError otherwise.
 */
export function assertBridgeQuote(q: AcrossQuote, ctx: BridgeContext): void {
  const tx = q.swapTx
  const allowance = q.checks.allowance
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (tx.chainId !== ctx.origin) throw new BridgeGuardError('The transaction is for a different network than the one you selected.')
  if (!isAddress(tx.to) || !isAddress(allowance.spender) || !same(tx.to, allowance.spender)) throw new BridgeGuardError('The transaction targets a contract other than the approved spender.')
  if (!/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) throw new BridgeGuardError('The transaction has no data.')
  if (tx.value && BigInt(tx.value) !== 0n) throw new BridgeGuardError('The transaction would send native value, which this ERC-20 route does not need.')
  if (!same(q.inputToken.address, ctx.originToken) || !same(q.outputToken.address, ctx.destinationToken)) throw new BridgeGuardError('The quote is for a different token than you selected.')
  if (q.inputToken.chainId !== ctx.origin || q.outputToken.chainId !== ctx.destination) throw new BridgeGuardError('The quote is for different networks than you selected.')
  if (ctx.amountRaw === undefined || BigInt(q.inputAmount) !== ctx.amountRaw) throw new BridgeGuardError('The quoted amount differs from the amount you entered.')
  if (!same(allowance.token, q.inputToken.address)) throw new BridgeGuardError('The approval is for a different token than the one being bridged.')
  if (BigInt(allowance.expected) !== BigInt(q.inputAmount)) throw new BridgeGuardError('The approval amount differs from the amount being bridged, so it was refused.')
}

/** Human wording for Across's expected fill time. 0 means Across expects an immediate fill, not "0 seconds". */
export function describeFillTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown'
  if (seconds === 0) return 'within seconds'
  return seconds < 60 ? `~${seconds} seconds` : `~${Math.round(seconds / 60)} minutes`
}
