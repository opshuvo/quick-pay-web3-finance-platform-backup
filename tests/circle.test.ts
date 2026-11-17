import { describe, expect, test } from 'bun:test'
import { parseResult, serializeResult, toCircleChain, withAddChainFallback, type CircleChain } from '../src/lib/circle'
import { deriveCircleTrack, fetchIris, mintHashOf, sumUsdcFees } from '../src/lib/circleStatus'
import { isTerminal, trackedSummary } from '../src/lib/bridgeStatus'
import { deriveLifiRoutes, type LifiGet } from '../shared/lifiRoutes'

const H1 = `0x${'1'.repeat(64)}` as const
const H2 = `0x${'2'.repeat(64)}` as const

describe('Circle status is only Complete when the destination mint is read back', () => {
  test('burn not yet confirmed', () => {
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'missing', iris: null, mint: undefined, destReceipt: 'unknown' }).phase).toBe('source-pending')
  })
  test('burn reverted', () => {
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'reverted', iris: null, mint: undefined, destReceipt: 'unknown' }).phase).toBe('source-failed')
  })
  test('waiting for the attestation', () => {
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris: { status: 'pending_confirmations' }, mint: undefined, destReceipt: 'unknown' }).phase).toBe('attesting')
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris: null, mint: undefined, destReceipt: 'unknown' }).phase).toBe('attesting')
  })
  test('attested: self mode needs the user to mint, forwarder mode waits for Circle', () => {
    const iris = { status: 'complete' as const }
    expect(deriveCircleTrack({ mode: 'self', source: 'success', iris, mint: undefined, destReceipt: 'unknown' }).phase).toBe('awaiting-mint')
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris, mint: undefined, destReceipt: 'unknown' }).phase).toBe('minting')
  })
  test('Circle saying COMPLETE is not enough: the mint receipt must be read from the destination', () => {
    const iris = { status: 'complete' as const, forwardState: 'COMPLETE', forwardTxHash: H2, destinationMintTxHash: H2 }
    const mint = mintHashOf(iris, {})
    expect(mint).toBe(H2)
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris, mint, destReceipt: 'unknown' })).toEqual({ phase: 'minting', hash: H2 })
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris, mint, destReceipt: 'missing' }).phase).toBe('minting')
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris, mint, destReceipt: 'reverted' }).phase).toBe('mint-failed')
    expect(deriveCircleTrack({ mode: 'forwarder', source: 'success', iris, mint, destReceipt: 'success' })).toEqual({ phase: 'delivered', hash: H2, verified: true })
  })
  test('a forward that is only pending gives no mint hash', () => {
    expect(mintHashOf({ status: 'complete', forwardState: 'PENDING', forwardTxHash: H2 }, {})).toBeUndefined()
    expect(mintHashOf({ destinationMintTxHash: 'nope' }, {})).toBeUndefined()
  })
  test('summary labels', () => {
    const done = { source: 'circle' as const, track: { phase: 'delivered' as const, hash: H2, verified: true } }
    expect(trackedSummary(done).label).toBe('Complete')
    expect(isTerminal(done)).toBe(true)
    const wait = { source: 'circle' as const, track: { phase: 'minting' as const, hash: H2 } }
    expect(trackedSummary(wait).label).toBe('In transit')
    expect(isTerminal(wait)).toBe(false)
    expect(trackedSummary({ source: 'circle', track: { phase: 'awaiting-mint' } }).label).toBe('Needs mint')
  })
})

