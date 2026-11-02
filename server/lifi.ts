/**
 * Thin allow-listed proxy to the LI.FI API. Any API key stays on the server and the browser gets a same-origin
 * endpoint. Quotes, chains and status pass through unchanged; `/routes` is the one derived answer: the ERC-20
 * tokens LI.FI can really move between two chains, paired by symbol (for example USDC to USDC).
 */
import { isAddress } from 'viem'
import { HttpError } from './db'
import { json } from './http'

const BASE = 'https://li.quest/v1'
const INTEGRATOR = process.env.LIFI_INTEGRATOR?.trim() || 'quickpay'
const API_KEY = process.env.LIFI_API_KEY?.trim() || undefined
/** Quick Pay is a USDC app: it offers LI.FI routes only for these well-known assets, not for every vault token LI.FI lists. */
const OFFERED = new Set(['USDC', 'EURC', 'USDT', 'WETH', 'WBTC', 'CIRBTC'])
const ZERO = '0x0000000000000000000000000000000000000000'

type Kind = 'int' | 'address' | 'digits' | 'slippage' | 'hash'
const ALLOWED: Record<string, Record<string, Kind>> = {
  '/chains': {},
  '/routes': { fromChain: 'int', toChain: 'int' },
  '/quote': { fromChain: 'int', toChain: 'int', fromToken: 'address', toToken: 'address', fromAmount: 'digits', fromAddress: 'address', toAddress: 'address', slippage: 'slippage' },
  '/status': { txHash: 'hash', fromChain: 'int', toChain: 'int' },
}

function validate(kind: Kind, value: string): boolean {
  switch (kind) {
    case 'int': return /^\d{1,20}$/.test(value)
    case 'digits': return /^\d{1,40}$/.test(value)
    case 'address': return isAddress(value, { strict: false })
    case 'hash': return /^0x[0-9a-fA-F]{64}$/.test(value)
    case 'slippage': return /^0(\.\d{1,4})?$/.test(value) && Number(value) <= 0.03
  }
}

const cache = new Map<string, { at: number; body: unknown }>()
async function lifiGet(path: string, params: Record<string, string>, ttlMs = 0, timeoutMs = 20_000): Promise<{ status: number; body: unknown }> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`
  const hit = ttlMs ? cache.get(url) : undefined
  if (hit && Date.now() - hit.at < ttlMs) return { status: 200, body: hit.body }
  let upstream: Response
  try {
    upstream = await fetch(url, { headers: API_KEY ? { 'x-lifi-api-key': API_KEY } : {}, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new HttpError(502, 'lifi_unreachable', 'LI.FI is not reachable right now.')
  }
  const text = await upstream.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new HttpError(502, 'lifi_bad_response', 'LI.FI returned an unexpected response.')
  }
  if (ttlMs && upstream.ok) cache.set(url, { at: Date.now(), body })
  return { status: upstream.status, body }
}

interface LifiToken { address: string; symbol: string; decimals: number }
interface Connection { fromTokens?: { address: string }[]; toTokens?: { address: string }[] }

async function routes(from: string, to: string): Promise<Response> {
  const [tokens, connections] = await Promise.all([
    lifiGet('/tokens', { chains: `${from},${to}` }, 10 * 60_000, 30_000),
    lifiGet('/connections', { fromChain: from, toChain: to }, 5 * 60_000),
  ])
  if (tokens.status !== 200 || connections.status !== 200) return json({ error: 'lifi_upstream', message: 'LI.FI could not list routes right now.' }, 502)
  const byChain = (tokens.body as { tokens?: Record<string, LifiToken[]> }).tokens ?? {}
  const meta = (chain: string) => new Map((byChain[chain] ?? []).map((t) => [t.address.toLowerCase(), t]))
  const fromMeta = meta(from)
  const toMeta = meta(to)
  const fromSet = new Set<string>()
  const toSet = new Set<string>()
  for (const c of ((connections.body as { connections?: Connection[] }).connections ?? [])) {
    for (const t of c.fromTokens ?? []) fromSet.add(t.address.toLowerCase())
    for (const t of c.toTokens ?? []) toSet.add(t.address.toLowerCase())
  }
  const toBySymbol = new Map<string, LifiToken>()
  for (const a of toSet) {
    const t = toMeta.get(a)
    if (t && a !== ZERO && !toBySymbol.has(t.symbol.toUpperCase())) toBySymbol.set(t.symbol.toUpperCase(), t)
  }
  const out: { originChainId: number; originToken: string; destinationChainId: number; destinationToken: string; originTokenSymbol: string; destinationTokenSymbol: string; isNative: boolean }[] = []
  for (const a of fromSet) {
    const f = fromMeta.get(a)
    if (!f || a === ZERO || !OFFERED.has(f.symbol.toUpperCase())) continue
    const t = toBySymbol.get(f.symbol.toUpperCase())
    if (!t) continue
    out.push({ originChainId: Number(from), originToken: f.address, destinationChainId: Number(to), destinationToken: t.address, originTokenSymbol: f.symbol, destinationTokenSymbol: t.symbol, isNative: false })
  }
  const rank = (s: string) => (s === 'USDC' ? 0 : s === 'EURC' ? 1 : 2)
  out.sort((x, y) => rank(x.originTokenSymbol) - rank(y.originTokenSymbol) || x.originTokenSymbol.localeCompare(y.originTokenSymbol))
  return json(out.slice(0, 12))
}

export async function proxyLifi(path: string, search: URLSearchParams): Promise<Response> {
  const rules = ALLOWED[path]
  if (!rules) throw new HttpError(404, 'not_found', 'Unknown LI.FI endpoint.')
  const params: Record<string, string> = {}
  for (const [key, value] of search) {
    const kind = rules[key]
    if (!kind || !validate(kind, value)) throw new HttpError(400, 'bad_param', `Invalid parameter: ${key}`)
    params[key] = value
  }
  if (path === '/chains') {
    const r = await lifiGet('/chains', { chainTypes: 'EVM' }, 5 * 60_000)
    return json(r.body, r.status)
  }
  if (path === '/routes') {
    if (!params.fromChain || !params.toChain) throw new HttpError(400, 'bad_param', 'fromChain and toChain are required.')
    return routes(params.fromChain, params.toChain)
  }
  if (path === '/quote') {
    // A bridge only: the integrator tag is ours, and the swap-heavy defaults are left to LI.FI's own recommendation.
    const r = await lifiGet('/quote', { ...params, integrator: INTEGRATOR })
    return json(r.body, r.status)
  }
  const r = await lifiGet('/status', params)
  return json(r.body, r.status)
}
