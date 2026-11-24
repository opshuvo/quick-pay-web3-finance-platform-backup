/**
 * Verifies the batch-payout receipt matching against a REAL Arc Mainnet receipt (an actual EURC and USDC transfer),
 * so the logic that decides "Confirmed" is proven on chain data, not only on synthetic logs. Read-only.
 * Run: bun tests/payrollReceipts.live.ts
 */
import { createPublicClient, http, type Address, type Hash } from 'viem'
import { matchBatchReceipts, type RunRow } from '../src/lib/payroll'
import { receiptHasTransfer } from '../src/lib/confirmTx'

const TX = '0xc85bd5606a24a587aa2b4658ffeae2305a49025529ce4a7530db1dfd1535dedc' as Hash
const FROM = '0xc2eedf3bc7f93366c00c6074df0e6f122fa2445c' as Address
const TO = '0x6f57b4c22155cef09f17184c954f227ff0493742' as Address
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as Address
const USDC = '0x3600000000000000000000000000000000000000' as Address
const OTHER = '0x1111111111111111111111111111111111111111' as Address

let passed = 0
const failed: string[] = []
const check = (ok: boolean, s: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (ok) passed++; else failed.push(s) }

const client = createPublicClient({ transport: http('https://rpc.mainnet.arc.io/') })
const receipt = await client.getTransactionReceipt({ hash: TX })
check(receipt.status === 'success', 'the real transaction succeeded on Arc')
check(receiptHasTransfer(receipt.logs, EURC, FROM, TO, 138_678_960n), 'its exact EURC transfer is found (sender, recipient and amount)')
check(!receiptHasTransfer(receipt.logs, EURC, FROM, TO, 138_678_961n), 'one unit more is not found')
check(!receiptHasTransfer(receipt.logs, EURC, FROM, OTHER, 138_678_960n), 'another recipient is not found')
check(!receiptHasTransfer(receipt.logs, EURC, OTHER, TO, 138_678_960n), 'another sender is not found')
check(receiptHasTransfer(receipt.logs, USDC, FROM, TO, 2_100_531_406n), 'its USDC transfer is found separately, under the USDC contract')
check(!receiptHasTransfer(receipt.logs, USDC, FROM, TO, 138_678_960n), 'the EURC amount is not mistaken for a USDC transfer')

const rows: RunRow[] = [
  { id: 'a', to: TO, amount: '138678960', state: 'pending' },
  { id: 'b', to: TO, amount: '138678960', state: 'pending' },
  { id: 'c', to: OTHER, amount: '138678960', state: 'pending' },
]
const read = [{ transactionHash: TX, status: receipt.status, logs: receipt.logs }]
const eurc = matchBatchReceipts(rows, read, EURC, FROM)
check(eurc.a?.hash === TX && eurc.b === undefined && eurc.c === undefined, 'batch matching: one real transfer satisfies one row, never two, and never another recipient')
const usdc = matchBatchReceipts([{ id: 'u', to: TO, amount: '2100531406', state: 'pending' }], read, USDC, FROM)
check(usdc.u?.hash === TX, 'batch matching works for the USDC transfer in the same real transaction')
console.log(`\n${passed} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
