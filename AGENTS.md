# Quick Pay

> Built with Arc Studio

Project memory for future agents and developers.

## What this app does

Quick Pay is a USDC payment and finance app for Arc Mainnet (chain 5042): send, receive, scan to pay, payment requests, split payments, swap (Uniswap), bridge (Across), history, analytics, and a payment request registry contract.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind, wagmi v2, viem, ConnectKit
- Backend: Bun server in `server/` (Vite proxies `/api/*` to it, prefix stripped), PostgreSQL via `DATABASE_URL`
- Contracts: Solidity 0.8.28 + Foundry, `contracts/QuickPayRegistry.sol`, tests in `contracts/test/`
- Chain facts come from `src/onchain-facts.ts`, money math from `src/onchain-money.ts`. Never edit those generated files.

## Key rules

- Never fake quotes, balances, routes, history or success states. A swap is "success" only after its receipt; a bridge is "Complete" only after the destination fill transaction was read back as successful.
- No automatic transactions. Every financial action goes through a confirmation sheet.
- API keys (Uniswap, Across) live only in server env. The browser calls `/api/uniswap/*` and `/api/across/*`.
- Approvals are exact-amount, built by Quick Pay, never taken from API calldata.
- The preview proxy drops custom `x-*` headers: auth uses the `Authorization` header.

## Where things are

- Swap: `src/pages/Swap.tsx`, `src/hooks/useSwapQuote.ts`, `src/hooks/useSwapExecution.ts`, `src/lib/uniswap/` (`api.ts`, `apiValidate.ts`, `executeApi.ts` for the Trading API engine; `arc.ts`, `execute.ts` for direct on-chain Uniswap), `server/uniswap.ts`
- Bridge: `src/pages/Bridge.tsx`, `src/components/BridgeTracker.tsx`, `src/lib/across.ts`, `server/across.ts`
- Verified Swap/Bridge activity: `server/activity.ts` (table `defi_activity`), `src/lib/activity.ts`, `src/components/ActivityList.tsx`. History labels (`server/protocols.ts`) prefer these verified records over address heuristics.
- History indexer: `server/indexer.ts` (USDC Transfer logs, backfill toward block 0)
- Payment requests: `server/requests.ts`; sign-in: `shared/session.ts`

## Notes for testing

- `bun run test` (unit), `bun run test:smoke` (live backend), `bun run test:render` (DOM render of every screen).
- Arc native USDC emits mirror Transfer logs from a system address; receipt parsing must ignore it (see `server/activity.ts`).
- The public Arc RPC rate-limits; the indexer and verification calls back off and retry.

## Deployed contracts

None. `VITE_QUICKPAY_REGISTRY_ADDRESS` stays unset until the owner deploys from their own wallet.

## To run

```bash
bun install
bun run server
bun run dev
```
