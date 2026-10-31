/**
 * Keeps read requests from turning into RPC traffic. For each key (a wallet) the work runs at most once per
 * freshness window, and callers that arrive while it is running share the same run.
 */
export class TipGate {
  private readonly lastStart = new Map<string, number>()
  private readonly inflight = new Map<string, Promise<void>>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Resolves true when this call ran (or joined) real work, false when the last run was recent enough. */
  async run(key: string, minAgeMs: number, work: () => Promise<void>): Promise<boolean> {
    const running = this.inflight.get(key)
    if (running) {
      await running
      return true
    }
    const last = this.lastStart.get(key)
    if (last !== undefined && this.now() - last < minAgeMs) return false
    this.lastStart.set(key, this.now())
    const promise = work().finally(() => {
      this.inflight.delete(key)
      if (this.lastStart.size > 5_000) this.prune(minAgeMs)
    })
    this.inflight.set(key, promise)
    await promise
    return true
  }

  private prune(maxAgeMs: number) {
    const cutoff = this.now() - maxAgeMs
    for (const [key, at] of this.lastStart) if (at < cutoff && !this.inflight.has(key)) this.lastStart.delete(key)
  }
}

/**
 * A value that many requests need at once (the chain head). Concurrent callers share ONE fetch, a fresh value is
 * reused for `ttlMs`, and when a refresh fails a value younger than `staleOkMs` is served instead of an error.
 */
export class SharedValue<T> {
  private value: { v: T; at: number } | undefined
  private inflight: Promise<T> | undefined

  constructor(private readonly ttlMs: number, private readonly staleOkMs: number, private readonly now: () => number = Date.now) {}

  async get(fetcher: () => Promise<T>): Promise<T> {
    const cached = this.value
    if (cached && this.now() - cached.at < this.ttlMs) return cached.v
    if (!this.inflight) {
      this.inflight = fetcher()
        .then((v) => {
          this.value = { v, at: this.now() }
          return v
        })
        .finally(() => {
          this.inflight = undefined
        })
    }
    try {
      return await this.inflight
    } catch (error) {
      if (cached && this.now() - cached.at < this.staleOkMs) return cached.v
      throw error
    }
  }
}

/** Waits for `work`, but never longer than `ms`. The work keeps running; the caller just stops waiting. */
export async function waitAtMost(work: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms) })
  try {
    return await Promise.race([work.then(() => 'done' as const, () => 'done' as const), timeout])
  } finally {
    clearTimeout(timer)
  }
}
