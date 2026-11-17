/**
 * Live read-only checks of every Bridge integration against Arc Mainnet and the providers' public APIs.
 * Sends nothing and needs no wallet or key: `bun run test:bridge-live`.
 */
import { createPublicClient, erc20Abi, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { acrossApi } from '../src/lib/across'
import { assertBridgeQuote } from '../src/lib/bridgeGuard'
import { estimateCircle, loadCircleChains } from '../src/lib/circle'
import { fetchIris } from '../src/lib/circleStatus'
import { lifiApi, lifiToQuote } from '../src/lib/lifi'
import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_USDC } from '../src/lib/arc'

let failed = 0
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const need = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }

const wallet = privateKeyToAccount(generatePrivateKey()).address // a throwaway address: quotes only, no funds
const arc = createPublicClient({ transport: http(ARC_RPC_URL) })

await check('Arc RPC: chain id 5042 and USDC has 6 decimals', async () => {
  need((await arc.getChainId()) === ARC_CHAIN_ID, 'wrong chain id')
  need((await arc.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'decimals' })) === 6, 'USDC decimals')
})

const acrossChains = await acrossApi.chains().catch(() => [])
await check('Across: live networks include Arc', async () => need(acrossChains.some((c) => c.chainId === ARC_CHAIN_ID), 'Arc missing'))
await check('Across: Arc to Ethereum USDC route, quote passes the safety guard', async () => {
  const routes = await acrossApi.routes(ARC_CHAIN_ID, 1)
  const route = routes.find((r) => r.originTokenSymbol === 'USDC' && !r.isNative)
  need(route, 'no USDC route')
  const r = route as NonNullable<typeof route>
  const amount = 5_000_000n
  const q = await acrossApi.quote({ amount, inputToken: r.originToken, outputToken: r.destinationToken, origin: ARC_CHAIN_ID, destination: 1, depositor: wallet, recipient: wallet })
  assertBridgeQuote(q, { origin: ARC_CHAIN_ID, destination: 1, originToken: r.originToken, destinationToken: r.destinationToken, amountRaw: amount })
  need(BigInt(q.minOutputAmount) > 0n && BigInt(q.minOutputAmount) < amount, 'implausible output')
})
await check('Across: a deposit that was never made reads as not found, not as success', async () => {
  const status = await acrossApi.status(`0x${'ab'.repeat(32)}`).then((s) => s.status, (e: { status?: number }) => `error ${e.status}`)
  need(status !== 'filled', `unexpected ${status}`)
})

const lifiChains = await lifiApi.chains().catch(() => [])
await check('LI.FI: live networks include Arc with its contract address', async () => need(lifiChains.find((c) => c.chainId === ARC_CHAIN_ID)?.diamond, 'Arc or diamond missing'))
await check('LI.FI: Arc to Base USDC route, quote passes the safety guard', async () => {
  const routes = await lifiApi.routes(ARC_CHAIN_ID, 8453)
  const route = routes.find((r) => r.originTokenSymbol === 'USDC')
  need(route, 'no USDC route')
  const r = route as NonNullable<typeof route>
  const amount = 5_000_000n
  const raw = await lifiApi.quote({ amount, inputToken: r.originToken, outputToken: r.destinationToken, origin: ARC_CHAIN_ID, destination: 8453, depositor: wallet, recipient: wallet })
  const diamond = lifiChains.find((c) => c.chainId === ARC_CHAIN_ID)?.diamond
  const q = lifiToQuote(raw, { depositor: wallet, recipient: wallet, diamond, allowance: 0n, nowMs: Date.now() })
  assertBridgeQuote(q, { origin: ARC_CHAIN_ID, destination: 8453, originToken: r.originToken, destinationToken: r.destinationToken, amountRaw: amount })
})
await check('LI.FI: an unknown transfer reads as not found', async () => {
  const s = await lifiApi.status(`0x${'cd'.repeat(32)}`, ARC_CHAIN_ID, 8453)
  need(s.status === 'NOT_FOUND' || s.status === 'INVALID', `unexpected ${s.status}`)
})

const circleChains = await loadCircleChains().catch(() => [])
await check('Circle: registry lists Arc (domain 26) and other CCTP chains', async () => {
  need(circleChains.find((c) => c.chainId === ARC_CHAIN_ID)?.domain === 26, 'Arc missing')
  need(circleChains.length >= 5, 'too few chains')
})
for (const [toId, mode] of [[8453, 'forwarder'], [1, 'self']] as const) {
  await check(`Circle: live estimate Arc to chain ${toId} (${mode})`, async () => {
    const from = circleChains.find((c) => c.chainId === ARC_CHAIN_ID)
    const to = circleChains.find((c) => c.chainId === toId)
    need(from && to, 'chain missing')
    const adapter = createViemAdapterFromPrivateKey({ privateKey: generatePrivateKey() })
    const e = await estimateCircle({ adapter: adapter as never, from: from as NonNullable<typeof from>, to: to as NonNullable<typeof to>, amount: '10', recipient: wallet, mode, speed: 'FAST' })
    need(e.gasFees.length >= 2, 'no gas steps')
    if (mode === 'forwarder') need(e.fees.some((f) => f.type === 'forwarder' && Number(f.amount) > 0), 'no forwarder fee')
  })
}
await check('Circle: an unknown burn reads as not indexed', async () => need((await fetchIris(26, `0x${'ef'.repeat(32)}`)) === null, 'expected null'))

console.log(failed === 0 ? '\nAll live bridge checks passed.' : `\n${failed} live check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
