/**
 * LI.FI route discovery shared by the Quick Pay backend and the browser fallback.
 *
 * A route is offered only when LI.FI's own `/connections` lists the source token as sendable AND the paired
 * destination token as receivable between the two chains. Tokens are looked up one symbol at a time, so a call
 * downloads a few small objects instead of LI.FI's full token list (megabytes on Ethereum).
 */

export interface LifiRoute {
  originChainId: number
  originToken: `0x${string}`
  destinationChainId: number
  destinationToken: `0x${string}`
  originTokenSymbol: string
  destinationTokenSymbol: string
  isNative: boolean
}

/** Quick Pay offers routes for these well-known assets only, not for every vault token LI.FI lists. */
export const LIFI_OFFERED_SYMBOLS = ['USDC', 'EURC', 'USDT', 'WETH', 'WBTC', 'cirBTC'] as const

const ZERO = '0x0000000000000000000000000000000000000000'

export type LifiGet = (path: string, params: Record<string, string>) => Promise<{ status: number; body: unknown }>

interface TokenDto { address: string; symbol: string; decimals: number }
interface Connection { fromTokens?: { address: string }[]; toTokens?: { address: string }[] }

export class LifiRoutesUnavailable extends Error {}

export async function deriveLifiRoutes(get: LifiGet, from: string, to: string): Promise<LifiRoute[]> {
  const connections = await get('/connections', { fromChain: from, toChain: to })
  if (connections.status !== 200) throw new LifiRoutesUnavailable('LI.FI could not list routes right now.')
  const fromSet = new Set<string>()
  const toSet = new Set<string>()
  for (const c of ((connections.body as { connections?: Connection[] }).connections ?? [])) {
    for (const t of c.fromTokens ?? []) fromSet.add(t.address.toLowerCase())
    for (const t of c.toTokens ?? []) toSet.add(t.address.toLowerCase())
  }
  const lookup = async (chain: string, symbol: string): Promise<TokenDto | undefined> => {
    try {
      const r = await get('/token', { chain, token: symbol })
      const t = r.status === 200 ? (r.body as TokenDto) : undefined
      return t && typeof t.address === 'string' && t.symbol?.toUpperCase() === symbol.toUpperCase() ? t : undefined
    } catch {
      return undefined
    }
  }
  const pairs = await Promise.all(LIFI_OFFERED_SYMBOLS.map(async (symbol) => [await lookup(from, symbol), await lookup(to, symbol)] as const))
  const out: LifiRoute[] = []
  for (const [f, t] of pairs) {
    if (!f || !t) continue
    const fa = f.address.toLowerCase()
    const ta = t.address.toLowerCase()
    if (fa === ZERO || ta === ZERO || !fromSet.has(fa) || !toSet.has(ta)) continue
    out.push({ originChainId: Number(from), originToken: f.address as `0x${string}`, destinationChainId: Number(to), destinationToken: t.address as `0x${string}`, originTokenSymbol: f.symbol, destinationTokenSymbol: t.symbol, isNative: false })
  }
  const rank = (s: string) => (s === 'USDC' ? 0 : s === 'EURC' ? 1 : 2)
  return out.sort((x, y) => rank(x.originTokenSymbol) - rank(y.originTokenSymbol) || x.originTokenSymbol.localeCompare(y.originTokenSymbol))
}
