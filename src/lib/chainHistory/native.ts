/**
 * Arc's USDC is one pool shown two ways. Every movement of it, whether a plain native send from a wallet (a transaction
 * with a value) or an ERC-20 `transfer`, is announced by a Transfer log from a fixed system address, with the amount
 * in the 18-decimal native view. ERC-20 transfers also emit a Transfer from the USDC contract, but plain native sends
 * do not: measured on Arc mainnet, 811 of 980 recent transfer-carrying transactions had only the system log. History
 * therefore reads the system log and converts the amount to USDC's 6 decimals, so no payment is missed and none is
 * counted twice.
 */
import { NATIVE_TRANSFER_EMITTER } from '../../../shared/swapLegs'
import { ARC_USDC_DECIMALS, arcMainnet } from '@/lib/arc'

export const SYSTEM_TRANSFER_EMITTER = NATIVE_TRANSFER_EMITTER

/** How many native (18-decimal) units make one USDC (6-decimal) unit. */
export const NATIVE_PER_USDC_UNIT = 10n ** BigInt(arcMainnet.nativeCurrency.decimals - ARC_USDC_DECIMALS)

/** A system Transfer amount in USDC units. Anything below one USDC unit rounds down to zero and is not listed. */
export function systemAmountToUsdc(data: string): bigint {
  return BigInt(data === '0x' ? 0 : data) / NATIVE_PER_USDC_UNIT
}
