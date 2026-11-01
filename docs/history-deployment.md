# Permanent wallet history: production setup

## Why History and Activity show "unavailable" on the live site

The live site is a static build on Vercel. Wallet history is not computed in the browser. It needs the Quick Pay backend (`server/`, a Bun process with an indexer) and a PostgreSQL database. Neither is part of a static deployment, so `/api/*` on the live site falls through to `index.html` and the app reports "backend not connected". Nothing was lost: the transactions are on Arc, and the indexer rebuilds history from the chain.

## Without a backend (what the live site does today)

When `/api/health` does not return JSON with `database: ok`, the app reads Arc directly in the browser. It scans USDC Transfer logs for the connected wallet newest first (5,000-block ranges, the largest the public RPC accepts), reads the receipt behind each outgoing or swap/bridge-related transfer, and shows swaps (from the receipt's real token movements), USDC transfers, and bridge deposits. A progress notice states how much of the chain has been scanned, and "complete" appears only after block 0 is reached. Measured limits: the public RPC allows roughly one or two requests per second per client, so a full scan from block 0 takes hours (recent activity appears within seconds). Progress is cached in that browser's local storage as a speed-up only; another device or a cleared browser scans again. Bridge deposits are shown as "Deposit confirmed on Arc": the destination chain is not checked in this mode.

## What is already built (and was verified against the real Arc RPC)

- One row per USDC `Transfer` log involving the wallet, sent and received, stored in PostgreSQL with chain id (5042), tx hash, log index, block number, block time, sender, recipient, token and amount. A unique key on `(chain_id, tx_hash, log_index)` prevents duplicates. Registry and router payments are ordinary USDC transfers, so they are included.
- Rows come only from real `Transfer` logs. A reverted transaction emits no logs, so failed or reverted transactions never become records. Pending transactions are shown by the app until they confirm, then history refreshes.
- Each wallet has a stored cursor (`newest_scanned`, `oldest_scanned`). The indexer scans forward from the tip and backfills toward block 0. The cursor moves only after a chunk was fetched and stored, so a restart or RPC error resumes without gaps. Rate limits back off and shrink the block range automatically.
- A wallet's history is only labelled complete after the backfill reaches block 0. Until then the app shows how much of the chain is covered.
- Swaps are discovered and saved by the server, not the browser. Each transaction the wallet sent (or received directly from a Uniswap or Across contract) is queued in PostgreSQL, its receipt is read from Arc, and a successful transaction sent by the wallet to the Uniswap Universal Router is saved with its real token legs, symbols, decimals and amounts. This covers swaps made before the fix, swaps made with the browser closed, and swaps in tokens other than USDC. The queue survives restarts and retries with backoff. `/health` reports `verification.pending` and `verification.failing`.
- Bridges that Quick Pay recorded are verified against Across and the destination chain. Older bridges appear as USDC legs labelled from the verified transaction target (the Across contract). Swap and bridge legs that never touched USDC for that wallet are not discovered.
- Reads are scoped by chain id 5042 and wallet address. A wallet never sees rows that do not involve it.

## What you must provide

1. A persistent PostgreSQL database (Neon, Supabase, Railway, or any managed Postgres). Copy its connection string as `DATABASE_URL`. Use the pooled or direct URL with `?sslmode=require` if the provider needs TLS.
2. A host that keeps the backend running 24/7 (not serverless, because the indexer is a background loop). Any Docker host works: Hugging Face Docker Space, Fly.io, Railway, Render. Use the `Dockerfile` in the repo root. Free tiers that sleep will pause the indexer.
3. A reliable Arc RPC. The public RPC works but rate limits. Set `ARC_RPC_URL` to a dedicated provider endpoint for faster backfills.

## Environment variables for the backend

- `DATABASE_URL` (required) PostgreSQL connection string
- `ARC_RPC_URL` (recommended) dedicated Arc Mainnet RPC
- `PORT` (default 3001; set to your host's port if it requires one)
- `UNISWAP_API_KEY`, `ACROSS_API_KEY`, `ACROSS_INTEGRATOR_ID` (optional)
- `INDEXER_RANGE`, `INDEXER_RANGE_CEILING`, `INDEXER_MIN_INTERVAL_MS`, `INDEXER_MAX_PENDING_WALLETS` (optional tuning)

The frontend needs no new variables. Keep `VITE_QUICKPAY_ROUTER_ADDRESS` as it is.

## Setup steps

1. Create the database and copy `DATABASE_URL`.
2. Deploy the backend from this repo using the `Dockerfile`, with `DATABASE_URL` (and `ARC_RPC_URL`) as secrets. Tables are created automatically on first start. Nothing is deleted on restart or redeploy.
3. Check it: open `https://<backend>/health`. You want `"database":"ok"` and `"rpc":"ok"`.
4. Point the site at it and rebuild:
   ```bash
   bun run backend:url https://<backend>
   bunx vite build
   ```
   This adds one rewrite to `public/vercel.json` so `/api/*` on the live site is forwarded to the backend. Then redeploy `dist/` to Vercel.
5. Check the live site: open `https://<site>/api/health`. It must return JSON with `"database":"ok"`, not the app's HTML.
6. Connect a wallet. The first visit registers it and the backfill starts. Expect roughly one hour for a full scan from block 0 on the public RPC (about 10,000 blocks per second measured on Arc; Arc was at about 28.85 million blocks when measured). Recent activity appears within seconds.
7. Check persistence: redeploy the backend and reconnect. The same rows and the same cursor must still be there.

## Limits to know

- The Arc explorer sits behind a bot challenge, so it cannot be used as a server-side data source. Block-range log scanning over RPC is the source of truth. If you need faster backfills, use a dedicated RPC or an indexing provider that supports Arc, and keep the per-wallet cursor.
- Arc finalizes blocks deterministically, so deep reorganizations are not expected. The indexer still trails the tip by a small margin.
