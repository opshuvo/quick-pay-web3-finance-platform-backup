/** Runs under the DOM preload (see test:render): the app's wagmi config imports browser-only code. */
import { afterEach, describe, expect, test } from 'bun:test'
import { getPublicClient } from '@wagmi/core'
import { erc20Abi } from 'viem'
import { config } from '../src/config'
import { ARC_USDC } from '../src/lib/arc'
import { checkUniswapDeployment, UNISWAP_CONTRACTS } from '../src/lib/uniswap/arc'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Rpc { id: number; method: string; params: unknown[] }
let httpCalls = 0
let rateLimitFirstAttemptOfEveryThird = false
const seen = new Set<number>()

function install() {
  httpCalls = 0
  seen.clear()
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    httpCalls += 1
    const body = JSON.parse(String(init?.body)) as Rpc | Rpc[]
    const answer = (r: Rpc) => {
      if (rateLimitFirstAttemptOfEveryThird && r.id % 3 === 0 && !seen.has(r.id)) { seen.add(r.id); return { jsonrpc: '2.0', id: r.id, error: { code: -32005, message: 'rate limit exceeded' } } }
      if (r.method === 'eth_chainId') return { jsonrpc: '2.0', id: r.id, result: '0x13b2' }
      if (r.method === 'eth_getCode') return { jsonrpc: '2.0', id: r.id, result: '0x6080' }
      return { jsonrpc: '2.0', id: r.id, result: '0x' + '0'.repeat(63) + '6' } // eth_call: uint256 6
    }
    const out = Array.isArray(body) ? body.map(answer) : answer(body)
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('Arc transport', () => {
  test('a page-load burst of reads goes out as a handful of batched HTTP requests, not one per read', async () => {
    install()
    const client = getPublicClient(config, { chainId: 5042 })!
    const checks = await Promise.all([
      checkUniswapDeployment(client),
      ...Array.from({ length: 20 }, () => client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'decimals' })),
    ])
    expect(checks[0].every((c) => c.ok)).toBe(true)
    expect(UNISWAP_CONTRACTS.length + 20).toBe(26)
    expect(httpCalls).toBeLessThanOrEqual(3)
  })
  test('items the provider rate-limits inside a batch are retried and still succeed', async () => {
    install()
    rateLimitFirstAttemptOfEveryThird = true
    try {
      const client = getPublicClient(config, { chainId: 5042 })!
      const checks = await checkUniswapDeployment(client)
      expect(checks.every((c) => c.status === 'ok')).toBe(true)
    } finally {
      rateLimitFirstAttemptOfEveryThird = false
    }
  })
})
