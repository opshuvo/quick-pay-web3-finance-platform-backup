/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet, base, optimism, arbitrum, polygon } from 'wagmi/chains'
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_CHAIN_ID, ARC_RPC_URL, arcMainnet } from '@/lib/arc'
import { env } from '@/lib/env'

registerChain(ARC_CHAIN_ID, ARC_RPC_URL)

/** Arc is the home chain. The others exist only so the Bridge can switch to a source chain. */
export const config = createConfig({
  chains: [arcMainnet, mainnet, base, optimism, arbitrum, polygon],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'FlowPay' }),
    ...(env.walletConnectProjectId ? [walletConnect({ projectId: env.walletConnectProjectId })] : []),
  ],
  transports: {
    // The page fires many reads at once. Batching sends them as one JSON-RPC request (Arc's RPC accepts
    // batches), which stays under the provider's rate limit; rate-limited items are retried with backoff.
    [arcMainnet.id]: http(ARC_RPC_URL, { batch: { wait: 20, batchSize: 50 }, retryCount: 4, retryDelay: 400, timeout: 20_000 }),
    [mainnet.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
  },
})

export const BRIDGE_ORIGIN_CHAIN_IDS: number[] = config.chains.map((c) => c.id)
