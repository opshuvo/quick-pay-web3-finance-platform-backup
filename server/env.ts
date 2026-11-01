/**
 * Server configuration. Bun loads `.env` automatically; nothing here is ever sent to the browser.
 */
import { getUsdc, requireChain } from '../src/onchain-facts'

const ARC_CHAIN_ID = 5042
const arc = requireChain(ARC_CHAIN_ID)
const usdc = getUsdc(ARC_CHAIN_ID)
if (!usdc) throw new Error('USDC fact missing for Arc')

/** Studio-provisioned keyed RPC when available, otherwise the public Arc RPC from the facts registry. */
function resolveRpc(): { url: string; source: 'proxy' | 'public' } {
  const override = process.env.ARC_RPC_URL?.trim()
  if (override) return { url: override, source: 'public' }
  const base = process.env.RPC_PROXY_BASE_URL
  const token = process.env.RPC_PROXY_TOKEN
  const chains = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (base && token && chains.includes('Arc')) {
    return { url: `${base}/api/rpc/Arc?_rpc_token=${token}`, source: 'proxy' }
  }
  return { url: arc.rpcUrls[0], source: 'public' }
}

const rpc = resolveRpc()
const int = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const config = {
  port: int(process.env.PORT, 3001),
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  chainId: ARC_CHAIN_ID,
  usdc: usdc.address.toLowerCase(),
  rpcUrl: rpc.url,
  rpcSource: rpc.source,
  explorerBase: arc.explorerBase,
  acrossApiKey: process.env.ACROSS_API_KEY?.trim() || undefined,
  uniswapApiKey: process.env.UNISWAP_API_KEY?.trim() || undefined,
  acrossIntegratorId: process.env.ACROSS_INTEGRATOR_ID?.trim() || undefined,
  indexer: {
    /** eth_getLogs block span. Starts here and adapts to what the RPC accepts. */
    initialRange: int(process.env.INDEXER_RANGE, 2000),
    ceilingRange: int(process.env.INDEXER_RANGE_CEILING, 5000),
    /** Minimum gap between RPC calls. The public Arc RPC allows roughly 4 eth_getLogs per second, so the default stays under that. */
    minIntervalMs: int(process.env.INDEXER_MIN_INTERVAL_MS, 300),
    followLagBlocks: 40,
    /** Read requests sync a wallet's chain tip at most this often (and share one run at a time). */
    tipFreshnessMs: 15_000,
    /** A read waits at most this long for a tip sync before answering from stored data. */
    tipWaitMs: 2_500,
    /** A fully back-filled wallet counts as up to date within this many blocks of the head. */
    completeLagBlocks: 240,
    /** Unfinished wallets with no scan progress for this long are reported as stalled. */
    stallAfterMs: 10 * 60_000,
    /** New wallets are refused while this many are still backfilling. */
    maxPendingWallets: int(process.env.INDEXER_MAX_PENDING_WALLETS, 100),
  },
} as const
