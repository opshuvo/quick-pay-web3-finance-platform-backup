export type TxErrorKind = 'rejected' | 'funds' | 'reverted' | 'network' | 'unknown'

export interface ParsedError {
  kind: TxErrorKind
  message: string
}

/** Turns a wallet/RPC error into a safe, user-facing message. Raw errors never reach the UI. */
export function parseTxError(error: unknown): ParsedError {
  const e = error as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } } | null
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  if (e?.code === 4001 || e?.cause?.code === 4001 || text.includes('user rejected') || text.includes('user denied')) {
    return { kind: 'rejected', message: 'You cancelled the request in your wallet. Nothing was sent.' }
  }
  if (text.includes('insufficient funds') || text.includes('exceeds balance') || text.includes('transfer amount exceeds')) {
    return { kind: 'funds', message: 'Insufficient USDC for this amount plus network fees.' }
  }
  if (text.includes('underpriced')) {
    return { kind: 'network', message: 'The network fee was too low. Please try again.' }
  }
  if (text.includes('chain mismatch') || text.includes('does not match the target chain') || text.includes('wrong chain') || text.includes('unrecognized chain')) {
    return { kind: 'network', message: 'Your wallet is on a different network than this payment. Switch networks in your wallet and try again.' }
  }
  if (text.includes('nonce')) {
    return { kind: 'network', message: 'Your wallet has another transaction pending or out of order. Wait for it to finish, then try again.' }
  }
  if (text.includes('reverted') || text.includes('execution reverted')) {
    return { kind: 'reverted', message: 'The transaction would fail on-chain, so it was not sent.' }
  }
  if (text.includes('network') || text.includes('timeout') || text.includes('fetch') || text.includes('rate limit')) {
    return { kind: 'network', message: 'Network issue. Check your connection and try again.' }
  }
  return { kind: 'unknown', message: 'Something went wrong. Please try again.' }
}
