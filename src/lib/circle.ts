/**
 * Circle's official USDC bridge (CCTP through the App Kit SDK). The SDK is loaded on demand, so it adds nothing
 * to the first page load. Chains come from the SDK's live registry, fees from `estimateBridge`, and transfers are
 * signed only by the user's own wallet.
 */
import type { AppKit, BridgeResult } from '@circle-fin/app-kit'
import type { Address, EIP1193Provider, Hex } from 'viem'
import { isAddress } from 'viem'
import type { AcrossChain } from '@/lib/across'
import type { CircleMode, CircleSpeed } from '@/lib/circleStatus'

export const CIRCLE_URL = 'https://www.circle.com/cross-chain-transfer-protocol'

export interface CircleChain {
  chainId: number
  /** Circle's chain name, as the SDK expects it. */
  kit: string
  name: string
  domain: number
  /** Circle can submit the mint on this chain for the user. */
  forwarder: boolean
  usdc: Address
  rpc: string
  explorerBase: string
  nativeSymbol: string
  nativeDecimals: number
}

/** The slice of the SDK's chain definition this app reads. */
interface KitChain {
  type: string
  chain: string
  name: string
  chainId?: number
  isTestnet: boolean
  usdcAddress?: string | null
  explorerUrl?: string
  rpcEndpoints?: string[]
  nativeCurrency?: { symbol: string; decimals: number }
  cctp?: { domain: number; contracts?: { v2?: unknown }; forwarderSupported?: { destination?: boolean } }
}

export interface CircleFee { type: string; token: string; amount: string | null }
export interface CircleGasFee { name: string; token: string; blockchain: string; fee: string | null }
export interface CircleEstimate { gasFees: CircleGasFee[]; fees: CircleFee[] }

let kitPromise: Promise<AppKit> | undefined
/** One shared SDK instance for estimates. Transfers use their own, so event listeners never pile up. */
const sharedKit = () => (kitPromise ??= import('@circle-fin/app-kit').then((m) => new m.AppKit()))
const freshKit = () => import('@circle-fin/app-kit').then((m) => new m.AppKit())

export function toCircleChain(c: KitChain): CircleChain | undefined {
  if (c.type !== 'evm' || c.isTestnet || !c.chainId || !c.cctp?.contracts?.v2 || !c.usdcAddress || !isAddress(c.usdcAddress)) return undefined
  const rpc = c.rpcEndpoints?.[0]
  if (!rpc) return undefined
  return {
    chainId: c.chainId,
    kit: c.chain,
    name: c.name,
    domain: c.cctp.domain,
    forwarder: c.cctp.forwarderSupported?.destination === true,
    usdc: c.usdcAddress,
    rpc,
    explorerBase: (c.explorerUrl ?? '').replace(/\/tx\/.*$/, '').replace(/\/$/, ''),
    nativeSymbol: c.nativeCurrency?.symbol ?? 'ETH',
    nativeDecimals: c.nativeCurrency?.decimals ?? 18,
  }
}

/** Mainnet EVM chains on CCTP V2, from Circle's registry. */
export async function loadCircleChains(): Promise<CircleChain[]> {
  const kit = await sharedKit()
  return (kit.getSupportedChains() as unknown as KitChain[]).map(toCircleChain).filter((c): c is CircleChain => c !== undefined)
}

/** The shape the shared chain labels and explorer links use. */
export const circleChainsAsList = (chains: CircleChain[]): AcrossChain[] => chains.map((c) => ({ chainId: c.chainId, name: c.name, explorerUrl: c.explorerBase }))

/**
 * Wallets reject a switch to a network they do not know (error 4902). Without this the SDK would fail after the
 * burn, when it switches to the destination chain for the mint. This asks the wallet to add the chain first.
 */
export function withAddChainFallback(provider: EIP1193Provider, chains: CircleChain[]): EIP1193Provider {
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await provider.request(args as never)
    } catch (error) {
      const code = (error as { code?: number }).code
      const target = (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId
      if (args.method !== 'wallet_switchEthereumChain' || code !== 4902 || !target) throw error
      const chain = chains.find((c) => `0x${c.chainId.toString(16)}` === target.toLowerCase())
      if (!chain) throw error
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: target, chainName: chain.name, nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: chain.nativeDecimals }, rpcUrls: [chain.rpc], blockExplorerUrls: chain.explorerBase ? [chain.explorerBase] : undefined }],
      } as never)
      return provider.request(args as never)
    }
  }) as EIP1193Provider['request']
  return new Proxy(provider, { get: (target, prop, receiver): unknown => (prop === 'request' ? request : (Reflect.get(target, prop, receiver) as unknown)) })
}

