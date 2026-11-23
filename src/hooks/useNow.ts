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

/**
 * True once `deadline` (ms since the epoch) has passed. It flips exactly once, from a single timer, so a screen that only
 * needs "is this quote still valid?" does not re-render every second to find out.
 */
export function useHasPassed(deadline: number | undefined): boolean {
  const [passedFor, setPassedFor] = useState<number>()
  useEffect(() => {
    if (deadline === undefined) return
    const id = setTimeout(() => setPassedFor(deadline), Math.max(0, deadline - Date.now()) + 20)
    return () => clearTimeout(id)
  }, [deadline])
  return deadline !== undefined && passedFor === deadline
}
