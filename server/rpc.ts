import { readFileSync } from 'node:fs'
import { createPublicClient, custom } from 'viem'
import { config } from './env'

/**
 * Studio-provisioned RPC proxy tokens expire while the file that holds them is refreshed underneath a running
 * process. On HTTP 401 the current token is read from `.env` once and the call is retried, so a long-running backend
 * never needs a manual restart. Anywhere else (a deployed host) there is no such file and nothing changes.
 */
function currentRpcUrl(): string {
  const override = process.env.ARC_RPC_URL?.trim()
  if (override || config.rpcSource !== 'proxy') return config.rpcUrl
  try {
    // Values in .env may be wrapped in quotes; Bun strips them when it loads the file, so this reader does too.
    const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')
    const env = new Map(readFileSync('.env', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), unquote(line.slice(line.indexOf('=') + 1))] as const))
    const base = env.get('RPC_PROXY_BASE_URL')?.trim()
    const token = env.get('RPC_PROXY_TOKEN')?.trim()
    if (base && token) return `${base}/api/rpc/Arc?_rpc_token=${token}`
  } catch {
    /* no .env here: keep the URL the process started with */
  }
  return config.rpcUrl
}

let rpcUrl = config.rpcUrl
let rpcId = 0
let rpcCalls = 0
/** How many JSON-RPC requests this process has sent to Arc (shown on /health, so request volume is observable). */
export const rpcCallCount = () => rpcCalls

async function post(url: string, method: string, params: unknown): Promise<Response> {
  rpcCalls += 1
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(20_000),
  })
}

export const client = createPublicClient({
  transport: custom({
    async request({ method, params }) {
      let res = await post(rpcUrl, method, params)
      if (res.status === 401) {
        const fresh = currentRpcUrl()
        if (fresh !== rpcUrl) {
          rpcUrl = fresh
          res = await post(rpcUrl, method, params)
        }
      }
      const text = await res.text()
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { status: res.status, details: text.slice(0, 200), headers: res.headers })
      const body = JSON.parse(text) as { result?: unknown; error?: { code: number; message: string } }
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, details: body.error.message })
      return body.result
    },
  }),
})

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type RpcErrorKind = 'rate_limited' | 'range_too_large' | 'timeout' | 'network' | 'other'

/** Messages worth classifying: the provider's own detail text, not viem's echo of the request body. */
function errorTexts(error: unknown): string[] {
  const texts: string[] = []
  let current = error as { details?: unknown; shortMessage?: unknown; message?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    for (const value of [current.details, current.shortMessage]) if (typeof value === 'string') texts.push(value)
    if (typeof current.details !== 'string' && typeof current.shortMessage !== 'string' && typeof current.message === 'string') texts.push(current.message)
    current = current.cause as typeof current
  }
  return texts
}

function httpStatus(error: unknown): number | undefined {
  let current = error as { status?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    if (typeof current.status === 'number') return current.status
    current = current.cause as typeof current
  }
  return undefined
}

const TIMEOUT = /timed? ?out|took too long to respond|aborted/i
const NETWORK = /http request failed|fetch failed|network|econnreset|econnrefused|enotfound|eai_again|socket|unable to connect|bad gateway|service unavailable|gateway time/i

function hasErrorName(error: unknown, name: string): boolean {
  let current = error as { name?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.name === name) return true
    current = current.cause as typeof current
  }
  return false
}

const RATE_LIMIT = /rate.?limit|too many requests|throttl|request limit|quota/i
const RANGE_TOO_LARGE = /range.{0,24}too (large|big|wide)|too (large|big|wide).{0,12}range|block range|too many blocks|query returned more than|more than \d[\d,]* results|response size (exceeded|is larger)|result set too large|exceeds? (the )?max(imum)? (block )?range/i

/**
 * Decides what a failed RPC call means. Rate limits are checked first and never count as evidence that a
 * block range is too large: only an explicit range / result-size complaint from the provider does.
 */
export function classifyRpcError(error: unknown): RpcErrorKind {
  const text = errorTexts(error).join(' | ') || String((error as Error)?.message ?? error)
  if (httpStatus(error) === 429 || RATE_LIMIT.test(text)) return 'rate_limited'
  if (RANGE_TOO_LARGE.test(text)) return 'range_too_large'
  if (hasErrorName(error, 'TimeoutError') || TIMEOUT.test(text)) return 'timeout'
  if (NETWORK.test(text)) return 'network'
  return 'other'
}

/** Kept for existing callers: true only when the provider actually says the range is too large. */
export const isRangeTooLarge = (error: unknown) => classifyRpcError(error) === 'range_too_large'

export const MAX_RETRY_AFTER_MS = 60_000
export const BACKOFF_BASE_MS = 400
export const BACKOFF_CAP_MS = 8_000

/** Reads a Retry-After header (seconds or an HTTP date) from the error or its causes. Returns ms, clamped. */
export function getRetryAfterMs(error: unknown, now = Date.now()): number | undefined {
  let current = error as { headers?: unknown; cause?: unknown } | undefined
  for (let depth = 0; current && depth < 6; depth++) {
    const headers = current.headers as { get?: (name: string) => string | null } | undefined
    const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : null
    if (raw) {
      const seconds = Number(raw)
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now
      if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS)
    }
    current = current.cause as typeof current
  }
  return undefined
}

/** Bounded exponential backoff with jitter in [50%, 100%) of the step. A Retry-After hint is a floor. */
export function backoffDelay(attempt: number, retryAfterMs?: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt)
  const jittered = step / 2 + random() * (step / 2)
  return retryAfterMs === undefined ? jittered : Math.max(jittered, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS))
}

export interface RpcRunnerOptions {
  minIntervalMs: number
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
  /** Calls allowed in flight at once. Bounds load on the provider even when many requests queue up. */
  maxConcurrent?: number
}

/**
 * Spaces out RPC calls and retries rate-limited ones. A rate limit pauses EVERY caller sharing the runner
 * (the limit belongs to the provider, not to one request), so a burst cannot keep hammering the endpoint.
 */
export function createRpcRunner(options: RpcRunnerOptions) {
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  let nextSlot = 0
  let pauseUntil = 0
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4)
  let active = 0
  const waiting: (() => void)[] = []
  async function acquire() {
    if (active < maxConcurrent) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  function release() {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }

  async function throttle() {
    const at = now()
    const slot = Math.max(at, nextSlot, pauseUntil)
    nextSlot = slot + options.minIntervalMs
    if (slot > at) await sleep(slot - at)
  }

  async function run<T>(call: () => Promise<T>, attempts = options.attempts ?? 6): Promise<T> {
    let lastError: unknown
    for (let i = 0; i < attempts; i++) {
      await acquire()
      try {
        await throttle()
        return await call()
      } catch (error) {
        lastError = error
        if (classifyRpcError(error) !== 'rate_limited') throw error
        pauseUntil = Math.max(pauseUntil, now() + backoffDelay(i, getRetryAfterMs(error, now()), options.random))
      } finally {
        release()
      }
    }
    throw lastError
  }

  return { run, pausedForMs: () => Math.max(0, pauseUntil - now()), inFlight: () => active }
}

const runner = createRpcRunner({ minIntervalMs: config.indexer.minIntervalMs })

/** Runs an RPC call with throttling and bounded, jittered backoff on rate limits. */
export const rpc = runner.run
/** Milliseconds the shared runner is paused because the provider rate-limited us (0 when clear). */
export const rpcPausedForMs = runner.pausedForMs
