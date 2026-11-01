# Performance report

Measured on this project's production build (`bunx vite build`, then `bun run perf:report [dir]`). Sizes are real file sizes. Download times are computed from the compressed size at a stated link speed; they are not measurements on a network. No real browser or phone was available, so first paint, interactive time, wallet connection time and Android behaviour were not measured.

## First visit (what must download before the app can start)

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Initial JavaScript, raw | 1,604.3 KB | 693.2 KB | -56.8% |
| Initial JavaScript, gzip | 504.9 KB | 217.8 KB | -56.9% |
| Initial CSS, gzip | 6.8 KB | 6.8 KB | none |
| Initial requests (JS + CSS) | 2 | 2 | none |
| Computed download at 1.6 Mbps (slow 3G) | 2.62 s | 1.15 s | -56% |
| Computed download at 10 Mbps | 0.42 s | 0.18 s | -57% |
| Render-blocking third-party stylesheet (fonts) | 1 | 0 | fonts load after first paint |

## Screens that load on navigation (raw JS)

| Screen | Before | After |
| --- | --- | --- |
| Scan & Pay | 134.7 KB | 7.7 KB (the QR decoder, 130.7 KB, loads when the camera starts) |
| Swap | 60.0 KB | 60.1 KB |
| Bridge | 23.3 KB | 23.4 KB |
| Overview | 11.3 KB | 11.3 KB |

Total JavaScript in the build is about the same (3,939.6 KB before, 3,909.6 KB after). The work was moved off the critical path, not deleted.

## What was slow

- **ConnectKit (the wallet picker) and its dependencies were in the first download** even though nobody sees the picker until they tap Connect. By source size it, its animation library, an account-abstraction package, the QR library and styled-components made up about 45% of the first download.
- Its button also looked up an ENS name on Ethereum mainnet on every page. The name was never displayed, so that request was pure overhead.
- The sheet animation library (framer-motion) was loaded in full for one fade/slide.
- The QR decoder (jsQR, 131 KB) was part of the Scan screen even when only opening the page.
- Google Fonts CSS blocked the first paint.

## What changed

- `src/components/WalletButton.tsx`: a small button that responds at once. It reads the connected wallet from wagmi and asks for the picker.
- `src/components/WalletModalHost.tsx`, `src/components/WalletModalMount.tsx`, `src/lib/walletModal.ts`: the picker loads when the browser is idle, on the first touch or key press, or immediately when a wallet button is tapped (the tap opens the picker as soon as it is ready). On data saver or 2G it loads only on tap. `src/main.tsx` no longer imports ConnectKit.
- `src/components/ConfirmSheet.tsx`, `src/lib/motionFeatures.ts`: same animation, with the animation features loaded on first use.
- `src/hooks/useQrScanner.ts`: the QR decoder loads when scanning starts, in parallel with the camera permission prompt.
- `src/routes.ts`, `src/App.tsx`, `src/components/AppShell.tsx`: pointing at, touching or focusing a navigation link starts loading that screen's code (skipped on data saver / 2G).
- `index.html`: fonts no longer block the first paint (text uses the system font until they arrive).
- `src/hooks/useSwapQuote.ts`: an outdated Swap quote request is cancelled when the amount or token changes, and does not trigger a second fallback quote.
- `src/lib/chainHistory/mode.ts`, `src/hooks/useHealth.ts`: one shared `/health` request instead of two.
- `src/lib/chainHistory/engine.ts`: the chain head is reused for 2 seconds.
- `scripts/perf-report.ts`, `bun run perf:report`: repeatable measurement.

## Measured, with no meaningful gain

- Chain-head reuse in the in-browser history reader: a 30-second dashboard simulation made 5 `eth_blockNumber` requests before and 4 after. Concurrent screens already shared one scan, so this change is small and should not be counted as a speed-up.
- Screen render time in a simulated DOM (not a browser; the first test includes module warm-up): Overview 423.7 ms before, 111.7 to 210.9 ms after in two runs; the other screens were within noise (for example Swap 119.5 ms before, 134.2 ms after).

## Not changed

- Polling intervals for balances (15 s), token list (20 s), quotes (15 s), health (30 s), history and activity. Balances are still read live and never cached as confirmed.
- Transaction signing, confirmation sheets, duplicate-submission guards and receipt checks.
- Contracts, addresses and chain configuration.
- Backdrop blur on the header and bottom navigation (a known cost on some Android phones). Removing it would change the look, so it was left.

## Not available in this app

- There is no AI Assistant and no separate Assets page in this codebase. Nothing was added or removed. The Assets view is covered by the USDC balance, Payments and Profile screens.

## Needs a real device

First paint and interactive time, wallet connect on a phone, QR camera scanning on Android after the decoder became lazy, and scrolling smoothness. Run the live site on a phone and check Connect, Scan and Swap.

## Round 2: mobile smoothness (main thread and paint)

No real phone or browser was available, so the numbers below are measured CPU time of the real code on large synthetic histories (a desktop CPU; a phone is several times slower), and counted re-renders. Download size is unchanged apart from about 5 KB for the Arc RPC lanes added earlier (initial JavaScript 698.5 KB raw, 219.9 KB gzip).

| Bottleneck | Before | After |
| --- | --- | --- |
| Deriving History, Overview, notification bell, Analytics and Activity from one snapshot, 10,000 transfers (one poll tick) | 180 ms | 17.8 ms the first time a snapshot changes, 0.7 ms on every poll after that |
| Same, 3,000 transfers | 20.9 ms | 6.9 ms, then 0.3 ms |
| Swap and Bridge pages | re-rendered the whole page every second, even with no quote | re-render once a second only while a quote countdown is on screen |
| Notification bell (on every screen) | read history every 4 to 6 seconds while indexing | every 20 seconds |
| History, Analytics, Activity answers for a wallet already known | waited up to 3 s for the chain sync | answer at once (at most 0.8 s), the sync continues in the background (idle polls measured at 0 to 1 ms) |
| Bridge form | waited for the Across network list before showing its choices | shows the last list at once and refreshes it behind |
| Receive QR | redrawn (464 px canvas) on every key press while typing an amount | redrawn 250 ms after typing stops |
| Send review sheet | Quick Pay contract check started only when the sheet opened | starts when Send opens |
| Bottom-bar screens | fetched one after another while idle (Bridge was fifth) | all five fetched together right after first paint |
| Cards, header, bottom bar, sheet backdrop on phones | live backdrop blur on every card and bar (repainted each scroll frame) | no blur below 1024 px (slightly more opaque bars); desktop unchanged |
| Profile avatar | parsed storage on every render | parsed once |
| History cache writes | every 2 s while scanning | every 6 s |

Not changed: transaction logic, confirmation sheets, polling of balances and quotes, the wallet picker loading, contract addresses.

Also in round 2: built files (`/assets/*`, named by content hash) are now served with `Cache-Control: public, max-age=31536000, immutable` (`public/vercel.json`). Before, every file was revalidated with the server on each visit, which added a network round trip per screen file for returning visitors. The HTML page itself still revalidates, so a new deploy is picked up at once. Verified on the live site.
