import { isAddress, verifyMessage } from 'viem'
import { buildSessionMessage, SESSION_TTL_MS, type SessionToken } from '../shared/session'
import { HttpError } from './db'
import { config } from './env'

const verified = new Map<string, number>()

/**
 * Verifies the `Authorization: QuickPay <base64 json>` wallet signature and returns the signer.
 * Signatures are checked for EOAs (ecrecover); smart-contract wallets are not supported yet.
 */
export async function requireWallet(req: Request): Promise<string> {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('QuickPay ')) throw new HttpError(401, 'unauthorized', 'Sign in with your wallet to continue.')
  let token: SessionToken
  try {
    token = JSON.parse(atob(header.slice('QuickPay '.length))) as SessionToken
  } catch {
    throw new HttpError(401, 'unauthorized', 'Invalid session.')
  }
  const { address, chainId, issuedAt, expiresAt, nonce, signature } = token
  const issued = Date.parse(issuedAt)
  const expires = Date.parse(expiresAt)
  const now = Date.now()
  if (
    typeof address !== 'string' || !isAddress(address, { strict: false }) ||
    chainId !== config.chainId ||
    !Number.isFinite(issued) || !Number.isFinite(expires) ||
    issued > now + 60_000 || expires < now || expires - issued > SESSION_TTL_MS + 60_000 ||
    typeof nonce !== 'string' || !/^[0-9a-f]{16,64}$/i.test(nonce) ||
    typeof signature !== 'string' || !/^0x[0-9a-f]+$/i.test(signature)
  ) {
    throw new HttpError(401, 'session_expired', 'Your session expired. Sign in again.')
  }
  const cacheKey = `${address.toLowerCase()}:${signature}`
  if ((verified.get(cacheKey) ?? 0) > now) return address.toLowerCase()
  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message: buildSessionMessage({ address, chainId, issuedAt, expiresAt, nonce }),
    signature: signature as `0x${string}`,
  }).catch(() => false)
  if (!ok) throw new HttpError(401, 'unauthorized', 'Signature could not be verified.')
  verified.set(cacheKey, Math.min(expires, now + 10 * 60_000))
  if (verified.size > 5000) verified.clear()
  return address.toLowerCase()
}
