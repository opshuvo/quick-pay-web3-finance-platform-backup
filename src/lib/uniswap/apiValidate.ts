/**
 * Pure checks applied to everything the Uniswap API returns, before a wallet is asked to sign.
 * The server validates too; these run again in the browser so a compromised proxy cannot redirect funds.
 */
import { isAddress } from 'viem'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { PERMIT2, UNIVERSAL_ROUTER, type PermitSingle } from './arc'
import type { ApiQuote, ApiSwapResponse, PermitData } from './api'

export class ApiValidationError extends Error {}

const same = (a: string | undefined, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
const fail = (message: string): never => {
  throw new ApiValidationError(message)
}

/** Quote freshness window. Uniswap recommends re-quoting once a quote is older than 30 seconds. */
export const QUOTE_TTL_MS = 30_000

export const quoteAge = (fetchedAt: number, now = Date.now()) => Math.max(0, now - fetchedAt)
export const quoteExpired = (fetchedAt: number, now = Date.now()) => quoteAge(fetchedAt, now) >= QUOTE_TTL_MS

/** The quote must be exactly the swap the user asked for. */
export function assertQuoteMatches(quote: ApiQuote, expected: { tokenIn: string; tokenOut: string; amount: bigint; wallet: string }) {
  if (!same(quote.input?.token, expected.tokenIn)) fail('The quote is for a different input token.')
  if (!same(quote.output?.token, expected.tokenOut)) fail('The quote is for a different output token.')
  if (quote.input.amount !== expected.amount.toString()) fail('The quote is for a different amount.')
  if (quote.chainId !== undefined && Number(quote.chainId) !== ARC_CHAIN_ID) fail('The quote is for a different network.')
  if (quote.output.recipient && !same(quote.output.recipient, expected.wallet)) fail('The quote would pay a different recipient.')
  if (!/^\d+$/.test(quote.output.amount) || BigInt(quote.output.amount) <= 0n) fail('The quote has no output amount.')
}

/** Minimum received as reported by the API, falling back to the slippage formula. Never below the formula. */
export function apiMinOut(quote: ApiQuote, slippageBps: number): bigint {
  const out = BigInt(quote.output.amount)
  const formula = (out * BigInt(10_000 - slippageBps)) / 10_000n
  const reported = quote.output.minimumAmount && /^\d+$/.test(quote.output.minimumAmount) ? BigInt(quote.output.minimumAmount) : undefined
  return reported !== undefined && reported > formula ? reported : formula
}

/** The Permit2 permission the API asks the wallet to sign must grant only what this swap needs. */
export function validatePermit(permit: PermitData, expected: { tokenIn: string; amount: bigint; wallet?: string; now?: number }): PermitSingle {
  const now = expected.now ?? Math.floor(Date.now() / 1000)
  if (!same(permit.domain?.verifyingContract, PERMIT2)) fail('The permission would be granted to an unexpected contract.')
  if (Number(permit.domain?.chainId) !== ARC_CHAIN_ID) fail('The permission is for a different network.')
  const { details, spender, sigDeadline } = permit.values ?? fail('The permission is malformed.')
  if (!same(spender, UNIVERSAL_ROUTER)) fail('The permission names an unexpected spender.')
  if (!same(details.token, expected.tokenIn)) fail('The permission is for a different token.')
  const amount = BigInt(details.amount)
  if (amount < expected.amount) fail('The permission amount is smaller than the swap needs.')
  // Exact permits only: refuse an unlimited allowance even if the API offers one.
  if (amount > expected.amount * 2n) fail('The permission amount is far larger than the swap. It was not signed.')
  if (Number(details.expiration) <= now) fail('The permission has already expired.')
  if (Number(sigDeadline) <= now) fail('The permission signature window has already closed.')
  return {
    details: { token: details.token as `0x${string}`, amount, expiration: Number(details.expiration), nonce: Number(details.nonce) },
    spender: spender as `0x${string}`,
    sigDeadline: BigInt(sigDeadline),
  }
}

/** Viem needs the typed-data types without the EIP712Domain entry. */
export function permitTypes(permit: PermitData) {
  const { EIP712Domain: _domain, ...rest } = permit.types
  void _domain
  return rest
}

/** Final check on the transaction the API built. Only the Universal Router on Arc, value 0, real calldata. */
export function validateSwapTx(res: ApiSwapResponse, wallet: string) {
  const tx = res.swap
  if (!tx || !isAddress(tx.to, { strict: false }) || !same(tx.to, UNIVERSAL_ROUTER)) fail('The swap targets an unexpected contract. It was blocked.')
  if (Number(tx.chainId) !== ARC_CHAIN_ID) fail('The swap is for a different network. It was blocked.')
  if (typeof tx.data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) fail('The swap has empty transaction data. It was blocked.')
  if (tx.value !== '0') fail('The swap would send native value. It was blocked.')
  void wallet
  return { to: tx.to as `0x${string}`, data: tx.data as `0x${string}` }
}
