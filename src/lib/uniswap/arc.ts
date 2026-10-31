/**
 * Uniswap v3/v4 quoting and Universal Router 2.1.2 calldata for Arc Mainnet.
 * Contract addresses are the verified Arc deployments; nothing here talks to a hosted API.
 */
import {
  BaseError, ContractFunctionRevertedError, encodeAbiParameters, encodeFunctionData, encodePacked, erc20Abi, keccak256,
  parseAbi, parseAbiParameters, parseUnits, toHex, zeroAddress, type Address, type Hex, type PublicClient,
} from 'viem'
import { ARC_CHAIN_ID } from '@/lib/arc'

export const UNIVERSAL_ROUTER: Address = '0x8702463e73f74d0b6765aBceb314Ef07aCb92650'
export const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const V3_FACTORY: Address = '0xf0db7b58379503491d857dB50AC9ece64c653918'
const V3_QUOTER: Address = '0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468'
const V4_QUOTER: Address = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94'
const V4_STATE_VIEW: Address = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b'

export const UNISWAP_CONTRACTS: { name: string; address: Address }[] = [
  { name: 'Universal Router 2.1.2', address: UNIVERSAL_ROUTER },
  { name: 'Permit2', address: PERMIT2 },
  { name: 'v3 Factory', address: V3_FACTORY },
  { name: 'v3 Quoter', address: V3_QUOTER },
  { name: 'v4 Quoter', address: V4_QUOTER },
  { name: 'v4 StateView', address: V4_STATE_VIEW },
]

const V3_FEES = [100, 500, 3000, 10000] as const
const V4_KEYS = [[100, 1], [500, 10], [3000, 60], [10000, 200]] as const

export const PRICE_IMPACT_WARN = 0.01
export const PRICE_IMPACT_BLOCK = 0.05
export const SLIPPAGE_DEFAULT_BPS = 50
export const SLIPPAGE_WARN_BPS = 50
export const SLIPPAGE_MAX_BPS = 100

const abi = parseAbi([
  'function getPool(address,address,uint24) view returns (address)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160, uint32, uint256)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountIn, uint160, uint32, uint256)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
])
const v4QuoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)',
  'function quoteExactOutputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256 amountIn, uint256 gasEstimate)',
])

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export type Side = 'exactIn' | 'exactOut'
export type Route =
  | { version: 'v3'; fee: number; sqrtPriceX96: bigint; feeFraction: number }
  | { version: 'v4'; key: PoolKey; sqrtPriceX96: bigint; feeFraction: number }
export type Quote = { route: Route; side: Side; amountIn: bigint; amountOut: bigint; priceImpact: number }

export type DeploymentStatus = 'ok' | 'missing' | 'error'
export interface DeploymentCheck {
  name: string
  address: Address
  /** ok: code found. missing: the RPC answered and there is no code. error: no answer (rate limit, timeout, network). */
  status: DeploymentStatus
  ok: boolean
}

/**
 * Confirms every Uniswap contract used here has code on Arc before swapping is enabled. Each contract is
 * checked on its own so that an RPC failure is never reported as "contract missing" (and one failed
 * request cannot hide the others). Swapping stays disabled unless every contract is positively found.
 */
export async function checkUniswapDeployment(client: Pick<PublicClient, 'getCode'>): Promise<DeploymentCheck[]> {
  const results = await Promise.allSettled(UNISWAP_CONTRACTS.map((c) => client.getCode({ address: c.address })))
  return UNISWAP_CONTRACTS.map((c, i) => {
    const r = results[i]
    const status: DeploymentStatus = r.status === 'rejected' ? 'error' : r.value && r.value !== '0x' ? 'ok' : 'missing'
    return { ...c, status, ok: status === 'ok' }
  })
}

/** What the deployment check means for the user: verified, genuinely missing, or simply unreachable. */
export function summarizeDeployment(checks: DeploymentCheck[] | undefined, failed: boolean): 'checking' | 'verified' | 'missing' | 'unreachable' {
  if (failed) return 'unreachable'
  if (!checks) return 'checking'
  if (checks.some((c) => c.status === 'missing')) return 'missing'
  if (checks.some((c) => c.status === 'error')) return 'unreachable'
  return 'verified'
}

export async function assertWithinBalance(client: PublicClient, token: Address, owner: Address, amount: bigint) {
  const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (amount > balance) throw new Error('Amount exceeds your token balance.')
}

const isRevert = (error: unknown) => error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null

export async function parseTokenAmount(client: PublicClient, token: Address, human: string, owner?: Address) {
  if (token === zeroAddress) throw new Error('Use the USDC ERC-20 address, not the 0x0 native sentinel')
  const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })
  const amount = parseUnits(human, decimals)
  if (amount <= 0n) throw new Error('Amount must be positive')
  if (owner) await assertWithinBalance(client, token, owner, amount)
  return amount
}

