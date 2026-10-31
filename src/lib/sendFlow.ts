import { parseTxError } from '@/lib/errors'

export type SendStage = 'idle' | 'wallet' | 'confirming' | 'success' | 'error'

export interface SendState {
  stage: SendStage
  hash?: `0x${string}`
  error?: string
  cancelled?: boolean
}

/** Runs one job at a time; a second call while one is in flight is ignored (a double tap cannot pay twice). */
export class SingleFlight {
  private busy = false
  get isBusy() {
    return this.busy
  }
  async run<T>(job: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) return undefined
    this.busy = true
    try {
      return await job()
    } finally {
      this.busy = false
    }
  }
}

export interface SendDeps {
  /** Asks the wallet to sign and broadcast. Resolves with the hash once the wallet submitted it. */
  submit: () => Promise<`0x${string}`>
  waitForReceipt: (hash: `0x${string}`) => Promise<{ status: 'success' | 'reverted' }>
  onState: (state: SendState) => void
}

/**
 * The payment lifecycle. Success is reported only for a mined receipt with status success. A rejected
 * wallet prompt, a revert, and "broadcast but not confirmed" are three different outcomes and are never mixed up.
 */
export async function runUsdcSend({ submit, waitForReceipt, onState }: SendDeps): Promise<`0x${string}` | null> {
  let submitted: `0x${string}` | undefined
  try {
    onState({ stage: 'wallet' })
    const hash = await submit()
    submitted = hash
    onState({ stage: 'confirming', hash })
    const receipt = await waitForReceipt(hash)
    if (receipt.status !== 'success') {
      onState({ stage: 'error', hash, error: 'The transaction was mined but failed on-chain. No funds moved.' })
      return null
    }
    onState({ stage: 'success', hash })
    return hash
  } catch (error) {
    if (submitted) {
      // The wallet already broadcast this payment; only its confirmation is unknown. Never present that as a
      // plain failure, or the user may pay twice.
      onState({ stage: 'error', hash: submitted, error: 'We could not confirm this payment. It may still complete. Check the transaction on the explorer before sending again.' })
      return null
    }
    const parsed = parseTxError(error)
    onState({ stage: 'error', error: parsed.message, cancelled: parsed.kind === 'rejected' })
    return null
  }
}
