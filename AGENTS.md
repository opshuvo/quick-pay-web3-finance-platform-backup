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

- QuickPayRegistry on Arc Mainnet (5042): `0x3920870225841408E5bfcADA83d1b50F5fcCa58b` (deployed by the owner from their own wallet; also listed in `deployments/arc-mainnet.json`). Read from the chain: uses USDC `0x3600000000000000000000000000000000000000`, owner `0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968`, not paused, 0 requests at last check.
- The app uses it through `VITE_QUICKPAY_REGISTRY_ADDRESS` in the local, gitignored `.env`. Not independently audited.

- QuickPayRouter (`contracts/QuickPayRouter.sol`, `payTo(recipient, amount, reference)`): written and tested. The owner's own deployment on Arc Mainnet (5042) is `0x1593C6fdEAB15228c90da354913a919fDA08b7E4` (read from the chain: uses official USDC `0x3600...0000`, not paused; wired via `VITE_QUICKPAY_ROUTER_ADDRESS` in the gitignored `.env`; not independently audited). When `VITE_QUICKPAY_ROUTER_ADDRESS` is set and `src/hooks/useRouter.ts` confirms it on Arc (code, official USDC, not paused), Send/Pay use approve (exact amount) + `payTo` instead of a direct USDC transfer, so the explorer shows the router as the destination. Unset means plain transfers.

## Performance notes

- The wallet picker (ConnectKit) is NOT in the first download: `src/components/WalletButton.tsx` is a plain button, `WalletModalMount` loads `WalletModalHost` on idle/first touch/tap. Do not import `connectkit` anywhere else.
- Screens load through `src/routes.ts` (also prefetched when a nav link is pointed at). Keep new heavy libraries behind dynamic `import()`.
- Measure with `bunx vite build` then `bun run perf:report`. Results: `docs/performance-report.md`.

## To run

```bash
bun install
bun run server
bun run dev
```
