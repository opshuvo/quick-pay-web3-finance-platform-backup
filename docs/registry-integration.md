# QuickPayRegistry integration plan

Contract: `0x3920870225841408E5bfcADA83d1b50F5fcCa58b` on Arc Mainnet (chain 5042).

## What was verified on Arc Mainnet (read-only, nothing sent)

- The address has contract code. It was created at block 28830240 (tx `0x910838149a2e5d9f66aa1e7a3055b2bdb1c733fbe9e790f41d631341e4ccc138`).
- Its dispatch table contains the selectors of `createRequest`, `cancelRequest`, `pay`, `getRequest`, `statusOf`, `nextRequestId`, `requestCount`, `usdc`, `owner`, `pendingOwner`, `paused`, `pause`, `unpause`, `transferOwnership`, `acceptOwnership`, `renounceOwnership`, and the topics of `RequestCreated`, `RequestCancelled`, `PaymentReceived`.
- It has no `payTo` or any other function that pays an arbitrary address.
- Read results: `usdc()` = `0x3600000000000000000000000000000000000000` (the official Arc USDC), owner `0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968`, not paused, 0 requests created.
- Simulated calls (`eth_call`, no transaction): `createRequest` returns id 1, a zero amount reverts, `pay` and `cancelRequest` on a missing request revert with "request not open", `pause` from a non-owner reverts with "unauthorized". This matches `contracts/QuickPayRegistry.sol`.
- Not proven: the deployed bytecode is not byte-identical to a local build of `contracts/QuickPayRegistry.sol` (the Arc explorer has no source verification here, so compiler settings are unknown). Behaviour matches the source, but treat "same source" as unconfirmed.

## What the contract supports

| Feature | Supported | How |
| --- | --- | --- |
| Merchant creates a USDC payment request (amount, optional payer, optional expiry, hashed reference) | Yes | `createRequest` |
| Payer pays a request, USDC goes payer to merchant, onchain receipt | Yes | `pay(id)` after an exact-amount approval, event `PaymentReceived` |
| Merchant cancels an open request | Yes | `cancelRequest(id)` |
| Read a request and its live status (open, paid, cancelled, expired) | Yes | `getRequest`, `statusOf` |
| Sent and Received records for a wallet | Yes, for registry payments | `PaymentReceived` has indexed `merchant` and `payer`; `RequestCreated` has indexed `merchant` and `payer` |
| Ordinary Send / Receive / Scan to any address | No | No function pays an arbitrary address. These stay direct USDC transfers |
| Swap, Bridge | No | Unrelated to the contract; unchanged |

## Missing contract functions (cannot be added to this deployment)

- `payTo(recipient, amount, reference)`: needed to route ordinary sends through the contract.
- A per-wallet index (for example `requestsOf(address)`): not present, so wallet history comes from event logs, not a contract getter.
- Non-USDC tokens: the registry is USDC only.

## What this change does

- Sent and Received pages gain a "Confirmed by the FlowPay contract" list built from `PaymentReceived` logs for the connected wallet (payer = Sent, merchant = Received). Rows come only from logs emitted by the registry address.
- Ordinary USDC transfers already appear in the right wallet's Sent and Received history, including registry payments, because the registry moves USDC with a normal USDC transfer. Those rows are unchanged.
- The Smart Contracts page shows "recorded by the contract" only when the confirmed receipt contains the expected registry event with matching id, merchant, payer and amount. Otherwise it says the transaction confirmed but no registry record was found.
- After every confirmed contract transaction, balances, allowances, history and the contract lists are refreshed.
- Existing USDC transfers, Swap, Bridge, QR scanning and all other screens are untouched.
