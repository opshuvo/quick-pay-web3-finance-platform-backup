/**
 * Thin allow-listed proxy to the Across API. It keeps any API key / integrator ID on the server
 * and gives the browser a same-origin endpoint. Responses are passed through unchanged.
 */
import { isAddress } from 'viem'
import { HttpError } from './db'
import { config } from './env'
import { json } from './http'

const BASE = 'https://app.across.to/api'
const CACHEABLE = new Set(['/swap/chains', '/available-routes'])
const cache = new Map<string, { at: number; body: string; status: number }>()

const ALLOWED: Record<string, Record<string, 'int' | 'address' | 'digits' | 'enum' | 'hash'>> = {
  '/swap/chains': {},
  '/available-routes': { originChainId: 'int', destinationChainId: 'int', originToken: 'address', destinationToken: 'address' },
  '/swap/approval': {
    tradeType: 'enum', amount: 'digits', inputToken: 'address', outputToken: 'address', originChainId: 'int', destinationChainId: 'int',
    depositor: 'address', recipient: 'address', slippage: 'enum', refundAddress: 'address',
  },
  '/deposit/status': { depositTxnRef: 'hash', originChainId: 'int' },
}

function validate(kind: 'int' | 'address' | 'digits' | 'enum' | 'hash', value: string): boolean {
  switch (kind) {
    case 'int': return /^\d{1,20}$/.test(value)
    case 'digits': return /^\d{1,40}$/.test(value)
    case 'address': return isAddress(value, { strict: false })
    case 'hash': return /^0x[0-9a-fA-F]{64}$/.test(value)
    case 'enum': return /^[A-Za-z0-9.]{1,20}$/.test(value)
  }
}

export async function proxyAcross(path: string, search: URLSearchParams): Promise<Response> {
  const rules = ALLOWED[path]
  if (!rules) throw new HttpError(404, 'not_found', 'Unknown Across endpoint.')
  const out = new URLSearchParams()
  for (const [key, value] of search) {
    const kind = rules[key]
    if (!kind || !validate(kind, value)) throw new HttpError(400, 'bad_param', `Invalid parameter: ${key}`)
    out.set(key, value)
  }
  if (config.acrossIntegratorId && path === '/swap/approval') out.set('integratorId', config.acrossIntegratorId)
  const url = `${BASE}${path}?${out}`
  const cached = CACHEABLE.has(path) ? cache.get(url) : undefined
  if (cached && Date.now() - cached.at < 60_000) return json(JSON.parse(cached.body), cached.status)

  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: config.acrossApiKey ? { authorization: `Bearer ${config.acrossApiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new HttpError(502, 'across_unreachable', 'Across is not reachable right now.')
  }
  const text = await upstream.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new HttpError(502, 'across_bad_response', 'Across returned an unexpected response.')
  }
  if (CACHEABLE.has(path) && upstream.ok) cache.set(url, { at: Date.now(), body: text, status: upstream.status })
  return json(body, upstream.status)
}
