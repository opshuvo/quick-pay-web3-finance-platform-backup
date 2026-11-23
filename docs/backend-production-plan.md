# Quick Pay backend: production readiness audit and implementation plan

Scope: Payment Requests, Split Payments, permanent transaction history, Swap history, Bridge history.
Basis: a read-through of `server/`, `shared/`, the database schema, the deploy scripts and the client code that calls them, plus the live checks run earlier in this project (API smoke test, history live test, real Arc Mainnet reads). Nothing was changed for this audit.

Estimates are engineer-days for one engineer who knows the codebase, excluding waiting on third parties. "S" is under a day, "M" is 1 to 3 days, "L" is 3 to 8 days.

---

## 1. What exists today (inventory)

**Runtime.** One Bun process (`server/index.ts`) serves the API and also runs the background loops: the wallet indexer, the Router/Registry event indexer, the pending-transaction reconciler and the swap-verification queue. Postgres is the only datastore. The frontend is a static Vercel build that reaches the backend only through a rewrite (`bun run backend:url`), so browser calls are same-origin and CORS is not needed.

**API surface (no versioning, no `/api` prefix on the server).**

| Area | Endpoints | Auth |
|---|---|---|
| Health | `GET /health` | none |
| History | `POST /index/:address`, `GET /history/:address` (cursor, CSV), `GET /analytics/:address`, `POST /pending` | none (pending verifies the sender on-chain) |
| Payment requests | `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/cancel`, `POST /requests/:id/verify` | wallet signature for create, list, cancel; none for read-by-id and verify |
| Swap and bridge | `GET /activity/:address`, `POST /activity/swap`, `POST /activity/bridge`, `POST /activity/bridge/refresh` | none (every record is read back from the chain) |
| Provider proxies | `/across/*`, `/lifi/*`, `/uniswap/*` | none, per-IP limits |

**Tables.** `wallets`, `transfers` (unique on chain, tx hash, log index), `payment_requests` (unique `paid_tx_hash`), `defi_activity` (unique on source tx), `tx_meta`, `tx_queue`, `pending_txs`, `contract_events`, `indexer_cursors`. DDL runs as idempotent `create ... if not exists` statements at boot.

**Good foundations worth keeping.** Parameterised SQL throughout. Body size limits. Strict input parsing. Payment settlement is proven from the receipt and the USDC `Transfer` log, never from the client's claim. Duplicate prevention is enforced by database constraints. Reads never wait on the RPC and survive an RPC outage. The RPC layer has spacing, back-off with jitter and range shrinking.

---

## 2. Findings by area

### 2.1 Cross-cutting (affects everything)

| # | Finding | Why it matters | Severity |
|---|---|---|---|
| X1 | Rate limits key on the socket IP (`srv.requestIP`). Behind any proxy or platform router every user shares the proxy's address. | One shared bucket of 240 requests per minute for the whole site; one busy user rate-limits everyone. | Blocker |
| X2 | Everything is single-process state: rate-limit buckets, the signature cache and the indexer loops run in every instance. | Two instances double-scan the chain, race on cursors and give inconsistent limits. | Blocker for more than one instance |
| X3 | Schema changes are inline idempotent DDL at boot. No version table, no lock, no down path. | Concurrent boots can race; destructive changes cannot be reviewed or rolled back. | High |
| X4 | No backup, point-in-time recovery, retention or restore drill is defined. | A lost database means lost request history that cannot be rebuilt from the chain. | Blocker |
| X5 | `POST /index/:address` is unauthenticated and each new wallet queues a scan back to block 0. Only a cap of 100 pending wallets protects it. | Anyone can fill the queue with arbitrary addresses and starve real users. | High |
| X6 | Sign-in is a bare signed message: no domain or URI, a nonce the server never tracks, no revocation, EOA signatures only. | Another site can ask for the same signature and replay it for up to 12 hours. Smart-contract wallets (including Circle modular wallets) cannot sign in. | High |
| X7 | No graceful shutdown (no SIGTERM handler), no container health check, no readiness versus liveness split. | Deploys can cut a scan or a DB write mid-flight. | Medium |
| X8 | Observability is `console.log`. No structured logs, request IDs, metrics, alerts or error tracking. | Indexer lag, queue depth and RPC failures would go unnoticed. | High |
| X9 | One Arc RPC endpoint. The fallback is the public RPC, which allows roughly 4 `eth_getLogs` per second. | A provider outage stops all indexing; the fallback cannot keep up. | High |
| X10 | The database connection has no explicit pool size, statement timeout, TLS requirement or least-privilege role (one role does migrations and serves traffic). | A slow query or a compromised service has full database rights. | Medium |
| X11 | No CI. 7 existing unit tests fail (the transaction-ledger and History merge tests), so they cannot gate merges. Live tests need a database and the real RPC. | Regressions in payment logic would ship unnoticed. | High |
| X12 | API responses carry `nosniff` and `no-referrer` only. No HSTS, no request-ID header, no audit trail for state changes. | Missing baseline hardening and no forensic record. | Medium |
| X13 | `public/api/lifi.js` and `public/api/arc-logs.js` are older serverless copies of logic that also lives in `server/`. | Two implementations drift; the deploy tool already strips them. | Low |

