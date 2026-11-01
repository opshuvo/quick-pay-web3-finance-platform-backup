# Transaction reliability audit

Scope: Send, Receive, Swap, Bridge, payment requests, registry payments, confirmation, receipt verification, balance refresh and history. No smart contract was changed or deployed, no deployed address was touched, and no external service was added.

## Verified as correct (no change needed)

- Chain ID 5042 and the official USDC `0x3600000000000000000000000000000000000000` (6 decimals) match the live chain. Checked against `https://rpc.mainnet.arc.io` (`eth_chainId` = 5042, `decimals()` = 6). The router at `0x1593C6fdEAB15228c90da354913a919fDA08b7E4` reports the same USDC.
- Fee caps never fall below Arc's 20 gwei floor. The gas check treats the native 18-decimal view and the 6-decimal ERC-20 view as one pool and converts with the shared helpers.
- Approvals are exact-amount everywhere (send via router, swap to Permit2, bridge, registry). Swap and bridge guards already refuse mismatched tokens, networks, amounts and spenders.
- History comes only from USDC `Transfer` logs on the official contract. The 18-decimal mirror logs from `0xffff…fffe` are excluded on both the server and the browser. Swaps and bridges are recorded only after their receipts are read back, and a bridge is "Complete" only after the destination fill is read back.
- Payment request verification (server) requires a successful receipt, a USDC transfer to the recipient for at least the amount, mined inside the request window, and one transaction can settle one request.

## Bugs found and fixed

| # | Where | Problem | Fix |
|---|-------|---------|-----|
| 1 | Send, Swap, Bridge, Registry | Waiting for a receipt resolves with the REPLACEMENT's receipt when the wallet cancels or replaces a pending transaction, so a cancelled payment could be reported as confirmed | New `src/lib/confirmTx.ts`: cancelled or replaced transactions are an error with the original hash, a speed-up is followed under its mined hash, and the receipt must belong to the submitted transaction |
| 2 | Send | Success was shown for any successful receipt | Success now also needs the exact USDC `Transfer` (payer, recipient, amount) from the official contract inside the receipt |
| 3 | Bridge | If the deposit was broadcast but its receipt could not be read, the error carried no hash and "Try again" was offered, which could bridge twice | The hash is kept, the message says it may still complete, and the only action is Close |
| 4 | Swap | Same as 3 for the swap transaction | The swap hash is kept and retry is replaced by Close while the outcome is unknown |
| 5 | Registry | A reverted or unconfirmed transaction was reported as "would fail on-chain, so it was not sent" even though it had been sent | Honest messages for reverted, unconfirmed and cancelled transactions |
| 6 | Registry | Double clicks were guarded by React state only | A ref guard blocks a second run in the same tick |
| 7 | Registry | "Paid on-chain" / "Request created" was shown without checking the registry event | Success needs the matching `PaymentReceived` or `RequestCreated` event from the registry; the new request id is shown |
| 8 | Registry | The request, status and allowance used for the pay flow could be stale; payer-restricted requests looked payable to everyone | State is re-read right before signing; a request restricted to another payer is blocked with a message |
| 9 | Registry | Fee estimation failure outside the guarded block was an unhandled rejection | Fees are fetched inside the guarded step |
| 10 | Payment request page | After paying, one failed server verification left the request showing "Review and pay" again, so it could be paid twice | Verification retries while the server cannot see the transaction yet; if it still fails the page shows "payment confirmed, do not pay again" with a Retry button and hides the pay button |
| 11 | Bridge | Typed amounts with more decimals than the token were silently rounded (`parseUnits`) | Exact parsing; extra decimals are refused with a message |
| 12 | Bridge | A deposit that reverted stayed in the local progress list as "waiting for Across" | It is removed; a sped-up deposit is tracked under the hash that mined |
| 13 | Bridge | The quote could expire while the approval was confirming, then the deposit used the old quote | The quote is re-checked after the approval; if stale the user reviews the refreshed quote |
| 14 | Bridge | The zero address was accepted as the destination recipient | Refused |
| 15 | Send | The hook trusted its callers for the recipient and amount | The hook re-validates (no zero amount, zero address, USDC contract or self) before signing |
| 16 | Send, Swap, Bridge | Balances were refreshed only on some paths | Cached balance reads are invalidated after confirmation (and again a few seconds later for Send) |
| 17 | Errors | Chain mismatch and nonce errors were reported as "Something went wrong" | Specific messages |

## Tests

- `bun run test`: 232 unit tests pass, including new `tests/confirmTx.test.ts` (receipt handling, replacement, speed-up, retries, transfer matching, verification retry, bridge store) and `tests/registryConfirm.test.ts` (registry event confirmation, lookalike events from other contracts).
- `bun run test:render`: all screens render (needs the backend running, as before).
- `tsc` for the app and the server, and the linter: clean.
- Live check against Arc mainnet: 15 of 15 recent real USDC transfers were recognised by the new receipt check, and the mirror log emitter was present in those receipts and correctly ignored.

## Not verified / remaining

- No real transaction was sent. Wallet prompts, real approvals, real swaps and real bridges were not exercised, so end-to-end behaviour with a live wallet is covered by unit tests of the logic, not by a live run.
- `forge build` still fails because `contracts/QuickPayRegistry.sol` is missing from the repository (the Registry deploy script and its test import it). The deployed registry at `0x3920870225841408E5bfcADA83d1b50F5fcCa58b` is unaffected, but its source cannot be reviewed or rebuilt from this repository.
- With the registry files skipped, 38 of 39 router tests pass. The failing test, `testFuzz_PayTo_ConservesFunds`, fails when the fuzzer picks a payer that is one of the pre-funded test accounts (`assertEq(balanceOf(payer), 0)` sees the pre-funded 1000 USDC). This is a flaw in the test, not in the router; the test was left alone.
- Without a configured `DATABASE_URL`, payment requests, splits and the server-side history are unavailable (the app falls back to reading history from Arc in the browser).
- Swap success depends on the transaction receipt status (the Universal Router enforces the minimum received on-chain). The output amount is not re-checked in the browser; the recorded history entry is built from the receipt's token movements.
- `src/lib/uniswap/arc.ts` `parseTokenAmount` still uses viem's rounding `parseUnits`, but nothing calls it.
- The Quick Pay contracts have not had an independent audit.
