/**
 * Runs `fn` when the browser is idle (or shortly after, where idle callbacks do not exist), so background work such as
 * prefetching never competes with the screen the user is looking at. Skipped entirely on Data Saver.
 */
export function whenIdle(fn: () => void, timeoutMs = 1500): void {
  if (typeof window === 'undefined') return
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: timeoutMs })
  else setTimeout(fn, 250)
}
