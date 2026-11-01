import { useCallback } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { buildSessionMessage, SESSION_TTL_MS, type SessionToken } from '../../shared/session'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { parseTxError } from '@/lib/errors'

const KEY = 'quickpay.session'

function load(address: string): SessionToken | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const token = JSON.parse(raw) as SessionToken
    if (token.address.toLowerCase() !== address.toLowerCase()) return null
    if (new Date(token.expiresAt).getTime() < Date.now() + 60_000) return null
    return token
  } catch {
    return null
  }
}

export const clearSession = () => sessionStorage.removeItem(KEY)
export const loadSession = load

/**
 * Wallet-signature sign-in for the Quick Pay backend (payment requests).
 * The signature is free, sends no transaction, and is kept for this browser tab only.
 */
export function useSession() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const ensureSession = useCallback(async (): Promise<SessionToken | null> => {
    if (!address) return null
    const existing = load(address)
    if (existing) return existing
    const now = Date.now()
    const payload = {
      address: address.toLowerCase(),
      chainId: ARC_CHAIN_ID,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      nonce: crypto.randomUUID().replace(/-/g, ''),
    }
    try {
      const signature = await signMessageAsync({ message: buildSessionMessage(payload) })
      const token: SessionToken = { ...payload, signature }
      sessionStorage.setItem(KEY, JSON.stringify(token))
      return token
    } catch (error) {
      const parsed = parseTxError(error)
      toast.error(parsed.kind === 'rejected' ? 'Sign-in cancelled.' : 'Could not sign in with your wallet.')
      return null
    }
  }, [address, signMessageAsync])

  return { ensureSession, hasSession: Boolean(address && load(address)) }
}
