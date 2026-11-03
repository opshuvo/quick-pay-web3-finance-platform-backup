import { afterEach, describe, expect, test } from 'bun:test'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import handler from '../public/api/lifi.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function call(url: string, method = 'GET') {
  return new Promise<{ status: number; body: unknown; cache: string | undefined }>((resolve) => {
    const headers: Record<string, string> = {}
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => { headers[k] = v },
      end: (text: string) => resolve({ status: res.statusCode, body: JSON.parse(text), cache: headers['cache-control'] }),
    }
    void handler({ url, method }, res)
  })
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const A = '0x3600000000000000000000000000000000000000'
const B = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

describe('LI.FI serverless proxy', () => {
  test('only allow-listed endpoints and parameters are forwarded', async () => {
    let called = 0
    globalThis.fetch = (async () => { called++; return json({}) }) as typeof fetch
    expect((await call('/api/lifi?path=admin')).status).toBe(404)
    expect((await call('/api/lifi?path=quote&evil=1')).status).toBe(400)
    expect((await call('/api/lifi?path=quote&fromChain=abc')).status).toBe(400)
    expect((await call('/api/lifi?path=chains', 'POST')).status).toBe(405)
    expect(called).toBe(0)
  })
  test('works whether Vercel keeps the original path or passes the rewritten one', async () => {
    const seen: string[] = []
    globalThis.fetch = (async (u: string) => { seen.push(u); return json({ chains: [] }) }) as typeof fetch
    expect((await call('/api/lifi/chains')).status).toBe(200)
    expect((await call('/api/lifi?path=chains')).status).toBe(200)
    expect(seen.every((u) => u.startsWith('https://li.quest/v1/chains?chainTypes=EVM'))).toBe(true)
  })
  test('quotes carry our integrator tag and are never cached', async () => {
    let url = ''
    globalThis.fetch = (async (u: string) => { url = u; return json({ id: 'q' }) }) as typeof fetch
    const r = await call(`/api/lifi?path=quote&fromChain=5042&toChain=8453&fromToken=${A}&toToken=${B}&fromAmount=1000000&fromAddress=${A}&toAddress=${A}`)
    expect(r.status).toBe(200)
    expect(url).toContain('integrator=quickpay')
    expect(r.cache).toBe('no-store')
  })
  test('routes pair same-symbol offered tokens from LI.FI\'s own lists', async () => {
    globalThis.fetch = (async (u: string) => {
      if (u.includes('/tokens')) return json({ tokens: { 5042: [{ address: A, symbol: 'USDC', decimals: 6 }, { address: '0x1111111111111111111111111111111111111111', symbol: 'JUNK', decimals: 18 }], 8453: [{ address: B, symbol: 'USDC', decimals: 6 }] } })
      return json({ connections: [{ fromTokens: [{ address: A }, { address: '0x1111111111111111111111111111111111111111' }], toTokens: [{ address: B }] }] })
    }) as typeof fetch
    const r = await call('/api/lifi?path=routes&fromChain=5042&toChain=8453')
    expect(r.body).toEqual([{ originChainId: 5042, originToken: A, destinationChainId: 8453, destinationToken: B, originTokenSymbol: 'USDC', destinationTokenSymbol: 'USDC', isNative: false }])
  })
  test('an unreachable LI.FI is a clean 502, not a crash', async () => {
    globalThis.fetch = (async () => { throw new Error('down') }) as typeof fetch
    expect((await call('/api/lifi?path=chains')).status).toBe(502)
  })
})
