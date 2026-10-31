/**
 * Pure helpers that read token movements out of a transaction receipt. Shared by the server and the
 * browser so both derive swap legs exactly the same way. No I/O.
 */

// Arc's native-USDC view emits its own 18-decimal Transfer logs from this system address, measured in a real
// Arc receipt. They mirror the USDC ERC-20 logs for the same movement, so counting both would double-count.
export const NATIVE_TRANSFER_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe'
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export interface TokenFlow {
  token: string
  net: bigint
}

interface LogLike {
  address: string
  topics: readonly (string | null | undefined)[]
  data: string
}

/** Net ERC-20 balance change per token for `wallet`, derived from Transfer logs in a receipt. */
export function netFlows(logs: readonly LogLike[], wallet: string): TokenFlow[] {
  const w = wallet.toLowerCase()
  const net = new Map<string, bigint>()
  for (const log of logs) {
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) continue
    if (log.address.toLowerCase() === NATIVE_TRANSFER_EMITTER) continue
    const from = `0x${log.topics[1]?.slice(26)}`.toLowerCase()
    const to = `0x${log.topics[2]?.slice(26)}`.toLowerCase()
    if (from !== w && to !== w) continue
    const amount = BigInt(log.data === '0x' ? 0 : log.data)
    const token = log.address.toLowerCase()
    net.set(token, (net.get(token) ?? 0n) + (to === w ? amount : 0n) - (from === w ? amount : 0n))
  }
  return [...net].map(([token, value]) => ({ token, net: value })).filter((f) => f.net !== 0n)
}

/** Picks the token the wallet spent and the token it received. */
export function pickSwapLegs(flows: TokenFlow[]): { tokenIn: TokenFlow; tokenOut: TokenFlow } | null {
  const spent = flows.filter((f) => f.net < 0n).sort((a, b) => (a.net < b.net ? -1 : 1))[0]
  const got = flows.filter((f) => f.net > 0n).sort((a, b) => (a.net > b.net ? -1 : 1))[0]
  return spent && got ? { tokenIn: spent, tokenOut: got } : null
}
