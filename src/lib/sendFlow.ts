import { TxFlowError, TxReplacedError } from '@/lib/confirmTx'
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
  /**
   * `hash` is set when the wallet sped the transaction up under a new hash. `verified: false` means the receipt
   * succeeded but does not contain the transfer that was asked for, which is never reported as success.
   */
  waitForReceipt: (hash: `0x${string}`) => Promise<{ status: 'success' | 'reverted'; hash?: `0x${string}`; verified?: boolean }>
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
    const mined = receipt.hash ?? hash
    if (receipt.status !== 'success') {
      onState({ stage: 'error', hash: mined, error: 'The transaction was mined but failed on-chain. No funds moved.' })
      return null
    }
    if (receipt.verified === false) {
      onState({ stage: 'error', hash: mined, error: 'The transaction was mined, but the expected USDC transfer is not in it. Check the transaction on the explorer before sending again.' })
      return null
    }
    onState({ stage: 'success', hash: mined })
    return mined
  } catch (error) {
    if (submitted) {
      if (error instanceof TxReplacedError) {
        onState({ stage: 'error', hash: submitted, error: error.message })
        return null
      }
      // The wallet already broadcast this payment; only its confirmation is unknown. Never present that as a
      // plain failure, or the user may pay twice.
      onState({ stage: 'error', hash: submitted, error: 'We could not confirm this payment. It may still complete. Check the transaction on the explorer before sending again.' })
      return null
    }
    if (error instanceof TxFlowError) {
      onState({ stage: 'error', error: error.message })
      return null
    }
    const parsed = parseTxError(error)
    onState({ stage: 'error', error: parsed.message, cancelled: parsed.kind === 'rejected' })
    return null
  }
}
