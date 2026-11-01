import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hash, type Log } from 'viem'
import { confirmTx, receiptHasTransfer, TxReplacedError, TxUnconfirmedError } from '../src/lib/confirmTx'
import { runUsdcSend, type SendState } from '../src/lib/sendFlow'
import { ApiError } from '../src/lib/api'
import { verifyWithRetry } from '../src/lib/requests'
import { removeBridge, saveBridge, loadBridges, type StoredBridge } from '../src/lib/bridgeStore'

const H1 = `0x${'11'.repeat(32)}` as Hash
const H2 = `0x${'22'.repeat(32)}` as Hash
const ALICE = '0x00000000000000000000000000000000000a11ce' as Address
const BOB = '0x0000000000000000000000000000000000000b0b' as Address
const USDC = '0x3600000000000000000000000000000000000000' as Address
const noSleep = async () => undefined

type Replacement = { reason: 'cancelled' | 'replaced' | 'repriced'; transaction: { hash: Hash } }
const receipt = (hash: Hash, status: 'success' | 'reverted' = 'success') => ({ transactionHash: hash, status, logs: [] }) as never

function transferLog(address: Address, from: Address, to: Address, value: bigint): Log {
  return {
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: 1n, blockHash: H1, logIndex: 0, transactionHash: H1, transactionIndex: 0, removed: false,
  } as Log
}

describe('confirmTx', () => {
  test('returns the receipt of the submitted transaction', async () => {
    const out = await confirmTx({ waitForTransactionReceipt: async () => receipt(H1) } as never, H1, { sleep: noSleep })
    expect(out.hash).toBe(H1)
    expect(out.receipt.status).toBe('success')
  })

  test('a transaction cancelled from the wallet is never reported as the original succeeding', async () => {
    const client = {
      waitForTransactionReceipt: async (p: { onReplaced: (r: Replacement) => void }) => {
        p.onReplaced({ reason: 'cancelled', transaction: { hash: H2 } })
        return receipt(H2) // viem resolves with the REPLACEMENT's (successful) receipt
      },
    }
    const error = await confirmTx(client as never, H1, { sleep: noSleep }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TxReplacedError)
    expect((error as TxReplacedError).reason).toBe('cancelled')
    expect((error as TxReplacedError).hash).toBe(H1)
  })

  test('a different transaction taking the nonce is reported as replaced', async () => {
    const client = {
      waitForTransactionReceipt: async (p: { onReplaced: (r: Replacement) => void }) => {
        p.onReplaced({ reason: 'replaced', transaction: { hash: H2 } })
        return receipt(H2)
      },
    }
    expect(await confirmTx(client as never, H1, { sleep: noSleep }).catch((e: unknown) => e)).toBeInstanceOf(TxReplacedError)
  })

  test('a speed-up is followed and reported under the hash that actually mined', async () => {
    const client = {
      waitForTransactionReceipt: async (p: { onReplaced: (r: Replacement) => void }) => {
        p.onReplaced({ reason: 'repriced', transaction: { hash: H2 } })
        return receipt(H2)
      },
    }
    const out = await confirmTx(client as never, H1, { sleep: noSleep })
    expect(out.hash).toBe(H2)
  })

  test('transient RPC failures are retried', async () => {
    let calls = 0
    const client = {
      waitForTransactionReceipt: async () => {
        calls += 1
        if (calls < 3) throw new Error('HTTP request failed')
        return receipt(H1)
      },
    }
    const out = await confirmTx(client as never, H1, { attempts: 3, sleep: noSleep })
    expect(calls).toBe(3)
    expect(out.hash).toBe(H1)
  })

  test('when the outcome never becomes readable the broadcast hash is kept, not a plain failure', async () => {
    const client = { waitForTransactionReceipt: async () => { throw new Error('timed out') } }
    const error = await confirmTx(client as never, H1, { attempts: 2, sleep: noSleep }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TxUnconfirmedError)
    expect((error as TxUnconfirmedError).hash).toBe(H1)
    expect((error as Error).message).toMatch(/may still complete/)
  })

  test('a receipt for some other transaction is never accepted', async () => {
    const client = { waitForTransactionReceipt: async () => receipt(H2) }
    expect(await confirmTx(client as never, H1, { sleep: noSleep }).catch((e: unknown) => e)).toBeInstanceOf(TxUnconfirmedError)
  })

  test('a reverted receipt is returned as reverted, not thrown', async () => {
    const out = await confirmTx({ waitForTransactionReceipt: async () => receipt(H1, 'reverted') } as never, H1, { sleep: noSleep })
    expect(out.receipt.status).toBe('reverted')
  })
})

