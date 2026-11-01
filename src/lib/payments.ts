/**
 * Payment URIs and QR content. Parsing is strict: anything that is not clearly a FlowPay
 * request link, a plain address, or an EIP-681 USDC transfer on Arc is rejected.
 */
import { getAddress, isAddress, type Address } from 'viem'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arc'
import { formatUsdc, parseUsdc } from '@/onchain-money'

export type ParsedPayment =
  | { kind: 'address'; to: Address; amount?: string }
  | { kind: 'request'; id: string }

export class PaymentParseError extends Error {}

const isZero = (a: string) => /^0x0{40}$/i.test(a)

/** Validates a recipient for sending. Throws a readable message. */
export function validateRecipient(value: string, sender?: string): Address {
  const v = value.trim()
  if (!isAddress(v, { strict: false })) throw new PaymentParseError('Enter a valid 0x wallet address.')
  if (isZero(v)) throw new PaymentParseError('The zero address cannot receive funds.')
  if (v.toLowerCase() === ARC_USDC.toLowerCase()) throw new PaymentParseError('That is the USDC token contract. Funds sent there are lost.')
  // Reject mixed-case addresses with a bad checksum; all-lowercase is accepted.
  if (v !== v.toLowerCase() && v.slice(2) !== v.slice(2).toUpperCase() && !isAddress(v)) throw new PaymentParseError('Address checksum is invalid. Check for typos.')
  if (sender && v.toLowerCase() === sender.toLowerCase()) throw new PaymentParseError('You cannot send to your own address.')
  return getAddress(v.toLowerCase())
}

/** Parses a user-typed USDC amount into 6-decimal base units. */
export function validateAmount(value: string, max?: bigint): bigint {
  const v = value.trim()
  if (!v) throw new PaymentParseError('Enter an amount.')
  if (!/^\d*\.?\d*$/.test(v) || v === '.') throw new PaymentParseError('Use numbers only.')
  if ((v.split('.')[1]?.length ?? 0) > 6) throw new PaymentParseError('USDC supports at most 6 decimal places.')
  let raw: bigint
  try {
    raw = parseUsdc(v)
  } catch {
    throw new PaymentParseError('Enter a valid amount.')
  }
  if (raw <= 0n) throw new PaymentParseError('Amount must be greater than zero.')
  if (max !== undefined && raw > max) throw new PaymentParseError('Amount is larger than your available balance.')
  return raw
}

/** Builds an EIP-681 link for a USDC transfer on Arc. */
export function buildUsdcUri(to: Address, amountRaw?: bigint): string {
  const base = `ethereum:${ARC_USDC}@${ARC_CHAIN_ID}/transfer?address=${to}`
  return amountRaw && amountRaw > 0n ? `${base}&uint256=${amountRaw.toString()}` : base
}

/** Reads content from a QR code or pasted text. Never moves funds; only extracts details. */
export function parsePaymentContent(input: string): ParsedPayment {
  const text = input.trim()
  if (!text || text.length > 2048) throw new PaymentParseError('That code is empty or too long to be a payment.')

  if (isAddress(text, { strict: false })) return { kind: 'address', to: validateRecipient(text) }

  const pay = /\/pay\/([a-z2-9]{16})(?:[/?#]|$)/i.exec(text)
  if (pay && /^https?:\/\//i.test(text)) return { kind: 'request', id: pay[1].toLowerCase() }

  if (/^ethereum:/i.test(text)) {
    const match = /^ethereum:(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([a-zA-Z]+))?(?:\?(.*))?$/.exec(text)
    if (!match) throw new PaymentParseError('Unsupported payment link format.')
    const [, target, chain, fn, query] = match
    if (chain && Number(chain) !== ARC_CHAIN_ID) throw new PaymentParseError(`This code is for chain ${chain}. FlowPay pays on Arc Mainnet (5042).`)
    const params = new URLSearchParams(query ?? '')
    if (fn === 'transfer') {
      if (target.toLowerCase() !== ARC_USDC.toLowerCase()) throw new PaymentParseError('This code asks for a token other than USDC on Arc.')
      const to = params.get('address')
      if (!to) throw new PaymentParseError('The payment code has no recipient.')
      const units = params.get('uint256')
      let amount: string | undefined
      if (units) {
        if (!/^\d{1,30}$/.test(units)) throw new PaymentParseError('The payment code has an invalid amount.')
        amount = formatUsdc(BigInt(units))
      }
      return { kind: 'address', to: validateRecipient(to), amount }
    }
    if (fn) throw new PaymentParseError('Unsupported payment action in this code.')
    if (params.get('value')) throw new PaymentParseError('Native-value payment codes are not supported. FlowPay sends USDC only.')
    return { kind: 'address', to: validateRecipient(target) }
  }
  throw new PaymentParseError('Not a wallet address or FlowPay payment code.')
}
