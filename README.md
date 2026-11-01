# FlowPay

FlowPay is a USDC payment and finance app for Arc Mainnet. Send, receive and scan to pay, create shareable payment requests, split bills, swap tokens through Uniswap, bridge with Across, and keep a searchable history of your wallet activity.

Built with [Arc Studio](https://studio.arc.io)

> Arc Mainnet moves real funds and transactions cannot be reversed. Review everything on testnet first, get an independent security review, and only then use real money. Nothing in this repository has had an independent audit.

> FlowPay was previously named Quick Pay. Only the product name changed. Deployed contract names (`QuickPayRegistry`, `QuickPayRouter`), their addresses, the `VITE_QUICKPAY_*` environment variables, saved browser keys and the Solidity files are intentionally unchanged, because renaming them would alter the compiled contracts or break existing setups.

## Features

- Wallet connection with wrong-network guidance for Arc Mainnet (chain ID 5042)
- Send USDC with a preview and explicit confirmation before every payment
- Receive with a QR code, and scan a QR code or paste a code to fill in payment details (scanning never sends anything)
- Payment requests with shareable links, plus split payments built on them
- Swap tokens on Arc through Uniswap, with live quotes, route, price impact, minimum received, slippage, exact approvals and quote expiry
- Bridge between Arc and other networks with Across, using only routes Across reports as available, with fee breakdown, arrival estimate and a progress tracker that shows Complete only after delivery is verified on the destination chain
- Transaction history with search, filters, CSV export and verified Swap and Bridge categories
- Analytics from your indexed history, with clear notes when history is still being backfilled
- A payment request and receipt contract (not deployed by default; the Smart Contracts page shows "Not Deployed" until you configure a real deployment)

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi and viem, a Bun backend with PostgreSQL, Solidity with Foundry.

## Development

Prerequisites: [Bun](https://bun.sh), [Foundry](https://getfoundry.sh) (only for the contract), and a PostgreSQL database.

```bash
bun install
cp .env.example .env      # then fill in the values you need
bun run server            # backend on port 3001
bun run dev               # frontend on port 5173, proxies /api to the backend
```

### Environment variables

Server only (never exposed to the browser):

- `DATABASE_URL` PostgreSQL connection string for history, payment requests and verified swap/bridge activity
- `UNISWAP_API_KEY` Uniswap Trading API key. Optional: without it, Swap quotes and executes against Uniswap's pools directly on-chain and says so on screen
- `ACROSS_API_KEY`, `ACROSS_INTEGRATOR_ID` Optional Across credentials for production usage
- `ARC_RPC_URL` Optional Arc RPC override
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` Optional, provisioned by Arc Studio; outside Arc Studio the public Arc RPC is used
- `PORT` Backend port (default 3001)
- `INDEXER_RANGE`, `INDEXER_RANGE_CEILING`, `INDEXER_MIN_INTERVAL_MS`, `INDEXER_MAX_PENDING_WALLETS` Optional history indexer tuning

Public (shipped to the browser, so never put secrets here):

- `VITE_EURC_ADDRESS` Optional override for the EURC address in Swap. By default Swap lists USDC, EURC, cirBTC and WETH using Circle's published Arc Mainnet addresses, each checked against its own contract
- `VITE_QUICKPAY_REGISTRY_ADDRESS` Address of your deployed QuickPayRegistry. Leave unset until a real deployment exists
- `VITE_QUICKPAY_ROUTER_ADDRESS` Address of your deployed QuickPayRouter. When set and confirmed on Arc, sends go through it (the explorer shows the FlowPay contract); otherwise sends are plain USDC transfers
- `VITE_WALLETCONNECT_PROJECT_ID` Optional, enables WalletConnect

### Scripts

- `bun run dev` start the frontend
- `bun run server` start the backend
- `bun run check` lint and typecheck
- `bun run typecheck:server` typecheck the backend
- `bun run test` unit tests
- `bun run test:render` renders every screen in a DOM
- `bun run test:smoke` live checks against a running backend (uses the real Arc RPC and Across API)
- `bun run backend:url https://your-backend` points the production `/api/*` at your hosted backend (see `docs/history-deployment.md`)
- `bun run contracts:build`, `bun run contracts:test` build and test the contract
- `bun run contracts:abi` export the contract ABI to the frontend

### Build

```bash
bunx vite build
```

Serve `dist/` with a host that rewrites unknown paths to `index.html`, and run the backend separately with the same `/api` path routed to it.

## Hosting the backend (permanent history)

Without a backend, History, Activity and the totals are read straight from Arc by the browser: newest first, with a local cache on that device. The public Arc RPC rate-limits, so scanning back through the whole chain from a browser takes hours, and each new device repeats it. A backend with a persistent PostgreSQL database stores the history once for every device and is much faster. A `Dockerfile` for the backend is included. Setup steps, environment variables and checks are in `docs/history-deployment.md`.

## Contract deployment

`contracts/QuickPayRegistry.sol` is a non-custodial payment request registry. Deploy it yourself from a keystore or hardware wallet (never a raw private key):

```bash
export USDC=<official USDC address on Arc>
export REGISTRY_OWNER=<pause-rights address, ideally a multisig>
forge script contracts/script/DeployQuickPayRegistry.s.sol --rpc-url <Arc RPC> --account <keystore> --sender <deployer> --broadcast
```

To route ordinary sends through the FlowPay contract, deploy `contracts/FlowPayRouter.sol` the same way with `contracts/script/DeployQuickPayRouter.s.sol` (set `USDC` and `ROUTER_OWNER`), then set `VITE_QUICKPAY_ROUTER_ADDRESS`.

Then set `VITE_QUICKPAY_REGISTRY_ADDRESS` and restart the frontend. The Smart Contracts page marks it deployed only after reading it from the chain and checking it uses the official USDC.
