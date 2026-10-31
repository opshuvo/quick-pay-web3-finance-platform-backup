/**
 * Wallet sign-in shared by the browser and the server.
 * The message is rebuilt byte-for-byte on the server and verified with the
 * signer's address, so the token cannot be forged or re-targeted.
 */
export interface SessionPayload {
  address: string
  chainId: number
  issuedAt: string
  expiresAt: string
  nonce: string
}

export interface SessionToken extends SessionPayload {
  signature: string
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function buildSessionMessage(p: SessionPayload): string {
  return [
    'Quick Pay sign-in',
    '',
    'This signature proves you control this wallet. It does not send a transaction, cost gas, or move funds.',
    '',
    `Address: ${p.address.toLowerCase()}`,
    `Chain ID: ${p.chainId}`,
    `Issued At: ${p.issuedAt}`,
    `Expires At: ${p.expiresAt}`,
    `Nonce: ${p.nonce}`,
  ].join('\n')
}

export const REQUEST_LIMITS = {
  descriptionMax: 140,
  maxAmountRaw: 1_000_000_000_000n, // 1,000,000 USDC in 6-decimal units
} as const

export type RequestStatus = 'unpaid' | 'paid' | 'expired' | 'cancelled'