export async function buildCircleAdapter(provider: EIP1193Provider, chains: CircleChain[]) {
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2')
  return createViemAdapterFromProvider({ provider: withAddChainFallback(provider, chains) })
}
export type CircleAdapter = Awaited<ReturnType<typeof buildCircleAdapter>>

export interface CircleTransferInput {
  adapter: CircleAdapter
  from: CircleChain
  to: CircleChain
  amount: string
  recipient: Address
  mode: CircleMode
  speed: CircleSpeed
}

function paramsOf(i: CircleTransferInput) {
  return {
    from: { adapter: i.adapter, chain: i.from.kit },
    to: i.mode === 'forwarder'
      ? { chain: i.to.kit, recipientAddress: i.recipient, useForwarder: true as const }
      : { adapter: i.adapter, chain: i.to.kit, recipientAddress: i.recipient },
    amount: i.amount,
    token: 'USDC' as const,
    config: { transferSpeed: i.speed },
  }
}

/** Live fee estimate from Circle for exactly this transfer. Throws when Circle does not offer the route. */
export async function estimateCircle(i: CircleTransferInput): Promise<CircleEstimate> {
  const kit = await sharedKit()
  const e = await kit.estimateBridge(paramsOf(i) as never)
  return {
    gasFees: (e.gasFees ?? []).map((g) => ({ name: g.name, token: g.token, blockchain: String(g.blockchain), fee: g.fees?.fee ?? null })),
    fees: (e.fees ?? []).map((f) => ({ type: String(f.type), token: f.token, amount: f.amount ?? null })),
  }
}

export interface CircleProgress { step: string; txHash?: Hex }

/** Steps the SDK reports while it runs. Only the burn and mint hashes are acted on. */
function readEvent(payload: unknown): CircleProgress | undefined {
  const p = payload as { method?: unknown; values?: { txHash?: unknown } } | null
  if (!p || typeof p.method !== 'string') return undefined
  const hash = p.values?.txHash
  return { step: p.method, txHash: typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hex) : undefined }
}

export async function runCircleTransfer(i: CircleTransferInput, onProgress: (p: CircleProgress) => void): Promise<BridgeResult> {
  const kit = await freshKit()
  kit.on('*', (payload: unknown) => {
    const p = readEvent(payload)
    if (p) onProgress(p)
  })
  return kit.bridge(paramsOf(i) as never)
}

export async function resumeCircleTransfer(result: BridgeResult, adapter: CircleAdapter): Promise<BridgeResult> {
  const kit = await freshKit()
  return kit.retryBridge(result, { from: adapter, to: adapter })
}

/** Facts read from a finished (or stopped) SDK result. */
export function summarizeCircleResult(result: BridgeResult) {
  const step = (name: string) => result.steps.find((s) => s.name.toLowerCase() === name)
  const hashOf = (name: string) => {
    const h = step(name)?.txHash
    return h && /^0x[0-9a-fA-F]{64}$/.test(h) ? (h as Hex) : undefined
  }
  const failed = result.steps.find((s) => s.state === 'error')
  return { state: result.state, burn: hashOf('burn'), mint: hashOf('mint'), failedStep: failed?.name, failedMessage: failed?.errorMessage, userRejected: failed?.errorCategory === 'user_rejected', forwarded: step('mint')?.forwarded }
}

/** JSON that survives bigint values, so a stopped transfer can be stored and resumed later. */
export const serializeResult = (r: BridgeResult) => JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? { __bigint: v.toString() } : v instanceof Error ? { message: v.message } : v))
export const parseResult = (s: string): BridgeResult => JSON.parse(s, (_k, v: unknown) => (v && typeof v === 'object' && '__bigint' in v ? BigInt((v as { __bigint: string }).__bigint) : v)) as BridgeResult
