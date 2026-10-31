import { describe, expect, test } from 'bun:test'
import { checkUniswapDeployment, summarizeDeployment, UNISWAP_CONTRACTS } from '../src/lib/uniswap/arc'

const CODE = '0x6080604052'
const clientWith = (answer: (address: string) => Promise<string | undefined>) => ({ getCode: ({ address }: { address: string }) => answer(address) }) as never

describe('checkUniswapDeployment (fail closed, honest about why)', () => {
  test('every contract with code is verified', async () => {
    const checks = await checkUniswapDeployment(clientWith(async () => CODE))
    expect(checks).toHaveLength(UNISWAP_CONTRACTS.length)
    expect(checks.every((c) => c.status === 'ok' && c.ok)).toBe(true)
    expect(summarizeDeployment(checks, false)).toBe('verified')
  })
  test('an RPC answer of no code is "missing", and swapping is not verified', async () => {
    const target = UNISWAP_CONTRACTS[3].address.toLowerCase()
    const checks = await checkUniswapDeployment(clientWith(async (a) => (a.toLowerCase() === target ? '0x' : CODE)))
    expect(checks.filter((c) => c.status === 'missing').map((c) => c.name)).toEqual([UNISWAP_CONTRACTS[3].name])
    expect(summarizeDeployment(checks, false)).toBe('missing')
    expect((await checkUniswapDeployment(clientWith(async () => undefined))).every((c) => c.status === 'missing')).toBe(true)
  })
  test('rate limits, timeouts and network failures are "error", never reported as a missing contract', async () => {
    const failing = UNISWAP_CONTRACTS[0].address.toLowerCase()
    const checks = await checkUniswapDeployment(clientWith(async (a) => { if (a.toLowerCase() === failing) throw new Error('rate limit exceeded'); return CODE }))
    expect(checks[0]).toMatchObject({ status: 'error', ok: false })
    expect(checks.slice(1).every((c) => c.status === 'ok')).toBe(true)
    expect(summarizeDeployment(checks, false)).toBe('unreachable')
  })
  test('one failed request does not hide the others, and a total failure is unreachable', async () => {
    const checks = await checkUniswapDeployment(clientWith(async () => { throw new Error('HTTP request failed') }))
    expect(checks.every((c) => c.status === 'error')).toBe(true)
    expect(summarizeDeployment(checks, false)).toBe('unreachable')
    expect(summarizeDeployment(undefined, true)).toBe('unreachable')
    expect(summarizeDeployment(undefined, false)).toBe('checking')
  })
  test('a genuinely missing contract wins over an unreachable one', async () => {
    const [a, b] = [UNISWAP_CONTRACTS[0].address.toLowerCase(), UNISWAP_CONTRACTS[1].address.toLowerCase()]
    const checks = await checkUniswapDeployment(clientWith(async (x) => { if (x.toLowerCase() === a) throw new Error('timeout'); return x.toLowerCase() === b ? '0x' : CODE }))
    expect(summarizeDeployment(checks, false)).toBe('missing')
  })
  test('the configured set includes the router, Permit2, factory, both quoters and the v4 state view', () => {
    expect(UNISWAP_CONTRACTS.map((c) => c.name)).toEqual(['Universal Router 2.1.2', 'Permit2', 'v3 Factory', 'v3 Quoter', 'v4 Quoter', 'v4 StateView'])
    expect(new Set(UNISWAP_CONTRACTS.map((c) => c.address.toLowerCase())).size).toBe(UNISWAP_CONTRACTS.length)
  })
})
