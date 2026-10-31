import { formatUnitsExact } from '@/onchain-money'

export const shortAddress = (address: string, head = 6, tail = 4) =>
  address.length > head + tail + 2 ? `${address.slice(0, head)}…${address.slice(-tail)}` : address

export const shortHash = (hash: string) => shortAddress(hash, 10, 6)

/** Formats a raw token amount with thousands separators, trimming to `minFrac`..`maxFrac` decimals. */
export function displayUnits(raw: bigint, decimals: number, minFrac = 2, maxFrac = 6): string {
  const negative = raw < 0n
  const exact = formatUnitsExact(negative ? -raw : raw, decimals)
  const [whole, frac = ''] = exact.split('.')
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let fracOut = frac.slice(0, maxFrac).replace(/0+$/, '')
  while (fracOut.length < minFrac) fracOut += '0'
  return `${negative ? '-' : ''}${wholeFmt}${fracOut ? `.${fracOut}` : ''}`
}

export const displayUsdc = (raw: bigint, minFrac = 2, maxFrac = 6) => displayUnits(raw, 6, minFrac, maxFrac)

export const formatDateTime = (value: string | number | Date) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function formatRelative(value: string | number | Date): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(seconds, 'second')
}

export const formatNumber = (value: number | bigint) => new Intl.NumberFormat().format(value)
