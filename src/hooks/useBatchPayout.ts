import { useCallback, useRef } from 'react'
import { encodeFunctionData, erc20Abi, type Hash } from 'viem'
import { useAccount, useCapabilities, useConfig, usePublicClient, useSendCalls, useWriteContract } from 'wagmi'
import { waitForCallsStatus } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { ARC_CHAIN_ID } from '@/lib/arc'
import { recordConfirmedTx } from '@/lib/chainHistory/record'
import { confirmTx, receiptHasTransfer, TxFlowError, TxReplacedError } from '@/lib/confirmTx'
import { parseTxError } from '@/lib/errors'
import { arcFeeParams } from '@/lib/fees'
import { matchBatchReceipts, recheckPending, runQueue, supportsAtomicBatch, type PayrollRun, type QueueDeps, type ReadReceipt, type RunRow } from '@/lib/payroll'
import { payTokenInfo } from '@/lib/payTokens'
import { validateRecipient } from '@/lib/payments'
import { SingleFlight } from '@/lib/sendFlow'
import { ledgerAdd, ledgerRehash, ledgerSetStatus } from '@/lib/txLedger'

/**
 * Executes a batch payout with the connected wallet. Two ways, both non-custodial:
 *  - queue: one token transfer per recipient, each approved in the wallet;
 *  - batch: one approval for every transfer, offered only when the wallet itself says it can run the calls atomically on Arc.
 * Every row is judged by Arc's receipt for its own transaction.
 */
