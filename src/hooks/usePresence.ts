import { useEffect, useState } from 'react'

/**
 * Keeps a panel mounted long enough to play its closing animation.
 * `state` drives the CSS (`data-state="open" | "closed"`); `mounted` says whether to render it at all.
 * The timer is a safety net, so a panel never stays on screen if an animation is skipped (reduced motion, hidden tab).
 */
export function usePresence(open: boolean, exitMs = 180) {
  const [mounted, setMounted] = useState(open)
  const [seenOpen, setSeenOpen] = useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) setMounted(true)
  }
  useEffect(() => {
    if (open || !mounted) return
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [open, mounted, exitMs])
  return { mounted: open || mounted, state: open ? ('open' as const) : ('closed' as const) }
}