const poolId = (k: PoolKey): Hex =>
  keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]))

export async function findRoutes(client: PublicClient, tokenIn: Address, tokenOut: Address): Promise<Route[]> {
  const [c0, c1] = BigInt(tokenIn) < BigInt(tokenOut) ? [tokenIn, tokenOut] : [tokenOut, tokenIn]
  const zeroForOne = tokenIn === c0
  const v3 = V3_FEES.map(async (fee): Promise<Route | null> => {
    const pool = await client.readContract({ address: V3_FACTORY, abi, functionName: 'getPool', args: [tokenIn, tokenOut, fee] })
    if (pool === zeroAddress) return null
    const [liquidity, slot0] = await Promise.all([
      client.readContract({ address: pool, abi, functionName: 'liquidity' }),
      client.readContract({ address: pool, abi, functionName: 'slot0' }),
    ])
    if (liquidity === 0n || slot0[0] === 0n) return null
    return { version: 'v3', fee, sqrtPriceX96: slot0[0], feeFraction: fee / 1e6 }
  })
  const v4 = V4_KEYS.map(async ([fee, tickSpacing]): Promise<Route | null> => {
    const key: PoolKey = { currency0: c0, currency1: c1, fee, tickSpacing, hooks: zeroAddress }
    const id = poolId(key)
    const [liquidity, slot0] = await Promise.all([
      client.readContract({ address: V4_STATE_VIEW, abi, functionName: 'getLiquidity', args: [id] }),
      client.readContract({ address: V4_STATE_VIEW, abi, functionName: 'getSlot0', args: [id] }),
    ])
    if (liquidity === 0n || slot0[0] === 0n) return null
    const protocolPips = zeroForOne ? slot0[2] & 0xfff : slot0[2] >> 12
    const lpPips = slot0[3]
    const totalPips = protocolPips + lpPips - (protocolPips * lpPips) / 1_000_000
    return { version: 'v4', key, sqrtPriceX96: slot0[0], feeFraction: totalPips / 1e6 }
  })
  const routes = await Promise.all([...v3, ...v4])
  return routes.filter((route): route is Route => route !== null)
}

function midPrice(route: Route, tokenIn: Address, tokenOut: Address): number {
  const p = (Number(route.sqrtPriceX96) / 2 ** 96) ** 2
  return BigInt(tokenIn) < BigInt(tokenOut) ? p : 1 / p
}

async function quoteRoute(client: PublicClient, route: Route, tokenIn: Address, tokenOut: Address, side: Side, amount: bigint) {
  const fn = side === 'exactIn' ? 'quoteExactInputSingle' : 'quoteExactOutputSingle'
  if (route.version === 'v3') {
    const params = side === 'exactIn'
      ? { tokenIn, tokenOut, amountIn: amount, fee: route.fee, sqrtPriceLimitX96: 0n }
      : { tokenIn, tokenOut, amount, fee: route.fee, sqrtPriceLimitX96: 0n }
    const { result } = await client.simulateContract({ address: V3_QUOTER, abi, functionName: fn, args: [params as never] })
    return result[0]
  }
  const { result } = await client.simulateContract({
    address: V4_QUOTER, abi: v4QuoterAbi, functionName: fn,
    args: [{ poolKey: route.key, zeroForOne: tokenIn === route.key.currency0, exactAmount: amount, hookData: '0x' }],
  })
  return result[0]
}

export class NoRouteError extends Error {}

/** Quotes every live pool on v3 and v4 and returns the best, with price impact against the fee-free mid price. */
export async function bestQuote(client: PublicClient, tokenIn: Address, tokenOut: Address, side: Side, amount: bigint): Promise<Quote> {
  const routes = await findRoutes(client, tokenIn, tokenOut)
  if (routes.length === 0) throw new NoRouteError('No live pool with liquidity for this pair.')
  const quoted = await Promise.all(routes.map(async (route): Promise<Quote | null> => {
    const other = await quoteRoute(client, route, tokenIn, tokenOut, side, amount).catch((error: unknown) => {
      if (isRevert(error)) return null
      throw error
    })
    if (other === null || other === 0n) return null
    const [amountIn, amountOut] = side === 'exactIn' ? [amount, other] : [other, amount]
    const fair = Number(amountIn) * midPrice(route, tokenIn, tokenOut) * (1 - route.feeFraction)
    return { route, side, amountIn, amountOut, priceImpact: Math.max(0, 1 - Number(amountOut) / fair) }
  }))
  const quotes = quoted.filter((quote): quote is Quote => quote !== null)
  if (quotes.length === 0) throw new NoRouteError('No pool can fill this size.')
  quotes.sort((a, b) => (side === 'exactIn' ? Number(b.amountOut - a.amountOut) : Number(a.amountIn - b.amountIn)))
  return quotes[0]
}

