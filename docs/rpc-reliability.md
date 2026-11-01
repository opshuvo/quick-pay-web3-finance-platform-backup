# Arc RPC reliability (History and Activity)

Chain: Arc Mainnet, chain ID 5042, official RPC `https://rpc.mainnet.arc.io` (from the existing chain facts). No other provider was added.

## Root cause

On a deployment without the Quick Pay backend (such as the Vercel build), History, Analytics and Activity are read by the browser straight from the Arc RPC with `eth_getLogs`. Measured against the live node on 2026-11-01:

| Behaviour | Measured |
|-----------|----------|
| Chain ID, `eth_blockNumber`, blocks, receipts | Fine, fast (30 to 60 ms), not limited at the rate that matters |
| `eth_getLogs` block range | Accepted up to about 5,000 blocks. Larger ranges can be refused with JSON-RPC `-32012 requested range too large` (the answer comes with HTTP 200) |
| `eth_getLogs` rate | Limited. The node answers HTTP 429 or JSON-RPC `-32005 rate limit exceeded` after a short burst (as few as 3 to 8 calls) and again within about a minute of sustained use. No `Retry-After` header. A batch of requests is counted per item, and each item can fail separately with HTTP 200 |
| CORS | Fine, including on 429 answers |

The history reader paced its log calls at about 4.5 per second, which is above what the node tolerates, and then made things worse:

1. The HTTP client retried each 429 by itself on top of the app's own retries, so one rate limit turned into several more requests while the node was already pushing back.
2. After a rate limit the reader waited and retried, but kept the same speed, so it kept hitting the limit. In a live run it stalled after about 40 seconds with 40 rate-limited answers and no error shown for tens of seconds.
3. The head-block read waited in the same queue as the log reads, so a first visit could fail with "Could not read Arc right now" after 3 seconds even though the node was healthy.
4. Several screens (History, Analytics, Activity) triggered the same transaction checks at the same time, and one transaction that kept failing sat at the front of the queue and held back all the others.
5. Registry event scans started with a 10,000 block range (always refused) and treated a rate limit as "range too large", halving the range and sending even more requests.
6. Errors said "The history service is not reachable" although the service in question was the Arc RPC, and failed reads were not retried automatically.

## Fix

- `src/lib/arcRpc.ts`: one shared, paced lane for `eth_getLogs` and a lighter lane for everything else. The lane retries rate limits, timeouts and network errors with exponential backoff and jitter, shares one pause between all callers, slows down when the node pushes back (up to 3 seconds between calls) and speeds up again after a run of successes. A refused range is never retried, it is split. Identical in-flight requests share one call.
- The history reader uses these lanes, no longer lets the HTTP client retry on its own, splits a refused range in halves (and remembers the smaller size), shares one tip sync and one verification run between screens, verifies each transaction at most once at a time, and gives a transaction that keeps failing its own backoff so it cannot block the rest.
- The registry event scans use the same log lane, start at 5,000 blocks, and only split a range when the node actually refuses it.
- Accurate states: a rate limit or an unreachable node is shown right away as a plain note ("The Arc RPC is rate limiting requests. Slowing down and retrying.") and cleared as soon as a call succeeds. A first visit waits up to 8 seconds for the first block. History, Analytics and Activity each retry twice with 1, 2, 4 second backoff and then every 10 seconds on their own, and each screen only depends on its own read, so one failing never blocks another or the rest of the app. The error text now says the Arc RPC is the problem when it is.
- Server indexer: the default gap between RPC calls is 300 ms instead of 150 ms (`INDEXER_MIN_INTERVAL_MS` still overrides it).
- Nothing about transactions, contracts, wallet configuration or displayed data changed. Every row still comes from a real log or receipt.

## Verified against the live node

