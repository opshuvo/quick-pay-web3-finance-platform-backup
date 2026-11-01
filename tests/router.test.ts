import { describe, expect, test } from 'bun:test'
import { verifyRouter } from '../src/hooks/useRouter'
import { ARC_USDC } from '../src/lib/arc'

const ROUTER = '0x1593C6fdEAB15228c90da354913a919fDA08b7E4'
const client = (o: { code?: string; usdc?: string; paused?: boolean; fail?: boolean }) =>
  ({
    getCode: async () => { if (o.fail) throw new Error('HTTP request failed'); return o.code ?? '0x6080' },
    readContract: async ({ functionName }: { functionName: string }) => (functionName === 'usdc' ? o.usdc ?? ARC_USDC : o.paused ?? false),
  }) as never

describe('verifyRouter: when payments go through the owner contract', () => {
  test('a deployed, unpaused router that uses the official USDC is used', async () => {
    expect(await verifyRouter(client({}), ROUTER)).toEqual({ ok: true, address: ROUTER })
  })
  test('a paused router is not used, and the reason is reported', async () => {
    expect(await verifyRouter(client({ paused: true }), ROUTER)).toEqual({ ok: false, problem: 'paused' })
  })
  test('a router for another token or with no code is not used', async () => {
    expect(await verifyRouter(client({ usdc: '0x' + '11'.repeat(20) }), ROUTER)).toEqual({ ok: false, problem: 'wrong-usdc' })
    expect(await verifyRouter(client({ code: '0x' }), ROUTER)).toEqual({ ok: false, problem: 'no-contract' })
  })
  test('when Arc cannot be read it throws, so the app holds the payment instead of sending it direct', async () => {
    await expect(verifyRouter(client({ fail: true }), ROUTER)).rejects.toThrow()
  })
})
