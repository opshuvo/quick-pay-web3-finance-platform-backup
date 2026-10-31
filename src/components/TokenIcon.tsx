import TokenEURC from '@web3icons/react/icons/tokens/TokenEURC'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'

const PALETTE = ['#5b8cff', '#8b6cff', '#2fd4f0', '#22d3a0', '#e45bd0']

/** Real brand icons for USDC and EURC; a neutral initial badge for every other token (no remote logos are fetched). */
export function TokenIcon({ symbol, address, size = 32 }: { symbol: string; address?: string; size?: number }) {
  const upper = symbol.toUpperCase()
  if (upper === 'USDC') return <TokenUSDC variant="branded" size={size} />
  if (upper === 'EURC') return <TokenEURC variant="branded" size={size} />
  const seed = address ? parseInt(address.slice(2, 8), 16) : upper.charCodeAt(0)
  return (
    <span
      aria-hidden
      className="display inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: PALETTE[seed % PALETTE.length] }}
    >
      {upper[0] ?? '?'}
    </span>
  )
}