- Chain ID 5042 and head block read from `https://rpc.mainnet.arc.io`.
- Overview-style first load (History, Analytics and Activity at the same moment): one `eth_blockNumber` call in total for the three, and an honest "indexing" state in 71 ms.
- A 120 second live run of the reader kept making progress through rate limits (8 rate-limited answers in total, versus 40 and a stall in the old reader), and showed and then cleared the rate-limit note.
- A 20,000 block request was split and returned the wallet's 11 real logs.
- Unit tests (`tests/arcRpc.test.ts`) cover error classification of the real responses, backoff, pacing, shared pause, range splitting, deduplication and the failing-transaction case.

## What this cannot fix

The public node allows only about 5,000 blocks per log request and a limited request rate, and a wallet needs two log requests per range. Reading a wallet's whole history from block 0 in a browser therefore takes hours. Recent activity appears first and the page says history is still syncing. For complete history quickly, run the Quick Pay backend with a database (`docs/history-deployment.md`) and, if you have one, a keyed RPC.

## Preview vs Production history mismatch (10 vs 1)

Wallet checked: `0x26Eff17ACB6932F197ADbc1aA493b9BF64C04968`.

Compared, with the live services:

| Item | Preview | Production | Same? |
|------|---------|------------|-------|
| `/api/health` | Local backend answers, `database: unconfigured` | `/api/*` falls through to `index.html` (no backend) | Both make the app read Arc directly in the browser |
| History source | Browser reads `eth_getLogs` from `https://rpc.mainnet.arc.io` (chain 5042) | Same | Yes |
| Pagination and filters | Page 1, 25 per page, no filters | Same | Yes |
| Environment variables | none set | none set | Yes |

So no API, filter, pagination or environment difference exists. The list is whatever the browser has scanned so far, and the scan starts at the newest block and walks backwards. Ground truth for this wallet (scanned from the head back to block 28,415,871): exactly 10 USDC transfers, all between blocks 28,818,777 and 28,950,057. Preview had been scanning for about 17 minutes and had covered blocks 26.77M and up, so it showed all 10. A fresh Production browser starts from nothing and had only reached the newest one (block 28,950,057).

Why Production stayed at 1 for so long: after a burst of rate limits the log lane kept a long gap between calls and only shortened it after many successes, and every History poll also spent two log calls following the chain tip. Together that left the backwards scan crawling (a cold-start simulation of the History page needed more than 100 seconds to still show 1 transaction).

Fix: the gap now shrinks by 15% on every success (back to normal within about a dozen calls), and the tip is followed at most every 10 seconds unless the gap is large, so the rate-limited call budget goes to older history. Cold-start simulation of the same History code against the live RPC now shows 1, 1, 1, 1, 2, 7, 10 transactions and reaches the same 10 hashes in 28 to 31 seconds.

## Dashboard showing 1 of 10 on a phone (history relay)

A phone showed "Total sent 0.01, 1 payment, Transactions 1, History is still syncing" for a wallet that has 10 verified transfers. Cause: with no backend, every new device scans Arc from the newest block backwards through the public RPC (two rate-limited log reads per 5,000 blocks), and the scan only runs while the page is open. This wallet's 10 transfers sit about 60,000 to 190,000 blocks back, so a phone that has not finished the scan shows only the newest one. The Preview had simply scanned for longer.

Fix: `public/api/arc-logs.js`, a Vercel serverless function, reads the wallet's logs for a fixed 10,000-block window from the same official RPC and returns them with the block times. A finished window never changes, so it is cached for a year at the CDN and in the browser. The first reader pays the RPC calls; every later reader, on any device, gets it in about 60 to 170 ms with no RPC call and no rate limit. The app checks each answer (right wallet, inside the window, real Transfer logs, a block time for every row) and falls back to reading the RPC directly when the relay is missing (local preview), busy, or the window reaches the chain tip.

Measured on the live site against the real engine, from an empty cache: all 10 transfers (9 sent, 1 received, same hashes as the ground truth scan) after 19 s when the windows were not cached yet, and after 2.9 s when they were. Before: 1 transfer after more than 60 s.