describe('receiptHasTransfer', () => {
  test('accepts the exact payer, recipient and amount from the USDC contract', () => {
    expect(receiptHasTransfer([transferLog(USDC, ALICE, BOB, 5_000_000n)], USDC, ALICE, BOB, 5_000_000n)).toBe(true)
  })
  test('rejects a wrong amount, recipient or payer', () => {
    const logs = [transferLog(USDC, ALICE, BOB, 5_000_000n)]
    expect(receiptHasTransfer(logs, USDC, ALICE, BOB, 5_000_001n)).toBe(false)
    expect(receiptHasTransfer(logs, USDC, ALICE, ALICE, 5_000_000n)).toBe(false)
    expect(receiptHasTransfer(logs, USDC, BOB, BOB, 5_000_000n)).toBe(false)
  })
  test('ignores a lookalike Transfer emitted by another contract, including the 18-decimal native mirror', () => {
    const fake = '0xfffffffffffffffffffffffffffffffffffffffe' as Address
    expect(receiptHasTransfer([transferLog(fake, ALICE, BOB, 5_000_000n * 10n ** 12n)], USDC, ALICE, BOB, 5_000_000n)).toBe(false)
    expect(receiptHasTransfer([transferLog(BOB, ALICE, BOB, 5_000_000n)], USDC, ALICE, BOB, 5_000_000n)).toBe(false)
  })
  test('an empty receipt has no transfer', () => {
    expect(receiptHasTransfer([], USDC, ALICE, BOB, 1n)).toBe(false)
  })
})

describe('runUsdcSend receipt handling', () => {
  const collect = () => {
    const states: SendState[] = []
    return { states, onState: (s: SendState) => states.push(s), last: () => states[states.length - 1] }
  }
  test('a successful receipt without the expected transfer is not a success', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => H1, waitForReceipt: async () => ({ status: 'success', verified: false }), onState: c.onState })
    expect(result).toBeNull()
    expect(c.last()).toMatchObject({ stage: 'error', hash: H1 })
    expect(c.states.some((s) => s.stage === 'success')).toBe(false)
  })
  test('a speed-up reports success under the mined hash', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => H1, waitForReceipt: async () => ({ status: 'success', hash: H2, verified: true }), onState: c.onState })
    expect(result).toBe(H2)
    expect(c.last()).toMatchObject({ stage: 'success', hash: H2 })
  })
  test('a cancelled payment is an error with its hash and never success', async () => {
    const c = collect()
    const result = await runUsdcSend({ submit: async () => H1, waitForReceipt: async () => { throw new TxReplacedError(H1, 'cancelled') }, onState: c.onState })
    expect(result).toBeNull()
    expect(c.last()).toMatchObject({ stage: 'error', hash: H1 })
    expect(c.last()?.error).toMatch(/cancelled/)
    expect(c.states.some((s) => s.stage === 'success')).toBe(false)
  })
  test('a failed approval before any payment keeps its own message', async () => {
    const c = collect()
    await runUsdcSend({ submit: async () => { throw new TxUnconfirmedError(H2) }, waitForReceipt: async () => ({ status: 'success' }), onState: c.onState })
    expect(c.last()?.stage).toBe('error')
    expect(c.last()?.error).toMatch(/may still complete/)
  })
})

describe('verifyWithRetry', () => {
  const notFound = () => new ApiError(404, 'tx_not_found', 'not yet')
  test('retries while the server cannot see the transaction, then succeeds', async () => {
    let calls = 0
    const out = await verifyWithRetry(async () => { calls += 1; if (calls < 3) throw notFound(); return 'paid' }, { attempts: 5, sleep: noSleep })
    expect(out).toBe('paid')
    expect(calls).toBe(3)
  })
  test('retries when the service is briefly unreachable', async () => {
    let calls = 0
    const out = await verifyWithRetry(async () => { calls += 1; if (calls === 1) throw new ApiError(0, 'unreachable', 'down'); return 'ok' }, { sleep: noSleep })
    expect(out).toBe('ok')
  })
  test('never retries a definite answer', async () => {
    let calls = 0
    const error = await verifyWithRetry(async () => { calls += 1; throw new ApiError(409, 'tx_failed', 'failed on-chain') }, { sleep: noSleep }).catch((e: unknown) => e)
    expect(calls).toBe(1)
    expect((error as ApiError).code).toBe('tx_failed')
  })
  test('gives up after the allowed attempts', async () => {
    let calls = 0
    await verifyWithRetry(async () => { calls += 1; throw notFound() }, { attempts: 3, sleep: noSleep }).catch(() => undefined)
    expect(calls).toBe(3)
  })
})

describe('bridgeStore.removeBridge', () => {
  test('forgets a reverted deposit and keeps the others', () => {
    const data = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const entry = (hash: Hash): StoredBridge => ({ hash, originChainId: 5042, destinationChainId: 1, amount: '1', symbol: 'USDC', createdAt: 1 })
    saveBridge(ALICE, entry(H1))
    saveBridge(ALICE, entry(H2))
    removeBridge(ALICE, H1.toUpperCase())
    expect(loadBridges(ALICE).map((b) => b.hash)).toEqual([H2])
  })
})
