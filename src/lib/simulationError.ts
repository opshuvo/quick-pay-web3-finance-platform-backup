import { classifyRpcFailure } from '@/lib/arcRpc'

export interface SimulationProblem {
  /** 'busy' is temporary and retried automatically; the others come from the chain itself. */
  kind: 'busy' | 'balance' | 'blocked' | 'paused' | 'recipient' | 'other'
  message: string
}

/** Everything a viem error says about itself, without the echoed request body. */
function reasons(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const e = current as { shortMessage?: unknown; details?: unknown; reason?: unknown; message?: unknown; cause?: unknown }
    for (const value of [e.shortMessage, e.reason, e.details]) if (typeof value === 'string') parts.push(value)
    if (typeof e.shortMessage !== 'string' && typeof e.message === 'string') parts.push(e.message.split('\n')[0])
    current = e.cause
  }
  return parts.join(' | ')
}

/** Turns a failed pre-send simulation into a precise, honest message. A temporary RPC failure is never blamed on the payment. */
export function describeSimulationError(error: unknown): SimulationProblem {
  const failure = classifyRpcFailure(error)
  if (failure === 'rate' || failure === 'timeout' || failure === 'network') {
    return { kind: 'busy', message: "Arc's RPC is busy right now, so this payment could not be checked yet. Retrying automatically. Nothing was sent." }
  }
  const text = reasons(error)
  if (/exceeds balance|insufficient (balance|funds)/i.test(text)) return { kind: 'balance', message: 'Your USDC balance is lower than this amount, so the payment would fail. Nothing was sent.' }
  if (/blocklist|blacklist/i.test(text)) return { kind: 'blocked', message: 'USDC blocks this sender or recipient, so the payment would be rejected. Nothing was sent.' }
  if (/paused/i.test(text)) return { kind: 'paused', message: 'The Quick Pay contract is paused, so the payment would be rejected. Nothing was sent.' }
  if (/InvalidRecipient|SelfPayment|ZeroAddress/i.test(text)) return { kind: 'recipient', message: 'This recipient cannot be paid through the Quick Pay contract. Check the address. Nothing was sent.' }
  return { kind: 'other', message: 'The network could not simulate this payment, so it was not sent. Check your balance and the recipient, then retry.' }
}

/** Retry a simulation only when the failure is temporary. */
export function shouldRetrySimulation(count: number, error: unknown): boolean {
  if (count >= 3) return false
  return describeSimulationError(error).kind === 'busy'
}
