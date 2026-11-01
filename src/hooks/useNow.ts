import { useEffect, useState } from 'react'

/**
 * Re-renders on an interval so countdowns stay live. Pass `enabled = false` while nothing is counting down: the
 * screen then does not re-render every second for no reason.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const tick = () => setNow(Date.now())
    // Refresh straight away: the value may be old if the countdown was switched off for a while.
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [intervalMs, enabled])
  return now
}