### 2.2 Payment Requests

| # | Finding | Impact |
|---|---|---|
| R1 | Settlement matches any USDC transfer to the recipient for at least the amount, mined after creation and before expiry. Nothing ties the payment to the request: not the payer, not a reference. Two open requests for the same amount to the same recipient can be settled by one unrelated payment. | Wrong request marked paid. Highest-value correctness fix. |
| R2 | A request becomes paid only when someone calls `verify` (normally the payer's browser). If the payer closes the tab, it stays unpaid indefinitely although the money arrived. | Recipients see "unpaid" for paid requests. |
| R3 | The Router already emits a `reference` in `PaymentSent` and the event indexer already stores it, but requests never use it. | The binding mechanism exists and is unused. |
| R4 | Expiry is computed lazily on read. There is no sweeper, no notification when a request is paid, expires or is cancelled, and no webhook. | Recipients must poll. |
| R5 | `GET /requests` returns the latest 200 with no cursor, filters or export. Creation has no idempotency key; a retry creates a duplicate. | Breaks for active recipients; duplicate requests on flaky networks. |
| R6 | Over-payment is accepted silently; under-payment is rejected with a generic message. No partial-payment handling or refund path. | Unclear behaviour for edge cases. |
| R7 | No audit table (who changed status, from where). No `updated_at`. No data-deletion path. | Hard to investigate disputes; compliance gap. |
| R8 | Create and verify limits live in process memory only. | Limits reset on restart and differ per instance. |

### 2.3 Split Payments

| # | Finding | Impact |
|---|---|---|
| S1 | A split exists only in the organizer's browser (`localStorage`). The server knows N unrelated requests whose descriptions begin "Split:". | Losing the device or clearing storage loses the grouping, names and totals. No other device or person can see the split. |
| S2 | Creation is a client loop of N separately signed calls. A failure part-way leaves orphan requests and a half-built split. | Partial splits with no server-side repair. |
| S3 | The server does not check that shares add up to the total (the client does). | Data integrity depends on the client. |
| S4 | No participant view, shared link per split, reminders or aggregate status computed server-side. | Cannot answer "who still owes?" across devices. |
| S5 | Inherits every request issue above (R1 to R8). | Same settlement ambiguity. |

### 2.4 Permanent transaction history

| # | Finding | Impact |
|---|---|---|
| H1 | Each registered wallet is backfilled separately from the tip down to block 0. At about 32 million blocks, 5,000 per call and 300 ms spacing, one wallet needs roughly 6,400 calls, around 30 minutes, and every wallet shares one RPC gate. | New users wait; 100 queued wallets means a day or more. This is the main scalability limit. |
| H2 | Only USDC `Transfer` logs are indexed. Reverted transactions emit no logs, so a failed transaction appears only if this app sent it (via `/pending`). Non-USDC transactions are not listed. | "All transactions" is really "all USDC movements plus app-sent records". |
| H3 | Follow lag is a fixed 40 blocks and rows do not store the block hash. | No reorg detection. Arc's finality rules should drive this value; confirm them from Arc's documentation before finalising. |
| H4 | Performance was verified on about 30 rows. Index use was checked with `EXPLAIN` on a tiny table only. | Unproven at 1M or more rows. |
| H5 | The CSV export is capped at 50,000 rows but builds in memory, with a 10 per minute limit per IP. | A single large export can spike memory. |
| H6 | The pending reconciler and contract-event indexer are unlocked loops. | Duplicated by every instance (see X2). |

### 2.5 Swap history

| # | Finding | Impact |
|---|---|---|
| W1 | Detection is limited to transactions sent to the Uniswap Universal Router. Swaps through other routers, aggregators or smart wallets are not recognised. | History misses legitimate swaps. |
| W2 | Failed swaps are deliberately not recorded. | Users see no trace of a failed attempt. |
| W3 | `GET /activity/:address` returns up to 100 rows with no cursor, and is a separate feed from transfers. | No single chronological list; no export. |
| W4 | Prices, slippage and fees are limited to what the receipt shows. | Limited detail for tax or accounting use. |

### 2.6 Bridge history

| # | Finding | Impact |
|---|---|---|
| B1 | Only Across bridges are recorded and verified server-side. LI.FI and Circle (CCTP) bridges are tracked only in the browser (`bridgeStore`, `localStorage`). | They vanish on a new device and never reach History, Analytics or CSV. |
| B2 | Destination-chain RPCs come from Across's public `/swap/chains` list, cached for 10 minutes. | Public RPCs are unreliable; if that API is down, no destination can be verified. |
| B3 | Circle bridge verification (attestation and destination mint) exists only in the browser. | Server cannot confirm completion for Circle transfers. |
| B4 | Timeouts, expiry and refund transitions exist in the schema but there is no sweeper that moves stuck transfers to a final state. | Transfers can stay "pending" forever. |

### 2.7 Arc Mainnet integration

- Chain id 5042, the USDC address and the explorer base come from one facts file and are used consistently. Good.
- Native gas is USDC with 18 decimals while the ERC-20 view has 6. The backend only reads ERC-20 `Transfer` logs, so there is no double counting. Keep it that way.
- No fallback provider, no health-based failover, no WebSocket or head subscription (the tip is polled).
- Finality semantics are not encoded beyond the fixed lag in H3.

---

## 3. Prioritised implementation plan

Each phase ships on its own and leaves the app working. Phase 0 and 1 are launch blockers; the rest follow the order of user risk.

### Phase 0: go-live basics (2 to 3 days total)

| Task | Complexity |
|---|---|
| Choose and provision: always-on container host, managed Postgres with PITR, dedicated Arc RPC plus a second provider | S (decisions) |
| Trust the platform's forwarded-for header only from the known proxy; key limits on that client IP (X1) | S |
| Graceful shutdown, container health check, liveness versus readiness (X7) | S |
| Database role split (migrator versus app), TLS, pool size, `statement_timeout` (X10) | S |
| Backups, retention and a documented restore drill (X4) | S |
| Point `public/vercel.json` at the backend with `bun run backend:url`; verify `/api/health` shows `database: ok` and the RPC reachable | S |
| Fix or quarantine the 7 failing ledger/History unit tests so CI can gate (X11) | M |

### Phase 1: hardening (6 to 9 days)

| Task | Complexity |
|---|---|
| Versioned migrations with a lock, run as a separate release step (X3) | M |
| Split web and worker roles; take a Postgres advisory lock so exactly one worker runs the indexer loops (X2, H6) | M |
| Shared rate limiting in Postgres or Redis (X2, R8) | M |
| Sign-in on EIP-4361 (SIWE): domain and URI, server-issued single-use nonce, 1271/6492 for smart-contract wallets, logout and revocation (X6) | L |
| Gate `POST /index/:address` behind sign-in or a signed proof, with per-wallet quotas (X5) | M |
| Structured logs with request IDs, metrics (indexer lag per wallet, queue depth, RPC error rate), alerts, error tracking (X8, X12) | M |
| CI: lint, typecheck, unit tests, ephemeral-Postgres integration tests (X11) | M |

### Phase 2: Payment Requests (5 to 8 days)

| Task | Complexity |
|---|---|
| Bind payments to requests through the Router `reference` (request id hash). The indexer already stores it. Auto-settle when a matching `PaymentSent` is found, still proven from the receipt (R1, R3) | M |
| Background reconciler for plain transfers: for each unpaid request, look at indexed incoming transfers; settle only on an unambiguous match, otherwise leave it for manual verify (R2) | M |
| Idempotency keys on create; cursor pagination, filters and CSV for lists (R5) | S |
| Expiry sweeper, status audit table, `updated_at` (R4, R7) | S |
| Notifications: webhook and optional email for paid, expired, cancelled (R4) | M |
| Policy for over- and under-payment and refunds, written down and enforced (R6) | M (needs a decision) |

### Phase 3: Split Payments (5 to 8 days)

| Task | Complexity |
|---|---|
| `splits` and `split_participants` tables, `split_id` on requests (S1) | S |
| Single atomic create endpoint (one signature, all-or-nothing, server checks shares equal total) (S2, S3) | M |
| Aggregated status, participant link per share, reminders (S4) | M |
| Migrate existing browser splits into the server on first sign-in (one-time, opt-in) | M |

### Phase 4: history at scale (6 to 10 days)

| Task | Complexity |
|---|---|
| Replace per-wallet backfill with one pass over the chain that filters for all registered wallets, or a hosted indexer API for backfill. Check whether Arc's explorer exposes a token-transfer API before building (H1) | L |
| Store block hashes and add a reorg check, using Arc's documented finality for the lag (H3) | M |
| Capture transaction-level records (including failures) for registered wallets (H2) | L |
| Stream the CSV export in chunks (H5) | S |
| Load test at 1M or more rows and 100 or more concurrent wallets; review `EXPLAIN` plans (H4) | M |

### Phase 5: Swap and Bridge history (6 to 10 days)

| Task | Complexity |
|---|---|
| One `bridge_transfers` model (provider, chains, hashes, status machine). Server tracking for LI.FI (status API) and Circle (attestation, destination mint verified on-chain) alongside Across (B1, B3) | L |
| Configured RPC per supported chain with fallbacks instead of Across's public list (B2) | M |
| Stuck-transfer sweeper and refund or expiry transitions (B4) | M |
| Recognise additional swap routers; optionally record failed swaps as failed attempts (W1, W2) | M |
| Unified activity feed (transfers, swaps, bridges) with cursor pagination and export (W3) | M |

### Phase 6: launch assurance (3 to 5 days)

Staging environment mirroring production. Chaos tests (RPC down, database failover, restart mid-scan). Runbook and on-call alerts. An independent security review of the sign-in and settlement code paths before real funds depend on them.

**Rough total: 28 to 45 engineer-days**, of which Phases 0 and 1 (about 8 to 12 days) are required before any public launch.

---

## 4. Required infrastructure

| Need | Notes |
|---|---|
| Always-on backend host | Not serverless: the indexer is a background loop. Any container host works (Fly.io, Railway, Render, a VM, Kubernetes). Two roles later: web and worker. |
| Managed PostgreSQL | Version 15 or newer, automatic backups with point-in-time recovery, TLS, a read replica later if reads grow. |
| Dedicated Arc Mainnet RPC plus a second provider | For indexing throughput and failover. |
| RPCs for the other bridge chains | Needed for destination verification (Phase 5). |
| Secrets store | `DATABASE_URL`, RPC URLs, provider API keys. Never `VITE_` variables. |
| Edge or CDN | Vercel already fronts the static site and rewrites `/api/*`. Add HSTS and a WAF or rate-limit rule at the edge. |
| Logging, metrics and alerting | Any hosted stack. Redact RPC tokens in URLs. |
| CI | GitHub Actions or equivalent with an ephemeral Postgres service. |
| Optional: Redis | Only if shared rate limits or queues outgrow Postgres. |

---

## 5. Deployment steps (staging first, then production)

1. Create a staging project: Postgres, backend container, Arc RPC key. Set `DATABASE_URL`, `ARC_RPC_URL` and, if used, `ACROSS_API_KEY` and `UNISWAP_API_KEY` as secrets. The addresses already in the app (`VITE_QUICKPAY_REGISTRY_ADDRESS`, `VITE_QUICKPAY_ROUTER_ADDRESS`, `VITE_QUICKPAY_REGISTRY_FROM_BLOCK`) are also read by the backend.
2. Run migrations as a release step, then start one web instance and one worker.
3. Check `/health`: `database: ok`, `rpc: ok`, indexer progress moving.
4. Run `bun run test:smoke` and `bun run test:history-live` against staging.
5. Point `public/vercel.json` at staging (`bun run backend:url <url>`), build and deploy a preview.
6. Soak test for a day: watch lag, queue depth and error rates; run the chaos checks from Phase 6.
7. Repeat for production, then switch the site's rewrite and deploy. Keep the previous deploy ready to roll back.
8. Confirm a backup restore into a scratch database before announcing launch.

---

## 6. Decisions needed from you

1. Hosting and database providers, and the monthly budget for the indexer RPC.
2. Whether smart-contract wallets must be able to sign in at launch (affects the sign-in work).
3. Payment-request policy: over-payment, under-payment, refunds.
4. Notification channels: webhook only, or email as well.
5. Retention and deletion policy for requests and history.
6. Whether history must include failed and non-USDC transactions for all wallets or only app-sent ones.
7. Which bridge providers must be tracked server-side at launch (Across only, or LI.FI and Circle too).

---

## 7. Risks to call out

- Settlement ambiguity (R1) is the one finding that can mark the wrong request paid. Fix it before promoting requests or splits to real users.
- The 7 failing unit tests are in History and ledger logic. They need an owner decision (fix or rewrite) before CI can protect those paths.
- The history scale work (H1) changes how data is collected for every wallet. Plan it with a backfill and a comparison against the current data before switching.
- This is real USDC on Arc Mainnet. Anything touching settlement or sign-in should be independently reviewed before launch.
