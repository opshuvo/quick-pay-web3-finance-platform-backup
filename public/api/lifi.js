// arc-studio-allow-onchain-literal
/**
 * Quick Pay LI.FI proxy (Vercel serverless function, reached as /api/lifi/<endpoint> through a rewrite in vercel.json).
 *
 * It is the same allow-listed proxy as server/lifi.ts, for hosts that have no Quick Pay backend: only chains, routes,
 * quote and status are forwarded, every parameter is validated, and the optional LIFI_API_KEY stays here, never in the
 * browser. Nothing is invented: answers are LI.FI's own, and `routes` only lists tokens LI.FI says it can move between
 * the two chains. The function runs outside the app bundle, so it cannot import server/lifi.ts; keep the two in step.
 */
const BASE = 'https://li.quest/v1'
const INTEGRATOR = (process.env.LIFI_INTEGRATOR || '').trim() || 'quickpay'
const API_KEY = (process.env.LIFI_API_KEY || '').trim() || undefined
/** Quick Pay is a USDC app: routes are offered only for these well-known assets. */
const OFFERED = new Set(['USDC', 'EURC', 'USDT', 'WETH', 'WBTC', 'CIRBTC'])
const ZERO = '0x0000000000000000000000000000000000000000'

const ALLOWED = {
  chains: {},
  routes: { fromChain: 'int', toChain: 'int' },
  quote: { fromChain: 'int', toChain: 'int', fromToken: 'address', toToken: 'address', fromAmount: 'digits', fromAddress: 'address', toAddress: 'address', slippage: 'slippage' },
  status: { txHash: 'hash', fromChain: 'int', toChain: 'int' },
}

const VALID = {
  int: (v) => /^\d{1,20}$/.test(v),
  digits: (v) => /^\d{1,40}$/.test(v),
  address: (v) => /^0x[0-9a-fA-F]{40}$/.test(v),
  hash: (v) => /^0x[0-9a-fA-F]{64}$/.test(v),
  slippage: (v) => /^0(\.\d{1,4})?$/.test(v) && Number(v) <= 0.03,
}

class Fail extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function lifiGet(path, params, timeoutMs = 20_000) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`
  let upstream
  try {
    upstream = await fetch(url, { headers: API_KEY ? { 'x-lifi-api-key': API_KEY } : {}, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new Fail(502, 'lifi_unreachable', 'LI.FI is not reachable right now.')
  }
  let body
  try {
    body = JSON.parse(await upstream.text())
  } catch {
    throw new Fail(502, 'lifi_bad_response', 'LI.FI returned an unexpected response.')
  }
  return { status: upstream.status, body }
}

async function routes(from, to) {
  const [tokens, connections] = await Promise.all([lifiGet('/tokens', { chains: `${from},${to}` }, 8_000), lifiGet('/connections', { fromChain: from, toChain: to }, 8_000)])
  if (tokens.status !== 200 || connections.status !== 200) throw new Fail(502, 'lifi_upstream', 'LI.FI could not list routes right now.')
  const byChain = (tokens.body && tokens.body.tokens) || {}
  const meta = (chain) => new Map((byChain[chain] || []).map((t) => [t.address.toLowerCase(), t]))
  const fromMeta = meta(from)
  const toMeta = meta(to)
  const fromSet = new Set()
  const toSet = new Set()
  for (const c of (connections.body && connections.body.connections) || []) {
    for (const t of c.fromTokens || []) fromSet.add(t.address.toLowerCase())
    for (const t of c.toTokens || []) toSet.add(t.address.toLowerCase())
  }
  const toBySymbol = new Map()
  for (const a of toSet) {
    const t = toMeta.get(a)
    if (t && a !== ZERO && !toBySymbol.has(t.symbol.toUpperCase())) toBySymbol.set(t.symbol.toUpperCase(), t)
  }
  const out = []
  for (const a of fromSet) {
    const f = fromMeta.get(a)
    if (!f || a === ZERO || !OFFERED.has(f.symbol.toUpperCase())) continue
    const t = toBySymbol.get(f.symbol.toUpperCase())
    if (!t) continue
    out.push({ originChainId: Number(from), originToken: f.address, destinationChainId: Number(to), destinationToken: t.address, originTokenSymbol: f.symbol, destinationTokenSymbol: t.symbol, isNative: false })
  }
  const rank = (s) => (s === 'USDC' ? 0 : s === 'EURC' ? 1 : 2)
  out.sort((x, y) => rank(x.originTokenSymbol) - rank(y.originTokenSymbol) || x.originTokenSymbol.localeCompare(y.originTokenSymbol))
  return out.slice(0, 12)
}

/** The endpoint name and its query, whether Vercel passes the rewritten `path` or only the original URL. */
function parseRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  let endpoint = url.searchParams.get('path')
  if (endpoint === null) endpoint = url.pathname.replace(/^\/api\/lifi\/?/, '')
  const params = new URLSearchParams()
  for (const [k, v] of url.searchParams) if (k !== 'path') params.set(k, v)
  return { endpoint: endpoint.replace(/^\/+|\/+$/g, ''), params }
}

function send(res, status, body, cache) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', cache || 'no-store')
  res.end(JSON.stringify(body))
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') throw new Fail(405, 'method_not_allowed', 'Only GET is supported.')
    const { endpoint, params } = parseRequest(req)
    const rules = ALLOWED[endpoint]
    if (!rules) throw new Fail(404, 'not_found', 'Unknown LI.FI endpoint.')
    const clean = {}
    for (const [key, value] of params) {
      const kind = rules[key]
      if (!kind || !VALID[kind](value)) throw new Fail(400, 'bad_param', `Invalid parameter: ${key}`)
      clean[key] = value
    }
    if (endpoint === 'chains') {
      const r = await lifiGet('/chains', { chainTypes: 'EVM' })
      return send(res, r.status, r.body, r.status === 200 ? 'public, s-maxage=300, stale-while-revalidate=600' : undefined)
    }
    if (endpoint === 'routes') {
      if (!clean.fromChain || !clean.toChain) throw new Fail(400, 'bad_param', 'fromChain and toChain are required.')
      return send(res, 200, await routes(clean.fromChain, clean.toChain), 'public, s-maxage=300, stale-while-revalidate=600')
    }
    if (endpoint === 'quote') {
      const r = await lifiGet('/quote', { ...clean, integrator: INTEGRATOR })
      return send(res, r.status, r.body)
    }
    const r = await lifiGet('/status', clean)
    return send(res, r.status, r.body)
  } catch (error) {
    if (error instanceof Fail) return send(res, error.status, { error: error.code, message: error.message })
    return send(res, 500, { error: 'internal', message: 'Unexpected error.' })
  }
}
