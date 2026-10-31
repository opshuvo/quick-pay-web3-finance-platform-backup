/**
 * Verified Swap and Bridge activity.
 * A record exists only after the source transaction was read back from its chain and succeeded.
 * Bridges are marked complete only after Across reports the fill AND the destination fill
 * transaction is read back from the destination chain as successful.
 */
import { createPublicClient, erc20Abi, http, isAddress, type Address, type Hex, type Log, type PublicClient } from 'viem'
import { UNISWAP_UNIVERSAL_ROUTER } from '../shared/uniswap-constants'
import type { ActivityDto } from '../shared/api-types'
import { HttpError, requireDb } from './db'
import { config } from './env'
import { client as arcClient, rpc } from './rpc'

// arc-studio-allow-onchain-literal
// Arc's native-USDC view emits its own 18-decimal Transfer logs from this system address, measured in a real
// Arc receipt. They mirror the USDC ERC-20 logs for the same movement, so counting both would double-count.
const NATIVE_TRANSFER_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ACROSS = 'https://app.across.to/api'
const hashPattern = /^0x[0-9a-fA-F]{64}$/

export interface TokenFlow {
  token: string
  net: bigint
}

/** Net ERC-20 balance change per token for `wallet`, derived from Transfer logs in a receipt. */
export function netFlows(logs: readonly Pick<Log, 'address' | 'topics' | 'data'>[], wallet: string): TokenFlow[] {
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

// ---- chain access ---------------------------------------------------------------------------

let chainRpcs: { at: number; urls: Map<number, string> } | null = null
const clients = new Map<number, PublicClient>()

async function acrossRpc(chainId: number): Promise<string | undefined> {
  if (!chainRpcs || Date.now() - chainRpcs.at > 10 * 60_000) {
    const res = await fetch(`${ACROSS}/swap/chains`, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
    if (res?.ok) {
      const list = (await res.json()) as { chainId: number; publicRpcUrl?: string }[]
      chainRpcs = { at: Date.now(), urls: new Map(list.filter((c) => c.publicRpcUrl?.startsWith('https://')).map((c) => [c.chainId, c.publicRpcUrl as string])) }
    }
  }
  return chainRpcs?.urls.get(chainId)
}

export async function clientFor(chainId: number): Promise<PublicClient> {
  if (chainId === config.chainId) return arcClient as PublicClient
  const cached = clients.get(chainId)
  if (cached) return cached
  const url = await acrossRpc(chainId)
  if (!url) throw new HttpError(422, 'chain_unavailable', `No RPC is available to verify chain ${chainId}.`)
  const created = createPublicClient({ transport: http(url, { retryCount: 1, timeout: 15_000 }) })
  clients.set(chainId, created)
  return created
}

function notFound(error: unknown): never {
  const name = (error as { name?: string })?.name ?? ''
  if (/NotFound/.test(name)) throw new HttpError(404, 'tx_not_found', 'That transaction was not found yet.')
  throw new HttpError(502, 'rpc_error', 'The network RPC did not answer. Try again in a moment.')
}

const parseHash = (value: unknown): Hex => {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new HttpError(400, 'bad_hash', 'Invalid transaction hash.')
  return value.toLowerCase() as Hex
}
const parseChain = (value: unknown, label: string): number => {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 53) throw new HttpError(400, 'bad_chain', `Invalid ${label}.`)
  return n
}
const optAddress = (value: unknown): string | null => (typeof value === 'string' && isAddress(value, { strict: false }) ? value.toLowerCase() : null)
const optDigits = (value: unknown): string | null => (typeof value === 'string' && /^\d{1,40}$/.test(value) ? value : null)

// ---- storage --------------------------------------------------------------------------------

type Row = Record<string, unknown>
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

function toDto(r: Row): ActivityDto {
  return {
    id: Number(r.id),
    kind: r.kind as ActivityDto['kind'],
    wallet: r.wallet as string,
    sourceChainId: Number(r.source_chain_id),
    destinationChainId: Number(r.destination_chain_id),
    sourceTxHash: r.source_tx_hash as string,
    destinationTxHash: (r.destination_tx_hash as string | null) ?? null,
    tokenIn: r.token_in as string,
    tokenOut: (r.token_out as string | null) ?? null,
    tokenInSymbol: (r.token_in_symbol as string | null) ?? null,
    tokenInDecimals: r.token_in_decimals === null || r.token_in_decimals === undefined ? null : Number(r.token_in_decimals),
    tokenOutSymbol: (r.token_out_symbol as string | null) ?? null,
    tokenOutDecimals: r.token_out_decimals === null || r.token_out_decimals === undefined ? null : Number(r.token_out_decimals),
    amountIn: String(r.amount_in),
    amountOut: r.amount_out === null || r.amount_out === undefined ? null : String(r.amount_out),
    expectedAmountOut: r.expected_amount_out === null || r.expected_amount_out === undefined ? null : String(r.expected_amount_out),
    feeAmount: r.fee_amount === null || r.fee_amount === undefined ? null : String(r.fee_amount),
    feeToken: (r.fee_token as string | null) ?? null,
    status: r.status as ActivityDto['status'],
    destinationVerified: Boolean(r.destination_verified),
    timestamp: iso(r.block_time) as string,
    updatedAt: iso(r.updated_at) as string,
  }
}

async function tokenMeta(token: string): Promise<{ symbol: string | null; decimals: number | null }> {
  try {
    const [symbol, decimals] = await Promise.all([
      rpc(() => arcClient.readContract({ address: token as Address, abi: erc20Abi, functionName: 'symbol' })),
      rpc(() => arcClient.readContract({ address: token as Address, abi: erc20Abi, functionName: 'decimals' })),
    ])
    return { symbol: String(symbol).slice(0, 16), decimals: Number(decimals) }
  } catch {
    return { symbol: null, decimals: null }
  }
}

const optSymbol = (value: unknown): string | null => (typeof value === 'string' && /^[A-Za-z0-9.$_-]{1,16}$/.test(value) ? value : null)
const optDecimals = (value: unknown): number | null => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 36 ? (value as number) : null)

