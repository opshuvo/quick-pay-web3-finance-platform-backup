import { AmountError, formatUnitsExact, parseUnitsExact } from '@/onchain-money'

export type AmountParse =
  | { ok: true; value: bigint }
  | { ok: false; reason: 'empty' | 'invalid' | 'zero' | 'too_many_decimals'; message: string }

/**
 * Parses what the user typed into base units using the token's real decimals, with no floating point.
 * Extra decimals are rejected, never rounded away (viem's parseUnits would silently round them).
 */
export function parseTokenAmount(text: string, decimals: number): AmountParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'empty', message: 'Enter an amount.' }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return { ok: false, reason: 'invalid', message: 'Enter a number using digits and one decimal point.' }
  try {
    const value = parseUnitsExact(trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed, decimals)
    if (value <= 0n) return { ok: false, reason: 'zero', message: 'Amount must be greater than zero.' }
    return { ok: true, value }
  } catch (error) {
    if (error instanceof AmountError && error.code === 'TOO_MANY_FRACTION_DIGITS') {
      return { ok: false, reason: 'too_many_decimals', message: decimals === 0 ? 'This token has no decimal places.' : `This token supports up to ${decimals} decimal places.` }
    }
    return { ok: false, reason: 'invalid', message: 'Enter a valid amount.' }
  }
}

const group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export interface FormatOptions {
  /** Fraction digits always shown (default 2). */
  minFrac?: number
  /** Significant digits kept for values below 1, so small amounts never collapse to 0.00 (default 4). */
  sigDigits?: number
  /** Fraction digits kept for values of 1 or more (default 6). */
  maxFrac?: number
}

/**
 * Exact, truncating display of a token amount (never rounds up, never uses floats). Values of 1 or more show
 * up to `maxFrac` decimals; smaller values show enough digits to keep `sigDigits` significant digits, so
 * 0.008962 EURC is not displayed as 0.00. A non-zero amount is never displayed as zero.
 */
export function formatTokenAmount(raw: bigint, decimals: number, { minFrac = 2, sigDigits = 4, maxFrac = 6 }: FormatOptions = {}): string {
  const negative = raw < 0n
  const exact = formatUnitsExact(negative ? -raw : raw, decimals)
  const [whole, frac = ''] = exact.split('.')
  let keep = maxFrac
  if (whole === '0' && frac.length > 0) {
    const leadingZeros = frac.length - frac.replace(/^0+/, '').length
    keep = Math.max(maxFrac, Math.min(frac.length, leadingZeros + sigDigits))
  }
  let out = frac.slice(0, keep).replace(/0+$/, '')
  while (out.length < minFrac) out += '0'
  return `${negative ? '-' : ''}${group(whole)}${out ? `.${out}` : ''}`
}

/** Exchange rate out-per-in as an exact fixed-point calculation (no Number conversion of token amounts). */
export function formatRate(amountOut: bigint, outDecimals: number, amountIn: bigint, inDecimals: number): string | undefined {
  if (amountIn <= 0n || amountOut < 0n) return undefined
  const PRECISION = 18
  const scaled = (amountOut * 10n ** BigInt(inDecimals + PRECISION)) / (amountIn * 10n ** BigInt(outDecimals))
  return formatTokenAmount(scaled, PRECISION, { minFrac: 2, sigDigits: 5, maxFrac: 4 })
}

/** Percentage display only (inputs are already estimates): never shows a real impact as exactly 0%. */
export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  if (pct < 0.01) return '<0.01%'
  return `${pct.toFixed(2)}%`
}
