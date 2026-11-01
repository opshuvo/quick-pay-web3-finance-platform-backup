/**
 * Browser-side access to the official Arc Mainnet RPC (chain 5042) for history reads.
 *
 * Measured against https://rpc.mainnet.arc.io:
 *  - eth_getLogs accepts at most 5,001 blocks per request ("requested range too large", code -32012, beyond that);
 *  - eth_getLogs is rate limited to roughly 4 requests per second sustained after a short burst. The limit answers
 *    HTTP 429 or a JSON-RPC error with code -32005 ("rate limit exceeded") and sends no Retry-After header;
 *  - other methods (blockNumber, getBlock, receipts) are not limited at the same rate.
 *
 * So log reads go through one shared paced lane that slows down when the node pushes back and speeds up again when it
 * stops, and every other read goes through a lighter lane. All retrying happens here (the HTTP client does not retry on
 * its own), so a rate limit is never answered with a burst of hidden retries.
 */

export type RpcFailure = 'rate' | 'range' | 'timeout' | 'network' | 'other'

/** The provider's own message for each error in the cause chain (not viem's echo of the request body). */
function failureFacts(error: unknown) {
  const texts: string[] = []
  const codes: number[] = []
  const statuses: number[] = []
  const names: string[] = []
  let current = error as { details?: unknown; shortMessage?: unknown; message?: unknown; code?: unknown; status?: unknown; name?: unknown; cause?: unknown; data?: unknown } | undefined
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth++) {
    for (const value of [current.details, current.shortMessage]) if (typeof value === 'string') texts.push(value)
    if (typeof current.details !== 'string' && typeof current.shortMessage !== 'string' && typeof current.message === 'string') texts.push(current.message)
    if (typeof current.code === 'number') codes.push(current.code)
    if (typeof current.status === 'number') statuses.push(current.status)
    if (typeof current.name === 'string') names.push(current.name)
    current = current.cause as typeof current
  }
  return { text: texts.join(' | '), codes, statuses, names }
}

const RATE = /rate.?limit|too many requests|throttl|request limit|quota/i
const RANGE = /range.{0,24}too (large|big|wide)|too (large|big|wide).{0,12}range|block range|too many (blocks|results)|query returned more than|response size (exceeded|is larger)|result set too large|exceeds? (the )?max(imum)? (block )?range/i
const TIMEOUT = /timed? ?out|took too long to respond|aborted/i
const NETWORK = /http request failed|failed to fetch|fetch failed|load failed|network ?error|econnreset|econnrefused|enotfound|eai_again|socket|unable to connect|bad gateway|service unavailable|gateway time/i

/** Decides what a failed Arc RPC call means. A rate limit is never taken as evidence that a block range is too large. */
export function classifyRpcFailure(error: unknown): RpcFailure {
  const { text, codes, statuses, names } = failureFacts(error)
  if (statuses.includes(429) || codes.includes(-32005) || RATE.test(text)) return 'rate'
  if (codes.includes(-32012) || RANGE.test(text)) return 'range'
  if (names.includes('TimeoutError') || TIMEOUT.test(text)) return 'timeout'
  if (statuses.some((s) => s >= 500) || NETWORK.test(text)) return 'network'
  return 'other'
}

export const RATE_NOTE = 'The Arc RPC is rate limiting requests. Slowing down and retrying.'
export const UNREACHABLE_NOTE = 'The Arc RPC did not answer. Retrying.'

export interface RpcLimiterOptions {
  /** Smallest gap between two calls while the node is happy. */
  baseIntervalMs: number
  /** The gap never grows beyond this when the node keeps pushing back. */
  maxIntervalMs?: number
  /** Total tries for one call (the first plus retries). */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
}

export interface RunOptions {
  attempts?: number
  /** Called with a plain-language note when a try failed and will be retried, and with null once a call succeeds. */
  onNote?: (note: string | null) => void
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Exponential backoff with jitter in [50%, 100%) of each step. */
export function backoffMs(attempt: number, base: number, cap: number, random: () => number): number {
  const step = Math.min(cap, base * 2 ** attempt)
  return step / 2 + random() * (step / 2)
}

/**
 * Paces calls, retries transient failures with exponential backoff, and shares ONE pause across every caller so a
 * rate limit hit by one call holds the others back too. The gap between calls grows when the node pushes back and
 * shrinks again after a run of successes. Identical in-flight requests can be shared with `shared`.
 */
export function createRpcLimiter(options: RpcLimiterOptions) {
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const base = options.baseIntervalMs
  const max = options.maxIntervalMs ?? base * 8
  let interval = base
  let nextSlot = 0
  let pauseUntil = 0
  const inflight = new Map<string, Promise<unknown>>()

  async function waitForSlot() {
    const at = now()
    const slot = Math.max(at, nextSlot)
    nextSlot = slot + interval
    if (slot > at) await sleep(slot - at)
    // A pause set while this call was queued still applies to it.
    for (let wait = pauseUntil - now(); wait > 0; wait = pauseUntil - now()) await sleep(wait)
  }

  async function run<T>(call: () => Promise<T>, opts: RunOptions = {}): Promise<T> {
    const attempts = opts.attempts ?? options.attempts ?? 5
    let last: unknown
    for (let i = 0; i < attempts; i++) {
      await waitForSlot()
      try {
        const value = await call()
        // Speed back up after the node stops pushing back: every success takes 15% off the gap, so a long wait
        // after a burst of rate limits is gone within about a dozen calls instead of lingering for minutes.
        if (interval > base) interval = Math.max(base, Math.floor(interval * 0.85))
        opts.onNote?.(null)
        return value
      } catch (error) {
        last = error
        const kind = classifyRpcFailure(error)
        // A too-large range needs a smaller request, not a retry. Unknown errors get one more try at most.
        if (kind === 'range' || (kind === 'other' && i >= 1)) throw error
        if (kind === 'rate') {
          interval = Math.min(max, Math.ceil(interval * 1.5))
          pauseUntil = Math.max(pauseUntil, now() + backoffMs(i, 800, 10_000, random))
        } else {
          pauseUntil = Math.max(pauseUntil, now() + backoffMs(i, 400, 8_000, random))
        }
        if (i < attempts - 1) opts.onNote?.(kind === 'rate' ? RATE_NOTE : UNREACHABLE_NOTE)
      }
    }
    throw last
  }

  /** Runs `call` once for all callers asking with the same key at the same time. */
  function shared<T>(key: string, call: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const promise = call().finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  return { run, shared, state: () => ({ intervalMs: interval, pausedForMs: Math.max(0, pauseUntil - now()) }) }
}

/** eth_getLogs: the tightly limited method. One lane for every log read in the app. */
export const arcLogsLane = createRpcLimiter({ baseIntervalMs: 350, maxIntervalMs: 2_000 })
/** Everything else (head, blocks, transactions, receipts, token metadata). */
export const arcReadLane = createRpcLimiter({ baseIntervalMs: 100, maxIntervalMs: 2_000 })

/** React Query retry delay for failed reads: 1s, 2s, 4s, capped at 8s. */
export const retryDelay = (attempt: number) => Math.min(8_000, 1_000 * 2 ** attempt)