export function assertSlippage(slippageBps: number) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > SLIPPAGE_MAX_BPS) {
    throw new Error(`Slippage must be a whole number of basis points from 0 to ${SLIPPAGE_MAX_BPS}, got ${slippageBps}`)
  }
}

export const minOut = (amountOut: bigint, slippageBps: number) => {
  assertSlippage(slippageBps)
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}
export const maxIn = (amountIn: bigint, slippageBps: number) => {
  assertSlippage(slippageBps)
  return (amountIn * BigInt(10_000 + slippageBps)) / 10_000n
}

export type PermitSingle = { details: { token: Address; amount: bigint; expiration: number; nonce: number }; spender: Address; sigDeadline: bigint }

export const PERMIT2_TYPES = {
  PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
  PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
} as const
export const PERMIT2_DOMAIN = { name: 'Permit2', chainId: ARC_CHAIN_ID, verifyingContract: PERMIT2 } as const

export async function permitNeeded(client: PublicClient, owner: Address, token: Address, amount: bigint, now: bigint): Promise<PermitSingle | null> {
  const [allowed, expiration, nonce] = await client.readContract({ address: PERMIT2, abi, functionName: 'allowance', args: [owner, token, UNIVERSAL_ROUTER] })
  if (allowed >= amount && BigInt(expiration) > now + 60n) return null
  return { details: { token, amount, expiration: Number(now + 30n * 86_400n), nonce: Number(nonce) }, spender: UNIVERSAL_ROUTER, sigDeadline: now + 1_800n }
}

const POOL_KEY = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'
const CMD = { V3_SWAP_EXACT_IN: 0x00, V3_SWAP_EXACT_OUT: 0x01, PERMIT2_PERMIT: 0x0a, V4_SWAP: 0x10 } as const
const ACT = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_OUT_SINGLE: 0x08, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const

export function buildSwap(
  q: Quote, tokenIn: Address, tokenOut: Address, recipient: Address, slippageBps: number, deadline: bigint,
  permit?: { permit: PermitSingle; signature: Hex },
) {
  assertSlippage(slippageBps)
  const commands: number[] = []
  const inputs: Hex[] = []
  if (permit) {
    commands.push(CMD.PERMIT2_PERMIT)
    inputs.push(encodeAbiParameters(
      parseAbiParameters('((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline), bytes'),
      [permit.permit, permit.signature],
    ))
  }
  const exactIn = q.side === 'exactIn'
  const limitIn = exactIn ? q.amountIn : maxIn(q.amountIn, slippageBps)
  const limitOut = exactIn ? minOut(q.amountOut, slippageBps) : q.amountOut
  if (q.route.version === 'v3') {
    const path = exactIn
      ? encodePacked(['address', 'uint24', 'address'], [tokenIn, q.route.fee, tokenOut])
      : encodePacked(['address', 'uint24', 'address'], [tokenOut, q.route.fee, tokenIn])
    commands.push(exactIn ? CMD.V3_SWAP_EXACT_IN : CMD.V3_SWAP_EXACT_OUT)
    inputs.push(encodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'),
      exactIn ? [recipient, limitIn, limitOut, path, true, []] : [recipient, limitOut, limitIn, path, true, []]))
  } else {
    const zeroForOne = tokenIn === q.route.key.currency0
    const actions = encodePacked(['uint8', 'uint8', 'uint8'], [exactIn ? ACT.SWAP_EXACT_IN_SINGLE : ACT.SWAP_EXACT_OUT_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL])
    const swap = exactIn
      ? encodeAbiParameters(parseAbiParameters(`(${POOL_KEY} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`),
          [{ poolKey: q.route.key, zeroForOne, amountIn: limitIn, amountOutMinimum: limitOut, minHopPriceX36: 0n, hookData: '0x' }])
      : encodeAbiParameters(parseAbiParameters(`(${POOL_KEY} poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,uint256 minHopPriceX36,bytes hookData)`),
          [{ poolKey: q.route.key, zeroForOne, amountOut: limitOut, amountInMaximum: limitIn, minHopPriceX36: 0n, hookData: '0x' }])
    const settle = encodeAbiParameters(parseAbiParameters('address,uint256'), [tokenIn, limitIn])
    const take = encodeAbiParameters(parseAbiParameters('address,uint256'), [tokenOut, limitOut])
    commands.push(CMD.V4_SWAP)
    inputs.push(encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, [swap, settle, take]]))
  }
  const data = encodeFunctionData({ abi, functionName: 'execute', args: [toHex(new Uint8Array(commands)), inputs, deadline] })
  return { to: UNIVERSAL_ROUTER, data, value: 0n, limitIn, limitOut }
}