// ---- swap -----------------------------------------------------------------------------------

export async function recordSwap(txHashInput: unknown): Promise<ActivityDto> {
  const db = requireDb()
  const hash = parseHash(txHashInput)
  const [receipt, tx] = await Promise.all([rpc(() => arcClient.getTransactionReceipt({ hash })), rpc(() => arcClient.getTransaction({ hash }))]).catch(notFound)
  if (receipt.status !== 'success') throw new HttpError(422, 'tx_failed', 'That transaction failed on-chain, so it is not recorded as a swap.')
  if (tx.to?.toLowerCase() !== UNISWAP_UNIVERSAL_ROUTER) throw new HttpError(422, 'not_a_swap', 'That transaction did not go through the Uniswap Universal Router.')
  const wallet = tx.from.toLowerCase()
  const legs = pickSwapLegs(netFlows(receipt.logs, wallet))
  if (!legs) throw new HttpError(422, 'no_swap_legs', 'No token swap could be read from that transaction.')
  const block = await rpc(() => arcClient.getBlock({ blockNumber: receipt.blockNumber }))
  const [metaIn, metaOut] = await Promise.all([tokenMeta(legs.tokenIn.token), tokenMeta(legs.tokenOut.token)])
  // Arc gas is paid in USDC; the native view has 18 decimals and the ERC-20 view 6.
  const feeNative = receipt.gasUsed * receipt.effectiveGasPrice
  const feeUsdc = feeNative / 10n ** 12n
  const rows = (await db`
    insert into defi_activity (kind, wallet, source_chain_id, destination_chain_id, source_tx_hash, destination_tx_hash, token_in, token_out,
      token_in_symbol, token_in_decimals, token_out_symbol, token_out_decimals,
      amount_in, amount_out, fee_amount, fee_token, status, destination_verified, block_time)
    values ('swap', ${wallet}, ${config.chainId}, ${config.chainId}, ${hash}, ${hash}, ${legs.tokenIn.token}, ${legs.tokenOut.token},
      ${metaIn.symbol}, ${metaIn.decimals}, ${metaOut.symbol}, ${metaOut.decimals},
      ${(-legs.tokenIn.net).toString()}, ${legs.tokenOut.net.toString()}, ${feeUsdc.toString()}, ${config.usdc}, 'confirmed', true, ${new Date(Number(block.timestamp) * 1000)})
    on conflict (source_chain_id, source_tx_hash) do update set updated_at = now()
    returning *`) as Row[]
  return toDto(rows[0])
}

// ---- bridge ---------------------------------------------------------------------------------

interface AcrossStatus {
  status?: string
  originChainId?: number
  destinationChainId?: number
  fillTxnRef?: string | null
  depositTxnRef?: string
}