export function useBatchPayout() {
  const { address } = useAccount()
  const config = useConfig()
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID })
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const { sendCallsAsync } = useSendCalls()
  // A wallet that cannot answer wallet_getCapabilities simply has no one-approval option.
  const capabilities = useCapabilities({ account: address, query: { enabled: Boolean(address), retry: false, staleTime: 5 * 60_000 } })
  const canBatch = supportsAtomicBatch(capabilities.data, ARC_CHAIN_ID)
  const flight = useRef(new SingleFlight())

  /** Reads Arc for one row's transaction and says what happened. */
  const confirmRow = useCallback(
    async (hash: Hash, row: RunRow, run: PayrollRun): ReturnType<QueueDeps['confirm']> => {
      if (!publicClient || !address) throw new Error('not ready')
      const token = payTokenInfo(run.token)
      let confirmed: Awaited<ReturnType<typeof confirmTx>>
      try {
        confirmed = await confirmTx(publicClient, hash)
      } catch (error) {
        if (error instanceof TxReplacedError && error.reason === 'cancelled') {
          ledgerSetStatus(address, hash, 'failed')
          return { state: 'failed', error: error.message }
        }
        throw error
      }
      const { hash: mined, receipt } = confirmed
      ledgerRehash(address, hash, mined)
      if (receipt.status !== 'success') {
        ledgerSetStatus(address, mined, 'failed')
        return { state: 'failed', hash: mined, error: 'The transfer was mined but failed on-chain. No funds moved.' }
      }
      if (!receiptHasTransfer(receipt.logs, token.address, address, row.to, BigInt(row.amount))) {
        return { state: 'unverified', hash: mined, error: `The transaction was mined, but the expected ${run.token} transfer is not in it. Check it on the explorer before sending again.` }
      }
      ledgerSetStatus(address, mined, 'confirmed')
      void recordConfirmedTx({ address, hash: mined, queryClient })
      return { state: 'confirmed', hash: mined }
    },
    [address, publicClient, queryClient],
  )

  /** One transfer per recipient, each approved in the wallet. Resumable: rows already sent are only re-checked. */
  const runQueued = useCallback(
    (run: PayrollRun, onChange: (run: PayrollRun) => void) =>
      flight.current.run(() => {
        if (!publicClient || !address) throw new TxFlowError('Connect a wallet on Arc first.')
        const token = payTokenInfo(run.token)
        return runQueue(run, {
          onChange,
          isRejection: (e) => parseTxError(e).kind === 'rejected',
          describe: (e) => (e instanceof TxFlowError ? e.message : parseTxError(e).message),
          confirm: (hash, row) => confirmRow(hash, row, run),
          send: async (row) => {
            // Last line of defence, whatever the screen did: never sign an empty amount or a lost-funds recipient.
            if (BigInt(row.amount) <= 0n) throw new TxFlowError('Amount must be greater than zero.')
            validateRecipient(row.to, address)
            const fees = await arcFeeParams(publicClient)
            const hash = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: 'transfer', args: [row.to, BigInt(row.amount)], chainId: ARC_CHAIN_ID, ...fees })
            // The wallet signed: it appears in History as pending straight away, until Arc's receipt says what happened.
            ledgerAdd({ hash, wallet: address, kind: 'send', to: row.to, token: token.address, amount: row.amount, symbol: token.symbol, decimals: token.decimals })
            return hash
          },
        })
      }),
    [address, publicClient, writeContractAsync, confirmRow],
  )

  /** Reads Arc again for rows that were already broadcast. Sends nothing. */
  const recheck = useCallback(
    (run: PayrollRun, onChange: (run: PayrollRun) => void) => recheckPending(run, { onChange, confirm: (hash, row) => confirmRow(hash, row, run) }),
    [confirmRow],
  )

  /** Settles a bundle the wallet accepted: reads each receipt from Arc and matches every row to its own transfer. */
  const settleBundle = useCallback(
    async (run: PayrollRun, id: string): Promise<PayrollRun> => {
      if (!publicClient || !address) return run
      const token = payTokenInfo(run.token)
      const status = await waitForCallsStatus(config, { id, timeout: 120_000, pollingInterval: 2_000 })
      const hashes = [...new Set((status.receipts ?? []).map((r) => r.transactionHash))]
      const receipts: ReadReceipt[] = []
      for (const hash of hashes) {
        const r = await publicClient.getTransactionReceipt({ hash })
        receipts.push({ transactionHash: hash, status: r.status, logs: r.logs })
      }
      const matched = matchBatchReceipts(run.rows, receipts, token.address, address)
      const anyReverted = receipts.some((r) => r.status === 'reverted')
      const rows = run.rows.map((row): RunRow => {
        const hit = matched[row.id]
        if (hit) return { ...row, state: 'confirmed', hash: hit.hash, error: undefined }
        if (status.status === 'failure' || anyReverted || receipts.length === 0) return { ...row, state: 'failed', error: 'The batch did not complete on Arc. No funds moved for this transfer.' }
        return { ...row, state: 'unverified', error: `The batch was mined, but the expected ${run.token} transfer is not in it. Check it on the explorer before sending again.` }
      })
      for (const hash of hashes) void recordConfirmedTx({ address, hash, queryClient })
      return { ...run, rows }
    },
    [address, config, publicClient, queryClient],
  )

  /** One wallet approval for every transfer. Only called when `canBatch` is true. */
  const runBatch = useCallback(
    (run: PayrollRun, onChange: (run: PayrollRun) => void) =>
      flight.current.run(async () => {
        if (!publicClient || !address || !canBatch) throw new TxFlowError('Your wallet does not report support for sending these together.')
        const token = payTokenInfo(run.token)
        for (const row of run.rows) validateRecipient(row.to, address)
        let current: PayrollRun = { ...run, mode: 'batch', paused: undefined, rows: run.rows.map((r) => ({ ...r, state: 'wallet' as const })) }
        onChange(current)
        let id: string
        try {
          const calls = run.rows.map((row) => ({ to: token.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [row.to, BigInt(row.amount)] }) }))
          const sent = await sendCallsAsync({ calls, chainId: ARC_CHAIN_ID, experimental_fallback: false })
          id = (sent as { id: string }).id
        } catch (error) {
          // Nothing was submitted: put every row back so the person can retry or choose the one-at-a-time queue.
          current = { ...run, paused: parseTxError(error).kind === 'rejected' ? 'Paused: you declined the batch in your wallet.' : `Paused: ${parseTxError(error).message}` }
          onChange(current)
          return current
        }
        current = { ...current, callsId: id, rows: current.rows.map((r) => ({ ...r, state: 'pending' as const })) }
        onChange(current)
        try {
          current = await settleBundle(current, id)
        } catch {
          current = { ...current, paused: 'Paused: Arc could not be reached to check this batch. Resume to check it again. Nothing will be sent twice.' }
        }
        onChange(current)
        return current
      }),
    [address, canBatch, publicClient, sendCallsAsync, settleBundle],
  )

  /** Re-checks a bundle that was submitted before a reload. */
  const recheckBundle = useCallback(
    async (run: PayrollRun, onChange: (run: PayrollRun) => void) => {
      if (!run.callsId) return run
      try {
        const next = await settleBundle(run, run.callsId)
        onChange(next)
        return next
      } catch {
        const next = { ...run, paused: 'Paused: Arc could not be reached to check this batch. Resume to check it again. Nothing will be sent twice.' }
        onChange(next)
        return next
      }
    },
    [settleBundle],
  )

  return { canBatch, capabilitiesLoading: capabilities.isLoading, runQueued, runBatch, recheck, recheckBundle }
}
