# QuickPayRouter: security review and USDC approval

Status: source restored and tested. Not deployed from this repository. No Router address is configured in the app.

## What it does

`payTo(recipient, amount, reference_)` moves USDC straight from the caller to `recipient` with `SafeERC20.safeTransferFrom`, then emits
`PaymentSent(payer, recipient, amount, reference_)` (`payer`, `recipient` and `reference_` are indexed). The router never holds USDC, takes no
fee, and has no escrow, no upgrade path and no payable function.

## Required USDC approval

Because the router calls `transferFrom` on the payer's behalf, the payer must first approve the router on USDC:

```
USDC.approve(<router address>, amount)
```

- Approve the exact payment amount. Do not grant an unlimited allowance: the router is immutable, but any allowance is spendable by the router
  for any recipient the caller chooses, and only the caller can call `payTo` for their own funds.
- The router uses the caller's allowance only when the caller invokes `payTo`. Nobody else can pull funds from an approved payer through it.
- Each payment consumes the allowance by the amount sent. Check the remaining allowance after paying.

## Access control and safety

| Concern | Behaviour |
|---|---|
| Owner powers | Pause and unpause only, plus two-step ownership transfer. The owner cannot move, freeze or redirect user funds. |
| Ownership | `Ownable2Step`. `renounceOwnership` always reverts, so a pause administrator always exists. |
| Pause | `whenNotPaused` on `payTo`. A paused router rejects all payments. |
| Reentrancy | `nonReentrant` on `payTo`; the event is emitted after the transfer. |
| Inputs | Zero recipient, zero amount, self-payment, recipient equal to the router, and recipient equal to the USDC contract all revert. |
| Token | USDC address is immutable and set in the constructor; zero address or an address without code reverts. |
| Fees and custody | None. The router's USDC balance stays zero. |

## Residual risks

- Constructor trust: the deployer must pass the genuine Arc USDC (`0x3600000000000000000000000000000000000000`). A code check cannot prove the token is genuine. Verify `usdc()` after deployment.
- The owner key can pause payments. Use a multisig or hardware wallet for the owner.
- Tokens sent directly to the router, or native value forced into it, are stranded. There is no recovery function by design.
- `reference_` is caller-supplied metadata. It is not unique and does not prove anything about who paid whom beyond the event itself.
- USDC can blacklist addresses at the token level. A transfer involving a blacklisted payer or recipient reverts and no funds move.
- No independent audit has been done. Get one before mainnet use.

## Verifying a deployment

Check on chain before use: code exists, `usdc()` equals the official USDC, `owner()` is the expected address, `paused()` is false, and the bytecode exposes
`payTo(address,uint256,bytes32)` (selector `0x0a38043f`).