async function acrossStatus(hash: string): Promise<AcrossStatus | null> {
  const res = await fetch(`${ACROSS}/deposit/status?depositTxnRef=${hash}`, {
    headers: config.acrossApiKey ? { authorization: `Bearer ${config.acrossApiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) throw new HttpError(502, 'across_unreachable', 'Across is not reachable right now.')
  if (res.status === 404) return null
  if (!res.ok) throw new HttpError(502, 'across_error', 'Across returned an error for this deposit.')
  return (await res.json()) as AcrossStatus
}

export interface BridgeInput {
  txHash?: unknown
  originChainId?: unknown
  inputToken?: unknown
  outputToken?: unknown
  wallet?: unknown
  recipient?: unknown
  expectedOutput?: unknown
  feeAmount?: unknown
  inputSymbol?: unknown
  inputDecimals?: unknown
  outputSymbol?: unknown
  outputDecimals?: unknown
}

/** Records a bridge only once Across itself knows the deposit and the source tx succeeded on its chain. */
export async function recordBridge(input: BridgeInput): Promise<{ recorded: false; reason: string } | { recorded: true; activity: ActivityDto }> {
  const db = requireDb()
  const hash = parseHash(input.txHash)
  const originChainId = parseChain(input.originChainId, 'origin chain')
  const origin = await clientFor(originChainId)
  const [receipt, tx] = await Promise.all([rpc(() => origin.getTransactionReceipt({ hash })), rpc(() => origin.getTransaction({ hash }))]).catch(notFound)
  if (receipt.status !== 'success') throw new HttpError(422, 'tx_failed', 'The source transaction failed on-chain, so no bridge is recorded.')
  const status = await acrossStatus(hash)
  if (!status || !status.status || Number(status.originChainId) !== originChainId || !status.destinationChainId) {
    return { recorded: false, reason: 'Across has not indexed this deposit yet.' }
  }
  // Smart-contract wallets send through a bundler, so the claimed wallet is accepted only if the receipt shows its funds leaving.
  const wallet = optAddress(input.wallet) ?? tx.from.toLowerCase()
  const inputToken = optAddress(input.inputToken)
  const flows = netFlows(receipt.logs, wallet)
  const spent = inputToken ? flows.find((f) => f.token === inputToken && f.net < 0n) : flows.filter((f) => f.net < 0n)[0]
  if (!spent) throw new HttpError(422, 'no_deposit_leg', 'The source transaction does not move the claimed input token out of the wallet.')
  const block = await rpc(() => origin.getBlock({ blockNumber: receipt.blockNumber }))
  const rows = (await db`
    insert into defi_activity (kind, wallet, source_chain_id, destination_chain_id, source_tx_hash, token_in, token_out, recipient,
      token_in_symbol, token_in_decimals, token_out_symbol, token_out_decimals,
      amount_in, expected_amount_out, fee_amount, fee_token, status, destination_verified, block_time)
    values ('bridge', ${wallet}, ${originChainId}, ${Number(status.destinationChainId)}, ${hash}, ${spent.token}, ${optAddress(input.outputToken)}, ${optAddress(input.recipient)},
      ${optSymbol(input.inputSymbol)}, ${optDecimals(input.inputDecimals)}, ${optSymbol(input.outputSymbol)}, ${optDecimals(input.outputDecimals)},
      ${(-spent.net).toString()}, ${optDigits(input.expectedOutput)}, ${optDigits(input.feeAmount)}, ${spent.token}, 'pending', false, ${new Date(Number(block.timestamp) * 1000)})
    on conflict (source_chain_id, source_tx_hash) do update set updated_at = now()
    returning *`) as Row[]
  return { recorded: true, activity: await refreshBridgeRow(rows[0]) }
}

/** Re-reads Across status and, on a fill, the destination transaction. Complete means verified there. */
async function refreshBridgeRow(row: Row): Promise<ActivityDto> {
  const db = requireDb()
  if (row.status === 'filled' && row.destination_verified) return toDto(row)
  if (['expired', 'refunded'].includes(row.status as string)) return toDto(row)
  const status = await acrossStatus(row.source_tx_hash as string)
  if (!status?.status) return toDto(row)
  let next = row
  if (status.status === 'filled' && status.fillTxnRef && hashPattern.test(status.fillTxnRef)) {
    const destChain = Number(row.destination_chain_id)
    let verified = false
    let amountOut: bigint | null = null
    try {
      const dest = await clientFor(destChain)
      const fill = await rpc(() => dest.getTransactionReceipt({ hash: status.fillTxnRef as Hex }))
      verified = fill.status === 'success'
      const recipient = (row.recipient as string | null) ?? (row.wallet as string)
      const out = row.token_out as string | null
      const leg = netFlows(fill.logs, recipient).find((f) => f.net > 0n && (!out || f.token === out))
      amountOut = verified && leg ? leg.net : null
    } catch {
      verified = false
    }
    const updated = (await db`
      update defi_activity set status = 'filled', destination_tx_hash = ${status.fillTxnRef.toLowerCase()}, destination_verified = ${verified},
        amount_out = ${amountOut === null ? null : amountOut.toString()}, updated_at = now()
      where id = ${row.id as number} returning *`) as Row[]
    next = updated[0]
  } else if (status.status === 'expired' || status.status === 'refunded') {
    const updated = (await db`update defi_activity set status = ${status.status}, updated_at = now() where id = ${row.id as number} returning *`) as Row[]
    next = updated[0]
  }
  return toDto(next)
}

export async function refreshBridge(txHashInput: unknown, originChainInput: unknown): Promise<ActivityDto | null> {
  const db = requireDb()
  const hash = parseHash(txHashInput)
  const originChainId = parseChain(originChainInput, 'origin chain')
  const rows = (await db`select * from defi_activity where kind = 'bridge' and source_chain_id = ${originChainId} and source_tx_hash = ${hash}`) as Row[]
  return rows[0] ? refreshBridgeRow(rows[0]) : null
}

export async function listActivity(wallet: string, limit = 100): Promise<ActivityDto[]> {
  const db = requireDb()
  const rows = (await db`select * from defi_activity where wallet = ${wallet} order by block_time desc, id desc limit ${limit}`) as Row[]
  return rows.map(toDto)
}
