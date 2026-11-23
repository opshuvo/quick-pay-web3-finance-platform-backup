import type { ComponentType } from 'react'
import TokenACX from '@web3icons/react/icons/tokens/TokenACX'
import TokenARB from '@web3icons/react/icons/tokens/TokenARB'
import TokenAVAX from '@web3icons/react/icons/tokens/TokenAVAX'
import TokenBNB from '@web3icons/react/icons/tokens/TokenBNB'
import TokenDAI from '@web3icons/react/icons/tokens/TokenDAI'
import TokenETH from '@web3icons/react/icons/tokens/TokenETH'
import TokenEURC from '@web3icons/react/icons/tokens/TokenEURC'
import TokenLINK from '@web3icons/react/icons/tokens/TokenLINK'
import TokenOP from '@web3icons/react/icons/tokens/TokenOP'
import TokenPOL from '@web3icons/react/icons/tokens/TokenPOL'
import TokenPYUSD from '@web3icons/react/icons/tokens/TokenPYUSD'
import TokenUNI from '@web3icons/react/icons/tokens/TokenUNI'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import TokenUSDE from '@web3icons/react/icons/tokens/TokenUSDE'
import TokenUSDT from '@web3icons/react/icons/tokens/TokenUSDT'
import TokenWBTC from '@web3icons/react/icons/tokens/TokenWBTC'

type BrandIcon = ComponentType<{ variant?: 'branded' | 'mono' | 'background'; size?: number | string }>

/** Official brand icons bundled with the app (no requests). Wrapped tokens use the asset they represent. */
const BRAND: Record<string, BrandIcon> = {
  USDC: TokenUSDC,
  EURC: TokenEURC,
  USDT: TokenUSDT,
  DAI: TokenDAI,
  ETH: TokenETH,
  WETH: TokenETH,
  WBTC: TokenWBTC,
  ARB: TokenARB,
  OP: TokenOP,
  POL: TokenPOL,
  MATIC: TokenPOL,
  UNI: TokenUNI,
  LINK: TokenLINK,
  AVAX: TokenAVAX,
  WAVAX: TokenAVAX,
  BNB: TokenBNB,
  PYUSD: TokenPYUSD,
  USDE: TokenUSDE,
  ACX: TokenACX,
}

const PALETTE = ['#2f5bd8', '#0f766e', '#6048b8', '#a2510b', '#475569', '#0b6b86']

/** The real logo of a token when the app has it, otherwise a neutral initial badge (no remote logos are fetched). */
export function TokenIcon({ symbol, address, size = 32 }: { symbol: string; address?: string; size?: number }) {
  const upper = symbol.toUpperCase()
  const Brand = BRAND[upper]
  if (Brand) return <span className="token-badge" style={{ width: size, height: size }} role="img" aria-label={`${upper} logo`}><Brand variant="branded" size={size} /></span>
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