describe('Circle helpers', () => {
  test('sums only USDC fees, exactly', () => {
    const parse = (v: string) => BigInt(Math.round(Number(v) * 1e6))
    expect(sumUsdcFees([{ token: 'USDC', amount: '0.000363' }, { token: 'USDC', amount: '0.017799' }, { token: 'ETH', amount: '1' }, { token: 'USDC', amount: null }], parse)).toBe(18_162n)
  })
  test('iris: 404 means not indexed yet, other failures throw', async () => {
    expect(await fetchIris(26, H1, (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch)).toBeNull()
    await expect(fetchIris(26, H1, (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow()
    const ok = (async () => new Response(JSON.stringify({ messages: [{ status: 'complete' }] }), { status: 200 })) as unknown as typeof fetch
    expect((await fetchIris(26, H1, ok))?.status).toBe('complete')
  })
  test('chain mapping keeps only mainnet EVM chains on CCTP V2 with a USDC address and an RPC', () => {
    const base = { type: 'evm', chain: 'Base', name: 'Base', chainId: 8453, isTestnet: false, usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', explorerUrl: 'https://basescan.org/tx/{hash}', rpcEndpoints: ['https://mainnet.base.org'], cctp: { domain: 6, contracts: { v2: {} }, forwarderSupported: { destination: true } } }
    expect(toCircleChain(base)?.explorerBase).toBe('https://basescan.org')
    expect(toCircleChain(base)?.forwarder).toBe(true)
    expect(toCircleChain({ ...base, isTestnet: true })).toBeUndefined()
    expect(toCircleChain({ ...base, type: 'solana' })).toBeUndefined()
    expect(toCircleChain({ ...base, cctp: { domain: 6, contracts: {} } })).toBeUndefined()
    expect(toCircleChain({ ...base, rpcEndpoints: [] })).toBeUndefined()
  })
  test('a wallet that does not know the destination chain is asked to add it, then switched', async () => {
    const calls: { method: string }[] = []
    let known = false
    const provider = {
      request: async (args: { method: string }) => {
        calls.push(args)
        if (args.method === 'wallet_switchEthereumChain' && !known) throw Object.assign(new Error('unknown chain'), { code: 4902 })
        if (args.method === 'wallet_addEthereumChain') known = true
        return null
      },
    }
    const chain = { chainId: 130, name: 'Unichain', rpc: 'https://rpc', explorerBase: 'https://uniscan.xyz', nativeSymbol: 'ETH', nativeDecimals: 18 } as CircleChain
    const wrapped = withAddChainFallback(provider as never, [chain])
    await wrapped.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x82' }] } as never)
    expect(calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain'])
  })
  test('an SDK result survives storage, bigint included', () => {
    const r = { state: 'error', steps: [{ name: 'burn', state: 'success', txHash: H1, data: { amount: 5n } }] } as never
    const back = parseResult(serializeResult(r)) as unknown as { steps: { data: { amount: bigint } }[] }
    expect(back.steps[0]?.data.amount).toBe(5n)
  })
})

describe('LI.FI route discovery offers only routes LI.FI lists', () => {
  const token = (chain: string, symbol: string, address: string) => ({ address, symbol, decimals: 6, chain })
  const get: LifiGet = async (path, params) => {
    if (path === '/connections') return { status: 200, body: { connections: [{ fromTokens: [{ address: '0xAAA0' }], toTokens: [{ address: '0xBBB0' }] }] } }
    const t: Record<string, ReturnType<typeof token>> = {
      '5042:USDC': token('5042', 'USDC', '0xAAA0'), '8453:USDC': token('8453', 'USDC', '0xBBB0'),
      '5042:EURC': token('5042', 'EURC', '0xAAA1'), '8453:EURC': token('8453', 'EURC', '0xBBB1'),
    }
    const found = t[`${params.chain}:${params.token}`]
    return found ? { status: 200, body: found } : { status: 404, body: { message: 'not found' } }
  }
  test('USDC is offered; EURC is not because LI.FI does not connect it; unknown symbols are skipped', async () => {
    const routes = await deriveLifiRoutes(get, '5042', '8453')
    expect(routes.map((r) => r.originTokenSymbol)).toEqual(['USDC'])
    expect(routes[0]).toMatchObject({ originChainId: 5042, destinationChainId: 8453, originToken: '0xAAA0', destinationToken: '0xBBB0', isNative: false })
  })
  test('an unavailable connections list fails loudly instead of returning invented routes', async () => {
    await expect(deriveLifiRoutes(async () => ({ status: 502, body: {} }), '5042', '8453')).rejects.toThrow()
  })
})
