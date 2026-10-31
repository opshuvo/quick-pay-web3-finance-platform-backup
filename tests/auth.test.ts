import { describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { buildSessionMessage, SESSION_TTL_MS, type SessionPayload } from '../shared/session'
import { requireWallet } from '../server/auth'

const account = privateKeyToAccount(generatePrivateKey())

async function token(overrides: Partial<SessionPayload> = {}, signer = account) {
  const now = Date.now()
  const payload: SessionPayload = {
    address: account.address.toLowerCase(),
    chainId: 5042,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    nonce: 'a'.repeat(32),
    ...overrides,
  }
  const signature = await signer.signMessage({ message: buildSessionMessage(payload) })
  return btoa(JSON.stringify({ ...payload, signature }))
}
const req = (value?: string) => new Request('http://x/requests', { headers: value ? { authorization: `QuickPay ${value}` } : {} })

describe('requireWallet', () => {
  test('accepts a valid wallet signature', async () => {
    expect(await requireWallet(req(await token()))).toBe(account.address.toLowerCase())
  })
  test('rejects a missing header', async () => {
    await expect(requireWallet(req())).rejects.toMatchObject({ status: 401 })
  })
  test('rejects a signature from a different wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    await expect(requireWallet(req(await token({}, other)))).rejects.toMatchObject({ status: 401 })
  })
  test('rejects an expired session and a wrong chain', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    await expect(requireWallet(req(await token({ expiresAt: past })))).rejects.toMatchObject({ status: 401 })
    await expect(requireWallet(req(await token({ chainId: 1 })))).rejects.toMatchObject({ status: 401 })
  })
  test('rejects a tampered payload', async () => {
    const good = JSON.parse(atob(await token())) as Record<string, string>
    good.expiresAt = new Date(Date.now() + SESSION_TTL_MS - 5000).toISOString()
    await expect(requireWallet(req(btoa(JSON.stringify(good))))).rejects.toMatchObject({ status: 401 })
  })
})
